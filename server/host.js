/**
 * server/host.js — เอนจินตัวเดิม วิ่งบน Postgres หลัง HTTP ธรรมดา
 *   node server/host.js                 (ต้องมี secrets/supabase.env)
 *   PORT=8787 node server/host.js
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * สัปดาห์ที่ 1 ของ docs/SPEED_FIRST_PLAN.md
 *
 * เหตุผลทั้งหมดของไฟล์นี้อยู่ในตัวเลขที่วัดไว้ 07/10 บนระบบจริง:
 *
 *     request ที่ p50 = 7.4s  →  อ่านข้อมูลจริง 416ms (5.6%)  ·  ค่าเดินทาง 6,984ms (94.4%)
 *
 * **ที่ช้าไม่ใช่ที่เก็บข้อมูล** · ย้ายฐานข้อมูลอย่างเดียวได้ 5.6%
 * สิ่งที่ต้องย้ายคือ **ที่ request ไปลง** — ซึ่งคือไฟล์นี้
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 ไม่มีการเขียน handler ใหม่แม้แต่ตัวเดียว
 *
 * `createAtomAPI` ตัวเดียวกับที่ GAS ใช้ ทำงานกับ `M` ที่ `pg_engine` ป้อนมาจาก Postgres
 * (พิสูจน์แล้วด้วย 101 ชุดทดสอบใน Phase 2.3) · ถ้าเขียน handler เป็น SQL/View ใหม่
 * จะได้สองสำนวนที่ตอบไม่ตรงกัน ซึ่งเป็นบั๊กที่โปรเจ็กต์นี้เจอซ้ำมาหลายรอบแล้ว
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 ยังไม่ครบ และต้องไม่ถูกอ่านว่าครบ — ดูท้ายไฟล์
 */
'use strict';
const http = require('http');
const path = require('path');
const { connect } = require(path.join(__dirname, '..', 'tools', 'pg_lib.js'));
const PG = require(path.join(__dirname, '..', 'tools', 'pg_engine.js'));
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));
const { verifySession } = require(path.join(__dirname, 'session.js'));

const PORT = Number(process.env.PORT || 8787);
const SECRET = process.env.SESSION_SECRET || '';
const TENANT = process.env.TENANT_ID || '';

/* ── อะไรบ้างที่ต้องโหลด ────────────────────────────────────────────────────────────────
 * GAS ใช้ lazy getter — collection ถูกอ่านตอนที่ handler แตะมันเท่านั้น (hydrateLazy_)
 * ที่นี่ทำแบบนั้นไม่ได้ตรง ๆ เพราะ hydrate เป็น async แต่ handler เป็น sync
 *
 * 🔴 สัปดาห์นี้จึงโหลดทั้งหมดก่อน **แล้ววัด** ไม่ใช่เดาแล้วปรับ
 * ถ้าวัดแล้วเกินเป้า ค่อยแก้ — และตอนนั้นจะรู้ว่าต้องแก้ตรงไหนเพราะมีตัวเลข
 * (ของที่โตเร็วที่สุดคือ journals 1.36MB และ checkinStudent 537KB — สองตัวนี้คือที่ที่จะเจ็บก่อน) */
const ALL_KEYS = Object.keys(PG.COLLECTIONS);

/* action ที่พิสูจน์แล้วว่าโหลดเฉพาะวันนี้แล้วตอบเหมือนเดิม — ดู tools/test_narrow_safe.js
 * ลืมใส่ = ช้าเท่าเดิม (ยอมได้) · ใส่ผิด = คำตอบขาดข้อมูลย้อนหลัง (ยอมไม่ได้) */
const NARROW_SAFE = {
  classList: 1, listStudents: 1, listStaff: 1, listParents: 1, listClasses: 1, listDepartments: 1,
  listStaffGroups: 1, getPlans: 1, prepayTiers: 1, holidays: 1, bigCleaningDays: 1,
  getJournal: 1, journalStatus: 1, studentAlerts: 1, notifications: 1, holidayAttendList: 1,
  staffSelf: 1, myAttendanceToday: 1, myHolidayOTNext: 1, teacherClassAttendance: 1,
  staffMissingCheckout: 1, myClassCover: 1, injuryAlerts: 1, absenceWatchCount: 1,
  payments: 1, paymentSlips: 1, paymentLog: 1, prepayments: 1, studentCharges: 1, otDaily: 1,
  parentDue: 1, financeSummary: 1, payrollConfig: 1
};

const jsonOut = (res, obj, status) => {
  const s = JSON.stringify(obj);
  res.writeHead(status || 200, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(s),
    /* เบราว์เซอร์เรียกข้ามโดเมน — โฮสต์นี้อยู่คนละที่กับหน้าเว็บ
     * 🔴 `*` ใช้ได้ตอนวัดความเร็วบนข้อมูลจำลองเท่านั้น ก่อนรับข้อมูลจริงต้องล็อกเป็นโดเมนของเรา */
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store'
  });
  res.end(s);
};

