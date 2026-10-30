/**
 * tools/test_narrow_safe.js — "โหลดเฉพาะวันนี้" ต้องตอบเหมือน "โหลดทุกวัน"
 *   node tools/test_narrow_safe.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * เส้นเร็วโหลด journals กับ checkinStudent **เฉพาะวันนี้** เพราะสอง collection นี้คือ 90%
 * ของเวลาโหลดทั้งหมด (วัดบน staging: ทั้ง request 367ms → 49ms)
 *
 * 🔴 แต่การแคบคือการ **ไม่เอาข้อมูลบางส่วนมา** — และ handler ที่อ่านย้อนหลังจะตอบขาด
 * โดยไม่มีอะไร throw · ตัวเลขจะน้อยลงเฉย ๆ แล้วไม่มีใครรู้
 *
 * ชุดนี้จึงไม่ได้ "ประกาศ" ว่าตัวไหนแคบได้ แต่ **พิสูจน์ทุกตัวใหม่ทุกครั้งที่รัน**:
 * สร้าง M สองชุด (120 วัน vs วันเดียว) แล้วเรียก handler เดียวกันทั้งสามบทบาท
 * ถ้าคำตอบต่างกันแม้แต่ตัวอักษรเดียว → แดง
 *
 * วันที่ handler ตัวใดเริ่มอ่านย้อนหลัง ข้อนั้นจะแดงทันที ก่อนที่ใครจะเห็นตัวเลขผิดบนหน้าจอ
 *
 * ไม่ต้องใช้ฐานข้อมูล — ทดสอบที่ "เอนจินตอบอะไร" ไม่ใช่ที่ "Postgres ส่งอะไรมา"
 */
'use strict';
const path = require('path'), fs = require('fs');
const PG = require(path.join(__dirname, 'pg_engine.js'));
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));

