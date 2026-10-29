/**
 * tools/test_payroll_pull_slip.js — ดึงข้อมูลเดือนที่แล้ว · และการบังคับแนบสลิป
 *   node tools/test_payroll_pull_slip.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * ผอ. 2026-10-29 (ถามก่อนลงมือ ได้คำตอบครบแล้วจึงทำ):
 *   · "เพิ่มปุ่ม ดึงข้อมูลเดือนที่แล้ว ... เช่น มีรายการหักที่เคยสร้างขึ้น ให้นำมาสร้างให้เลย"
 *   · "เพิ่มช่อง Check Box แนบสลิป ... โรงเรียนอื่นในการโอนแบบตั้งเวลา จะไม่สะดวกในการแนบสลิป"
 *
 * 🔴 เรื่องเงิน · ชุดนี้จึงตรึง **สิ่งที่ต้องไม่ถูกดึงมา** หนักกว่าสิ่งที่ถูกดึง
 * เพราะความเสียหายของการดึงผิดคือการจ่ายเงินตามตัวเลขของเดือนก่อน ซึ่งไม่มีใครเห็นจนกว่าจะสาย
 */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  console.log((okk ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (okk ? '' : ' want=' + JSON.stringify(want)));
  okk ? pass++ : fail++;
}
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), eng = R('webapp/engine.js'), gasEng = R('src/Engine.gs');
const cfgGs = R('src/Config.gs'), staffGs = R('src/Staff.gs'), onb = R('src/Onboarding.gs');
const pull = app.slice(app.indexOf('window.A_pullLastMonth'), app.indexOf('window.A_addAdj'));

