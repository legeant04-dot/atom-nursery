/**
 * tools/test_fast_routes.js — a Code.gs route run on the fast host answers what Apps Script answers
 *   node tools/test_fast_routes.js          (offline — the GAS harness on one side, server/routes.js on the other)
 *
 * 2026-11-05. server/routes.js runs Apps Script's OWN handler (src/Notify.gs handleNotifications for
 * the 🔔 bell) with its sheet reads answered from rows the host read out of Postgres. This suite puts
 * the same rows in both places and compares, for every kind of caller the bell has:
 *
 *   Admin (shared inbox) · a teacher (own inbox) · a teacher with none · a parent through PARENTS ·
 *   a parent linked only through USER_LINKS · a parent with no child (falls through to the engine) ·
 *   the 100-row cap and the newest-first order · a legacy row whose id carries no time
 *
 * And the two rules that make it safe to run off Apps Script:
 *   🔴 a ported route cannot write (every write primitive throws)
 *   🔴 reading a sheet the route did not declare throws — the host would not have loaded it
 * The same comparison through real Postgres and server/host.js: tools/test_fast_routes_live.js.
 */
'use strict';
const path = require('path');
let pass = 0, fail = 0;
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  console.log((okk ? '  ok   ' : '  FAIL ') + label + (okk ? '' : '\n         got=' + JSON.stringify(got).slice(0, 400) + '\n        want=' + JSON.stringify(want).slice(0, 400)));
  okk ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const ROUTES = require(path.join(__dirname, '..', 'server', 'routes.js'));
const FILES = ['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Checkin', 'Triggers', 'Leave',
  'Notify', 'Parent', 'Staff', 'GasEngine', 'Engine'];
delete process.env.ATOM_DB;
const H = require('./gas_test_harness.js')(FILES);

/* the fixture — the shapes the real writers (inboxAdd_ / inboxAddStudent_) produce */
const T0 = Date.UTC(2026, 9, 1, 1, 0, 0);
const inbox = [];
for (let i = 0; i < 105; i++) inbox.push({ InboxID: 'IN-' + (T0 + i * 60000) + '-' + i, Date: '2026-10-01 08:' + String(i % 60).padStart(2, '0'),
  Category: i % 3 ? 'approval' : 'leave', Text: 'แจ้งแอดมิน ' + i, Read: i % 4 ? '' : 'YES', Ref: i % 5 ? '' : 'leave|L-' + i, StaffID: '', StudentID: '' });
inbox.push({ InboxID: 'IN-legacy-1', Date: '2026-07-22 09:15', Category: 'approval', Text: 'แถวเก่าไม่มีเวลาใน id', Read: '', Ref: '', StaffID: '', StudentID: '' });
inbox.push({ InboxID: 'IN-' + (T0 + 5e6) + '-7', Date: '2026-10-01 10:23', Category: 'comment', Text: 'ผู้ปกครองส่งข้อความ', Read: '', Ref: 'comment|STD-1', StaffID: 'STF-T', StudentID: '' });
inbox.push({ InboxID: 'IN-' + (T0 + 6e6) + '-8', Date: '2026-10-01 10:40', Category: 'leave', Text: 'อนุมัติการลาแล้ว', Read: 'YES', Ref: '', StaffID: 'STF-T', StudentID: '' });
inbox.push({ InboxID: 'IN-' + (T0 + 7e6) + '-9', Date: '2026-10-01 11:00', Category: 'journal', Text: 'สมุดสื่อสารของหนึ่ง', Read: '', Ref: 'journal|STD-1', StaffID: '', StudentID: 'STD-1' });
inbox.push({ InboxID: 'IN-' + (T0 + 8e6) + '-10', Date: '2026-10-01 11:30', Category: 'checkin', Text: 'สองมาถึงโรงเรียนแล้ว', Read: '', Ref: '', StaffID: '', StudentID: 'STD-2' });
const parents = [{ ParentID: 'PAR-1', NameTH: 'แม่หนึ่ง', StudentID: 'STD-1', LineUID: 'U-P1' },
                 { ParentID: 'PAR-0', NameTH: 'ไม่มีลูกในระบบ', StudentID: '', LineUID: 'U-P0' }];
