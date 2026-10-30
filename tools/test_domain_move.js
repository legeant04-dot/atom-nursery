/**
 * tools/test_domain_move.js — รุ่นส่งมอบก่อนย้ายโดเมน
 *   node tools/test_domain_move.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * ผอ. 2026-10-22: จะจด `atomnursery.co.th` แล้วย้ายระบบของโรงเรียนไปอยู่บนโดเมนของตัวเอง
 * โฮสต์ยังเป็น GitHub Pages เหมือนเดิม — เปลี่ยนแค่ชื่อที่ผู้ใช้พิมพ์
 *
 * 🔴 แต่ระหว่างผู้ปกครองกับเครือข่าย มี service worker คั่นอยู่ และมันเปลี่ยนทุกสมมติฐาน
 *
 *   ① เครื่องที่ติดตั้งแอปไว้แล้ว มี SW ที่เสิร์ฟของจาก cache — **เราไล่แก้ทีละเครื่องไม่ได้**
 *      สิ่งเดียวที่เข้าถึงเขาได้คือรุ่นที่ปล่อยออกไป *ก่อน* ย้าย
 *
 *   ② และข้อที่อันตรายกว่า: ถ้า SW คืน response ที่ "ถูก redirect มาแล้ว" ให้การเปิดหน้า
 *      **เบราว์เซอร์จะปฏิเสธตามสเปก และผู้ปกครองจะเห็นหน้าขาว**
 *      ซึ่งจะเกิดขึ้นพอดีในวินาทีที่เราชี้โดเมนแล้ว GitHub เริ่มตอบ 301
 *
 * ชุดทดสอบนี้จึงตรึง 2 อย่าง: **ตัวกันหน้าขาวต้องทำงานตลอดเวลา** และ **สวิตช์ย้ายต้องปิดอยู่
 * จนกว่าจะถึงวันนั้น และต้องปิด/เปิดพร้อมกันทั้งสองไฟล์**
 */
const path = require('path'), fs = require('fs');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const sw = R('webapp/sw.js'), app = R('webapp/app.js');

const swTarget  = (sw.match(/^const MIGRATE_TO = '([^']*)';/m)  || [])[1];
const appTarget = (app.match(/^  const MIGRATE_TO = '([^']*)';/m) || [])[1];

console.log('\n1) 🔴 สองครึ่งต้องตรงกันเสมอ');
{
  /* ต้องมีสองครึ่งเพราะมีผู้ใช้สองแบบ: แอปที่ติดตั้งแล้ว (SW พาไป) และเบราว์เซอร์ธรรมดา
   * (โค้ดในหน้าเว็บพาไป) · ถ้าเปิดครึ่งเดียว จะมีผู้ปกครองกลุ่มหนึ่งค้างอยู่โดยไม่มีใครรู้ */
  ok_('webapp/sw.js มีสวิตช์ MIGRATE_TO', swTarget !== undefined);
  ok_('webapp/app.js มีสวิตช์ MIGRATE_TO', appTarget !== undefined);
  eq('🔴 ค่าทั้งสองไฟล์ตรงกัน', swTarget, appTarget);
}