console.log('1) ⟲ ดึงข้อมูลเดือนที่แล้ว');
{
  ok_('มีปุ่มอยู่มุมขวาบนของหน้าเงินเดือน', /id="pPullBtn" onclick="A_pullLastMonth\(this\)"/.test(app));
  ok_('ต้องเลือกคนก่อน', /if\(!sid\)\{ notify\('warn'/.test(pull));
  ok_('อ่านสลิปของเดือนก่อนหน้าด้วย getPayslip', /api\('getPayslip',\{staffId:sid,month:prev\}\)/.test(pull));
  /* 🔴 ครึ่งที่สำคัญที่สุดของข้อนี้ — ดึงเฉพาะรายการเพิ่ม/หัก
   * ของอย่างอื่นที่ซ้ำทุกเดือน (เงินเดือน เรท เบี้ยขยัน เงินสมทบ) อยู่ที่ตัวพนักงาน
   * และ payrollConfig เติมให้เองตั้งแต่เลือกคน · การดึงมาทับซ้ำคือการรื้อค่าที่อาจถูกปรับไปแล้ว */
  ok_('🔴 เขียนค่าลงฟอร์มแค่ที่เดียว คือ PAY_ADJ', (pull.match(/PAY_ADJ\s*=/g) || []).length === 1);
  const sets = (pull.match(/\$\('#p\w+'\)\.value\s*=/g) || []);
  eq('🔴 ...และไม่แตะช่องอื่นในฟอร์มเลย', sets, []);
  /* ข้อเท็จจริงของเดือนนี้ ห้ามถูกดึงมาเด็ดขาด */
  ['pOt', 'pOtHol', 'pDays', 'pChild', 'pCert', 'pHb', 'pBase'].forEach(id =>
    ok_('🔴 ...ไม่แตะ #' + id, pull.indexOf("'#" + id + "'") < 0));
  ok_('ถามก่อนทับของที่กรอกไว้แล้ว', /PAY_ADJ\.filter\(a=>a\.label\|\|a\.amount\)\.length &&\s*\n?\s*!confirm\(/.test(pull));
  ok_('🔴 ...และบอกว่าอะไรไม่ได้ถูกดึงมา', /OT จำนวนวันทำงาน และจำนวนเด็ก ไม่ได้ถูกดึงมา/.test(pull));
  ok_('เดือนก่อนหน้าคำนวณจากช่องเดือนบนฟอร์ม ไม่ใช่จากวันนี้', /\$\('#pMonth'\)\.value\|\|monthStr\(\)/.test(pull));
  /* เดือนที่แล้วไม่มีรายการ = บอกตรง ๆ ไม่ใช่เงียบแล้วทำเหมือนสำเร็จ */
  ok_('ไม่มีรายการให้ดึง ก็บอก', /if\(!rows\.length\)\{ notify\('info'/.test(pull));
}

console.log('\n2) 📎 ต้องแนบสลิป — ตั้งค่าระดับโรงเรียน + ติ๊กรายคนได้');
{
  /* ปิดเป็นค่าเริ่มต้น = โรงเรียนที่ใช้อยู่ตอนนี้ไม่รู้สึกว่ามีอะไรเปลี่ยน */
  ok_("🔴 seed เป็น 'false' — พฤติกรรมเดิมทุกประการ", /\['RequireSalarySlip',\s*'false'\]/.test(cfgGs));
  ok_('อยู่ในรายการที่แอดมินแก้ได้ (ฝั่ง GAS)', /RequireSalarySlip: 1/.test(staffGs));
  ok_('...และฝั่ง engine ด้วย', /RequireSalarySlip:1\}/.test(eng));
  /* 🔴 สองรายชื่อที่ตัดสินเรื่องเดียวกัน ถ้าไม่ตรงกันคือบันทึกได้แต่อ่านกลับไม่ได้ (กับดัก 2026-09-03) */
  ok_('🔴 ...และเซิร์ฟเวอร์ส่งค่ากลับมาได้ ไม่งั้นติ๊กแล้วเด้งกลับ', /RequireSalarySlip:cfg\.RequireSalarySlip/.test(eng));
  ok_('Engine ที่ build แล้วมีด้วย', /RequireSalarySlip:cfg\.RequireSalarySlip/.test(gasEng));
  /* วิธีโอนเงินเดือนเป็นเรื่องของแต่ละโรงเรียน ไม่ใช่ค่าที่ถูกสำหรับทุกที่ */
  ok_('เป็นคีย์ที่โรงเรียนใหม่ต้องยืนยันตอน onboarding', /RequireSalarySlip:\s*'CONFIRM'/.test(onb));
  ok_('มีสวิตช์ในหน้าตั้งค่าการเงิน', /id="setReqSlip"/.test(app) && /\['RequireSalarySlip','#setReqSlip'\]/.test(app));
  ok_('มีช่องติ๊กรายคนตอนบันทึกว่าจ่ายแล้ว', /id="fsNeedSlip"/.test(app));
  ok_('...ซึ่งตั้งต้นจากค่าของโรงเรียน', /const _needSlip=String\(\(_schoolCfg\|\|\{\}\)\.RequireSalarySlip\|\|'false'\)/.test(app));

  /* 🔴 ด่านต้องอยู่ที่ตอนบันทึก ไม่ใช่แค่ข้อความเตือน */
  const sp = app.slice(app.indexOf('window.A_salaryPaid='), app.indexOf('window.A_salaryPaid=') + 2200);
  ok_('🔴 ติ๊กไว้แล้วไม่มีสลิป = บันทึกไม่ผ่าน', /if\(need&&need\.checked&&!slipUrl\)\{/.test(sp) && /return; \} \}/.test(sp));
  ok_('🔴 ...และบอกทางออกทั้งสองทาง (แนบ หรือ เอาติ๊กออก)', /หรือเอาเครื่องหมายถูกที่ "ต้องแนบสลิปโอน" ออก/.test(sp));
  /* ไม่ติ๊ก = ไม่ถาม ไม่เตือน — โรงเรียนที่โอนแบบตั้งเวลาไม่มีสลิปรายคนให้แนบ */
  ok_('ไม่ติ๊ก = ไม่มีด่านอะไรเลย', !/if\(!slipUrl\)[^\n]*return/.test(sp.replace(/need&&need\.checked&&/, '')));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
