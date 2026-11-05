/**
 * tools/test_fast_routes_live.js — the 🔔 bell through server/host.js and staging Postgres
 *   node tools/test_fast_routes_live.js          (needs secrets/supabase.env — fabricated data only)
 *
 * tools/test_fast_routes.js proves server/routes.js answers what Apps Script answers given the same
 * rows. This proves the rest of the path: the rows the HOST reads back out of Postgres (PG.readSheet —
 * column names, types, order) and the identity the HOST stamps (server/gate.js) give the same answer
 * as Apps Script's own handleNotifications run on the sheets those rows came from.
 *
 *   ① seed a p23- tenant with fabricated staff, children, families and inbox rows
 *   ② EXPECTED: the GAS harness, seeded with the SAME rows, runs handleNotifications with the payload
 *      Code.gs's applyIdentity_ stamps for that session
 *   ③ ACTUAL: the same request to the real server/host.js handle(), against staging
 *   + in a teacher-home batch the bell is answered, not NOT_ON_FAST_HOST, and nothing is written
 * 🔴 Fabricated data only; the tenant is deleted at the end (pg_sweep_tenants knows the p23- prefix).
 */
'use strict';
const path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const TENANT = crypto.randomUUID();
const SECRET = 'routes-live-' + crypto.randomBytes(12).toString('hex');
process.env.SESSION_SECRET = SECRET;
process.env.TENANT_ID = TENANT;

const { connect } = require(path.join(ROOT, 'tools', 'pg_lib.js'));
const PG = require(path.join(ROOT, 'tools', 'pg_engine.js'));
const GATE = require(path.join(ROOT, 'server', 'gate.js'));
const { handle } = require(path.join(ROOT, 'server', 'host.js'));
const { sign_ } = require(path.join(ROOT, 'server', 'session.js'));
const ALL = Object.keys(PG.COLLECTIONS);
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());

const NOW = Date.now();
/* `ask` = what the app really sends: notifParams() in webapp/app.js is {role, parentId, staffId} from USER.
 * It matters — applyIdentity_ stamps a teacher's and a parent's identity but leaves an ADMIN's payload
 * as sent, so the admin's bell is decided by these fields. An empty payload gives the admin nothing. */
const tokenFor = (role, linkedId, uid) => {
  const b = Buffer.from(JSON.stringify({ uid, role, linkedId, iat: NOW, exp: NOW + 3600e3 })).toString('base64');
  const ask = { role, parentId: role === 'Parent' ? linkedId : undefined, staffId: role === 'Parent' ? undefined : linkedId };
  return { sess: { uid, role, linkedId }, token: b + '.' + sign_(b, SECRET), ask: JSON.parse(JSON.stringify(ask)) };
};
const WHO = {
  'แอดมิน': tokenFor('Admin', 'STF-A', 'U-A'),
  'ครู': tokenFor('Teacher', 'STF-T', 'U-T'),
  'ครูที่ยังไม่มีอะไร': tokenFor('Teacher', 'STF-T2', 'U-T2'),
  'ผู้ปกครอง (PARENTS)': tokenFor('Parent', 'PAR-1', 'U-P1'),
  'ผู้ปกครอง (USER_LINKS)': tokenFor('Parent', 'PAR-2', 'U-P2')
};

