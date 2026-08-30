/**
 * tools/preview_slips.js — render the REAL payslip document to a file you can open and print.
 *   node tools/preview_slips.js   →  samples/salary_slips_sample.html
 *
 * It used to preview buildSlipsHtml_ in src/Slips.gs. Nothing reaches that renderer any more: the
 * app prints through buildSlipsHTML in webapp/app.js (A_print / A_dlSlip), and ?view=slips is a URL
 * nobody has a link to. Previewing the dead one was how the two documents were allowed to drift
 * apart in the first place, so this points at the one the school actually hands out.
 *
 * Three staff, deliberately awkward: one busy month with every kind of line on it, one plain month,
 * and one daily-rate. Open it and Ctrl+P — A4 landscape, 2 slips per sheet.
 */
const fs = require('fs'), path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'app.js'), 'utf8').replace(/\r\n/g, '\n');

function fnSrc(name) {
  const start = app.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found in app.js: ' + name);
  let depth = 0, inStr = '', esc0 = false;
  for (let j = app.indexOf('{', start); j < app.length; j++) {
    const c = app[j];
    if (esc0) { esc0 = false; continue; }
    if (c === '\\') { esc0 = true; continue; }
    if (inStr) { if (c === inStr) inStr = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++; else if (c === '}' && !--depth) return app.slice(start, j + 1);
  }
  throw new Error('unbalanced: ' + name);
}
const lineSrc = re => { const m = re.exec(app); if (!m) throw new Error('line not found: ' + re); return m[0]; };

const TH_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const MOCK = { config: { SocialSecurityRate: 0.05, SocialSecurityMax: 750, ExtraChildRate: 300, TrainingCertRate: 100, ContributionMatchRate: 1 } };
const baht = n => (Math.round(Number(n || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const monthNameYear = v => { const m = /^(\d{4})-(\d{1,2})/.exec(String(v || '')); return m ? `${TH_MONTHS[+m[2] - 1]} ${+m[1] + 543}` : String(v || ''); };
const fullDate = v => { const d = new Date(v); return isNaN(d) ? String(v || '') : `${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`; };

const build = new Function('MOCK', 'baht', 'esc', 'adjRows', 'ssWorking', 'carryMonths', 'staffName', 'fullDate', 'todayStr', 'EN', 'BC_NAME', 'window', 'location', `
  ${lineSrc(/^  const _n=v=>Number\(v\|\|0\), _r2=.*$/m)}
  ${lineSrc(/^  const _periodTH = m =>[\s\S]*?return `01\/.*$/m)}
  ${lineSrc(/^  const PER_SHEET = \d+;.*$/m)}
  ${fnSrc('slipBreakdown')}
  ${fnSrc('buildSlipsHTML')}
  return buildSlipsHTML;`);

const buildSlipsHTML = build(MOCK, baht, esc,
  r => { const a = r && r.Adjustments; if (Array.isArray(a)) return a;
    if (typeof a === 'string' && a.trim()) { try { const v = JSON.parse(a); return Array.isArray(v) ? v : []; } catch (e) {} } return []; },
  r => { const base = Number(r.BaseSalary || 0), ss = Number(r.SocialSecurity || 0);
    return (ss >= 750 && base * 0.05 > 750.5) ? `เพดานสูงสุด ${baht(750)} · 5% ของ ${baht(base)} = ${baht(base * 0.05)}`
                                              : `5% ของ ${baht(base)} · ไม่เกิน ${baht(750)}`; },
  r => { let d = r.OTCarryDetail; if (typeof d === 'string' && d) { try { d = JSON.parse(d); } catch (e) { d = null; } }
    return (Array.isArray(d) ? d : []).map(x => monthNameYear(x.month)).join(', ') || '-'; },
  id => id,
  fullDate, () => '2026-08-30',
  () => false, () => 'วันประชุม',     // EN(), BC_NAME() — Thai, and the renamed meeting day
  { _LOGO: '', MOCK }, { origin: '' });

const ROWS = [
  { StaffID: 'STF-003', StaffName: 'ปริณดา สว่างศรี', Position: 'ครูประจำชั้น', Month: '2026-08',
    PayType: 'monthly', BaseSalary: 13500, PaidDate: '2026-09-05', BankName: 'SCB', BankAccount: '4271602532',
    DiligenceAttendance: 500, DiligenceFacebook: 500, DiligenceTotal: 1200,
    ExtraChildCount: 4, ExtraChildAmount: 1200, ChildMultiplier: 300, ChildThreshold: 31,
    TrainingCertCount: 1, TrainingCertAmount: 100,
    OTEvening: 1200, OTCarry: 300, OTCarryDetail: '[{"month":"2026-06","amount":300,"hours":3}]',
    OTHoliday: 500, HolidayBonus: 0, OtherIncome: 1500,
    SocialSecurity: 675, Contribution: 200, ContributionEmployer: 200, ContributionAccum: 35400,
    OtherDeductions: 1750, Adjustments: '[{"label":"โบนัสพิเศษ","amount":200},{"label":"เบิกล่วงหน้า 5,000 หัก 5 งวด (งวดที่ 1)","amount":-150}]',
    GrossIncome: 18200, TotalDeductions: 2625, NetPay: 15575, LeaveDays: 1, LeaveLimit: 3, LeaveExceeds: false },
  { StaffID: 'STF-007', StaffName: 'สมหญิง ใจดี', Position: 'พี่เลี้ยง', Month: '2026-08',
    PayType: 'monthly', BaseSalary: 12000, PaidDate: '', BankName: 'SCB', BankAccount: '1112223334',
    DiligenceAttendance: 0, DiligenceFacebook: 0, DiligenceTotal: 0,
    ExtraChildCount: 0, ExtraChildAmount: 0, ChildMultiplier: 300, ChildThreshold: 31,
    OTEvening: 0, OtherIncome: 0, SocialSecurity: 600, Contribution: 0, ContributionAccum: 0,
    OtherDeductions: 0, GrossIncome: 12000, TotalDeductions: 600, NetPay: 11400,
    LeaveDays: 5, LeaveLimit: 3, LeaveExceeds: true },
  { StaffID: 'STF-011', StaffName: 'ปิติ ขยันมาก', Position: 'แม่บ้าน', Month: '2026-08',
    PayType: 'daily', DailyRate: 500, DaysWorked: 22, BaseSalary: 11000, PaidDate: '2026-09-05',
    BankName: 'SCB', BankAccount: '5556667778',
    DiligenceAttendance: 500, DiligenceFacebook: 0, DiligenceTotal: 500,
    ExtraChildAmount: 0, ChildMultiplier: 300, ChildThreshold: 31, OTEvening: 400, OtherIncome: 0,
    SocialSecurity: 550, Contribution: 500, ContributionEmployer: 500, ContributionAccum: 12000,
    OtherDeductions: 0, GrossIncome: 11900, TotalDeductions: 1050, NetPay: 10850 }
];

const out = path.join(__dirname, '..', 'samples', 'salary_slips_sample.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buildSlipsHTML(ROWS, '2026-08'), 'utf8');
console.log('Wrote', out, '— open it and Ctrl+P (A4 landscape) to check 2 slips/sheet');
