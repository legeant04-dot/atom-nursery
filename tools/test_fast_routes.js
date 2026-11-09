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
  eq('ประกาศชีตที่อ่านครบ (SCHOOL_CONFIG อ่านได้เสมอ เหมือนทุกบรรทัดของ Apps Script)', ROUTES.needs(['notifications', 'classList']), ['SCHOOL_CONFIG', 'ADMIN_INBOX', 'PARENTS', 'USER_LINKS',
    // 📝 2026-11-09: a family's applications count toward their bell (inboxStudentsForParent_ → applyIdsForParent_)
    'APPLICATIONS']);
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
  ok_('🔴 route ที่เขียนข้อมูลได้ คือตัวที่ประกาศการเขียนไว้เท่านั้น (writes · appends · deletes)', Object.keys(ROUTES.PORTED).every(a => !GATE.isMutating(a) || ROUTES.writes(a)));
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

console.log('\n5) pendingLeaves — คิวอนุมัติการลา เท่ากับ Apps Script ทุกแบบผู้ถาม');
{
  const staff = [
    { StaffID: 'STF-A', Name: 'แอดมิน', Nickname: 'แอด', Role: 'Admin', PositionLevel: 'Teacher', Status: 'ACTIVE' },   // Admin by ROLE
    { StaffID: 'STF-PA', Name: 'ผอ.', Nickname: 'ผอ', Role: 'Teacher', PositionLevel: 'Admin', Status: 'ACTIVE' },    // Admin by LEVEL
    { StaffID: 'STF-L', Name: 'หัวหน้าครู', Nickname: 'หัวหน้า', NicknameEN: 'Head', Role: 'Teacher', PositionLevel: 'Leader', Status: 'ACTIVE' },
    { StaffID: 'STF-T', Name: 'ครูที', NameEN: 'Tee', Nickname: 'ที', Role: 'Teacher', PositionLevel: 'Teacher', Status: 'ACTIVE' }];
  const leaves = [
    { LeaveID: 'LV-1', StaffID: 'STF-T', Department: 'Nursery 1', Type: 'ลาป่วย', StartDate: '2026-11-03', EndDate: '2026-11-03', Days: 1, Reason: 'ไข้', Status: 'PENDING_LEADER', CreatedDate: '2026-11-02 18:00:00', HalfDay: '' },
    { LeaveID: 'LV-2', StaffID: 'STF-T', Department: 'Nursery 1', Type: 'ลากิจ', StartDate: '2026-11-10', EndDate: '2026-11-10', Days: 0.5, Reason: 'ธุระ', Status: 'PENDING_ADMIN', Step1ApproverID: 'STF-L', Step1Status: 'APPROVED', CreatedDate: '2026-11-01 09:00:00', HalfDay: 'am' },
    { LeaveID: 'LV-3', StaffID: 'STF-L', Department: 'Nursery 1', Type: 'ลาพักร้อน', StartDate: '2026-12-01', EndDate: '2026-12-03', Days: 3, Status: 'PENDING_ADMIN', CreatedDate: '2026-11-04 10:00:00', HalfDay: '' },
    { LeaveID: 'LV-4', StaffID: 'STF-T', Type: 'ลาป่วย', StartDate: '2026-10-01', EndDate: '2026-10-01', Days: 1, Status: 'APPROVED', HalfDay: '' },
    { LeaveID: 'LV-5', StaffID: 'STF-GONE', Type: 'ลาป่วย', StartDate: '2026-11-05', EndDate: '2026-11-05', Days: 1, Status: 'PENDING_LEADER', HalfDay: 'PM' }];
  const G = require('./gas_test_harness.js')(FILES);
  G.g.__FIX = JSON.stringify({ staff, leaves });
  G.run(function () {
    _configCache = null; setupAll(); _configCache = null;
    var F = JSON.parse(__FIX), hr = getHrSpreadsheet_();
    F.staff.forEach(function (r) { appendObject_(sheet_(hr, 'STAFF'), r); });
    F.leaves.forEach(function (r) { appendObject_(sheet_(hr, 'LEAVE_REQUEST'), r); });
    return '';
  });
  const rawL = JSON.parse(G.run(function () {
    var hr = getHrSpreadsheet_(), out = {};
    ['LEAVE_REQUEST', 'STAFF'].forEach(function (n) { out[n] = readObjects_(sheet_(hr, n)).map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; return o; }); });
    return JSON.stringify(out);
  }));
  const gasPL = p => { G.g.__P = JSON.stringify(p); return JSON.parse(G.run(function () {
    try { return JSON.stringify({ ok: true, data: handlePendingLeaves(JSON.parse(__P)) }); }
    catch (e) { return JSON.stringify({ ok: false, code: e.apiCode || e.message }); } })); };
  const hostPL = p => { try { return { ok: true, data: ROUTES.run('pendingLeaves', p, JSON.parse(JSON.stringify(rawL)), {}, {}) }; }
    catch (e) { return { ok: false, code: e.apiCode || e.message }; } };
  const WHO = {
    'แอดมิน (ตาม Role)': { staffId: 'STF-A', role: 'Admin' },
    'ผอ. (ตาม PositionLevel)': { staffId: 'STF-PA', role: 'Teacher' },
    'หัวหน้าครู': { staffId: 'STF-L', role: 'Teacher' },
    'ครู (ไม่มีสิทธิ์)': { staffId: 'STF-T', role: 'Teacher' },
    'ไม่พบในทะเบียน': { staffId: 'STF-NOPE', role: 'Teacher' }
  };
  const got = {};
  for (const k of Object.keys(WHO)) { const want = gasPL(WHO[k]); got[k] = hostPL(WHO[k]); eq(k, got[k], want); }
  eq('ข้อเท็จจริง: แอดมินเห็น PENDING_ADMIN สองใบ', got['แอดมิน (ตาม Role)'].data.map(x => x.LeaveID), ['LV-2', 'LV-3']);
  eq('ข้อเท็จจริง: หัวหน้าเห็น PENDING_LEADER (รวมใบของคนที่ไม่อยู่ในทะเบียนแล้ว)', got['หัวหน้าครู'].data.map(x => x.LeaveID), ['LV-1', 'LV-5']);
  eq('🔴 ครูธรรมดา → NO_PERMISSION', got['ครู (ไม่มีสิทธิ์)'].code, 'NO_PERMISSION');
  ok_('ชื่อเล่นผู้ขอติดมาด้วย และไม่มี _row หลุดไปในคำตอบ', got['หัวหน้าครู'].data[0].nick === 'ที' && !got['หัวหน้าครู'].data.some(x => '_row' in x));
  {
    /* 🔴 Leave.gs keeps the STAFF sheet in _leaveStaffIdx after first use — safe on Apps Script because
     * an execution ends. Here the sandbox lives on: the next request must not get this one's staff. */
    const r2 = JSON.parse(JSON.stringify(rawL)); r2.STAFF.find(s => s.StaffID === 'STF-T').Nickname = 'ชื่อใหม่';
    ROUTES.run('pendingLeaves', WHO['หัวหน้าครู'], JSON.parse(JSON.stringify(rawL)), {}, {});
    const after = ROUTES.run('pendingLeaves', WHO['หัวหน้าครู'], r2, {}, {});
    eq('🔴 คำขอถัดไปเห็นทะเบียนครูของตัวเอง ไม่ใช่ของคำขอก่อน (memo ถูกล้าง)', after[0].nick, 'ชื่อใหม่');
  }

  console.log('\n5b) allLeaves — รายการลาทั้งหมดของแอดมิน (ทุกสถานะ ใหม่สุดก่อน) เท่ากับ Apps Script');
  {
    G.g.__P = JSON.stringify({ staffId: 'STF-A', role: 'Admin' });
    const want = JSON.parse(G.run(function () { return JSON.stringify(handleAllLeaves(JSON.parse(__P))); }));
    const got = ROUTES.run('allLeaves', { staffId: 'STF-A', role: 'Admin' }, JSON.parse(JSON.stringify(rawL)), {}, {});
    eq('คำตอบเท่ากันทุกตัวอักษร', got, want);
    eq('ข้อเท็จจริง: ครบทุกใบ เรียงใหม่สุดก่อน (CreatedDate · ไม่มีใช้ StartDate)', got.map(x => x.LeaveID), ['LV-5', 'LV-3', 'LV-1', 'LV-2', 'LV-4']);
    ok_('ชื่อผู้ขอ · days · halfDay ติดมา และไม่มี _row', got[2].nick === 'ที' && got[3].halfDay === 'AM' && got[3].days === 0.5 && !got.some(x => '_row' in x));
  }
}

