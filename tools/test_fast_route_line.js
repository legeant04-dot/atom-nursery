/**
 * tools/test_fast_route_line.js — a route that SENDS LINE on the fast host sends exactly what Apps Script sends
 *   node tools/test_fast_route_line.js          (offline — the GAS harness on one side, server/routes.js on the other)
 *
 * W2 of docs/FAST_HOST_WRITES_PLAN.md (2026-11-09). On the host, linePush_ writes { to, messages } down
 * instead of calling LINE; the host sends the list after it commits (server/line_send.js). Everything that
 * DECIDES — the topic switch, who the parents are, the "no LINE id, skip" rule, demo mode — is Apps Script's
 * own code on both sides. So a step here is proven when, from the same rows, both sides give:
 *
 *   the same reply · the same rows in every sheet · the same LINE messages, to the same people, in the same order
 *
 * And the cases that must hold whatever the route:
 *   🔴 a topic switched off sends nothing · 'app' only rings the bell and sends no LINE
 *   🔴 demo mode sends nothing · a parent with no LINE id is skipped · one person is messaged once
 *   🔴 a refused call (not this teacher's class, no report that day) sends nothing and writes nothing
 *   🔴 with no token (host: LINE_SEND=off) the write still happens and nothing is recorded
 */
'use strict';
const path = require('path');
let pass = 0, fail = 0;
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  console.log((okk ? '  ok   ' : '  FAIL ') + label + (okk ? '' : '\n         got=' + JSON.stringify(got).slice(0, 600) + '\n        want=' + JSON.stringify(want).slice(0, 600)));
  okk ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const ROUTES = require(path.join(__dirname, '..', 'server', 'routes.js'));
delete process.env.ATOM_DB;
const FILES = ['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Checkin', 'Triggers', 'Leave', 'Notify', 'Parent', 'Staff',
  'GasEngine', 'Engine', 'Payroll', 'Day6', 'OtStaff', 'OT', 'Certificate', 'Dspm', 'DspmAdmin', 'Journal', 'Announce', 'Demo'];
const G = require('./gas_test_harness.js')(FILES);

const SHEETS = [['MAIN', 'SCHOOL_CONFIG'], ['MAIN', 'DAILY_JOURNAL'], ['MAIN', 'STUDENTS'], ['MAIN', 'PARENTS'], ['MAIN', 'USER_LINKS'],
  ['MAIN', 'ADMIN_INBOX'], ['MAIN', 'AUDIT_LOG'], ['HR', 'AUDIT_LOG'], ['HR', 'STAFF'],
  // routes 2–4: the homeroom table, the children's leave, and the two places the admin fallback reads
  ['MAIN', 'CLASSES'], ['MAIN', 'LEAVE_REQUEST_STD'], ['MAIN', 'USERS'], ['MAIN', 'LINE_RECIPIENTS'],
  // W3: staff leave
  ['HR', 'LEAVE_REQUEST']];

/* 🔴 a token on Apps Script's side, so its linePush_ really "sends" (to the harness's recorder) — the
 * host never reads it: its answer comes from line.ready */
const FIX = {
  SCHOOL_CONFIG: [['Departments', 'N1,N2'], ['LineChannelAccessToken', 'test-token-not-real'], ['NotifyParentJournalReply', 'app,line'],
    ['NotifyStaffComment', 'app,line'], ['NotifyStaffLeave', 'app,line'], ['NotifyParentLeave', 'app,line']],
  CLASSES: [{ ClassName: 'N1', TeacherID: 'STF-T' }, { ClassName: 'N2', TeacherID: '' }],
  LEAVE_REQUEST_STD: [], USERS: [],
  // the admin fallback: someone the school put on the list for comments and leaves
  LINE_RECIPIENTS: [{ Name: 'แอดมิน', LineUID: 'Uadmin00000001', Topics: 'comment,leave', Active: 'YES', Note: '' }],
  STUDENTS: [{ StudentID: 'STD-1', Name: 'เด็กหนึ่ง', Nickname: 'หนึ่ง', Class: 'N1', Status: 'ACTIVE' },
             { StudentID: 'STD-2', Name: 'เด็กสอง', Nickname: '', Class: 'N1', Status: 'ACTIVE' },
             { StudentID: 'STD-3', Name: 'เด็กสาม', Nickname: 'สาม', Class: 'N2', Status: 'ACTIVE' },
             // a class no teacher covers — anything about this child falls back to the admin
             { StudentID: 'STD-4', Name: 'เด็กสี่', Nickname: 'สี่', Class: 'N9', Status: 'ACTIVE' }],
  /* STD-1: two parents with LINE (one of them ALSO linked — must be messaged once) and one without */
  PARENTS: [{ ParentID: 'PAR-1', StudentID: 'STD-1', Name: 'แม่หนึ่ง', LineUID: 'Uaaaaaaaaaa0001' },
            { ParentID: 'PAR-2', StudentID: 'STD-1', Name: 'พ่อหนึ่ง', LineUID: '' },
            { ParentID: 'PAR-3', StudentID: 'STD-2', Name: 'แม่สอง', LineUID: '' }],
  USER_LINKS: [{ UserUID: 'Ubbbbbbbbbb0002', StudentID: 'STD-1', Role: 'Parent' },
               { UserUID: 'Uaaaaaaaaaa0001', StudentID: 'STD-1', Role: 'Parent' }],
  DAILY_JOURNAL: [{ Date: '2026-11-05', StudentID: 'STD-1', TeacherID: 'STF-T', Mood: 'ยิ้ม', Status: 'SUBMITTED', ParentComment: 'ขอบคุณครับ', TeacherReply: '' },
                  { Date: '2026-11-05', StudentID: 'STD-2', TeacherID: 'STF-T', Mood: 'เฉย', Status: 'SUBMITTED', ParentComment: 'ทานข้าวไหม', TeacherReply: '' },
                  { Date: '2026-11-05', StudentID: 'STD-3', TeacherID: 'STF-U', Mood: 'ยิ้ม', Status: 'SUBMITTED', ParentComment: 'x', TeacherReply: '' },
                  { Date: '2026-11-05', StudentID: 'STD-4', TeacherID: 'STF-T', Mood: 'ยิ้ม', Status: 'SUBMITTED', ParentComment: '', TeacherReply: '' }],
  STAFF: [{ StaffID: 'STF-T', Name: 'ครูที', Role: 'Teacher', PositionLevel: 'Teacher', Department: 'N1', Status: 'ACTIVE', LineUID: 'Uttttttttttt0009' },
          { StaffID: 'STF-U', Name: 'ครูยู', Role: 'Teacher', PositionLevel: 'Teacher', Department: 'N2', Status: 'ACTIVE' }],
  ADMIN_INBOX: []
};

