/**
 * tools/test_leave_type.js — leave entitlement: type corruption, half days, and the counter.
 *   node tools/test_leave_type.js
 *
 * The live symptom (ครูลิน, 2026-08-03): three APPROVED leaves on screen, yet the entitlement tiles
 * read 0/30, 0/3, 0/6 — and the types rendered in English while the rest of the app was Thai.
 *
 * Root cause: the leave-type dropdown was `<option>ลาป่วย</option>` with no value attribute. In
 * English mode i18n_tr.js rewrites Thai text in the DOM, so the option's text became "Sick Leave" —
 * and with no value attribute, that is what select.value returned and what was SAVED. The quota is
 * keyed by the Thai name, so nothing ever matched and every total stayed 0.
 */
const path = require('path'), fs = require('fs'), vm = require('vm');
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function throws_(label, fn, code) {
  try { fn(); console.log('  FAIL ' + label + '  (did not throw)'); fail++; }
  catch (e) { const c = e && (e.code || e.apiCode); const ok = !code || c === code;
    console.log((ok ? '  ok   ' : '  FAIL ') + label + '  code=' + c); ok ? pass++ : fail++; }
}
const YR = new Date().toISOString().slice(0, 4);
const D = (m, d) => `${YR}-${m}-${d}`;

function fresh(leaves, used) {
  const M = {
    config: { LeaveQuota: { 'ลาป่วย': 30, 'ลากิจ': 3, 'ลาพักร้อน': 6 }, Departments: 'Nursery 1', Plans: [] },
    staff: [{ StaffID: 'STF-LIN', NameTH: 'ครูลิน', Nickname: 'ลิน', Role: 'Teacher', PositionLevel: 'Staff', Department: 'Nursery 1' },
            { StaffID: 'STF-A', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Department: 'Nursery 1' }],
    leaves: leaves || [], leaveUsed: used || {},
    students: [], parents: [], classes: [], assessments: [], dspmCriteria: [],
    payments: [], prepayments: [], studentCharges: [], otDaily: [], paymentSlips: [],
    otRecords: [], payroll: [], userLinks: [], feed: [], injuryReports: [],
    checkinStudent: [], studentCheckins: [], studentAttendanceToday: [], staffAttendanceToday: [],
    activityLog: [], studentLeaves: [], comments: [], announcements: [],
    withdrawals: [], attendanceReq: [], classChangeReq: [], absenceLog: []
  };
  return { M, H: createAtomAPI(M).H };
}
const lv = (id, type, days, extra) => Object.assign({
  LeaveID: id, StaffID: 'STF-LIN', Type: type, StartDate: D('07', '27'), EndDate: D('07', '27'),
  Days: days, Status: 'APPROVED', HalfDay: '' }, extra || {});

// ---- deriveLeaveUsed_ from GasEngine.gs, loaded standalone -------------------------------
function gasCtx() {
  const ctx = { console, Object, String, Number, Array, Date, JSON,
    gasToday_: () => (() => { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })() };
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'GasEngine.gs'), 'utf8');
  const grab = name => { const i = src.indexOf('function ' + name); let d = 0, j = src.indexOf('{', i);
    for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) { j = k; break; } } }
    return src.slice(i, j + 1); };
  vm.runInContext(grab('ymd4_') + '\n' + grab('deriveLeaveUsed_'), ctx);
  // Leave.gs owns the normaliser; deriveLeaveUsed_ picks it up when the project is loaded together
  const lsrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'Leave.gs'), 'utf8');
  const alias = lsrc.slice(lsrc.indexOf('var LEAVE_TYPE_ALIAS_'), lsrc.indexOf('// ---- Submit'));
  vm.runInContext(alias, ctx);
  return ctx;
}

// ============================================================================
console.log("\n1) ครูลิน's real case: approved leave must actually count against the entitlement");
{
  const c = gasCtx();
  const used = c.deriveLeaveUsed_([
    lv('LV2026-002', 'ลาพักร้อน', 1), lv('LV2026-020', 'ลาพักร้อน', 1),
    lv('LV2026-019', 'ลาป่วย', 0.5, { HalfDay: 'AM' })
  ]);
  eq('2 days of holiday counted', used['STF-LIN']['ลาพักร้อน'], 2);
  eq('half a sick day counted as 0.5, not 1', used['STF-LIN']['ลาป่วย'], 0.5);
}

