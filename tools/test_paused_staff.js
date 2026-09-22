/**
 * tools/test_paused_staff.js — the third way of not being at work, and who clocks in at all.
 *   node tools/test_paused_staff.js
 *
 * Reported 2026-09-22, with a screenshot of ครู Esther's home screen:
 *
 *   "คุณครู Esther ลาชั่วคราว มาทำงานวันสุดท้ายคือ 21/09/26 ใส่ข้อมูลในระบบเริ่มลาตั้งแต่ 22/09-01/12
 *    ทำไมระบบยังเปิดให้สามารถเข้าได้ Check-in/out และทำกิจกรรมทุกอย่างได้เหมือนปกติ"
 *
 * staffPaused_ EXISTED and was correct — the monthly report, the dashboard and payroll all asked it.
 * What nobody asked it was "may this person use the app today", so a pause was a fact the reports
 * knew and the door did not. That is the same mistake as the missing NOT_STARTED gate (v386) and
 * before it the ENDED one, made a third time — which is why all three now sit on the one function
 * every request passes through, and why this file asserts they stay together.
 *
 * AND THE SECOND HALF, from the same report: "Role Admin ทำไมถึงเข้าไปนับเวลาเหมือนคุณครูปกติ".
 * The monthly report counted the Admin absent ten times. Two faults underneath it, and the app
 * already contained the right answer to both — see requiresCheckin_.
 */
const path = require('path'), fs = require('fs');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), api = R('webapp/api.js'), engine = R('webapp/engine.js'),
      codeGs = R('src/Code.gs'), checkinGs = R('src/Checkin.gs');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const appCode = strip(app), codeGsCode = strip(codeGs);

