/**
 * tools/test_fast_host_audit.js — the PDPA audit trail on the fast host
 *   node tools/test_fast_host_audit.js          (offline — the database is a stub)
 *
 * 2026-11-13. ROLLOUT_PLAN listed "บันทึกตรวจสอบ PDPA (36 route)" as open on the host. Traced:
 *
 *   • a ported Code.gs route runs Apps Script's OWN function, so its logAudit/logAuditHr row is written
 *     by Audit.gs into audit_log/hr_audit_log in the same transaction (server/routes.js — every route
 *     that writes may append to both; proven by test_fast_route_writes_live "ทั้งสองบันทึกตรวจสอบ")
 *   • a route NOT ported is refused (NOT_ON_FAST_HOST) and Apps Script runs the whole request — and logs
 *   • engine handlers do not audit on either side
 *
 * What was missing is the dispatcher's own line: Code.gs dispatch_ and GasEngine handleBatch record
 * every call to a CLOSED route ('system', 'CLOSED_ROUTE_CALLED', 'API', action[+' (batch)']). The host
 * answered UNKNOWN_ACTION and recorded nothing — probing over the fast path left no trace. This proves
 *   1  a closed route called alone → UNKNOWN_ACTION, and one AUDIT_LOG row, Apps Script's exact words
 *   2  inside a batch → '<action> (batch)', once, while the other calls are still answered
 *   3  no session → refused first, nothing written (a stranger cannot fill the log)
 *   4  the audit failing never fails the request (Audit.gs: "Auditing must never break the primary request")
 *   5  the words are Apps Script's — read out of Code.gs and GasEngine.gs, not retyped
 *   6  every Code.gs route is either ported or refused — no third path where a route's audit could vanish
 */
'use strict';
const path = require('path'), fs = require('fs');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const ROOT = path.join(__dirname, '..');
const SECRET = 'audit-test-' + 'x'.repeat(24);
process.env.SESSION_SECRET = SECRET;
process.env.TENANT_ID = '00000000-0000-4000-8000-0000000000ad';

const libPath = require.resolve(path.join(ROOT, 'tools', 'pg_lib.js'));
require.cache[libPath] = { id: libPath, filename: libPath, loaded: true,
  exports: { connect: async () => ({ client: { query: async () => ({ rows: [] }), end: async () => {} }, scrub: s => s }) } };
const PG = require(path.join(ROOT, 'tools', 'pg_engine.js'));
let ops = [], bumps = [], opsFail = false;
PG.applySheetOps = async (c, tenant, list) => { if (opsFail) throw new Error('db down'); ops.push(...list.map(o => Object.assign({ tenant }, o))); return {}; };
PG.bumpCacheVersions = async (c, tenant, sheets) => { bumps.push(...sheets); return sheets; };
PG.persist = async () => ({});
PG.hydrateConfig = async () => ({ Departments: ['Nursery 1'] });
PG.hydrateFast = async (client, tenant, keys) => {
  const M = {}; keys.forEach(k => { M[k] = []; });
  M.staff = [{ __id: 's1', StaffID: 'STF-002', NameTH: 'ครูทดสอบ', Role: 'Teacher', PositionLevel: 'Teacher', Department: 'Nursery 1', Classes: '*', Status: 'ACTIVE', StartDate: '2025-01-01' },
             { __id: 's2', StaffID: 'STF-001', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Department: '', Classes: '*', Status: 'ACTIVE', StartDate: '2025-01-01' }];
  return { M, snapshot: {} };
};

const { handle } = require(path.join(ROOT, 'server', 'host.js'));
const { sign_ } = require(path.join(ROOT, 'server', 'session.js'));
const tokenFor = (uid, role, id) => { const b = Buffer.from(JSON.stringify({ uid, role, linkedId: id, iat: Date.now(), exp: Date.now() + 3600e3 })).toString('base64'); return b + '.' + sign_(b, SECRET); };
const TOKEN = tokenFor('U-T', 'Teacher', 'STF-002'), ADMIN = tokenFor('U-A', 'Admin', 'STF-001');
async function call(msg, token) {
  let out = ''; ops = []; bumps = [];
  const res = { setHeader() {}, writeHead() {}, end(s) { out = s; } };
  await handle({}, res, JSON.stringify(Object.assign({ token: token === undefined ? TOKEN : token }, msg)));
  return JSON.parse(out);
}
const code = r => r && r.error && r.error.code;
const audits = () => ops.filter(o => o.op === 'insert' && o.sheet === 'AUDIT_LOG').map(o => o.row);

