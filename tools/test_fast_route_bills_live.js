/**
 * tools/test_fast_route_bills_live.js — W4 3a bills through server/host.js and staging Postgres
 *   node tools/test_fast_route_bills_live.js       (needs secrets/supabase.env — fabricated data only)
 *
 * tools/test_fast_route_bills.js proves routes.js does what Apps Script does from the same rows. This proves the
 * host's half: the session must be an ADMIN, BILLING really loses exactly the rows Apps Script would delete (the
 * host's shrink guard lets ONLY deleteBill/undoBillRun through — host.js shrinkOk), the rest of BILLING is untouched
 * and comes back equal, and the family messages are what Apps Script sends. LINE_SEND=capture — nothing is sent.
 * 🔴 Fabricated data only; the tenant is deleted at the end (pg_sweep_tenants knows the p23- prefix).
 */
'use strict';
const path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const TENANT = crypto.randomUUID();
const SECRET = 'route-bills-live-' + crypto.randomBytes(12).toString('hex');
process.env.SESSION_SECRET = SECRET;
process.env.TENANT_ID = TENANT;
process.env.LINE_SEND = 'capture';
delete process.env.LINE_TOKEN;

const { connect } = require(path.join(ROOT, 'tools', 'pg_lib.js'));
const PG = require(path.join(ROOT, 'tools', 'pg_engine.js'));
const GATE = require(path.join(ROOT, 'server', 'gate.js'));
const LINE = require(path.join(ROOT, 'server', 'line_send.js'));
const ROUTES = require(path.join(ROOT, 'server', 'routes.js'));
const { handle } = require(path.join(ROOT, 'server', 'host.js'));
const { sign_ } = require(path.join(ROOT, 'server', 'session.js'));
const ALL = Object.keys(PG.COLLECTIONS);

const REAL_NOW = Date.now();
const tokenFor = (role, linkedId, uid) => {
  const b = Buffer.from(JSON.stringify({ uid, role, linkedId, iat: REAL_NOW, exp: REAL_NOW + 3600e3 })).toString('base64');
  return { sess: { uid, role, linkedId }, token: b + '.' + sign_(b, SECRET) };
};
const A = tokenFor('Admin', 'STF-A', 'U-A'), T = tokenFor('Teacher', 'STF-T', 'U-T'), OBS = tokenFor('Observer', 'STF-O', 'U-O');

