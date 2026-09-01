/**
 * tools/test_line_routing.js — who the school messages on LINE, and what it costs.
 *   node tools/test_line_routing.js
 *
 * Asked 2026-09-01: "ต้องการให้ Line OA แจ้งเตือนไปที่ Admin หรือคนที่ระบบกำหนด … หรือสามารถกำหนดได้ว่า
 * จะแจ้งเตือนไปที่ใครบ้าง ไม่แจ้งใครบ้าง เฉพาะเรื่องไหนที่ระบบจะแจ้งไป" and "ถ้าอยากแจ้งใน 1 วันจะใช้
 * Credit เท่าไหร่ และเดือนนึงจะใช้เท่าไหร่".
 *
 * The only control before was AdminLineNotify: every Admin-role user, about everything, or nobody.
 * On a plan capped at 300 messages a month that is not a setting anybody can use — so the school
 * turned it off and lost the alerts they wanted along with the ones they did not.
 *
 * Two rules decide whether the money answer is honest:
 *   • one push to one person is one message, so the estimate must multiply events by RECIPIENTS and
 *     not just count events;
 *   • the average must be per SCHOOL DAY. A window containing eight weekend days, averaged flat,
 *     understates a school day by a third and the school would buy the wrong plan.
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
const app = R('webapp/app.js'), notifyGs = R('src/Notify.gs'), lineGs = R('src/Line.gs'), codeGs = R('src/Code.gs');

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                    'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                    'GasEngine', 'Engine']);
const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var MAIN = getMainSpreadsheet_();
  var cfg = sheet_(MAIN, 'SCHOOL_CONFIG');
  updateRow_(cfg, findObject_(cfg, function (r) { return r.Key === 'LineChannelAccessToken'; })._row, { Value: 'REALTOKEN' });
  _configCache = null;

  handleSaveLineRecipients({ rows: [
    { name: 'ครูต้อม (เจ้าของ)', uid: 'U97c61e9212132a211a0c88f8164db74c', topics: '*', active: true },
    { name: 'ธุรการ', uid: 'U11111111111111111111111111111111', topics: 'payment,approval', active: true },
    { name: 'คนที่ปิดไว้', uid: 'U22222222222222222222222222222222', topics: '*', active: false },
    { name: 'ไม่มี uid', uid: '', topics: '*', active: true },
    { name: 'ติ๊กเรื่องที่ไม่มีจริง', uid: 'U33333333333333333333333333333333', topics: 'nonsense', active: true },
    // the same person twice — easy to do, since they can be reached by picking them from the roster
    // OR by pasting their id, and it would be two messages every time on a per-message channel
    { name: 'ครูต้อม อีกแถว', uid: 'U97c61e9212132a211a0c88f8164db74c', topics: 'ot', active: true }
  ], adminId: 'ADM' });

  var o = {};
  o.saved = handleLineRecipients().rows.map(function (r) { return [r.name, r.topics, r.active]; });
  var uids = function (cat) { return lineRecipientsFor_(cat).map(function (r) { return String(r.LineUID).slice(0, 3); }).sort(); };
  o.payment = uids('payment');
  o.leave = uids('leave');
  o.emergency = uids('emergency');

  // ...and what actually goes out
  PUSH.length = 0; notifyAdmins_('ทดสอบ: มีสลิปใหม่', 'payment'); o.pushPayment = PUSH.map(function (p) { return p.to.slice(0, 3); }).sort();
  PUSH.length = 0; notifyAdmins_('ทดสอบ: มีใบลา', 'leave');       o.pushLeave = PUSH.map(function (p) { return p.to.slice(0, 3); }).sort();
  PUSH.length = 0; notifyAdminsUrgent_('ทดสอบ: อุบัติเหตุ');       o.pushUrgent = PUSH.map(function (p) { return p.to.slice(0, 3); }).sort();
  o.inbox = readObjects_(inboxSheet_()).length;

  // ---- the estimate ----
  var stu = sheet_(MAIN, 'STUDENTS'), ck = sheet_(MAIN, 'CHECKIN_STUDENT');
  appendObject_(stu, { StudentID: 'STD-1', Name: 'ด.ญ. ทดสอบ', Nickname: 'ใบเตย', Class: 'Nursery 1',
    Status: 'ACTIVE', EnrollDate: '2025-05-01', Plan: 'FULL' });
  appendObject_(sheet_(MAIN, 'CLASSES'), { ClassID: 'C1', ClassName: 'Nursery 1', TeacherID: 'STF-T' });
  appendObject_(sheet_(getHrSpreadsheet_(), 'STAFF'), { StaffID: 'STF-T', Name: 'ครูเอ', Nickname: 'เอ',
    Role: 'Teacher', PositionLevel: 'Staff', Status: 'ACTIVE', Department: 'Nursery 1', LineUID: 'Uteacher', StartDate: '2025-01-01' });
  /* 20 teacher-recorded check-ins today: each messages ONE parent.
   * HALF ARE WRITTEN AS Date OBJECTS, which is what Sheets actually hands back for a date cell. The
   * counter used String(v).slice(0,10) — "Tue Sep 01" — so on live EVERY counted line read zero and
   * the school saw only the computed digest row. They would have concluded the free plan was ample.
   * The same coercion trap ym7_ exists for; the fixture now contains both shapes deliberately. */
  for (var i = 0; i < 20; i++) {
    appendObject_(ck, { Date: (i % 2 ? new Date() : dateStr_(new Date())), Time: '08:0' + (i % 10),
      StudentID: 'STD-1', ParentID: 'PAR-1', Type: 'IN', Status: 'OK', ByStaffID: 'STF-T' });
  }
  o.usage = handleLineUsage({ days: 14 });
  return JSON.stringify(o);
}));

