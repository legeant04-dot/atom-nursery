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
  var add = function (id, nick, role, dept, uid, endDate) {
    appendObject_(stSh, { StaffID: id, Name: 'คุณ' + nick, Nickname: nick, Role: role,
      PositionLevel: role === 'Admin' ? 'Admin' : 'Staff', Status: 'ACTIVE', Department: dept,
      LineUID: uid || '', EndDate: endDate || '', RequireCheckin: true, StartDate: '2025-01-01' });
  };
  var yesterday = (function () { var d = new Date(); d.setDate(d.getDate() - 1); return dateStr_(d); })();
  var tomorrow  = (function () { var d = new Date(); d.setDate(d.getDate() + 1); return dateStr_(d); })();

  add('STF-T', 'ครูเอ', 'Teacher', 'Nursery 1', 'Uteacher');
  add('STF-OBS', 'พี่กุ้ง', 'Observer', '*', 'Uobserver');          // sees everything — must be TOLD nothing
  add('STF-ADM', 'แอดมิน', 'Admin', '*', 'Uadmin');
  add('STF-GONE', 'ฉำฉา', 'Teacher', 'Nursery 1', 'Ugone', yesterday);   // last day was yesterday
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

  // ---- the door ----
  var login = function (uid) {
    try { return { ok: true, role: handleAuth({ lineUid: uid, uid: uid }).role }; }
    catch (e) { return { ok: false, code: e && e.apiCode, msg: e && e.message }; }
  };
  o.loginGone = login('Ugone');
  o.loginLeaving = login('Uleaving');
  o.loginTeacher = login('Uteacher');
  o.audit = readObjects_(sheet_(MAIN, 'AUDIT_LOG')).filter(function (r) { return String(r.Action) === 'LOGIN_DENIED_ENDED'; }).length;
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
  ok_('...saying it is a reminder, not a demand to delete', /ไม่จำเป็นต้องลบ/.test(app));
  ok_('...and that coming back just means clearing the date', /แค่ล้างวันสิ้นสุดก็ใช้งานได้ทันที/.test(app));
  ok_('the built engine has the list', /endedStaff: \(\) => M\.staff\.filter\(s=>staffEnded_\(s\)\)/.test(gasEngine));
  ok_('the board asks BOTH ends of the question now',
    /staffStat=M\.staff\.filter\(s=>[\s\S]{0,160}&&!staffEnded_\(s\)\)/.test(engine));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