const kid = (id, nick) => ({ StudentID: id, Name: 'ด.ช. ' + nick, Nickname: nick, Class: 'N1', Plan: 'P1', ParentID: 'PAR-' + id.slice(-2), Status: 'ACTIVE', EnrollDate: '2026-06-01' });
const bill = (sid, month, extra) => Object.assign({ BillingID: 'BL-' + month + '-' + sid, StudentID: sid, Month: month, Amount: 6900, Status: 'UNPAID', SlipAmount: 0, DueDate: month + '-05' }, extra || {});
const RUN_OLD = 'BR-2026-10-20261001T0900', RUN = 'BR-2026-11-20261101T1015';
const SEED = {
  STAFF: [{ StaffID: 'STF-A', Name: 'แอดมินเอ', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', StartDate: '2025-01-01' },
    { StaffID: 'STF-T', Name: 'ครูที', Role: 'Teacher', PositionLevel: 'Teacher', Department: 'N1', Status: 'ACTIVE', StartDate: '2025-01-01' },
    { StaffID: 'STF-O', Name: 'ผู้ตรวจ', Role: 'Observer', PositionLevel: 'Teacher', Status: 'ACTIVE', StartDate: '2025-01-01' }],
  STUDENTS: [kid('S01', 'เอ'), kid('S02', 'บี'), kid('S03', 'ซี'), kid('S04', 'ดี'), kid('S05', 'อี'), kid('S06', 'เอฟ'), kid('S07', 'จี')],
  PARENTS: [{ ParentID: 'PAR-01', Name: 'แม่เอ', LineUID: 'Uparenttest00001', StudentID: 'S01' }, { ParentID: 'PAR-02', Name: 'แม่บี', LineUID: '', StudentID: 'S02' }],
  USER_LINKS: [{ UserUID: 'Ufathertest00001', StudentID: 'S01' }],
  BILLING: [bill('S01', '2026-10', { BillRun: RUN_OLD }), bill('S01', '2026-11', { BillRun: RUN }), bill('S02', '2026-11', { BillRun: RUN }),
    bill('S03', '2026-11', { BillRun: RUN, Status: 'PAID', SlipAmount: 6900, PaidDate: '2026-11-03', VerifiedStatus: 'CONFIRMED' }),
    bill('S04', '2026-11', { BillRun: RUN, Status: 'PARTIAL', SlipAmount: 1000 }), bill('S05', '2026-11', { BillRun: RUN, Amount: 4500 }),
    bill('S06', '2026-11', {}), bill('S07', '2026-11', {})],
  PAYMENT_SLIPS: [{ SlipID: 'SLP-1', RefKind: 'bill', RefID: 'BL-2026-11-S02', StudentID: 'S02', Amount: 6900, Status: 'SUBMITTED' },
    { SlipID: 'SLP-2', RefKind: 'bill', RefID: 'BL-2026-11-S07', StudentID: 'S07', Amount: 6900, Status: 'CONFIRMED' }]
};
const CONFIG = [['Timezone', 'Asia/Bangkok'], ['NotifyParentBill', 'app,line'], ['LineChannelAccessToken', 'fake-token-not-real']];
const SHEETS = [['MAIN', 'BILLING'], ['MAIN', 'ADMIN_INBOX'], ['MAIN', 'AUDIT_LOG']];
const SEEDED = [['MAIN', 'SCHOOL_CONFIG'], ['HR', 'STAFF'], ['MAIN', 'STUDENTS'], ['MAIN', 'PARENTS'], ['MAIN', 'USER_LINKS'], ['MAIN', 'PAYMENT_SLIPS'], ['MAIN', 'USERS']];

async function viaHost(msg, who) {
  let out = ''; const hdr = {};
  const res = { setHeader(k, v) { hdr[k.toLowerCase()] = v; }, writeHead() {}, end(s) { out = s; } };
  await handle({}, res, JSON.stringify(Object.assign({ token: who.token }, msg)));
  const r = JSON.parse(out);
  r.__line = hdr['x-atom-line'] ? JSON.parse(hdr['x-atom-line']) : [];
  return r;
}
const norm = (name, rows) => rows.map(r => { const o = Object.assign({}, r); delete o.__id;
  if (name === 'ADMIN_INBOX') o.InboxID = String(o.InboxID || '').indexOf('IN-') === 0 ? 'IN-…' : o.InboxID;
  if (name === 'AUDIT_LOG') { const s = String(o.Timestamp || '');
    const t = Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + '+07:00');
    o.Timestamp = isFinite(t) ? 'min:' + Math.floor(t / 60000) : s; }
  Object.keys(o).forEach(k => {
    if (o[k] == null) o[k] = '';
    if (typeof o[k] === 'number' || typeof o[k] === 'boolean') o[k] = String(o[k]);
    if (/^-?\d+\.0+$/.test(o[k])) o[k] = o[k].replace(/\.0+$/, '');
  });
  return o; });