const links = [{ UserUID: 'U-P2', StudentID: 'STD-2', ParentID: 'PAR-2', Relation: 'พ่อ' },
               { UserUID: 'U-P1', StudentID: 'STD-1', ParentID: 'PAR-1', Relation: 'แม่' }];

H.g.__FIX = JSON.stringify({ inbox, parents, links });
H.run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var F = JSON.parse(__FIX), ss = getMainSpreadsheet_();
  F.inbox.forEach(function (r) { appendObject_(sheet_(ss, 'ADMIN_INBOX'), r); });
  F.parents.forEach(function (r) { appendObject_(sheet_(ss, 'PARENTS'), r); });
  F.links.forEach(function (r) { appendObject_(sheet_(ss, 'USER_LINKS'), r); });
  return '';
});
/* what the host reads out of Postgres: the sheet's rows, by column name (PG.readSheet's shape) */
const raw = JSON.parse(H.run(function () {
  var ss = getMainSpreadsheet_(), out = {};
  ['ADMIN_INBOX', 'PARENTS', 'USER_LINKS'].forEach(function (n) {
    out[n] = readObjects_(sheet_(ss, n)).map(function (r) { var o = {}; Object.keys(r).forEach(function (k) { if (k !== '_row') o[k] = r[k]; }); return o; });
  });
  return JSON.stringify(out);
}));
const gas = p => { H.g.__P = JSON.stringify(p); return JSON.parse(H.run(function () { return JSON.stringify(handleNotifications(JSON.parse(__P))); })); };
const host = p => ROUTES.run('notifications', p, raw, { notifications: () => [] }, {});

console.log('\n1) 🔔 ทุกแบบของผู้ถาม — คำตอบเดียวกับ Apps Script ทุกตัวอักษร');
const CASES = {
  'แอดมิน (กล่องรวม)': { role: 'Admin', staffId: 'STF-A' },
  'ครู (กล่องของตัวเอง)': { role: 'Teacher', staffId: 'STF-T' },
  'ครูที่ยังไม่มีอะไร': { role: 'Teacher', staffId: 'STF-X' },
  'ผู้ปกครองผ่าน PARENTS': { role: 'Parent', parentId: 'PAR-1', uid: 'U-P1' },
  'ผู้ปกครองผ่าน USER_LINKS อย่างเดียว': { role: 'Parent', parentId: 'PAR-2', uid: 'U-P2' },
  'ผู้ปกครองที่ไม่มีลูก (ตกไปที่ engine)': { role: 'Parent', parentId: 'PAR-0', uid: 'U-P0' }
};
const got = {};
Object.keys(CASES).forEach(k => { const want = gas(CASES[k]); got[k] = host(CASES[k]); eq(k + ' (' + want.length + ' รายการ)', got[k], want); });

console.log('\n2) ข้อเท็จจริงที่ใช้ตรวจว่าการเทียบข้างบนเทียบของจริง');
eq('แอดมินเห็น 100 รายการ (ตัดที่ 100 เหมือนเดิม)', got['แอดมิน (กล่องรวม)'].length, 100);
/* Apps Script sorts by InboxID as TEXT, so a legacy id with no time ('IN-legacy-…') sorts above every
 * timed one — its quirk, kept: the port answers what live answers, and the parity above says so. */