function fixture() {
  const M = {}; ALL.forEach(k => { M[k] = []; });
  M.classes = [{ ClassID: 'C1', ClassName: 'Nursery 1' }];
  const st = (id, name, role) => ({ StaffID: id, NameTH: name, Role: role, PositionLevel: role, Department: 'Nursery 1', Classes: '*', Status: 'ACTIVE', StartDate: '2025-01-01' });
  M.staff = [st('STF-A', 'แอดมินทดสอบ', 'Admin'), st('STF-T', 'ครูทดสอบ', 'Teacher'), st('STF-T2', 'ครูทดสอบสอง', 'Teacher')];
  M.students = [
    { StudentID: 'STD-1', NameTH: 'เด็กทดสอบหนึ่ง', Nickname: 'หนึ่ง', Class: 'Nursery 1', Status: 'ACTIVE', ParentID: 'PAR-1', DOB: '2023-03-01', EnrollDate: '2025-01-01' },
    { StudentID: 'STD-2', NameTH: 'เด็กทดสอบสอง', Nickname: 'สอง', Class: 'Nursery 1', Status: 'ACTIVE', ParentID: 'PAR-2', DOB: '2023-05-01', EnrollDate: '2025-01-01' }];
  M.parents = [{ ParentID: 'PAR-1', NameTH: 'แม่ทดสอบ', StudentID: 'STD-1', LineUID: 'U-P1' },
               { ParentID: 'PAR-2', NameTH: 'พ่อทดสอบ', StudentID: '', LineUID: 'U-P2' }];
  M.userLinks = [{ UserUID: 'U-P1', StudentID: 'STD-1', ParentID: 'PAR-1', Relation: 'แม่' },
                 { UserUID: 'U-P2', StudentID: 'STD-2', ParentID: 'PAR-2', Relation: 'พ่อ' }];
  return M;
}
const T0 = NOW - 3 * 86400e3;
const INBOX = [];
for (let i = 0; i < 12; i++) INBOX.push({ InboxID: 'IN-' + (T0 + i * 61000) + '-' + i, Date: '2026-11-02 08:' + String(i).padStart(2, '0'), Category: i % 2 ? 'approval' : 'leave', Text: 'แจ้งแอดมิน ' + i, Read: i % 3 ? '' : 'YES', Ref: i % 4 ? '' : 'leave|L-' + i, StaffID: '', StudentID: '' });
INBOX.push({ InboxID: 'IN-legacy-1', Date: '2026-07-22 09:15', Category: 'approval', Text: 'แถวเก่า', Read: '', Ref: '', StaffID: '', StudentID: '' });
INBOX.push({ InboxID: 'IN-' + (T0 + 5e6) + '-20', Date: '2026-11-02 10:23', Category: 'comment', Text: 'ผู้ปกครองส่งข้อความ', Read: '', Ref: 'comment|STD-1', StaffID: 'STF-T', StudentID: '' });
INBOX.push({ InboxID: 'IN-' + (T0 + 7e6) + '-21', Date: '2026-11-02 11:00', Category: 'journal', Text: 'สมุดสื่อสารของหนึ่ง', Read: 'YES', Ref: 'journal|STD-1', StaffID: '', StudentID: 'STD-1' });
INBOX.push({ InboxID: 'IN-' + (T0 + 8e6) + '-22', Date: '2026-11-02 11:30', Category: 'checkin', Text: 'สองมาถึงโรงเรียนแล้ว', Read: '', Ref: '', StaffID: '', StudentID: 'STD-2' });

async function viaHost(msg, who) {
  let out = '';
  const res = { setHeader() {}, writeHead() {}, end(s) { out = s; } };
  await handle({}, res, JSON.stringify(Object.assign({ token: who.token }, msg)));
  return JSON.parse(out);
}
const q = s => '"' + s + '"';