console.log('\n2) The corruption: rows saved in English mode still count (they used to read 0)');
{
  const c = gasCtx();
  const used = c.deriveLeaveUsed_([
    lv('L1', 'Holiday Leave', 1), lv('L2', 'Holiday Leave', 1), lv('L3', 'Sick Leave', 0.5, { HalfDay: 'AM' })
  ]);
  eq('English "Holiday Leave" folds into ลาพักร้อน', used['STF-LIN']['ลาพักร้อน'], 2);
  eq('English "Sick Leave" folds into ลาป่วย', used['STF-LIN']['ลาป่วย'], 0.5);
  ok_('no English key is left behind', !used['STF-LIN']['Holiday Leave'] && !used['STF-LIN']['Sick Leave']);
}
{
  const c = gasCtx();
  const used = c.deriveLeaveUsed_([lv('L1', 'ลากิจ', 1), lv('L2', 'Leave of absence', 2)]);
  eq('Thai and English rows of the same type add up together', used['STF-LIN']['ลากิจ'], 3);
}

console.log('\n3) Rows that must NOT count');
{
  const c = gasCtx();
  const used = c.deriveLeaveUsed_([
    lv('L1', 'ลาป่วย', 1, { Status: 'PENDING_ADMIN' }),
    lv('L2', 'ลาป่วย', 1, { Status: 'REJECTED' }),
    lv('L3', 'ลาป่วย', 1, { StartDate: '2019-07-27' })      // a previous year
  ]);
  eq('pending / rejected / last year all excluded', used['STF-LIN'], undefined);
}
{
  // Sheets hands back a real Date object; String(date).slice(0,4) is "Mon " and matched nothing
  const c = gasCtx();
  const used = c.deriveLeaveUsed_([lv('L1', 'ลาป่วย', 1, { StartDate: new Date(Number(YR), 6, 27) })]);
  eq('a Date object in StartDate still counts', used['STF-LIN']['ลาป่วย'], 1);
}

console.log('\n4) The entitlement tiles the teacher actually sees');
{
  const { H } = fresh([], { 'STF-LIN': { 'ลาพักร้อน': 2, 'ลาป่วย': 0.5 } });
  const q = H.leaveQuota({ staffId: 'STF-LIN' });
  const by = {}; q.forEach(x => by[x.type] = x);
  eq('ลาพักร้อน  2 used of 6, 4 left', [by['ลาพักร้อน'].used, by['ลาพักร้อน'].remain], [2, 4]);
  eq('ลาป่วย  0.5 used of 30, 29.5 left', [by['ลาป่วย'].used, by['ลาป่วย'].remain], [0.5, 29.5]);
  eq('ลากิจ  untouched', [by['ลากิจ'].used, by['ลากิจ'].remain], [0, 3]);
}
{
  // the exact live bug: totals stored under the English label
  const { H } = fresh([], { 'STF-LIN': { 'Holiday Leave': 2, 'Sick Leave': 0.5 } });
  const by = {}; H.leaveQuota({ staffId: 'STF-LIN' }).forEach(x => by[x.type] = x);
  eq('English totals still reach the Thai tiles', [by['ลาพักร้อน'].used, by['ลาป่วย'].used], [2, 0.5]);
}

