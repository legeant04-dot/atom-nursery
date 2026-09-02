/**
 * tools/test_off_duty.js — who may be notified, and who may still get in.
 *   node tools/test_off_duty.js
 *
 * Two faults reported together on 2026-09-01, both the same shape: the app knew somebody was not on
 * duty and asked the question in some places and not others.
 *
 * 1. AN OBSERVER WAS BEING LINE-PUSHED ABOUT EVERYTHING — every leave, every journal comment, every
 *    child arriving, all morning. notifyStudentTeacher_ excluded Role 'Admin' and nothing else, so
 *    Observer fell straight through. An Observer is a read-only auditor: there is no action for them
 *    to take about a child arriving at 07:20. And the school's free LINE quota (~300/month) is
 *    exhausted — they believed the switch was off, but only the ADMIN path had a switch. This is the
 *    highest-volume traffic in the app and it had none.
 *
 * 2. A TEACHER WHOSE LAST DAY WAS 31/08 WAS STILL ON THE BOARD ON 01/09, counted as ขาด, dragging
 *    the school's attendance to 83% (5/6) — and still holding a working login. The check-in handler
 *    had always refused her and the monthly report had always filtered her out; the dashboard asked
 *    staffStarted_ and never staffEnded_, the other end of the same question.
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
const app = R('webapp/app.js'), engine = R('webapp/engine.js'), gasEngine = R('src/Engine.gs'),
      parentGs = R('src/Parent.gs'), authGs = R('src/Auth.gs'), staffGs = R('src/Staff.gs');

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                    'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                    'GasEngine', 'Engine']);
const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var MAIN = getMainSpreadsheet_(), HR = getHrSpreadsheet_();
  var cfg = sheet_(MAIN, 'SCHOOL_CONFIG');
  updateRow_(cfg, findObject_(cfg, function (r) { return r.Key === 'LineChannelAccessToken'; })._row, { Value: 'REALTOKEN' });
  _configCache = null;

  var stSh = sheet_(HR, 'STAFF');
  var add = function (id, nick, role, dept, uid, endDate, reason) {
    appendObject_(stSh, { StaffID: id, Name: 'คุณ' + nick, Nickname: nick, Role: role,
      PositionLevel: role === 'Admin' ? 'Admin' : 'Staff', Status: 'ACTIVE', Department: dept,
      LineUID: uid || '', EndDate: endDate || '', EndReason: reason || '',
      RequireCheckin: true, StartDate: '2025-01-01' });
  };
  var yesterday = (function () { var d = new Date(); d.setDate(d.getDate() - 1); return dateStr_(d); })();
  var tomorrow  = (function () { var d = new Date(); d.setDate(d.getDate() + 1); return dateStr_(d); })();

  add('STF-T', 'ครูเอ', 'Teacher', 'Nursery 1', 'Uteacher');
  add('STF-OBS', 'พี่กุ้ง', 'Observer', '*', 'Uobserver');          // sees everything — must be TOLD nothing
  add('STF-ADM', 'แอดมิน', 'Admin', '*', 'Uadmin');
  /* ครูลิน's real shape: every department stored TWICE by the old joined-value checkbox, and a
   * reason on record. Both were mis-displayed on 01/09 — the departments printed doubled on the
   * dashboard, and her own record showed the reason as "—". */
  add('STF-GONE', 'ฉำฉา', 'Teacher', 'Nursery 1,Nursery 2,Nursery 1,Nursery 2', 'Ugone', yesterday, 'ไม่ผ่านการทดลองงาน');
  add('STF-LEAVING', 'ครูบี', 'Teacher', 'Nursery 1', 'Uleaving', tomorrow); // leaving, but not yet

  appendObject_(sheet_(MAIN, 'CLASSES'), { ClassID: 'C1', ClassName: 'Nursery 1', TeacherID: 'STF-T' });
  appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: 'STD-1', Name: 'ด.ญ. ทดสอบ', Nickname: 'ใบเตย',
    Class: 'Nursery 1', Status: 'ACTIVE', EnrollDate: '2025-05-01', Plan: 'FULL' });

  var o = {}, student = findObject_(sheet_(MAIN, 'STUDENTS'), function (s) { return s.StudentID === 'STD-1'; });
  var whoPushed = function () { return PUSH.map(function (p) { return p.to; }).sort(); };
  var whoInboxed = function () {
    return readObjects_(inboxSheet_()).filter(function (r) { return String(r.StaffID || ''); })
      .map(function (r) { return String(r.StaffID); }).sort();
  };

  // ---- with the LINE switch OFF (the default, and what the school believed was set) ----
  PUSH.length = 0;
  notifyStudentTeacher_(student, '👶 ใบเตย มาถึงโรงเรียนแล้ว (07:20)', { adminFallback: false });
  o.pushedOff = whoPushed();
  o.inboxedOff = whoInboxed();

  // ---- ...and with it ON ----
  updateRow_(cfg, findObject_(cfg, function (r) { return r.Key === 'StaffLineNotify'; })._row, { Value: 'true' });
  _configCache = null;
  PUSH.length = 0;
  notifyStudentTeacher_(student, '👶 ใบเตย ถูกรับกลับแล้ว (17:00)', { adminFallback: false });
  o.pushedOn = whoPushed();
  updateRow_(cfg, findObject_(cfg, function (r) { return r.Key === 'StaffLineNotify'; })._row, { Value: 'false' });
  _configCache = null;

  // ---- the daily board ----
  o.board = engineDispatch_('dashboard', {}).staff.map(function (s) { return s.nick; }).sort();
  o.ended = engineDispatch_('dashboard', {}).endedStaff.map(function (s) { return [s.nick, s.endDate]; });
  o.endedDept = engineDispatch_('dashboard', {}).endedStaff.map(function (s) { return s.dept; });
  o.endedReason = engineDispatch_('dashboard', {}).endedStaff.map(function (s) { return s.reason; });

  // saving her again must REPAIR the stored value, not preserve the doubling
  handleSaveStaff({ staffId: 'STF-GONE', data: { Department: 'Nursery 1,Nursery 2,Nursery 1,Nursery 2',
                                                 Classes: 'Nursery 1,Nursery 1' } });
  var _fixed = findObject_(stSh, function (s) { return s.StaffID === 'STF-GONE'; });
  o.savedDept = String(_fixed.Department || '');
  o.savedClasses = String(_fixed.Classes || '');
  handleSaveStaff({ staffId: 'STF-ADM', data: { Department: '*' } });
  o.savedAll = String(findObject_(stSh, function (s) { return s.StaffID === 'STF-ADM'; }).Department || '');

  // ---- the door ----
  var login = function (uid) {
    try { return { ok: true, role: handleAuth({ lineUid: uid, uid: uid }).role }; }
    catch (e) { return { ok: false, code: e && e.apiCode, msg: e && e.message }; }
  };
  o.loginGone = login('Ugone');
  o.loginLeaving = login('Uleaving');
  o.loginTeacher = login('Uteacher');
  o.audit = readObjects_(sheet_(MAIN, 'AUDIT_LOG')).filter(function (r) { return String(r.Action) === 'LOGIN_DENIED_ENDED'; }).length;

  /* THE HOLE v315 LEFT. Refusing at handleAuth was the wrong door: a token lasts 12 hours and renews
   * itself on use, so somebody already signed in never passes through login again. Reported the same
   * day — she was still on her home screen with the clock-in buttons live.
   *
   * So these go over the wire WITH A TOKEN issued while she still worked here, which is exactly the
   * state the reported phone was in. */
  /* applyIdentity_ is dormant unless SCHOOL_CONFIG RequireSessionToken='true' — which live has had
   * since go-live, and without which nothing in the app trusts its own identity checks anyway. Set
   * here so this exercises the live configuration rather than the dormant one. */
  var _rq = findObject_(cfg, function (r) { return r.Key === 'RequireSessionToken'; });
  if (_rq) updateRow_(cfg, _rq._row, { Value: 'true' }); else appendObject_(cfg, { Key: 'RequireSessionToken', Value: 'true' });
  _configCache = null;
  var post = function (token, action, payload) {
    var r = doPost({ postData: { contents: JSON.stringify({ action: action, payload: payload || {}, token: token }) } });
    return JSON.parse(r.getContent ? r.getContent() : r);
  };
  var tokGone = issueSession_('Ugone', 'Teacher', 'STF-GONE');
  var tokOk = issueSession_('Uteacher', 'Teacher', 'STF-T');
  var tokLeaving = issueSession_('Uleaving', 'Teacher', 'STF-LEAVING');
  var tokAdmin = issueSession_('Uadmin', 'Admin', 'STF-ADM');
  o.oldTokenRead = post(tokGone, 'staffSelf', {});
  o.oldTokenPunch = post(tokGone, 'staffCheckin', { lat: 13.792472, lng: 100.646389 });
  o.okTokenRead = post(tokOk, 'staffSelf', {});
  o.leavingTokenRead = post(tokLeaving, 'staffSelf', {});
  // an admin "viewing as" her must still work — that is how the record gets closed
  o.adminViewsHer = post(tokAdmin, 'staffSelf', { staffId: 'STF-GONE' });
  return JSON.stringify(o);
}));