eq('ใหม่สุดก่อน (แถวเก่าที่ id ไม่มีเวลาอยู่บนสุด — พฤติกรรมเดิมของ Apps Script)', got['แอดมิน (กล่องรวม)'].slice(0, 2).map(x => x.text), ['แถวเก่าไม่มีเวลาใน id', 'แจ้งแอดมิน 104']);
ok_('🔴 แอดมินไม่เห็นแถวของครูหรือของครอบครัว', !got['แอดมิน (กล่องรวม)'].some(x => /ผู้ปกครองส่ง|สมุด|มาถึง/.test(x.text)));
eq('ครูเห็นเฉพาะของตัวเอง', got['ครู (กล่องของตัวเอง)'].map(x => x.text), ['อนุมัติการลาแล้ว', 'ผู้ปกครองส่งข้อความ']);
eq('🔴 ผู้ปกครองเห็นเฉพาะลูกตัวเอง', got['ผู้ปกครองผ่าน PARENTS'].map(x => x.text), ['สมุดสื่อสารของหนึ่ง']);
eq('พ่อที่ผูกผ่าน USER_LINKS เห็นของลูก', got['ผู้ปกครองผ่าน USER_LINKS อย่างเดียว'].map(x => x.text), ['สองมาถึงโรงเรียนแล้ว']);
eq('เวลาแสดงตามเวลาไทยจาก id (01:00Z + 5,000 วินาที = 09:23 น.)', got['ครู (กล่องของตัวเอง)'][1].time, ' 09:23');
ok_('แถวเก่าที่ id ไม่มีเวลา ใช้วันที่ในช่อง Date', host({ role: 'Admin' }).length === 100 &&
  JSON.stringify(ROUTES.run('notifications', { role: 'Admin' }, { ADMIN_INBOX: [inbox[105]], PARENTS: [], USER_LINKS: [] }, {}, {}))
  === JSON.stringify((() => { H.g.__P = '1'; return JSON.parse(H.run(function () {
    var sh = getMainSpreadsheet_().getSheetByName('ADMIN_INBOX'); var all = readObjects_(sh);
    // run Apps Script's handler on the single legacy row, with the others hidden
    var keep = readObjects_; readObjects_ = function (s) { return keep(s).filter(function (r) { return r.InboxID === 'IN-legacy-1'; }); };
    try { return JSON.stringify(handleNotifications({ role: 'Admin' })); } finally { readObjects_ = keep; } })); })()));

console.log('\n3) 🔴 กฎที่ทำให้รันนอก Apps Script ได้อย่างปลอดภัย');
{
  let e1 = null;
  try { ROUTES.run('notifications', { role: 'Admin' }, {}, {}, {}); } catch (e) { e1 = e; }
  ok_('ไม่มีแถวที่โหลดมา ≠ "ไม่มีแจ้งเตือน" — อ่านได้ แต่ได้ว่างเพราะโหลดมาว่างจริง', !e1);
  eq('ประกาศชีตที่อ่านครบ', ROUTES.needs(['notifications', 'classList']), ['ADMIN_INBOX', 'PARENTS', 'USER_LINKS']);
  // a route that reads a sheet it did not declare: simulated by narrowing the declaration
  const saved = ROUTES.PORTED.notifications.reads;
  ROUTES.PORTED.notifications.reads = ['ADMIN_INBOX'];
  let e2 = null;
  try { ROUTES.run('notifications', { role: 'Parent', parentId: 'PAR-1', uid: 'U-P1' }, raw, {}, {}); } catch (e) { e2 = e; }
  ROUTES.PORTED.notifications.reads = saved;
  ok_('🔴 อ่านชีตที่ไม่ได้ประกาศ → ล้มทันที (ไม่ใช่ตอบว่าง)', !!e2 && /does not declare/.test(e2.message));
  // a write: run the real markInbox handler through the same sandbox — it must be refused
  ROUTES.PORTED.__w = { fn: 'handleMarkInboxRead', reads: ['ADMIN_INBOX'] };
  let e3 = null;
  try { ROUTES.run('__w', {}, raw, {}, {}); } catch (e) { e3 = e; }
  delete ROUTES.PORTED.__w;
  ok_('🔴 route ที่ไม่ได้ประกาศการเขียน แต่พยายามเขียน → ล้มทันที', !!e3 && /does not declare/.test(e3.message));
  const GATE = require(path.join(__dirname, '..', 'server', 'gate.js'));
  ok_('🔴 route ที่เขียนข้อมูลได้ คือตัวที่ประกาศช่องที่เขียนไว้เท่านั้น', Object.keys(ROUTES.PORTED).every(a => !GATE.isMutating(a) || !!ROUTES.PORTED[a].writes));
}

