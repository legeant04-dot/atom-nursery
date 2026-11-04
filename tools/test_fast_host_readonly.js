/**
 * tools/test_fast_host_readonly.js — the fast host answers reads and refuses EVERY write
 *   node tools/test_fast_host_readonly.js          (offline — the database is a stub)
 *
 * 2026-11-04, the first real Cloud Run deploy. Two things were found missing from the host's M — the
 * school's settings and the eleven keys GasEngine computes rather than reads — and both are now
 * built by lifting GasEngine's own code. But two of those computed keys are WRITTEN by the app
 * (staffAttendanceToday is a staff clock-in; payrollConfig is payroll settings) and the host has no
 * way to save them. Answering "ok" to a clock-in and then dropping it is the worst failure available,
 * so until writes are ported and tested the host is read-only BY CONSTRUCTION: it compares what the
 * handlers left behind with what it loaded and refuses the whole request on any difference.
 *
 * This drives the REAL server/host.js `handle()` — real engine, real pg_engine derivation — with only
 * the database replaced, and proves:
 *   · the teacher home's reads come back ok, with the derived keys present
 *   · a write to a collection (addAnnouncement) is refused, and nothing reaches the database
 *   · a write to a derived key (staffCheckout → staffAttendanceToday) is refused the same way
 *   · a batch with one write among reads is refused whole — nothing is half-saved
 */
'use strict';
const path = require('path'), crypto = require('crypto'), Module = require('module');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const ROOT = path.join(__dirname, '..');
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());   // the school's day, not UTC's
const SECRET = 'readonly-test-' + 'x'.repeat(24);
process.env.SESSION_SECRET = SECRET;
process.env.TENANT_ID = '00000000-0000-4000-8000-0000000000aa';

/* ── the database, replaced ─────────────────────────────────────────────────────────────────── */
const writes = [];                       // every statement that is not a select
const fakeClient = {
  query: async (sql) => {
    const s = String(sql);
    if (!/^\s*select/i.test(s)) writes.push(s.slice(0, 60));
    if (/from checkin_staff/.test(s)) return { rows: [{ date: TODAY, staff_id: 'STF-002', check_in: '08:01', check_out: '', late_minutes: 1, ot_hours: 0, status: 'IN', in_manual: '', out_manual: '' }] };
    return { rows: [] };
  },
  end: async () => {}
};
const libPath = require.resolve(path.join(ROOT, 'tools', 'pg_lib.js'));
require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: { connect: async () => ({ client: fakeClient, scrub: s => s }) } };

const PG = require(path.join(ROOT, 'tools', 'pg_engine.js'));
const persisted = [];
PG.persist = async (...a) => { persisted.push(a[4]); return {}; };
PG.hydrateConfig = async () => ({ Departments: ['Nursery 1'], DefaultCheckOutTime: '17:00', SchoolCheckInTime: '08:00', OTRatePerHour: 100,
  /* the suites' idiom for "this test is not about the fence" — a stub, not the school's radius */
  GPS_Lat: 0, GPS_Lng: 0, GPS_Radius: 1e7 });
PG.hydrateFast = async (client, tenant, keys) => {
  const M = {}; keys.forEach(k => { M[k] = []; });
  M.staff = [{ __id: 's1', StaffID: 'STF-002', NameTH: 'ครูทดสอบ', Role: 'Teacher', PositionLevel: 'Teacher', Department: 'Nursery 1', Classes: '*', Status: 'ACTIVE', StartDate: '2025-01-01' }];
  M.classes = [{ __id: 'c1', ClassID: 'C1', ClassName: 'Nursery 1' }];
  M.students = [{ __id: 'st1', StudentID: 'STD-001', NameTH: 'เด็กทดสอบ', Class: 'Nursery 1', Status: 'ACTIVE', ParentID: 'PAR-001' }];
  return { M, snapshot: {} };
};

const { handle } = require(path.join(ROOT, 'server', 'host.js'));

/* a token exactly as server/session.js verifies it */
const { sign_ } = require(path.join(ROOT, 'server', 'session.js'));
const body64 = Buffer.from(JSON.stringify({ uid: 'U-T', role: 'Teacher', linkedId: 'STF-002', iat: Date.now(), exp: Date.now() + 3600e3 })).toString('base64');
const TOKEN = body64 + '.' + sign_(body64, SECRET);

async function call(msg) {
  let out = '';
  const res = { setHeader() {}, writeHead() {}, end(s) { out = s; } };
  await handle({}, res, JSON.stringify(Object.assign({ token: TOKEN }, msg)));
  return JSON.parse(out);
}

(async () => {
  console.log('\n1) การอ่านตอบได้ — รวมคีย์ที่ GasEngine คำนวณ');
  const HOME = ['staffSelf', 'classList', 'myAttendanceToday', 'notifications', 'teacherClassAttendance'];
  const r1 = await call({ action: 'batch', payload: { calls: HOME.map(a => ({ action: a, payload: {} })) } });
  const bad = (r1.data || []).map((c, i) => c.ok ? null : HOME[i] + ': ' + (c.error && c.error.message)).filter(Boolean);
  ok_('หน้าหลักครู ' + HOME.length + ' call ตอบสำเร็จทั้งหมด' + (bad.length ? '  → ' + bad.join(' | ') : ''), r1.ok === true && bad.length === 0);
  const att = (r1.data || [])[2];
  ok_('myAttendanceToday อ่านการลงเวลาวันนี้จาก CHECKIN_STAFF (08:01)', !!(att && att.ok && JSON.stringify(att.data).indexOf('08:01') >= 0));
  ok_('การอ่านไม่เขียนอะไรลงฐานข้อมูล', writes.length === 0 && persisted.length === 0);

  console.log('\n2) 🔴 การเขียนถูกปฏิเสธ — ไม่มีอะไรถึงฐานข้อมูล');
  const r2 = await call({ action: 'addAnnouncement', payload: { title: 'ทดสอบ', content: 'x' } });
  ok_('addAnnouncement → READ_ONLY_HOST', r2.ok === false && r2.error && r2.error.code === 'READ_ONLY_HOST');
  ok_('...บอกว่าอะไรเปลี่ยน (announcements)', !!(r2.error && (r2.error.changed || []).indexOf('announcements') >= 0));
  const r3 = await call({ action: 'staffCheckout', payload: { lat: 0, lng: 0 } });
  ok_('🔴 staffCheckout (ลงเวลาออก = คีย์ที่คำนวณ) → READ_ONLY_HOST ไม่ใช่ "สำเร็จ" แล้วหาย',
    r3.ok === false && r3.error && r3.error.code === 'READ_ONLY_HOST' && (r3.error.changed || []).indexOf('staffAttendanceToday') >= 0);
  const r4 = await call({ action: 'batch', payload: { calls: [{ action: 'staffSelf', payload: {} }, { action: 'addAnnouncement', payload: { title: 'x', content: 'y' } }] } });
  ok_('batch ที่มีการเขียนปนอยู่ → ปฏิเสธทั้งก้อน', r4.ok === false && r4.error && r4.error.code === 'READ_ONLY_HOST');
  ok_('🔴 ไม่มีคำสั่งเขียนถึงฐานข้อมูลเลยตลอดชุดนี้', writes.length === 0 && persisted.length === 0);

  console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
