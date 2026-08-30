/**
 * tools/test_slip_layout.js — the payslip document, run rather than grepped.
 *   node tools/test_slip_layout.js
 *
 * Asked 2026-08-30: "ที่เราออกแบบมาดูยากไปหน่อย ให้มีข้อมูลสำคัญครบถ้วน … แจงรายละเอียดแยกส่วนให้ชัดเจน".
 *
 * The old slip crammed everything into a 7-column table two rows deep. Two things were not merely
 * hard to read, they were WRONG as a statement of pay:
 *
 *   1. ค่าล่วงเวลาตอนเย็น and ค้างจ่าย OT were ADDED TOGETHER in one cell with an asterisk. A teacher
 *      owed 300 from June saw "1,500" against a month she had worked 1,200 of.
 *   2. "อื่น ๆ" stood for the child rate, the training certificates AND any manual figure at once.
 *
 * Both are now their own line with their own working. This file checks that by EXECUTING the real
 * slipBreakdown / buildSlipsHTML out of webapp/app.js — the same trick test_insurance_form.js uses —
 * because a regex over the source proves the text exists, not that the document adds up.
 *
 * The assertion that matters most is the last one: the printed columns must equal their own totals.
 * A slip whose lines do not sum to the figure at the bottom is the one thing worse than a slip that
 * is hard to read.
 */
const path = require('path'), fs = require('fs');
let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const app = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'app.js'), 'utf8').replace(/\r\n/g, '\n');

