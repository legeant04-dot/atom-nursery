/**
 * tools/test_closed_routes.js — ประตูที่ปิดแล้ว ต้องปิดจริง และของที่ยังใช้อยู่ต้องไม่ถูกปิดไปด้วย
 *   node tools/test_closed_routes.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 เรื่องที่ชุดนี้มีไว้กัน — พบ 2026-10-24 ตอนทำงาน "ลดพื้นที่ API" ที่ ผอ. สั่ง
 *
 * dispatch_ มี ENGINE_FALLBACK: action ไหนที่ไม่มีใน ROUTES จะตกไปที่ engine โดยอัตโนมัติ
 * แปลว่า **ทุกคีย์ใน H ของ engine คือ API ที่เปิดอยู่จริง** ไม่ว่าจะมีหน้าจอเรียกหรือไม่
 * และด่านเดียวที่กั้นคือ ADMIN_ONLY
 *
 * รันจริงแล้วได้ผลนี้ (ไม่ใช่อ่านโค้ดเดา):
 *     H.getConfig({role:'Parent'}) → ค่าตั้งค่าทั้ง 85 คีย์ รวม SlipOK_ApiKey และ
 *     LineLoginChannelSecret ซึ่งในโค้ดเขียนกำกับไว้เองว่า "NEVER leaves the server"
 *
 * ความผิดพลาดไม่ได้อยู่ที่ไม่มีใครคิดเรื่องนี้ — `schoolConfig` ที่หน้าจอใช้จริงเลือกคืนทีละคีย์
 * อย่างถูกต้องมาตลอด · มันคือ **ประตูเก่าที่ไม่มีใครเดินแล้ว แต่เปิดค้างไว้**
 *
 * 🔴 และการไล่หาว่า "ไม่มีใครเรียก" เกือบพลาดสองครั้ง — ทั้งสองครั้งจะทำให้ระบบพัง:
 *   · parentHomeCore  — ไม่มีหน้าจอเรียก แต่ Auth.gs เรียก engineDispatch_('parentHomeCore')
 *                        ตอนล็อกอิน · ปิดไปคือล็อกอินพังทั้งโรงเรียน
 *   · parentCheckin / staffCheckin — เรียกผ่าน punchWithRetry() ไม่ใช่ api()
 * ชุดนี้จึงตรึง "ของที่ต้องไม่ถูกปิด" ไว้ด้วย ไม่ใช่ตรึงแค่ของที่ปิดแล้ว
 */
const path = require('path'), fs = require('fs');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const code = R('src/Code.gs');

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                    'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                    'PaySlips', 'PayAdjust', 'Password', 'Certificate', 'Dspm', 'BillRun',
                    'GasEngine', 'Engine', 'Day6']);

const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  setConfigValue_('SlipOK_ApiKey', 'SECRET-SLIPOK-1234');
  setConfigValue_('LineLoginChannelSecret', 'SECRET-LINE-5678');
  _configCache = null;
  try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}

  var out = { closed: {}, open: {} };
  // ผ่าน dispatch_ จริง ไม่ได้เรียก H ตรงๆ — เพราะประตูอยู่ที่ dispatch_
  function call(action, payload) {
    var raw = dispatch_(action, payload || {}, null);
    var txt = (raw && raw.getContent) ? raw.getContent() : String(raw);
    try { return JSON.parse(txt); } catch (e) { return { ok: false, parse: txt.slice(0, 80) }; }
  }
  ['getConfig', 'getConfigVal', 'staffAuth', 'findStudentByNationalID', 'allChats',
   'saveParentSelf', 'adminInbox', 'moveTeacher'].forEach(function (a) {
    var r = call(a, { key: 'SlipOK_ApiKey', nationalId: '1234567890123' });
    out.closed[a] = (r && r.error && r.error.code) || (r && r.ok ? 'ANSWERED' : 'other');
  });
  // ...และของที่ต้องยังเปิดอยู่
  ['restoreSheet', 'listBackups', 'lineDiag', 'checkDuplicateIds'].forEach(function (a) {
    var r = call(a, {});
    out.open[a] = (r && r.error && r.error.code) || (r && r.ok ? 'ANSWERED' : 'other');
  });
  // ความลับยังอ่านได้จากข้างในเซิร์ฟเวอร์ตามปกติ — ที่ปิดคือทางเข้าจากข้างนอก
  out.secretStillReadableInternally = String(getConfig_('SlipOK_ApiKey', '')) === 'SECRET-SLIPOK-1234';
  // และ schoolConfig ซึ่งหน้าจอใช้จริง ต้องไม่รั่ว
  var ctx = hydrateLazy_(''); var H = createAtomAPI(ctx.M, null).H;
  var safe = H.schoolConfig({ role: 'Parent' });
  out.schoolConfigKeys = Object.keys(safe || {}).length;
  out.schoolConfigLeaks = !!((safe || {}).SlipOK_ApiKey || (safe || {}).LineLoginChannelSecret);
  return JSON.stringify(out);
}));