// ============================================================================
console.log('\n1) the list is the switch');
{
  eq('rows without a LINE id are dropped', res.saved.map(r => r[0]),
    ['ครูต้อม (เจ้าของ)', 'ธุรการ', 'คนที่ปิดไว้', 'ติ๊กเรื่องที่ไม่มีจริง']);
  /* A topic name this app does not file by is DROPPED rather than kept — it would match nothing
   * anyway, and keeping it leaves a row that looks configured on screen and never fires. */
  eq('a topic this app does not file by is dropped',
    res.saved.find(r => r[0] === 'ติ๊กเรื่องที่ไม่มีจริง')[1], '');
  eq('...and a real selection is kept as chosen', res.saved.find(r => r[0] === 'ธุรการ')[1], 'payment,approval');
  /* '*' AND EMPTY MUST DIFFER. If they did not, unticking every box would subscribe somebody to
   * everything — the opposite of what the person unticking asked for, on a channel that costs money
   * per message. It fails closed. */
  ok_('...and "no topics" is a real answer, not a synonym for "all topics"',
    /if \(t === '\*'\) return true;\s*\n\s*if \(!t\) return false;/.test(notifyGs));
  /* THE SAME PERSON TWICE IS TWO MESSAGES, every time, on a channel billed per message. The screen
   * disables an id already on the list; this is the half a hand-edited sheet cannot get round. */
  eq('one row per person, whatever was sent', res.saved.filter(r => r[0].indexOf('ครูต้อม') === 0).length, 1);
  eq('...and it is the first, so the row the admin was looking at wins',
    res.saved.find(r => r[0].indexOf('ครูต้อม') === 0)[1], '*');
}

console.log('\n1b) picked from the roster, not typed');
{
  /* Asked 2026-09-01: "ให้ดึงข้อมูลพนักงานเป็น Dropdown Lists และหากเลือกคนไหนให้เอา Uid ของคนนั้นมา".
   * A 33-character id typed by hand goes wrong silently — one character out and the alerts simply
   * never arrive, with nothing on screen to say so. */
  ok_('there is a staff dropdown', /A_lineWhoPick\(\$\{i\},this\.value\)/.test(app));
  ok_('...that fills the name AND the id from the record',
    /r\.name=dispNick\(s\)\|\|s\.NameTH\|\|s\.Name\|\|staffId;\s*\n\s*r\.uid=String\(s\.LineUID\|\|''\);/.test(app));
  ok_('...and rides in the same tick, so it costs no extra round trip',
    /const p_r=api\('lineRecipients',\{\},\{fresh:true\}\), p_s=api\('listStaff'\)/.test(app));
  /* Somebody with no LineUID has never signed in through LINE — there is nothing to message. Listed
   * but disabled and SAYING why, because "missing from the dropdown" is a question the admin would
   * otherwise have to ask us. */
  ok_('staff with no LINE link are shown, disabled, with the reason',
    /ยังไม่ได้เชื่อม LINE/.test(app) && /const off = !uid \|\| dup;/.test(app));
  ok_('...as is somebody already on the list', /อยู่ในรายการแล้ว/.test(app));
  ok_('...and somebody who has left is marked and sorted last',
    /s\.ended\?\(EN\(\)\?' — ended':' \(สิ้นสุดการทำงาน\)'\):''/.test(app));
  // a UID for somebody who is NOT staff (the owner's personal LINE) must still be possible
  ok_('typing an id by hand is still offered', /กรอกเอง \(ไม่ใช่พนักงาน\)/.test(app));
}

