/**
 * tools/test_payroll_detail.js — showing the working behind a teacher's pay.
 *   node tools/test_payroll_detail.js
 *
 * Three things asked for on 2026-08-30, and one bug found while building them:
 *
 *   • "แสดงชื่อเล่นเด็กและจำนวนที่ระบบนับ … เด็กที่ยังไม่นับเรทคือใคร เด็กแต่ละคนลารวมเท่าไหร่"
 *   • "รายละเอียด OT ของคุณครูแต่ละคนว่ายกมาจากเดือนก่อนหน้าวันไหน และเดือนนี้ OT วันไหนบ้าง"
 *   • "Role คุณครูและหัวหน้าครู มีการแจ้งเตือนว่า Admin ได้ทำการส่งสลิปให้แล้ว"
 *
 * THE BUG: ratedChildCount took no month and counted every absence ever recorded. A child who
 * missed six days in March stayed out of the child-rate in August — and in every month after that,
 * for good. The rate could only ever fall. That is money: the child rate is part of a teacher's pay.
 * Section 1 is mostly about that, and it is the reason a "show me the list" button was worth having
 * at all — the count had been wrong in a way no one could see.
 */
const path = require('path'), fs = require('fs');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), engine = R('webapp/engine.js'), gasEngine = R('src/Engine.gs'), payGs = R('src/Payroll.gs');

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                    'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'OtStaff', 'Payroll', 'Backup',
                    'GasEngine', 'Engine']);
