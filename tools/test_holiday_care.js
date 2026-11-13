/**
 * tools/test_holiday_care.js — 💵 ค่าดูแลวันหยุด: OT วันหยุด pays each teacher their own amount and bills each child
 *   node tools/test_holiday_care.js
 *
 * Asked by the ผอ. 2026-11-13: on ดำเนินการ › คุณครู › OT วันหยุด, after ticking the teachers and the
 * children, the admin sets what each TEACHER earns that day and what the school CHARGES each CHILD —
 * different prices per child if the admin says so — and the bills issue themselves.
 *
 * Decided with the ผอ. the same day (each one is money, so each one is a check below):
 *   1. one amount per teacher (the single amount is now only the quick fill)
 *   2. the bill issues the moment the admin saves — a STUDENT_CHARGES row the family pays like any other
 *   3. a bill the family PAID or SENT A SLIP for is locked: no repricing, no removing the child
 *   4. families told in the app always, on LINE only when the parent.bill topic is on
 *   5. the price is pre-filled from SCHOOL_CONFIG.HolidayCareFee, editable per child
 *   6. a child a teacher adds on the day has NO bill until the admin prices it (badge until then)
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond, extra) { console.log((cond ? '  ok   ' : '  FAIL ') + label + (cond || extra === undefined ? '' : '  ' + JSON.stringify(extra))); cond ? pass++ : fail++; }
const code_ = fn => { try { fn(); return 'ALLOWED'; } catch (e) { return e.code || String(e.message || e).slice(0, 40); } };
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const eng = R('webapp/engine.js'), app = R('webapp/app.js');

const DAY = '2026-08-22';   // a Saturday
function boot(over) {
  over = over || {};
  const M = {
    config: Object.assign({ Plans: [], LeaveQuota: {}, BigCleaningDays: [], OTRatePerHour: 100, OTGraceMinutes: 21,
      DefaultStudentIn: '08:00', DefaultStudentOut: '17:00', GPS_Lat: 0, GPS_Lng: 0, Radius: 999999,
      DefaultCheckInTime: '08:00', DefaultCheckOutTime: '17:00', LateGraceMinutes: 0, Departments: '' }, over.config || {}),
    students: [
      { StudentID: 'S1', Nickname: 'ไบร์ท', NameTH: 'ก ข', Class: 'Nursery 1', Status: 'ACTIVE', ParentID: 'PAR-1' },
      { StudentID: 'S2', Nickname: 'มายด์', NameTH: 'ค ง', Class: 'Nursery 2', Status: 'ACTIVE', ParentID: 'PAR-2' },
      { StudentID: 'S3', Nickname: 'ต้นกล้า', NameTH: 'จ ฉ', Class: 'Nursery 2', Status: 'ACTIVE', ParentID: 'PAR-3' }
    ],
    staff: [{ StaffID: 'A1', NameTH: 'แอดมิน', Nickname: 'แอด', Department: '*', Role: 'Admin', PositionLevel: 'Admin', StaffGroup: 'G1', StartDate: '2020-01-01', Status: 'ACTIVE' },
            { StaffID: 'T1', NameTH: 'ครูเอ', Nickname: 'เอ', Department: '*', Role: 'Teacher', PositionLevel: 'Staff', StaffGroup: 'G1', StartDate: '2020-01-01', Status: 'ACTIVE' },
            { StaffID: 'T2', NameTH: 'ครูบี', Nickname: 'บี', Department: '*', Role: 'Teacher', PositionLevel: 'Staff', StaffGroup: 'G1', StartDate: '2020-01-01', Status: 'ACTIVE' }],
    staffGroups: [{ GroupName: 'G1', CheckInTime: '08:00', CheckOutTime: '17:00' }],
    classes: [{ ClassName: 'Nursery 1' }, { ClassName: 'Nursery 2' }],
    otRecords: [], holidayAttend: over.holidayAttend || [],
    holidays: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    otDaily: [], checkinStudent: [], studentCheckins: [], studentAttendanceToday: [], studentLeaves: [],
    parents: [{ ParentID: 'PAR-1' }, { ParentID: 'PAR-2' }, { ParentID: 'PAR-3' }], userLinks: [], leaves: [], payments: [],
    studentCharges: over.studentCharges || [], prepayments: [], paymentSlips: over.paymentSlips || [], journals: [], comments: [], payroll: [],
    payrollConfig: {}, absenceLog: [], dspmCriteria: [], activityLog: [], announcements: [],
    notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [], classChanges: [],
    timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [], surveyResponses: [],
    injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {}, feed: [], calendar: []
  };
  const at = new Date(DAY + 'T09:00:00');
  class FakeDate extends Date {
    constructor(...a) { if (!a.length) super(at.getTime()); else super(...a); }
    static now() { return at.getTime(); }
  }
  const ctx = { console, Date: FakeDate, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set, Map };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
const charges = M => M.studentCharges.map(c => [c.StudentID, c.Amount, c.Status, c.Month, c.Label]);
const day = M => M.holidayAttend.filter(r => r.Date === DAY).map(r => [r.StudentID, r.Fee, r.FeeStatus, r.ChargeID ? 'linked' : '']);
const set = (H, ids, fees, who) => H.holidayAttendSet(Object.assign({ staffId: who || 'A1', date: DAY, studentIds: ids }, fees === undefined ? {} : { fees }));

console.log('\n1) the teachers — one amount each');
{
  const { H, M } = boot();
  const r = H.adminAddHolidayOT({ staffId: 'A1', staffIds: ['T1', 'T2'], date: DAY, amounts: { T1: 800, T2: 1200 }, note: 'จัดห้อง' });
  eq('two teachers on the same day, two different amounts', M.otRecords.map(o => [o.StaffID, o.Amount, o.Kind]), [['T1', 800, 'HOLIDAY'], ['T2', 1200, 'HOLIDAY']]);
  eq('...and the reply says so per person', r.amounts, { T1: 800, T2: 1200 });
  const b = boot();
  eq('a ticked teacher with no amount is refused — never paid ฿0', code_(() => b.H.adminAddHolidayOT({ staffId: 'A1', staffIds: ['T1', 'T2'], date: DAY, amounts: { T1: 800 }, note: 'x' })), 'BAD_INPUT');
  eq('...and nothing at all was written', b.M.otRecords.length, 0);
  const c = boot();
  c.H.adminAddHolidayOT({ staffId: 'A1', staffIds: ['T1', 'T2'], date: DAY, amount: 500, note: 'x' });
  eq('an older screen sending one amount still pays everyone that amount', c.M.otRecords.map(o => o.Amount), [500, 500]);
}

console.log('\n2) the children — the bill issues on save, one price each');
{
  const { H, M } = boot();
  const r = set(H, ['S1', 'S2', 'S3'], { S1: 300, S2: 500, S3: '' });
  eq('a price above 0 is a bill: an UNPAID extra charge, in the HOLIDAY\'s month, saying what it is for', charges(M),
    [['S1', 300, 'UNPAID', '2026-08', 'ค่าดูแลวันหยุด 22 ส.ค. 2569'], ['S2', 500, 'UNPAID', '2026-08', 'ค่าดูแลวันหยุด 22 ส.ค. 2569']]);
  eq('the day remembers each price and which bill it became; a blank waits (PENDING)', day(M),
    [['S1', 300, 'SET', 'linked'], ['S2', 500, 'SET', 'linked'], ['S3', '', 'PENDING', '']]);
  eq('two families to tell, both about a new bill', r.notify.map(n => [n.studentId, n.kind, n.amount]), [['S1', 'new', 300], ['S2', 'new', 500]]);
  eq('...and the screen is told who still has no price', r.pending, ['S3']);
  // the family sees it where every other extra charge is paid
  const fam = H.studentCharges({ studentId: 'S1' });
  eq('the family\'s payment screen lists it', fam.map(c => [c.Label, c.Amount]), [['ค่าดูแลวันหยุด 22 ส.ค. 2569', 300]]);

  const again = set(H, ['S1', 'S2', 'S3'], { S1: 300, S2: 500, S3: '' });
  eq('saving the same form twice issues nothing twice', [M.studentCharges.length, again.notify.length], [2, 0]);

  const ch = set(H, ['S1', 'S2', 'S3'], { S1: 350, S2: 500, S3: 0 });
  eq('a new price on an unpaid bill changes THAT bill, not a second one', charges(M).map(c => [c[0], c[1]]), [['S1', 350], ['S2', 500]]);
  eq('...the family is told the old and the new amount; 0 = free, no bill', ch.notify.map(n => [n.studentId, n.kind, n.amount, n.from]), [['S1', 'change', 350, 300]]);
  eq('S3 is now priced (free) — no longer waiting', day(M).find(x => x[0] === 'S3'), ['S3', 0, 'SET', '']);

  const rm = set(H, ['S1', 'S3'], { S1: 350, S3: 0 });
  eq('taking a child with an UNPAID bill off the day withdraws the bill', charges(M).map(c => c[0]), ['S1']);
  eq('...and that family is told it is cancelled', rm.notify.map(n => [n.studentId, n.kind, n.amount]), [['S2', 'cancel', 500]]);

  const z = set(H, ['S1', 'S3'], { S1: 0, S3: 0 });
  eq('setting an unpaid bill to 0 withdraws it too', [M.studentCharges.length, z.notify.map(n => n.kind)], [0, ['cancel']]);
}

console.log('\n3) 🔒 a bill a family has paid, or sent a slip for, does not move');
{
  const mk = (status, slip) => { const b = boot();
    set(b.H, ['S1', 'S2'], { S1: 300, S2: 500 });
    const c = b.M.studentCharges.find(x => x.StudentID === 'S1'); c.Status = status;
    if (slip) b.M.paymentSlips.push({ SlipID: 'SL-1', RefKind: 'charge', RefID: c.ChargeID, Amount: 300, Status: slip });
    return b; };
  [['PAID', null], ['PENDING_VERIFY', null], ['PARTIAL', null], ['UNPAID', 'SUBMITTED'], ['UNPAID', 'CONFIRMED']].forEach(([st, slip]) => {
    const { H, M } = mk(st, slip); const snap = JSON.stringify([M.studentCharges, M.holidayAttend]);
    eq(`${st}${slip ? ' + slip ' + slip : ''}: repricing refused`, code_(() => set(H, ['S1', 'S2'], { S1: 250, S2: 500 })), 'CHARGE_LOCKED');
    eq('...taking the child off refused', code_(() => set(H, ['S2'], { S2: 500 })), 'CHARGE_LOCKED');
    ok_('...and NOTHING changed — not even the other child\'s bill', JSON.stringify([M.studentCharges, M.holidayAttend]) === snap);
  });
  {
    const { H, M } = mk('PAID');
    const r = set(H, ['S1', 'S2'], { S1: 300, S2: 450 });
    eq('the paid child at the SAME price is fine — the rest of the form still saves', [M.studentCharges.map(c => c.Amount), r.notify.map(n => n.studentId)], [[300, 450], ['S2']]);
    eq('the lock message names the child', (() => { try { set(H, ['S2'], { S2: 450 }); } catch (e) { return /ไบร์ท/.test(e.message); } })(), true);
  }
  {
    const { H, M } = mk('UNPAID', 'REJECTED');
    set(H, ['S1', 'S2'], { S1: 280, S2: 500 });
    eq('a REJECTED slip is not a payment — the bill can still be corrected', M.studentCharges.find(c => c.StudentID === 'S1').Amount, 280);
  }
  {
    const { H, M } = mk('PAID');
    M.holidayAttend.forEach(r => { if (r.StudentID === 'S1') r.Date = DAY; });
    eq('the teacher-side "take one off" refuses a paid child too', code_(() => H.holidayAttendRemove({ staffId: 'A1', date: DAY, studentId: 'S1' })), 'CHARGE_LOCKED');
    H.holidayAttendRemove({ staffId: 'A1', date: DAY, studentId: 'S2' });
    eq('...and withdraws an unpaid one\'s bill with the name', M.studentCharges.map(c => c.StudentID), ['S1']);
  }
}

console.log('\n4) a child added on the day waits for the admin\'s price');
{
  const { H, M } = boot();
  set(H, ['S1'], { S1: 300 });
  H.holidayAttendAdd({ staffId: 'T1', date: DAY, studentId: 'S2' });
  eq('no bill for the walk-in', M.studentCharges.map(c => c.StudentID), ['S1']);
  eq('...marked as waiting for a price', day(M).find(x => x[0] === 'S2'), ['S2', '', 'PENDING', '']);
  eq('the admin\'s OT วันหยุด tool shows a badge for it', H.opsPending({ staffId: 'A1' }).holidayOT, 1);
  // an OLDER screen (no fees at all) must not price, unprice or bill anything
  const old = set(H, ['S1', 'S2']);
  eq('a save with no prices keeps every existing price and bill', [charges(M).map(c => [c[0], c[1]]), old.notify.length], [[['S1', 300]], 0]);
  set(H, ['S1', 'S2'], { S1: 300, S2: 400 });
  eq('the admin prices it → the bill appears and the badge clears', [charges(M).map(c => [c[0], c[1]]), H.opsPending({ staffId: 'A1' }).holidayOT], [[['S1', 300], ['S2', 400]], 0]);
  const legacy = boot({ holidayAttend: [{ Date: '2026-07-04', StudentID: 'S1', AddedBy: 'A1', AddedAt: '2026-07-01 09:00:00' }] });
  eq('rows from before billing existed are never nagged about', legacy.H.opsPending({ staffId: 'A1' }).holidayOT, 0);
}

console.log('\n5) who sees the money');
{
  const { H } = boot({ config: { HolidayCareFee: 350 } });
  set(H, ['S1', 'S2'], { S1: 300, S2: '' });
  const a = H.holidayAttendList({ staffId: 'A1', date: DAY });
  eq('the admin sees each price, whether it waits, and the default to pre-fill', [a.students.map(s => [s.studentId, s.fee, s.feeStatus, s.chargeLocked]), a.defaultFee],
    [[['S1', 300, 'SET', false], ['S2', '', 'PENDING', false]], 350]);
  const t = H.holidayAttendList({ staffId: 'T1', date: DAY });
  ok_('a teacher on the day gets the names and no money at all', t.students.length === 2 && t.students.every(s => !('fee' in s) && !('chargeId' in s)) && !('defaultFee' in t));
  eq('the default comes back through schoolConfig for the settings screen', H.schoolConfig().HolidayCareFee, 350);
}

console.log('\n6) the refusals');
{
  const { H, M } = boot();
  eq('a negative price', code_(() => set(H, ['S1'], { S1: -5 })), 'BAD_INPUT');
  eq('a typo is refused, never read as 0 (free)', code_(() => set(H, ['S1'], { S1: 'สามร้อย' })), 'BAD_INPUT');
  ok_('...and neither wrote anything', M.studentCharges.length === 0 && M.holidayAttend.length === 0);
  eq('a teacher cannot price the day', code_(() => set(H, ['S1'], { S1: 300 }, 'T1')), 'NO_PERMISSION');
  eq('a working day cannot be priced as a holiday', code_(() => H.holidayAttendSet({ staffId: 'A1', date: '2026-08-20', studentIds: ['S1'], fees: { S1: 300 } })), 'NOT_A_HOLIDAY');
}

console.log('\n7) the screen');
{
  ok_('each teacher has their own amount box', /class="hotamt" data-id=/.test(app));
  ok_('each child has their own price box', /function hotKidRow\(/.test(app) && /class="\$\{o\.feeCls\}" data-sid=/.test(app));
  ok_('a locked child cannot be unticked or repriced (disabled)', /\$\{lock\?'disabled':''\} onchange=/.test(app));
  ok_('"all" and "class" skip locked children', /\.hotstd:not\(:disabled\)/.test(app));
  ok_('the save sends the children FIRST (the half the server can refuse), then the pay', (() => {
    const i = app.indexOf("const r=await api('holidayAttendSet',{staffId:USER.staffId,date:g('hotDate'),studentIds,fees});");
    const j = app.indexOf("await api('adminAddHolidayOT',{staffId:USER.staffId,staffIds,date:g('hotDate'),amounts:at.amounts,note});");
    return i > 0 && j > i; })());
  ok_('the confirm says both totals before anything is written', /รวม \$\{baht\(at\.total\)\}/.test(app) && /ออกบิล \$\{fs2\.n\} คน รวม \$\{baht\(fs2\.total\)\}/.test(app));
  ok_('the per-date edit sends prices too', /api\('holidayAttendSet',\{staffId:USER\.staffId,date,studentIds,fees\}\)/.test(app));
  ok_('the default price is in Settings', /cfgVal\('HolidayCareFee','#setHolFee'/.test(app));
}

console.log('\n8) on Apps Script — the real route, sheets built the OLD way, and the families told');
{
  const H_ = require(path.join(__dirname, 'gas_test_harness.js'));
  const { run, PUSH } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin', 'Triggers',
    'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'OtStaff', 'Payroll', 'Backup', 'PaySlips', 'Slips', 'Perf', 'GasEngine', 'Engine', 'Day6', 'HolidayCare']);
  const res = JSON.parse(run(function () {
    _configCache = null; setupAll(); _configCache = null;
    var main = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
    // the OLD header, exactly like the live sheet: no Fee / FeeStatus / ChargeID
    var ha = main.getSheetByName('HOLIDAY_ATTEND'); if (ha) main.deleteSheet(ha);
    main.insertSheet('HOLIDAY_ATTEND').appendRow(['Date', 'StudentID', 'AddedBy', 'AddedAt']);
    appendObject_(sheet_(hr, 'STAFF'), { StaffID: 'A1', Name: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', StartDate: '2020-01-01' });
    appendObject_(sheet_(hr, 'STAFF'), { StaffID: 'T1', Name: 'ครูเอ', Role: 'Teacher', PositionLevel: 'Staff', Status: 'ACTIVE', StartDate: '2020-01-01' });
    appendObject_(sheet_(hr, 'STAFF'), { StaffID: 'T2', Name: 'ครูบี', Role: 'Teacher', PositionLevel: 'Staff', Status: 'ACTIVE', StartDate: '2020-01-01' });
    ['S1', 'S2'].forEach(function (id, i) {
      appendObject_(sheet_(main, 'STUDENTS'), { StudentID: id, Name: 'เด็ก ' + id, Nickname: ['ไบร์ท', 'มายด์'][i], Class: 'Nursery 1', Status: 'ACTIVE', ParentID: 'PAR-' + id });
      appendObject_(sheet_(main, 'PARENTS'), { ParentID: 'PAR-' + id, StudentID: id, Name: 'ผู้ปกครอง ' + id, LineUID: 'U-' + id });
    });
    setConfigValue_('NotifyParentBill', 'app,line'); setConfigValue_('LineChannelAccessToken', 'REALTOKEN'); _configCache = null;
    var o = {};
    o.route = typeof ROUTES.holidayAttendSet === 'function';
    o.ot = handleAdminAddHolidayOT({ staffId: 'A1', staffIds: ['T1', 'T2'], date: '2026-08-22', amounts: { T1: 800, T2: 1200 }, note: 'จัดห้อง' });
    o.otRows = readObjects_(sheet_(hr, 'OT_RECORDS')).map(function (r) { return [r.StaffID, r.Amount]; });
    o.set = handleHolidayAttendSet({ staffId: 'A1', date: '2026-08-22', studentIds: ['S1', 'S2'], fees: { S1: 300, S2: 500 } });
    var h = main.getSheetByName('HOLIDAY_ATTEND');
    o.header = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0];
    o.att = readObjects_(h).map(function (r) { return [r.StudentID, r.Fee, r.FeeStatus, r.ChargeID ? 'linked' : '']; });
    o.ch = readObjects_(sheet_(main, 'STUDENT_CHARGES')).map(function (r) { return [r.StudentID, r.Amount, r.Status, r.Label]; });
    o.push = PUSH.map(function (p) { return [p.to, /ค่าดูแลวันหยุด 22 ส\.ค\. 2569/.test(JSON.stringify(p)), /300|500/.test(JSON.stringify(p))]; });
    // LINE off for this topic → the bell only
    PUSH.length = 0; setConfigValue_('NotifyParentBill', 'app'); _configCache = null;
    o.set2 = handleHolidayAttendSet({ staffId: 'A1', date: '2026-08-22', studentIds: ['S1'], fees: { S1: 350 } });
    o.push2 = PUSH.length;
    o.ch2 = readObjects_(sheet_(main, 'STUDENT_CHARGES')).map(function (r) { return [r.StudentID, r.Amount]; });
    return JSON.stringify(o);
  }));
  ok_('holidayAttendSet is a real route now (it has to notify, which the engine cannot)', res.route);
  eq('per-teacher amounts land in the real OT sheet', res.otRows, [['T1', 800], ['T2', 1200]]);
  ok_('the three columns were added to a sheet that did not have them', ['Fee', 'FeeStatus', 'ChargeID'].every(c => res.header.indexOf(c) >= 0), res.header);
  eq('...and the values landed in them', res.att, [['S1', 300, 'SET', 'linked'], ['S2', 500, 'SET', 'linked']]);
  eq('two bills in the real STUDENT_CHARGES sheet', res.ch, [['S1', 300, 'UNPAID', 'ค่าดูแลวันหยุด 22 ส.ค. 2569'], ['S2', 500, 'UNPAID', 'ค่าดูแลวันหยุด 22 ส.ค. 2569']]);
  eq('each family got ONE LINE message naming the day and the amount', res.push, [['U-S1', true, true], ['U-S2', true, true]]);
  eq('the reply counts them and no longer carries the internal queue', [res.set.parentNotified, 'notify' in res.set], [2, false]);
  eq('with the topic set to app-only, LINE stays silent', res.push2, 0);
  eq('...and the change and the cancellation still happened', res.ch2, [['S1', 350]]);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