console.log('\n6) bigCleaningDays — วัน Big Cleaning · ค่าตอบแทน · เวลาเข้า-ออก เท่ากับ Apps Script');
{
  const G = require('./gas_test_harness.js')(FILES);
  G.run(function () { _configCache = null; setupAll(); _configCache = null; return ''; });
  const KEYS = ['BigCleaningDays', 'BigCleaningAmount', 'BigCleaningIn', 'BigCleaningOut'];
  /* each case: what the school typed into SCHOOL_CONFIG (text, as Postgres stores it) */
  const CASES = {
    'ยังไม่ตั้งอะไร (ค่าเริ่มต้น)': { BigCleaningDays: '', BigCleaningAmount: '', BigCleaningIn: '', BigCleaningOut: '' },
    'ตั้งครบ': { BigCleaningDays: '2026-11-20,2026-12-18', BigCleaningAmount: '300', BigCleaningIn: '08:15', BigCleaningOut: '16:30' },
    'พิมพ์มาไม่เรียบร้อย': { BigCleaningDays: ' 2026-11-20 , ,2026-12-18,', BigCleaningAmount: 'สามร้อย', BigCleaningIn: '8:5', BigCleaningOut: 'บ่ายสี่' },
    'วันเดียว · เวลามีวินาที': { BigCleaningDays: '2027-01-15', BigCleaningAmount: '250.50', BigCleaningIn: '08:30:00', BigCleaningOut: '17:00:00' }
  };
  const got = {};
  for (const k of Object.keys(CASES)) {
    G.g.__C = JSON.stringify(CASES[k]); G.g.__K = JSON.stringify(KEYS);
    const both = JSON.parse(G.run(function () {
      var C = JSON.parse(__C);
      JSON.parse(__K).forEach(function (key) { setConfigValue_(key, C[key]); });
      _configCache = null;
      var rows = readObjects_(sheet_(getMainSpreadsheet_(), 'SCHOOL_CONFIG')).map(function (r) { return { Key: r.Key, Value: r.Value }; });
      return JSON.stringify({ want: handleBigCleaningDays(), rows: rows });
    }));
    got[k] = ROUTES.run('bigCleaningDays', {}, { SCHOOL_CONFIG: both.rows }, {}, {});
    eq(k, got[k], both.want);
  }
  eq('ข้อเท็จจริง: ค่าที่ตั้งครบถูกอ่านจริง', got['ตั้งครบ'], { days: ['2026-11-20', '2026-12-18'], amount: 300, checkIn: '08:15', checkOut: '16:30' });
  eq('ข้อเท็จจริง: ไม่ตั้ง = 08:30–17:00 · 0 บาท', got['ยังไม่ตั้งอะไร (ค่าเริ่มต้น)'], { days: [], amount: 0, checkIn: '08:30', checkOut: '17:00' });
  {
    /* 🔴 Db.gs caches SCHOOL_CONFIG in _configCache per execution — reset per request here */
    const a = ROUTES.run('bigCleaningDays', {}, { SCHOOL_CONFIG: [{ Key: 'BigCleaningAmount', Value: '111' }] }, {}, {});
    const b = ROUTES.run('bigCleaningDays', {}, { SCHOOL_CONFIG: [{ Key: 'BigCleaningAmount', Value: '222' }] }, {}, {});
    eq('🔴 การตั้งค่าของคำขอหนึ่งไม่ค้างไปคำขอถัดไป', [a.amount, b.amount], [111, 222]);
  }
  {
    /* the engine's M.config is NOT what a route reads: the route reads the raw sheet, like Apps Script */
    const r = ROUTES.run('bigCleaningDays', {}, { SCHOOL_CONFIG: [{ Key: 'BigCleaningAmount', Value: '300' }] }, {}, { BigCleaningAmount: 999 });
    eq('อ่านจาก SCHOOL_CONFIG ไม่ใช่ M.config ของ engine', r.amount, 300);
  }
}