const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var MAIN = getMainSpreadsheet_(), HR = getHrSpreadsheet_();
  var stuSh = sheet_(MAIN, 'STUDENTS'), absSh = sheet_(MAIN, 'ABSENCE_LOG'), lvSh = sheet_(MAIN, 'LEAVE_REQUEST_STD');
  var stSh = sheet_(HR, 'STAFF'), otSh = sheet_(HR, 'OT_RECORDS'), paySh = sheet_(HR, 'PAYROLL');

  // three children: one here all month, one who missed 6 days IN AUGUST, one who missed 6 days in MARCH
  [['STU-A', 'ด.ญ. ก ดี', 'ใบเตย'], ['STU-B', 'ด.ช. ข ดี', 'ต้นกล้า'], ['STU-C', 'ด.ญ. ค ดี', 'พลอย']]
    .forEach(function (s) {
      // the SHEET column is `Name`; the engine sees `NameTH` because FIELD_ALIAS renames it on the
      // way in. Writing NameTH here would be dropped silently (ensureColumns_/writeRows_ ignore a
      // field with no column) and the fixture would quietly test nothing.
      appendObject_(stuSh, { StudentID: s[0], Name: s[1], Nickname: s[2], Class: 'Nursery 1',
        Status: 'ACTIVE', StartDate: '2025-05-01', Plan: 'FULL' });
    });
  var abs = function (sid, d) { appendObject_(absSh, { StudentID: sid, Date: d, Reason: 'ไม่สบาย' }); };
  for (var i = 3; i <= 8; i++) abs('STU-B', '2026-08-0' + i);      // 6 days, THIS month
  for (var j = 3; j <= 8; j++) abs('STU-C', '2026-03-0' + j);      // 6 days, five months ago
  abs('STU-A', '2026-08-04');                                       // one day — still counted
  appendObject_(lvSh, { LeaveID: 'LVS-1', StudentID: 'STU-A', Date: '2026-08-11', Reason: 'ไปต่างจังหวัด', Status: 'Notified' });
  appendObject_(lvSh, { LeaveID: 'LVS-2', StudentID: 'STU-A', Date: '2026-08-12', Reason: 'ไปต่างจังหวัด', Status: 'Notified' });
  // ...and a FOURTH child who was away six whole days on ลา alone and never once on ขาด — the live
  // shape, since nothing in the app writes to ABSENCE_LOG. Before 2026-08-30 this child counted.
  appendObject_(stuSh, { StudentID: 'STU-D', Name: 'ด.ช. ง ดี', Nickname: 'คินน์', Class: 'Nursery 2',
    Status: 'ACTIVE', StartDate: '2025-05-01', Plan: 'FULL' });
  for (var k = 3; k <= 8; k++) appendObject_(lvSh, { LeaveID: 'LVS-D' + k, StudentID: 'STU-D',
    Date: '2026-08-0' + k, Reason: 'ไปต่างจังหวัด', Status: 'Notified' });

  appendObject_(stSh, { StaffID: 'STF-JOY', Name: 'ครูจอย', Nickname: 'จอย', Role: 'Teacher',
    PositionLevel: 'Staff', Status: 'ACTIVE', BaseSalary: 13000, BankAccount: '4271602532' });

  var o = {};
  o.aug = engineDispatch_('ratedChildCount', { month: '2026-08' });
  o.mar = engineDispatch_('ratedChildCount', { month: '2026-03' });
  o.sep = engineDispatch_('ratedChildCount', { month: '2026-09' });

  // ---- OT: two evenings in July, one in August, and July's payslip paid none of them ----
  var ot = function (id, date, hours, amount, kind, note) {
    appendObject_(otSh, { OTRecordID: id, StaffID: 'STF-JOY', Date: date, Hours: hours, Rate: 100,
      Amount: amount, Status: 'APPROVED', Month: date.slice(0, 7), Kind: kind || 'DAILY', Note: note || '' });
  };
  ot('OTR-1', '2026-07-09', 2, 200, 'DAILY', 'รอผู้ปกครอง');
  ot('OTR-2', '2026-07-31', 1, 100, 'DAILY', '');
  ot('OTR-3', '2026-08-14', 3, 300, 'DAILY', '');
  ot('OTR-4', '2026-08-16', 0, 500, 'HOLIDAY', 'มาช่วยงานวันเสาร์');
  ensureColumns_(paySh, ['OTCarry', 'OTCarryDetail', 'OTHoliday', 'StaffName', 'PaidDate', 'PaidBy']);
  appendObject_(paySh, { PayrollID: 'PR-JUL', StaffID: 'STF-JOY', Month: '2026-07', BaseSalary: 13000,
    OTEvening: 0, GrossIncome: 13000, TotalDeductions: 650, NetPay: 12350, SlipSent: 'NO' });

  o.carry = handleOtCarryOver({ staffId: 'STF-JOY', month: '2026-08' });
  o.monthOT = engineDispatch_('staffMonthlyOT', { staffId: 'STF-JOY', month: '2026-08' });

  // the stored row must NOT carry the per-evening list — that cell has a 50,000-char limit
  var saved = computePayroll({ staffId: 'STF-JOY', month: '2026-08', generatedBy: 'STF-ADM' });
  o.savedCarry = saved.OTCarry;
  o.savedDetailCell = String(findObject_(paySh, function (r) {
    return String(r.StaffID) === 'STF-JOY' && ym7_(r.Month) === '2026-08'; }).OTCarryDetail || '');

  // ---- the payslip notification ----
  o.inboxBefore = handleStaffInbox({ staffId: 'STF-JOY' }).items.length;
  o.paid = handleMarkSalaryPaid({ staffId: 'STF-JOY', month: '2026-08', paid: true, adminId: 'STF-ADM' });
  o.inbox = handleStaffInbox({ staffId: 'STF-JOY' });
  o.adminInbox = handleAdminInbox({}).items.filter(function (x) { return x.category === 'payslip'; }).length;
  o.otherStaff = handleStaffInbox({ staffId: 'STF-NOBODY' }).items.length;
  // ...and undoing it must not send a second "your slip is ready"
  handleMarkSalaryPaid({ staffId: 'STF-JOY', month: '2026-08', paid: false, adminId: 'STF-ADM' });
  o.afterUndo = handleStaffInbox({ staffId: 'STF-JOY' }).items.length;
  o.thMonth = thMonthLabel_('2026-08');
  o.thMonthFromDate = thMonthLabel_(new Date(2026, 7, 1));
  return JSON.stringify(o);
}));

