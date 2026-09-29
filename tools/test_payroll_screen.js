/**
 * tools/test_payroll_screen.js — the payroll screen: who it offers, what it clears, what month it
 * says.   node tools/test_payroll_screen.js
 *
 * Five faults reported together on 2026-09-29, all on the same screen and all about money:
 *
 *   1. it opened with somebody already selected      → a payslip one stray tap away from being saved
 *      for whoever sorts first
 *   2. people who cannot be paid were in the list    → leavers, view-only accounts, a private
 *      housekeeper the school does not pay
 *   3. 🔴 the previous teacher's figures stayed       → including รายการเพิ่ม/หักพิเศษ, which A_calc
 *      sends and computePayroll SAVES — a deduction typed for one teacher, written onto another
 *      teacher's payslip
 *   4. there was no attendance on a screen whose      → เบี้ยขยัน was being ticked from memory
 *      whole job is to decide เบี้ยขยัน
 *   5. 🔴 the slip's heading was one month behind     → กันยายน printed as สิงหาคม
 *
 * §4 is the one with teeth, and it is written as a MEASUREMENT of the reset rather than a grep for
 * the word "reset": the form is filled with one teacher's month, switched, and every field read
 * back. The control is the first half of it — a switch that DOES carry figures over (a real saved
 * payslip) must still show them, or "everything is blank" would pass this suite by doing nothing.
 */
const path = require('path'), fs = require('fs');
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), engine = R('webapp/engine.js'),
      payGs = R('src/Payroll.gs'), staffGs = R('src/Staff.gs');
// assertions must never be satisfied by a COMMENT that happens to quote the code
const appCode = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const engCode = engine.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const payCode = payGs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ============================================================================================
console.log('1) who may be paid — three exclusions, and one deliberate non-exclusion');
// ============================================================================================
{
  /* Re-created from the source so this measures the RULE rather than a copy of it: if payableStaff
   * changes shape, the extraction fails loudly instead of the suite quietly testing a stale clone. */
  const m = /const payableStaff = (list => [^;]+);/.exec(appCode);
  ok_('payableStaff is defined on the payroll screen', !!m);
  const payable = m ? eval('(' + m[1] + ')') : (() => []);

  const roster = [
    { StaffID: 'S-TEACH', Role: 'Teacher', ended: false, noPayroll: false },
    { StaffID: 'S-DIR', Role: 'Admin', PositionLevel: 'Admin', ended: false, noPayroll: false },   // ผอ.
    { StaffID: 'S-LEFT', Role: 'Teacher', ended: true, noPayroll: false },
    { StaffID: 'S-OBS', Role: 'Observer', ended: false, noPayroll: false },
    { StaffID: 'S-MAID', Role: 'Teacher', ended: false, noPayroll: true },                         // คุณเติ้ล
    { StaffID: 'S-SYS', Role: 'Admin', ended: false, noPayroll: true },                            // แอดมิน
    { StaffID: 'S-PAUSED', Role: 'Teacher', ended: false, noPayroll: false, paused: true }
  ];
  const ids = payable(roster).map(s => s.StaffID);

  eq('a working teacher is offered', ids.indexOf('S-TEACH') >= 0, true);
  /* THE ONE THAT WAS NEARLY GOT WRONG. The request was "Admin/Observer ต้องไม่อยู่ใน Lists", and the
   * ผอ. is an Admin who IS paid — filtering on Role would have removed the director's own payslip
   * from the only screen that can produce it. Confirmed with the school before this was written. */
  eq('🔴 the ผอ. is an Admin AND is paid — she stays', ids.indexOf('S-DIR') >= 0, true);
  eq('somebody who has left is not offered', ids.indexOf('S-LEFT') >= 0, false);
  eq('a view-only account is not offered', ids.indexOf('S-OBS') >= 0, false);
  eq('somebody the school does not pay is not offered', ids.indexOf('S-MAID') >= 0, false);
  eq('a system account is not offered', ids.indexOf('S-SYS') >= 0, false);
  /* ลาชั่วคราว is not "cannot be paid" — PauseSalaryMode decides what they get, and a month with a
   * half salary in it is exactly a month somebody has to sit down and run. */
  eq('somebody on temporary leave still has a month to run', ids.indexOf('S-PAUSED') >= 0, true);

  ok_('the printed-for-the-whole-month list uses the same rule',
    /A_print=async\(month\)[\s\S]{0,400}payableStaff\(all\)/.test(appCode));
}