G.g.__FIX = JSON.stringify(FIX); G.g.__SHEETS = JSON.stringify(SHEETS);
G.run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var F = JSON.parse(__FIX), main = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
  var cfg = sheet_(main, 'SCHOOL_CONFIG');
  if (cfg.getLastRow() > 1) cfg.deleteRows(2, cfg.getLastRow() - 1);
  F.SCHOOL_CONFIG.forEach(function (kv) { appendObject_(cfg, { Key: kv[0], Value: kv[1] }); });
  JSON.parse(__SHEETS).forEach(function (x) {
    var sh = sheet_(x[0] === 'HR' ? hr : main, x[1]);
    if (x[1] !== 'SCHOOL_CONFIG' && sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    (x[1] === 'SCHOOL_CONFIG' ? [] : (F[x[1]] || [])).forEach(function (r) { appendObject_(sh, r); });
  });
  _configCache = null;
  return '';
});

const gasState = () => JSON.parse(G.run(function () {
  var out = {}, main = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
  JSON.parse(__SHEETS).forEach(function (x) {
    out[(x[0] === 'HR' && x[1] === 'AUDIT_LOG') ? 'HR_AUDIT_LOG' : x[1]] = readObjects_(sheet_(x[0] === 'HR' ? hr : main, x[1]))
      .map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; return o; });
  });
  return JSON.stringify(out);
}));

let nextId = 1;
const db = {};
{ const s = gasState(); Object.keys(s).forEach(k => { db[k] = s[k].map(r => Object.assign({ __id: 'r' + (nextId++) }, r)); }); }
const applyOps = ops => ops.forEach(o => {
  const t = db[o.sheet] || (db[o.sheet] = []);
  if (o.op === 'insert') { const id = 'r' + (nextId++); t.push(Object.assign({ __id: id }, JSON.parse(JSON.stringify(o.row)))); o.__real = id; return; }
  const id = String(o.id).indexOf('new:') === 0 ? ops.find(x => x.tmp === o.id).__real : o.id;
  const i = t.findIndex(r => r.__id === id); if (i < 0) throw new Error('op on a missing row ' + o.sheet + ' ' + id);
  if (o.op === 'update') Object.assign(t[i], JSON.parse(JSON.stringify(o.patch))); else t.splice(i, 1);
});
/* the host: what it would SAVE (ops) and what it would SEND (line.out) — the send is the host's, after commit */
let HOST_READY = true;
const host = (action, payload) => {
  const raw = {}; ROUTES.needs([action]).forEach(s => { raw[s] = JSON.parse(JSON.stringify(db[s] || [])); });
  const sink = [], line = { ready: HOST_READY, out: [] };
  try { const data = ROUTES.run(action, payload, raw, {}, {}, sink, line); applyOps(sink); return { ok: true, data, ops: sink.length, line: line.out }; }
  catch (e) { return { ok: false, code: e.apiCode || e.message, msg: e.message, ops: 0, line: line.out }; }
};
/* Apps Script: the harness's UrlFetchApp records every push (PUSH) — emptied before each step */
const gas = (fn, payload) => { G.g.__P = JSON.stringify(payload); G.g.__F = fn; return JSON.parse(G.run(function () {
  _configCache = null; PUSH.length = 0;
  var r;
  try { r = { ok: true, data: this[__F](JSON.parse(__P)) }; }
  catch (e) { r = { ok: false, code: e.apiCode || e.message }; }
  r.line = PUSH.slice();
  return JSON.stringify(r); })); };