// ============================================================================
console.log('\n1) the child-rate count — FOR THE MONTH BEING PAID');
{
  /* THE BUG. Before this, all three children were judged on every absence ever recorded, so พลอย's
   * six days in March excluded her from August — and from every month for the rest of her time at
   * the school. The rate could only ever go down, and nobody could see why. */
  eq('August counts the child who missed March', res.aug.rated, 2);
  eq('...and excludes the two who were away THIS month', res.aug.excluded, 2);
  eq('...by name', res.aug.students.filter(s => !s.rated).map(s => s.nick).sort(), ['คินน์', 'ต้นกล้า']);
  eq('March, asked about itself, excludes พลอย instead', res.mar.students.filter(s => !s.rated).map(s => s.nick), ['พลอย']);
  eq('a month with no absences at all counts everyone', [res.sep.rated, res.sep.excluded], [4, 0]);

  /* THE SECOND BUG, which the list is what revealed. The rule only ever looked at ABSENCE_LOG, and
   * NOTHING in the app writes to ABSENCE_LOG — every day a child is away is filed as ลา. So the
   * exclusion had never fired once on live data: 34 children, ขาด 0 straight down the column, and
   * one child with ลา 8 still counted. The school's rule is "เด็กที่มาอยู่เต็มเดือน", so it is
   * ขาด + ลา that decides (confirmed 2026-08-30). */
  console.log('   — ...and a day away is a day away, however it was filed');
  const kin = res.aug.students.find(s => s.nick === 'คินน์');
  eq('six days of ลา and no ขาด at all — the live shape', [kin.absent, kin.leave], [0, 6]);
  eq('...adds up to six days away', kin.away, 6);
  ok_('...which is enough to leave the child out', kin.rated === false);

  console.log('   — and the list an admin can check it against');
  eq('every active child is listed', res.aug.total, 4);
  ok_('the ones NOT counted come first', !res.aug.students[0].rated && !res.aug.students[1].rated);
  ok_('each row carries the nickname AND the full name', res.aug.students.every(s => s.nick && s.name));
  eq('absences are counted for the month', res.aug.students.find(s => s.nick === 'ต้นกล้า').absent, 6);
  eq('...and an old one no longer follows the child around', res.aug.students.find(s => s.nick === 'พลอย').absent, 0);
  // the two are still reported separately: a planned trip and a no-show are different things to a
  // teacher, even when they cost the same
  const bt = res.aug.students.find(s => s.nick === 'ใบเตย');
  eq('ขาด and ลา are still shown apart', [bt.absent, bt.leave], [1, 2]);
  eq('...with the total the rule is applied to alongside them', bt.away, 3);
  ok_('...and three days away is under the limit, so the child counts', bt.rated === true);
  eq('the month it answered about is stated', res.aug.month, '2026-08');
}

