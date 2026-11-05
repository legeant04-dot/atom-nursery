/**
 * tools/test_cache_versions.js — Apps Script's row cache cannot outlive a write by the Cloud Run host
 *   node tools/test_cache_versions.js          (offline — the GAS harness, its fake Jdbc, an in-memory CacheService)
 *
 * 2026-11-05. GasEngine caches rows in CacheService for CacheTTL (900s) — 'col:<SHEET>', 'rows:<SHEET>',
 * 'jrn:<date>'. The host writes the same Postgres and cannot reach that cache, so without this the
 * admin confirms a payment on the host and the parent's screen, still answered by Apps Script, shows
 * the bill unpaid for fifteen minutes. The fix (src/DbPg.gs CACHE VERSIONS): every writer bumps the
 * sheet's version in Postgres; while Postgres is the backend the cache keys carry it.
 *
 *   1  switch off (the live script): keys unchanged, no Jdbc touched
 *   2  🔴 THE BUG, SHOWN: a write the cache does not hear about → the old answer, from the cache
 *   3  the fix: the same write + a version bump (what server/host.js does) → the new answer
 *   4  the versions are read BEFORE any table — a fresh key can never be filled with older rows
 *   5  Apps Script's own write bumps the version ONCE per table, inside the shared lock; outside a lock, at once
 *   6  versions unreadable → the row cache is not used at all (never a stale answer)
 *   7  server/host.js bumps in the same transaction as the write, for every kind of write it makes
 * On a real Postgres: tools/test_fast_host_writes_live.js (the host's bumps) and test_fast_routes_live.js.
 */