// ============================================================================================
console.log('1) the gate — a pause is now asked at the door, not only by the reports');
// ============================================================================================
{
  /* ONE PLACE, THREE STATES. The point of applyIdentity_ is that a rule written here covers every
   * handler at once — check-in, the class roll, journals, and whatever is added next. A pause
   * enforced in the check-in handler alone would be the v315 mistake all over again. */
  ok_('the gate exists and names the state', /apiError_\('PAUSED'/.test(codeGs));
  ok_('...and sits with the other two, in applyIdentity_',
    codeGs.indexOf("apiError_('ENDED'") < codeGs.indexOf("apiError_('PAUSED'") &&
    codeGs.indexOf("apiError_('NOT_STARTED'") < codeGs.indexOf("apiError_('PAUSED'"));
  /* PauseTo IS THE DAY THEY COME BACK — the same end of the range as the student rule, so nobody has
   * to remember which screen means which. `>= _pTo` releases them ON the return date. */
  ok_('the return date is a working day again, not the first day back after it',
    /_onPause = _now >= _pFrom && !\(\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(_pTo\) && _now >= _pTo\)/.test(codeGs));
  ok_('a pause with no end date still closes the door',
    /กรุณาติดต่อแอดมินเมื่อกลับมาทำงาน/.test(codeGs));

  /* WHAT IS STILL ALLOWED, and why it is not the same list as NOT_STARTED's. Somebody who has never
   * started gets only what they need to set themselves up; somebody on ลาชั่วคราว has a history that
   * is theirs, and taking their own payslips away while they are on leave would be punishing them
   * for being on leave. */
  const paused = (codeGsCode.match(/var PAUSED_OK_ = \{[\s\S]*?\};/) || [''])[0];
  ok_('the allow-list was found', paused.length > 50);
  ['staffCheckin', 'staffCheckout', 'staffStudentCheckin', 'submitJournal', 'classList',
   'submitAssessment', 'submitInjury', 'parentCheckin', 'teacherStudentLeave'].forEach(a => {
    ok_(a + ' is NOT open to somebody on leave', !new RegExp('\\b' + a + ': 1').test(paused));
  });
  ok_('...but their own record is', /myLeaves: 1/.test(paused) && /getPayslip: 1/.test(paused));
  ok_('...and the two the app needs to draw the "on leave" card at all',
    /staffSelf: 1/.test(paused) && /myAttendanceToday: 1/.test(paused));
}

// ============================================================================================
console.log('\n2) ...proved over the wire, on the live route');
// ============================================================================================
{
  const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                      'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                      'GasEngine', 'Engine']);
  const res = JSON.parse(run(function () {
    _configCache = null; setupAll(); _configCache = null;
    var HR = getHrSpreadsheet_(), MAIN = getMainSpreadsheet_();
    var d = function (n) { var x = new Date(); x.setDate(x.getDate() + n); return dateStr_(x); };

    var st = sheet_(HR, 'STAFF');
    var add = function (id, nick, from, to) {
      appendObject_(st, { StaffID: id, Name: 'คุณ' + nick, Nickname: nick, Role: 'Teacher',
        PositionLevel: 'Staff', Status: 'ACTIVE', Department: 'Nursery 1', LineUID: 'U' + id,
        StartDate: '2025-01-01', RequireCheckin: true, PauseFrom: from || '', PauseTo: to || '' });
      appendObject_(sheet_(MAIN, 'USERS'), { UserID: 'U-' + id, LineUID: 'U' + id, Role: 'Teacher',
        LinkedID: id, Status: 'ACTIVE' });
    };
    // Esther's real shape: last working day yesterday, on leave from today until December
    add('STF-PAUSE', 'เอสเธอร์', d(0), '2026-12-01');
    add('STF-SOON',  'จะลา',     d(3), '2026-12-01');   // a pause booked, not started
    add('STF-BACK',  'กลับแล้ว', '2026-08-01', d(0));   // PauseTo is TODAY → back at work today
    add('STF-OK',    'ปกติ',     '', '');
    /* THE GATES ARE DORMANT UNLESS SESSIONS ARE ENFORCED — applyIdentity_ returns on its first line
     * when RequireSessionToken is not 'true', which is how a local build runs. Without this the
     * whole section passes for the wrong reason: nothing is refused because nothing is checked. */
    var cfg = sheet_(MAIN, 'SCHOOL_CONFIG');
    var row = findObject_(cfg, function (r) { return r.Key === 'RequireSessionToken'; });
    if (row) updateRow_(cfg, row._row, { Value: 'true' });
    else appendObject_(cfg, { Key: 'RequireSessionToken', Value: 'true' });
    _configCache = null;

    var out = { steps: [] };
    var call = function (label, uid, action, payload) {
      try {
        var tok = issueSession_(uid, 'Teacher', uid.replace(/^U/, ''), Date.now());
        var sess = verifySession_(tok);
        var p = applyIdentity_(action, payload || {}, sess);
        out.steps.push([label, 'ok', !!p]);
      } catch (e) { out.steps.push([label, e.apiCode || e.code || 'ERR', String(e.message || e)]); }
    };
    out.steps.push(['enforced', sessionRequired_() ? 'ok' : 'OFF', true]);
    call('paused:checkin',   'USTF-PAUSE', 'staffCheckin', {});
    call('paused:classList', 'USTF-PAUSE', 'classList', {});
    call('paused:journal',   'USTF-PAUSE', 'submitJournal', {});
    call('paused:self',      'USTF-PAUSE', 'staffSelf', {});
    call('paused:payslip',   'USTF-PAUSE', 'myPayslipMonths', {});
    call('booked:checkin',   'USTF-SOON',  'staffCheckin', {});
    call('backtoday:checkin', 'USTF-BACK', 'staffCheckin', {});
    call('normal:checkin',   'USTF-OK',    'staffCheckin', {});
    return JSON.stringify(out);
  }));
  const S = {}; res.steps.forEach(([k, st, v]) => { S[k] = st; });

  // without this the rest of the section would pass by doing nothing at all
  eq('session enforcement is actually on for this run', S['enforced'], 'ok');
  /* THE SCREENSHOT, TURNED INTO AN ASSERTION: the two buttons that were live. */
  eq('a teacher on leave cannot clock in', S['paused:checkin'], 'PAUSED');
  eq('...nor open her class roll', S['paused:classList'], 'PAUSED');
  eq('...nor write a daily report', S['paused:journal'], 'PAUSED');
  /* ...AND HER OWN RECORD IS UNTOUCHED, which is the difference between closing the job and
   * closing the account. */
  eq('...but she can still read her own record', S['paused:self'], 'ok');
  eq('...and her own payslips', S['paused:payslip'], 'ok');
  /* A PAUSE THAT HAS NOT STARTED CHANGES NOTHING, exactly as a future EndDate does not. The Admin
   * records it in advance and the person keeps working until the day. */
  eq('a pause booked for next week does not close anything today', S['booked:checkin'], 'ok');
  eq('...and the return date itself is a working day', S['backtoday:checkin'], 'ok');
  eq('somebody with no pause at all is unaffected', S['normal:checkin'], 'ok');
}

// ============================================================================================
console.log('\n3) the screen, and the preview bar the Admin reads it from');
// ============================================================================================
{
  ok_('there is a screen for it, not a red error', /function pausedScreen\(\)\{/.test(appCode));
  ok_('...reached by the same wrapper as the other two',
    /\(PAUSED_SELF && !PAUSED_SCREENS\[k\]\) \? pausedScreen\(\) : orig\(\.\.\.a\)/.test(appCode));
  ok_('...and by a refusal arriving mid-session', /e\.code === 'PAUSED'/.test(api) && /__atomPaused/.test(api));
  /* THE SESSION IS KEPT. Signing somebody out for being on maternity leave would be absurd, and they
   * would only sign straight back in — the same reasoning as NOT_STARTED, and the opposite of ENDED. */
  const branch = api.slice(api.indexOf("e.code === 'PAUSED'"), api.indexOf("e.code === 'PAUSED'") + 260);
  ok_('...without signing her out', !/__atomClearSession/.test(branch));
  /* IT LEADS WITH THE RETURN DATE. That is the one thing she wants from this screen, and it is what
   * makes it read as "see you in December" rather than as being shut out. */
  ok_('the screen names the day she comes back', /กลับมาทำงานวันที่/.test(app));
  ok_('...seeded from staffSelf so a deep link cannot get round it',
    /__atomSetPaused\(me && me\.paused, me && me\.pauseTo\)/.test(appCode));
  ok_('...which the server now answers', /paused: staffPaused_\(s\), pauseTo:/.test(engine));

  // "เวลาเข้าไปดูมุมมองให้ขึ้นข้อมูลด้านหลังด้วยว่า (ลาชั่วคราว)"
  /* ...AND WHAT IT DOES NOT CLOSE. v393 blocked every teacher screen, including the three its own
   * card promised were still open — so a teacher on leave got the same dead app as somebody who had
   * resigned, tapped "สลิปเงินเดือน", and was shown the card again. Reported the day it shipped. */
  ok_('the three own-record screens stay open', /const PAUSED_SCREENS = \{ slip: 1, leave: 1, schedule: 1 \};/.test(appCode));
  ok_('...and the wrapper honours the list', /PAUSED_SELF && !PAUSED_SCREENS\[k\]/.test(appCode));
  ok_('...while the screens about the school’s children stay closed',
    !/PAUSED_SCREENS = \{[^}]*home: 1/.test(appCode) && !/PAUSED_SCREENS = \{[^}]*class: 1/.test(appCode));
  /* THE CARD OFFERS THEM, rather than only describing them. `home` is itself closed, so a sentence
   * saying "your payslips are still there" with no way to reach them is worse than saying nothing. */
  ok_('the card has a button for each of the three', /GO\('slip'\)/.test(appCode) && /GO\('leave'\)/.test(appCode) &&
    /onclick="GO\('schedule'\)">🗓️/.test(appCode));
  /* AND THE SERVER ALLOWS WHAT THEY FETCH. The two lists have to agree or one of them is lying:
   * a screen the app opens and the server refuses is the same bug seen from the other side. */
  ['myOT','otCarryOver','leaveQuota','myTimeRequests','schedule','myAttendanceMonth','myPayslipMonths']
    .forEach(a => ok_('server allows ' + a + ', which those screens call',
      new RegExp('\\b' + a + ': 1').test((codeGsCode.match(/var PAUSED_OK_ = \{[\s\S]*?\};/) || [''])[0])));
  ok_('the view-as bar says which state it is previewing', /USER\._paused \?/.test(appCode));
  ok_('...and is cleared on the way out, or the admin stays locked out of their own screens',
    /A_exitViewAs=\(\)=>\{[\s\S]{0,160}__atomSetPaused\(false,''\)/.test(appCode));
}

// ============================================================================================
console.log('\n4) who clocks in at all — one question, one answer');
// ============================================================================================
{
  const M = { staff: [], students: [], config: {} };
  const H = createAtomAPI(M).H;
  const src = /function requiresCheckin_\(s\)\{([\s\S]*?)\n  \}/.exec(engine);
  ok_('the helper was found', !!src);
  const requires = new Function('s', src[1] + '\n');

  /* THE BUG THAT STARTED IT: six readers used `RequireCheckin !== false`, a strict boolean compare,
   * while the 06:50 reminder used String(...)==='false'. A cell holding the TEXT "false" — what an
   * import or a hand-typed cell produces — is not the boolean false, so the reminder skipped that
   * person and every report went on counting them absent. */
  eq('the STRING "false" means not required, as the reminder always read it', requires({ RequireCheckin: 'false' }), false);
  eq('...and "FALSE"', requires({ RequireCheckin: 'FALSE' }), false);
  eq('the boolean false too', requires({ RequireCheckin: false }), false);
  eq('an explicit true is required', requires({ RequireCheckin: true }), true);
  eq('...including the string', requires({ RequireCheckin: 'true' }), true);

  /* AND THE DEFAULT, which nobody had written down for an Admin. src/Checkin.gs has always had
   * "admins don't clock in" — the school's own view, in exactly one place, never asked by a report.
   * A blank now follows it. An explicit value still wins in both directions, which is why this is
   * not simply `Role === 'Admin'`. */
  eq('blank: a teacher clocks in', requires({ Role: 'Teacher' }), true);
  eq('an Admin does not', requires({ Role: 'Admin' }), false);
  /* THE CASE v393 GOT WRONG, and it is why the flag gets no vote here. The "ตั้งค่าการลงเวลา" screen
   * saves a boolean for EVERY row at once, so every record in this school already holds an explicit
   * true — "explicit" cannot be told apart from "default", and letting true win meant the Admin went
   * on being counted absent (10, then 16) through two releases. */
  eq('...even with the box ticked, because every row has it ticked', requires({ Role: 'Admin', RequireCheckin: true }), false);
  eq('...and with the string "true" too', requires({ Role: 'Admin', RequireCheckin: 'true' }), false);
  /* ผอ. IS NOT SPECIAL-CASED, and the report asked how it differs. It does not: Leader and Observer
   * are treated like anyone else, so if a ผอ. is not counted it is their own flag doing it. */
  eq('a Leader is treated like anybody else', requires({ Role: 'Leader' }), true);
  eq('...and an Observer likewise', requires({ Role: 'Observer' }), true);

  ok_('every reader goes through it — none left comparing to false by hand',
    !/RequireCheckin!==false/.test(engine));
  /* ...and the 06:50 reminder asks it in the same ORDER: Role first, flag second. That order is the
   * rule — it is the line the app has had since the reminder was written, and reversing it is
   * exactly the mistake v393 made. */
  const rem = checkinGs.slice(checkinGs.indexOf('checkedIn[String(s.StaffID)]'), checkinGs.indexOf('อรุณสวัสดิ์'));
  ok_('...and the reminder agrees, Role before flag',
    rem.indexOf("String(s.Role) === 'Admin'") < rem.indexOf("RequireCheckin") &&
    /String\(s\.Role\) === 'Admin'\) return;/.test(rem));
}

// ============================================================================================
console.log('\n5) the check-in that no longer makes a teacher wait');
// ============================================================================================
{
  /* "ตอนกด Check-in ให้นักเรียนใช้เวลานานมาก เราสามารถลดเวลาลงกดแล้วเข้าไปรอใน Request Lists เอา
   * Timestamp รอส่งข้อมูลกลับได้ไหม?" — eight children at ~10s each is eighty seconds of standing
   * still behind a blocking overlay, for eight taps decided the moment they were made. */
  ok_('a write can now be sent without the blocking overlay', /opts && opts\.background/.test(appCode));
  /* THE FENCE THAT MAKES IT SAFE, and it is not optional: only actions already proven safe to send
   * twice may skip the wait, because only those can fall into the outbox and be replayed. A payment
   * must never take this path. */
  ok_('...only for actions the outbox may replay', /opts\.background\) && !!QUEUEABLE\[action\]/.test(appCode));
  ok_('the teacher punch uses it', /\{background:true\}/.test(appCode));
  /* THE TIMESTAMP IS WHAT MAKES IT CORRECT. This route takes an explicit `time` from the client — it
   * has to, or a child collected at 12:57 would be billed OT against the wall clock when the teacher
   * records it at 17:30 — so a request that lands thirty seconds later writes the same row. */
  ok_('...and pins the time at the tap, so a late send cannot move it',
    /api\('staffStudentCheckin',\{staffId:USER\.staffId,studentId:sid,type:SC_TYPE,remark,time\},\{background:true\}\)/.test(appCode));
  /* HONEST WORDING. The modal closes before the reply, so the first message says SENT, not SAVED —
   * the screen must not claim the school has it while it is still in the air. */
  ok_('the immediate message says sending, not saved', /กำลังส่ง…/.test(app));
  /* AND A REFUSAL STILL HAS TO BE SEEN. It is the whole risk of not blocking: the teacher has walked
   * on, so ON_LEAVE or SCHOOL_CLOSED goes through err(), and the screen is redrawn from the server
   * either way so what it shows is what actually happened. */
  ok_('a refusal is raised loudly and the screen is put back', /\.catch\(e=>\{ err\(e\); \}\)/.test(appCode) &&
    /\.finally\(\(\)=>\{ try\{ if\(SCREENS\[USER\.role\]&&SCREENS\[USER\.role\]\[CURRENT\]\)/.test(appCode));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