/** ซองคำตอบต้องเหมือน Code.gs ทุกตัวอักษร ไม่งั้น api.js อ่านไม่ออก */
const reply = (res, action, o) => jsonOut(res, Object.assign({ a: action }, o));

async function handle(req, res, body) {
  const t0 = Date.now();
  let msg;
  try { msg = JSON.parse(body || '{}'); } catch (e) { msg = {}; }
  const action = String(msg.action || '');
  const payload = msg.payload || {};

  if (!action) return reply(res, '', { ok: false, error: { code: 'NO_ACTION', message: 'ไม่ได้ระบุ action' } });

  /* ── ใครเป็นคนถาม ──────────────────────────────────────────────────────────────────
   * 🔴 ตรวจก่อนแตะฐานข้อมูล · ~1ms และไม่ต้องคิวรีอะไรเลย
   * ดู server/session.js ว่าทำไมถึงเป็นแบบนี้ได้ */
  const sess = verifySession(msg.token, SECRET);

  /* 🔴 โฮสต์นี้ยัง **ไม่ได้** ทำ publicAction_ / NO_PERMISSION / write lock / Observer
   * ของพวกนั้นอยู่ใน Code.gs และเป็นงานสัปดาห์ที่ 2 · ตอนนี้จึงปฏิเสธทุกคำขอที่ไม่มี session
   * ซึ่งเข้มกว่าของจริง และเป็นด้านที่ถูกต้องที่จะผิดระหว่างยังวัดความเร็วอยู่ */
  if (!sess) return reply(res, action, { ok: false, error: { code: 'NO_SESSION', message: 'ต้องเข้าสู่ระบบใหม่' } });

  const tenant = TENANT || sess.tenantId;
  if (!tenant) return reply(res, action, { ok: false, error: { code: 'NO_TENANT', message: 'ไม่ทราบโรงเรียน' } });

  let client;
  try {
    /* 🔴 connect() คืน { client, scrub, env } ไม่ใช่ตัว client ตรง ๆ
     * เขียนผิดเป็น `client = await connect()` ตอนแรก แล้ว smoke test จับไม่ได้เลย
     * เพราะมันสลับทั้ง pg_lib ออกไปเป็นของปลอม — **ของที่ถูก stub ทิ้ง คือของที่ไม่ได้ถูกทดสอบ**
     * จับได้ตอนต่อฐานข้อมูลจริงครั้งแรก ซึ่งเป็นครั้งแรกที่โค้ดบรรทัดนี้ได้ทำงานจริง */
    ({ client } = await connect());
    const tHydrate0 = Date.now();
    /* hydrateFast = ยิง query เดียวแทน 38 ครั้ง · วัดแล้ว 1,140ms → 31ms
     * ดูเหตุผลเต็มที่หัว hydrateFast ใน tools/pg_engine.js */
    /* ── แคบสองตัวที่ใหญ่ที่สุดให้เหลือวันนี้ ────────────────────────────────────
     * วัดบน staging: ทั้ง request 367ms → **49ms** เมื่อ journals + checkinStudent เหลือวันเดียว
     * (สอง collection นี้คือ 90% ของเวลาโหลด และเป็นสองตัวที่โตขึ้นทุกวันไม่มีหยุด)
     *
     * 🔴 แคบก็ต่อเมื่อ **ทุก call ในคำขอ** อยู่ในรายชื่อที่พิสูจน์แล้วว่าแคบได้
     * ถ้ามีสักตัวที่ไม่อยู่ → ไม่แคบทั้งคำขอ · การไม่แคบแลกมาด้วยความช้า ซึ่งยอมได้
     * การแคบผิดแลกมาด้วยคำตอบที่ขาดข้อมูล ซึ่งยอมไม่ได้
     *
     * รายชื่อนี้ไม่ได้ประกาศลอย ๆ — tools/test_narrow_safe.js รันทุก handler สองรอบ
     * (ข้อมูลเต็ม vs แคบ) ทั้งสามบทบาท แล้วเทียบคำตอบ ถ้าตัวไหนเริ่มอ่านย้อนหลังเมื่อไหร่ ข้อนั้นแดง */
    const callsIn = action === 'batch'
      ? (Array.isArray(payload.calls) ? payload.calls.map(c => String(c.action || '')) : [])
      : [action];
    const canNarrow = callsIn.length > 0 && callsIn.every(a => NARROW_SAFE[a]);
    const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);   // วันตามเวลาไทย
    const scope = canNarrow ? { journals: today, checkinStudent: today } : {};
    const { M, snapshot } = await PG.hydrateFast(client, tenant, ALL_KEYS, { scope });
    const tHydrate = Date.now() - tHydrate0;

    const H = createAtomAPI(M, null).H;

    /* ตัวตนมาจาก token เสมอ ไม่ใช่จาก payload ที่ผู้ใช้ส่งมา — กฎเดียวกับ applyIdentity_ ใน Code.gs
     * ถ้าเชื่อ payload ผู้ปกครองคนหนึ่งจะขอดูของอีกคนได้ด้วยการแก้ตัวเลขใน request */
    const ident = { uid: sess.uid, role: sess.role };
    if (sess.role === 'Parent') ident.parentId = sess.linkedId;
    else ident.staffId = sess.linkedId;

    const runOne = (a, p) => {
      const fn = H[a];
      if (typeof fn !== 'function') {
        return { ok: false, error: { code: 'UNKNOWN_ACTION', message: 'ไม่รู้จัก action: ' + a } };
      }
      try { return { ok: true, data: fn(Object.assign({}, p, ident)) }; }
      catch (e) {
        /* รหัสต้องผ่านออกมา ไม่ใช่กลายเป็น INTERNAL ทั้งหมด — เคยพลาดข้อนี้มาแล้วใน GAS
         * (fail() ตั้ง `code` ตรงที่ dispatch_ อ่าน `apiCode`) ทำให้การปฏิเสธที่ถูกต้อง
         * ทุกอันไปโผล่เป็น "ระบบพัง" ในรายงาน */
        return { ok: false, error: { code: (e && (e.code || e.apiCode)) || 'INTERNAL',
                                     message: (e && e.message) || String(e) } };
      }
    };

    const tRun0 = Date.now();
    let out;
    if (action === 'batch') {
      const calls = Array.isArray(payload.calls) ? payload.calls : [];
      out = { ok: true, data: calls.map(c => runOne(String(c.action || ''), c.payload || {})) };
    } else {
      out = runOne(action, payload);
    }
    const tRun = Date.now() - tRun0;

    /* เขียนกลับเฉพาะที่เปลี่ยนจริง ทีละแถว — ไม่ใช่ทับทั้ง collection
     * นี่คือข้อต่างที่สำคัญที่สุดจาก GasEngine และเป็นเหตุผลที่เหตุข้อมูลหาย 09/07
     * เกิดซ้ำที่นี่ไม่ได้ในเชิงกลไก */
    const tSave0 = Date.now();
    const saved = await PG.persist(client, tenant, M, snapshot, ALL_KEYS);
    const tSave = Date.now() - tSave0;

    res.setHeader('x-atom-ms', JSON.stringify({
      total: Date.now() - t0, hydrate: tHydrate, run: tRun, save: tSave
    }));
    return reply(res, action, out);
  } catch (e) {
    return reply(res, action, { ok: false, error: { code: 'INTERNAL', message: (e && e.message) || String(e) } });
  } finally {
    if (client) { try { await client.end(); } catch (e) {} }
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { jsonOut(res, {}, 204); return; }
  if (req.method === 'GET') {
    // 🔴 ไม่ตอบ ok:true — เคยตอบแบบนั้นแล้ว client เอา health check ไปใช้เป็นข้อมูล (บั๊ก v186)
    return jsonOut(res, { service: 'atom-fast-host', status: 'up', time: new Date().toISOString() });
  }
  if (req.method !== 'POST') { jsonOut(res, { ok: false, error: { code: 'BAD_METHOD' } }, 405); return; }
  let body = '';
  req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
  req.on('end', () => { handle(req, res, body).catch(e => {
    try { jsonOut(res, { ok: false, error: { code: 'INTERNAL', message: String(e) } }, 500); } catch (x) {}
  }); });
});