(async () => {
  console.log('\n1) 🔴 เรียก route ที่ปิด → UNKNOWN_ACTION + บันทึกตรวจสอบ 1 แถว');
  const r1 = await call({ action: 'getConfig', payload: {} });
  const a1 = audits();
  ok_('ตอบ UNKNOWN_ACTION (เหมือน route ที่ไม่มีอยู่)', code(r1) === 'UNKNOWN_ACTION');
  ok_('บันทึก 1 แถว: system · CLOSED_ROUTE_CALLED · API · getConfig', a1.length === 1 &&
    a1[0].UserID === 'system' && a1[0].Action === 'CLOSED_ROUTE_CALLED' && a1[0].TableName === 'API' && a1[0].RecordID === 'getConfig' && a1[0].Timestamp instanceof Date);
  ok_('...ลงโรงเรียนที่ถูก + บอกแคชของ Apps Script ว่า AUDIT_LOG เปลี่ยน', ops[0] && ops[0].tenant === process.env.TENANT_ID && bumps.indexOf('AUDIT_LOG') >= 0);

  console.log('\n2) ใน batch → "<action> (batch)" ครั้งเดียว · call อื่นยังตอบ');
  const r2 = await call({ action: 'batch', payload: { calls: [{ action: 'getConfigVal', payload: { key: 'SlipOK_ApiKey' } }, { action: 'staffSelf', payload: {} }, { action: 'getConfigVal', payload: {} }] } });
  const a2 = audits();
  ok_('call ที่ปิด → UNKNOWN_ACTION · staffSelf ยังตอบ', code(r2.data && r2.data[0]) === 'UNKNOWN_ACTION' && r2.data[1].ok === true);
  ok_('บันทึก "getConfigVal (batch)" แถวเดียว (เรียกสองครั้งในคำขอเดียว)', a2.length === 1 && a2[0].RecordID === 'getConfigVal (batch)');
  await call({ action: 'batch', payload: { calls: [{ action: 'staffSelf', payload: {} }] } });
  ok_('batch ที่ไม่มี route ปิด → ไม่บันทึกอะไร', audits().length === 0);

  console.log('\n3) ไม่มี session → ปฏิเสธก่อน ไม่บันทึก');
  const r3 = await call({ action: 'getConfig', payload: {} }, '');
  ok_('NO_SESSION และไม่มีแถว — คนนอกเขียนบันทึกท่วมไม่ได้', code(r3) === 'NO_SESSION' && audits().length === 0);

  console.log('\n4) บันทึกล้ม → คำขอไม่ล้ม');
  opsFail = true;
  const r4 = await call({ action: 'getConfig', payload: {} });
  opsFail = false;
  ok_('ฐานข้อมูลเขียนบันทึกไม่ได้ → ยังตอบ UNKNOWN_ACTION ตามปกติ', code(r4) === 'UNKNOWN_ACTION');

  console.log('\n5) ถ้อยคำเดียวกับ Apps Script (อ่านจากโค้ดจริง)');
  const code_gs = fs.readFileSync(path.join(ROOT, 'src', 'Code.gs'), 'utf8');
  const engine_gs = fs.readFileSync(path.join(ROOT, 'src', 'GasEngine.gs'), 'utf8');
  ok_("Code.gs dispatch_: logAudit('system', 'CLOSED_ROUTE_CALLED', 'API', action)", /logAudit\('system', 'CLOSED_ROUTE_CALLED', 'API', action\)/.test(code_gs));
  ok_("GasEngine handleBatch: ... String(c.action) + ' (batch)'", /logAudit\('system', 'CLOSED_ROUTE_CALLED', 'API', String\(c\.action\) \+ ' \(batch\)'\)/.test(engine_gs));

  console.log('\n6) 🔴 ทุก route ของ Code.gs: ย้ายมาแล้ว หรือถูกส่งกลับ Apps Script — ไม่มีทางที่สาม');
  const GATE = require(path.join(ROOT, 'server', 'gate.js'));
  const ROUTES_PORT = require(path.join(ROOT, 'server', 'routes.js'));
  const H = require('./gas_test_harness.js')(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code']);
  const gasRoutes = Object.keys(H.run(function () { return ROUTES; }));
  const answered = [];
  for (const a of gasRoutes) {
    if (a === 'batch' || GATE.isClosed(a) || ROUTES_PORT.has(a)) continue;
    const r = await call({ action: a, payload: {} }, ADMIN);   // admin: past ADMIN_ONLY, so the door itself answers
    if (code(r) !== 'NOT_ON_FAST_HOST') answered.push(a + '→' + (code(r) || 'ok'));
  }
  ok_(gasRoutes.length + ' route · ที่ยังไม่ย้ายตอบ NOT_ON_FAST_HOST ทั้งหมด' + (answered.length ? '  → ' + answered.slice(0, 8).join(' ') : ''), answered.length === 0);

  console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\nFAILED ' + pass + ' passed, ' + (fail + 1) + ' failed\n'); process.exit(1); });