console.log('\n7) 💰 getPayslip · insuranceStatus — เท่ากับ Apps Script ทุกตัวอักษร');
{
  const FX = {
    staff: [
      { StaffID: 'STF-T', Name: 'ครูที', Nickname: 'ที', Role: 'Teacher', PositionLevel: 'Teacher', Status: 'ACTIVE', ContributionOpening: 1200 },
      { StaffID: 'STF-N', Name: 'ครูใหม่', Role: 'Teacher', PositionLevel: 'Teacher', Status: 'ACTIVE', ContributionOpening: '' }],
    leaves: [
      { LeaveID: 'LV-1', StaffID: 'STF-T', Department: 'Nursery 1', Type: 'ลาป่วย', StartDate: '2026-11-03', EndDate: '2026-11-03', Days: 1, Reason: 'ไข้', Status: 'APPROVED', Step1ApproverName: 'หัวหน้า', Step1Status: 'APPROVED', Step2ApproverName: 'แอดมิน', Step2Status: 'APPROVED' },
      { LeaveID: 'LV-2', StaffID: 'STF-T', Type: 'ลากิจ', StartDate: '2026-11-10', EndDate: '2026-11-10', Days: 0.5, Reason: 'ธุระ', Status: 'PENDING_LEADER' },
      { LeaveID: 'LV-3', StaffID: 'STF-N', Type: 'ลาป่วย', StartDate: '2026-11-04', EndDate: '2026-11-04', Days: 1, Status: 'PENDING_LEADER' }],
    // three saved months for STF-T: one approved with the employer share left blank (= own × match),
    // one with the employer share typed in, one NOT approved yet
    payroll: [
      { StaffID: 'STF-T', Month: '2026-08', BaseSalary: 15000, Contribution: 450, ContributionEmployer: '', NetPay: 14550, Approved: 'YES' },
      { StaffID: 'STF-T', Month: '2026-09', BaseSalary: 15000, Contribution: 450, ContributionEmployer: 300, OT: 1250.5, NetPay: 15800.5, Approved: '' },
      { StaffID: 'STF-T', Month: '2026-10', BaseSalary: 15500, Contribution: 465, ContributionEmployer: '', NetPay: 15035, Approved: 'NO' },
      { StaffID: 'STF-N', Month: '2026-10', BaseSalary: 12000, Contribution: 0, NetPay: 12000, Approved: 'YES' }],
    students: [
      { StudentID: 'STD-1', Name: 'เด็กหนึ่ง', NameEN: 'One', NationalID: '1100000000011', Gender: 'ชาย', DOB: '2023-02-03', Class: 'Nursery 1',
        InsurancePolicyNo: 'POL-9', InsuranceCompany: 'บริษัทประกัน', InsuranceExpiry: '2027-05-31', InsuranceStart: '2026-06-01' },
      { StudentID: 'STD-2', Name: 'เด็กสอง', NationalID: '1100000000022', DOB: '2022-12-01' },
      { StudentID: 'STD-3', Name: 'เด็กสาม', NationalID: '' }],
    pchi: [
      { InsuranceID: 'INS-1', StudentID: 'STD-1', InsuredName: 'เด็กหนึ่ง', DOB: '2023-02-03', EffectiveDate: '2026-06-01', FilledBy: 'PAR-1', FilledDate: '2026-05-20 10:11' },
      // filed under a different id but the same national id — found by NationalID, as live does
      { InsuranceID: 'INS-2', StudentID: 'STD-OLD', NationalID: '1100000000022', InsuredName: 'เด็กสอง', DOB: '2022-12-01' }]
  };
  const G = require('./gas_test_harness.js')(FILES.concat(['Payroll', 'Day6']));
  G.g.__FIX = JSON.stringify(FX);
  G.run(function () {
    _configCache = null; setupAll(); _configCache = null;
    setConfigValue_('ContributionMatchRate', '1'); _configCache = null;
    var F = JSON.parse(__FIX), hr = getHrSpreadsheet_(), ss = getMainSpreadsheet_();
    F.staff.forEach(function (r) { appendObject_(sheet_(hr, 'STAFF'), r); });
    F.leaves.forEach(function (r) { appendObject_(sheet_(hr, 'LEAVE_REQUEST'), r); });
    F.payroll.forEach(function (r) { appendObject_(sheet_(hr, 'PAYROLL'), r); });
    F.students.forEach(function (r) { appendObject_(sheet_(ss, 'STUDENTS'), r); });
    F.pchi.forEach(function (r) { appendObject_(sheet_(ss, 'INSURANCE_PCHI'), r); });
    return '';
  });
  const rawX = JSON.parse(G.run(function () {
    var out = {}, hr = getHrSpreadsheet_(), ss = getMainSpreadsheet_();
    [['STAFF', hr], ['LEAVE_REQUEST', hr], ['PAYROLL', hr], ['STUDENTS', ss], ['INSURANCE_PCHI', ss], ['SCHOOL_CONFIG', ss]].forEach(function (x) {
      out[x[0]] = readObjects_(sheet_(x[1], x[0])).map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; return o; }); });
    return JSON.stringify(out);
  }));
  const gasX = (fn, p) => { G.g.__P = JSON.stringify(p); G.g.__F = fn; return JSON.parse(G.run(function () {
    try { return JSON.stringify({ ok: true, data: this[__F](JSON.parse(__P)) }); }
    catch (e) { return JSON.stringify({ ok: false, code: e.apiCode || e.message }); } })); };
  const hostX = (a, p) => { try { return { ok: true, data: ROUTES.run(a, p, JSON.parse(JSON.stringify(rawX)), {}, {}) }; }
    catch (e) { return { ok: false, code: e.apiCode || e.message }; } };
  const CASES = [
    ['getPayslip', 'handleGetPayslip', '💰 สิงหาคม (นายจ้างสมทบว่าง = เท่าของลูกจ้าง)', { staffId: 'STF-T', month: '2026-08', role: 'Teacher' }],
    ['getPayslip', 'handleGetPayslip', '💰 กันยายน (นายจ้างสมทบที่พิมพ์ไว้ · OT ทศนิยม)', { staffId: 'STF-T', month: '2026-09', role: 'Teacher' }],
    ['getPayslip', 'handleGetPayslip', '💰 🔴 ตุลาคม ยังไม่อนุมัติ — ครูไม่เห็น', { staffId: 'STF-T', month: '2026-10', role: 'Teacher' }],
    ['getPayslip', 'handleGetPayslip', '💰 ตุลาคม ยังไม่อนุมัติ — แอดมินเห็น', { staffId: 'STF-T', month: '2026-10' }],
    ['getPayslip', 'handleGetPayslip', '💰 เดือนที่ยังไม่มีสลิป = null', { staffId: 'STF-T', month: '2026-11', role: 'Teacher' }],
    ['getPayslip', 'handleGetPayslip', '💰 ครูที่ไม่มียอดยกมา', { staffId: 'STF-N', month: '2026-10', role: 'Teacher' }],
    ['insuranceStatus', 'handleInsuranceStatus', 'กรอกแล้ว + กรมธรรม์ของโรงเรียน', { studentId: 'STD-1' }],
    ['insuranceStatus', 'handleInsuranceStatus', 'พบด้วยเลขบัตรประชาชน', { studentId: 'STD-2' }],
    ['insuranceStatus', 'handleInsuranceStatus', 'ยังไม่กรอก', { studentId: 'STD-3' }],
    ['insuranceStatus', 'handleInsuranceStatus', 'ไม่พบนักเรียน', { studentId: 'STD-NOPE' }]];
  const got = {};
  for (const [a, fn, label, p] of CASES) { const want = gasX(fn, p); got[label] = hostX(a, p); eq(a + ' · ' + label, got[label], want); }
  /* 🔴 myLeaves is NOT a Code.gs route — live answers it from the engine, and so does the host. Porting
   * it as a route answered another shape (caught by test_fast_routes_live); routes.js now refuses any
   * action that is not in ROUTES. */
  ok_('🔴 myLeaves ไม่ใช่ route ของ Code.gs จึงไม่ถูกย้าย (โฮสต์ตอบด้วย engine เหมือนของจริง)', !ROUTES.has('myLeaves'));
  const aug = got['💰 สิงหาคม (นายจ้างสมทบว่าง = เท่าของลูกจ้าง)'].data;
  // opening 1200 + Aug (450+450) + Sep (450+300) + Oct (465+465) = 3780 — every saved month, approved or not
  eq('💰 ข้อเท็จจริง: สมทบนายจ้าง 450 · ยอดสะสม 3,780 · เดือน 2026-08', [aug.ContributionEmployer, aug.ContributionAccum, aug.Month], [450, 3780, '2026-08']);
  eq('💰 🔴 ข้อเท็จจริง: สลิปที่ยังไม่อนุมัติ ครูได้ null', got['💰 🔴 ตุลาคม ยังไม่อนุมัติ — ครูไม่เห็น'].data, null);
  ok_('ไม่มี _row หลุดไปในสลิปหรือแบบประกัน', !('_row' in aug) && !('_row' in (got['กรอกแล้ว + กรมธรรม์ของโรงเรียน'].data.record || {})));
  eq('ข้อเท็จจริง: แบบประกันที่พบด้วยเลขบัตร', got['พบด้วยเลขบัตรประชาชน'].data.record && got['พบด้วยเลขบัตรประชาชน'].data.record.InsuranceID, 'INS-2');
}