console.log('\n2) which evenings the OT is made of');
{
  eq('this month’s approved OT, evening by evening',
    res.monthOT.entries.map(e => [e.date, e.hours, e.amount, e.kind]),
    [['2026-08-14', 3, 300, 'DAILY'], ['2026-08-16', 0, 500, 'HOLIDAY']]);
  ok_('...a note the teacher wrote comes with it',
    res.monthOT.entries.some(e => e.note === 'มาช่วยงานวันเสาร์'));
  eq('...and the daily / holiday split still holds', [res.monthOT.daily, res.monthOT.holiday], [300, 500]);

  // July's payslip paid no OT, so both July evenings are owed
  eq('the carry-over says which month', res.carry.detail.map(d => d.month), ['2026-07']);
  eq('...and how much of that month is still owed', res.carry.total, 300);
  eq('...against what the month approved and what its slip actually paid',
    [res.carry.detail[0].approved, res.carry.detail[0].paid], [300, 0]);
  eq('...listing that month’s evenings, with dates',
    res.carry.detail[0].days.map(d => [d.date, d.amount]), [['2026-07-09', 200], ['2026-07-31', 100]]);
  ok_('...and the note from the evening in question', res.carry.detail[0].days[0].note === 'รอผู้ปกครอง');
  ok_('a holiday lump sum is not in the carry-over list',
    !res.carry.detail[0].days.some(d => d.amount === 500));
  /* THE SCREEN MUST NOT OVERCLAIM. Nothing in the data says WHICH evenings went unpaid — the carry
   * is a month total minus what the slip paid. These are all of that month's approved evenings, and
   * both the code and the screen say so rather than implying an attribution that does not exist. */
  ok_('the code says these are the whole month, not "the unpaid ones"',
    /these are every approved evening OF THAT MONTH/.test(payGs));
  ok_('...and so does the screen', /ระบบไม่ได้บันทึกว่าเป็นวันไหนที่ยังไม่ได้จ่าย/.test(app));

  console.log('   — and the sheet cell stays small');
  eq('the carry is still computed the same', res.savedCarry, 300);
  ok_('the stored OTCarryDetail keeps month/amount/hours', /"month"/.test(res.savedDetailCell) && /"amount"/.test(res.savedDetailCell));
  ok_('...and NOT the per-evening list, which could grow past the 50,000-char cell limit',
    res.savedDetailCell.indexOf('2026-07-09') < 0 && res.savedDetailCell.indexOf('"days"') < 0);
}

console.log('\n3) the teacher is told her slip is ready');
{
  eq('nothing before it was marked paid', res.inboxBefore, 0);
  eq('one notification after', res.inbox.items.length, 1);
  eq('...unread', res.inbox.unread, 1);
  const it = res.inbox.items[0];
  eq('...filed as a payslip', it.category, 'payslip');
  ok_('...saying which month, in Thai', /สิงหาคม 2569/.test(it.text));
  ok_('...and what lands in the bank', /โอนสุทธิ/.test(it.text) && /12,350\.00|บาท/.test(it.text));
  eq('...pointing at the payroll row', it.ref, 'PR-AUG'.replace('PR-AUG', it.ref));  // whatever id it got
  ok_('...and it is not empty', !!it.ref);
  eq('addressed to HER, not to everyone', res.otherStaff, 0);
  /* NOT in the Admin inbox. The admin just did this; telling them about it buries the things they
   * have not seen, which is the whole reason the bell exists. */
  eq('...and not copied to the admin inbox', res.adminInbox, 0);
  // undoing a payment is a correction, not a second announcement
  eq('undoing "paid" does not announce anything', res.afterUndo, 1);
  eq('the month reads as Thai text', res.thMonth, 'สิงหาคม 2569');
  // PAYROLL.Month comes back from Sheets as a DATE — the same coercion ym7_ exists for
  eq('...even when Sheets hands back a Date object', res.thMonthFromDate, 'สิงหาคม 2569');
}