(async () => {
  const { client: c } = await connect();
  try {
    await c.query("insert into tenant (id, code, name_th) values ($1, $2, 'ทดสอบ route บนโฮสต์ (ข้อมูลปลอม)')", [TENANT, 'p23-' + TENANT.slice(0, 8)]);
    for (const [k, v] of [['Departments', 'Nursery 1'], ['Timezone', 'Asia/Bangkok']])
      await c.query('insert into school_config (tenant_id, "key", "value") values ($1, $2, $3)', [TENANT, k, v]);
    await PG.persist(c, TENANT, fixture(), {}, ALL);
    const cols = PG.SHEET_COLS().ADMIN_INBOX;
    for (const r of INBOX)
      await c.query('insert into admin_inbox (tenant_id,' + cols.map(x => q(PG.snake(x))).join(',') + ') values ($1,' + cols.map((_, i) => '$' + (i + 2)).join(',') + ')',
        [TENANT].concat(cols.map(x => r[x] === undefined ? null : String(r[x]))));

    /* ② Apps Script, seeded with what Postgres holds now (read back the way the host reads it) */
    const raw = {};
    for (const s of ['ADMIN_INBOX', 'PARENTS', 'USER_LINKS']) raw[s] = await PG.readSheet(c, TENANT, s);
    ok_('อ่านกลับจาก Postgres ครบ  inbox=' + raw.ADMIN_INBOX.length, raw.ADMIN_INBOX.length === INBOX.length);
    ok_('...ตามลำดับที่บันทึก', raw.ADMIN_INBOX.map(r => r.InboxID).join() === INBOX.map(r => r.InboxID).join());
    delete process.env.ATOM_DB;
    const H = require('./gas_test_harness.js')(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Checkin', 'Triggers', 'Leave',
      'Notify', 'Parent', 'Staff', 'GasEngine', 'Engine']);
    H.g.__FIX = JSON.stringify({ inbox: INBOX, parents: fixture().parents, links: fixture().userLinks });
    H.run(function () {
      _configCache = null; setupAll(); _configCache = null;
      var F = JSON.parse(__FIX), ss = getMainSpreadsheet_();
      F.inbox.forEach(function (r) { appendObject_(sheet_(ss, 'ADMIN_INBOX'), r); });
      F.parents.forEach(function (r) { appendObject_(sheet_(ss, 'PARENTS'), r); });
      F.links.forEach(function (r) { appendObject_(sheet_(ss, 'USER_LINKS'), r); });
      return '';
    });
    const { M } = await PG.hydrateFast(c, TENANT, ALL, {});
    M.config = await PG.hydrateConfig(c, TENANT);
    await PG.hydrateDerived(c, TENANT, M, TODAY);

    console.log('\n1) 🔔 กระดิ่งของทุกคน: โฮสต์ (Postgres) = Apps Script (ชีต)');
    for (const k of Object.keys(WHO)) {
      const p = GATE.identity('notifications', JSON.parse(JSON.stringify(WHO[k].ask)), WHO[k].sess, M);
      H.g.__P = JSON.stringify(p);
      const want = JSON.parse(H.run(function () { return JSON.stringify({ ok: true, data: handleNotifications(JSON.parse(__P)) }); }));
      const got = await viaHost({ action: 'notifications', payload: WHO[k].ask }, WHO[k]);
      const g = JSON.stringify({ ok: got.ok, data: got.data }), w = JSON.stringify(want);
      if (k === 'แอดมิน') ok_('แอดมินเห็นกล่องรวม 13 รายการ (ไม่ใช่ 0 — ข้อมูลทดสอบถูกใช้จริง)', (want.data || []).length === 13);
      ok_(k + ' (' + (want.data || []).length + ' รายการ)' + (g === w ? '' : '\n         host=' + g.slice(0, 300) + '\n          gas=' + w.slice(0, 300)), g === w);
    }

    {
      /* 🔴 the admin's bell trusts the payload — so a teacher or parent claiming to be Admin must be stamped back */
      const r = await viaHost({ action: 'notifications', payload: { role: 'Admin', staffId: '' } }, WHO['ครู']);
      ok_('🔴 ครูที่ส่ง role:"Admin" มาเอง ไม่เห็นกล่องของแอดมิน (เห็น ' + ((r.data || []).length) + ' = ของตัวเอง)',
        r.ok && r.data.length === 1 && r.data[0].text === 'ผู้ปกครองส่งข้อความ');
      const pr = await viaHost({ action: 'notifications', payload: { role: 'Admin', parentId: 'PAR-2' } }, WHO['ผู้ปกครอง (PARENTS)']);
      ok_('🔴 ผู้ปกครองที่ส่ง role:"Admin" + parentId ของคนอื่น ได้เฉพาะของลูกตัวเอง',
        pr.ok && pr.data.length === 1 && pr.data[0].text === 'สมุดสื่อสารของหนึ่ง');
    }

    console.log('\n2) หน้าแรกของครู (batch) — กระดิ่งตอบจากโฮสต์ ไม่ถูกส่งต่อ');
    const before = JSON.stringify((await PG.hydrateFast(c, TENANT, ALL, {})).M, (k, v) => k === '__id' ? undefined : v);
    const inboxBefore = JSON.stringify(await PG.readSheet(c, TENANT, 'ADMIN_INBOX'));
    const b = await viaHost({ action: 'batch', payload: { calls: [{ action: 'staffSelf', payload: {} }, { action: 'notifications', payload: WHO['ครู'].ask }, { action: 'classList', payload: {} }] } }, WHO['ครู']);
    ok_('batch สำเร็จ', b.ok === true && Array.isArray(b.data));
    ok_('🔴 notifications ตอบได้ ไม่ใช่ NOT_ON_FAST_HOST', b.data && b.data[1] && b.data[1].ok === true && b.data[1].data.length === 1);
    ok_('call อื่นใน batch ยังตอบปกติ', b.data && b.data[0].ok && b.data[2].ok);
    ok_('🔴 ไม่มีอะไรถูกเขียน (ทุก collection + ADMIN_INBOX เหมือนเดิม)',
      JSON.stringify((await PG.hydrateFast(c, TENANT, ALL, {})).M, (k, v) => k === '__id' ? undefined : v) === before &&
      JSON.stringify(await PG.readSheet(c, TENANT, 'ADMIN_INBOX')) === inboxBefore);
    console.log('\n3) markNotifsRead — กด "อ่านแล้ว" ผ่านโฮสต์ = ผลบน Apps Script ทุกแถว');
    const readCol = async () => (await PG.readSheet(c, TENANT, 'ADMIN_INBOX')).map(r => r.InboxID + '=' + r.Read);
    const gasCol = () => JSON.parse(H.run(function () {
      return JSON.stringify(readObjects_(sheet_(getMainSpreadsheet_(), 'ADMIN_INBOX')).map(function (r) { return r.InboxID + '=' + r.Read; }));
    }));
    {
      /* 🔴 first, while Apps Script holds the shared write lock: BUSY, and not one cell changes */
      const { client: gasLock } = await connect();
      await gasLock.query('select pg_advisory_lock(hashtextextended($1, 0))', [TENANT]);
      const before = await readCol();
      const r = await viaHost({ action: 'markNotifsRead', payload: WHO['แอดมิน'].ask }, WHO['แอดมิน']);
      ok_('🔴 Apps Script ถือล็อกอยู่ → BUSY', r.ok === false && r.error && r.error.code === 'BUSY');
      ok_('🔴 ...และไม่มีช่องไหนเปลี่ยน', JSON.stringify(await readCol()) === JSON.stringify(before));
      await gasLock.query('select pg_advisory_unlock(hashtextextended($1, 0))', [TENANT]);
      await gasLock.end();
    }
    /* then each audience in turn, on BOTH sides, comparing the whole inbox after every step */
    const ORDER = ['ครู', 'ผู้ปกครอง (PARENTS)', 'ผู้ปกครอง (USER_LINKS)', 'แอดมิน', 'ครูที่ยังไม่มีอะไร'];
    for (const k of ORDER) {
      const p = GATE.identity('markNotifsRead', JSON.parse(JSON.stringify(WHO[k].ask)), WHO[k].sess, M);
      H.g.__P = JSON.stringify(p);
      const want = JSON.parse(H.run(function () { return JSON.stringify(handleMarkNotifsRead(JSON.parse(__P))); }));
      const was = await readCol();
      const got = await viaHost({ action: 'markNotifsRead', payload: WHO[k].ask }, WHO[k]);
      const now = await readCol(), g = gasCol();
      const n = now.filter((x, i) => x !== was[i]).length;
      ok_(k + ': คำตอบเท่ากัน', JSON.stringify(got.data) === JSON.stringify(want) && got.ok === true);
      ok_(k + ': ADMIN_INBOX ใน Postgres = ชีตของ Apps Script ทุกแถว (' + n + ' แถวเปลี่ยน)' +
        (JSON.stringify(now) === JSON.stringify(g) ? '' : '\n         pg=' + JSON.stringify(now).slice(0, 300) + '\n        gas=' + JSON.stringify(g).slice(0, 300)),
        JSON.stringify(now) === JSON.stringify(g));
    }
    ok_('🔴 ข้อเท็จจริง: ทุกแถวที่ยังไม่อ่านถูกอ่านแล้ว (การเทียบข้างบนไม่ใช่ว่างกับว่าง)', (await readCol()).every(x => /=YES$/.test(x)));
    {
      /* the batch the app sends when the bell is opened: mark, then read again — the read sees the write */
      await c.query("update admin_inbox set \"read\" = '' where tenant_id = $1 and staff_id = 'STF-T'", [TENANT]);
      const b2 = await viaHost({ action: 'batch', payload: { calls: [{ action: 'markNotifsRead', payload: WHO['ครู'].ask }, { action: 'notifications', payload: WHO['ครู'].ask }] } }, WHO['ครู']);
      ok_('batch [อ่านแล้ว, กระดิ่ง] → กระดิ่งเห็นว่าอ่านแล้ว', b2.ok && b2.data[0].ok && b2.data[1].ok && b2.data[1].data.length === 1 && b2.data[1].data[0].read === true);
      ok_('...และบันทึกจริงใน Postgres', (await readCol()).every(x => /=YES$/.test(x)));
    }
    {
      /* a family cannot reach another family's row, or the admin's: the gate stamps its identity */
      await c.query("update admin_inbox set \"read\" = '' where tenant_id = $1", [TENANT]);
      await viaHost({ action: 'markNotifsRead', payload: { role: 'Admin', parentId: 'PAR-2', staffId: '' } }, WHO['ผู้ปกครอง (PARENTS)']);
      const col = await readCol();
      const yes = col.filter(x => /=YES$/.test(x)).map(x => x.split('=')[0]);
      ok_('🔴 ผู้ปกครองที่อ้างเป็นแอดมิน อ่านได้เฉพาะแถวของลูกตัวเอง (' + yes.join(',') + ')', yes.length === 1 && yes[0] === INBOX[14].InboxID);
    }
  } finally {
    const tabs = (await c.query("select table_name from information_schema.tables where table_schema='public' and table_name <> 'tenant'")).rows.map(r => r.table_name);
    for (const t of tabs) { try { await c.query('delete from ' + t + ' where tenant_id = $1', [TENANT]); } catch (e) {} }
    await c.query('delete from tenant where id = $1', [TENANT]);
    const left = (await c.query('select count(*)::int n from admin_inbox where tenant_id = $1', [TENANT])).rows[0].n;
    console.log('\n🧹 ลบ tenant ทดสอบแล้ว (เหลือ ' + left + ' แถว)');
    await c.end();
  }
  console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('🔴 ' + (e && e.stack || e)); process.exit(1); });
