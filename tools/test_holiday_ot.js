/**
 * tools/test_holiday_ot.js — OT วันหยุด: a day off that was worked is an agreed SUM, not clocked hours.
 *   node tools/test_holiday_ot.js
 *
 * The whole feature rests on one decision: holiday OT is written into OT_RECORDS (Kind='HOLIDAY')
 * rather than into a money pipeline of its own. That buys the salary link, the carry-over that pays
 * it late instead of dropping it, and the teacher's own OT history — for free, through code that is
 * already proven. What it costs is this: every path that RE-PRICES an OT row computes hours × rate,
 * and a holiday row has 0 hours. Left alone, approving or editing one would silently pay ฿0.
 * So the checks below are mostly about that: the amount survives everything.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function throws_(label, fn, want) {
  let msg = null; try { fn(); } catch (e) { msg = String((e && e.message) || e); }
  const ok = msg !== null && (!want || msg.indexOf(want) >= 0);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '  got=' + JSON.stringify(msg)));
  ok ? pass++ : fail++;
}
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), otgs = R('src/OtStaff.gs'), code = R('src/Code.gs'),
      apijs = R('webapp/api.js'), cfg = R('src/Config.gs');

function boot(over) {
  const M = {
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [] },
    students: [], parents: [], userLinks: [], staff: [], leaves: [], payments: [], otDaily: [],
    studentCharges: [], prepayments: [], paymentSlips: [], checkinStudent: [], journals: [], comments: [],
    holidays: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    payroll: [], payrollConfig: {}, studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [],
    announcements: [], notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [],
    classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [],
    surveyResponses: [], injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {},
    feed: [], calendar: [], classes: [], studentAttendanceToday: [], studentCheckins: [], otRecords: []
  };
  Object.assign(M, over || {});
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(R('webapp/engine.js'), ctx);
  const H = ctx.createAtomAPI(M, {}).H;
  // an old build must FAIL these checks cleanly rather than die on the first call
  if (typeof H.adminAddHolidayOT !== 'function') H.adminAddHolidayOT = () => ({ count: null });
  return { H, M };
}
const STAFF = [
  { StaffID: 'A1', NameTH: 'แอดมิน', Name: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Salary: 20000 },
  { StaffID: 'S1', NameTH: 'ครูเอ', Name: 'ครูเอ', Role: 'Teacher', Salary: 15000 },
  { StaffID: 'S2', NameTH: 'ครูบี', Name: 'ครูบี', Role: 'Teacher', Salary: 15000 },
  { StaffID: 'S3', NameTH: 'ครูซี', Name: 'ครูซี', Role: 'Teacher', Salary: 15000 }
];
const SUN = '2026-08-16', MONTH = '2026-08';
const add = (H, over) => H.adminAddHolidayOT(Object.assign(
  { staffId: 'A1', staffIds: ['S1', 'S2'], date: SUN, amount: 800, note: 'มาจัดห้องเรียนใหม่ทั้งวัน' }, over || {}));

console.log('\n1) the Admin ticks several people and each one gets their OWN row');
{
  const { H, M } = boot({ staff: STAFF });
  const r = add(H);
  eq('two people ticked, two rows written', r.count, 2);
  eq('...one per staff id, in the order ticked', M.otRecords.map(x => x.StaffID), ['S1', 'S2']);
  eq('each row carries the SAME agreed amount — it is per person, not a pot to divide', M.otRecords.map(x => x.Amount), [800, 800]);
  eq('...and is marked as holiday OT so nothing later re-prices it as hours', M.otRecords.map(x => x.Kind), ['HOLIDAY', 'HOLIDAY']);
  eq('no hours are invented', M.otRecords.map(x => [x.Hours, x.Minutes, x.Rate]), [[0, 0, 0], [0, 0, 0]]);
  eq('the day worked is the row date', (M.otRecords[0]||{}).Date, SUN);
  eq('...and its month, which is what payroll buckets on', (M.otRecords[0]||{}).Month, MONTH);
  eq('the reason is kept verbatim — it is the only record of what the day was', (M.otRecords[0]||{}).Note, 'มาจัดห้องเรียนใหม่ทั้งวัน');
  eq('APPROVED on the spot: the Admin granting it IS the approval', M.otRecords.map(x => x.Status), ['APPROVED', 'APPROVED']);
  eq('...and both approval steps are signed by that Admin, not left blank', [(M.otRecords[0]||{}).Step1Status, (M.otRecords[0]||{}).Step2Status, (M.otRecords[0]||{}).ApprovedBy], ['Approved', 'Approved', 'แอดมิน']);
  eq('each row has its own id, or one edit would move two people', new Set(M.otRecords.map(x => x.OTRecordID)).size, 2);
}
{
  const { H, M } = boot({ staff: STAFF });
  add(H, { staffIds: ['S1', 'S1', 'S2'] });
  eq('ticking the same person twice does not pay them twice', M.otRecords.map(x => x.StaffID), ['S1', 'S2']);
}

console.log('\n2) it refuses what it cannot honestly record');
{
  const { H } = boot({ staff: STAFF });
  throws_('nobody ticked', () => add(H, { staffIds: [] }), 'เลือกพนักงาน');
  throws_('no amount — a holiday OT with no sum is not a record of anything', () => add(H, { amount: 0 }), 'ระบุจำนวนเงิน');
  throws_('a negative amount is not a payment', () => add(H, { amount: -500 }), 'ระบุจำนวนเงิน');
  throws_('no reason: months later nobody could say what was paid for', () => add(H, { note: '   ' }), 'ระบุรายละเอียด');
  throws_('a staff id that does not exist', () => add(H, { staffIds: ['S1', 'NOPE'] }), 'ไม่พบพนักงาน');
  throws_('a teacher cannot grant themselves holiday OT', () => add(H, { staffId: 'S1' }), 'เฉพาะแอดมิน');
}
{
  // the whole batch is rejected, not half-written — otherwise a typo pays some people and not others
  const { H, M } = boot({ staff: STAFF });
  try { add(H, { staffIds: ['NOPE', 'S1'] }); } catch (e) {}
  eq('an unknown id in the list writes NOTHING at all', M.otRecords.length, 0);
}

console.log('\n3) the amount survives every path that re-prices an OT');
{
  const { H, M } = boot({ staff: STAFF });
  add(H, { staffIds: ['S1'], amount: 800 });
  const id = (M.otRecords[0]||{}).OTRecordID;
  // the Admin's OT screen has a "select all → approve" button. A holiday row is already APPROVED, so
  // ticking it and pressing approve runs confirmOT over it — which used to recompute hours × rate = 0.
  // an old build wrote no row at all, so these calls must FAIL the checks rather than throw
  const try_ = fn => { try { fn(); } catch (e) {} };
  try_(() => H.confirmOT({ staffId: 'A1', otId: id, decision: 'approve' }));
  eq('re-approving a holiday row does not zero it', (M.otRecords[0]||{}).Amount, 800);
  try_(() => H.adminEditOT({ staffId: 'A1', otId: id, hours: 0 }));
  eq('...nor does an edit that touches hours', (M.otRecords[0]||{}).Amount, 800);
  try_(() => H.adminEditOT({ staffId: 'A1', otId: id, amount: 1000, note: 'ทำงานถึงเย็น' }));
  eq('an explicit amount still wins — the Admin can correct it', (M.otRecords[0]||{}).Amount, 1000);
  eq('...and so does the reason', (M.otRecords[0]||{}).Note, 'ทำงานถึงเย็น');
}
{
  // the ordinary evening OT must keep re-pricing itself, which is what the guard could have broken
  const { H, M } = boot({ staff: STAFF, otRecords: [
    { OTRecordID: 'OTR-9', StaffID: 'S1', Date: SUN, Month: MONTH, Hours: 2, Rate: 89.38, Amount: 179, Status: 'PENDING_ADMIN' } ] });
  H.confirmOT({ staffId: 'A1', otId: 'OTR-9', decision: 'approve' });
  eq('a normal OT is still re-priced at approval (the ฿100 rate correction reaches it)', (M.otRecords[0]||{}).Amount, 200);
}

console.log('\n4) it reaches the salary — through the same door as the evening OT');
{
  const { H, M } = boot({ staff: STAFF, otRecords: [
    { OTRecordID: 'OTR-1', StaffID: 'S1', Date: '2026-08-03', Month: MONTH, Hours: 3, Rate: 100, Amount: 300, Status: 'APPROVED' },
    { OTRecordID: 'OTR-2', StaffID: 'S1', Date: '2026-08-04', Month: MONTH, Hours: 1, Rate: 100, Amount: 100, Status: 'APPROVED' } ] });
  add(H, { staffIds: ['S1'], amount: 800 });
  const s = H.staffMonthlyOT({ staffId: 'S1', month: MONTH });
  eq('the payroll total includes the holiday OT', s.amount, 1200);
  eq('...and the hours count only the hours actually clocked', s.hours, 4);
  eq('the two parts are reported apart, so the screen can explain the total', [s.daily, s.holiday], [400, 800]);
  eq('...and how many holiday days there were', s.holidayDays, 1);
  // a month with none of it must read exactly as it did before this feature existed
  const none = boot({ staff: STAFF, otRecords: [
    { OTRecordID: 'OTR-1', StaffID: 'S1', Date: '2026-08-03', Month: MONTH, Hours: 3, Rate: 100, Amount: 300, Status: 'APPROVED' } ] })
    .H.staffMonthlyOT({ staffId: 'S1', month: MONTH });
  eq('no holiday OT → same total, same hours, and zero holiday', [none.amount, none.hours, none.holiday], [300, 3, 0]);
  eq('only the ticked staff are paid', H.staffMonthlyOT({ staffId: 'S2', month: MONTH }).amount, 0);
  eq('a different month does not pick it up', H.staffMonthlyOT({ staffId: 'S1', month: '2026-09' }).amount, 0);
}
{
  // the teacher must be able to SEE it, or an amount appears on the payslip with no explanation
  const { H, M } = boot({ staff: STAFF });
  add(H, { staffIds: ['S1'] });
  const mine = H.myOT({ staffId: 'S1' });
  eq('it is in the teacher\'s own OT history', mine.length, 1);
  eq('...labelled as holiday OT, with the reason the Admin wrote', [(mine[0]||{}).Kind, (mine[0]||{}).Note], ['HOLIDAY', 'มาจัดห้องเรียนใหม่ทั้งวัน']);
  const admin = H.adminOTList({ month: MONTH });
  eq('and the Admin OT list carries the kind through too', admin.map(x => x.Kind), ['HOLIDAY']);
  ok_('...enriched with the staff name like every other OT row', !!(admin[0]||{}).name);
}

console.log('\n5) the same rules on GAS, which is what actually runs');
{
  ok_('the route exists', /adminAddHolidayOT: function \(p\) \{ return handleAdminAddHolidayOT\(p\); \}/.test(code));
  ok_('...admin-only at the door, not just inside the handler', /confirmOT: 1, adminAddOT: 1, adminAddHolidayOT: 1/.test(code));
  // "adminAddHolidayOT" does not start with a mutating verb, so it must be named in BOTH write lists
  // or it runs without the write lock and the client keeps serving a stale OT list
  ok_('named in WRITES_ACTIONS_ (src/Code.gs)', /adminAddOT: 1, adminAddHolidayOT: 1, adminEditOT: 1/.test(code));
  ok_('...and in WRITES (webapp/api.js) — the two must not drift', /adminAddOT: 1, adminAddHolidayOT: 1, adminEditOT: 1/.test(apijs));
  ok_('the handler is admin-only', /function handleAdminAddHolidayOT[\s\S]{0,220}otIsAdmin_\(ap\)/.test(otgs));
  ok_('one row appended PER staff, in place', /targets\.forEach\(function \(target\) \{[\s\S]{0,400}appendObject_\(sh, \{/.test(otgs));
  ok_('...marked HOLIDAY', /Note: note, Kind: 'HOLIDAY'/.test(otgs));
  ok_('...and APPROVED with both steps signed', /Step1Status: 'Approved', Step2By: ap\.Name, Step2Status: 'Approved'/.test(otgs));
  ok_('duplicates are dropped', /if \(!seen\[id\]\) \{ seen\[id\] = 1; targets\.push\(id\); \}/.test(otgs));
  ok_('amount, reason and at least one person are all required', /ระบุจำนวนเงิน OT/.test(otgs) && /ระบุรายละเอียดการทำงานวันหยุด/.test(otgs) && /เลือกพนักงานอย่างน้อย 1 คน/.test(otgs));
  ok_('the cache is busted, or the new rows are invisible until it expires', /otBust_\(\);\s*\n\s*return \{ count: added\.length/.test(otgs));
  // the two re-pricing paths, guarded by ONE predicate rather than a repeated string test
  ok_('one predicate decides what a holiday OT is', /function otIsHoliday_\(r\)/.test(otgs));
  ok_('confirmOT keeps the agreed sum', /var amount = otIsHoliday_\(r\) \? \(Number\(r\.Amount\) \|\| 0\) : Math\.round\(hours \* rate\);/.test(otgs));
  ok_('adminEditOT does not recompute it from hours', /if \(!otIsHoliday_\(r\)\) patch\.Amount = Math\.round/.test(otgs));
  ok_('the column exists on the sheet', /'Step2Status', 'Note', 'Kind'\]/.test(cfg));
  ok_('...and is topped up on the LIVE sheet, which was created without it', /'Step2Status', 'Note', 'Kind'\]\);/.test(otgs));
}

console.log('\n6) the screen: ดำเนินการ → คุณครู');
{
  ok_('the button is on the teachers tab of ดำเนินการ', /\['🎉',EN\(\)\?'Holiday OT':'OT วันหยุด','A_holidayOT\(\)'\]/.test(app));
  ok_('...next to the ordinary staff OT it belongs with', /\['⏰',t\('ot\.adminOT'\),'A_staffOT\(\)'\],\s*\n\s*\['🎉'/.test(app));
  const scr = app.slice(app.indexOf('window.A_holidayOT=async'), app.indexOf('window.A_otVerify=async'));
  ok_('the four things the Admin was asked for: who, when, why, how much',
    /class="hotchk"/.test(scr) && /id="hotDate"/.test(scr) && /id="hotNote"/.test(scr) && /id="hotAmount"/.test(scr));
  ok_('the reason is a long text box, not a one-line input', /<textarea id="hotNote" rows="3"/.test(scr));
  ok_('several staff can be ticked at once, with a select-all', /A_hotToggleAll/.test(scr) && /id="hotAll"/.test(scr));
  ok_('staff who have left are not offered', /\.filter\(s=>!s\.ended\)/.test(scr));
  ok_('the count of who is ticked is shown as it changes', /A_hotSel/.test(scr));
  // an amount PER PERSON times five people is five times the money — say the total before writing it
  ok_('it confirms the TOTAL before writing, not just the per-head amount', /amount\*staffIds\.length/.test(scr));
  ok_('the month is listed with its total, so the Admin can see what has been granted', /const total=hol\.reduce/.test(scr));
  ok_('...and each row can be corrected or removed', /A_hotSave/.test(scr) && /A_hotDel/.test(scr));
  ok_('deleting asks first', /A_hotDel=async\(otId\)=>\{ if\(!confirm/.test(scr));
  ok_('mobile-first: the form is collapsed once there is a list to read', /<details class="card"[^>]*>\s*\n?\s*<summary/.test(scr) && /\$\{hol\.length\?'':'open'\}/.test(scr));
  ok_('the lists scroll inside their own box rather than pushing Save off-screen', (scr.match(/overflow:auto/g) || []).length >= 2);
}
{
  // it must READ as holiday OT everywhere an OT is shown, or "0 ชม." looks like a broken record
  ok_('one helper decides how it is labelled', /const isHolOT=o=>String\(\(o&&o\.Kind\)\|\|''\)\.toUpperCase\(\)==='HOLIDAY';/.test(app));
  ok_('the teacher\'s OT history says what it is instead of "0 hr"', /const mid=hol\?`🎉 <b>\$\{EN\(\)\?'Holiday OT':'OT วันหยุด'\}/.test(app));
  ok_('...and shows the reason', /o\.Note\?`<br><small class="muted">\$\{esc\(o\.Note\)\}/.test(app));
  ok_('the Admin OT list badges it', /🎉 \$\{EN\(\)\?'Holiday':'วันหยุด'\}/.test(app));
  ok_('...and does not offer to edit hours it does not have', /id="sot_h_\$\{o\.OTRecordID\}" \$\{hol\?'disabled':''\}/.test(app));
  ok_('the payroll screen explains a total that hours × rate cannot account for', /Number\(ot\.holiday\)>0\?` \+ 🎉 /.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
