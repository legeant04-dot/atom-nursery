/**
 * tools/test_bill_discount.js — a discount is a DEDUCTION, not something a family pays.
 *   node tools/test_bill_discount.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 THE MONEY BUG, REPORTED BY THE ผอ. 2026-10-19
 *
 * The admin screen has offered a "− ส่วนลด" option for a long time. Nothing ever subtracted what it
 * created. A −฿3,500 half-month discount was swallowed twice over:
 *
 *     if (confirmed >= amt && amt > 0) st = 'PAID';   // amt > 0 is false → it can NEVER settle
 *     Outstanding: Math.max(0, amt - confirmed)       // Math.max(0, −3500) → 0
 *
 * So the row sat in "ค้างชำระ" for ever, reduced nothing, and the parent's payment screen — which
 * lists only items with `out > 0` — dropped it entirely. The school granted the discount and the
 * family was asked for ฿11,500 instead of ฿8,000.
 *
 * 🔴 A SCREEN THAT OFFERS A CHOICE THE ARITHMETIC DOES NOT IMPLEMENT IS NOT A MISSING FEATURE. It
 * is the app inviting the school to do something and then quietly not doing it — and this one asks
 * families for money they do not owe.
 *
 * THE RULE, decided 2026-10-19: the discount comes off the MONTH'S TOTAL (tuition + entrance fee +
 * any other charge) and stops at zero — it does not carry into the next month.
 *
 * 🔴 WHY IT IS ALLOCATED RATHER THAN SUBTRACTED AT THE TOTAL. The parent's screen lets a family
 * tick items one at a time, so a discount that existed only as a line in a sum would let somebody
 * tick the ฿2,000 entrance fee alone against a −฿3,500 discount and owe nothing. Section 3 is that
 * test.
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

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                    'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                    'PaySlips', 'PayAdjust', 'Password', 'Certificate', 'Dspm', 'BillRun',
                    'GasEngine', 'Engine', 'Day6']);

/* THE ผอ.'s OWN EXAMPLE, to the baht: tuition 9,500 + entrance fee 2,000 − discount 3,500 = 8,000.
 * Plus a second child whose discount is bigger than everything owed, which is where "stops at zero"
 * is the rule rather than an opinion. */
const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var MAIN = getMainSpreadsheet_();
  var MM = '2026-10';
  ['S1', 'S2'].forEach(function (sid) {
    appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: sid, Name: 'เด็ก ' + sid, Nickname: sid,
      Class: 'Nursery 2', ParentID: 'P-' + sid, Status: 'ACTIVE', DOB: '2023-01-01', EnrollDate: '2024-01-01' });
  });
  // S1 — the reported case
  appendObject_(sheet_(MAIN, 'BILLING'), { BillingID: 'B1', StudentID: 'S1', Month: MM,
    Amount: 9500, Status: 'UNPAID', Items: JSON.stringify([['ค่าเทอม', 9500]]) });
  appendObject_(sheet_(MAIN, 'STUDENT_CHARGES'), { ChargeID: 'CH-1', StudentID: 'S1', Month: MM,
    Label: 'ค่าธรรมเนียมแรกเข้า', Amount: 2000, Status: 'UNPAID' });
  appendObject_(sheet_(MAIN, 'STUDENT_CHARGES'), { ChargeID: 'CH-2', StudentID: 'S1', Month: MM,
    Label: 'ส่วนลดพิเศษครึ่งเดือน', Amount: -3500, Status: 'UNPAID' });
  // S2 — a discount larger than the whole month
  appendObject_(sheet_(MAIN, 'BILLING'), { BillingID: 'B2', StudentID: 'S2', Month: MM,
    Amount: 5000, Status: 'UNPAID', Items: JSON.stringify([['ค่าเทอม', 5000]]) });
  appendObject_(sheet_(MAIN, 'STUDENT_CHARGES'), { ChargeID: 'CH-3', StudentID: 'S2', Month: MM,
    Label: 'ค่ากิจกรรม', Amount: 1000, Status: 'UNPAID' });
  appendObject_(sheet_(MAIN, 'STUDENT_CHARGES'), { ChargeID: 'CH-4', StudentID: 'S2', Month: MM,
    Label: 'ส่วนลดทุนการศึกษา', Amount: -9000, Status: 'UNPAID' });
  _configCache = null;
  try { CacheService.getScriptCache().removeAll(['cfg', 'col:BILLING', 'col:STUDENT_CHARGES', 'col:STUDENTS']); } catch (e) {}

  var ctx = hydrateLazy_(['students', 'payments', 'studentCharges', 'prepayments', 'paymentSlips']);
  var H = createAtomAPI(ctx.M, null).H;
  function look(sid) {
    var bills = H.payments({ studentId: sid }).filter(function (b) { return String(b.Month).slice(0,7) === '2026-10'; });
    var chs = H.studentCharges({ studentId: sid, month: '2026-10' });
    var b = bills[0] || {};
    return {
      billGross: Number(b.GrossDue || 0), billDue: Number(b.TotalDue || 0),
      billOut: Number(b.Outstanding || 0), billStatus: String(b.Status || ''),
      items: (b.Items || []).map(function (it) { return [String(it[0]), Number(it[1])]; }),
      charges: chs.map(function (c) {
        return { id: c.ChargeID, amt: Number(c.Amount), st: String(c.Status),
          out: Number(c.Outstanding), disc: Number(c.Discount || 0), isDisc: !!c.IsDiscount };
      }),
      // what the family is actually asked to transfer: every payable item's outstanding
      totalAsked: Number(b.Outstanding || 0) + chs.reduce(function (a, c) { return a + Number(c.Outstanding || 0); }, 0)
    };
  }
  return JSON.stringify({ s1: look('S1'), s2: look('S2') });
}));

