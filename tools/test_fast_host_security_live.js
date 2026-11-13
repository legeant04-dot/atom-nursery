/**
 * tools/test_fast_host_security_live.js — revocation and the closed-route audit, on real Postgres
 *   node tools/test_fast_host_security_live.js          (needs secrets/supabase.env — fabricated data only)
 *
 * 2026-11-13. test_fast_host_revoke and test_fast_host_audit prove the logic against a stub; this runs
 * the real server/host.js handle() against staging, so the SQL itself is proven too:
 *   · SessionEpochs in school_config revokes a token minted before it — and only that uid's
 *   · a closed route called through the host lands in audit_log with Apps Script's exact words,
 *     and AUDIT_LOG's cache version moves (so Apps Script's row cache cannot hide it)
 * 🔴 Fabricated data only, in a p23- tenant deleted at the end.
 */
'use strict';
const path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok_ = (label, cond, extra) => { console.log((cond ? '  ok   ' : '  FAIL ') + label + (cond || extra === undefined ? '' : '  ' + JSON.stringify(extra))); cond ? pass++ : fail++; };

const TENANT = crypto.randomUUID();
const SECRET = 'sec-live-' + crypto.randomBytes(12).toString('hex');
process.env.SESSION_SECRET = SECRET;
process.env.TENANT_ID = TENANT;

const { connect } = require(path.join(ROOT, 'tools', 'pg_lib.js'));
const PG = require(path.join(ROOT, 'tools', 'pg_engine.js'));
const { handle } = require(path.join(ROOT, 'server', 'host.js'));
const { sign_ } = require(path.join(ROOT, 'server', 'session.js'));
const ALL = Object.keys(PG.COLLECTIONS);

const now = Date.now();
const tokenFor = (uid, iat) => {
  const b = Buffer.from(JSON.stringify({ uid, role: 'Teacher', linkedId: 'STF-T', iat, exp: now + 3600e3 })).toString('base64');
  return b + '.' + sign_(b, SECRET);
};
async function viaHost(msg, token) {
  let out = '';
  const res = { setHeader() {}, writeHead() {}, end(s) { out = s; } };
  await handle({}, res, JSON.stringify(Object.assign({ token }, msg)));
  return JSON.parse(out);
}
const code = r => r && r.error && r.error.code;

(async () => {
  const { client: c } = await connect();
  try {
    await c.query("insert into tenant (id, code, name_th) values ($1, $2, 'ทดสอบความปลอดภัยโฮสต์ (ข้อมูลปลอม)')", [TENANT, 'p23-' + TENANT.slice(0, 8)]);
    for (const [k, v] of [['Departments', 'Nursery 1'], ['Timezone', 'Asia/Bangkok'],
                          ['SessionEpochs', JSON.stringify({ 'U-LOST': now - 1000 })]])
      await c.query('insert into school_config (tenant_id, "key", "value") values ($1, $2, $3)', [TENANT, k, v]);
    const M = {}; ALL.forEach(k => { M[k] = []; });
    M.classes = [{ ClassID: 'C1', ClassName: 'Nursery 1' }];
    M.staff = [{ StaffID: 'STF-T', NameTH: 'ครูทดสอบ', Nickname: 'ครูที', Role: 'Teacher', PositionLevel: 'Teacher', Department: 'Nursery 1', Classes: '*', Status: 'ACTIVE', StartDate: '2025-01-01' }];
    await PG.persist(c, TENANT, M, {}, ALL);

    console.log('\n1) "ออกจากระบบทุกเครื่อง" บนฐานข้อมูลจริง');
    const lost = await viaHost({ action: 'staffSelf', payload: {} }, tokenFor('U-LOST', now - 60e3));
    ok_('token ของเครื่องที่ถูกเพิกถอน → NO_SESSION', code(lost) === 'NO_SESSION', lost);
    const again = await viaHost({ action: 'staffSelf', payload: {} }, tokenFor('U-LOST', now));
    ok_('ล็อกอินใหม่หลังเพิกถอน → ใช้ได้', again.ok === true, again);
    const other = await viaHost({ action: 'staffSelf', payload: {} }, tokenFor('U-OTHER', now - 60e3));
    ok_('คนอื่นไม่โดน', other.ok === true, other);

    console.log('\n2) route ที่ปิด → audit_log จริง');
    const verBefore = (await c.query("select coalesce(max(ver),0)::int v from cache_version where tenant_id = $1 and sheet = 'AUDIT_LOG'", [TENANT])).rows[0].v;
    const r1 = await viaHost({ action: 'getConfig', payload: {} }, tokenFor('U-OTHER', now));
    const r2 = await viaHost({ action: 'batch', payload: { calls: [{ action: 'getConfigVal', payload: { key: 'SlipOK_ApiKey' } }, { action: 'staffSelf', payload: {} }] } }, tokenFor('U-OTHER', now));
    ok_('ตอบ UNKNOWN_ACTION ทั้งเดี่ยวและใน batch · call ข้าง ๆ ยังตอบ', code(r1) === 'UNKNOWN_ACTION' && code(r2.data[0]) === 'UNKNOWN_ACTION' && r2.data[1].ok === true);
    const rows = (await c.query('select user_id, action, table_name, record_id, "timestamp" from audit_log where tenant_id = $1 order by seq', [TENANT])).rows;
    ok_('2 แถว: getConfig · getConfigVal (batch)', rows.length === 2 && rows[0].record_id === 'getConfig' && rows[1].record_id === 'getConfigVal (batch)', rows);
    ok_('ถ้อยคำของ Apps Script: system · CLOSED_ROUTE_CALLED · API · มีเวลา', rows.every(r => r.user_id === 'system' && r.action === 'CLOSED_ROUTE_CALLED' && r.table_name === 'API' && r.timestamp));
    const verAfter = (await c.query("select coalesce(max(ver),0)::int v from cache_version where tenant_id = $1 and sheet = 'AUDIT_LOG'", [TENANT])).rows[0].v;
    ok_('เวอร์ชันแคชของ AUDIT_LOG ขยับ (' + verBefore + ' → ' + verAfter + ')', verAfter >= verBefore + 2);
  } finally {
    const tabs = (await c.query("select table_name from information_schema.tables where table_schema='public' and table_name <> 'tenant'")).rows.map(r => r.table_name);
    for (const t of tabs) { try { await c.query('delete from ' + t + ' where tenant_id = $1', [TENANT]); } catch (e) {} }
    await c.query('delete from tenant where id = $1', [TENANT]);
    console.log('\n🧹 ลบ tenant ทดสอบแล้ว');
    await c.end();
  }
  console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('🔴 ' + (e && e.stack || e)); process.exit(1); });