if (require.main === module) {
  if (!SECRET) { console.error('host: ต้องตั้ง SESSION_SECRET (ค่าเดียวกับ Script Property ของ GAS)'); process.exit(1); }
  server.listen(PORT, () => console.log('atom-fast-host :' + PORT + '  tenant=' + (TENANT || '(จาก token)')));
}

module.exports = { server, handle };

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 ยังไม่ครบ — รายการนี้คือหนี้ที่รู้ตัว ไม่ใช่ของที่ลืม
 *
 *   ⬜ ต่อ "ออกจากระบบทุกเครื่อง" (sessionEpochOf_) — token ที่ถูกเพิกถอนยังใช้ได้บนเส้นนี้
 *   ⬜ publicAction_ / NO_PERMISSION / Observer / write lock — ยังอยู่ใน Code.gs ทั้งหมด
 *   ⬜ 131 shadow route · 87 ตัวต้องใช้ Drive · 37 ตัวยิงออกนอกระบบ — ยังต้องวิ่งผ่าน GAS
 *   ⬜ ต่อ connection pool — ตอนนี้เปิด-ปิดต่อ request (จะเห็นในตัวเลขที่วัดได้)
 *   ⬜ ล็อก CORS เป็นโดเมนของเรา ก่อนรับข้อมูลจริง
 *   ⬜ บันทึกตรวจสอบ PDPA (36 route)
 *
 * และกฎที่ใหญ่กว่าทุกข้อข้างบน:
 * 🔴 **ห้ามมีข้อมูลนักเรียนจริงแตะโฮสต์นี้ จนกว่าข้อตกลงประมวลผลข้อมูลจะลงนาม** (Phase 1.5)
 *    ดู tools/test_pg_load.js ซึ่งเขียนกฎข้อนี้ไว้ก่อนแล้ว
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
