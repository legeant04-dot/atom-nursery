/**
 * tools/test_ot_waiver.js — งดคำนวณ OT: days the school chooses not to charge late pick-up.
 *   node tools/test_ot_waiver.js
 *
 * Asked 2026-09-25: "วันที่ 25/09/26 ฝนตกหนักมาก โรงเรียนอยากช่วยเหลือผู้ปกครองโดยวันนี้เว้นการคิด OT
 * ของทุกชั้นเรียน ... เมื่อข้ามวันเป็นวันที่ 26/09/26 ระบบจะกลับมาเป็นปกติ".
 *
 * THIS DECIDES MONEY, so it gets its own suite. A day on the list is a day of late-pickup charges
 * the school does not collect, and every way of getting it wrong costs somebody something:
 *
 *   · waiving one day too many  → the school loses a day of OT it meant to charge
 *   · waiving one day too few   → a family is billed on the day the school told them it would not
 *   · forgetting to turn it off → every rainy-day waiver becomes permanent, silently
 *
 * The last one is why this is a DATE RANGE and not a switch, and why §2 spends its time on the
 * boundary rather than on the middle.
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
const app = R('webapp/app.js'), engine = R('webapp/engine.js'), otgs = R('src/OT.gs'), codeGs = R('src/Code.gs');
const appCode = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const RAIN = '2026-09-25', NEXT = '2026-09-26', BEFORE = '2026-09-24';

function school(waive) {
  const M = {
    students: [
      { StudentID: 'S1', NameTH: 'เด็กหญิงเอ', Nickname: 'เอ', Class: 'Nursery 1', Status: 'ACTIVE', EndTime: '17:00' },
      { StudentID: 'S2', NameTH: 'เด็กชายบี', Nickname: 'บี', Class: 'Nursery 3', Status: 'ACTIVE', EndTime: '17:00' }
    ],
    otDaily: [], checkinStudent: [], studentCheckins: [], studentAttendanceToday: [], studentLeaves: [], holidays: [], staff: [], parents: [], activityLog: [], userLinks: [],
    config: { OTRatePerHour: 100, OTGraceMinutes: 21, OTWaiveDays: waive || [] }
  };
  return { M, H: createAtomAPI(M).H };
}

// ============================================================================================
console.log('1) a waived day charges nothing — to every class at once');
// ============================================================================================
{
  /* DRIVEN THROUGH THE REAL ROUTE, not by calling the calculation. editStudentAttendance is the path
   * an admin's pick-up correction takes, and it is what writes the OT row — so this measures the
   * baht that would actually appear on a family's bill. A suite that asserted otFor() returned zero
   * would pass while the row still said 200. */
  const chargeFor = (waive, date, out) => {
    const { M, H } = school(waive);
    H.editStudentAttendance({ role: 'Admin', studentId: 'S1', date, checkIn: '08:00', checkOut: out, remark: 'test' });
    const row = M.otDaily.find(r => String(r.StudentID) === 'S1' && String(r.Date || '').slice(0, 10) === date);
    return { amount: row ? Number(row.Amount || 0) : 0, row };
  };

  // THE CONTROL FIRST — without it, a zero below proves nothing
  const normal = chargeFor([], RAIN, '18:30');
  eq('an hour and a half late, no waiver → a real charge', normal.amount, 200);

  const waived = chargeFor([{ from: RAIN, to: RAIN, reason: 'ฝนตกหนัก' }], RAIN, '18:30');
  eq('the same pick-up on a waived day → nothing owed', waived.amount, 0);

  // EVERY CLASS, not just one — "เว้นการคิด OT ของทุกชั้นเรียน"
  {
    const { M, H } = school([{ from: RAIN, to: RAIN, reason: 'ฝนตกหนัก' }]);
    H.editStudentAttendance({ role: 'Admin', studentId: 'S1', date: RAIN, checkIn: '08:00', checkOut: '18:30', remark: 't' });
    H.editStudentAttendance({ role: 'Admin', studentId: 'S2', date: RAIN, checkIn: '08:00', checkOut: '19:10', remark: 't' });
    eq('...for Nursery 1 and Nursery 3 alike',
       M.otDaily.filter(r => Number(r.Amount || 0) > 0).length, 0);
  }

  // AND THE NEXT MORNING IT IS BACK, with nobody touching anything
  const after = chargeFor([{ from: RAIN, to: RAIN, reason: 'ฝนตกหนัก' }], NEXT, '18:30');
  eq('the day after the waiver charges normally again', after.amount, 200);
  const before = chargeFor([{ from: RAIN, to: RAIN, reason: 'ฝนตกหนัก' }], BEFORE, '18:30');
  eq('...and so does the day before it', before.amount, 200);

  const w = school([{ from: RAIN, to: RAIN, reason: 'ฝนตกหนัก' }]).H.otWaiveDays();
  eq('the waived day is listed', w.days.map(d => d.from + '→' + d.to), [RAIN + '→' + RAIN]);
  eq('...with the reason the school gave', w.days[0].reason, 'ฝนตกหนัก');
}