/* change one config key on BOTH sides (a topic switch, demo mode, the token) */
const setCfg = (key, value) => {
  G.g.__K = key; G.g.__V = value;
  G.run(function () { _configCache = null; setConfigValue_(__K, __V); _configCache = null; return ''; });
  const row = db.SCHOOL_CONFIG.find(r => r.Key === key);
  if (row) row.Value = value; else db.SCHOOL_CONFIG.push({ __id: 'r' + (nextId++), Key: key, Value: value });
};
const setProp = (k, v) => { G.g.__K = k; G.g.__V = v; G.run(function () { PropertiesService.getScriptProperties().setProperty(__K, __V); return ''; }); };

const strip = rows => rows.map(r => { const o = Object.assign({}, r); delete o.__id; return o; });
const comparable = (name, rows) => strip(rows).map(r => {
  if (/AUDIT_LOG$/.test(name)) { const t = Date.parse(r.Timestamp); r.Timestamp = (isFinite(t) && Math.abs(Date.now() - t) < 120000) ? 'now' : r.Timestamp; }
  // inboxAdd_ makes IN-<ms>-<rand>; inboxAddMany_ (several teachers at once) makes IN-<ms>-<i>-<rand>
  // the moment a leave was filed or decided: equal when both sides wrote it within the same two minutes
  if (name === 'LEAVE_REQUEST') ['CreatedDate', 'Step1Date', 'Step2Date'].forEach(k => { const t = Date.parse(r[k]); if (r[k] && isFinite(t) && Math.abs(Date.now() - t) < 120000) r[k] = 'now'; });
  if (name === 'ADMIN_INBOX') { r.InboxID = /^IN-\d+(-\d+)+$/.test(r.InboxID) ? 'IN-…' : r.InboxID; r.Date = r.Date ? 'now' : r.Date; }
  return r;
});
const sameState = label => {
  const s = gasState(); const diff = [];
  Object.keys(s).forEach(k => { if (JSON.stringify(comparable(k, s[k])) !== JSON.stringify(comparable(k, db[k] || []))) diff.push(k); });
  ok_(label + ' — ทุกชีตเท่ากันทุกแถว' + (diff.length ? '  ต่างที่: ' + diff.join(', ') : ''), !diff.length);
  if (diff.length) diff.forEach(k => console.log('         ' + k + '\n           gas=' + JSON.stringify(comparable(k, s[k])).slice(0, 400) + '\n          host=' + JSON.stringify(comparable(k, db[k] || [])).slice(0, 400)));
};
/* a host push as Apps Script's harness records one: { to, text } — and only ever one text message */
const hostPushes = list => list.map(p => (p.messages.length === 1 && p.messages[0].type === 'text') ? { to: p.to, text: p.messages[0].text } : { to: p.to, bad: p.messages });

const got = {};
function step(a, fn, p, label) {
  const w = gas(fn, p), h = host(a, p);
  got[label] = { gas: w, host: h };
  const sameReply = JSON.stringify(w.ok ? { ok: true, data: w.data } : { ok: false, code: w.code }) === JSON.stringify(h.ok ? { ok: true, data: h.data } : { ok: false, code: h.code });
  ok_(a + ' · ' + label + ' — คำตอบเท่ากัน' + (sameReply ? '' : '\n         gas=' + JSON.stringify(w).slice(0, 300) + '\n        host=' + JSON.stringify(h).slice(0, 300)), sameReply);
  sameState(a + ' · ' + label);
  eq(a + ' · ' + label + ' — LINE: ผู้รับ ข้อความ ลำดับ เท่ากัน', hostPushes(h.line), w.line);
  return { gas: w, host: h };
}

console.log('\n1) saveTeacherReply — ครูตอบความเห็นผู้ปกครอง → กระดิ่ง + LINE ของครอบครัว');
const R = 'saveTeacherReply', F = 'handleSaveTeacherReply';
const s1 = step(R, F, { staffId: 'STF-T', studentId: 'STD-1', date: '2026-11-05', reply: 'ทานหมดจานค่ะ' }, 'เปิด app,line');
eq('ส่งถึงผู้ปกครองสองคน คนละหนึ่งครั้ง (คนที่อยู่ทั้งสองที่ ได้ครั้งเดียว · คนไม่มี LINE ถูกข้าม)', s1.host.line.map(p => p.to), ['Uaaaaaaaaaa0001', 'Ubbbbbbbbbb0002']);
ok_('ข้อความมีชื่อเล่นเด็ก วันที่ และคำตอบของครู', /หนึ่ง/.test(s1.host.line[0].messages[0].text) && /2026-11-05/.test(s1.host.line[0].messages[0].text) && /ทานหมดจานค่ะ/.test(s1.host.line[0].messages[0].text));
eq('🔔 กระดิ่งของครอบครัว หนึ่งแถวต่อเด็ก', db.ADMIN_INBOX.map(r => r.StudentID + ':' + r.Category), ['STD-1:parent']);
eq('คำตอบถูกบันทึก', db.DAILY_JOURNAL[0].TeacherReply, 'ทานหมดจานค่ะ');

