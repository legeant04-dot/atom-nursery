/**
 * tools/test_fast_host_readonly.js — the fast host's door, and the only writes it may save
 *   node tools/test_fast_host_readonly.js          (offline — the database is a stub)
 *
 * 2026-11-04. Drives the REAL server/host.js `handle()` — real engine, real Code.gs gate
 * (server/gate.js), real pg_engine derivation — with only the database replaced, and proves:
 *
 *   1  reads answer, with the keys GasEngine computes
 *   2  the gate is Code.gs's: ADMIN_ONLY, a parent's own child only, CLOSED inside a batch,
 *      Observer read-only, and a Code.gs ROUTE answered NOT_ON_FAST_HOST rather than by the engine
 *   3  a write that is not in server/write_proven.js is refused and nothing is saved
 *   4  a proven write is saved — under the school's lock, in one transaction, after a second
 *      hydration made AFTER the lock was taken, and only the collection it declared
 *   5  the lock not being available is BUSY, not a write without it
 *
 * (The name is historical: until writes were ported this proved the host saved nothing at all.)
 */
'use strict';
const path = require('path');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const ROOT = path.join(__dirname, '..');
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());   // the school's day, not UTC's
const SECRET = 'readonly-test-' + 'x'.repeat(24);
process.env.SESSION_SECRET = SECRET;
process.env.TENANT_ID = '00000000-0000-4000-8000-0000000000aa';

/* ── the database, replaced ─────────────────────────────────────────────────────────────────── */
let log = [];                            // every statement, in order
let lockFails = false;
const fakeClient = {
  query: async (sql) => {
    const s = String(sql);
    log.push(s.replace(/\s+/g, ' ').trim().slice(0, 70));
    if (/pg_advisory_xact_lock/.test(s) && lockFails) throw new Error('canceling statement due to lock timeout');
    if (/from checkin_staff/.test(s)) return { rows: [{ date: TODAY, staff_id: 'STF-002', check_in: '08:01', check_out: '', late_minutes: 1, ot_hours: 0, status: 'IN', in_manual: '', out_manual: '' }] };
    return { rows: [] };
  },
  end: async () => {}
};
const writesIn = () => log.filter(s => /^(insert|update|delete)\b/i.test(s));
const libPath = require.resolve(path.join(ROOT, 'tools', 'pg_lib.js'));
require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: { connect: async () => ({ client: fakeClient, scrub: s => s }) } };

const PG = require(path.join(ROOT, 'tools', 'pg_engine.js'));
let persisted = [], hydrations = 0;
PG.persist = async (client, tenant, M, snap, keys) => { persisted.push(keys); return { inserted: 1 }; };
PG.hydrateConfig = async () => ({ Departments: ['Nursery 1'], DefaultCheckOutTime: '17:00', SchoolCheckInTime: '08:00', OTRatePerHour: 100,
  /* the suites' idiom for "this test is not about the fence" — a stub, not the school's radius */
  GPS_Lat: 0, GPS_Lng: 0, GPS_Radius: 1e7 });
PG.hydrateFast = async (client, tenant, keys) => {
  hydrations++; log.push('HYDRATE');
  const M = {}; keys.forEach(k => { M[k] = []; });
  M.staff = [{ __id: 's1', StaffID: 'STF-002', NameTH: 'ครูทดสอบ', Role: 'Teacher', PositionLevel: 'Teacher', Department: 'Nursery 1', Classes: '*', Status: 'ACTIVE', StartDate: '2025-01-01' },
             { __id: 's2', StaffID: 'STF-001', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Department: '', Classes: '*', Status: 'ACTIVE', StartDate: '2025-01-01' }];
  M.classes = [{ __id: 'c1', ClassID: 'C1', ClassName: 'Nursery 1' }];
  M.students = [{ __id: 'st1', StudentID: 'STD-001', NameTH: 'เด็กทดสอบ', Class: 'Nursery 1', Status: 'ACTIVE', ParentID: 'PAR-001' },
                { __id: 'st2', StudentID: 'STD-002', NameTH: 'เด็กอีกคน', Class: 'Nursery 1', Status: 'ACTIVE', ParentID: 'PAR-002' }];
  M.parents = [{ __id: 'p1', ParentID: 'PAR-001', NameTH: 'ผู้ปกครอง', StudentID: 'STD-001', LineUID: 'U-P' }];
  M.userLinks = [{ __id: 'l1', UserUID: 'U-P', StudentID: 'STD-001' }];
  return { M, snapshot: {} };
};