// ============================================================================================
console.log('\n2) the boundary — which is the whole point of a range');
// ============================================================================================
{
  const { H } = school([{ from: RAIN, to: RAIN, reason: 'ฝนตกหนัก' }]);
  /* A ONE-DAY WAIVER IS from === to. The school was explicit: "หากวันเดียวให้ใส่วันเดียวกันทั้ง 2
   * ช่อง". Both ends inclusive, or a one-day waiver would waive nothing at all. */
  const saved = H.saveOtWaiveDays({ days: [{ from: RAIN, to: RAIN, reason: 'ฝนตกหนัก' }] });
  eq('the day itself is waived', !!saved.days.length, true);

  const covers = d => {
    const { H: h } = school([{ from: RAIN, to: RAIN }]);
    const list = h.otWaiveDays().days;
    return list.some(w => d >= w.from && d <= w.to);
  };
  eq('the day before is NOT waived', covers(BEFORE), false);
  eq('the day itself IS', covers(RAIN), true);
  /* "เมื่อข้ามวันเป็นวันที่ 26/09/26 ระบบจะกลับมาเป็นปกติ" — nobody turns anything back on. */
  eq('the day after is NOT — the school is back to normal by itself', covers(NEXT), false);

  // a multi-day range is inclusive at BOTH ends
  const { H: h2 } = school([{ from: '2026-10-01', to: '2026-10-03' }]);
  const days = h2.otWaiveDays().days[0];
  const inRange = d => d >= days.from && d <= days.to;
  eq('a three-day range covers all three, and only those',
     ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map(inRange),
     [false, true, true, true, false]);
}

// ============================================================================================
console.log('\n3) what the save route will and will not accept');
// ============================================================================================
{
  const { H } = school();
  /* A RANGE WHOSE END IS BEFORE ITS START waives nothing and looks like it worked — the worst kind
   * of failure for a setting nobody checks again until a parent complains. */
  let code = '';
  try { H.saveOtWaiveDays({ days: [{ from: NEXT, to: RAIN }] }); } catch (e) { code = e.code; }
  eq('a backwards range is refused, and says so', code, 'BAD_RANGE');

  code = '';
  try { H.saveOtWaiveDays({ days: [{ from: '', to: '' }] }); } catch (e) { code = e.code; }
  eq('a blank date is refused', code, 'BAD_INPUT');

  // ONE DAY: the end may be omitted and is filled in from the start, because typing the same date
  // twice is a step whose only purpose is to be forgotten
  const one = H.saveOtWaiveDays({ days: [{ from: RAIN }] });
  eq('a single date fills its own end', [one.days[0].from, one.days[0].to], [RAIN, RAIN]);

  const many = H.saveOtWaiveDays({ days: [{ from: '2026-01-05', to: '2026-01-05' }, { from: RAIN, to: RAIN }] });
  eq('the list comes back newest first, which is the order it is read in',
     many.days.map(d => d.from), [RAIN, '2026-01-05']);
  eq('...and the whole list is replaced, not appended to', many.days.length, 2);

  // the screen needs to be able to say, plainly, whether OT is being charged right now
  const st = H.otWaiveDays();
  ok_('the route answers "is it waived today"', 'active' in st && 'today' in st);
}