// ============================================================================
console.log('\n1) AN OBSERVER IS NEVER A RECIPIENT');
{
  /* The reported fault. Department '*' makes staffCoversClass_ true for every class, which is right
   * for an auditor's READ access and exactly wrong as a reason to push them a message. */
  ok_('no LINE push to the observer', res.pushedOff.indexOf('Uobserver') < 0 && res.pushedOn.indexOf('Uobserver') < 0);
  ok_('...and no bell row either — there is nothing for them to do about it',
    res.inboxedOff.indexOf('STF-OBS') < 0);
  ok_('an admin is not a recipient of routine traffic either', res.pushedOn.indexOf('Uadmin') < 0);
  ok_('the reason is written where the rule is', /An Observer is a read-only auditor/.test(parentGs));
}

console.log('\n2) THE LINE SWITCH — the quota the school thought was protected');
{
  eq('off by default: nobody is pushed', res.pushedOff, []);
  /* ...but the teacher still LEARNS about it. That is what makes turning LINE off safe, and it is
   * the difference between saving quota and losing messages. */
  // both covering teachers: ครูบี leaves TOMORROW, so today is still hers and she is still told
  eq('...and the covering teachers still get the bell', res.inboxedOff, ['STF-LEAVING', 'STF-T']);
  eq('on: the covering teachers are pushed, and nobody else', res.pushedOn, ['Uleaving', 'Uteacher']);
  ok_('the switch is declared, or saving it would change nothing', /StaffLineNotify: 1/.test(staffGs));
  ok_('...and seeded off', /\['StaffLineNotify',\s*'false'\]/.test(R('src/Config.gs')));
  ok_('the settings screen offers it', /id="setStaffLine"/.test(app) && /gv\.StaffLineNotify=ck\('#setStaffLine'\)/.test(app));
  ok_('...saying plainly that the bell still works', /คุณครูยังได้รับครบทุกเรื่องที่กระดิ่ง/.test(app));
}