console.log('\n2) 🔴 ตัวกัน "หน้าขาว" ต้องทำงานตลอดเวลา ไม่ขึ้นกับสวิตช์');
{
  /* นี่คือเหตุผลที่รุ่นนี้ต้องออก *ก่อน* วันย้าย — ไม่ใช่พร้อมกัน
   * เครื่องที่ยังไม่ได้รับบรรทัดนี้ จะเห็นหน้าขาวในวินาทีที่เซิร์ฟเวอร์เริ่ม 301 */
  ok_('🔴 SW แปลง response ที่ถูก redirect แล้ว ให้เป็น redirect จริง',
    /if \(res && res\.redirected && res\.url\) return Response\.redirect\(res\.url, 302\);/.test(sw));
  /* ตัดคอมเมนต์ออกก่อนตรวจ — คำว่า MIGRATE_TO ถูกพูดถึงในคำอธิบายของบล็อกนี้ด้วย และถ้าไม่ตัด
   * ข้อนี้จะ FAIL เพราะ "มีคนเขียนอธิบายไว้" ไม่ใช่เพราะโค้ดผิด (ร้องหมาป่าใส่ตัวเอง) */
  const _code = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const guard = _code(sw.slice(sw.indexOf('if (isHTML) {'), sw.indexOf('if (isHTML) {') + 1400));
  ok_('🔴 ...และไม่ได้ถูกครอบด้วยเงื่อนไข MIGRATE_TO', !/MIGRATE_TO/.test(guard));
  ok_('ไม่เก็บ response ที่ถูก redirect ลง cache (มันคือสำเนาของที่อยู่เก่า)',
    /if \(!res \|\| !res\.ok \|\| res\.redirected\) return res;/.test(sw));
}

