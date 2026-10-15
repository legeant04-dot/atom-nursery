/**
 * tools/test_slip_service_error.js — a refusal aimed at OUR account is not a verdict on the
 * family's slip.
 *   node tools/test_slip_service_error.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 THE BUG, AND IT WAS LIVE FOR TWO DAYS
 *
 * handleVerifySlip returned `available: true` for ANY reply that arrived and parsed — including
 * SlipOK saying "your API key is wrong" (1002), "your branch does not exist" (1001) and "your
 * package has expired" (1003/1015). paySlipVerify_ read `available` as "SlipOK has judged this
 * slip", so it wrote `NO:1002` onto the PARENT'S payment row, and the admin's screen listed it
 * under "⚠️ SlipOK ทักท้วง".
 *
 * A family's genuine bank transfer, marked as objected-to, because of OUR configuration.
 *
 * Measured on live: the school's SlipOK key was the notification reference instead of the branch
 * API key. 14/10 → 153 slips, 142 objected. 15/10 → 159 slips, 148 objected. Six slips arrived in
 * two days and all six were marked, while SlipOK had not looked at a single one of them.
 *
 * 🔴 AND IT IS WORSE THAN A WRONG LABEL. "NO" is a judgement that has been made, so nobody revisits
 * it; "" is "not checked yet", which is the only state a slip can be re-checked from once the
 * account is fixed. Getting this wrong does not just mislabel a payment — it buries it.
 *
 * The split is DECLARED, never inferred from the number or the wording: codes about the ACCOUNT say
 * nothing about the slip, codes about the SLIP must still be recorded.
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

/* Every answer SlipOK can give, put through the real code path. The two groups are the point: the
 * first says something about OUR account, the second says something about the SLIP. */
const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  setConfigValue_('SlipOK_Url', 'https://api.slipok.com/api/line/apikey/70537');
  setConfigValue_('SlipOK_ApiKey', 'SLIPOKTESTKEY');
  _configCache = null;
  try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}

  function answer(http, body) {
    UrlFetchApp.fetch = function () {
      return { getResponseCode: function () { return http; },
        getContentText: function () { return JSON.stringify(body); } };
    };
    var v = handleVerifySlip({ qrData: 'QR', amount: 100, log: false });
    // ...and what the PAYMENT ROW would end up saying, which is the thing families see
    var row = paySlipVerify_({ qrData: 'QR', slipAmount: 100 }, 100);
    return { serviceError: !!v.serviceError, available: !!v.available, ok: !!v.ok,
      verified: String(row.verified) };
  }

  return JSON.stringify({
    // ── about OUR ACCOUNT — none of these looked at the slip ──
    badBranch:  answer(200, { success: false, code: 1001, message: 'ไม่พบสาขา' }),
    badKey:     answer(200, { success: false, code: 1002, message: 'Authorization Header ไม่ถูกต้อง' }),
    expired:    answer(200, { success: false, code: 1003, message: 'Package ของคุณหมดอายุแล้ว' }),
    unpaid:     answer(200, { success: false, code: 1015, message: 'ยังไม่ชำระเงิน' }),
    http401:    answer(401, { success: false }),
    http500:    answer(500, { success: false }),
    /* 🔴 code 1002 WITH NO MESSAGE AT ALL — the shape the live failure actually had. The client used
     * to decide "is this about the school?" by matching words in the message, so an empty message
     * fell through and a family would have been shown a raw refusal about their own transfer. */
    badKeyQuiet: answer(200, { success: false, code: 1002 }),

    // ── about the SLIP — these ARE verdicts and must still be recorded ──
    noTxn:      answer(200, { success: false, code: 1011, message: 'ไม่พบรายการ' }),
    duplicate:  answer(200, { success: false, code: 1012, message: 'สลิปนี้เคยใช้แล้ว' }),
    wrongAmt:   answer(200, { success: false, code: 1013, message: 'ยอดไม่ตรง' }),
    wrongRcv:   answer(200, { success: false, code: 1014, message: 'บัญชีผู้รับไม่ตรง' }),
    good:       answer(200, { success: true, data: { amount: 100, transRef: 'T1' } })
  });
}));

console.log('\n1) 🔴 SlipOK ปฏิเสธ "เรา" — ห้ามบันทึกเป็นคำตัดสินของสลิปผู้ปกครอง');
['badBranch', 'badKey', 'expired', 'unpaid', 'http401', 'http500', 'badKeyQuiet'].forEach(k => {
  const r = res[k];
  ok_('  ' + k + ' → ถือเป็นปัญหาของบัญชีเรา', r.serviceError === true);
  /* '' = "ยังไม่ได้ตรวจ" — which is both the truth and the only state the slip can be re-checked
   * from. 'NO:1002' is a judgement, and nobody revisits a judgement. */
  eq('  ' + k + ' → แถวการชำระเงินยังว่าง (ยังไม่ได้ตรวจ)', r.verified, '');
});

console.log('\n2) 🔴 SlipOK ตัดสิน "สลิป" — ต้องบันทึกไว้เหมือนเดิม');
[['noTxn', 'NO:1011'], ['duplicate', 'NO:1012'], ['wrongAmt', 'NO:1013'], ['wrongRcv', 'NO:1014']]
  .forEach(([k, want]) => {
    ok_('  ' + k + ' → ไม่ใช่ปัญหาของบัญชีเรา', res[k].serviceError === false);
    eq('  ' + k + ' → ยังบันทึกคำตัดสินไว้', res[k].verified, want);
  });
eq('สลิปแท้ → YES', res.good.verified, 'YES');
ok_('...และไม่ถูกนับเป็นปัญหาบัญชี', res.good.serviceError === false);