console.log('\n1) 💰 กรณีที่ ผอ. แจ้ง — 9,500 + 2,000 − 3,500 ต้องเท่ากับ 8,000');
{
  const d = res.s1;
  eq('🔴 ยอดรวมที่ครอบครัวต้องโอน', d.totalAsked, 8000);
  eq('ค่าเทอมเต็มยังแสดงไว้ (ยอดก่อนหักยังอ่านได้)', d.billGross, 9500);
  eq('...บิลหลังหักส่วนลด', d.billDue, 6000);
  /* The discount is spent on the bill FIRST, so the entrance fee is untouched and still reads
   * 2,000 — 6,000 + 2,000 = 8,000. Which item it lands on does not change the total, but it must
   * be DECIDED rather than left to whichever screen asks first. */
  const fee = d.charges.filter(c => c.id === 'CH-1')[0];
  eq('ค่าธรรมเนียมแรกเข้ายังเต็มจำนวน', [fee.amt, fee.out], [2000, 2000]);
  ok_('บิลมีบรรทัด "ส่วนลด −3,500" ให้เห็น', d.items.some(it => /ส่วนลด/.test(it[0]) && it[1] === -3500));
}

console.log('\n2) 🔴 ส่วนลดไม่ใช่รายการที่ต้องจ่าย — ต้องไม่ขึ้น "ค้างชำระ" อีก');
{
  const disc = res.s1.charges.filter(c => c.id === 'CH-2')[0];
  eq('สถานะ', disc.st, 'DISCOUNT');
  eq('🔴 ไม่มียอดค้าง (เดิมค้างตลอดกาล เพราะเงื่อนไข amt > 0)', disc.out, 0);
  ok_('ติดธงว่าเป็นส่วนลด ให้หน้าจอแยกออกได้โดยไม่ต้องเดาจากเครื่องหมาย', disc.isDisc === true);
  eq('ยอดยังเป็นค่าติดลบตามที่แอดมินกรอก', disc.amt, -3500);
}

console.log('\n3) 🔴 ส่วนลดมากกว่าทั้งเดือน → หยุดที่ 0 ไม่ทบไปเดือนหน้า');
{
  const d = res.s2;                                   // 5,000 + 1,000 − 9,000
  eq('ยอดรวมที่ต้องโอน', d.totalAsked, 0);
  eq('บิลเหลือ 0', d.billDue, 0);
  eq('...และถือว่าชำระแล้ว ไม่ใช่ค้างชำระ', d.billStatus, 'PAID');
  const act = d.charges.filter(c => c.id === 'CH-3')[0];
  /* 🔴 THE SPILL-OVER. The school chose "off the month's TOTAL", so once the bill is at zero the
   * rest of the discount has to reach the other charges — otherwise ค่ากิจกรรม would still be owed
   * against a ฿9,000 discount that had only ฿5,000 of bill to spend itself on. */
  eq('ส่วนที่เหลือไหลไปหักค่ากิจกรรมด้วย', [act.amt, act.disc, act.out], [1000, 1000, 0]);
  eq('...และค่ากิจกรรมถือว่าชำระแล้ว', act.st, 'PAID');
  /* ...and the 3,000 that had nothing left to reduce simply stops. Asserted as the TOTAL being 0
   * rather than negative: a month cannot owe a family money, and a credit that silently carried
   * forward would be the school giving away a discount twice. */
  ok_('🔴 ส่วนที่เหลือ 3,000 หายไป ไม่กลายเป็นเครดิตติดลบ', d.totalAsked === 0 && d.billDue >= 0);
}