step(R, F, { staffId: 'STF-T', studentId: 'STD-2', date: '2026-11-05', reply: 'ทานครึ่งจาน' }, 'เด็กที่ไม่มีผู้ปกครองคนไหนมี LINE');
eq('...ไม่ส่งเลย แต่กระดิ่งยังดัง', [got['เด็กที่ไม่มีผู้ปกครองคนไหนมี LINE'].host.line.length, db.ADMIN_INBOX.length], [0, 2]);

setCfg('NotifyParentJournalReply', 'app');
step(R, F, { staffId: 'STF-T', studentId: 'STD-1', date: '2026-11-05', reply: 'แก้คำตอบ (app)' }, "สวิตช์ 'app' อย่างเดียว");
eq("...กระดิ่งเพิ่ม ไม่มี LINE", [got["สวิตช์ 'app' อย่างเดียว"].host.line.length, db.ADMIN_INBOX.length], [0, 3]);

setCfg('NotifyParentJournalReply', '');
step(R, F, { staffId: 'STF-T', studentId: 'STD-1', date: '2026-11-05', reply: 'แก้คำตอบ (ปิด)' }, 'สวิตช์ปิด');
eq('...ไม่มีกระดิ่ง ไม่มี LINE แต่คำตอบบันทึก', [got['สวิตช์ปิด'].host.line.length, db.ADMIN_INBOX.length, db.DAILY_JOURNAL[0].TeacherReply], [0, 3, 'แก้คำตอบ (ปิด)']);

setCfg('NotifyParentJournalReply', 'true');      // the value written before channels existed: means both
step(R, F, { staffId: 'STF-T', studentId: 'STD-1', date: '2026-11-05', reply: 'ค่าเก่า true' }, "ค่าเก่า 'true' = ทั้งสองช่อง");

setCfg('DemoMode', 'true'); setProp('ATOM_DEMO', '1');
step(R, F, { staffId: 'STF-T', studentId: 'STD-1', date: '2026-11-05', reply: 'ในโหมดสาธิต' }, '🔴 โหมดสาธิต');
eq('🔴 ...โหมดสาธิตไม่ส่ง LINE ทั้งสองฝั่ง', [got['🔴 โหมดสาธิต'].gas.line.length, got['🔴 โหมดสาธิต'].host.line.length], [0, 0]);
setCfg('DemoMode', 'false'); setProp('ATOM_DEMO', '');
{ // the host is STRICTER: DemoMode alone stops it — Apps Script also needs ATOM_DEMO (which the host has no way to read)
  setCfg('DemoMode', 'true');
  const keep = JSON.stringify(db);                       // a host-only check: run it, then put the host's rows back
  const h = host(R, { staffId: 'STF-T', studentId: 'STD-1', date: '2026-11-05', reply: 'DemoMode เท่านั้น' });
  Object.keys(db).forEach(k => delete db[k]); Object.assign(db, JSON.parse(keep));
  ok_('🔴 โฮสต์: DemoMode=true อย่างเดียวก็ไม่ส่ง (เข้มกว่า Apps Script)', h.ok && h.line.length === 0);
  setCfg('DemoMode', 'false');
}
sameState('หลังทดสอบ DemoMode — สองฝั่งยังเท่ากัน');

step(R, F, { staffId: 'STF-U', studentId: 'STD-1', date: '2026-11-05', reply: 'ครูต่างชั้น' }, '🔴 ครูที่ไม่ได้ดูแลชั้นนี้');
eq('🔴 ...ปฏิเสธ ไม่ส่ง ไม่บันทึก', [got['🔴 ครูที่ไม่ได้ดูแลชั้นนี้'].host.code, got['🔴 ครูที่ไม่ได้ดูแลชั้นนี้'].host.line.length, got['🔴 ครูที่ไม่ได้ดูแลชั้นนี้'].host.ops], ['NO_ACCESS', 0, 0]);
step(R, F, { staffId: 'STF-T', studentId: 'STD-1', date: '2026-11-04', reply: 'วันที่ไม่มีบันทึก' }, '🔴 วันที่ไม่มีบันทึก');
eq('🔴 ...NOT_FOUND ไม่ส่ง', [got['🔴 วันที่ไม่มีบันทึก'].host.code, got['🔴 วันที่ไม่มีบันทึก'].host.line.length], ['NOT_FOUND', 0]);

/* no token: Apps Script has none in SCHOOL_CONFIG; the host runs with LINE_SEND=off (ready false) */
setCfg('LineChannelAccessToken', ''); HOST_READY = false;
step(R, F, { staffId: 'STF-T', studentId: 'STD-1', date: '2026-11-05', reply: 'ไม่มี token' }, 'ไม่มี token');
eq('...บันทึกได้ ไม่ส่ง', [got['ไม่มี token'].host.ok, got['ไม่มี token'].host.line.length, db.DAILY_JOURNAL[0].TeacherReply], [true, 0, 'ไม่มี token']);
setCfg('LineChannelAccessToken', 'test-token-not-real'); HOST_READY = true;