// ============================================================================================
console.log('\n4) a late pick-up is still RECORDED — only the money is waived');
// ============================================================================================
{
  /* THE DISTINCTION THAT MATTERS. A waiver is a decision about a charge, not about the register: the
   * child WAS collected late, the teacher waited, and erasing that would erase the school's own
   * record of its afternoon. Only `amount` goes to zero. */
  ok_('the engine keeps the late minutes and zeroes only the amount',
    /if\(w\) return \{late, hours:0, amount:0, planEnd, rate:otRateFor\(student\), waived:true/.test(engine));
  ok_('...and so does the live route', /if \(w\) return \{ late: late, hours: 0, amount: 0/.test(otgs));
  ok_('the comment says why, in both', /register should say/.test(engine) && /register should say/.test(otgs));

  /* AND A CANCELLED CHARGE SAYS WHY. A parent who was late and is not billed will ask, and an
   * auditor looking at a zeroed row a year later must see a school decision rather than a bug. */
  ok_('a waived charge is attributed to the waiver, not to a corrected time',
    /CancelledBy=o\.waived\?'AUTO_WAIVE':'AUTO_TIME'/.test(engine.replace(/\s/g, '')) &&
    /CancelledBy:c\.waived\?'AUTO_WAIVE':OT_CANCEL_AUTO_/.test(otgs.replace(/\s/g, '')));
  ok_('...and the note names the day and the reason',
    /งดคำนวณ OT ประจำวันที่/.test(engine) && /งดคำนวณ OT ประจำวันที่/.test(otgs));
}

// ============================================================================================
console.log('\n5) the date reaches the calculation — every path');
// ============================================================================================
{
  /* A WAIVER THAT THE CALCULATION NEVER HEARS ABOUT IS A SETTING THAT DOES NOTHING. Both copies of
   * otFor/otComputeFor_ take the date, and every caller has to pass it: the reconcile that runs on a
   * pick-up, and the admin correction made days later, which must still be judged against the day it
   * happened rather than against today. */
  ok_('the engine calculation takes a date', /function otFor\(student, pickupHHMM, date\)/.test(engine));
  ok_('...and the live one', /function otComputeFor_\(student, pickupHHMM, dateS\)/.test(otgs));

  ok_('the pick-up reconcile passes the day it happened', /otFor\(student,pickupHHMM,d\)/.test(engine.replace(/\s/g, '')));
  ok_('...and the live upsert', /otComputeFor_\(student, pickupHHMM, dateS\)/.test(otgs));
  ok_('an admin correction is judged against the ROW’s date, not today',
    /otFor\(s,p\.pickupTime,o\.Date\|\|''\)/.test(engine.replace(/\s/g, '')) &&
    /otComputeFor_\(student, p\.pickupTime, ymdStr_\(r\.o\.Date\)\)/.test(otgs));

  /* A CELL VALUE IS FORMATTED IN THE SPREADSHEET'S TIMEZONE, not the config one — the v251 bug, and
   * here it would land a waiver on the wrong day. tools/test_one_rule.js refuses the other spelling
   * and caught exactly this while it was being written. */
  ok_('the row date is read in the spreadsheet’s timezone', /typeof ssTz_ === 'function'\) \? ssTz_\(\)/.test(otgs));

  /* THE CACHED OT READS HAVE TO GO when the list changes, or the admin saves a waiver and still
   * sees the charges it was meant to suppress. */
  ok_('saving the list drops the cached OT reads', /otBust_\(\);[\s\S]{0,200}logAudit\(p\.adminId \|\| 'admin', 'OT_WAIVE'/.test(otgs));
  ok_('...and writes an audit line naming the days', /'OT_WAIVE', 'SCHOOL_CONFIG'/.test(otgs));
}

// ============================================================================================
console.log('\n6) the screen, and who may open it');
// ============================================================================================
{
  ok_('it sits beside the OT list it acts on, in ดำเนินการ → นักเรียน',
    /A_studentOT\(\)'\][\s\S]{0,200}A_otWaive\(\)'\]/.test(app));
  /* DECIDING NOT TO COLLECT A DAY OF CHARGES IS A MONEY DECISION — the school's, not a teacher's. */
  ok_('both routes are admin-only', /otWaiveDays: 1, saveOtWaiveDays: 1,/.test(codeGs));
  ok_('the screen says plainly whether OT is being charged today',
    /วันนี้ <u>ไม่คิด<\/u> OT/.test(app) && /วันนี้คิด OT ตามปกติ/.test(app));
  /* PICKING A START FILLS IN THE END. One day is the common case, and an end left blank or
   * accidentally earlier is the difference between waiving a day and waiving nothing. */
  ok_('choosing a start date fills the end in', /window\.A_otwSync/.test(appCode) &&
    /!t2\.value \|\| t2\.value < f\.value/.test(appCode));
  ok_('...and the form refuses a backwards range before it is sent', /วันสิ้นสุดอยู่ก่อนวันเริ่มต้น/.test(app));
  ok_('removing a day asks first — it puts charges back', /กลับมาคิด OT ในวันเหล่านี้ตามปกติ/.test(app));
  ok_('the screen says the late pick-up is still recorded',
    /งดเฉพาะการคิดเงิน/.test(app) && /กลับมาคิดเองอัตโนมัติ/.test(app));

  /* ---- ON THE CALENDAR, 2026-09-25 -----------------------------------------------------------
   * "เพิ่มข้อมูลบันทึกใน ... ปฏิทินของนักเรียน > งด OT วันไหนเพื่อการตรวจสอบ". A waiver is a decision
   * NOT to collect money, and a list inside its own modal is not somewhere anyone looks back at. On
   * the calendar it sits beside the day it applies to, next to the absences and the holidays, which
   * is where "what happened on the 25th" is actually asked. */
  ok_('the waived days are marked on the student calendar', /otwByDay\[dd\]/.test(appCode));
  ok_('...the list is fetched with the rest of that screen', /api\('otWaiveDays'\)\.catch/.test(appCode));
  ok_('...and an older deployment without the route still draws the calendar',
    /window\._OTW=\(await api\('otWaiveDays'\)\.catch\(\(\)=>null\)\) \|\| window\._OTW \|\| \{days:\[\]\}/.test(appCode));
  ok_('...the reason is on the day, not only in the settings screen',
    /title="\$\{esc\(\(EN\(\)\?'No OT charged':'งดคำนวณ OT'\)/.test(app));
  ok_('...and the legend says what the marker means',
    /🌧️ งดคำนวณ OT/.test(app) && /🌧️ no OT charged/.test(app));
  /* Dates are compared as STRINGS. The ranges are stored 'YYYY-MM-DD', and text comparison has no
   * timezone in it to get wrong — which is the same trap ymdStr_ fell into on the server. */
  ok_('...matched as text, so no timezone can shift the marker a day',
    /if\(ds>=w\.from && ds<=w\.to\) otwByDay\[dd\]=w;/.test(appCode));
  ok_('saving or removing a waiver redraws the calendar under it',
    (appCode.match(/window\._OTW=OTW; CAL_redraw\(\);/g) || []).length === 2);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