let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  console.log((okk ? '  ok   ' : '  FAIL ') + label + (okk ? '' : '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
  okk ? pass++ : fail++;
}
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

/* ใช้ตัวสร้างข้อมูลจำลองตัวเดียวกับ measure_fast_host.js — ชุดเดียว ไม่ใช่สองสำนวน */
const src = R('tools/measure_fast_host.js');
const fakeM = new Function('PG', src.slice(src.indexOf('const N = {'), src.indexOf('/* ── รูปทราฟฟิกจริง')) + '; return fakeM;')(PG);

/* รายชื่อที่โฮสต์ประกาศว่าแคบได้ — อ่านจาก server/host.js เอง ไม่ใช่พิมพ์ซ้ำที่นี่
 * ชุดทดสอบที่ถือรายชื่อของตัวเอง จะเขียวต่อไปแม้ของจริงจะเพิ่มชื่อใหม่เข้าไปแล้ว */
const host = R('server/host.js');
const seg = host.slice(host.indexOf('const NARROW_SAFE = {'), host.indexOf('const jsonOut ='));
const DECLARED = [...seg.matchAll(/([a-zA-Z][a-zA-Z0-9]*): 1/g)].map(x => x[1]);

const full = fakeM();
const TODAY = full.journals[full.journals.length - 1].Date;
const narrow = JSON.parse(JSON.stringify(full));
narrow.journals = narrow.journals.filter(j => j.Date === TODAY);
narrow.checkinStudent = narrow.checkinStudent.filter(c => c.Date === TODAY);

const ROLES = [
  { label: 'คุณครู', id: { uid: 'U1', role: 'Teacher', staffId: 'STF-002' } },
  { label: 'แอดมิน', id: { uid: 'U2', role: 'Admin', staffId: 'STF-001' } },
  { label: 'ผู้ปกครอง', id: { uid: 'U3', role: 'Parent', parentId: 'PAR-001' } }
];

console.log('\n1) ข้อมูลจำลองต้องกว้างพอที่จะจับความต่างได้จริง');
{
  /* ถ้าชุดแคบกับชุดเต็มมีข้อมูลเท่ากัน ข้อ 2 จะเขียวโดยไม่ได้พิสูจน์อะไรเลย
   * — ชุดทดสอบที่ผ่านเพราะไม่มีอะไรให้ต่าง คือชุดทดสอบที่โกหกตัวเอง */
  ok_('ชุดเต็มมีบันทึกหลายวัน (' + full.journals.length + ' ใบ)', full.journals.length > 500);
  ok_('ชุดแคบเหลือวันเดียว (' + narrow.journals.length + ' ใบ)',
    narrow.journals.length > 0 && narrow.journals.length < full.journals.length / 10);
  ok_('เช็คอินก็แคบลงจริง (' + full.checkinStudent.length + ' → ' + narrow.checkinStudent.length + ')',
    narrow.checkinStudent.length > 0 && narrow.checkinStudent.length < full.checkinStudent.length / 10);
}

console.log('\n2) 🔴 ทุก action ที่ประกาศว่าแคบได้ ต้องตอบเหมือนเดิมทุกบทบาท');
{
  ok_('อ่านรายชื่อจาก server/host.js ได้ (' + DECLARED.length + ' ตัว)', DECLARED.length >= 25);
  const Hf = createAtomAPI(JSON.parse(JSON.stringify(full)), null).H;
  const Hn = createAtomAPI(JSON.parse(JSON.stringify(narrow)), null).H;
  const bad = [], noHandler = [];
  for (const a of DECLARED) {
    if (typeof Hf[a] !== 'function') { noHandler.push(a); continue; }
    for (const r of ROLES) {
      const call = H => { try { return JSON.stringify(H[a](Object.assign({ date: TODAY }, r.id))); }
                          catch (e) { return 'ERR:' + ((e && e.code) || (e && e.message) || e); } };
      const x = call(Hf), y = call(Hn);
      if (x !== y) { bad.push(a + ' (' + r.label + ')'); break; }
    }
  }
  /* 🔴 ชื่อที่ไม่มี handler คือของที่จะได้ UNKNOWN_ACTION ตอนเปิดใช้จริง
   * เคยหลุดมาแล้วสองตัว (departments / staffGroups ซึ่งเป็นคีย์แคช ไม่ใช่ชื่อ action) */
  eq('🔴 ทุกชื่อในรายการมี handler จริงในเอนจิน', noHandler, []);
  eq('🔴 ไม่มีตัวไหนตอบต่างเมื่อโหลดเฉพาะวันนี้', bad, []);
}

console.log('\n3) และโฮสต์ต้องไม่แคบเมื่อมีสักตัวที่ไม่อยู่ในรายการ');
{
  /* การแคบทั้งคำขอ ทั้งที่มี call หนึ่งต้องการข้อมูลย้อนหลัง = call นั้นได้คำตอบผิด
   * ปลอดภัยด้านเดียวเสมอ: ไม่แน่ใจ → ไม่แคบ → ช้าลง ซึ่งแก้ทีหลังได้ */
  ok_('แคบก็ต่อเมื่อทุก call อยู่ในรายการ', /callsIn\.every\(a => NARROW_SAFE\[a\]\)/.test(host));
  ok_('คำขอเปล่าไม่ถูกแคบ', /callsIn\.length > 0 &&/.test(host));
  ok_('ไม่แคบ = ส่ง scope ว่าง ไม่ใช่ข้ามการโหลด', /: \{\};/.test(host) && /\{ scope \}/.test(host));
  /* วันต้องเป็นวันตามเวลาไทย ไม่ใช่ UTC — ไม่งั้นหลัง 17:00 จะแคบไปที่วันพรุ่งนี้
   * แล้วหน้าจอตอนเย็นจะว่างเปล่า ซึ่งเป็นเวลาที่ครูกำลังส่งสมุดบันทึกพอดี */
  ok_('🔴 วันที่ใช้แคบเป็นเวลาไทย ไม่ใช่ UTC', /7 \* 3600000/.test(host));
}

console.log('\n4) hydrateFast ต้องปฏิเสธวันที่ที่ไม่ใช่รูปแบบวันที่');
{
  const eng = R('tools/pg_engine.js');
  /* scope ถูกต่อเป็นสตริงลงใน SQL (simple query ไม่มีพารามิเตอร์)
   * ทางเดียวที่ปลอดภัยคือไม่รับอะไรที่ไม่ใช่ YYYY-MM-DD เลย */
  ok_('มีการตรวจรูปแบบก่อนต่อสตริง', /\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/.test(eng));
}

/* 🔴 hydrateFast เป็น async — เรียกแบบไม่ await แล้วดักด้วย try/catch ธรรมดาจะไม่จับอะไรเลย
 * เพราะมันคืน promise ที่ reject ไม่ใช่ throw ออกมาตรง ๆ · เวอร์ชันแรกของข้อนี้จึงแดงค้าง
 * และถ้าตอนนั้นเขียนกลับด้าน (คาดว่าไม่ throw) มันจะ "ผ่าน" ทั้งที่ไม่ได้ทดสอบอะไร ซึ่งแย่กว่าแดง */
(async () => {
  const bad = ["x' or '1'='1", '2026-13-01x', 'วันนี้', '2026/10/30', '2026-10-3'];
  for (const d of bad) {
    let threw = '';
    try { await PG.hydrateFast({}, '00000000-0000-4000-8000-000000000000', ['journals'], { scope: { journals: d } }); }
    catch (e) { threw = (e && e.message) || ''; }
    ok_('🔴 ปฏิเสธ scope ' + JSON.stringify(d), /YYYY-MM-DD/.test(threw));
  }
  /* ...และวันที่ถูกต้องต้องผ่านด่านรูปแบบไปได้ (จะไปตายที่ client ปลอมทีหลัง ซึ่งคนละเรื่อง)
   * ถ้าไม่เช็กข้อนี้ ตัวตรวจที่ปฏิเสธทุกอย่างก็จะทำให้ห้าข้อบนเขียวหมดโดยไร้ความหมาย */
  let msg = '';
  try { await PG.hydrateFast({}, '00000000-0000-4000-8000-000000000000', ['journals'], { scope: { journals: '2026-10-30' } }); }
  catch (e) { msg = (e && e.message) || ''; }
  ok_('วันที่ถูกต้องผ่านด่านรูปแบบ', !/YYYY-MM-DD/.test(msg));

  console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
