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
  ['MAIN', 'ADMIN_INBOX'], ['MAIN', 'AUDIT_LOG'], ['HR', 'AUDIT_LOG'], ['HR', 'STAFF']];

/* 🔴 a token on Apps Script's side, so its linePush_ really "sends" (to the harness's recorder) — the
 * host never reads it: its answer comes from line.ready */
const FIX = {
  SCHOOL_CONFIG: [['Departments', 'N1,N2'], ['LineChannelAccessToken', 'test-token-not-real'], ['NotifyParentJournalReply', 'app,line']],
  STUDENTS: [{ StudentID: 'STD-1', Name: 'เด็กหนึ่ง', Nickname: 'หนึ่ง', Class: 'N1', Status: 'ACTIVE' },
             { StudentID: 'STD-2', Name: 'เด็กสอง', Nickname: '', Class: 'N1', Status: 'ACTIVE' },
             { StudentID: 'STD-3', Name: 'เด็กสาม', Nickname: 'สาม', Class: 'N2', Status: 'ACTIVE' }],
  /* STD-1: two parents with LINE (one of them ALSO linked — must be messaged once) and one without */
  PARENTS: [{ ParentID: 'PAR-1', StudentID: 'STD-1', Name: 'แม่หนึ่ง', LineUID: 'Uaaaaaaaaaa0001' },
            { ParentID: 'PAR-2', StudentID: 'STD-1', Name: 'พ่อหนึ่ง', LineUID: '' },
            { ParentID: 'PAR-3', StudentID: 'STD-2', Name: 'แม่สอง', LineUID: '' }],
  USER_LINKS: [{ UserUID: 'Ubbbbbbbbbb0002', StudentID: 'STD-1', Role: 'Parent' },
               { UserUID: 'Uaaaaaaaaaa0001', StudentID: 'STD-1', Role: 'Parent' }],
  DAILY_JOURNAL: [{ Date: '2026-11-05', StudentID: 'STD-1', TeacherID: 'STF-T', Mood: 'ยิ้ม', Status: 'SUBMITTED', ParentComment: 'ขอบคุณครับ', TeacherReply: '' },
                  { Date: '2026-11-05', StudentID: 'STD-2', TeacherID: 'STF-T', Mood: 'เฉย', Status: 'SUBMITTED', ParentComment: 'ทานข้าวไหม', TeacherReply: '' },
                  { Date: '2026-11-05', StudentID: 'STD-3', TeacherID: 'STF-U', Mood: 'ยิ้ม', Status: 'SUBMITTED', ParentComment: 'x', TeacherReply: '' }],
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
  if (name === 'ADMIN_INBOX') { r.InboxID = /^IN-\d+-\d+$/.test(r.InboxID) ? 'IN-…' : r.InboxID; r.Date = r.Date ? 'now' : r.Date; }
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

console.log('\n2) 🔴 กฎของท่อ LINE ในกล่องทราย');
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
