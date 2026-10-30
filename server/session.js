/**
 * server/session.js — ตรวจ session token ของ Atom โดยไม่ต้องแตะฐานข้อมูล
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 นี่คือเหตุผลที่งาน "ย้ายที่รัน" เล็กกว่าที่คิดมาก
 *
 * token ที่ `src/Auth.gs` ออกให้ เป็น **HMAC แบบไร้สถานะ**:
 *
 *     base64url(JSON {uid, role, linkedId, iat, exp}) + "." + base64url(HMAC-SHA256(body, secret))
 *
 * แปลว่าโฮสต์ตัวไหนก็ตามที่ถือ secret เดียวกัน **ตรวจได้เองใน ~1 มิลลิวินาที**
 * ไม่ต้องเรียก Apps Script ไม่ต้องอ่านชีต ไม่ต้องคิวรี Postgres
 *
 * → **ล็อกอินไม่ต้องย้าย** · LINE LIFF · Google · การออก token ยังอยู่ GAS ทั้งหมด
 *   `Auth.gs` 883 บรรทัดไม่ต้องพอร์ต — พอร์ตมาแค่ไฟล์นี้
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 กับดักที่จะทำให้ "ทุกคนล็อกอินไม่ได้" ถ้าพลาด: รูปแบบ base64
 *
 * Apps Script ใช้ `Utilities.base64EncodeWebSafe(...)` ซึ่งให้ base64url **ที่ยังมี `=` ต่อท้าย**
 * ส่วน Node `Buffer.toString('base64url')` **ตัด `=` ทิ้ง**
 *
 * ถ้าเทียบสตริงกันตรง ๆ ลายเซ็นจะไม่ตรงกันทุกใบ และอาการที่เห็นคือ
 * **ทุกคนในโรงเรียนถูกเด้งออกพร้อมกัน** โดยที่ลายเซ็นไม่ได้ผิดอะไรเลย
 *
 * จึงตัด `=` ออกจากทั้งสองฝั่งก่อนเทียบเสมอ (`norm_`) และ `tools/test_fast_host.js`
 * มี token ที่สร้างด้วยวิธีเดียวกับ Apps Script ทุกประการไว้ตรึงข้อนี้
 */
'use strict';
const crypto = require('crypto');

/** base64url ที่ไม่สนใจ `=` ต่อท้าย — ดูหมายเหตุหัวไฟล์ว่าทำไมข้อนี้ถึงสำคัญ */
const norm_ = s => String(s || '').replace(/=+$/, '');

/** เซ็น body เหมือน Apps Script ทุกประการ (ใช้ทั้งตอนตรวจ และตอนสร้าง token ในชุดทดสอบ)
 *
 * 🔴 ต้องเป็น `.digest('base64')` ไม่ใช่ `.toString('base64')`
 * `.update()` คืนตัว Hmac กลับมา — การเรียก `.toString()` บนมันจึงได้สตริง `'[object Object]'`
 * ซึ่ง **เท่ากันทุกครั้งไม่ว่า body หรือ secret จะเป็นอะไร** แปลว่าลายเซ็นทุกใบผ่านหมด
 * ใครก็ได้แก้ role เป็น Admin แล้วเข้าดูข้อมูลทั้งโรงเรียน
 *
 * เขียนผิดแบบนี้ครั้งแรกจริง ๆ และไม่มีอะไรพัง — โค้ดรัน ไม่ throw token ก็ยัง "ผ่าน"
 * สิ่งเดียวที่จับได้คือข้อทดสอบที่เอา secret ผิดมายิง (ข้อ 2 ของ test_fast_host.js) */
function sign_(body, secret) {
  return norm_(crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_'));
}

/**
 * คืน payload ถ้า token ใช้ได้ · คืน null ถ้าใช้ไม่ได้ — เงียบ ๆ เหมือน verifySession_ ใน Auth.gs
 *
 * 🔴 เทียบลายเซ็นด้วย timingSafeEqual ไม่ใช่ `===`
 * Apps Script เทียบด้วย `!==` ซึ่งรั่วเวลา แต่ที่นั่นอยู่หลังคิวของ Google และเสียงรบกวน
 * 3–30 วินาทีกลบทุกอย่าง · ที่นี่ตอบในหลักมิลลิวินาที สัญญาณจึงอ่านได้จริง
 * **ความเร็วที่เราเพิ่งซื้อมา ทำให้ช่องนี้เปิดขึ้น** จึงต้องปิดไปพร้อมกัน
 *
 * opts.now   — เวลาที่ใช้ตัดสินวันหมดอายุ (ชุดทดสอบส่งเข้ามา)
 * opts.epoch — ฟังก์ชัน uid → epoch ของการ "ออกจากระบบทุกเครื่อง" (ยังไม่ได้ต่อ — ดูหมายเหตุล่าง)
 */
function verifySession(token, secret, opts) {
  opts = opts || {};
  if (!token || !secret) return null;
  const t = String(token);
  const dot = t.indexOf('.');
  if (dot < 1) return null;
  const body = t.slice(0, dot), sig = norm_(t.slice(dot + 1));
  if (!body || !sig) return null;

  const expect = sign_(body, secret);
  const a = Buffer.from(expect), b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;   // ลายเซ็นไม่ตรง = ปลอม

  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64').toString('utf8')); }
  catch (e) { return null; }
  if (!p || typeof p !== 'object') return null;

  const now = opts.now != null ? Number(opts.now) : Date.now();
  if (!p.exp || now > Number(p.exp)) return null;                           // หมดอายุ

  /* 🔴 ยังไม่ได้ต่อกับ "ออกจากระบบทุกเครื่อง" และต้องไม่ลืมข้อนี้
   * Auth.gs เทียบ p.iat กับ sessionEpochOf_(p.uid) ซึ่งอ่านจากชีต
   * ถ้าโฮสต์นี้ไม่เทียบ token ที่ถูกสั่งเพิกถอนไปแล้วจะยังใช้ได้บนเส้นเร็ว
   * — เป็นช่องที่ต้องปิดก่อนรับข้อมูลจริง ไม่ใช่ก่อนวัดความเร็ว
   * ตอนนี้รับเป็นฟังก์ชันเข้ามา เพื่อให้ที่เสียบมีอยู่จริงตั้งแต่วันแรก */
  if (typeof opts.epoch === 'function') {
    const ep = Number(opts.epoch(p.uid)) || 0;
    if (ep && !(Number(p.iat) >= ep)) return null;
  }
  return p;
}

module.exports = { verifySession, sign_, norm_ };