console.log('\n3) 🚚 พฤติกรรมตอนเปิดสวิตช์');
{
  ok_('ส่งต่อทุกการเปิดหน้า พร้อม path และ query เดิม',
    /Response\.redirect\(MIGRATE_TO \+ url\.pathname \+ url\.search, 302\)/.test(sw));
  /* ลิงก์จาก LINE และ QR แผ่นเก่ามี path/query ติดมาด้วย — ถ้าตัดทิ้ง ผู้ปกครองจะไปโผล่หน้าแรก
   * แทนที่จะเป็นหน้าที่เขากดมา */
  ok_('ฝั่งหน้าเว็บก็ส่งต่อพร้อม path/query/hash',
    /location\.replace\(MIGRATE_TO \+ location\.pathname \+ location\.search \+ location\.hash\)/.test(app));
  ok_('ย้ายแล้วล้าง cache ทิ้งทั้งหมด ไม่เหลือของเก่าให้เสิร์ฟ',
    /ks\.filter\(k => MIGRATE_TO \|\| k !== CACHE\)/.test(sw));
  /* 🔴 ใช้ replace ไม่ใช่ href — ที่อยู่เก่าต้องไม่ค้างในประวัติ ให้ปุ่มย้อนกลับพาวนกลับมาที่เดิม */
  ok_('🔴 ใช้ location.replace ไม่ใช่ location.href', /location\.replace\(MIGRATE_TO/.test(app) && !/location\.href = MIGRATE_TO/.test(app));
  /* 🔴 SW ไม่ถอนตัวเอง — ถ้าถอน มันจะหมดความสามารถในการส่งต่อด้วย และวันที่เซิร์ฟเวอร์เดิม
   * หยุด 301 (repo ถูกลบ / Pages ถูกปิด) เครื่องที่ยังติดตั้งอยู่จะเข้าไม่ได้ถาวร */
  ok_('🔴 SW ไม่ถอนตัวเอง — มันอยู่ต่อในฐานะป้ายบอกทาง',
    !/registration\.unregister\(\)/.test(sw) && /ไม่.?ถอนตัวเอง|ป้ายบอกทาง/.test(sw));
}

console.log('\n4) 🔴 สวิตช์ต้องยังปิดอยู่ จนกว่าโดเมนใหม่จะใช้งานได้จริง');
{
  /* ถ้าเปิดก่อนโดเมนพร้อม ผู้ปกครองทั้งโรงเรียนจะถูกส่งไปยังที่ที่ไม่มีอยู่ — และรับรุ่นแก้ไม่ได้
   * เพราะถูกส่งออกไปแล้ว · ข้อนี้จะฟ้องเตือนตอนที่มีคนเผลอ commit ค่าที่เปิดไว้ */
  if (swTarget === '') { eq('ปิดอยู่ (ยังไม่ถึงวันย้าย)', swTarget, ''); }
  else {
    console.log('  ⚠️  สวิตช์ถูกเปิดไว้ที่ ' + JSON.stringify(swTarget) + ' — ตรวจว่าทำครบขั้น 1-7 ใน docs/DOMAIN_MOVE.md แล้วจริง');
    ok_('ถ้าเปิดแล้ว ต้องเป็น https:// และไม่มี / ปิดท้าย', /^https:\/\/[^/]+$/.test(swTarget));
    pass++;
  }
}

console.log('\n5) 🔴 สวิตช์ต้องรอดจากการ minify — ไม่ใช่แค่มีอยู่ในซอร์ส');
{
  /* 🔴 ข้อนี้มีเพราะของจริงเกือบหลุด
   *
   * ตอน MIGRATE_TO = '' (ปิดอยู่) esbuild **ลบบล็อก redirect ทิ้งทั้งก้อน** เพราะมันเป็น dead code
   * ซึ่งถูกต้องสำหรับวันนี้ — แต่แปลว่าเราไม่มีทางรู้จากไฟล์ที่ build แล้วว่า "วันที่เปิดสวิตช์
   * มันจะยังอยู่ไหม" และถ้ามันถูกลบทั้งสองสถานะ **สวิตช์นี้จะไม่เคยทำงานเลย โดยไม่มีใครรู้**
   *
   * จึงรัน minifier ตัวเดียวกับที่ build_web.js ใช้ บนสำเนาที่เปิดสวิตช์ไว้ แล้วพิสูจน์ว่า
   * ปลายทางและคำสั่ง redirect ยังอยู่ · ไม่แตะไฟล์จริงและไม่แตะ dist_pages
   */
  let esbuild = null;
  try { esbuild = require('esbuild'); } catch (e) {}
  if (!esbuild) { console.log('  ⚠️  ข้ามข้อนี้ — ไม่มี esbuild ในเครื่องนี้'); }
  else {
    const TEST_TARGET = 'https://example.invalid';
    const min = src => esbuild.transformSync(
      src.replace(/const MIGRATE_TO = '';/, "const MIGRATE_TO = '" + TEST_TARGET + "';"),
      { loader: 'js', minify: true, target: 'es2019', legalComments: 'none', charset: 'utf8' }).code;
    const swMin = min(sw), appMin = min(app);
    ok_('🔴 sw.js: ปลายทางยังอยู่หลัง minify', swMin.indexOf(TEST_TARGET) >= 0);
    ok_('🔴 sw.js: คำสั่งส่งต่อยังอยู่', /Response\.redirect\(/.test(swMin));
    ok_('🔴 app.js: ปลายทางและ location.replace ยังอยู่',
      appMin.indexOf(TEST_TARGET) >= 0 && /location\.replace\(/.test(appMin));
    /* ...และตอนปิด บล็อกส่งต่อต้องถูกตัดออกจริง (ตัวค่าคงที่ยังอยู่ ซึ่งไม่เป็นไร)
     *
     * 🔴 แต่ตัวกัน "หน้าขาว" ต้องยังอยู่ — ถ้าข้อนี้หายไปตอนปิดสวิตช์ด้วย แปลว่าเราปล่อยรุ่น
     * ส่งมอบที่ไม่ได้ส่งมอบอะไรเลย และจะรู้ตัวก็ต่อเมื่อผู้ปกครองเปิดแอปไม่ขึ้นแล้ว */
    const offMin = esbuild.transformSync(sw, { loader: 'js', minify: true, target: 'es2019' }).code;
    ok_('ตอนปิดสวิตช์ บล็อกส่งต่อถูกตัดออกจากไฟล์ที่ส่งให้ผู้ใช้', !/Response\.redirect\(MIGRATE_TO/.test(offMin));
    ok_('🔴 ...แต่ตัวกันหน้าขาวยังอยู่ (นี่คือทั้งหมดของรุ่นส่งมอบ)', /Response\.redirect\(/.test(offMin));
  }
}

console.log('\n6) 📋 เอกสารขั้นตอนต้องมีอยู่จริง และบอกลำดับที่ห้ามสลับ');
{
  const doc = R('docs/DOMAIN_MOVE.md');
  ok_('มี docs/DOMAIN_MOVE.md', doc.length > 1000);
  ok_('🔴 บอกชัดว่าเปิดสวิตช์หลังโดเมนใช้งานได้จริงแล้วเท่านั้น', /หลัง\*\* โดเมนใหม่ใช้งานได้จริง/.test(doc));
  ok_('มีขั้นตอนแก้ LIFF และ Google OAuth', /LIFF/.test(doc) && /OAuth/.test(doc));
  ok_('มีแผนถอย', /ถ้าต้องถอย/.test(doc));
  /* ของที่ฝังชื่อโดเมนเดิมไว้ ต้องถูกไล่เก็บ ไม่งั้นมันจะเงียบๆ ชี้ไปที่เก่าตลอดไป */
  ok_('ไล่เก็บที่ฝังชื่อโดเมนเดิมไว้ (โปสเตอร์ QR · workflow · APK)',
    /QR_Poster/.test(doc) && /android\.yml/.test(doc) && /APK/.test(doc));
}

console.log('\n7) 🔴 CNAME ต้องอยู่ใน webapp/ ไม่ใช่รากรีโป');
{
  /* GitHub Pages ของเราปล่อยด้วย Actions และอัปโหลดเฉพาะ dist_pages/ เป็น artifact
   * ส่วน build_web.js ขึ้นต้นด้วย fs.rmSync(OUT) — ลบ dist_pages ทิ้งทั้งโฟลเดอร์ทุกครั้งที่ build
   *
   * 🔴 ไฟล์ CNAME ที่วางไว้ใน dist_pages/ จึงหายไปในรุ่นถัดไป
   * และถ้าตั้ง Custom domain ผ่านหน้าเว็บ GitHub มันจะ commit CNAME ไว้ที่ **รากรีโป**
   * ซึ่งไม่ได้ถูกอัปโหลดไปกับ artifact เลย
   *
   * ทั้งสองทางให้ผลเดียวกัน: โดเมนใช้ได้ในวันแรก แล้ว **หลุดเงียบๆ ตอนปล่อยรุ่นถัดไป**
   * — ความพังชนิดที่เจอตอนที่ไม่มีใครมองแล้ว
   *
   * ที่ถูกคือวางที่ webapp/CNAME — walk() ใน build_web.js คัดลอกทุกไฟล์ใน webapp/ ไปให้เอง */
  const ROOT_ = require('path').join(__dirname, '..');
  const atRoot = fs.existsSync(require('path').join(ROOT_, 'CNAME'));
  const atWebapp = fs.existsSync(require('path').join(ROOT_, 'webapp', 'CNAME'));
  ok_('🔴 ไม่มี CNAME ที่รากรีโป (ถ้ามี = ตั้งผ่านหน้าเว็บ GitHub แล้วมันไปไม่ถึง artifact)', !atRoot);
  if (atWebapp) {
    const host = R('webapp/CNAME').trim();
    ok_('CNAME มีชื่อโดเมนเดียว ไม่มี https:// และไม่มี /', /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host));
    /* ถ้าสวิตช์ถูกเปิดแล้ว ปลายทางที่เราส่งคนไปต้องเป็นโดเมนเดียวกับที่ Pages ให้บริการ
     * ไม่งั้นเราจะส่งทั้งโรงเรียนไปยังที่อยู่ที่ไม่มีใครโฮสต์อยู่ */
    if (swTarget) ok_('🔴 ปลายทางของสวิตช์ตรงกับโดเมนใน CNAME',
      String(swTarget).replace(/^https?:\/\//, '').replace(/\/$/, '') === host);
    else console.log('  --   ยังไม่ได้เปิดสวิตช์ — ข้ามการเทียบปลายทาง');
  } else {
    console.log('  --   ยังไม่มี webapp/CNAME — ยังไม่ได้ผูกโดเมน (ถูกต้องสำหรับตอนนี้)');
  }
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