console.log('\n4) markNotifsRead — ผลในชีตหลังกด "อ่านแล้ว" เท่ากับ Apps Script ทุกแถว');
{
  /* a FRESH Apps Script for each caller — marking read changes the sheet */
  const freshGas = () => {
    const G = require('./gas_test_harness.js')(FILES);
    G.g.__FIX = JSON.stringify({ inbox, parents, links });
    G.run(function () {
      _configCache = null; setupAll(); _configCache = null;
      var F = JSON.parse(__FIX), ss = getMainSpreadsheet_();
      F.inbox.forEach(function (r) { appendObject_(sheet_(ss, 'ADMIN_INBOX'), r); });
      F.parents.forEach(function (r) { appendObject_(sheet_(ss, 'PARENTS'), r); });
      F.links.forEach(function (r) { appendObject_(sheet_(ss, 'USER_LINKS'), r); });
      return '';
    });
    return G;
  };
  const readCol = G => JSON.parse(G.run(function () {
    return JSON.stringify(readObjects_(sheet_(getMainSpreadsheet_(), 'ADMIN_INBOX')).map(function (r) { return r.InboxID + '=' + r.Read; }));
  }));
  const withIds = () => { const r = JSON.parse(JSON.stringify(raw)); r.ADMIN_INBOX.forEach((x, i) => { x.__id = 'id-' + i; }); return r; };
  const MARK = {
    'แอดมิน': { role: 'Admin', staffId: 'STF-A' },
    'ครู': { role: 'Teacher', staffId: 'STF-T' },
    'ผู้ปกครองผ่าน PARENTS': { role: 'Parent', parentId: 'PAR-1', uid: 'U-P1' },
    'ผู้ปกครองผ่าน USER_LINKS': { role: 'Parent', parentId: 'PAR-2', uid: 'U-P2' },
    'ผู้ปกครองที่ไม่มีลูก (engine)': { role: 'Parent', parentId: 'PAR-0', uid: 'U-P0' }
  };
  const before = readCol(freshGas());
  for (const k of Object.keys(MARK)) {
    const G = freshGas();
    G.g.__P = JSON.stringify(MARK[k]);
    const want = JSON.parse(G.run(function () { return JSON.stringify(handleMarkNotifsRead(JSON.parse(__P))); }));
    const wantCol = readCol(G);
    const r = withIds(), sink = [];
    const got = ROUTES.run('markNotifsRead', MARK[k], r, { markNotifsRead: () => ({ ok: true }) }, {}, sink);
    const gotCol = r.ADMIN_INBOX.map(x => x.InboxID + '=' + x.Read);
    const flipped = wantCol.filter((x, i) => x !== before[i]).length;
    eq(k + ': คำตอบ', got, want);
    eq(k + ': ทุกแถวของ ADMIN_INBOX หลังกด (' + flipped + ' แถวเปลี่ยน)', gotCol, wantCol);
    eq(k + ': สิ่งที่จะบันทึกลง Postgres = แถวที่เปลี่ยนจริง', sink.length, flipped);
    ok_(k + ': เขียนเฉพาะช่อง Read = YES', sink.every(w => w.sheet === 'ADMIN_INBOX' && JSON.stringify(w.patch) === '{"Read":"YES"}'));
  }
  ok_('🔴 ข้อเท็จจริง: แอดมินเปลี่ยนจริง (ไม่ใช่เทียบว่างกับว่าง)', (() => { const r = withIds(), s = []; ROUTES.run('markNotifsRead', MARK['แอดมิน'], r, {}, {}, s); return s.length > 50; })());
  {
    // the batch [markNotifsRead, notifications]: the second call sees the first one's write, as on Apps Script
    const r = withIds(), s = [];
    ROUTES.run('markNotifsRead', MARK['ครู'], r, {}, {}, s);
    const after = ROUTES.run('notifications', MARK['ครู'], r, {}, {});
    ok_('call ถัดไปใน batch เห็นว่าอ่านแล้ว', after.length === 2 && after.every(x => x.read === true));
  }
  {
    // a write to a column it did not declare: refused, and NOTHING it did is kept
    const saved = ROUTES.PORTED.markNotifsRead.writes;
    ROUTES.PORTED.markNotifsRead.writes = { ADMIN_INBOX: ['Text'] };
    const r = withIds(), s = []; let e4 = null;
    try { ROUTES.run('markNotifsRead', MARK['แอดมิน'], r, {}, {}, s); } catch (e) { e4 = e; }
    ROUTES.PORTED.markNotifsRead.writes = saved;
    ok_('🔴 เขียนช่องที่ไม่ได้ประกาศ → ล้ม', !!e4 && /ADMIN_INBOX\.Read which it does not declare/.test(e4.message));
    ok_('🔴 ...และไม่มีอะไรค้าง (ทั้งที่จะบันทึก และในข้อมูลของ call ถัดไป)', s.length === 0 && JSON.stringify(r) === JSON.stringify(withIds()));
  }
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
