/**
 * tools/test_fast_host.js — เส้นเร็ว: ตรวจ token และซองคำตอบ
 *   node tools/test_fast_host.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * สัปดาห์ที่ 1 ของ docs/SPEED_FIRST_PLAN.md — "ย้ายที่รัน ไม่ใช่ย้ายที่เก็บ"
 *
 * ชุดนี้ **ไม่ต้องมีฐานข้อมูล** · ตรงข้ามกับ test_pg_load.js ที่ต้องมี
 * เพราะสองอย่างที่จะทำให้ทั้งโรงเรียนเข้าไม่ได้ ไม่ได้อยู่ที่ฐานข้อมูลเลย:
 *
 *   ① รูปแบบ base64 ของลายเซ็นไม่ตรงกับที่ Apps Script ออกให้ → **ทุกคนถูกเด้งออกพร้อมกัน**
 *   ② ซองคำตอบไม่ตรงกับที่ api.js อ่าน → **ทุกหน้าจอตายที่ประตู**
 *
 * ทั้งสองข้อพังเงียบและพังพร้อมกันทุกคน ชุดนี้จึงยิงที่สองข้อนี้ก่อนอย่างอื่น
 */
const path = require('path');
const crypto = require('crypto');
const { verifySession } = require(path.join(__dirname, '..', 'server', 'session.js'));
const fs = require('fs');

let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  console.log((okk ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (okk ? '' : ' want=' + JSON.stringify(want)));
  okk ? pass++ : fail++;
}
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

const SECRET = 'test-secret-' + 'x'.repeat(20);

/* ── สร้าง token แบบ Apps Script ทุกประการ ──────────────────────────────────────────────
 * Utilities.base64EncodeWebSafe ให้ base64url ที่ **ยังมี `=` ต่อท้าย**
 * ส่วน Node .toString('base64url') **ตัด `=` ทิ้ง** — นี่คือจุดที่พลาดแล้วพังทั้งโรงเรียน
 * ที่นี่จึงจงใจสร้างแบบ "มี =" เพื่อให้ชุดทดสอบเดินผ่านเส้นทางที่ของจริงเดินจริง */
function gasToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_');                    // คง `=` ไว้ เหมือน Apps Script
  /* 🔴 `.digest` ไม่ใช่ `.toString` — ตอนเขียนครั้งแรกผิดทั้งสองฝั่ง (ทั้งที่นี่และใน session.js)
   * ผลคือลายเซ็นเป็นสตริง '[object Object]' เท่ากันหมด ชุดทดสอบจึง "เขียว" ทั้งที่ของจริงพังสนิท
   * — ชุดทดสอบที่สร้างข้อมูลด้วยโค้ดที่ผิดแบบเดียวกับของจริง พิสูจน์ได้แค่ว่าสองอันผิดเหมือนกัน */
  const sig = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_');                    // คง `=` ไว้ เหมือน Apps Script
  return body + '.' + sig;
}

const NOW = 1800000000000;
const live = extra => Object.assign({ uid: 'U-1', role: 'Teacher', linkedId: 'STF-A',
  iat: NOW - 1000, exp: NOW + 3600000 }, extra || {});

// ============================================================================
console.log('\n1) 🔴 token ที่ Apps Script ออกให้ ต้องผ่านที่นี่');
{
  const p = verifySession(gasToken(live(), SECRET), SECRET, { now: NOW });
  ok_('ยอมรับ token ที่มี `=` ต่อท้าย (แบบที่ Apps Script ออกจริง)', !!p);
  eq('อ่านตัวตนออกมาได้ครบ', p && [p.uid, p.role, p.linkedId], ['U-1', 'Teacher', 'STF-A']);

  /* และต้องยอมรับตอนที่ `=` ของ **ลายเซ็น** ถูกตัดทิ้ง เผื่อฝั่งที่ออก token เปลี่ยนไปใช้
   * base64url มาตรฐานวันหนึ่ง — ข้อนี้มีไว้ให้การเปลี่ยนนั้นไม่ใช่เหตุการณ์ที่ทุกคนหลุดพร้อมกัน
   *
   * 🔴 ตัดเฉพาะของลายเซ็น ไม่ใช่ของ body · เวอร์ชันแรกของข้อนี้ตัดทั้งคู่แล้วขึ้นแดง
   * และ **ข้อทดสอบเป็นฝ่ายผิด ไม่ใช่โค้ด**: ลายเซ็นเซ็นทับ "สตริง body ตัวนั้น"
   * การตัด `=` ออกจาก body จึงเปลี่ยน body และทำให้ token ใช้ไม่ได้จริง ๆ ซึ่งถูกแล้ว
   * ส่วน `=` ของลายเซ็นเป็นแค่รูปแบบการเข้ารหัส จึงมองข้ามได้ฝั่งเดียว */
  const [b0, s0] = gasToken(live(), SECRET).split('.');
  ok_('และยอมรับตอนที่ `=` ของลายเซ็นถูกตัดทิ้ง', !!verifySession(b0 + '.' + s0.replace(/=+$/, ''), SECRET, { now: NOW }));
  ok_('🔴 แต่ถ้า body ถูกแก้ (แม้แค่ตัด `=`) ต้องไม่ผ่าน', verifySession(b0.replace(/=+$/, '') + '.' + s0, SECRET, { now: NOW }) === null);
}