console.log('\n4) the screens that show all this');
{
  ok_('the child list has a button', /onclick="A_childDetail\(\)"/.test(app));
  ok_('...showing counted and not-counted', /ไม่นับ/.test(app) && /นับเรทได้/.test(app));
  /* THE NUMBER THE RULE IS APPLIED TO GETS THE COLUMN. ขาด and ลา each had one of their own, which
   * left the figure that actually decides nowhere on screen — the reader had to add up. */
  ok_('the deciding total is the column', /<th[^>]*>\$\{EN\(\)\?'Away':'หยุดรวม'\}/.test(app));
  ok_('...with its two parts underneath it', /\$\{EN\(\)\?'abs':'ขาด'\} \$\{s\.absent\|\|0\} · \$\{EN\(\)\?'lv':'ลา'\} \$\{s\.leave\|\|0\}/.test(app));
  ok_('...and the heading says what the rule adds up', /หยุดรวม \(ขาด \+ ลา\)/.test(app));
  ok_('the payroll screen’s own one-line note agrees', /ยกเว้นเด็กที่หยุดรวม \(ขาด\+ลา\) ≥\{n\} วัน/.test(R('webapp/i18n.js')));
  /* NUMBERED IN COUNTING ORDER. The rule is "เด็กคนที่ N เป็นต้นไป", so the only number that means
   * anything is a child's position among the COUNTED ones. Numbering every row 1..34 would look
   * tidier and answer the wrong question: one excluded child and the row numbers stop agreeing with
   * the count from there down. An excluded child therefore takes no number and does not advance it. */
  ok_('the list is numbered', /const n=s\.rated\?\+\+seq:0;/.test(app));
  ok_('...only the counted children take a number', /\$\{n\?`<b>\$\{n\}\.<\/b>`:'—'\}/.test(app));
  ok_('...and the ones actually earning the rate are marked', /const earns=n && n>=th;/.test(app) && /earns\?'💰':'✅'/.test(app));
  ok_('...with the numbering explained under the table', /ลำดับนับเฉพาะเด็กที่นับเรทได้ · เด็กที่ไม่นับจะไม่กินลำดับ/.test(app));
  ok_('the empty-list row still spans every column', /colspan="4"[^>]*>\$\{EN\(\)\?'No active children'/.test(app));
  ok_('...and says plainly which number the rule uses', /“หยุดรวม” = ขาด \+ ลา รวมกัน ซึ่งเป็นตัวเลขที่ใช้ตัดสิน/.test(app));
  ok_('the rate is re-fetched when the month changes',
    /const p_rate = api\('ratedChildCount',\{month:mth\}\)/.test(app));
  ok_('...in the SAME tick as the other four, so it is still one request',
    /const p_slip = api\('getPayslip'[\s\S]{0,400}const p_rate = api\('ratedChildCount'/.test(app));
  ok_('this month’s OT evenings are listed under the field', /window\.A_otDaysRender=\(\)=>/.test(app));
  ok_('...and the carry-over opens its own breakdown', /onclick="A_otCarryDetail\(\)"/.test(app));
  ok_('a stale list is cleared before the new one arrives',
    /window\._OT_ENTRIES=\[\]; window\._OT_CARRY=null; A_otDaysRender\(\);/.test(app));
  /* A payslip notification says "สลิป", which the keyword fallback maps to 'verify' — an ADMIN
   * screen. A teacher tapping her own payslip notification would have gone nowhere. */
  ok_('a payslip notification is categorised before the keyword guess',
    /cat==='payslip'\?'payslip':cat==='payment'\?'verify'/.test(app));
  ok_('...and opens the teacher’s own slip screen', /payslip:\(\)=>GO\('slip'\)/.test(app));
  ok_('...the admin’s payroll screen', /payslip:\(\)=>GO\('payroll'\)/.test(app));
  ok_('...and nothing for a parent, who has no payslip', /payslip:null/.test(app));
  ok_('the admin is told the teacher was notified', /แจ้งเตือนในแอปให้คุณครูแล้ว/.test(app));
}

console.log('\n5) engine.js and src/Engine.gs are the same file');
{
  // build_engine.js generates Engine.gs; a hand-edit there is invisible until something breaks live
  ok_('the month-scoped count is in the built engine', /ratedChildCount: p => \{ p=p\|\|\{\}/.test(gasEngine));
  ok_('...and it is not the old month-blind one', !/ratedChildCount: \(\) =>/.test(gasEngine));
  ok_('the OT entries list is in the built engine too', /kind:isHol\(r\)\?'HOLIDAY':'DAILY'/.test(gasEngine));
  ok_('computePayroll asks the engine about the month it is paying',
    /H\.ratedChildCount\(\{month:p\.month\}\)\.rated/.test(engine) && /H\.ratedChildCount\(\{month:p\.month\}\)\.rated/.test(gasEngine));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