console.log('\n2) saveParentComment — ผู้ปกครองเขียนความเห็น → ครูประจำชั้น (🔔 เสมอ · LINE ตามหัวข้อ staff.comment)');
{
  const A = 'saveParentComment', Fn = 'handleSaveParentComment';
  const c1 = step(A, Fn, { parentId: 'PAR-1', uid: 'Uaaaaaaaaaa0001', studentId: 'STD-1', date: '2026-11-05', comment: 'ทานข้าวเยอะไหมคะ' }, 'ครูมี LINE');
  eq('ส่งถึงครูประจำชั้นคนเดียว', c1.host.line.map(p => p.to), ['Uttttttttttt0009']);
  ok_('ข้อความบอกชื่อเด็ก วันที่ และความเห็น', /หนึ่ง/.test(c1.host.line[0].messages[0].text) && /ทานข้าวเยอะไหมคะ/.test(c1.host.line[0].messages[0].text));
  setCfg('NotifyStaffComment', 'app');
  const c2 = step(A, Fn, { parentId: 'PAR-1', uid: 'Uaaaaaaaaaa0001', studentId: 'STD-1', date: '2026-11-05', comment: 'แก้ความเห็น' }, "staff.comment = 'app'");
  eq("...กระดิ่งครูดัง ไม่มี LINE", c2.host.line.length, 0);
  setCfg('NotifyStaffComment', 'app,line');
  // N2's only teacher has no LINE and N2 has no homeroom teacher of record → the bell only
  const c3 = step(A, Fn, { parentId: 'PAR-9', studentId: 'STD-3', date: '2026-11-05', comment: 'ชั้นสอง' }, 'ครูไม่มี LINE');
  eq('...ไม่ส่ง LINE (กระดิ่งของครูยังดัง)', c3.host.line.length, 0);
  const c5 = step(A, Fn, { parentId: 'PAR-9', studentId: 'STD-4', date: '2026-11-05', comment: 'ไม่มีครูดูแล' }, 'ไม่มีครูคนไหนดูแลชั้นนี้');
  eq('...ตกไปที่แอดมิน: LINE ถึงคนในรายชื่อหัวข้อ comment', c5.host.line.map(p => p.to), ['Uadmin00000001']);
  const c4 = step(A, Fn, { parentId: 'PAR-1', studentId: 'STD-1', date: '2026-11-04', comment: 'ไม่มีบันทึก' }, '🔴 วันที่ไม่มีบันทึก');
  eq('🔴 ...NOT_FOUND ไม่ส่ง ไม่บันทึก', [c4.host.code, c4.host.line.length, c4.host.ops], ['NOT_FOUND', 0, 0]);
}

console.log('\n3) studentAbsence — ผู้ปกครองแจ้งลา → ครู (🔔 เสมอ · LINE ตามหัวข้อ staff.leave)');
{
  const A = 'studentAbsence', Fn = 'handleStudentAbsence';
  const a1 = step(A, Fn, { parentId: 'PAR-1', uid: 'Uaaaaaaaaaa0001', __role: 'Parent', studentId: 'STD-1', date: '2026-11-19', dateTo: '2026-11-20', type: 'ลาป่วย', reason: 'มีไข้' }, 'ลา 2 วัน');
  eq('บันทึกวันลา 2 แถว · ส่งครูคนเดียว', [db.LEAVE_REQUEST_STD.length, a1.host.line.map(p => p.to)], [2, ['Uttttttttttt0009']]);
  ok_('ข้อความมีช่วงวัน เหตุผล และชื่อผู้ปกครอง', /มีไข้/.test(a1.host.line[0].messages[0].text) && /แม่หนึ่ง/.test(a1.host.line[0].messages[0].text));
  const a2 = step(A, Fn, { parentId: 'PAR-1', uid: 'Uaaaaaaaaaa0001', __role: 'Parent', studentId: 'STD-1', date: '2026-11-19', dateTo: '2026-11-20', type: 'ลาป่วย', reason: 'มีไข้' }, '🔴 กดส่งซ้ำ');
  eq('🔴 ...ไม่บันทึกซ้ำ และไม่ส่งซ้ำ', [db.LEAVE_REQUEST_STD.length, a2.host.line.length, a2.host.data && a2.host.data.duplicate], [2, 0, true]);
  setCfg('NotifyStaffLeave', '');
  const a3 = step(A, Fn, { parentId: 'PAR-1', uid: 'Uaaaaaaaaaa0001', __role: 'Parent', studentId: 'STD-1', date: '2026-11-23', type: 'ลากิจ', reason: '' }, 'staff.leave ปิด');
  eq('...บันทึกวันลา แต่ไม่ส่ง LINE', [db.LEAVE_REQUEST_STD.length, a3.host.line.length], [3, 0]);
  setCfg('NotifyStaffLeave', 'app,line');
}

