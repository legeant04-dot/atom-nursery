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
  'หัวหน้าครู': tokenFor('Teacher', 'STF-L', 'U-L'),
  'ผู้ปกครอง (PARENTS)': tokenFor('Parent', 'PAR-1', 'U-P1'),
  'ผู้ปกครอง (USER_LINKS)': tokenFor('Parent', 'PAR-2', 'U-P2')
};

function fixture() {
  const M = {}; ALL.forEach(k => { M[k] = []; });
  M.classes = [{ ClassID: 'C1', ClassName: 'Nursery 1' }];
  const st = (id, name, role) => ({ StaffID: id, NameTH: name, Role: role, PositionLevel: role, Department: 'Nursery 1', Classes: '*', Status: 'ACTIVE', StartDate: '2025-01-01' });
  M.staff = [st('STF-A', 'แอดมินทดสอบ', 'Admin'), st('STF-T', 'ครูทดสอบ', 'Teacher'), st('STF-T2', 'ครูทดสอบสอง', 'Teacher'),
    Object.assign(st('STF-L', 'หัวหน้าครูทดสอบ', 'Teacher'), { PositionLevel: 'Leader', Nickname: 'หัวหน้า' })];
  M.staff[1].Nickname = 'ครูที';
  /* leave requests in every state the queue filters on (src/Leave.gs LEAVE_STATUS) */
  M.leaves = [
    { LeaveID: 'LV-1', StaffID: 'STF-T', Department: 'Nursery 1', Type: 'ลาป่วย', StartDate: '2026-11-03', EndDate: '2026-11-03', Days: 1, Reason: 'ไข้', Status: 'PENDING_LEADER', CreatedDate: '2026-11-02 18:00:00', HalfDay: '' },
    { LeaveID: 'LV-2', StaffID: 'STF-T', Department: 'Nursery 1', Type: 'ลากิจ', StartDate: '2026-11-10', EndDate: '2026-11-10', Days: 0.5, Reason: 'ธุระ', Status: 'PENDING_ADMIN', Step1ApproverID: 'STF-L', Step1Status: 'APPROVED', Step1Date: '2026-11-02', CreatedDate: '2026-11-01 09:00:00', HalfDay: 'AM' },
    { LeaveID: 'LV-3', StaffID: 'STF-L', Department: 'Nursery 1', Type: 'ลาพักร้อน', StartDate: '2026-12-01', EndDate: '2026-12-03', Days: 3, Reason: '', Status: 'PENDING_ADMIN', CreatedDate: '2026-11-04 10:00:00', HalfDay: '' },
    { LeaveID: 'LV-4', StaffID: 'STF-T', Department: 'Nursery 1', Type: 'ลาป่วย', StartDate: '2026-10-01', EndDate: '2026-10-01', Days: 1, Reason: '', Status: 'APPROVED', CreatedDate: '2026-09-30 08:00:00', HalfDay: '' }];
  M.students = [
    { StudentID: 'STD-1', NameTH: 'เด็กทดสอบหนึ่ง', Nickname: 'หนึ่ง', Class: 'Nursery 1', Status: 'ACTIVE', ParentID: 'PAR-1', DOB: '2023-03-01', EnrollDate: '2025-01-01' },
    { StudentID: 'STD-2', NameTH: 'เด็กทดสอบสอง', Nickname: 'สอง', Class: 'Nursery 1', Status: 'ACTIVE', ParentID: 'PAR-2', DOB: '2023-05-01', EnrollDate: '2025-01-01' }];
  M.parents = [{ ParentID: 'PAR-1', NameTH: 'แม่ทดสอบ', StudentID: 'STD-1', LineUID: 'U-P1' },
               { ParentID: 'PAR-2', NameTH: 'พ่อทดสอบ', StudentID: '', LineUID: 'U-P2' }];
  M.userLinks = [{ UserUID: 'U-P1', StudentID: 'STD-1', ParentID: 'PAR-1', Relation: 'แม่' },
                 { UserUID: 'U-P2', StudentID: 'STD-2', ParentID: 'PAR-2', Relation: 'พ่อ' }];
  /* 💰 payslips and insurance for section 6 — numbers as the admin's screens write them */
  M.staff[1].ContributionOpening = 1200;
  M.payroll = [
    { StaffID: 'STF-T', Month: '2026-08', BaseSalary: 15000, Contribution: 450, ContributionEmployer: '', NetPay: 14550, Approved: 'YES' },
    { StaffID: 'STF-T', Month: '2026-09', BaseSalary: 15000, Contribution: 450, ContributionEmployer: 300, OT: 1250.5, NetPay: 15800.5, Approved: '' },
    { StaffID: 'STF-T', Month: '2026-10', BaseSalary: 15500, Contribution: 465, ContributionEmployer: '', NetPay: 15035, Approved: 'NO' }];
  Object.assign(M.students[0], { NationalID: '1100000000011', Gender: 'ชาย', InsurancePolicyNo: 'POL-9', InsuranceCompany: 'บริษัทประกันทดสอบ', InsuranceExpiry: '2027-05-31' });
  M.students[1].NationalID = '1100000000022';
  M.insurancePCHI = [
    { InsuranceID: 'INS-1', StudentID: 'STD-1', InsuredName: 'เด็กทดสอบหนึ่ง', DOB: '2023-03-01', EffectiveDate: '2026-06-01', FilledBy: 'PAR-1', FilledDate: '2026-05-20 10:11' },
    { InsuranceID: 'INS-2', StudentID: 'STD-OLD', NationalID: '1100000000022', InsuredName: 'เด็กทดสอบสอง', DOB: '2023-05-01' }];
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

    console.log('\n4) pendingLeaves — คิวอนุมัติการลา: โฮสต์ (Postgres) = Apps Script (ชีต)');
    {
      /* Apps Script gets exactly the rows Postgres now holds — read back the way the host reads them */
      const rawL = { LEAVE_REQUEST: await PG.readSheet(c, TENANT, 'LEAVE_REQUEST'), STAFF: await PG.readSheet(c, TENANT, 'STAFF') };
      ok_('ใบลาอ่านกลับจาก Postgres ครบ ' + rawL.LEAVE_REQUEST.length + ' ใบ', rawL.LEAVE_REQUEST.length === 4);
      H.g.__FIX = JSON.stringify(rawL);
      H.run(function () {
        var F = JSON.parse(__FIX), hr = getHrSpreadsheet_();
        ['STAFF', 'LEAVE_REQUEST'].forEach(function (n) {
          var sh = sheet_(hr, n); if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
          F[n].forEach(function (r) { appendObject_(sh, r); });
        });
        return '';
      });
      const asks = { 'แอดมิน': { staffId: 'STF-A' }, 'หัวหน้าครู': { staffId: 'STF-L' }, 'ครู': { staffId: 'STF-T' } };
      for (const k of Object.keys(asks)) {
        const p = GATE.identity('pendingLeaves', JSON.parse(JSON.stringify(asks[k])), WHO[k].sess, M);
        H.g.__P = JSON.stringify(p);
        const want = JSON.parse(H.run(function () {
          try { return JSON.stringify({ ok: true, data: handlePendingLeaves(JSON.parse(__P)) }); }
          catch (e) { return JSON.stringify({ ok: false, code: e.apiCode || e.message }); } }));
        const got = await viaHost({ action: 'pendingLeaves', payload: asks[k] }, WHO[k]);
        const g = JSON.stringify(got.ok ? { ok: true, data: got.data } : { ok: false, code: got.error && got.error.code });
        const w = JSON.stringify(want);
        ok_(k + ' → ' + (want.ok ? (want.data || []).map(x => x.LeaveID).join(',') || '(ว่าง)' : want.code) +
          (g === w ? '' : '\n         host=' + g.slice(0, 400) + '\n          gas=' + w.slice(0, 400)), g === w);
      }
      const t = await viaHost({ action: 'pendingLeaves', payload: { staffId: 'STF-L' } }, WHO['ครู']);
      ok_('🔴 ครูที่ส่ง staffId ของหัวหน้ามาเอง → NO_PERMISSION (ด่านประทับตัวตนจริง)', t.ok === false && t.error.code === 'NO_PERMISSION');
      const home = await viaHost({ action: 'batch', payload: { calls: [{ action: 'pendingLeaves', payload: { staffId: 'STF-A' } }, { action: 'notifications', payload: WHO['แอดมิน'].ask }] } }, WHO['แอดมิน']);
      ok_('หน้าแรกแอดมิน (batch) — ตอบบนโฮสต์ทั้งคู่ ไม่มี NOT_ON_FAST_HOST', home.ok && home.data.every(x => x.ok));

      /* allLeaves — the admin's whole list, through the host, against Apps Script on the same rows */
      const wantAll = JSON.parse(H.run(function () { return JSON.stringify(handleAllLeaves({ staffId: 'STF-A' })); }));
      const all = await viaHost({ action: 'allLeaves', payload: {} }, WHO['แอดมิน']);
      ok_('allLeaves แอดมิน → ' + (wantAll.map(x => x.LeaveID).join(',')) + (JSON.stringify(all.data) === JSON.stringify(wantAll) ? '' : '\n         host=' + JSON.stringify(all.data).slice(0, 300)),
        all.ok === true && JSON.stringify(all.data) === JSON.stringify(wantAll) && wantAll.length === 4);
      const fam = await viaHost({ action: 'allLeaves', payload: {} }, WHO['ผู้ปกครอง (PARENTS)']);
      ok_('🔴 ผู้ปกครองขอ allLeaves บนโฮสต์ → NO_PERMISSION (ด่าน NOT_FOR_FAMILIES_ ของ Code.gs ตัวเดียวกัน)', fam.ok === false && fam.error.code === 'NO_PERMISSION');
      const famB = await viaHost({ action: 'batch', payload: { calls: [{ action: 'listStaff', payload: {} }, { action: 'listStudents', payload: {} }, { action: 'notifications', payload: WHO['ผู้ปกครอง (PARENTS)'].ask }] } }, WHO['ผู้ปกครอง (PARENTS)']);
      ok_('🔴 ...และใน batch: listStaff · listStudents ถูกปฏิเสธ กระดิ่งของตัวเองยังได้',
        famB.ok && famB.data[0].error && famB.data[0].error.code === 'NO_PERMISSION' && famB.data[1].error && famB.data[1].error.code === 'NO_PERMISSION' && famB.data[2].ok === true);
    }

    console.log('\n5) bigCleaningDays — การตั้งค่าใน SCHOOL_CONFIG: โฮสต์ (Postgres) = Apps Script (ชีต)');
    {
      for (const [k, v] of [['BigCleaningDays', ' 2026-11-20 ,2026-12-18,'], ['BigCleaningAmount', '300'], ['BigCleaningIn', '08:15'], ['BigCleaningOut', '16:30:00']])
        await c.query('insert into school_config (tenant_id, "key", "value") values ($1, $2, $3)', [TENANT, k, v]);
      const cfgRows = await PG.readSheet(c, TENANT, 'SCHOOL_CONFIG');
      H.g.__FIX = JSON.stringify(cfgRows);
      const want = JSON.parse(H.run(function () {
        var sh = sheet_(getMainSpreadsheet_(), 'SCHOOL_CONFIG');
        if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
        JSON.parse(__FIX).forEach(function (r) { appendObject_(sh, r); });
        _configCache = null;
        return JSON.stringify(handleBigCleaningDays());
      }));
      const got = await viaHost({ action: 'bigCleaningDays', payload: {} }, WHO['ครู']);
      ok_('คำตอบเท่ากัน ' + JSON.stringify(got.data) + (JSON.stringify(got.data) === JSON.stringify(want) ? '' : '  gas=' + JSON.stringify(want)),
        got.ok === true && JSON.stringify(got.data) === JSON.stringify(want));
      ok_('ข้อเท็จจริง: ค่าที่ตั้งไว้ถูกอ่านจริง (2 วัน · 300 บาท · 08:15–16:30)', want.days.length === 2 && want.amount === 300 && want.checkIn === '08:15' && want.checkOut === '16:30');
      const p = await viaHost({ action: 'bigCleaningDays', payload: {} }, WHO['ผู้ปกครอง (PARENTS)']);
      ok_('ผู้ปกครองถามได้ (ปฏิทินโรงเรียน) และได้คำตอบเดียวกัน', p.ok === true && JSON.stringify(p.data) === JSON.stringify(want));

      /* the host reuses the rows hydrateConfig already read instead of asking again — they must BE the same rows */
      const reuse = [];
      await PG.hydrateConfig(c, TENANT, { rows: reuse });
      ok_('แถวที่ hydrateConfig ส่งต่อ = readSheet(SCHOOL_CONFIG) ทุกตัวอักษร (' + reuse.length + ' แถว)',
        reuse.length > 0 && JSON.stringify(reuse) === JSON.stringify(await PG.readSheet(c, TENANT, 'SCHOOL_CONFIG')));
      const Client = require(path.join(ROOT, 'tools', 'node_modules', 'pg')).Client;
      const q0 = Client.prototype.query; let cfgQ = 0;
      Client.prototype.query = function (sql) { if (/from school_config\b/.test(String(sql && sql.text || sql))) cfgQ++; return q0.apply(this, arguments); };
      try {
        const b2 = await viaHost({ action: 'batch', payload: { calls: [{ action: 'notifications', payload: WHO['ครู'].ask }, { action: 'bigCleaningDays', payload: {} }, { action: 'classList', payload: {} }] } }, WHO['ครู']);
        ok_('batch ที่มี route สองตัว ตอบครบ', b2.ok && b2.data.every(x => x.ok));
        ok_('🔴 อ่าน school_config ครั้งเดียวต่อคำขอ (ได้ ' + cfgQ + ')', cfgQ === 1);
      } finally { Client.prototype.query = q0; }
    }

    console.log('\n6) 💰 getPayslip · insuranceStatus — โฮสต์ (Postgres) = Apps Script (ชีต)');
    {
      const SHEETS = { STAFF: 'HR', LEAVE_REQUEST: 'HR', PAYROLL: 'HR', STUDENTS: 'MAIN', INSURANCE_PCHI: 'MAIN', SCHOOL_CONFIG: 'MAIN' };
      const rawX = {};
      for (const s of Object.keys(SHEETS)) rawX[s] = await PG.readSheet(c, TENANT, s);
      ok_('อ่านกลับจาก Postgres: สลิป ' + rawX.PAYROLL.length + ' · แบบประกัน ' + rawX.INSURANCE_PCHI.length, rawX.PAYROLL.length === 3 && rawX.INSURANCE_PCHI.length === 2);
      console.log('       (ชนิดของตัวเลขเงินที่ Postgres คืน: BaseSalary=' + JSON.stringify(rawX.PAYROLL[0].BaseSalary) + ' · NetPay=' + JSON.stringify(rawX.PAYROLL[1].NetPay) + ')');
      const H2 = require('./gas_test_harness.js')(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Checkin', 'Triggers', 'Leave',
        'Notify', 'Parent', 'Staff', 'GasEngine', 'Engine', 'Payroll', 'Day6']);
      H2.g.__FIX = JSON.stringify({ raw: rawX, wb: SHEETS });
      H2.run(function () {
        _configCache = null; setupAll(); _configCache = null;
        var F = JSON.parse(__FIX);
        Object.keys(F.raw).forEach(function (n) {
          var sh = sheet_(F.wb[n] === 'HR' ? getHrSpreadsheet_() : getMainSpreadsheet_(), n);
          if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
          F.raw[n].forEach(function (r) { appendObject_(sh, r); });
        });
        _configCache = null;
        return '';
      });
      const ASK = [
        ['getPayslip', 'handleGetPayslip', 'ครู', { month: '2026-08' }],
        ['getPayslip', 'handleGetPayslip', 'ครู', { month: '2026-09' }],
        ['getPayslip', 'handleGetPayslip', 'ครู', { month: '2026-10' }],
        ['getPayslip', 'handleGetPayslip', 'แอดมิน', { staffId: 'STF-T', month: '2026-10' }],
        ['getPayslip', 'handleGetPayslip', 'ครู', { month: '2026-11' }],
        ['insuranceStatus', 'handleInsuranceStatus', 'ผู้ปกครอง (PARENTS)', { studentId: 'STD-1' }],
        ['insuranceStatus', 'handleInsuranceStatus', 'แอดมิน', { studentId: 'STD-2' }]];
      const seen = {};
      for (const [a, fn, who, ask] of ASK) {
        const p = GATE.identity(a, JSON.parse(JSON.stringify(ask)), WHO[who].sess, M);
        H2.g.__P = JSON.stringify(p); H2.g.__F = fn;
        const want = JSON.parse(H2.run(function () {
          try { return JSON.stringify({ ok: true, data: this[__F](JSON.parse(__P)) }); }
          catch (e) { return JSON.stringify({ ok: false, code: e.apiCode || e.message }); } }));
        const got = await viaHost({ action: a, payload: ask }, WHO[who]);
        const g = JSON.stringify(got.ok ? { ok: true, data: got.data } : { ok: false, code: got.error && got.error.code });
        const w = JSON.stringify(want);
        seen[a + '|' + who + '|' + JSON.stringify(ask)] = want;
        ok_(a + ' · ' + who + ' ' + JSON.stringify(ask) + (g === w ? '' : '\n         host=' + g.slice(0, 400) + '\n          gas=' + w.slice(0, 400)), g === w);
      }
      const aug = seen['getPayslip|ครู|{"month":"2026-08"}'].data;
      ok_('💰 ข้อเท็จจริง: สลิปสิงหาคม · สมทบนายจ้าง 450 · ยอดสะสม 3,780 (การเทียบข้างบนไม่ใช่ว่างกับว่าง)',
        !!aug && Number(aug.ContributionEmployer) === 450 && Number(aug.ContributionAccum) === 3780 && aug.Month === '2026-08');
      ok_('💰 🔴 ข้อเท็จจริง: สลิปที่ยังไม่อนุมัติ ครูได้ null · แอดมินเห็น',
        seen['getPayslip|ครู|{"month":"2026-10"}'].data === null && !!seen['getPayslip|แอดมิน|{"staffId":"STF-T","month":"2026-10"}'].data);
      /* 🔴 the comparison above feeds BOTH sides the rows Postgres returned, so it cannot see a type that
       * differs from Sheets. Live Sheets hands a money cell back as a NUMBER — assert that directly.
       * (It was '15000.00' until decode_ learned that 'numeric(12,2)' is numeric — 2026-11-06.) */
      const hostSep = (await viaHost({ action: 'getPayslip', payload: { month: '2026-09' } }, WHO['ครู'])).data || {};
      const MONEY = ['BaseSalary', 'Contribution', 'NetPay', 'ContributionEmployer', 'ContributionAccum'];
      ok_('💰 🔴 ตัวเลขเงินเป็น number เหมือนชีตจริง ไม่ใช่ข้อความ ' + JSON.stringify(MONEY.map(k => hostSep[k])),
        MONEY.every(k => typeof hostSep[k] === 'number') && hostSep.NetPay === 15800.5 && hostSep.BaseSalary === 15000);
      const ml = await viaHost({ action: 'myLeaves', payload: {} }, WHO['ครู']);
      ok_('myLeaves ยังตอบจาก engine บนโฮสต์ (ไม่ใช่ NOT_ON_FAST_HOST)', ml.ok === true);
      const other = await viaHost({ action: 'getPayslip', payload: { staffId: 'STF-L', month: '2026-08' } }, WHO['ครู']);
      ok_('🔴 ครูที่ขอสลิปของคนอื่น ได้ของตัวเอง (ด่านประทับ staffId)', other.ok && other.data && other.data.StaffID === 'STF-T');
      const ins = seen['insuranceStatus|แอดมิน|{"studentId":"STD-2"}'].data;
      ok_('ข้อเท็จจริง: แบบประกันพบด้วยเลขบัตรประชาชน (INS-2)', ins && ins.filled === true && ins.record.InsuranceID === 'INS-2');
      const tb = await viaHost({ action: 'batch', payload: { calls: [{ action: 'myLeaves', payload: {} }, { action: 'getPayslip', payload: { month: '2026-09' } }, { action: 'notifications', payload: WHO['ครู'].ask }] } }, WHO['ครู']);
      ok_('batch ของครู — ตอบบนโฮสต์ทั้งหมด ไม่มี NOT_ON_FAST_HOST', tb.ok && tb.data.every(x => x.ok));
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