// ============================================================================================
console.log('1b) ...and the การเงิน card agrees — without dropping a salary that was paid');
// ============================================================================================
{
  /* Reported 2026-09-29, the day after the payroll screen was taught the rule: คุณเติ้ล was ticked
   * "ไม่อยู่ในระบบเงินเดือน" and still sat on การเงิน › จ่ายเงิน › เงินเดือนคุณครู. Two lists, two
   * answers about who the school pays — and a "4/12 สรุปแล้ว" counter measuring itself against a
   * denominator that included people nobody would ever run.
   *
   * 🔴 THE TRAP. financeSummary's salaryExpense is Σ net over this same list, and it is the pink
   * "รายจ่ายรวม" tile. Filtering on "can still be paid" alone takes a LEAVER'S FINAL PAYSLIP out of
   * the school's expense total for the month they left — a genuine, saved, signed-off salary quietly
   * missing from the accounts. So the rule is "a row for this month always counts", and the test
   * below is built to fail if anybody ever simplifies it back. */
  const M = {
    staff: [
      { StaffID: 'T1', NameTH: 'ก้อย', Nickname: 'ก้อย', Role: 'Teacher', Status: 'ACTIVE' },
      { StaffID: 'T2', NameTH: 'เติ้ล', Nickname: 'เติ้ล', Role: 'Teacher', Status: 'ACTIVE', NoPayroll: 'YES' },
      { StaffID: 'T3', NameTH: 'ลินน์', Nickname: 'ลินน์', Role: 'Teacher', Status: 'INACTIVE', EndDate: '2026-06-30' },
      { StaffID: 'T4', NameTH: 'ฟาง', Nickname: 'ฟาง', Role: 'Teacher', Status: 'INACTIVE', EndDate: '2026-09-15' },
      { StaffID: 'T5', NameTH: 'แพรว', Nickname: 'แพรว', Role: 'Teacher', Status: 'ACTIVE' }
    ],
    payroll: [
      { PayrollID: 'P1', StaffID: 'T1', Month: '2026-09', NetPay: 14500, Contribution: 0 },
      // ฟาง left on the 15th and WAS paid for the days she worked
      { PayrollID: 'P2', StaffID: 'T4', Month: '2026-09', NetPay: 7000, Contribution: 0 }
    ],
    students: [], parents: [], activityLog: [], userLinks: [], bills: [], charges: [], otDaily: [], paymentSlips: [], config: {}
  };
  const f = createAtomAPI(M).H.financeSummary({ month: '2026-09' });
  const on = f.staff.map(s => s.nick);

  eq('🔴 somebody marked "ไม่อยู่ในระบบเงินเดือน" is off the card', on.indexOf('เติ้ล') >= 0, false);
  eq('a teacher who left in June, with nothing saved for September, is off it too', on.indexOf('ลินน์') >= 0, false);
  eq('a working teacher with no slip yet stays — that is the ยังไม่สรุป the card is for', on.indexOf('แพรว') >= 0, true);
  eq('...and one with a slip stays', on.indexOf('ก้อย') >= 0, true);
  /* THE CONTROL, and the reason this filter is not one line. */
  eq('🔴 CONTROL — a leaver PAID this month is still listed', on.indexOf('ฟาง') >= 0, true);
  eq('🔴 CONTROL — and her salary is still in the school’s expense total', f.expense, 21500);
  // ก้อย + ฟาง are done, แพรว is the one still to run. เติ้ล and ลินน์ are not in the denominator at
  // all any more — which is the whole point: "4/12" was counting two people nobody would ever run.
  eq('the counter is measured against people who can actually be run', f.staffPaid + '/' + f.staffTotal, '2/3');

  ok_('the card and the payroll selector read the same helper, so they cannot drift',
    /_keep: !!pr \|\| \(!noPayroll_\(s\) && !staffEnded_\(s\)\)/.test(engCode));
}