console.log('\n4) teacherStudentLeave — ครูแจ้งลาแทน → ครอบครัว (🔔 + LINE ตามหัวข้อ parent.leave)');
{
  const A = 'teacherStudentLeave', Fn = 'handleTeacherStudentLeave';
  const t1 = step(A, Fn, { staffId: 'STF-T', studentId: 'STD-1', date: '2026-11-24', reason: 'ผู้ปกครองโทรแจ้ง' }, 'ครูประจำชั้น');
  eq('ส่งถึงผู้ปกครองสองคน คนละครั้ง', t1.host.line.map(p => p.to), ['Uaaaaaaaaaa0001', 'Ubbbbbbbbbb0002']);
  const t2 = step(A, Fn, { staffId: 'STF-U', studentId: 'STD-1', date: '2026-11-25', reason: 'ต่างชั้น' }, '🔴 ครูต่างชั้น');
  eq('🔴 ...ปฏิเสธ ไม่บันทึก ไม่ส่ง', [t2.host.ok, t2.host.ops, t2.host.line.length], [false, 0, 0]);
  setCfg('NotifyParentLeave', 'app');
  const t3 = step(A, Fn, { staffId: 'STF-T', studentId: 'STD-1', date: '2026-11-26', reason: 'app อย่างเดียว' }, "parent.leave = 'app'");
  eq("...ไม่มี LINE", t3.host.line.length, 0);
  setCfg('NotifyParentLeave', 'app,line');
  setCfg('DemoMode', 'true'); setProp('ATOM_DEMO', '1');
  const t4 = step(A, Fn, { staffId: 'STF-T', studentId: 'STD-1', date: '2026-11-27', reason: 'สาธิต' }, '🔴 โหมดสาธิต');
  eq('🔴 ...ทั้งสองฝั่งไม่ส่ง', [t4.gas.line.length, t4.host.line.length], [0, 0]);
  setCfg('DemoMode', 'false'); setProp('ATOM_DEMO', '');
}