console.log('\n5) New leaves are stored with a Thai type whatever the app language');
{
  const { M, H } = fresh();
  H.submitLeave({ staffId: 'STF-LIN', type: 'Sick Leave', startDate: D('08', '10'), endDate: D('08', '10') });
  eq('English input is normalised on the way in', M.leaves[0].Type, 'ลาป่วย');
  H.submitLeave({ staffId: 'STF-LIN', type: 'ลาพักร้อน', startDate: D('08', '11'), endDate: D('08', '11') });
  eq('Thai input is untouched', M.leaves[1].Type, 'ลาพักร้อน');
}
{
  const { M, H } = fresh();
  const r = H.submitLeave({ staffId: 'STF-LIN', type: 'ลาป่วย', startDate: D('08', '12'), endDate: D('08', '12'), halfDay: 'AM' });
  eq('half day costs 0.5', r.days, 0.5);
  eq('and is recorded as such', [M.leaves[0].Days, M.leaves[0].HalfDay], [0.5, 'AM']);
  throws_('half day is refused on a date range', () =>
    H.submitLeave({ staffId: 'STF-LIN', type: 'ลาป่วย', startDate: D('08', '13'), endDate: D('08', '15'), halfDay: 'PM' }), 'BAD_INPUT');
}

console.log('\n6) Admin correcting a record — the half day must survive the edit');
{
  const { M, H } = fresh([lv('L1', 'ลาป่วย', 0.5, { HalfDay: 'AM' })]);
  H.editLeave({ staffId: 'STF-A', leaveId: 'L1', reason: 'ไปหาหมอ' });
  eq('editing only the reason leaves 0.5 alone', [M.leaves[0].Days, M.leaves[0].HalfDay], [0.5, 'AM']);
}
{
  // what Admin needs for ครูลิน: a full day filed by mistake, corrected to a half day
  const { M, H } = fresh([lv('L1', 'ลาป่วย', 1)]);
  H.editLeave({ staffId: 'STF-A', leaveId: 'L1', halfDay: 'PM' });
  eq('a full day can be corrected to a half day', [M.leaves[0].Days, M.leaves[0].HalfDay], [0.5, 'PM']);
  H.editLeave({ staffId: 'STF-A', leaveId: 'L1', halfDay: '' });
  eq('and back to a full day', [M.leaves[0].Days, M.leaves[0].HalfDay], [1, '']);
}
{
  const { M, H } = fresh([lv('L1', 'Sick Leave', 1)]);
  H.editLeave({ staffId: 'STF-A', leaveId: 'L1', type: 'Holiday Leave' });
  eq('an edited type is normalised too', M.leaves[0].Type, 'ลาพักร้อน');
}
{
  const { M, H } = fresh([lv('L1', 'ลาป่วย', 0.5, { HalfDay: 'AM' })]);
  throws_('a half day cannot be stretched over a range', () =>
    H.editLeave({ staffId: 'STF-A', leaveId: 'L1', endDate: D('07', '29') }), 'BAD_INPUT');
  eq('and the record is unchanged after the refusal', M.leaves[0].Days, 0.5);
}
{
  const { H } = fresh([lv('L1', 'ลาป่วย', 1)]);
  throws_('a teacher cannot edit their own leave', () =>
    H.editLeave({ staffId: 'STF-LIN', leaveId: 'L1', halfDay: 'AM' }), 'NO_PERMISSION');
}

console.log('\n7) The dropdowns can no longer be corrupted by the translator');
{
  // strip HTML comments first — the explanation of this very bug quotes the broken markup
  const app = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'app.js'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '');
  // every leave-type <option> must pin an explicit Thai value
  const bare = app.match(/<option>\s*(ลาป่วย|ลากิจ|ลาพักร้อน|ขาด)\s*<\/option>/g) || [];
  eq('no bare Thai <option> left (value-less = translatable = corrupted)', bare, []);
  const dyn = app.match(/<option>\$\{EN\(\)\?[^}]*\}<\/option>/g) || [];
  eq('no language-dependent <option> text without a value either', dyn, []);
  ok_('the staff leave select is marked translate="no"', /id="lType" translate="no"/.test(app));
  ok_('the student leave select is marked translate="no"', /id="tslType" translate="no"/.test(app));
  ok_('the admin edit select is marked translate="no"', /id="elType" translate="no"/.test(app));
  ok_('admin can set a half day', /id="elHalf"/.test(app));
  // the values that reach the sheet
  ['ลาป่วย', 'ลากิจ', 'ลาพักร้อน'].forEach(x =>
    ok_('option value="' + x + '" is pinned', app.indexOf('<option value="' + x + '"') >= 0));
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' : 'ALL PASS ') + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