console.log('\n2) only the people who asked for THAT topic');
{
  eq('a payment reaches the owner and the office', res.payment, ['U11', 'U97']);
  ok_('...and not somebody with no topics ticked', res.payment.indexOf('U33') < 0);
  eq('...a leave reaches only the owner', res.leave, ['U97']);
  ok_('somebody switched off is never reached', res.payment.indexOf('U22') < 0 && res.leave.indexOf('U22') < 0);
  console.log('   — and that is what actually goes out');
  eq('the payment push', res.pushPayment, ['U11', 'U97']);
  eq('the leave push', res.pushLeave, ['U97']);
  /* THE ONE THAT IGNORES THE FILTER. A child has been hurt; that is not a subscription. Everyone
   * active gets it, including the office who only asked about payments. */
  // ...including the one with NO topics ticked: unsubscribing from everything is not unsubscribing from a child being hurt
  eq('an accident reaches everyone active, whatever they ticked', res.pushUrgent, ['U11', 'U33', 'U97']);
  ok_('...and never the person who is switched off', res.pushUrgent.indexOf('U22') < 0);
  eq('...and it is a rule, not an accident', /EMERGENCIES IGNORE THE TOPIC FILTER/.test(notifyGs), true);
  // the bell is written every time, which is what makes turning LINE off safe rather than lossy
  ok_('every one of them also landed in the in-app inbox', res.inbox >= 3);
}

console.log('\n3) THE MONEY — counted, not guessed');
{
  const u = res.usage;
  const item = k => (u.items || []).find(x => x.key === k) || {};
  /* One push to one person is one message. Twenty check-ins recorded by a teacher message twenty
   * parents — the biggest single line, and the one the school's promise to families rests on. */
  /* ALL TWENTY, including the ten stored as Date objects. This is the assertion that would have
   * caught the live fault: with String(v).slice(0,10) it read 10 here and 0 on the real sheet. */
  eq('twenty teacher-recorded check-ins, however the date cell is stored', item('checkinParent').events, 20);
  eq('...cost one message each', item('checkinParent').perEvent, 1);
  eq('...so twenty messages', item('checkinParent').messages, 20);
  /* ...and the teacher half is OFF, so it costs nothing. A setting that is off must show as zero, or the
   * school cannot tell what turning it on would cost. */
  eq('the teacher half is off, and shows as zero', item('checkinTeacher').messages, 0);
  ok_('...and says so rather than just showing a zero', /ปิดอยู่/.test(item('checkinTeacher').note));

  console.log('   — averaged over SCHOOL days, not calendar days');
  /* A 14-day window holds ~10 school days. Dividing by 14 would understate a school day by a third
   * and the school would buy the wrong plan. */
  ok_('the window counts school days separately', u.schoolDays > 0 && u.schoolDays < u.days);
  eq('the daily figure is per school day', u.perDay, Math.round(u.totalInWindow / u.schoolDays));
  eq('...and the month is 21 of those', u.perMonth, u.perDay * 21);

  console.log('   — and it says what LINE itself reports');
  ok_('the plan is asked for, not assumed', u.plan && u.plan.checked === true);
  ok_('the settings it measured are reported alongside',
    u.staffLineOn === false && typeof u.teachersPerClass === 'number');

  console.log('   — and "what if I turned everything on?"');
  /* Asked 2026-09-01: "ลองตั้งค่าคนเดียวให้ส่งทุกอย่างแต่ประเมินไม่ได้คำนวนให้ว่า ถ้าส่งทุกอย่างให้
   * 1 คน จะเป็นกี่ Credits". A table of zeros, because a topic is currently off, cannot answer it —
   * and it is exactly the number somebody choosing a plan needs. */
  ok_('every line carries a second figure priced as though everything were on',
    (u.items || []).every(x => typeof x.messagesIfAll === 'number'));
  ok_('...which is never smaller than what it costs today',
    (u.items || []).every(x => x.messagesIfAll >= x.messages));
  ok_('...and the totals say so too', u.perMonthIfAll >= u.perMonth && u.perDayIfAll >= u.perDay);
  // the teacher half is OFF right now, so turning it on is precisely the difference on that line
  ok_('a channel that is off shows what turning it on would cost',
    item('checkinTeacher').messages === 0 && item('checkinTeacher').messagesIfAll > 0);
  ok_('the screen shows both columns', /\$\{EN\(\)\?'now':'ตอนนี้'\}/.test(app) && /\$\{EN\(\)\?'if all on':'ถ้าเปิดหมด'\}/.test(app));
  /* Rows at zero are SHOWN, not filtered out: hiding them made "this topic is off" look identical to
   * "this does not exist", which is the state the school reported being unable to plan from. */
  ok_('...and no row is hidden for reading zero', !/\.filter\(x=>x\.events\|\|x\.messages\)/.test(app));
  ok_('...a row with nothing in the window says so in words', /ช่วงนี้ไม่มีรายการ/.test(app));

  console.log('   — the digest is filed under its own topic');
  /* It passed NO category, so it defaulted to 'approval': ticking "สรุปประจำวัน" did nothing, and
   * ticking "คำขออนุมัติ" quietly signed you up for two messages every school day. */
  eq('both digests are sent as digest', (R('src/Notify.gs').match(/notifyAdmins_\(lines\.join\('\\n'\), 'digest'\)/g) || []).length, 2);
  ok_('...with the reason written down', /ticking the digest box did/.test(R('src/Notify.gs')));
}