// ============================================================================
console.log('\n2) และต้องปฏิเสธทุกอย่างที่ไม่ใช่ของจริง');
{
  const good = gasToken(live(), SECRET);
  ok_('ลายเซ็นผิด → null', verifySession(good.slice(0, -4) + 'AAAA', SECRET, { now: NOW }) === null);
  ok_('secret คนละตัว → null', verifySession(good, SECRET + 'z', { now: NOW }) === null);
  ok_('ไม่มี token → null', verifySession('', SECRET, { now: NOW }) === null);
  ok_('ไม่มีจุดคั่น → null', verifySession('abcdef', SECRET, { now: NOW }) === null);
  /* 🔴 ข้อนี้คือหัวใจ: แก้ payload แล้วเอาลายเซ็นเดิมมาใช้
   * ถ้าผ่าน แปลว่าผู้ปกครองคนหนึ่งแก้ role เป็น Admin แล้วเห็นข้อมูลทั้งโรงเรียนได้ */
  const forged = Buffer.from(JSON.stringify(live({ role: 'Admin' })), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_') + '.' + good.split('.')[1];
  ok_('🔴 แก้ payload เป็น Admin แล้วใช้ลายเซ็นเดิม → null', verifySession(forged, SECRET, { now: NOW }) === null);
  ok_('หมดอายุแล้ว → null', verifySession(gasToken(live({ exp: NOW - 1 }), SECRET), SECRET, { now: NOW }) === null);
}

// ============================================================================
console.log('\n3) "ออกจากระบบทุกเครื่อง" — ที่เสียบต้องมีอยู่จริงตั้งแต่วันแรก');
{
  /* Auth.gs เทียบ p.iat กับ sessionEpochOf_(uid) · ถ้าเส้นเร็วไม่เทียบ
   * token ที่ถูกสั่งเพิกถอนไปแล้วจะยังใช้ได้ที่นี่ — ช่องที่ต้องปิดก่อนรับข้อมูลจริง
   * ข้อนี้ตรึงว่า "ที่เสียบ" มีอยู่และทำงาน ไม่ใช่ว่าต่อสายแล้ว */
  const tok = gasToken(live({ iat: NOW - 5000 }), SECRET);
  ok_('ไม่มี epoch → ผ่านตามปกติ', !!verifySession(tok, SECRET, { now: NOW }));
  ok_('🔴 iat เก่ากว่า epoch → null', verifySession(tok, SECRET, { now: NOW, epoch: () => NOW - 1000 }) === null);
  ok_('iat ใหม่กว่า epoch → ผ่าน', !!verifySession(tok, SECRET, { now: NOW, epoch: () => NOW - 9000 }));
}

// ============================================================================
console.log('\n4) ซองคำตอบต้องเหมือน Code.gs ไม่งั้น api.js อ่านไม่ออก');
{
  const host = R('server/host.js');
  /* api.js ตรวจว่า `j.a` ตรงกับ action ที่ถามไป — มีไว้ตั้งแต่บั๊ก v186 ที่ health check
   * ถูกส่งกลับมาเป็นข้อมูล แล้วหน้าจอตายด้วย "x.map is not a function" */
  ok_('ทุกคำตอบติดชื่อ action กลับไปด้วย (a)', /Object\.assign\(\{ a: action \}/.test(host));
  ok_('สำเร็จ = {ok:true, data}', /\{ ok: true, data:/.test(host));
  ok_('ล้มเหลว = {ok:false, error:{code,message}}', /ok: false, error: \{ code:/.test(host));
  ok_('batch คืนเป็น array ของผลลัพธ์', /calls\.map\(c => runOne\(/.test(host));
  /* 🔴 GET ต้องไม่ตอบ ok:true — ถ้าตอบ client จะเอา health check ไปใช้เป็นข้อมูล (บั๊ก v186) */
  ok_('🔴 GET ไม่ตอบ ok:true', /service: 'atom-fast-host'/.test(host) && !/service: 'atom-fast-host'[^}]*ok: true/.test(host));
}

// ============================================================================
console.log('\n5) ตัวตนมาจาก token เท่านั้น และรหัสข้อผิดพลาดต้องผ่านออกมา');
{
  const host = R('server/host.js');
  /* ถ้าเชื่อ payload ที่ผู้ใช้ส่งมา ผู้ปกครองคนหนึ่งจะขอดูของอีกคนได้ด้วยการแก้ตัวเลขใน request
   * — กฎเดียวกับ applyIdentity_ ใน Code.gs และต้องมาทีหลัง payload เสมอ */
  ok_('🔴 ตัวตนถูกทับลงบน payload ทีหลัง', /Object\.assign\(\{\}, p, ident\)/.test(host));
  ok_('Parent ได้ parentId · ที่เหลือได้ staffId', /ident\.parentId = sess\.linkedId/.test(host) && /ident\.staffId = sess\.linkedId/.test(host));
  /* รหัสต้องผ่านออกมา ไม่ใช่กลายเป็น INTERNAL ทั้งหมด — เคยพลาดข้อนี้ใน GAS แล้วทำให้
   * การปฏิเสธที่ถูกต้องทุกอันไปโผล่เป็น "ระบบพัง" ในรายงานความเร็ว */
  ok_('รหัสข้อผิดพลาดของเอนจินผ่านออกมา ไม่กลายเป็น INTERNAL', /e\.code \|\| e\.apiCode/.test(host));
  ok_('ไม่มี session → ปฏิเสธ', /code: 'NO_SESSION'/.test(host));
}

// ============================================================================
console.log('\n6) เอนจินตัวเดิม ไม่ใช่สำนวนที่สอง');
{
  const host = R('server/host.js');
  /* ถ้าวันหนึ่งมีใครเขียน handler เป็น SQL/View ที่นี่ จะได้สองสำนวนที่ตอบไม่ตรงกัน
   * ซึ่งเป็นบั๊กที่โปรเจ็กต์นี้เจอซ้ำมาหลายรอบ (ดู atom-two-exporters / atom-slip-document) */
  ok_('เรียก createAtomAPI ตัวเดียวกับที่ GAS ใช้', /require\(path\.join\(__dirname, '\.\.', 'webapp', 'engine\.js'\)\)/.test(host));
  /* ยอมรับทั้ง hydrate และ hydrateFast — ข้อนี้ตรึงว่า M มาจาก pg_engine
   * ไม่ใช่ตรึงว่าเรียกฟังก์ชันชื่อไหน · ส่วนที่ว่าสองทางให้ผลเท่ากันจริง
   * พิสูจน์ที่ tools/test_pg_hydrate_fast.js ซึ่งยิงฐานข้อมูลจริงและเทียบ M ทั้งก้อน */
  ok_('ป้อน M จาก pg_engine', /PG\.hydrate(Fast)?\(client, tenant, ALL_KEYS[,)]/.test(host));
  ok_('เขียนกลับด้วย persist (ทีละแถว ไม่ทับทั้ง collection)', /PG\.persist\(client, tenant, M, snapshot/.test(host));
  ok_('ไม่มี SQL ของตัวเองในไฟล์นี้', !/\bselect\s+\*\s+from\b/i.test(host));
  /* วัดเวลาแยกส่วน — ถ้าไม่มีตัวเลข จะไม่รู้ว่าต้องแก้ตรงไหนตอนไม่ผ่านเป้า */
  ok_('ติดเวลาแยกส่วนกลับไปด้วย (hydrate/run/save)', /x-atom-ms/.test(host) && /hydrate: tHydrate, run: tRun, save: tSave/.test(host));
}

// ============================================================================
console.log('\n7) หนี้ที่รู้ตัว ต้องเขียนไว้ในไฟล์ ไม่ใช่อยู่ในหัวใคร');
{
  const host = R('server/host.js');
  ok_('🔴 เขียนกฎ PDPA ไว้ในไฟล์', /ข้อตกลงประมวลผลข้อมูลจะลงนาม/.test(host));
  ok_('บอกว่ายังไม่ได้ต่อ "ออกจากระบบทุกเครื่อง"', /sessionEpochOf_/.test(host));
  ok_('บอกว่ายังไม่มี publicAction_ / Observer / write lock', /publicAction_/.test(host) && /Observer/.test(host));
  ok_('บอกว่า CORS ยังเปิดกว้าง ต้องล็อกก่อนรับข้อมูลจริง', /ล็อก CORS/.test(host));
}

// ============================================================================
console.log('\n8) การสลับปลายทางฝั่ง client');
{
  const api = R('webapp/api.js');
  /* 🔴 ข้อสำคัญที่สุดของหัวข้อนี้: วันนี้ต้องไม่มีอะไรเปลี่ยน
   * FAST_URL ว่าง = ทุก request ไป GAS เหมือนเดิมทุกประการ
   * ถ้าข้อนี้แดง แปลว่ามีคนเผลอเปิดเส้นเร็วให้ทั้งโรงเรียนโดยไม่ได้ตั้งใจ */
  const m = /FAST_URL: '([^']*)'/.exec(api);
  ok_('🔴 FAST_URL ยังว่างอยู่ (ยังไม่เปิดใช้กับใคร)', !!m && m[1] === '');
  ok_('ว่าง = ไม่สลับ', api.indexOf('if (!CONFIG.FAST_URL) return false;') >= 0);

  /* batch ต้องไปทางเดียวกันทั้งก้อน · ถ้าครึ่งหนึ่งไป Postgres อีกครึ่งไปชีต
   * หน้าจอเดียวจะได้คำตอบจากข้อมูลสองรอบ แล้วไม่มีอะไรบอกว่าอันไหนใหม่กว่า */
  ok_('🔴 batch ไปทางเดียวกันทั้งก้อน', api.indexOf('calls.every(c => FAST_ACTIONS[') >= 0);
  ok_('batch ว่างไม่ถูกสลับ', api.indexOf('calls.length > 0 &&') >= 0);

  /* รายชื่อต้องประกาศ ไม่ใช่เดาจากชื่อ — เหตุผลเดียวกับ READ_ONLY
   * และต้องไม่มีตัวที่เขียนข้อมูลหลุดเข้ามา ตราบใดที่ GAS ยังเขียนชีตอยู่ */
  const fa = api.slice(api.indexOf('const FAST_ACTIONS = {'), api.indexOf('const READ_ONLY = {'));
  const names = [...fa.matchAll(/([a-zA-Z][a-zA-Z0-9]*): 1/g)].map(x => x[1]);
  ok_('มีรายชื่อประกาศไว้จริง (' + names.length + ' ตัว)', names.length >= 20);

  /* 🔴 ตัดสินว่า "เขียนข้อมูลไหม" ด้วยกฎของแอปเอง ไม่ใช่กฎที่ชุดทดสอบคิดขึ้นใหม่
   * เวอร์ชันแรกใช้แค่ regex คำกริยา แล้วมันจับ `payments` เพราะขึ้นต้นด้วย "pay" —
   * ทั้งที่ api.js ประกาศ `payments` ไว้ใน READ_ONLY ด้วยตัวเองว่าเป็นการอ่านล้วน
   * (เหตุผลเดียวกับที่ READ_ONLY มีอยู่: คำกริยาจับพลาด และของที่จับพลาดคือของที่ต้องประกาศ)
   * ชุดทดสอบที่เถียงกับกฎของแอป คือชุดทดสอบที่จะแดงทุกครั้งที่แอปถูกต้อง */
  const ro = api.slice(api.indexOf('const READ_ONLY = {'), api.indexOf('const READ_ONLY = {') + 3000);
  const readOnly = {}; [...ro.matchAll(/([a-zA-Z][a-zA-Z0-9]*): 1/g)].forEach(x => readOnly[x[1]] = 1);
  const MUT = /^(submit|save|add|remove|delete|set|register|pay|upload|confirm|reject|issue|generate|move|export|import|compute|cancel|prepay|link|notify|request|mark|approve|edit|rename|update|change|seed|dedup|reindex)/;
  const writes = names.filter(n => MUT.test(n) && !readOnly[n]);
  eq('🔴 ไม่มี action ที่เขียนข้อมูลอยู่ในรายชื่อ', writes, []);

  /* และของที่ต้องใช้ Drive / LINE / trigger ต้องไม่หลุดเข้ามา เพราะโฮสต์ใหม่ยังไม่มี */
  const NEEDS_GAS = ['uploadSlip', 'submitInjury', 'notifyBills', 'computePayroll', 'backupNow', 'auth', 'ping'];
  eq('ของที่ต้องใช้ Apps Script ไม่อยู่ในรายชื่อ', NEEDS_GAS.filter(n => names.indexOf(n) >= 0), []);
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