// ---- pull the real functions out of app.js -------------------------------------------------------
// Brace-matched rather than regexed to a closing line: these are long functions full of template
// literals and a `\n  }` pattern would stop at the first nested block.
function fnSrc(name) {
  const start = app.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found in app.js: ' + name);
  let i = app.indexOf('{', start), depth = 0, inStr = '', esc0 = false;
  for (let j = i; j < app.length; j++) {
    const c = app[j];
    if (esc0) { esc0 = false; continue; }
    if (c === '\\') { esc0 = true; continue; }
    if (inStr) { if (c === inStr) inStr = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return app.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
function lineSrc(re) { const m = re.exec(app); if (!m) throw new Error('line not found: ' + re); return m[0]; }

const MOCK = { config: { SocialSecurityRate: 0.05, SocialSecurityMax: 750, ExtraChildRate: 300, TrainingCertRate: 100, ContributionMatchRate: 1 } };
const baht = n => (Math.round(Number(n || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const build = new Function('MOCK', 'baht', 'esc', 'adjRows', 'ssWorking', 'carryMonths', 'staffName', 'fullDate', 'todayStr', 'EN', 'BC_NAME', 'window', 'location', `
  ${lineSrc(/^  const _n=v=>Number\(v\|\|0\), _r2=.*$/m)}
  ${lineSrc(/^  const _periodTH = m =>[\s\S]*?return `01\/.*$/m)}
  ${lineSrc(/^  const PER_SHEET = \d+;.*$/m)}
  ${fnSrc('slipBreakdown')}
  ${fnSrc('buildSlipsHTML')}
  return { slipBreakdown, buildSlipsHTML, PER_SHEET };`);

const { slipBreakdown, buildSlipsHTML, PER_SHEET } = build(
  MOCK, baht, esc,
  r => { const a = r && r.Adjustments; if (Array.isArray(a)) return a;
    if (typeof a === 'string' && a.trim()) { try { const v = JSON.parse(a); return Array.isArray(v) ? v : []; } catch (e) {} } return []; },
  r => `5% ของ ${baht(r.BaseSalary)} · ไม่เกิน ${baht(750)}`,
  r => 'มิถุนายน 2569',
  id => 'ครูจอย',
  v => '5 กันยายน 2569',
  () => '2026-08-30',
  // Thai, and the renamed Big Cleaning Day — the slip must not spell that name out for itself
  () => false, () => 'วันประชุม',
  { _LOGO: 'data:,', MOCK }, { origin: 'http://x' }
);

// A month with EVERY kind of line on it, so nothing can hide behind a zero.
const ROW = {
  StaffID: 'STF-JOY', StaffName: 'ครูจอย', Position: 'ครูประจำชั้น', Month: '2026-08',
  PayType: 'monthly', BaseSalary: 13500, PaidDate: '2026-09-05',
  BankName: 'SCB', BankAccount: '4271602532',
  DiligenceAttendance: 500, DiligenceFacebook: 500, DiligenceTotal: 1200,   // 200 of it is Big Cleaning
  ExtraChildCount: 4, ExtraChildAmount: 1200, ChildMultiplier: 300,
  TrainingCertCount: 1, TrainingCertAmount: 100,
  OTEvening: 1200, OTCarry: 300, OTCarryDetail: '[{"month":"2026-06","amount":300,"hours":3}]',
  OTHoliday: 500, HolidayBonus: 0,
  OtherIncome: 1500,            // child 1200 + cert 100 + adj(+200)
  SocialSecurity: 675, Contribution: 200, ContributionEmployer: 200, ContributionAccum: 35400,
  OtherDeductions: 1750,        // manual 1600 + adj(−150)
  Adjustments: '[{"label":"โบนัสพิเศษ","amount":200},{"label":"หักค่าชุด","amount":-150}]',
  GrossIncome: 18200, TotalDeductions: 2625, NetPay: 15575,
  LeaveDays: 1, LeaveLimit: 3, LeaveExceeds: false, ChildThreshold: 31
};

// ============================================================================
console.log('\n1) one line per thing somebody is paid for');
{
  const b = slipBreakdown(ROW);
  const L = b.income.map(x => x.label);
  ok_('เบี้ยขยัน is split into its two named halves, not one lump',
    L.indexOf('เบี้ยขยัน — มาทำงานครบ ไม่ลา ไม่สาย') >= 0 && L.indexOf('เบี้ยขยัน — โพสต์รูป Facebook') >= 0);
  // the meeting-day bonus, which the payroll record only stores as the remainder of DiligenceTotal.
  // Its name comes from BC_NAME() — the day was renamed once and the slip must not undo that.
  ok_('...and the meeting-day bonus', L.indexOf('เบี้ยขยัน — วันประชุม') >= 0);
  eq('...worth what is left over after the other two', b.income.find(x => /วันประชุม/.test(x.label)).amount, 200);
  /* THE ONE THAT WAS ACTUALLY WRONG. The old slip printed OTEvening + OTCarry in a single cell, so a
   * month's own overtime could not be told from an arrear paid on top of it. */
  const ot = b.income.find(x => x.label === 'ค่าล่วงเวลาตอนเย็น (OT)');
  const carry = b.income.find(x => x.label === 'OT ค้างจ่ายจากเดือนก่อน');
  eq('this month’s OT stands alone', ot.amount, 1200);
  eq('...and the arrear is its own line', carry.amount, 300);
  eq('...saying which month it came from', carry.note, 'มิถุนายน 2569');
  ok_('OT วันหยุด is not folded into either', b.income.some(x => /OT วันหยุด/.test(x.label)));
  // "อื่น ๆ" used to mean three unrelated things at once
  eq('the child rate is its own line, with the count and the rate',
    [b.income.find(x => /จำนวนเด็ก/.test(x.label)).amount, b.income.find(x => /จำนวนเด็ก/.test(x.label)).note],
    [1200, '4 คน × 300.00']);
  eq('training certificates too', b.income.find(x => /ใบประกาศ/.test(x.label)).note, '1 ใบ × 100.00');
  ok_('a named adjustment keeps its name', b.income.some(x => x.label === 'โบนัสพิเศษ' && x.amount === 200));
  // deduction amounts are POSITIVE MAGNITUDES; the minus sign belongs to the renderer, not the data
  ok_('...and a negative one is a DEDUCTION, not an income line',
    b.deduct.some(x => x.label === 'หักค่าชุด' && x.amount === 150) && !b.income.some(x => x.label === 'หักค่าชุด'));
  ok_('ประกันสังคม shows its working', /5% ของ/.test(b.deduct.find(x => /ประกันสังคม/.test(x.label)).note));
  ok_('เงินสมทบ says the school matches it',
    /โรงเรียนสมทบอีก/.test(b.deduct.find(x => /เงินสมทบ/.test(x.label)).note));
}

console.log('\n2) THE COLUMNS MUST EQUAL THEIR OWN TOTALS');
{
  /* The whole point of itemising. If the lines do not add up to the number at the bottom, the slip
   * is not merely hard to read — it is not evidence of anything. Checked on the awkward row above
   * (adjustments both ways, a manual figure on each side, three kinds of OT) and on a plain one. */
  const check = (label, row) => {
    const b = slipBreakdown(row);
    const si = Math.round(b.income.reduce((s, x) => s + x.amount, 0) * 100) / 100;
    const sd = Math.round(b.deduct.reduce((s, x) => s + x.amount, 0) * 100) / 100;
    eq(label + ' — income lines = รวมรายได้', si, b.gross);
    eq(label + ' — deduction lines = รวมรายการหัก', sd, b.totalDeduct);
    eq(label + ' — รวมรายได้ − รวมหัก = สุทธิ', Math.round((b.gross - b.totalDeduct) * 100) / 100, b.net);
  };
  check('busy month', ROW);
  check('plain month', { BaseSalary: 13000, DiligenceAttendance: 500, DiligenceFacebook: 0, DiligenceTotal: 500,
    ExtraChildAmount: 0, OTEvening: 0, OtherIncome: 0, SocialSecurity: 650, Contribution: 0,
    OtherDeductions: 0, GrossIncome: 13500, TotalDeductions: 650, NetPay: 12850 });
  // a daily-rate staff member: the base line has to say how the wage was reached
  const d = slipBreakdown({ PayType: 'daily', DailyRate: 500, DaysWorked: 22, BaseSalary: 11000,
    DiligenceTotal: 0, DiligenceAttendance: 0, DiligenceFacebook: 0, ExtraChildAmount: 0, OTEvening: 0,
    OtherIncome: 0, SocialSecurity: 550, Contribution: 0, OtherDeductions: 0,
    GrossIncome: 11000, TotalDeductions: 550, NetPay: 10450 });
  eq('daily pay says days × rate', [d.income[0].label, d.income[0].note], ['ค่าจ้างรายวัน', '22 วัน × 500.00']);
}

console.log('\n3) the printed document');
{
  const html = buildSlipsHTML([ROW], '2026-08');
  eq('two slips to an A4 landscape sheet, not three', PER_SHEET, 2);
  ok_('...and it says so on the print button', /2 สลิป\/แผ่น A4 แนวนอน/.test(html));
  ok_('A4 landscape', /@page\{size:A4 landscape/.test(html));
  // everything ม.70 asks an employer to put on a pay statement
  ['ชื่อพนักงาน', 'ตำแหน่ง', 'งวดเงินเดือน', 'วันที่จ่าย', 'เลขที่บัญชี', 'รวมรายได้', 'รวมรายการหัก',
   'เงินสุทธิที่โอนเข้าบัญชี', 'ลงชื่อผู้รับเงิน'].forEach(k =>
    ok_('the slip carries "' + k + '"', html.indexOf(k) >= 0));
  ok_('the payment date is a real date, not an ISO stamp', /วันที่จ่าย <b>5 กันยายน 2569<\/b>/.test(html));
  ok_('a month with no payment date says so rather than printing nothing',
    /วันที่จ่าย <b>—<\/b>/.test(buildSlipsHTML([Object.assign({}, ROW, { PaidDate: '' })], '2026-08')));
  ok_('CONFIDENTIAL is still on it', /CONFIDENTIAL/.test(html));
  ok_('...and the cut line between two slips', /class="cut"/.test(buildSlipsHTML([ROW, ROW], '2026-08')));
  ok_('the accumulated fund is on the paper too', /สะสมรวม 35,400\.00/.test(html));
  ok_('every line item reaches the page', /OT ค้างจ่ายจากเดือนก่อน/.test(html) && /โบนัสพิเศษ/.test(html) && /หักค่าชุด/.test(html));
  ok_('the net is printed once, in full', html.split('15,575.00').length - 1 >= 1);
  /* A LABEL AN ADMIN TYPED IS NOT HTML. Adjustment labels are free text on the payroll screen and go
   * straight onto a printed document; a stray < would break the slip and a <script> would run. */
  const nasty = buildSlipsHTML([Object.assign({}, ROW, { Adjustments: '[{"label":"<img src=x onerror=alert(1)>","amount":50}]' })], '2026-08');
  ok_('a free-text label is escaped, not injected', nasty.indexOf('<img src=x') < 0 && /&lt;img src=x/.test(nasty));
  // leave over the limit is WHY the child rate is zero — say it on the slip, not only on the screen
  const over = buildSlipsHTML([Object.assign({}, ROW, { LeaveExceeds: true, LeaveDays: 5, ExtraChildAmount: 0, ExtraChildCount: 0 })], '2026-08');
  ok_('a zeroed child rate explains itself', /ลาเกิน 3 วัน — ไม่คำนวณเรท/.test(over) && /ลารวม 5 วัน/.test(over));
  ok_('three staff still fill two sheets', (buildSlipsHTML([ROW, ROW, ROW], '2026-08').match(/class="sheet"/g) || []).length === 2);
}

console.log('\n4) the screen and the paper are the same description');
{
  /* payslipCard used to write its own lines out, and had drifted: it asked for `r.ChildCount`, a
   * field the payroll record has never had, so "เด็ก N คน × ฿300" never showed for anybody. */
  ok_('the on-screen card reads slipBreakdown', /const b=slipBreakdown\(r\);/.test(app));
  ok_('...and no longer asks for a field that does not exist', !/r\.ChildCount\?/.test(app));
  ok_('the printed slip reads it too', /const card=p=>\{ const b=slipBreakdown\(p\);/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