console.log('\n4) the screens');
{
  ok_('there is a recipient editor', /onclick="A_lineWho\(this\)"/.test(app) && /window\.A_lineWho=async/.test(app));
  ok_('...with a checkbox per topic', /A_lineWhoTopic\(\$\{i\},'\$\{esc\(t\)\}',this\.checked\)/.test(app));
  ok_('...that stores "everything ticked" as *, so a new topic reaches them without an edit',
    /\(cur\.length===Object\.keys\(LINE_TOPIC_TH\)\.length\) \? '\*'/.test(app));
  ok_('...and warns that accidents ignore the ticks', /อุบัติเหตุ<\/b>ส่งหาทุกคนที่เปิดใช้งาน/.test(app));
  ok_('...and says an empty list means nothing is sent', /ยังไม่มีใครในรายการ — ตอนนี้ไม่ได้ส่ง LINE หาใครเลย/.test(app));
  ok_('a badly-shaped LINE id is questioned before saving, not after', /\^U\[0-9a-f\]\{32\}\$/.test(app));

  ok_('there is a cost estimate', /onclick="A_lineCost\(this\)"/.test(app));
  ok_('...showing per school day and per month', /ต่อวันทำการ/.test(app) && /ต่อเดือน \(21 วันทำการ\)/.test(app));
  ok_('...broken down by where it goes', /ครั้ง × คน/.test(app));
  /* I DO NOT QUOTE LINE'S PRICES. They change, my knowledge has a cutoff, and this number decides
   * what the school pays every month — so the app gives them the figure to compare and sends them
   * to the source for the tiers. */
  ok_('...and sends them to LINE for the current prices rather than quoting remembered ones',
    /กรุณาเช็กราคาปัจจุบันใน LINE Official Account Manager/.test(app));
  ok_('the routes exist and are admin-only',
    /lineUsage:\s+function/.test(codeGs) && /lineUsage: 1, lineRecipients: 1, saveLineRecipients: 1/.test(codeGs));
  ok_('the estimate lives where the LINE quota is already read', /function handleLineUsage/.test(lineGs));
}

console.log('\n5) view-as says who has left');
{
  // an admin has to be able to open an ended teacher's screens to close the record — but the list
  // must SAY so, or they pick a name and cannot tell why every screen is shut
  ok_('the picker marks them', /\$\{s\.ended\?\(EN\(\)\?' — ENDED':' \(สิ้นสุดการทำงาน\)'\):''\}/.test(app));
  ok_('...and puts the people still working first', /\.sort\(\(a,b\)=>\(a\.ended\?1:0\)-\(b\.ended\?1:0\)\)/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
