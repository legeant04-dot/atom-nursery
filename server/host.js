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
const GATE = require(path.join(__dirname, 'gate.js'));
const { WRITE_PROVEN } = require(path.join(__dirname, 'write_proven.js'));

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
  /* 🔴 `__id` NEVER LEAVES THE HOST. It is the Postgres row id pg_engine puts on every row so persist
   * can update in place; Apps Script has no such field, so a handler that returns a row (classList,
   * addComment …) answered with an extra uuid — a different answer from live, and an internal key
   * handed to every phone. Found by test_fast_host_writes_live comparing replies with GAS. */
  const s = JSON.stringify(obj, (k, v) => (k === '__id' ? undefined : v));
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

  /* ทุกคำขอต้องมี session — action สาธารณะของ GAS (auth · lineExchange …) ยังทำบน Apps Script
   * เท่านั้น · เข้มกว่าของจริง และเป็นด้านที่ถูกต้องที่จะผิด · ด่านที่เหลือทั้งหมดอยู่ใน server/gate.js */
  if (!sess) return reply(res, action, { ok: false, error: { code: 'NO_SESSION', message: 'ต้องเข้าสู่ระบบใหม่' } });

  const tenant = TENANT || sess.tenantId;
  if (!tenant) return reply(res, action, { ok: false, error: { code: 'NO_TENANT', message: 'ไม่ทราบโรงเรียน' } });

  /* ── 🔒 ก่อนแตะฐานข้อมูล: ประตูที่ Code.gs ตัดสินได้จากชื่อ action อย่างเดียว ───────────────
   * ทั้งหมดมาจาก server/gate.js ซึ่งรัน Code.gs ตัวจริง ไม่ใช่สำเนา */
  const isBatch = action === 'batch';
  const calls = isBatch ? (Array.isArray(payload.calls) ? payload.calls : []) : [{ action, payload }];
  const isObs = String(sess.role) === 'Observer';
  const OWN_SESSION = 'signOutEverywhere';
  if (!isBatch && GATE.isClosed(action)) {
    return reply(res, action, { ok: false, error: { code: 'UNKNOWN_ACTION', message: 'ไม่รู้จัก action: ' + action } });
  }
  if (!isBatch && isObs && GATE.isMutating(action) && action !== OWN_SESSION) {
    return reply(res, action, { ok: false, error: { code: 'READ_ONLY', message: GATE.observerMessage() } });
  }

  let client;
  try {
    /* 🔴 connect() คืน { client, scrub, env } ไม่ใช่ตัว client ตรง ๆ — ดูประวัติใน git */
    ({ client } = await connect());
    const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);   // วันตามเวลาไทย

    /* ── ทำหนึ่งรอบ: โหลด → ด่าน → handler → เทียบว่ามีอะไรเปลี่ยน ─────────────────────────────
     * 🔴 สองรอบเมื่อมีการเขียน และนี่คือหัวใจของการเขียนบนโฮสต์นี้
     *
     * รอบแรกไม่ล็อก (การอ่านทั้งโรงเรียนไม่ต้องต่อคิวกัน — กฎเดียวกับ withWriteLock_ ของ GAS)
     * ถ้ารอบแรกพบว่า handler เปลี่ยนข้อมูล ผลของรอบแรกถูกทิ้งทั้งหมด แล้วทำใหม่ทั้งคำขอ
     * **ภายใต้ล็อกของโรงเรียน ในธุรกรรมเดียว** โหลดข้อมูลใหม่หลังได้ล็อก จึงไม่มีทางเขียนทับ
     * สิ่งที่คนอื่นเพิ่งบันทึกไป — ลักษณะเดียวกับเหตุข้อมูลหาย 09/07 ที่ล็อกของ GAS มีไว้กัน
     *
     * ไม่ใช้ชื่อ action ตัดสินว่า "เขียนไหม" เพราะรายชื่อที่พลาดหนึ่งตัวคือข้อมูลหายเงียบ ๆ
     * ใช้ผลจริง: ข้อมูลเปลี่ยนหรือไม่ */
    const attempt = async (locked) => {
      if (locked) {
        await client.query('begin');
        await client.query("set local lock_timeout = '25s'");                      // = tryLock(25000)
        try { await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [tenant]); }
        catch (e) { await client.query('rollback').catch(() => {}); return { busy: true }; }
      }
      const tH0 = Date.now();
      const callsIn = calls.map(c => String((c && c.action) || ''));
      const canNarrow = !locked && callsIn.length > 0 && callsIn.every(a => NARROW_SAFE[a]);
      const scope = canNarrow ? { journals: today, checkinStudent: today } : {};
      const { M, snapshot } = await PG.hydrateFast(client, tenant, ALL_KEYS, { scope });
      M.config = await PG.hydrateConfig(client, tenant);
      const derivedChanged = await PG.hydrateDerived(client, tenant, M, today);
      const tHydrate = Date.now() - tH0;
      const before = {};
      ALL_KEYS.forEach(k => { before[k] = JSON.stringify(M[k]); });
      before.config = JSON.stringify(M.config);

      const H = createAtomAPI(M, null).H;
      const err = (code, message) => ({ ok: false, error: { code, message } });
      const tR0 = Date.now();
      const results = calls.map(c => {
        const a = String((c && c.action) || '');
        /* ลำดับเดียวกับ dispatch_ + handleBatch ของ GAS · และประตูที่ปิดถูกตรวจ "ทุก call"
         * (GAS เคยตรวจแค่ระดับบน — ช่องที่พบและปิดไปแล้วใน @399) */
        if (a === 'batch' || GATE.isClosed(a)) return err('UNKNOWN_ACTION', 'ไม่รู้จัก action: ' + a);
        if (isObs && GATE.isMutating(a) && a !== OWN_SESSION) return err('READ_ONLY', GATE.observerMessage());
        let pl;
        try { pl = GATE.identity(a, (c && c.payload) || {}, sess, M); }
        catch (e) { return err((e && (e.apiCode || e.code)) || 'INTERNAL', (e && e.message) || String(e)); }
        /* 🔴 ของจริงไม่ได้รัน engine สำหรับ action นี้ (มี route ใน Code.gs) — คำตอบจาก engine
         * จะเป็นคำตอบของอีกคำถามหนึ่ง จึงไม่ตอบ และบอกให้ไปถาม Apps Script */
        if (GATE.isRoute(a)) return err('NOT_ON_FAST_HOST', 'action นี้ยังต้องทำงานบน Apps Script');
        const fn = H[a];
        if (typeof fn !== 'function') return err('UNKNOWN_ACTION', 'ไม่รู้จัก action: ' + a);
        try { return { ok: true, data: fn(pl) }; }
        catch (e) {
          /* รหัสต้องผ่านออกมา ไม่ใช่กลายเป็น INTERNAL ทั้งหมด (fail() ตั้ง code / apiCode) */
          return err((e && (e.code || e.apiCode)) || 'INTERNAL', (e && e.message) || String(e));
        }
      });
      const tRun = Date.now() - tR0;

      const changed = ALL_KEYS.filter(k => JSON.stringify(M[k]) !== before[k]);
      const otherChanged = (JSON.stringify(M.config) !== before.config ? ['config'] : []).concat(derivedChanged());
      const t = { hydrate: tHydrate, run: tRun, save: 0 };
      if (!changed.length && !otherChanged.length) {
        if (locked) await client.query('commit');
        return { results, t };
      }
      if (!locked) return { retry: true };

      /* ── ภายใต้ล็อก และมีการเปลี่ยน: ตรวจทุกด่านก่อนบันทึก ─────────────────────────────── */
      const refuse = async (code, message, extra) => {
        await client.query('rollback');
        return { refused: { ok: false, error: Object.assign({ code, message }, extra || {}) }, t };
      };
      const writers = calls.map((c, i) => ({ a: String((c && c.action) || ''), r: results[i] }))
        .filter(x => GATE.isMutating(x.a) && x.r.ok);
      const notProven = writers.filter(x => !WRITE_PROVEN[x.a]).map(x => x.a);
      const allowed = new Set([].concat(...writers.map(x => WRITE_PROVEN[x.a] || [])));
      const outside = changed.concat(otherChanged).filter(k => !allowed.has(k));
      /* 🔴 บันทึกได้เฉพาะ action ที่พิสูจน์แล้วว่าผลตรงกับ Apps Script (WRITE_PROVEN) และเฉพาะ
       * collection ที่ action นั้นประกาศไว้ · การเปลี่ยนใดที่อยู่นอกนั้น = ปฏิเสธทั้งคำขอ ไม่มีอะไรถูกบันทึก
       * (รวมคีย์ที่คำนวณ เช่น staffAttendanceToday ซึ่งยังไม่มีตัวเขียน และ config ซึ่ง GAS ก็ไม่บันทึก) */
      if (!writers.length || notProven.length || outside.length) {
        return refuse('READ_ONLY_HOST', 'เส้นทางนี้ยังบันทึกข้อมูลนี้ไม่ได้ — ไม่มีอะไรถูกบันทึก',
          { changed: changed.concat(otherChanged), notProven, outside });
      }
      for (const k of changed) {
        const c = PG.COLLECTIONS[k];
        /* 🔴 WRITE_GUARD ของ writeRows_ (GasEngine.gs) — กฎเดียวกันทุกตัวเลข:
         * ชีตตัวตน/เงินห้ามหดเลย · ที่เหลือห้ามหายเกิน 5 แถวและเกิน 25% ในคำขอเดียว */
        const was = JSON.parse(before[k]).length, now = (M[k] || []).length;
        if (now < was) {
          const drop = was - now;
          if (GATE.noShrink(c.sheet) || (drop > 5 && drop > was * 0.25)) {
            return refuse('WRITE_GUARD', 'ยกเลิกการบันทึกชีต ' + c.sheet + ' เพื่อป้องกันข้อมูลหาย (' + was + ' → ' + now + ' แถว)');
          }
        }
        /* 🔴 รูปภาพ: GAS ย้ายรูป base64 ไปไว้ใน Drive ก่อนเขียน (driveifyImage_) · ที่นี่ทำไม่ได้
         * การเก็บรูปทั้งก้อนลงฐานข้อมูลคือคำตอบที่ต่างจาก GAS จึงไม่บันทึก */
        const hasImage = (M[k] || []).some(r => Object.keys(r).some(f =>
          GATE.imageCol((c.toSheet && c.toSheet[f]) || f) && /^data:/.test(String(r[f] || ''))));
        if (hasImage) return refuse('NOT_ON_FAST_HOST', 'มีรูปภาพที่ต้องเก็บใน Drive — ยังต้องทำบน Apps Script');
      }
      const tS0 = Date.now();
      const saved = await PG.persist(client, tenant, M, snapshot, changed);
      await client.query('commit');
      t.save = Date.now() - tS0;
      return { results, t, saved };
    };

    let r = await attempt(false);
    if (r.retry) {
      try { r = await attempt(true); }
      catch (e) { await client.query('rollback').catch(() => {}); throw e; }
    }
    if (r.busy) return reply(res, action, { ok: false, error: { code: 'BUSY', message: GATE.busyMessage() } });
    res.setHeader('x-atom-ms', JSON.stringify(Object.assign({ total: Date.now() - t0 }, r.t,
      r.saved ? { written: r.saved } : {})));
    if (r.refused) return reply(res, action, r.refused);
    return reply(res, action, isBatch ? { ok: true, data: r.results } : r.results[0]);
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
 *   ✅ ด่านของ Code.gs (ADMIN_ONLY · Observer · CLOSED · parentOwnsStudent_ · ENDED/NOT_STARTED/PAUSED) — server/gate.js
 *   ✅ ล็อกการเขียน = pg_advisory_xact_lock ต่อโรงเรียน + ธุรกรรม · WRITE_GUARD · ลำดับแถว
 *   ⬜ 180 ROUTES ตอบ NOT_ON_FAST_HOST — ยังต้องวิ่งผ่าน GAS (client ต้องส่งต่อเอง)
 *   ⬜ เขียนได้เฉพาะ server/write_proven.js · คีย์ที่คำนวณ (ลงเวลาครู · payrollConfig) ยังไม่มีตัวเขียน · เงินยังไม่เปิด
 *   🔴 ล็อกนี้ต้องเป็นล็อกเดียวกับ Apps Script ก่อนวันย้าย (DbPg ต้องถือ advisory lock ตัวเดียวกัน)
 *   ⬜ ต่อ connection pool — ตอนนี้เปิด-ปิดต่อ request (จะเห็นในตัวเลขที่วัดได้)
 *   ⬜ ล็อก CORS เป็นโดเมนของเรา ก่อนรับข้อมูลจริง
 *   ⬜ บันทึกตรวจสอบ PDPA (36 route)
 *
 * และกฎที่ใหญ่กว่าทุกข้อข้างบน:
 * 🔴 **ห้ามมีข้อมูลนักเรียนจริงแตะโฮสต์นี้ จนกว่าข้อตกลงประมวลผลข้อมูลจะลงนาม** (Phase 1.5)
 *    ดู tools/test_pg_load.js ซึ่งเขียนกฎข้อนี้ไว้ก่อนแล้ว
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