console.log('\n5) W3 · submitLeave / approveLeave — ใบลาครู 2 ขั้น (หัวหน้า → แอดมิน)');
{
  /* the people of this section join BOTH sides now, so sections 1–4 ran on the school they were written for */
  const addRow = (bookName, sheet, row) => { G.g.__B = bookName; G.g.__S = sheet; G.g.__R = JSON.stringify(row);
    G.run(function () { appendObject_(sheet_(__B === 'HR' ? getHrSpreadsheet_() : getMainSpreadsheet_(), __S), JSON.parse(__R)); return ''; });
    const rows = gasState()[sheet]; db[sheet].push(Object.assign({ __id: 'r' + (nextId++) }, rows[rows.length - 1])); };
  addRow('HR', 'STAFF', { StaffID: 'STF-L', Name: 'หัวหน้าแอล', Role: 'Teacher', PositionLevel: 'Leader', Department: 'N1', Status: 'ACTIVE', LineUID: 'Ullllllllllll0007' });
  addRow('HR', 'STAFF', { StaffID: 'STF-M', Name: 'หัวหน้าเอ็ม', Role: 'Teacher', PositionLevel: 'Leader', Department: 'N2', Status: 'ACTIVE', LineUID: '' });
  addRow('HR', 'STAFF', { StaffID: 'STF-A', Name: 'แอดมินเอ', Role: 'Admin', PositionLevel: 'Admin', Department: 'OFFICE', Status: 'ACTIVE', LineUID: 'Uadminstaff00003' });
  addRow('MAIN', 'LINE_RECIPIENTS', { Name: 'ผอ.', LineUID: 'Udirector000004', Topics: 'approval', Active: 'YES', Note: '' });
  setCfg('NotifyStaffApprovalQueue', 'app,line'); setCfg('NotifyStaffApproval', 'app,line'); setCfg('NotifyAdminApproval', 'app');
  sameState('ตั้งต้นส่วนที่ 5');
  const S = 'submitLeave', SF = 'handleSubmitLeave', A = 'approveLeave', AF = 'handleApproveLeave';
  const inbox0 = db.ADMIN_INBOX.length;

  const l1 = step(S, SF, { staffId: 'STF-T', type: 'ลาป่วย', startDate: '2026-12-01', endDate: '2026-12-02', reason: 'ไข้หวัด' }, 'ครูยื่นลา 2 วัน');
  const id1 = l1.host.data && l1.host.data.leaveId;
  eq('ใบลาใหม่: รอหัวหน้า · 2 วัน', [l1.host.data.status, l1.host.data.days, db.LEAVE_REQUEST.length], ['PENDING_LEADER', 2, 1]);
  eq('LINE ถึงหัวหน้าที่มี LINE เท่านั้น (อีกคนได้กระดิ่ง)', [l1.host.line.map(p => p.to), db.ADMIN_INBOX.length - inbox0], [['Ullllllllllll0007'], 2]);

  const l2 = step(S, SF, { staffId: 'STF-T', type: 'ลากิจ', startDate: '2026-12-02', endDate: '2026-12-02', reason: 'ซ้ำ' }, '🔴 ลาซ้ำวันเดิม');
  eq('🔴 ...LEAVE_OVERLAP ไม่บันทึก ไม่ส่ง', [l2.host.code, l2.host.ops, l2.host.line.length, db.LEAVE_REQUEST.length], ['LEAVE_OVERLAP', 0, 0, 1]);
  const l3 = step(S, SF, { staffId: 'STF-T', type: 'Sick Leave', startDate: '2026-12-08', endDate: '2026-12-08', halfDay: 'AM', reason: 'หมอนัด' }, 'ลาครึ่งวันเช้า (ชนิดเป็นอังกฤษ)');
  eq('💰 ครึ่งวัน = 0.5 วัน และชนิดถูกบันทึกเป็นไทย', [l3.host.data.days, db.LEAVE_REQUEST[1].Days, db.LEAVE_REQUEST[1].Type, db.LEAVE_REQUEST[1].HalfDay], [0.5, 0.5, 'ลาป่วย', 'AM']);
  step(S, SF, { staffId: 'STF-T', type: 'ลากิจ', startDate: '2026-12-08', endDate: '2026-12-08', halfDay: 'PM', reason: 'บ่าย' }, 'ครึ่งวันบ่ายของวันเดียวกัน ไม่ชน');
  const l5 = step(S, SF, { staffId: 'STF-T', type: 'ลากิจ', startDate: '2026-12-09', endDate: '2026-12-10', halfDay: 'AM' }, '🔴 ครึ่งวันแต่หลายวัน');
  eq('🔴 ...BAD_INPUT', l5.host.code, 'BAD_INPUT');
  const l6 = step(S, SF, { staffId: 'STF-T', type: 'ลากิจ', startDate: '2026-12-12', endDate: '2026-12-11' }, '🔴 วันสิ้นสุดก่อนวันเริ่ม');
  eq('🔴 ...BAD_DATES', l6.host.code, 'BAD_DATES');
  const l7 = step(S, SF, { staffId: 'STF-L', type: 'ลาพักร้อน', startDate: '2026-12-15', endDate: '2026-12-15', reason: 'พักร้อน' }, 'หัวหน้ายื่นลา → ข้ามขั้นแรก');
  eq('...รอแอดมินทันที · LINE ถึงคนในรายชื่อหัวข้อ approval', [l7.host.data.status, l7.host.line.map(p => p.to)], ['PENDING_ADMIN', ['Udirector000004']]);
  /* the two sides DIFFER here on purpose, so this one is not a step(): the host refuses, Apps Script files it */
  const P8 = { staffId: 'STF-T', type: 'ลาป่วย', startDate: '2026-12-16', endDate: '2026-12-16', attachment: 'data:image/png;base64,iVBORw0KGgo=' };
  const l8 = { host: host(S, P8), gas: gas(SF, P8) };
  ok_('...Apps Script รับใบที่มีรูปตามเดิม', l8.gas.ok && l8.gas.line.length === 1);
  eq('🔴 ...โฮสต์ไม่รับ ส่งต่อ Apps Script · ไม่บันทึก ไม่ส่ง', [l8.host.code, l8.host.ops, l8.host.line.length], ['NOT_ON_FAST_HOST', 0, 0]);
  { // Apps Script kept that one (it owns Drive) — give the host the same row, as the app's re-ask would
    const rows = gasState().LEAVE_REQUEST; if (rows.length === db.LEAVE_REQUEST.length + 1) db.LEAVE_REQUEST.push(Object.assign({ __id: 'r' + (nextId++) }, rows[rows.length - 1]));
    const ib = gasState().ADMIN_INBOX; while (db.ADMIN_INBOX.length < ib.length) db.ADMIN_INBOX.push(Object.assign({ __id: 'r' + (nextId++) }, ib[db.ADMIN_INBOX.length]));
    const au = gasState().HR_AUDIT_LOG; while ((db.HR_AUDIT_LOG || (db.HR_AUDIT_LOG = [])).length < au.length) db.HR_AUDIT_LOG.push(Object.assign({ __id: 'r' + (nextId++) }, au[db.HR_AUDIT_LOG.length]));
    sameState('หลังใบที่มีรูป (Apps Script เป็นคนบันทึก)'); }

  const p1 = step(A, AF, { staffId: 'STF-U', leaveId: id1, decision: 'approve' }, '🔴 ครูธรรมดาอนุมัติ');
  eq('🔴 ...NO_PERMISSION', [p1.host.code, p1.host.ops], ['NO_PERMISSION', 0]);
  const p2 = step(A, AF, { staffId: 'STF-M', leaveId: id1, decision: 'approve' }, 'หัวหน้าต่างแผนกอนุมัติขั้นแรก');
  eq('...ข้ามแผนก: แจ้งหัวหน้าแผนกเจ้าของ + แอดมิน 2 ข้อความ', [p2.host.data.status, p2.host.data.crossDept, p2.host.line.map(p => p.to)],
    ['PENDING_ADMIN', true, ['Ullllllllllll0007', 'Udirector000004', 'Udirector000004']]);
  const p3 = step(A, AF, { staffId: 'STF-L', leaveId: id1, decision: 'approve' }, '🔴 หัวหน้าอนุมัติขั้นสุดท้าย');
  eq('🔴 ...NO_PERMISSION (ขั้นสุดท้ายเป็นของแอดมิน)', p3.host.code, 'NO_PERMISSION');
  const p4 = step(A, AF, { staffId: 'STF-A', leaveId: id1, decision: 'approve', note: 'หายไว ๆ' }, 'แอดมินอนุมัติขั้นสุดท้าย');
  const row1 = db.LEAVE_REQUEST.find(r => r.LeaveID === id1);
  eq('💰 ใบลา APPROVED พร้อมชื่อผู้อนุมัติทั้งสองขั้น · LINE ถึงครูผู้ขอ',
    [row1.Status, row1.Step1ApproverName, row1.Step1CrossDept, row1.Step2ApproverName, row1.Step2Status, p4.host.line.map(p => p.to)],
    ['APPROVED', 'หัวหน้าเอ็ม', 'YES', 'แอดมินเอ', 'Approved', ['Uttttttttttt0009']]);
  ok_('ข้อความถึงครูมีหมายเหตุของแอดมิน', /หายไว ๆ/.test(p4.host.line[0].messages[0].text));
  const p5 = step(A, AF, { staffId: 'STF-A', leaveId: id1, decision: 'reject' }, '🔴 ตัดสินซ้ำ');
  eq('🔴 ...ALREADY_RESOLVED ไม่เปลี่ยนอะไร', [p5.host.code, p5.host.ops, db.LEAVE_REQUEST.find(r => r.LeaveID === id1).Status], ['ALREADY_RESOLVED', 0, 'APPROVED']);
  const id3 = l3.host.data.leaveId;
  const p6 = step(A, AF, { staffId: 'STF-L', leaveId: id3, decision: 'reject', note: 'คนไม่พอ' }, 'หัวหน้าแผนกเดียวกันปฏิเสธ');
  eq('...REJECTED · LINE ถึงครูผู้ขอ พร้อมเหตุผล', [p6.host.data.status, p6.host.line.map(p => p.to), /คนไม่พอ/.test((p6.host.line[0] || { messages: [{ text: '' }] }).messages[0].text)], ['REJECTED', ['Uttttttttttt0009'], true]);
  const l9 = step(S, SF, { staffId: 'STF-T', type: 'ลากิจ', startDate: '2026-12-08', endDate: '2026-12-08', halfDay: 'AM', reason: 'ขอใหม่' }, 'ใบที่ถูกปฏิเสธไม่กันช่วงเวลา');
  eq('...ยื่นช่วงเดิมใหม่ได้', l9.host.ok, true);
  const p7 = step(A, AF, { staffId: 'STF-A', leaveId: 'LV0000-999', decision: 'approve' }, '🔴 ไม่มีใบนี้');
  eq('🔴 ...NOT_FOUND', p7.host.code, 'NOT_FOUND');
  setCfg('NotifyStaffApproval', 'app');
  const p8 = step(A, AF, { staffId: 'STF-A', leaveId: l7.host.data.leaveId, decision: 'reject' }, "staff.approval = 'app'");
  eq('...บันทึกผล กระดิ่งดัง ไม่มี LINE', [p8.host.data.status, p8.host.line.length], ['REJECTED', 0]);
  setCfg('NotifyStaffApproval', 'app,line');
}