// ============================================================================================
console.log('1c) the ผอ. is paid, and deliberately NOT in รายจ่ายรวม');
// ============================================================================================
{
  /* THE ONE THAT LOOKS LIKE A BUG AND IS A DECISION.
   *
   * financeSummary filters this card on Role==='Teacher', so the director's own salary is neither
   * listed nor counted in salaryExpense — the pink "รายจ่ายรวม" tile. Meanwhile payableStaff KEEPS
   * her, because she is an Admin who is paid and the payroll screen must be able to produce her
   * slip (§1). Read from the code alone that pair reads as an inconsistency, and the obvious "fix"
   * is to widen the filter.
   *
   * Put to the school on 2026-09-29: "ถูกแล้ว — อย่านับรวม คงไว้แบบนี้". The director's pay is
   * accounted for apart from the nursery's operating costs.
   *
   * This test exists so that widening it FAILS LOUDLY rather than moving a figure the school reads
   * every month. If the school changes its mind, change this test first — deliberately, with the
   * new answer written into it. */
  const M = {
    staff: [
      { StaffID: 'T1', NameTH: 'ก้อย', Nickname: 'ก้อย', Role: 'Teacher', Status: 'ACTIVE' },
      { StaffID: 'DIR', NameTH: 'ศิลา เส็งพานิช', Nickname: 'ต้อม', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE' }
    ],
    payroll: [
      { PayrollID: 'P1', StaffID: 'T1', Month: '2026-09', NetPay: 14500, Contribution: 0 },
      // her payslip HAS been run — payableStaff offers her, so this is a state the school reaches
      { PayrollID: 'P2', StaffID: 'DIR', Month: '2026-09', NetPay: 30000, Contribution: 0 }
    ],
    students: [], parents: [], activityLog: [], userLinks: [], bills: [], charges: [], otDaily: [], paymentSlips: [], config: {}
  };
  const f = createAtomAPI(M).H.financeSummary({ month: '2026-09' });
  eq('the ผอ. is not on the เงินเดือนคุณครู card', f.staff.map(s => s.nick).indexOf('ต้อม') >= 0, false);
  eq('🔴 ...and her salary is deliberately not in รายจ่ายรวม (school’s decision 2026-09-29)', f.expense, 14500);
  ok_('...and the reason is written next to the filter, not left to be guessed',
    /Role==='Teacher'` IS A DECISION[\s\S]{0,1400}อย่านับรวม คงไว้แบบนี้/.test(engine));
  // ...while the payroll screen still offers her, which is the half that IS a bug if it breaks
  const m = /const payableStaff = (list => [^;]+);/.exec(appCode);
  const payable = m ? eval('(' + m[1] + ')') : (() => []);
  eq('CONTROL — the payroll screen still offers her, so the slip can be produced',
    payable([{ StaffID: 'DIR', Role: 'Admin', ended: false, noPayroll: false }]).length, 1);
}

// ============================================================================================
console.log('2) nobody is selected when the screen opens');
// ============================================================================================
{
  ok_('the staff <select> starts on a blank option',
    /<select id="pStaff"[^>]*>\s*<option value="">/.test(appCode));
  ok_('...and the screen no longer calls A_payStaff() on open',
    !/<div id="slipResult"><\/div>`;\s*A_payStaff\(\);/.test(appCode));
  ok_('the form is hidden until somebody is chosen', /<div id="payForm" hidden>/.test(appCode));
  ok_('...and an empty state says what to do', /<div id="payEmpty">/.test(appCode));
  ok_('picking the blank option back hides the form again',
    /if\(!sid\)\{ payFormReset\(\);[^\n]*form\.hidden=true/.test(appCode));
  /* CSS is not a guard. The form being hidden stops the accident; this stops the bug — an empty
   * staffId reaching computePayroll would compute against whatever the server resolves. */
  ok_('🔴 and saving refuses outright with no staff chosen',
    /A_calc=async\(commit\)=>\{[\s\S]{0,400}if\(!\$\('#pStaff'\)\.value\)\{[\s\S]{0,120}return;/.test(appCode));
}

// ============================================================================================
console.log('3) the stale form — measured, field by field');
// ============================================================================================
{
  /* A tiny DOM: enough for payFormReset to be run for real rather than grepped for. Every input the
   * payroll form carries is here with the PREVIOUS teacher's value already in it. */
  const FIELDS = ['pBase', 'pType', 'pDaily', 'pDays', 'pChild', 'pCert', 'pOt', 'pOtHol', 'pHb', 'pContrib'];
  const TICKS = ['pSS', 'pAtt', 'pFb'];
  const BOXES = ['otNote', 'otHolNote', 'otCarryBox', 'pLeaveWarn', 'childCalc', 'contribNote', 'slipResult', 'adjList'];

  function stage(prev) {
    const el = {};
    FIELDS.forEach(id => el[id] = { value: prev[id] });
    TICKS.forEach(id => el[id] = { checked: prev[id] });
    BOXES.forEach(id => el[id] = { innerHTML: prev[id] || 'ค้างจากคนก่อน' });
    el.pMonthlyBox = { hidden: false }; el.pDailyBox = { hidden: true };
    return el;
  }

  /* The reset, lifted out of app.js and run against that DOM. Extracting it (rather than re-typing
   * it here) is the point: a field ADDED to the form later and forgotten in the reset shows up as a
   * stale value below, which is exactly the bug this is about. */
  const src = /function payFormReset\(\)\{[\s\S]*?\n  \}/.exec(app);
  ok_('payFormReset is defined', !!src);

  const prev = { pBase: 13500, pType: 'daily', pDaily: 450, pDays: 22, pChild: 4, pCert: 2,
                 pOt: 1800, pOtHol: 500, pHb: 300, pContrib: 200, pSS: true, pAtt: false, pFb: true };
  const el = stage(prev);
  let PAY_ADJ = [{ label: 'หักค่าเสียหาย', amount: -2000 }];
  const sandbox = {
    $: sel => el[String(sel).replace('#', '')] || null,
    setHTML: (sel, html) => { const e = el[String(sel).replace('#', '')]; if (e) e.innerHTML = html; },
    A_otDaysRender: () => {}, A_payTypeToggle: () => {}, window: {}
  };
  /* PAY_ADJ is a closure variable in app.js, and A_renderAdj reads it — so both live INSIDE the
   * generated function, exactly as they do in the real file. Handing in a renderer that closed over
   * a different array would have tested nothing. */
  const run = new Function('$', 'setHTML', 'A_otDaysRender', 'A_payTypeToggle', 'window', 'getAdj', 'setAdj',
    'let PAY_ADJ = getAdj();' +
    'function A_renderAdj(){ $("#adjList").innerHTML = PAY_ADJ.map(a=>a.label).join(""); }' +
    src[0] + '\n payFormReset(); setAdj(PAY_ADJ);');
  run(sandbox.$, sandbox.setHTML, sandbox.A_otDaysRender, sandbox.A_payTypeToggle,
      sandbox.window, () => PAY_ADJ, v => { PAY_ADJ = v; });

  eq('ฐานเงินเดือน is cleared', Number(el.pBase.value), 0);
  eq('รูปแบบจ่าย goes back to รายเดือน', el.pType.value, 'monthly');
  eq('ค่าจ้างรายวัน is cleared', Number(el.pDaily.value), 0);
  eq('วันทำงาน is cleared', Number(el.pDays.value), 0);
  eq('จำนวนเด็ก is cleared', Number(el.pChild.value), 0);
  eq('ใบประกาศอบรม is cleared', Number(el.pCert.value), 0);
  eq('OT ตอนเย็น is cleared', Number(el.pOt.value), 0);
  eq('OT วันหยุด is cleared', Number(el.pOtHol.value), 0);
  eq('เงินพิเศษวันพักผ่อน is cleared', Number(el.pHb.value), 0);
  eq('เงินสมทบ is cleared', Number(el.pContrib.value), 0);
  eq('ประกันสังคม goes back to unticked', el.pSS.checked, false);
  eq('เบี้ยขยัน (มาครบ) goes back to its default tick', el.pAtt.checked, true);
  eq('เบี้ยขยัน (Facebook) goes back to unticked', el.pFb.checked, false);
  /* 🔴 THE ONE THAT COST MONEY. PAY_ADJ was only emptied inside the `if (saved)` branch, so a
   * deduction typed for teacher A survived the switch to teacher B, was sent by A_calc, and was
   * written onto B's payslip by computePayroll. */
  eq('🔴 รายการเพิ่ม/หักพิเศษ are emptied', PAY_ADJ.length, 0);
  eq('...and the list on screen with them', el.adjList.innerHTML, '');
  ok_('the OT notes do not carry over',
    el.otNote.innerHTML === '' && el.otHolNote.innerHTML === '' && el.otCarryBox.innerHTML === '');
  ok_('nor the ลาเกินเกณฑ์ warning, the child working, or the saved slip',
    el.pLeaveWarn.innerHTML === '' && el.childCalc.innerHTML === '' && el.slipResult.innerHTML === '');

  // CONTROL: the reset must be the FIRST thing, not the only thing — switching to somebody who HAS
  // a saved payslip must still show it. A screen that cleared and then stopped would pass every
  // assertion above while showing nothing at all.
  ok_('CONTROL — the reset runs before the fetches, not instead of them',
    /payFormReset\(\);\s*\n\s*const stale=/.test(appCode));
  ok_('CONTROL — a saved payslip is still loaded back into the form afterwards',
    /const saved=await p_slip;[\s\S]{0,200}if\(saved\)\{[\s\S]{0,400}set\('#pBase',saved\.BaseSalary\)/.test(appCode));
}

// ============================================================================================
console.log('4) the month behind the money');
// ============================================================================================
{
  ok_('the attendance month is fetched with the rest, not in a tick of its own',
    /const p_att = \(window\._PAYATT/.test(appCode));
  ok_('...and cached per MONTH, so stepping through staff costs nothing',
    /window\._PAYATT && window\._PAYATT\.month===mth/.test(appCode));
  ok_('a fresh screen starts with an empty cache', /window\._PAYATT=null;/.test(appCode));
  /* 🔴 CAUGHT IN THE BROWSER, NOT BY READING. applyIdentity_ returns an ADMIN's payload untouched —
   * that is what makes "view as" work — so an admin's own staffId is never stamped for them, and
   * staffAttendanceMonth's first line refuses a caller it cannot recognise as an admin. Without this
   * the card read "อ่านข้อมูลไม่สำเร็จ" on every payroll screen. It does not narrow the reply. */
  ok_('🔴 ...and identifies the caller, or the route refuses an admin its own answer',
    /api\('staffAttendanceMonth',\{month:mth,staffId:USER\.staffId\}\)/.test(appCode));
  ok_('the monthly attendance screen has always passed it — same rule, one shape',
    /api\('staffAttendanceMonth',\{month:SM_MONTH[^}]*staffId:USER\.staffId\}\)/.test(appCode));
  /* ...and the two answers a failure can have are not the same sentence */
  ok_('a failed fetch is not reported as "this person does not clock in"',
    /if\(!d\)\{[\s\S]{0,300}อ่านข้อมูลการมาทำงานของเดือนนี้ไม่สำเร็จ/.test(app));

  const r = /window\.A_payAttRender=\(d, sid, mth\)=>\{[\s\S]*?\n  \};/.exec(app);
  ok_('A_payAttRender is defined', !!r);
  const render = r ? r[0] : '';
  ['absent', 'leaveDays', 'lateDays', 'missingOut', 'present', 'myRequiredToDate'].forEach(k =>
    ok_('it reports ' + k, render.indexOf('me.' + k) >= 0));
  /* EVERY FIGURE CARRIES ITS DATES — asked for explicitly ("ตัวเลขสรุป + วันที่ระบุได้"). A count
   * on its own is a number to be trusted; a count with its dates is one that can be checked. */
  ok_('🔴 ขาด lists the days it is made of', /cell\('⛔'[\s\S]{0,80}?_dlist\(absentDays\)/.test(render));
  ok_('🔴 ลา lists the days it is made of', /cell\('🏖️'[\s\S]{0,80}?_dlist\(leaveDays\)/.test(render));
  ok_('🔴 สาย lists its days and its minutes', /lateMinutes[\s\S]{0,80}_dlist\(lateDays\.map/.test(render));
  ok_('ลืมออกงาน lists its days too', /_dlist\(me\.missingOutDays\)/.test(render));

  // OT: hours, which days, and the clock times — "เวลาเท่าไหร่ - เท่าไหร่"
  ok_('OT is listed day by day', /me\.otDays/.test(render));
  ok_('🔴 ...with the window it was worked in', /r\.planEnd&&r\.out\)\?`\$\{esc\(r\.planEnd\)\}–\$\{esc\(r\.out\)\}`/.test(render));
  ok_('...a holiday OT says so instead of printing a fake window', /r\.kind==='HOLIDAY'/.test(render));
  ok_('...and a rejected OT is not counted in', /filter\(x=>x\.status!=='REJECTED'\)/.test(render));
  /* THIS SCREEN REPORTS; IT DOES NOT DECIDE. Auto-unticking เบี้ยขยัน from a summary is how somebody
   * loses ฿1,000 because one morning's check-in failed to save. */
  ok_('🔴 it changes nothing on the form, and says so',
    /ไม่ไปเปลี่ยนค่าใดๆ ในฟอร์ม/.test(render) && !/\$\('#pAtt'\)\.checked=/.test(render));

  // the server side of the clock times
  ok_('the engine puts the clock times on each OT day',
    /_otRows\.forEach\(r=>\{ r\.in=inT; r\.out=outT; r\.planEnd=_pe; \}\)/.test(engCode));
  ok_('...and the shift end comes from THAT day, not from today',
    /staffHoursOn_\(s\.StaffID, ds\)\.checkOut/.test(engCode));

  /* AND IT REALLY ARRIVES, through the route the screen calls. The caller is the ADMIN (which is
   * what applyIdentity_ stamps on live), and the teacher whose evening we are reading is somebody
   * else — the same shape as the real request. */
  const M = {
    staff: [{ StaffID: 'STF-AD', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', StartDate: '2020-01-01' },
            { StaffID: 'STF-01', NameTH: 'ครูเอ', Nickname: 'เอ', Role: 'Teacher', StaffGroup: 'G1', Status: 'ACTIVE', StartDate: '2020-01-01' }],
    staffGroups: [{ GroupName: 'G1', CheckInTime: '07:00', CheckOutTime: '17:00' }],
    staffAttendanceHistory: [{ Date: '2026-09-14', StaffID: 'STF-01', In: '07:00', Out: '19:05', Late: 0 }],
    staffAttendanceToday: [], otRecords: [{ OTRecordID: 'OT-1', StaffID: 'STF-01', Date: '2026-09-14', Hours: 2, Amount: 200, Status: 'APPROVED' }],
    leaves: [], holidays: [], students: [], parents: [], activityLog: [], userLinks: [], workSchedule: [],
    config: { Timezone: 'Asia/Bangkok' }
  };
  const got = createAtomAPI(M).H.staffAttendanceMonth({ staffId: 'STF-AD', month: '2026-09' });
  const me = (got.staff || []).find(s => s.staffId === 'STF-01') || {};
  const day = (me.otDays || [])[0] || {};
  eq('the OT day carries the clock-out', day.out, '19:05');
  eq('...and the end of that day’s shift, which is where the OT starts', day.planEnd, '17:00');
  eq('...and its hours are unchanged', day.hours, 2);
  eq('...and the total it belongs to is unchanged too', me.otHours, 2);
}

// ============================================================================================
console.log('5) 🔴 the slip said the wrong month');
// ============================================================================================
{
  /* A Month cell holding '2026-09' is coerced by Sheets to a Date at 00:00 Bangkok, and JSON writes
   * a Date in UTC — "2026-08-31T17:00:00.000Z". Every comparison in Payroll.gs already ran ym7_ over
   * it, which is why the right ROW came back every time; the only value nobody normalised was the
   * one printed at the top of a document about somebody's pay. */
  ok_('🔴 the route hands the month back as YYYY-MM', /row\.Month = ym7_\(row\.Month\);\s*\n\s*return row;/.test(payCode));
  ok_('the engine mirrors it, so mock and live agree', /Month:ym\(r\.Month\)/.test(engCode));

  /* THE COERCION ONLY HAPPENS IN SHEETS, so the measurement has to be of ym7_ — the engine's mock
   * store holds the string computePayroll wrote and never sees a Date. ym7_ is lifted out of
   * Payroll.gs and run against the Apps Script globals it uses; a Date at 00:00 Bangkok is exactly
   * what `readObjects_` hands back for a cell holding '2026-09'. */
  const ym7src = /function ym7_\(v\) \{[\s\S]*?\n\}/.exec(payGs);
  ok_('ym7_ is defined', !!ym7src);
  const ym7 = new Function('Utilities', 'Session', ym7src[0] + '\n return ym7_;')(
    { formatDate: (d, tz, f) => {                       // the only format this code ever asks for
        const s = new Date(d.getTime() + (7 * 60 - -d.getTimezoneOffset()) * 0);   // fixture runs in +07
        return s.getFullYear() + '-' + String(s.getMonth() + 1).padStart(2, '0'); } },
    { getScriptTimeZone: () => 'Asia/Bangkok' });
  eq('a plain string month is untouched', ym7('2026-09'), '2026-09');
  eq('🔴 a coerced Date cell reads back as its own month', ym7(new Date(2026, 8, 1)), '2026-09');

  // ...and the engine agrees for the mock store, where Month is always already a string
  const M = {
    staff: [{ StaffID: 'STF-01', NameTH: 'ครูเอ', Status: 'ACTIVE' }],
    payroll: [{ PayrollID: 'PR-1', StaffID: 'STF-01', Month: '2026-09', BaseSalary: 13500, NetPay: 13500, Contribution: 0 }],
    students: [], parents: [], activityLog: [], userLinks: [], config: {}
  };
  eq('a September slip comes back saying September',
    createAtomAPI(M).H.getPayslip({ staffId: 'STF-01', month: '2026-09' }).Month, '2026-09');

  /* ...and the client function that prints it. The regex used to match the first seven characters of
   * ANY string, including a UTC datetime, so the `else` branch — which would have been right all
   * along, because new Date().getMonth() is local — was never reached. */
  const m = /function monthNameYear\(v\)\{[\s\S]*?\n(?=  \/\*|  function|  const|  window)/.exec(app);
  ok_('monthNameYear is defined', !!m);
  const mny = new Function('EN', 'EN_MONTHS', 'TH_MONTHS', m[0] + '\n return monthNameYear;')(
    () => true,
    ['January','February','March','April','May','June','July','August','September','October','November','December'],
    ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']);
  eq('a plain YYYY-MM is unchanged', mny('2026-09'), 'September 2026');
  eq('...and a plain date too', mny('2026-09-15'), 'September 2026');
  /* This is the value the screenshots were made of. It only reads correctly in a timezone ahead of
   * UTC — which is where the school is, and where the bug was. */
  const shifted = new Date(2026, 8, 1).toISOString();
  eq('🔴 a UTC datetime is read in local time, not sliced', mny(shifted), 'September 2026');
  eq('rubbish is handed back untouched rather than printed as NaN', mny('ไม่มีเดือน'), 'ไม่มีเดือน');
}

// ============================================================================================
console.log('6) "ไม่อยู่ในระบบเงินเดือน" — a flag of its own');
// ============================================================================================
{
  /* Asked for คุณเติ้ล, a private housekeeper. Status INACTIVE would have said "no longer employed"
   * (locking her out of the app and filing her under leavers) and Observer would have said "may read
   * the whole school". The true statement is narrower than either. */
  ok_('the engine has one place that reads the flag', /function noPayroll_\(staff\)/.test(engCode));
  ok_('...and it accepts YES / true / 1, because a cell arrives as any of them',
    /noPayroll_\(staff\)\{[\s\S]{0,200}'YES','TRUE','1'/.test(engCode));
  ok_('listStaff answers it, so no screen re-derives it', /noPayroll: noPayroll_\(s\)/.test(engCode));
  ok_('the column is created on save, or the write is dropped in silence',
    /function handleSaveStaff[\s\S]{0,1200}?ensureColumns_\(sh, \[[\s\S]*?'NoPayroll'[\s\S]*?\]\)/.test(staffGs));
  ok_('the staff form offers the tick', /id="sf_NoPayroll"/.test(appCode));
  ok_('...and saves it', /NoPayroll:noPay\?'YES':''/.test(appCode));
  /* It must stay NARROW. The whole reason for a new flag instead of reusing Status is that this
   * person still works here — so nothing but payroll may read it. */
  const readers = (engCode.match(/noPayroll_\(/g) || []).length + (appCode.match(/noPayroll/g) || []).length;
  ok_('it is read in a handful of places, not sprinkled through the app', readers <= 8);
  /* CLOCKING IN DOES NOT READ IT. คุณเติ้ล still comes in every morning and the daily summary should
   * still know she is here — the flag is about who the school PAYS, and widening it to attendance is
   * how "hide her from payroll" would quietly turn into "she stopped existing". */
  const rc = /function requiresCheckin_\(s\)\{[\s\S]*?\n  \}/.exec(engine);
  ok_('requiresCheckin_ is defined', !!rc);
  ok_('nothing about clocking in reads it', !!rc && rc[0].indexOf('NoPayroll') < 0 && rc[0].indexOf('noPayroll') < 0);

  const M = {
    staff: [{ StaffID: 'STF-01', NameTH: 'ครูเอ', Status: 'ACTIVE' },
            { StaffID: 'STF-09', NameTH: 'เติ้ล', Status: 'ACTIVE', NoPayroll: 'YES' }],
    students: [], parents: [], activityLog: [], userLinks: [], config: {}
  };
  const list = createAtomAPI(M).H.listStaff();
  eq('a normal teacher is not flagged', list.find(s => s.StaffID === 'STF-01').noPayroll, false);
  eq('the housekeeper is', list.find(s => s.StaffID === 'STF-09').noPayroll, true);
  eq('...and is still ACTIVE staff, not a leaver', list.find(s => s.StaffID === 'STF-09').ended, false);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