console.log('\n8) 💰 myPayslipMonths · otCarryOver · otWaiveDays · certText — เท่ากับ Apps Script ทุกตัวอักษร');
{
  const FX = {
    payroll: [
      // September: paid 300 of the 500 OT approved for it — 200 is still owed
      { StaffID: 'STF-T', Month: '2026-09', NetPay: 15300, OTEvening: 300, OTCarryDetail: '', SlipSent: 'YES', PaidDate: '2026-09-30', Approved: 'YES' },
      // a DUPLICATE September row (handlePayrollDuplicates) — not paid, so the paid one wins in the month list
      { StaffID: 'STF-T', Month: '2026-09', NetPay: 15900, OTEvening: 0, SlipSent: '', PaidDate: '', Approved: 'YES' },
      // October: saved before the 5 Oct OT was approved; carried 50 of September already
      { StaffID: 'STF-T', Month: '2026-10', NetPay: 15050, OTEvening: 0, OTCarryDetail: '[{"month":"2026-09","amount":50}]', SlipSent: '', PaidDate: '', Approved: '' },
      // November: not approved yet — not in the teacher's month list
      { StaffID: 'STF-T', Month: '2026-11', NetPay: 15000, OTEvening: 0, Approved: 'NO' },
      { StaffID: 'STF-X', Month: '2026-09', NetPay: 9000, OTEvening: 999, Approved: 'YES' }],
    ot: [
      { OTID: 'OT-1', StaffID: 'STF-T', Date: '2026-09-10', Month: '2026-09', Hours: 3, Amount: 300, Status: 'APPROVED', Kind: '', Note: 'ประชุม' },
      { OTID: 'OT-2', StaffID: 'STF-T', Date: '2026-09-20', Month: '', Hours: 2, Amount: '', Status: 'APPROVED', Kind: '', Note: '' },     // no amount → hours × rate
      { OTID: 'OT-3', StaffID: 'STF-T', Date: '2026-09-21', Month: '2026-09', Hours: 4, Amount: 400, Status: 'PENDING_LEADER', Kind: '' }, // not approved — never counts
      { OTID: 'OT-4', StaffID: 'STF-T', Date: '2026-09-27', Month: '2026-09', Hours: 8, Amount: 1500, Status: 'APPROVED', Kind: 'HOLIDAY' }, // holiday OT rides elsewhere
      { OTID: 'OT-5', StaffID: 'STF-T', Date: '2026-10-05', Month: '2026-10', Hours: 1.5, Amount: 150, Status: 'APPROVED', Kind: '', Note: 'ปิดเทอม' },
      { OTID: 'OT-6', StaffID: 'STF-X', Date: '2026-09-11', Month: '2026-09', Hours: 9, Amount: 999, Status: 'APPROVED', Kind: '' }],
    cfg: { OTEveningRate: '100', OTWaiveDays: '[{"from":"2026-11-02","to":"2026-11-03","reason":"อบรม"},{"from":"bad"}]',
      CertTitleTH: 'เกียรติบัตร', CertDatePrefixTH: 'ให้ไว้ ณ วันที่', CertBgHasText: 'true', CertBgFileId: 'FILE-BG', SchoolName: 'Atom Nursery' }
  };
  const G = require('./gas_test_harness.js')(FILES.concat(['Payroll', 'Day6', 'OtStaff', 'OT', 'Certificate']));
  G.g.__FIX = JSON.stringify(FX);
  G.run(function () {
    _configCache = null; setupAll(); _configCache = null;
    var F = JSON.parse(__FIX), hr = getHrSpreadsheet_();
    Object.keys(F.cfg).forEach(function (k) { setConfigValue_(k, F.cfg[k]); }); _configCache = null;
    F.payroll.forEach(function (r) { appendObject_(sheet_(hr, 'PAYROLL'), r); });
    F.ot.forEach(function (r) { appendObject_(sheet_(hr, 'OT_RECORDS'), r); });
    return '';
  });
  const rawY = JSON.parse(G.run(function () {
    var out = {}, hr = getHrSpreadsheet_(), ss = getMainSpreadsheet_();
    [['PAYROLL', hr], ['OT_RECORDS', hr], ['SCHOOL_CONFIG', ss]].forEach(function (x) {
      out[x[0]] = readObjects_(sheet_(x[1], x[0])).map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; return o; }); });
    return JSON.stringify(out);
  }));
  const gasY = (fn, p) => { G.g.__P = JSON.stringify(p); G.g.__F = fn; return JSON.parse(G.run(function () {
    _configCache = null;
    try { return JSON.stringify({ ok: true, data: this[__F](JSON.parse(__P)) }); }
    catch (e) { return JSON.stringify({ ok: false, code: e.apiCode || e.message }); } })); };
  const hostY = (a, p) => { try { return { ok: true, data: ROUTES.run(a, p, JSON.parse(JSON.stringify(rawY)), {}, {}) }; }
    catch (e) { return { ok: false, code: e.apiCode || e.message }; } };
  const CASES = [
    ['myPayslipMonths', 'handleMyPayslipMonths', '💰 เดือนที่มีสลิปของครู (ไม่รวมที่ยังไม่อนุมัติ · เดือนซ้ำเหลือใบเดียว)', { staffId: 'STF-T' }],
    ['myPayslipMonths', 'handleMyPayslipMonths', 'ไม่มี staffId', {}],
    ['otCarryOver', 'handleOtCarryOver', '💰 OT ค้างจ่าย ณ พฤศจิกายน', { staffId: 'STF-T', month: '2026-11' }],
    ['otCarryOver', 'handleOtCarryOver', '💰 OT ค้างจ่าย ณ ตุลาคม (ตุลาคมเองไม่นับ)', { staffId: 'STF-T', month: '2026-10' }],
    ['otCarryOver', 'handleOtCarryOver', '💰 ครูที่ไม่มีค้าง', { staffId: 'STF-NONE', month: '2026-11' }],
    ['otWaiveDays', 'handleOtWaiveDays', 'วันงดคิด OT (แถวที่เสียถูกข้าม)', {}],
    ['certText', 'handleCertText', 'ข้อความใบประกาศ', {}]];
  const got = {};
  for (const [a, fn, label, p] of CASES) { const want = gasY(fn, p); got[label] = hostY(a, p); eq(a + ' · ' + label, got[label], want); }
  const months = got['💰 เดือนที่มีสลิปของครู (ไม่รวมที่ยังไม่อนุมัติ · เดือนซ้ำเหลือใบเดียว)'].data;
  eq('💰 ข้อเท็จจริง: ต.ค. + ก.ย. (ใบที่จ่ายแล้ว 15,300) — ไม่มี พ.ย. ที่ยังไม่อนุมัติ', months.months.map(m => m.month + ':' + m.netPay), ['2026-10:15050', '2026-09:15300']);
  const nov = got['💰 OT ค้างจ่าย ณ พฤศจิกายน'].data;
  // Sep: approved 300 + 2h×100 = 500, paid 300, carried 50 → 150 owed (of 5h → 1.5h) · Oct: 150 approved, 0 paid → 150
  eq('💰 ข้อเท็จจริง: ค้าง ก.ย. 150 บาท (1.5 ชม.) + ต.ค. 150 บาท = 300', [nov.total, nov.hours, nov.detail.map(d => d.month + ':' + d.amount + ':' + d.hours)], [300, 3, ['2026-09:150:1.5', '2026-10:150:1.5']]);
  ok_('💰 🔴 OT ที่ยังไม่อนุมัติ · OT วันหยุด · ของครูคนอื่น ไม่ถูกนับ', nov.detail[0].approved === 500 && !JSON.stringify(nov).includes('999'));
  eq('ข้อเท็จจริง: วันงดคิด OT', got['วันงดคิด OT (แถวที่เสียถูกข้าม)'].data.days, [{ from: '2026-11-02', to: '2026-11-03', reason: 'อบรม' }]);
  ok_('ข้อเท็จจริง: ใบประกาศอ่านค่าที่ตั้งไว้ + มีรูปพื้นหลัง', got['ข้อความใบประกาศ'].data.CertTitleTH === 'เกียรติบัตร' && got['ข้อความใบประกาศ'].data.hasBg === true);
  ok_('🔴 ทุก route ที่ย้ายแล้ว เป็น route ของ Code.gs และอ่านอย่างเดียว ยกเว้นตัวที่ประกาศการเขียน',
    Object.keys(ROUTES.PORTED).every(a => require(path.join(__dirname, '..', 'server', 'gate.js')).isRoute(a)) && ['myPayslipMonths', 'otCarryOver', 'otWaiveDays', 'certText'].every(a => !ROUTES.PORTED[a].writes));
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