'use strict';
const path = require('path'), fs = require('fs');
let pass = 0, fail = 0;
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  console.log((okk ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (okk ? '' : ' want=' + JSON.stringify(want)));
  okk ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const FILES = ['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin', 'Triggers', 'Leave',
  'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup', 'PaySlips', 'PayAdjust', 'Password', 'Certificate', 'Dspm',
  'BillRun', 'GasEngine', 'Engine', 'Day6'];

function memCache() {
  const m = {};
  const c = { get: k => (k in m ? m[k] : null), put: (k, v) => { m[k] = String(v); }, remove: k => { delete m[k]; },
    removeAll: ks => ks.forEach(k => delete m[k]), getAll: ks => { const o = {}; ks.forEach(k => { if (k in m) o[k] = m[k]; }); return o; } };
  return { store: m, svc: { getScriptCache: () => c } };
}
function boot(pg) {
  if (pg) process.env.ATOM_DB = 'pg'; else delete process.env.ATOM_DB;
  delete require.cache[require.resolve('./gas_test_harness.js')];
  const H = require('./gas_test_harness.js')(FILES);
  H.run(function () {
    _configCache = null; setupAll(); _configCache = null;
    var ss = getMainSpreadsheet_();
    appendObject_(sheet_(ss, 'STUDENTS'), { StudentID: 'STD-9', Name: 'เด็กทดสอบ', Status: 'ACTIVE' });
    appendObject_(sheet_(ss, 'STUDENT_CHARGES'), { ChargeID: 'CH-1', StudentID: 'STD-9', Month: '2026-11', Label: 'ค่าชุด', Amount: 350, Status: 'OPEN' });
    return '';
  });
  const C = memCache(); H.g.CacheService = C.svc;
  if (H.pgFake) H.pgFake.versions = {};
  if (H.pgLog) H.pgLog.length = 0;
  return { H, C };
}
const amounts = H => JSON.parse(H.run(function () {
  return JSON.stringify(JSON.parse(dispatch_('studentCharges', { studentId: 'STD-9' }, null).getContent()).data.map(function (c) { return Number(c.Amount); }));
}));
/* what the HOST does to Postgres: change the row directly, behind Apps Script's back */
const hostEdits = (H, amount) => {
  const ss = H.store[H.props[H.g.PROP.MAIN_ID]], sh = ss.getSheetByName('STUDENT_CHARGES');
  const col = sh.data[0].indexOf('Amount'); sh.data[1][col] = amount;
};

console.log('\n1) สวิตช์ปิด (ระบบจริงวันนี้) — คีย์แคชเหมือนเดิม ไม่แตะ Jdbc');
{
  const { H } = boot(false);
  let touched = 0; H.g.Jdbc = { getConnection: () => { touched++; throw new Error('must not connect'); } };
  eq('col:BILLING ยังเป็น col:BILLING', H.run(function () { return cacheKeyFor_('col:BILLING'); }), 'col:BILLING');
  eq('cfg ยังเป็น cfg', H.run(function () { return cacheKeyFor_('cfg'); }), 'cfg');
  amounts(H);
  eq('ไม่มีการเชื่อม Postgres', touched, 0);
}

console.log('\n2) 🔴 ปัญหา (ตั้งใจทำให้เห็น): โฮสต์เขียน แต่เวอร์ชันไม่ขยับ → Apps Script ตอบจากแคชเก่า');
{
  const { H } = boot(true);
  eq('อ่านครั้งแรก', amounts(H), [350]);
  hostEdits(H, 999);
  eq('🔴 โฮสต์แก้เป็น 999 แต่ไม่บอกใคร → ยังได้ 350 (แคชจริง ไม่ใช่ชุดทดสอบเปล่า)', amounts(H), [350]);
}

console.log('\n3) ตัวแก้: โฮสต์เขียน + ขยับเวอร์ชัน (สิ่งที่ server/host.js ทำ) → ได้ค่าใหม่ทันที');
{
  const { H } = boot(true);
  eq('อ่านครั้งแรก', amounts(H), [350]);
  hostEdits(H, 999); H.pgFake.versions.STUDENT_CHARGES = (H.pgFake.versions.STUDENT_CHARGES || 0) + 1;
  eq('✅ ได้ 999', amounts(H), [999]);
  eq('ครั้งถัดไปยังได้ 999 (จากแคชของเวอร์ชันใหม่)', amounts(H), [999]);
  const keys = Object.keys(boot(true).C.store);
  ok_('คีย์ในแคชมีเวอร์ชันติดอยู่', (() => { const t = boot(true); amounts(t.H); return Object.keys(t.C.store).some(k => /^col:STUDENT_CHARGES@0$/.test(k)); })() && keys.length === 0);
}

console.log('\n4) อ่านเวอร์ชันก่อนตารางแรก — คีย์ใหม่จึงไม่มีทางถูกเติมด้วยแถวที่เก่ากว่า');
{
  const { H } = boot(true);
  amounts(H);
  const sqls = H.pgLog.map(x => x.sql);
  const iVer = sqls.findIndex(s => /from "cache_version"/.test(s));
  const iTab = sqls.findIndex(s => /^select "id"::text,/.test(s));
  ok_('อ่าน cache_version (' + iVer + ') ก่อนอ่านตารางแรก (' + iTab + ')', iVer >= 0 && (iTab < 0 || iVer < iTab));
}

console.log('\n5) การเขียนของ Apps Script เอง');
{
  const { H } = boot(true);
  const r = JSON.parse(H.run(function () {
    return dispatch_('addStudentCharge', { studentId: 'STD-9', label: 'ค่ากิจกรรม', amount: 200 }, null).getContent();
  }));
  ok_('เขียนสำเร็จ', r.ok === true);
  eq('STUDENT_CHARGES ขยับครั้งเดียว (แม้มีหลายคำสั่งเขียน)', H.pgFake.versions.STUDENT_CHARGES, 1);
  const sqls = H.pgLog.map(x => x.sql);
  const iBump = sqls.findIndex(s => /^insert into "cache_version"/.test(s));
  const iUnlock = sqls.findIndex(s => /pg_advisory_unlock/.test(s));
  const lastWrite = sqls.map((s, i) => /^(insert into "(?!cache_version)|update |delete )/.test(s) ? i : -1).filter(i => i >= 0).pop();
  ok_('🔴 ขยับหลังคำสั่งเขียนสุดท้าย (' + lastWrite + ') และก่อนปลดล็อก (' + iUnlock + ')', iBump > lastWrite && iBump < iUnlock);
  eq('ผลที่หน้าจอเห็นถัดไปถูกต้อง', amounts(H).sort((a, b) => a - b), [200, 350]);
}
{
  const { H } = boot(true);
  H.run(function () { appendObject_(sheet_(getMainSpreadsheet_(), 'STUDENT_CHARGES'), { ChargeID: 'CH-X', StudentID: 'STD-9', Month: '2026-11', Label: 'นอกล็อก', Amount: 1 }); return ''; });
  eq('เขียนนอกล็อก (เช่น trigger) → ขยับทันที', H.pgFake.versions.STUDENT_CHARGES, 1);
}

console.log('\n6) อ่านเวอร์ชันไม่ได้ → ไม่ใช้แคชแถวเลย (ไม่มีวันได้ของเก่า)');
{
  const { H, C } = boot(true);
  H.pgFake.versionsFail = true;
  eq('ยังตอบได้', amounts(H), [350]);
  hostEdits(H, 777);
  eq('การแก้ของโฮสต์เห็นทันที', amounts(H), [777]);
  ok_('ไม่มีแถวใดถูกเก็บในแคช', !Object.keys(C.store).some(k => /^(col|rows|jrn):/.test(k)));
}
delete process.env.ATOM_DB;

console.log('\n7) server/host.js ขยับเวอร์ชันในธุรกรรมเดียวกับการเขียน');
{
  const host = fs.readFileSync(path.join(__dirname, '..', 'server', 'host.js'), 'utf8');
  ok_('🔴 ขยับก่อน commit ของการเขียน', /PG\.persist\(client, tenant, M, snapshot, changed\)[\s\S]*bumpCacheVersions\([\s\S]*await client\.query\('commit'\);\s*t\.save/.test(host));
  ok_('ครบทุกแบบการเขียน: collection · คีย์ที่คำนวณ · route', /changed\.map\(k => PG\.COLLECTIONS\[k\]\.sheet\)[\s\S]{0,80}otherChanged\.map\(k => DERIVED_SHEETS\[k\]\)[\s\S]{0,60}routeWrites\.map\(w => w\.sheet\)/.test(host));
  const dw = [...(/const DERIVED_WRITERS = \{([^}]*)\}/.exec(host) || [])[1].matchAll(/(\w+):/g)].map(m => m[1]);
  const ds = [...(/const DERIVED_SHEETS = \{([^}]*)\}/.exec(host) || [])[1].matchAll(/(\w+):/g)].map(m => m[1]);
  eq('🔴 คีย์ที่คำนวณทุกตัวที่เขียนได้ รู้ว่าลงชีตไหน', dw.filter(k => ds.indexOf(k) < 0), []);
  const gas = fs.readFileSync(path.join(__dirname, '..', 'src', 'GasEngine.gs'), 'utf8');
  eq('cacheGet_ · cachePut_ · cacheDel_ ผ่าน cacheKeyFor_ ทั้งสามตัว', (gas.match(/k = cacheKeyFor_\(k\); if \(!k\) return/g) || []).length, 3);
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