(async () => {
  const { client: c } = await connect();
  try {
    await c.query("insert into tenant (id, code, name_th) values ($1, $2, 'ทดสอบบิลบนโฮสต์ (ข้อมูลปลอม)')", [TENANT, 'p23-' + TENANT.slice(0, 8)]);
    for (const [k, v] of CONFIG) await c.query('insert into school_config (tenant_id, "key", "value") values ($1, $2, $3)', [TENANT, k, v]);
    for (const s of Object.keys(SEED)) for (const row of SEED[s]) await PG.insertSheetRow(c, TENANT, s, row);

    delete process.env.ATOM_DB;
    const H = require('./gas_test_harness.js')(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Checkin', 'Triggers', 'Leave',
      'Notify', 'Parent', 'Staff', 'GasEngine', 'Engine', 'Payroll', 'Day6', 'OtStaff', 'OT', 'PaySlips', 'Password', 'BillRun', 'Certificate', 'Dspm', 'DspmAdmin', 'Journal', 'Announce']);
    const start = {};
    for (const [wb, s] of SHEETS.concat(SEEDED)) start[s] = await PG.readSheet(c, TENANT, s);
    H.g.__FIX = JSON.stringify(start); H.g.__SHEETS = JSON.stringify(SHEETS.concat(SEEDED));
    H.run(function () {
      _configCache = null; setupAll(); _configCache = null;
      var F = JSON.parse(__FIX), main = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
      JSON.parse(__SHEETS).forEach(function (x) {
        var wb = x[0] === 'HR' ? hr : main, sh = wb.getSheetByName(x[1]) || sheet_(wb, x[1]);
        if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
        if (x[1] === 'BILLING') ensureColumns_(sh, ['BillRun', 'IssuedDate', 'ReceiptDate']);
        (F[x[1]] || []).forEach(function (r) { appendObject_(sh, r); });
      });
      _configCache = null; return '';
    });
    const gasState = () => JSON.parse(H.run(function () {
      var out = {}, main = getMainSpreadsheet_();
      JSON.parse(__SHEETS).slice(0, 3).forEach(function (x) {
        out[x[1]] = readObjects_(sheet_(main, x[1])).map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; return o; });
      });
      return JSON.stringify(out);
    }));
    const pgState = async () => { const o = {}; for (const [, s] of SHEETS) o[s] = await PG.readSheet(c, TENANT, s); return o; };
    const { M } = await PG.hydrateFast(c, TENANT, ALL, {});
    M.config = await PG.hydrateConfig(c, TENANT);
    H.g.__FAKE = ROUTES.FAKE_DATE;
    const at = (ymd, hm) => { const ms = Date.parse(ymd + 'T' + hm + ':00+07:00'); ROUTES.setClock(ms); H.g.__MS = ms;
      H.run(function () { if (typeof __RD === 'undefined') __RD = Date; Date = __RD; eval(__FAKE)(__MS); return ''; }); };

    const step = async (label, action, fn, ask, who) => {
      const p = GATE.identity(action, JSON.parse(JSON.stringify(ask)), who.sess, M);
      H.g.__P = JSON.stringify(p); H.g.__F = fn;
      const want = JSON.parse(H.run(function () {
        _configCache = null; PUSH.length = 0;
        var r; try { r = { ok: true, data: this[__F](JSON.parse(__P)) }; } catch (e) { r = { ok: false, code: e.apiCode || e.message }; }
        r.line = PUSH.slice(); return JSON.stringify(r); }));
      const got = await viaHost({ action, payload: ask }, who);
      if (!got.ok && process.env.DEBUG_LIVE) console.log('         host error: ' + JSON.stringify(got.error).slice(0, 400));
      const g = JSON.stringify(got.ok ? { ok: true, data: got.data } : { ok: false, code: got.error && got.error.code });
      const w = JSON.stringify(want.ok ? { ok: true, data: want.data } : { ok: false, code: want.code });
      ok_(label + ' — คำตอบ' + (g === w ? '' : '\n         host=' + g.slice(0, 300) + '\n          gas=' + w.slice(0, 300)), g === w);
      const pg = await pgState(), gs = gasState();
      const diff = Object.keys(gs).filter(k => JSON.stringify(norm(k, pg[k] || [])) !== JSON.stringify(norm(k, gs[k])));
      ok_('   ...ทุกตารางใน Postgres = Apps Script' + (diff.length ? '  ต่าง: ' + diff.join(',') : ''), !diff.length);
      diff.forEach(k => { const P = norm(k, pg[k] || []), Gs = norm(k, gs[k]); const fields = [];
        Gs.forEach((gr, i) => { const pr = P[i] || {}; Object.keys(Object.assign({}, gr, pr)).forEach(f => {
          if (JSON.stringify(gr[f]) !== JSON.stringify(pr[f])) fields.push('#' + i + '.' + f + ' pg=' + JSON.stringify(pr[f]) + ' gas=' + JSON.stringify(gr[f])); }); });
        console.log('         ' + k + ' (pg ' + P.length + ' แถว · gas ' + Gs.length + ' แถว)\n           ' + fields.slice(0, 8).join('\n           ')); });
      const wantFp = want.line.map(x => LINE.fingerprint({ to: x.to, messages: [{ type: 'text', text: x.text }] }));
      ok_('   ...LINE ที่โฮสต์จด = ที่ Apps Script ส่ง (' + wantFp.length + ')', JSON.stringify(got.__line) === JSON.stringify(wantFp));
      return { got, want };
    };
    const ids = async () => (await PG.readSheet(c, TENANT, 'BILLING')).map(b => b.BillingID);
    const ADM = { staffId: 'STF-A' };
    at('2026-11-12', '09:00');

    console.log('\n1) 🔴 ประตู');
    for (const [a, who, name] of [['undoBillRun', T, 'ครู'], ['deleteBill', T, 'ครู'], ['deleteBill', OBS, 'ผู้ตรวจ']]) {
      const o = await viaHost({ action: a, payload: { runId: RUN, confirm: true, billingId: 'BL-2026-11-S06' } }, who);
      ok_('🔴 ' + name + ' เรียก ' + a + ' → ' + (o.error && o.error.code) + ' ไม่ลบอะไร', o.ok === false && (await ids()).length === 8);
    }

    console.log('\n2) รอบล่าสุด → 💰 ย้อนกลับ (BILLING หดได้เฉพาะทางนี้)');
    let r = await step('รอบล่าสุด', 'billRunLast', 'handleBillRunLast', ADM, A);
    ok_('...ย้อนได้ เอ · อี (11,400) · เก็บ บี ซี ดี', r.got.data && JSON.stringify(r.got.data.removable.map(x => x.studentId)) === '["S01","S05"]' && r.got.data.amount === 11400);
    await step('🔴 ไม่ได้ยืนยัน → NEED_CONFIRM', 'undoBillRun', 'handleUndoBillRun', Object.assign({ runId: RUN }, ADM), A);
    r = await step('💰 ย้อนกลับรอบล่าสุด', 'undoBillRun', 'handleUndoBillRun', Object.assign({ runId: RUN, confirm: true }, ADM), A);
    ok_('💰 Postgres: เหลือ 6 ใบ · เอ/อี เดือน 11 หายไป · ใบเดือน 10 และใบที่มีเงินอยู่ครบ',
      JSON.stringify(await ids()) === JSON.stringify(['BL-2026-10-S01', 'BL-2026-11-S02', 'BL-2026-11-S03', 'BL-2026-11-S04', 'BL-2026-11-S06', 'BL-2026-11-S07']));

    console.log('\n3) 💰 ลบบิลทีละใบ');
    await step('🔴 บิลที่มีเงินยืนยันแล้ว → BILL_HAS_PAYMENT', 'deleteBill', 'handleDeleteBill', Object.assign({ billingId: 'BL-2026-11-S07' }, ADM), A);
    r = await step('💰 ลบบิลที่ออกมือ', 'deleteBill', 'handleDeleteBill', Object.assign({ billingId: 'BL-2026-11-S06' }, ADM), A);
    ok_('💰 Postgres: เหลือ 5 ใบ', (await ids()).length === 5 && (await ids()).indexOf('BL-2026-11-S06') < 0);

    console.log('\n4) แจ้งผู้ปกครอง');
    r = await step('แจ้งบิลเดือน 11 ของเอ บี', 'notifyBills', 'handleNotifyBills', Object.assign({ studentIds: ['S01', 'S02'], month: '2026-11' }, ADM), A);
    ok_('...จด LINE 2 ข้อความ (แม่เอ · พ่อเอ)', r.got.__line.length === 2 && r.got.data && r.got.data.notified === 1);
  } finally {
    ROUTES.setClock(null);
    const tabs = (await c.query("select table_name from information_schema.tables where table_schema='public' and table_name <> 'tenant'")).rows.map(r => r.table_name);
    for (const t of tabs) { try { await c.query('delete from ' + t + ' where tenant_id = $1', [TENANT]); } catch (e) {} }
    await c.query('delete from tenant where id = $1', [TENANT]);
    const left = (await c.query('select count(*)::int n from school_config where tenant_id = $1', [TENANT])).rows[0].n;
    console.log('\n🧹 ลบ tenant ทดสอบแล้ว (เหลือ ' + left + ' แถว)');
    await c.end();
  }
  console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('🔴 ' + (e && e.stack || e)); process.exit(1); });