console.log('\n3) SOMEBODY WHOSE LAST DAY HAS PASSED IS NOT STAFF');
{
  /* EndDate is a LAST WORKING DAY, so every one of these must bite the day AFTER, never on it. The
   * teacher leaving tomorrow is in the fixture precisely to prove the boundary. */
  eq('off the daily attendance board', res.board.sort(), ['ครูบี', 'ครูเอ'].sort());
  ok_('...so the school’s attendance is not dragged down by someone who left', res.board.indexOf('ฉำฉา') < 0);
  ok_('...and the one leaving TOMORROW is still counted, because today is still their day',
    res.board.indexOf('ครูบี') >= 0);
  eq('they are not notified about anything either', res.pushedOn.indexOf('Ugone'), -1);

  console.log('   — and the door');
  eq('they cannot sign in', res.loginGone.ok, false);
  eq('...with a code of its own', res.loginGone.code, 'ENDED');
  ok_('...saying when it ended and what to do', /สิ้นสุดการทำงานเมื่อ/.test(res.loginGone.msg) && /แจ้งแอดมิน/.test(res.loginGone.msg));
  ok_('...and it is on the record', res.audit >= 1);
  ok_('the teacher leaving tomorrow still signs in', res.loginLeaving.ok === true);
  ok_('...and so does everybody else', res.loginTeacher.ok === true && res.loginTeacher.role === 'Teacher');
  ok_('the reason is written at the door', /THE LAST WORKING DAY HAS PASSED/.test(authGs));

  console.log('   — AND THE SESSION SHE ALREADY HAD, which is what v315 missed');
  /* Blocking login does nothing to a token issued yesterday: it lasts 12 hours and renews itself on
   * use, so she never passes through login again. This is the state the reported phone was in. */
  eq('an old token cannot even read her own record', [res.oldTokenRead.ok, res.oldTokenRead.error.code], [false, 'ENDED']);
  eq('...and certainly cannot clock in', [res.oldTokenPunch.ok, res.oldTokenPunch.error.code], [false, 'ENDED']);
  ok_('...with the same sentence, so it reads the same wherever it appears',
    /สิ้นสุดการทำงานเมื่อ/.test(res.oldTokenRead.error.message));
  ok_('a working teacher’s token is untouched', res.okTokenRead.ok === true);
  ok_('...and so is the one whose last day is tomorrow', res.leavingTokenRead.ok === true);
  /* AN ADMIN MUST STILL REACH HER. Closing the record is the admin's job, and "view as" is how they
   * check it — an Admin session returns from applyIdentity_ before this check ever runs. */
  ok_('an admin can still open her record', res.adminViewsHer.ok === true && res.adminViewsHer.data.ended === true);
  /* ...and it carries the FACT, never the date. A leaving date is the admin's to give — nobody
   * learns their last day from an app — so staffSelf has never carried EndDate and still does not,
   * even now that the screen needs to know not to draw the clock-in buttons. */
  ok_('...as a fact, without handing out the date itself',
    res.adminViewsHer.data.EndDate === undefined && res.adminViewsHer.data.endScheduled === undefined);
  ok_('the check is on every request, not just the door', /var _me = staffRowById_\(sess\.linkedId\);/.test(R('src/Code.gs')));
  ok_('...and says why the door alone was not enough', /that was the WRONG DOOR/.test(R('src/Code.gs')));
  ok_('the app signs her out once instead of showing a wall of errors',
    /window\.__atomEnded = \(msg\)/.test(app) && /e\.code === 'ENDED'/.test(R('webapp/api.js')));
  ok_('...and the clock-in card is replaced rather than left live', /:me0\.ended\?/.test(app));

  console.log('   — and the REST of the teacher side, which v316 left open');
  /* v316 closed the server and the clock-in card and stopped there, so the other eight screens still
   * had every button to press: "บันทึกได้ กดเข้าไปแก้ไขได้ ลงบันทึกได้ รับส่งแทนได้ แจ้งอุบัติเหตุได้".
   * One gate around SCREENS.Teacher rather than nine separate patches — the same reasoning as
   * assertStudentDayOpen_, and it covers a screen added later without anyone remembering. */
  ok_('every teacher screen goes through one gate',
    /Object\.keys\(SCREENS\.Teacher\)\.forEach\(k => \{[\s\S]{0,220}ENDED_SELF \? endedScreen\(\) : orig\(\.\.\.a\)/.test(app));
  ok_('...naming what is closed, not just refusing', /การลงเวลา บันทึกประจำวัน ประเมินพัฒนาการ แจ้งอุบัติเหตุ/.test(app));
  ok_('...and saying nothing was deleted', /ข้อมูลไม่ได้ถูกลบ/.test(app));
  ok_('it is decided BEFORE the first screen is drawn, so a deep link cannot slip past',
    /if \(role !== 'Parent'\) api\('staffSelf', \{ staffId: linkedId \}\)/.test(app));
  ok_('...and a failed lookup leaves it open rather than locking somebody out',
    /a lookup that did not answer must never lock somebody out/.test(app));
  /* VIEW-AS runs on the ADMIN's session and must — or nobody could close the record — so the server
   * never refuses it, and the admin saw a working app and concluded nothing had been fixed. */
  ok_('viewing as an ended teacher shows what THEY would see', /if\(window\.__atomSetEnded\) __atomSetEnded\(!!s\.ended\);/.test(app));
  ok_('...and leaving view-as clears it again', /window\.A_exitViewAs=\(\)=>\{ if\(window\.__atomSetEnded\) __atomSetEnded\(false\);/.test(app));

  console.log('   — and they are moved out of the working roster');
  ok_('the admin roster splits on ended, not just on status',
    /const _left=s=>String\(\(s&&s\.Status\)\|\|'ACTIVE'\)\.toUpperCase\(\)==='INACTIVE' \|\| !!\(s&&s\.ended\)/.test(app));
  ok_('...into the section that already existed', /_stGone\.length\?/.test(app));
  ok_('listStaff is what tells it', /ended: staffEnded_\(s\)/.test(engine));
}

console.log('\n3b) A DEPARTMENT CANNOT BE SAVED TWICE');
{
  /* ครูลิน's record read "Nursery 1,Nursery 2,Nursery Premium,Nursery 3,Nursery 1,Nursery 2,
   * Nursery Premium,Nursery 3" (2026-09-01). A_classOptions(cur) tested `out.indexOf(cur)` — but for
   * staff, `cur` is the whole comma-joined LIST, which can never match a single name, so the entire
   * list was unshifted as ONE option: a checkbox reading "Nursery 1,Nursery 2,…". Ticking it saved
   * every department a second time. */
  ok_('the current value is split before being offered as options',
    /String\(cur==null\?'':cur\)\.split\(','\)\.map\(x=>x\.trim\(\)\)\.filter\(Boolean\)\.reverse\(\)/.test(app));
  ok_('...and a name already in the master is not added again', /if\(n!=='\*' && out\.indexOf\(n\)<0\) out\.unshift\(n\);/.test(app));
  ok_('...and "*" never becomes an option of its own', /n!=='\*'/.test(app));
  // the save is flattened too, so a record that already holds duplicates is repaired next time
  ok_('the save flattens and de-duplicates', /String\(x\.value\|\|''\)\.split\(','\)\.map\(v=>v\.trim\(\)\)\.filter\(Boolean\)\.forEach/.test(app));
  ok_('...with the reason written down', /this is what repairs ครูลิน on her next save/.test(app));

  /* AND IT WAS STILL ON SCREEN A DAY LATER (reported 2026-09-01, "แผนกซ้ำของครูลินยังแสดงอยู่").
   * Fixing the client that WRITES the value cannot fix a row that is already doubled — that row is
   * only repaired if somebody happens to open and re-save her. So: normalise on the one server path
   * every staff write goes through, and de-duplicate on the way out too, so the screen is honest
   * today rather than on whatever day the next save happens. */
  eq('the server repairs the stored value on the next save', res.savedDept, 'Nursery 1,Nursery 2');
  eq('...including Classes, which is written from the same checkboxes', res.savedClasses, 'Nursery 1');
  eq('"*" is a sentinel, not a list, and survives untouched', res.savedAll, '*');
  ok_('the rule is on the server, where every write passes', /function deptNorm_\(v\)/.test(staffGs));
  ok_('...and applied to both columns',
    /row\.Department = deptNorm_\(row\.Department\)/.test(staffGs) && /row\.Classes = deptNorm_\(row\.Classes\)/.test(staffGs));
  eq('a doubled row READS de-duplicated before anyone re-saves it', res.endedDept, ['Nursery 1,Nursery 2']);
  ok_('...and every screen that prints departments goes through one helper',
    /const deptList = v =>/.test(app) && /return deptList\(d\)\.join\(' · '\)/.test(app));
  ok_('the built engine carries the de-duplication too', /de-duplicated: rows written by the old joined-value checkbox/.test(gasEngine));
}

console.log('\n3c) THE END-OF-EMPLOYMENT BOX SHOWS WHAT IS ON RECORD');
{
  /* "ทำไมเหตุผลของครูลินในข้อมูลส่วนตัวไม่แสดงเหมือนที่หน้าหลักแสดง" (2026-09-01). The date box was
   * filled from s.EndDate; the <select> carried no `selected` and the textarea no value. So her
   * record read "31/08/2026 · —" while the manage screen and the dashboard both said
   * "ไม่ผ่านการทดลองงาน".
   *
   * Not cosmetic: A_staffEnd re-sends whatever the select holds, so correcting the DATE here would
   * have blanked the reason — the server's empty-reason check is the only thing that stopped it. */
  ok_('the reason on record is pre-selected', /_reasons\.map\(\(\[v,l\]\)=>`<option value="\$\{esc\(v\)\}" \$\{_cur===v\?'selected':''\}/.test(app));
  ok_('the note on record is filled in too', /<textarea id="sf_EndRemark"[^>]*>\$\{esc\(s\.EndRemark\|\|''\)\}<\/textarea>/.test(app));
  /* A reason that is no longer one of the three offered must not be silently dropped and rewritten
   * on the next save — history is history. */
  ok_('a reason no longer on the list is kept as its own option',
    /if\(_cur && !_reasons\.some\(r=>r\[0\]===_cur\)\) _reasons\.push\(\[_cur,_cur\]\)/.test(app));
  ok_('a record that already has a leaving date opens expanded rather than hidden in a fold',
    /const _sched=!!s\.EndDate;/.test(app) && /\$\{_sched\?' open':''\}/.test(app));
  ok_('...and the button says update, not "save and remove", for somebody already removed',
    /_sched\?\(EN\(\)\?'Update':'อัปเดตข้อมูลการสิ้นสุดการทำงาน'\)/.test(app));
  eq('the dashboard was reading the reason correctly all along', res.endedReason, ['ไม่ผ่านการทดลองงาน']);
}

console.log('\n4) THE ADMIN IS TOLD, rather than the record quietly vanishing');
{
  /* Taking them off the board is right, and it is also how a record stops being noticed. Asked for:
   * "ควรขึ้นแจ้งเตือน Admin ว่าให้นำชื่อออกจากระบบ". Never auto-deleted — the school's own reason is
   * that people come back, and the row holds their payroll and attendance history. */
  eq('the dashboard names them', res.ended.map(x => x[0]), ['ฉำฉา']);
  ok_('...with the date they left', /^\d{4}-\d{2}-\d{2}$/.test(res.ended[0][1]));
  ok_('the card exists', /window\.A_endedStaffCard=/.test(app));
  ok_('...and is on the dashboard', /\$\{A_endedStaffCard\(d\.endedStaff\)\}/.test(app));

  /* ...AS ONE LINE, NOT AS THE WHOLE LIST. Asked 2026-09-01: "จะแสดงอยู่นานแค่ไหน? หรือนำไปแสดง
   * ในส่วนของจัดการสิ้นสุดการทำงานแทนเพื่อไม่ให้หน้าหลักโหลดเยอะเกินไป" — the list only ever grows,
   * one row per person who ever left, on the screen that opens first. */
  ok_('the dashboard names them in a sentence instead of listing every row',
    /const names=list\.slice\(0,4\)\.map\(dn\)\.filter\(Boolean\);/.test(app) && /const more=list\.length-names\.length;/.test(app));
  ok_('...and hands off to the section that already holds the detail and the buttons',
    /onclick="A_gotoEnded\(\)"/.test(app) && /window\.A_gotoEnded=\(\)=>\{ GO\('manage'\);/.test(app));
  ok_('...which it opens and scrolls to rather than leaving the admin to hunt for it',
    /A_jumpSec\('sec-staff-gone'\)/.test(app));
  /* The old copy said "เหลือแค่จัดการข้อมูลให้เรียบร้อย" without ever saying what เรียบร้อย was, so
   * there was nothing to finish and no way to make the card go away. */
  ok_('it says plainly that nothing is pending', /ไม่มีอะไรค้างต้องทำ/.test(app));
  ok_('...and the manage section spells out the three options, with "do nothing" recommended',
    /ปล่อยไว้แบบนี้<\/b> \(แนะนำ/.test(app) && /นำกลับเข้าทำงาน<\/b>/.test(app) && /<b>ลบ<\/b>/.test(app));
  ok_('...and answers how long the name stays there', /ชื่อจะอยู่ในรายการนี้จนกว่าจะทำ 2 อย่างหลัง/.test(app));
  ok_('the built engine has the list', /endedStaff: \(\) => M\.staff\.filter\(s=>staffEnded_\(s\)\)/.test(gasEngine));
  ok_('the board asks BOTH ends of the question now',
    /staffStat=M\.staff\.filter\(s=>[\s\S]{0,200}&&!staffEnded_\(s\)/.test(engine));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