console.log('\n9) 🔴 กฎของท่อ LINE ในกล่องทราย');
{
  const before = JSON.stringify(db);
  const raw = {}; ROUTES.needs([R]).forEach(s => { raw[s] = JSON.parse(JSON.stringify(db[s] || [])); });
  let e1 = null; try { ROUTES.run(R, { staffId: 'STF-T', studentId: 'STD-1', date: '2026-11-05', reply: 'x' }, raw, {}, {}, []); } catch (e) { e1 = e; }
  ok_('🔴 route ที่ส่ง LINE แต่ไม่มีที่จด → ล้ม (ไม่ส่งเงียบ ๆ)', e1 && e1.apiCode === 'NOT_ON_FAST_HOST' && /nowhere to record/.test(e1.message));
  const saved = ROUTES.PORTED[R].line; delete ROUTES.PORTED[R].line;
  const h = host(R, { staffId: 'STF-T', studentId: 'STD-1', date: '2026-11-05', reply: 'ไม่ได้ประกาศ line' });
  ROUTES.PORTED[R].line = saved;
  ok_('🔴 route ที่ไม่ได้ประกาศ line แต่ส่ง → NOT_ON_FAST_HOST และไม่บันทึกอะไรเลย', !h.ok && h.code === 'NOT_ON_FAST_HOST' && /linePushText_|linePush_/.test(h.msg) && JSON.stringify(db) === before && h.line.length === 0);
  ok_('route ของ W1 ยังไม่มีสิทธิ์ส่ง LINE', !ROUTES.sendsLine('recallJournalsMany') && !ROUTES.sendsLine('notifications') && ROUTES.sendsLine(R));
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
