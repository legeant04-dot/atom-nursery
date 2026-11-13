/**
 * tools/test_fast_host_revoke.js — "ออกจากระบบทุกเครื่อง" holds on the fast host too
 *   node tools/test_fast_host_revoke.js          (offline — the database is a stub)
 *
 * 2026-11-13. Auth.gs refuses a token minted before its uid's entry in SCHOOL_CONFIG 'SessionEpochs';
 * server/host.js only checked the signature and the expiry. So a phone that was lost and revoked
 * kept working on the fast path — a gap ROLLOUT_PLAN lists as must-close before real data.
 *
 * Drives the REAL host `handle()`; only the database is replaced. Proves:
 *   1  a revoked token → NO_SESSION before any handler runs — no answer, no write, no extra query
 *   2  a token minted AFTER the epoch → served
 *   3  someone else's revocation does not touch you
 *   4  a corrupt cell → nobody is revoked (Auth.gs's rule — never sign the whole school out)
 *   5  the same parse as Auth.gs: run sessionEpochs_ / sessionEpochOf_ themselves on the same values
 */
'use strict';
const path = require('path');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const ROOT = path.join(__dirname, '..');
const SECRET = 'revoke-test-' + 'x'.repeat(24);
process.env.SESSION_SECRET = SECRET;
process.env.TENANT_ID = '00000000-0000-4000-8000-0000000000ab';

let epochCell = null, log = [], hydrations = 0;
const fakeClient = {
  query: async (sql, params) => {
    const s = String(sql); log.push(s.replace(/\s+/g, ' ').trim().slice(0, 80));
    if (/from school_config/.test(s) && params && params[1] === 'SessionEpochs') return { rows: epochCell == null ? [] : [{ value: epochCell }] };
    return { rows: [] };
  },
  end: async () => {}
};
const libPath = require.resolve(path.join(ROOT, 'tools', 'pg_lib.js'));
require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: { connect: async () => ({ client: fakeClient, scrub: s => s }) } };
const PG = require(path.join(ROOT, 'tools', 'pg_engine.js'));
PG.persist = async () => ({});
/* the host reads SessionEpochs from the SCHOOL_CONFIG rows hydrateConfig hands back (opts.rows) — one read */
let configReads = 0;
PG.hydrateConfig = async (c, t, opts) => { configReads++;
  if (opts && Array.isArray(opts.rows) && epochCell != null) opts.rows.push({ Key: 'SessionEpochs', Value: epochCell });
  return { Departments: ['Nursery 1'] }; };
PG.hydrateFast = async (client, tenant, keys) => {
  hydrations++; const M = {}; keys.forEach(k => { M[k] = []; });
  M.staff = [{ __id: 's1', StaffID: 'STF-002', NameTH: 'ครูทดสอบ', Role: 'Teacher', PositionLevel: 'Teacher', Department: 'Nursery 1', Classes: '*', Status: 'ACTIVE', StartDate: '2025-01-01' }];
  return { M, snapshot: {} };
};

const { handle } = require(path.join(ROOT, 'server', 'host.js'));
const { sign_, parseEpochs, epochOf } = require(path.join(ROOT, 'server', 'session.js'));
const NOW = Date.now();
const tokenFor = (uid, iat) => {
  const b = Buffer.from(JSON.stringify({ uid, role: 'Teacher', linkedId: 'STF-002', iat, exp: NOW + 3600e3 })).toString('base64');
  return b + '.' + sign_(b, SECRET);
};
async function call(token) {
  let out = ''; log = []; hydrations = 0; configReads = 0;
  const res = { setHeader() {}, writeHead() {}, end(s) { out = s; } };
  await handle({}, res, JSON.stringify({ token, action: 'staffSelf', payload: {} }));
  return JSON.parse(out);
}
const code = r => r && r.error && r.error.code;

(async () => {
  const OLD = tokenFor('U-T', NOW - 60e3), FRESH = tokenFor('U-T', NOW + 1);

  console.log('\n1) 🔴 token ที่ถูกเพิกถอน → NO_SESSION · ไม่อ่านอะไรต่อ');
  epochCell = JSON.stringify({ 'U-T': NOW });
  const r1 = await call(OLD);
  ok_('token เก่ากว่า epoch → NO_SESSION', code(r1) === 'NO_SESSION');
  ok_('...ข้อความเดียวกับ Apps Script', r1.error && r1.error.message === 'ต้องเข้าสู่ระบบใหม่ (เซสชันหมดอายุ)');
  ok_('...อ่านการตั้งค่าครั้งเดียว (ไม่มีคำสั่งอ่านแยกต่างหาก)', configReads === 1 && !log.some(q => /school_config/.test(q)));
  ok_('...ไม่มีคำตอบข้อมูลหลุดออกไป', r1.ok === false && r1.data === undefined);
  ok_('...ไม่มีคำสั่งเขียน', !log.some(s => /^(insert|update|delete|begin)/i.test(s)));

  console.log('\n2) token ที่ออกหลัง epoch → ใช้ได้');
  const r2 = await call(FRESH);
  ok_('iat ใหม่กว่า epoch → ตอบปกติ', r2.ok === true);

  console.log('\n3) การเพิกถอนของคนอื่นไม่กระทบ');
  epochCell = JSON.stringify({ 'U-OTHER': NOW });
  ok_('uid อื่นถูกเพิกถอน → token ของเรายังใช้ได้', (await call(OLD)).ok === true);
  epochCell = null;
  ok_('ไม่มีแถว SessionEpochs → ใช้ได้', (await call(OLD)).ok === true);

  console.log('\n4) 🔴 ค่าเสีย → ไม่มีใครถูกเพิกถอน (ไม่เด้งทั้งโรงเรียน)');
  for (const bad of ['{not json', '[1,2]', '"x"', '']) {
    epochCell = bad;
    ok_('SessionEpochs = ' + JSON.stringify(bad) + ' → ใช้ได้', (await call(OLD)).ok === true);
  }
  epochCell = JSON.stringify({ 'U-T': 'abc' });
  ok_('epoch ไม่ใช่ตัวเลข → ใช้ได้', (await call(OLD)).ok === true);

  console.log('\n5) อ่านแบบเดียวกับ Auth.gs (รันฟังก์ชันของ Apps Script ตัวจริง)');
  const H = require('./gas_test_harness.js')(['Config', 'Db', 'Auth']);
  const cases = ['', '{bad', '[1]', JSON.stringify({ 'U-T': NOW, 'U-X': 5 }), JSON.stringify({ 'U-T': 'abc' }), JSON.stringify({ 'U-T': -3 })];
  let same = 0;
  cases.forEach(raw => {
    H.g.getConfig_ = (k, d) => (k === 'SessionEpochs' ? raw : d);
    ['U-T', 'U-X', 'U-NONE'].forEach(uid => { if (H.g.sessionEpochOf_(uid) === epochOf(parseEpochs(raw), uid)) same++; });
  });
  ok_('sessionEpochOf_ (Auth.gs) = epochOf(parseEpochs) ทุกกรณี (' + same + '/' + cases.length * 3 + ')', same === cases.length * 3);

  console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\nFAILED ' + pass + ' passed, ' + (fail + 1) + ' failed\n'); process.exit(1); });
