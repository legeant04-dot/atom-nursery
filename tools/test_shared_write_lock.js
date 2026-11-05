/**
 * tools/test_shared_write_lock.js — Apps Script and the Cloud Run host take ONE write lock
 *   node tools/test_shared_write_lock.js          (offline — the harness's fake Jdbc)
 *
 * 2026-11-05. After the switch-over two programs write the same Postgres: Apps Script (through
 * src/DbPg.gs) and server/host.js. LockService only serialises Apps Script against itself, and the
 * host serialises with an advisory lock. Different locks over one database is the 2026-07-09 wipe
 * (one writer reads a table, the other commits, the first writes back by position). So:
 *
 *   1  switch OFF (the live script): a write touches no Jdbc at all — nothing changes today
 *   2  switch ON: a write takes pg_advisory_lock BEFORE its first write statement and releases it after
 *      the last; a read takes no lock (reads never queued on GAS either)
 *   3  the lock cannot be had (the host is writing): a single write is BUSY and NOTHING is written;
 *      in a batch only the write is refused, the read beside it still answers (GAS's onBusy rule)
 *   4  it is the SAME key the host uses: hashtextextended(<tenant uuid>, 0)
 * That the session-level lock here and the transaction-level lock there really exclude each other on
 * a real Postgres is proven against staging in test_fast_host_writes_live.js.
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

/* the scenario, run inside the GAS sandbox: an admin adds a charge (a write) and reads a list (a read) */
const SETUP = function () {
  _configCache = null; setupAll(); _configCache = null;
  appendObject_(sheet_(getMainSpreadsheet_(), 'STUDENTS'), { StudentID: 'STD-9', Name: 'เด็กทดสอบ', Status: 'ACTIVE' });
  return '';
};
/* the fixture above writes too — the log is emptied after it, so only the scenario's statements count */
const runScenario = H => { H.run(SETUP); if (H.pgLog) H.pgLog.length = 0; return JSON.parse(H.run(SCENARIO)); };
const SCENARIO = function () {
  function call(a, p) { return JSON.parse(dispatch_(a, p, null).getContent()); }
  var out = {};
  out.write = call('addStudentCharge', { studentId: 'STD-9', label: 'ค่าชุด', amount: 350 });
  out.read = call('studentCharges', { studentId: 'STD-9' });
  return JSON.stringify(out);
};
const isWrite = s => /^(insert|update|delete) /.test(s);

console.log('\n1) สวิตช์ปิด (ระบบจริงวันนี้) — การเขียนไม่แตะ Jdbc เลย');
{
  delete process.env.ATOM_DB;
  const H = require('./gas_test_harness.js')(FILES);
  let touched = 0; H.g.Jdbc = { getConnection: () => { touched++; throw new Error('must not connect'); } };
  const r = runScenario(H);
  ok_('เขียนสำเร็จบนชีตตามเดิม', r.write.ok === true);
  eq('ไม่มีการเชื่อม Postgres', touched, 0);
}

console.log('\n2) สวิตช์เปิด — ล็อกครอบการเขียน · การอ่านไม่ล็อก');
{
  process.env.ATOM_DB = 'pg';
  delete require.cache[require.resolve('./gas_test_harness.js')];
  const H = require('./gas_test_harness.js')(FILES);
  const r = runScenario(H);
  const sqls = H.pgLog.map(x => x.sql);
  const iLock = sqls.findIndex(s => /^select pg_advisory_lock\(/.test(s));
  const iUnlock = sqls.findIndex(s => /^select pg_advisory_unlock\(/.test(s));
  const writes = sqls.map((s, i) => isWrite(s) ? i : -1).filter(i => i >= 0);
  ok_('เขียนสำเร็จผ่าน Postgres', r.write.ok === true && writes.length > 0);
  ok_('🔴 ล็อกก่อนคำสั่งเขียนแรก · ปลดหลังคำสั่งเขียนสุดท้าย', iLock >= 0 && iLock < writes[0] && iUnlock > writes[writes.length - 1]);
  ok_('รอได้ 25 วินาที (เท่า tryLock)', sqls.slice(0, iLock).some(s => /lock_timeout = '25s'/.test(s)));
  eq('ล็อกด้วย tenant ของโรงเรียน', (H.pgLog[iLock] || {}).params, ['00000000-0000-4000-8000-000000000001']);
  eq('ล็อกครั้งเดียว ปลดครั้งเดียว (การอ่านไม่ล็อก)', [sqls.filter(s => /pg_advisory_lock\(/.test(s)).length, sqls.filter(s => /pg_advisory_unlock\(/.test(s)).length], [1, 1]);
  ok_('การอ่านตอบปกติ', r.read.ok === true);
}

console.log('\n3) ล็อกไม่ว่าง (โฮสต์กำลังเขียน) → BUSY และไม่มีอะไรถูกเขียน');
{
  delete require.cache[require.resolve('./gas_test_harness.js')];
  const H = require('./gas_test_harness.js')(FILES);
  H.pgFake.lockFails = true;
  const r = runScenario(H);
  const sqls = H.pgLog.map(x => x.sql);
  eq('การเขียนเดี่ยว → BUSY', r.write.error && r.write.error.code, 'BUSY');
  eq('🔴 ไม่มีคำสั่งเขียนเลย', sqls.filter(isWrite).length, 0);
  ok_('การอ่านยังตอบได้', r.read.ok === true);
  const b = JSON.parse(H.run(function () {
    return dispatch_('batch', { calls: [{ action: 'addStudentCharge', payload: { studentId: 'STD-9', label: 'x', amount: 1 } },
      { action: 'studentCharges', payload: { studentId: 'STD-9' } }] }, null).getContent();
  }));
  eq('batch: การเขียน BUSY · การอ่านข้าง ๆ ตอบ', (b.data || []).map(x => x.ok ? 'OK' : x.error.code), ['BUSY', 'OK']);
  eq('...และยังไม่มีคำสั่งเขียน', H.pgLog.map(x => x.sql).filter(isWrite).length, 0);
  delete process.env.ATOM_DB;
}

console.log('\n4) กุญแจเดียวกับโฮสต์');
{
  const db = fs.readFileSync(path.join(__dirname, '..', 'src', 'DbPg.gs'), 'utf8');
  const host = fs.readFileSync(path.join(__dirname, '..', 'server', 'host.js'), 'utf8');
  ok_('Apps Script: pg_advisory_lock(hashtextextended(<tenant>, 0))', /pg_advisory_lock\(hashtextextended\(\?, 0\)\)'\);[\s\S]{0,300}setString\(1, PG_\.tenant\)/.test(db));
  ok_('Cloud Run:   pg_advisory_xact_lock(hashtextextended(<tenant>, 0))', /pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)', \[tenant\]/.test(host));
  ok_('withWriteLock_ ส่งทุกการเขียนผ่าน pgWriteLock_', /pgWriteLock_\(fn, onBusy\)/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'Code.gs'), 'utf8')));
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