console.log('\n1) 🔴 ประตูที่ปิดแล้ว ต้องตอบเหมือนไม่เคยมีอยู่');
{
  const closed = Object.keys(res.closed);
  const notClosed = closed.filter(a => res.closed[a] !== 'UNKNOWN_ACTION');
  eq('🔴 route ที่ปิดแล้วยังตอบอยู่', notClosed, []);
  /* UNKNOWN_ACTION ไม่ใช่ NO_PERMISSION โดยตั้งใจ — คำตอบว่า "มีอยู่ แต่คุณไม่มีสิทธิ์"
   * คือการยืนยันให้คนนอกรู้ว่ามีอะไรอยู่ตรงนั้น */
  ok_('...ด้วย UNKNOWN_ACTION ไม่ใช่ NO_PERMISSION (ไม่ยืนยันว่ามีอยู่)',
    /UNKNOWN_ACTION/.test(code) && !/CLOSED_ROUTES_\[action\][\s\S]{0,300}NO_PERMISSION/.test(code));
  ok_('...และบันทึกไว้ว่ามีคนพยายามเรียก', /CLOSED_ROUTE_CALLED/.test(code));
}

console.log('\n2) 🔴 ความลับของโรงเรียนไม่ออกไปทางนี้อีกแล้ว');
{
  eq('getConfig ถูกปิด', res.closed.getConfig, 'UNKNOWN_ACTION');
  eq('getConfigVal ถูกปิด', res.closed.getConfigVal, 'UNKNOWN_ACTION');
  ok_('🔴 ...แต่เซิร์ฟเวอร์ยังอ่านค่าของตัวเองได้ตามปกติ', res.secretStillReadableInternally);
  ok_('schoolConfig ที่หน้าจอใช้จริง ยังทำงานและไม่รั่ว',
    res.schoolConfigKeys >= 20 && res.schoolConfigLeaks === false);
}

console.log('\n3) 🔑 ของที่ไม่มีหน้าจอเรียก แต่ต้องเปิดไว้ — ห้ามปิดไปด้วย');
{
  /* restoreSheet / listBackups คือเส้นทางกู้ข้อมูลตอนฉุกเฉิน และเป็นสิ่งที่ต้องเรียกได้
   * ตอนที่หน้าจอนั่นแหละคือสิ่งที่พัง · ปิดมันคือการเอาถังดับเพลิงออกเพราะไม่มีใครใช้ */
  Object.keys(res.open).forEach(a =>
    ok_('ยังเปิดอยู่: ' + a, res.open[a] !== 'UNKNOWN_ACTION'));
  ok_('🔑 ...และมีเหตุผลเขียนกำกับไว้ว่าทำไมไม่ปิด',
    /restoreSheet · listBackups  เส้นทางกู้ข้อมูลตอนฉุกเฉิน/.test(code));
}

console.log('\n4) 🔴 ของที่ไม่มีหน้าจอเรียก แต่ระบบเรียกเอง — ต้องไม่ถูกปิด');
{
  /* เกือบพลาดจริงตอนไล่รายการ: ทั้งสองตัวนี้ไม่มี api('x') ที่ไหนเลย */
  ok_('🔴 parentHomeCore ไม่อยู่ในรายการปิด (Auth.gs เรียกตอนล็อกอิน)',
    !/\n  parentHomeCore:/.test(code.slice(code.indexOf('var CLOSED_ROUTES_'), code.indexOf('var ROUTES = {'))));
  ok_('🔴 parentCheckin / staffCheckin ไม่อยู่ในรายการปิด (เรียกผ่าน punchWithRetry)',
    !/parentCheckin:/.test(code.slice(code.indexOf('var CLOSED_ROUTES_'), code.indexOf('var ROUTES = {'))) &&
    !/\n  staffCheckin:/.test(code.slice(code.indexOf('var CLOSED_ROUTES_'), code.indexOf('var ROUTES = {'))));
  ok_('ทุกประตูที่ปิด มีเหตุผลเขียนไว้เป็นข้อความ ไม่ใช่แค่ 1',
    !/^\s{2}[a-zA-Z][a-zA-Z0-9_]*:\s*1,?\s*$/m.test(
      code.slice(code.indexOf('var CLOSED_ROUTES_'), code.indexOf('var ROUTES = {'))));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