console.log('\n2b) 🔴 ปิดการตรวจล่วงหน้าได้ — ครึ่งหนึ่งของโควตา โดยไม่มีอะไรเหลือไม่ได้ตรวจ');
{
  /* Every slip costs TWO SlipOK calls: the parent's screen pre-checks on attach (log:false) and the
   * server verifies on submit (log:true). On the free package's 100 calls a month that is fifty
   * slips, not a hundred — which is how the school reached 0/100 and every transfer stopped being
   * verified (15/10/2569, code 1003).
   *
   * The switch gives up the CONVENIENCE half and keeps the half that decides anything. Asserted as
   * exactly that: with it off, the pre-check makes no call AND the submit-time check still does. */
  const q = JSON.parse(run(function () {
    _configCache = null; setupAll(); _configCache = null;
    setConfigValue_('SlipOK_Url', 'https://api.slipok.com/api/line/apikey/70537');
    setConfigValue_('SlipOK_ApiKey', 'SLIPOKTESTKEY');
    var calls = 0;
    UrlFetchApp.fetch = function () { calls++;
      return { getResponseCode: function () { return 200; },
        getContentText: function () { return JSON.stringify({ success: true, data: { amount: 100, transRef: 'T1' } }); } }; };
    function count(pre) {
      setConfigValue_('SlipOK_PreCheck', pre);
      _configCache = null;
      try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}
      calls = 0;
      var v = handleVerifySlip({ qrData: 'QR', amount: 100, log: false });   // the parent's screen
      var preCalls = calls;
      var row = paySlipVerify_({ qrData: 'QR', slipAmount: 100 }, 100);       // the real one, on submit
      return { pre: preCalls, total: calls, preAvailable: !!v.available, verified: String(row.verified) };
    }
    return JSON.stringify({ on: count('true'), off: count('false') });
  }));
  eq('ค่าเริ่มต้น (เปิด) — 2 ครั้งต่อสลิป 1 ใบ', [q.on.pre, q.on.total], [1, 2]);
  eq('🔴 ปิดแล้ว — การตรวจล่วงหน้าไม่ยิงเลย เหลือ 1 ครั้ง', [q.off.pre, q.off.total], [0, 1]);
  ok_('🔴 ...แต่การตรวจตอนส่งจริง ยังทำงานเหมือนเดิม', q.off.verified === 'YES' && q.on.verified === 'YES');
  ok_('หน้าผู้ปกครองรับมือได้ (available:false → ไม่แสดงอะไร ไม่ใช่ error)', q.off.preAvailable === false);
  /* 🔴 REACHABLE, AND NEXT TO THE NUMBER THAT EXPLAINS IT. A setting only an admin with the sheet
   * open can change is not a lever the school has — the tick sits on the SlipOK screen, directly
   * under the quota figure that makes it make sense. Twice in a fortnight a finished feature shipped
   * with no way in (the ☀️ summer button, the whole-school backup). */
  const app = R('webapp/app.js'), ps = R('src/PaySlips.gs'), st = R('src/Staff.gs');
  ok_('🔴 มีช่องติ๊กจริงในหน้าตรวจสลิป', /id="sokPre"/.test(app));
  ok_('...ส่งค่าไปกับการบันทึก', /preCheck:\s*pre\?pre\.checked:null/.test(app));
  ok_('...ฝั่งเซิร์ฟเวอร์บันทึกเฉพาะตอนที่แอดมินแตะจริง (ไม่แอบเปลี่ยนตอนบันทึกเลขสาขา)',
    /if \(p\.preCheck != null\) setConfigValue_\('SlipOK_PreCheck'/.test(st));
  ok_('...และหน้าจอรู้สถานะปัจจุบัน (ไม่ใช่ติ๊กไว้ทุกครั้งที่เปิด)', /preCheck: preCheck/.test(ps));
}

console.log('\n3) 🔴 การแยกประเภทต้องเป็น "รายการที่ประกาศไว้" ไม่ใช่การเดาจากตัวเลขหรือข้อความ');
{
  const d6 = R('src/Day6.gs');
  ok_('รหัสที่เป็นเรื่องของบัญชี ถูกเขียนเป็นรายการชัดเจน',
    /ACCOUNT_CODES\s*=\s*\{\s*1001:\s*1,\s*1002:\s*1,\s*1003:\s*1,\s*1004:\s*1,\s*1015:\s*1\s*\}/.test(d6));
  /* A RANGE would have been the easy way to write this and would have been wrong in both
   * directions: 1011–1014 sit inside any range wide enough to hold 1015. */
  ok_('🔴 ไม่ได้ใช้ช่วงตัวเลข (1011–1014 อยู่ในช่วงเดียวกับ 1015)',
    !/code\s*[<>]=?\s*10(0[0-9]|1[0-9])/.test(d6));
  const ps = R('src/PaySlips.gs');
  ok_('paySlipVerify_ ออกก่อนบันทึกคำตัดสิน เมื่อเป็นปัญหาบัญชี',
    ps.indexOf('v.serviceError') > 0 && ps.indexOf('v.serviceError') < ps.indexOf("'NO:'"));
  const app = R('webapp/app.js');
  ok_('🔴 หน้าผู้ปกครองใช้ธงที่ประกาศไว้ แทนการจับคำในข้อความ',
    /vk\.serviceError\s*===\s*true/.test(app));
  ok_('...และยังเหลือ regex ไว้เป็นตาข่ายชั้นสอง สำหรับ deploy เก่าที่ยังไม่ส่งธงนี้',
    /หมดอายุ\|expire\|สาขา/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