console.log('\n4) หน้าจอ — ผู้ปกครองต้องเห็นส่วนลด ไม่ใช่แค่ยอดที่ลดลงเฉยๆ');
{
  const app = R('webapp/app.js');
  /* 🔴 It used to be dropped from the picker entirely (the filter keeps only `out > 0`), so a
   * family saw a smaller number with no explanation — which is its own problem: an unexplained
   * discount looks like a billing mistake and generates the phone call it was meant to avoid. */
  ok_('🔴 แสดงบรรทัดส่วนลดในหน้าเลือกรายการ', /kind:'discount'/.test(app) && /หักออกจากรายการด้านบนให้แล้ว/.test(app));
  /* 🔴 เขียนเป็น "ข้ออ้าง" ไม่ใช่ "รูปร่างของบรรทัด" — ของเดิมนับระยะทางจาก <div class="field">
   * ไปถึง 🏷️ ได้ไม่เกิน 200 ตัวอักษร ซึ่งพังทันทีที่ค่า style ยาวขึ้น ทั้งที่ความปลอดภัยไม่ได้เปลี่ยน
   * สิ่งที่ต้องจริงคือ: กิ่งของส่วนลด **ไม่มีช่องติ๊ก** ไม่ใช่ว่ามันสั้นแค่ไหน */
  {
    const a = app.indexOf('? `<div class="field"'), b = app.indexOf(': `<label class="field"');
    const disc = a > -1 && b > a ? app.slice(a, b) : '';
    ok_('🔴 ...แต่ติ๊กไม่ได้ (ไม่มี checkbox) — กันไม่ให้ใช้ส่วนลดซ้ำกับรายการที่ไม่ได้ถูกหัก',
      disc.indexOf('🏷️') > -1 && disc.indexOf('type="checkbox"') === -1);
  }
  ok_('เด็กที่ส่วนลดหักจนหมดแล้ว ไม่ขึ้นหน้า "เลือกรายการที่จะชำระ"',
    /filter\(g=>g\.rows\.some\(r=>!r\.info\)\)/.test(app));
  ok_('หน้าแอดมิน — ส่วนลดขึ้นว่า "หักให้แล้ว" ไม่ใช่ป้ายค้างชำระ',
    /_isDisc[\s\S]{0,120}pill ok">\$\{EN\(\)\?'applied':'หักให้แล้ว'\}/.test(app));
  ok_('...และไม่มีช่องบันทึกรับเงินสดสำหรับส่วนลด', /\(!_isDisc&&cOut>0\)\?cashBox/.test(app));
}

console.log('\n5) การจัดสรรต้องแน่นอน — ถามกี่ครั้งก็ต้องได้เท่าเดิม');
{
  const eng = R('webapp/engine.js');
  ok_('จัดสรรที่เดียว (discountAlloc_) ไม่ใช่ลบตอนรวมยอด', /function discountAlloc_\(studentId, month\)/.test(eng));
  ok_('หักจากบิลก่อน แล้วค่อยไหลไปรายการอื่นตามลำดับ ChargeID',
    /sort\(\(a,b\)=>String\(a\.ChargeID\)\.localeCompare\(String\(b\.ChargeID\)\)\)/.test(eng));
  /* 🔴 The advance-payment credit is taken off BEFORE the discount is allocated, or the same money
   * would be credited twice on a month a family had already paid ahead for. */
  ok_('🔴 หักเครดิตชำระล่วงหน้าออกก่อน แล้วค่อยคิดส่วนลด (กันคิดเครดิตซ้ำ)',
    /const due=Math\.max\(0, Number\(bill\.Amount\|\|0\) - \(pre\?billTuition_\(bill\):0\)\);/.test(eng));
  ok_('ไม่ทบไปเดือนถัดไป — ส่วนที่เหลือถูกบันทึกเป็น unused เฉยๆ', /out\.unused=left;/.test(eng));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