const { handle } = require(path.join(ROOT, 'server', 'host.js'));
const { WRITE_PROVEN } = require(path.join(ROOT, 'server', 'write_proven.js'));
const { sign_ } = require(path.join(ROOT, 'server', 'session.js'));
const tokenFor = (role, linkedId, uid) => {
  const b = Buffer.from(JSON.stringify({ uid, role, linkedId, iat: Date.now(), exp: Date.now() + 3600e3 })).toString('base64');
  return b + '.' + sign_(b, SECRET);
};
const TEACHER = tokenFor('Teacher', 'STF-002', 'U-T'), PARENT = tokenFor('Parent', 'PAR-001', 'U-P'),
      OBSERVER = tokenFor('Observer', 'STF-009', 'U-O');

async function call(msg, token) {
  let out = '';
  const res = { setHeader() {}, writeHead() {}, end(s) { out = s; } };
  await handle({}, res, JSON.stringify(Object.assign({ token: token || TEACHER }, msg)));
  return JSON.parse(out);
}
const code = r => r && r.error && r.error.code;
const reset = () => { log = []; persisted = []; hydrations = 0; };

(async () => {
  console.log('\n1) การอ่านตอบได้ — รวมคีย์ที่ GasEngine คำนวณ');
  const HOME = ['staffSelf', 'classList', 'myAttendanceToday', 'teacherClassAttendance'];
  const r1 = await call({ action: 'batch', payload: { calls: HOME.map(a => ({ action: a, payload: {} })) } });
  const bad = (r1.data || []).map((c, i) => c.ok ? null : HOME[i] + ': ' + (c.error && c.error.message)).filter(Boolean);
  ok_('หน้าหลักครู ' + HOME.length + ' call (ที่ของจริงรันผ่าน engine) ตอบสำเร็จ' + (bad.length ? '  → ' + bad.join(' | ') : ''), r1.ok === true && bad.length === 0);
  ok_('myAttendanceToday อ่านการลงเวลาวันนี้จาก CHECKIN_STAFF (08:01)', !!(r1.data && r1.data[2].ok && JSON.stringify(r1.data[2].data).indexOf('08:01') >= 0));
  ok_('การอ่าน: ไม่มีคำสั่งเขียน ไม่มีล็อก ไม่มีธุรกรรม', writesIn().length === 0 && persisted.length === 0 && !log.some(s => /advisory|^begin/.test(s)));

  console.log('\n2) 🔒 ด่านเดียวกับ Code.gs');
  reset();
  /* notifications used to be the example here; since 2026-11-05 it is PORTED (server/routes.js — Apps
   * Script's own handleNotifications, tests/test_fast_routes*.js). dspmCriteria is a route that is not (pendingLeaves was, until it too was ported). */
  const n1 = await call({ action: 'dspmCriteria', payload: {} });
  ok_('🔴 dspmCriteria (route ใน Code.gs ที่ยังไม่ย้าย) → NOT_ON_FAST_HOST ไม่ใช่คำตอบจาก engine', code(n1) === 'NOT_ON_FAST_HOST');
  ok_('🔴 ผู้ปกครองขอ listParents → NO_PERMISSION', code(await call({ action: 'listParents', payload: {} }, PARENT)) === 'NO_PERMISSION');
  ok_('🔴 ผู้ปกครองขอข้อมูลลูกคนอื่น → NO_ACCESS', code(await call({ action: 'studentCheckinHistory', payload: { studentId: 'STD-002' } }, PARENT)) === 'NO_ACCESS');
  const own = await call({ action: 'studentCheckinHistory', payload: { studentId: 'STD-001' } }, PARENT);
  ok_('...ลูกตัวเองได้', own.ok === true);
  const b1 = await call({ action: 'batch', payload: { calls: [{ action: 'getConfig', payload: {} }, { action: 'staffSelf', payload: {} }] } });
  ok_('🔴 getConfig ซ่อนใน batch → UNKNOWN_ACTION · ข้าง ๆ ยังตอบ', code(b1.data[0]) === 'UNKNOWN_ACTION' && b1.data[1].ok === true);
  ok_('Observer เขียน → READ_ONLY', code(await call({ action: 'addComment', payload: { studentId: 'STD-001', message: 'x' } }, OBSERVER)) === 'READ_ONLY');
  ok_('ครูขอ addAnnouncement (ADMIN_ONLY) → NO_PERMISSION', code(await call({ action: 'addAnnouncement', payload: { title: 'x', content: 'y' } })) === 'NO_PERMISSION');
  /* staffCheckout, staffStudentCheckin, then submitTimeRequest were the example until each was ported (W3,
   * 2026-11-10). submitJournal is a teacher write that stays on Apps Script (Drive photos). */
  ok_('ครูส่งสมุดบันทึก (route ที่อยู่ Apps Script) → NOT_ON_FAST_HOST ไม่ใช่ "สำเร็จ" แล้วหาย', code(await call({ action: 'submitJournal', payload: {} })) === 'NOT_ON_FAST_HOST');
  ok_('ทั้งหมดข้างบน: ไม่มีคำสั่งเขียนถึงฐานข้อมูล', writesIn().length === 0 && persisted.length === 0);

  console.log('\n3) 🔴 การเขียนที่ยังไม่ได้พิสูจน์ → ปฏิเสธ ไม่บันทึก');
  reset();
  const saved = WRITE_PROVEN.addComment; delete WRITE_PROVEN.addComment;
  const u = await call({ action: 'addComment', payload: { studentId: 'STD-001', message: 'ทดสอบ', senderRole: 'Teacher' } });
  ok_('addComment ที่ถอดออกจากรายชื่อ → READ_ONLY_HOST (notProven)', code(u) === 'READ_ONLY_HOST' && (u.error.notProven || []).indexOf('addComment') >= 0);
  ok_('...rollback · ไม่มี persist · ไม่มี commit', persisted.length === 0 && log.indexOf('rollback') >= 0 && log.indexOf('commit') < 0);
  WRITE_PROVEN.addComment = saved;

  console.log('\n4) ✅ การเขียนที่พิสูจน์แล้ว → บันทึก ภายใต้ล็อก ในธุรกรรมเดียว');
  reset();
  const w = await call({ action: 'addComment', payload: { studentId: 'STD-001', message: 'ทดสอบ', senderRole: 'Teacher' } });
  ok_('addComment → ok', w.ok === true);
  ok_('บันทึกเฉพาะ collection ที่ประกาศ: comments', JSON.stringify(persisted) === JSON.stringify([['comments']]));
  const iBegin = log.indexOf('begin'), iLock = log.findIndex(s => /pg_advisory_xact_lock/.test(s)), iCommit = log.indexOf('commit');
  ok_('ลำดับ: begin → ล็อกของโรงเรียน → … → commit', iBegin >= 0 && iLock > iBegin && iCommit > iLock);
  ok_('🔴 โหลดข้อมูลสองรอบ — รอบที่บันทึกโหลดใหม่ "หลัง" ได้ล็อก', hydrations === 2 &&
    log.slice(iLock).indexOf('HYDRATE') >= 0);
  ok_('ล็อกรอได้ 25 วินาที (เท่า tryLock ของ GAS)', log.some(s => /lock_timeout = '25s'/.test(s)));

  console.log('\n5) ล็อกไม่ว่าง → BUSY ไม่ใช่เขียนโดยไม่มีล็อก');
  reset(); lockFails = true;
  const busy = await call({ action: 'addComment', payload: { studentId: 'STD-001', message: 'x', senderRole: 'Teacher' } });
  lockFails = false;
  ok_('→ BUSY · ไม่มี persist', code(busy) === 'BUSY' && persisted.length === 0);

  console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
