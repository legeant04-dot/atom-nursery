/**
 * tools/test_payroll_per_staff.js — the payslip uses what the ADMIN set for THAT person.
 *   node tools/test_payroll_per_staff.js
 *
 * Runs the REAL src/Payroll.gs against in-memory sheets, because that is what runs live:
 * `computePayroll` is an explicit route in Code.gs and therefore SHADOWS the shared engine. A test
 * that only exercised webapp/engine.js would have proved nothing about anybody's actual pay.
 *
 * ASKED 2026-08-24, after the per-person เบี้ยขยัน was fixed on the form: "ระบบอย่าลืมนำค่าไปใช้ตอน
 * สรุปเงินเดือนรายบุคคลให้ถูกต้องด้วย · ใส่ค่าสำหรับครูฟาง 1000 ตอนทำเงินเดือนค่านี้ก็ต้องถูกดึงมา
 * ถูกต้อง ทั้งเงินเดือน/เงินสมทบ/เบี้ยขยัน ทั้งหมดต้องถูกต้องรวมถึงการคำนวน OT ทั้งหมด"
 *
 * IT WAS NOT. computePayroll went straight from `payload.x` to `getConfig_('X')` — the school-wide
 * default — with nothing in between. PAYROLL_CONFIG, the sheet the staff form writes to and the
 * payroll screen reads from, was never opened here at all. So a เบี้ยขยัน of 1,000 set for one
 * teacher was honoured ONLY if the screen happened to send it in that same request, and was silently
 * replaced by 500 in every other path. Same for the child rate, the pay type, the daily rate, the
 * social-security tick and the contribution.
 *
 * The chain is now: what the screen sent → what the admin set for this person → the school's figure.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// ---- fake sheet layer (mirrors test_payroll_p1.js, plus getSheetByName for PAYROLL_CONFIG) ----
const DB = {};
function mkSheet(name) { return { __name: name }; }
global.sheet_ = (ss, name) => mkSheet(name);
const fakeWb = { getSheetByName: name => (DB[name] ? mkSheet(name) : null) };
global.getHrSpreadsheet_ = () => fakeWb;
global.getMainSpreadsheet_ = () => fakeWb;
global.readObjects_ = sh => (DB[sh.__name] || []).map((r, i) => {
  const o = Object.assign({}, r);
  Object.defineProperty(o, '_row', { value: i + 2, enumerable: false });
  return o;
});
global.findObject_ = (sh, pred) => global.readObjects_(sh).find(pred) || null;
global.updateRow_ = (sh, row, patch) => Object.assign(DB[sh.__name][row - 2], patch);
global.appendObject_ = (sh, obj) => { (DB[sh.__name] = DB[sh.__name] || []).push(Object.assign({}, obj)); };
global.ensureColumns_ = () => {};
global.nextId_ = (sh, f, p) => p + '-' + ((DB[sh.__name] || []).length + 1);
global.apiError_ = (c, m) => Object.assign(new Error(m), { code: c });
global.logAuditHr = () => {};
global.dateStr_ = d => _dLocal(new Date(d));
global.Session = { getScriptTimeZone: () => 'UTC' };
global.Utilities = { formatDate: (d, tz, f) => new Date(d).toISOString().slice(0, 7) };
global.CacheService = { getScriptCache: () => ({ removeAll() {} }) };
let CONFIG = {};
global.getConfig_ = (k, d) => (CONFIG[k] !== undefined ? CONFIG[k] : d);
global.setConfigValue_ = (k, v) => { CONFIG[k] = v; };
global.bigCleaningDays_ = () => [];

(0, eval)(fs.readFileSync(path.join(ROOT, 'src', 'OtStaff.gs'), 'utf8'));
/* ymdCell_ lives in Db.gs — whose sheet layer this file replaces wholesale, so the file cannot be
 * loaded. The ONE function needed is lifted out and loaded FOR REAL instead of stubbed: a stub
 * would be a second implementation of the exact date coercion the pause-salary rule depends on,
 * and the bug it exists for (a Sheets date cell read back as a Date object) is precisely the kind
 * a stub re-implements correctly while the real one is wrong. */
{ const _db = fs.readFileSync(path.join(ROOT, 'src', 'Db.gs'), 'utf8');
  const _f = _db.indexOf('function ymdCell_'), _t = _db.indexOf('\nfunction ', _f + 1);
  if (_f < 0) throw new Error('ymdCell_ not found in src/Db.gs');
  (0, eval)(_db.slice(_f, _t) + '\nglobal.ymdCell_ = ymdCell_;'); }
(0, eval)(fs.readFileSync(path.join(ROOT, 'src', 'Payroll.gs'), 'utf8'));

/* LOCAL dates, never toISOString(). The engine works in the school's own timezone; this
   file used UTC, so between midnight and 07:00 Bangkok its "today" was YESTERDAY and the
   assertions below failed for no reason at all. Found 2026-10-08 at 00:28, running the suite
   past midnight for the first time. Same trap as the payslip month and the leave expansion. */
const _p2 = n => String(n).padStart(2, "0");
const _dLocal = d => d.getFullYear() + "-" + _p2(d.getMonth() + 1) + "-" + _p2(d.getDate());

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

// ครูฟาง, exactly as on the screenshot: base 11,000, started 24/08/2026
function reset(pcRow) {
  DB.STAFF = [{ StaffID: 'STF-FANG', Name: 'ฟาง', BaseSalary: 11000, BankAccount: '9247855910',
    ContributionOpening: 0, ContributionAccum: 0 }];
  DB.OT_RECORDS = []; DB.PAYROLL = []; DB.LEAVE_REQUEST = []; DB.CHECKIN_STAFF = [];
  DB.PAYROLL_CONFIG = pcRow ? [Object.assign({ StaffID: 'STF-FANG' }, pcRow)] : [];
  CONFIG = { SocialSecurityRate: '0.05', SocialSecurityMax: '750', DiligenceAttendanceAmount: '500',
    DiligenceFacebookAmount: '500', ExtraChildRate: '300', TrainingCertRate: '100', TrainingCertMaxPerMonth: '2',
    StaffOTHourlyRate: '100', ContributionMatchRate: '1', OTEveningRate: '0', BigCleaningAmount: '0' };
}
// what the payroll screen sends when the admin has NOT typed over anything on the slip form
const run = extra => computePayroll(Object.assign({ staffId: 'STF-FANG', month: '2026-08',
  attendanceEligible: true, facebookPosted: true, extraChildCount: 0, trainingCertCount: 0,
  generatedBy: 'test' }, extra || {}));

console.log('\n1) ครูฟาง: เบี้ยขยัน set to 1,000 — the payslip must pay 1,000');
{
  reset({ DiligenceAttendanceAmount: 1000, DiligenceFacebookAmount: 1000 });
  const r = run();
  eq('attendance half', r.DiligenceAttendance, 1000);
  eq('Facebook half', r.DiligenceFacebook, 1000);
  eq('...and the total on the slip', r.DiligenceTotal, 2000);
  eq('the base salary is still hers', r.BaseSalary, 11000);
  eq('...and the gross carries the bigger bonus', r.GrossIncome, 11000 + 2000);
}
{
  // ...and the school-wide figure still applies to somebody with nothing set
  reset(null);
  const r = run();
  eq('no per-person setting → the school figure', [r.DiligenceAttendance, r.DiligenceFacebook], [500, 500]);
}
{
  // the payroll screen can still type over it for one month — that must win
  reset({ DiligenceAttendanceAmount: 1000, DiligenceFacebookAmount: 1000 });
  const r = run({ diligenceAttend: 700, diligenceFb: 0 });
  eq('what the admin typed on the slip beats the stored setting', [r.DiligenceAttendance, r.DiligenceFacebook], [700, 0]);
}

console.log('\n2) blank is "use the school figure", not zero');
{
  reset({ DiligenceAttendanceAmount: '', DiligenceFacebookAmount: '' });
  const r = run();
  eq('an emptied override falls back to 500, not to 0', [r.DiligenceAttendance, r.DiligenceFacebook], [500, 500]);
  ok_('...so nobody is quietly paid no เบี้ยขยัน', r.DiligenceTotal === 1000);
}
{
  reset({ DiligenceAttendanceAmount: 0, DiligenceFacebookAmount: 0 });
  const r = run();
  eq('a deliberate 0 is still a real 0', [r.DiligenceAttendance, r.DiligenceFacebook], [0, 0]);
}

console.log('\n3) the rest of that person’s pay settings are read too');
{
  reset({ Contribution: 200 });
  const r = run();
  eq('เงินสมทบ comes from the person’s own setting', r.Contribution, 200);
  eq('...and the school matches it', r.ContributionEmployer, 200);
  eq('...the fund grows by both halves', r.ContributionAccum, 400);
  eq('...and only the teacher’s half is deducted', r.TotalDeductions, r.SocialSecurity + 200);
}
{
  reset({ SocialSecurityDeduct: 'FALSE' });
  eq('a person marked exempt from social security is not charged it', run().SocialSecurity, 0);
  /* NOT SET now means NOT DEDUCTED (2026-09-02, at the school's request). The old default took ฿750
   * off anybody the admin had never configured — money removed from a teacher's pay because nobody
   * had said not to. Off is the safer of the two wrong answers: a payslip that is too high gets
   * reported, one that is too low may not be. A per-staff setting still wins either way. */
  reset(null);
  eq('...and somebody with no setting at all is not charged either', run().SocialSecurity, 0);
  reset({ SocialSecurityDeduct: 'TRUE' });
  ok_('...while a person the admin HAS ticked still is', run().SocialSecurity > 0);
}
{
  reset({ PayType: 'daily', DailyRate: 450 });
  const r = run({ daysWorked: 6 });
  eq('a daily-rate teacher is paid rate × days', r.BaseSalary, 2700);
  eq('...and the slip says which kind of pay it was', r.PayType, 'daily');
}
/* ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 THE CHILD RATE HAS NO SCHOOL-WIDE FALLBACK ANY MORE (ผอ. 2026-10-23).
 *
 * The second assertion here used to read "...and falls back when unset → 900", i.e. 3 children at
 * the school's ฿300. That assertion was WRONG IN THE SAME WAY THE CODE WAS: it certified that an
 * unset teacher still gets paid at a figure nobody chose. SCHOOL_CONFIG seeded the threshold as 30
 * under a comment saying 31, so "the school's number" was itself two different numbers.
 *
 * ผอ. set the policy: the threshold AND the rate are per teacher, the school decides each, and some
 * schools do not run the scheme. So unset is a real state and its answer is ฿0 plus a name on the
 * admin's to-do card — never a silent payment. BOTH halves must be set; a threshold with no baht
 * cannot pay and baht with no threshold cannot count.
 */
{
  reset({ ChildThreshold: 31, ChildMultiplier: 400 });
  eq('ครูที่ตั้งค่าไว้ — ใช้เรทของตัวเอง', run({ extraChildCount: 3 }).ExtraChildAmount, 1200);
  eq('...และสลิปเก็บทั้งสองค่าไว้ว่าใช้เกณฑ์อะไรคิด',
    [run({ extraChildCount: 3 }).ChildThreshold, run({ extraChildCount: 3 }).ChildMultiplier], [31, 400]);

  reset(null);
  eq('🔴 ยังไม่ได้ตั้งค่าเลย — ไม่จ่าย (ไม่มีค่าสำรอง ฿300 อยู่ข้างหลังแล้ว)',
    run({ extraChildCount: 3 }).ExtraChildAmount, 0);
  eq('...และสลิปเว้นว่าง ไม่ได้เขียน 31 ลงไป (ว่างคือสัญญาณที่หน้าจออ่าน)',
    [run({ extraChildCount: 3 }).ChildThreshold, run({ extraChildCount: 3 }).ChildMultiplier], ['', '']);

  reset({ ChildThreshold: 31 });
  eq('🔴 มีเกณฑ์ แต่ไม่มีเรทบาท — ยังคิดเงินไม่ได้', run({ extraChildCount: 3 }).ExtraChildAmount, 0);
  reset({ ChildMultiplier: 400 });
  eq('🔴 มีเรทบาท แต่ไม่มีเกณฑ์ — ยังนับไม่ได้', run({ extraChildCount: 3 }).ExtraChildAmount, 0);

  /* ...and the admin is never locked out: typing both figures onto the form pays that month without
   * anything being saved to the person's config first. */
  reset(null);
  eq('แอดมินพิมพ์ทั้งสองค่าบนฟอร์มเอง — จ่ายได้ตามที่พิมพ์',
    run({ extraChildCount: 3, childThreshold: 21, childMultiplier: 100 }).ExtraChildAmount, 300);
}

console.log('\n4) OT is unchanged and still correct');
{
  reset({ DiligenceAttendanceAmount: 1000, DiligenceFacebookAmount: 1000 });
  DB.OT_RECORDS = [
    { OTRecordID: 'O1', StaffID: 'STF-FANG', Month: '2026-08', Date: '2026-08-18', Hours: 1, Amount: 100, Status: 'APPROVED' },
    { OTRecordID: 'O2', StaffID: 'STF-FANG', Month: '2026-08', Date: '2026-08-19', Hours: 3, Amount: 300, Status: 'REJECTED' },
    { OTRecordID: 'O3', StaffID: 'STF-FANG', Month: '2026-08', Date: '2026-08-22', Hours: 0, Amount: 500, Status: 'APPROVED', Kind: 'HOLIDAY' }
  ];
  const r = run();
  eq('evening OT counts only what was approved', r.OTEvening, 100);
  eq('...a rejected one is not paid', r.OTEvening, 100);
  eq('OT วันหยุด is its own line, never inside OT เย็น', [r.OTHoliday, r.OTEvening], [500, 100]);
  eq('nothing is carried from a month with no saved payslip', r.OTCarry, 0);
  eq('the gross is every line added once',
    r.GrossIncome, 11000 + 2000 + 100 + 500);
  eq('...and the net is the gross less what was deducted', r.NetPay, r.GrossIncome - r.TotalDeductions);
}

console.log('\n5) the two halves of the app agree');
{
  const pay = fs.readFileSync(path.join(ROOT, 'src', 'Payroll.gs'), 'utf8');
  const eng = fs.readFileSync(path.join(ROOT, 'webapp', 'engine.js'), 'utf8');
  ok_('Apps Script reads the per-staff config', /function payrollCfgFor_\(staffId\)/.test(pay));
  ok_('...and asks "is this actually set?" in one place', /function pcNum_\(v\)/.test(pay));
  ok_('...blank included, so an emptied box is not a zero', /String\(v\)\.trim\(\) === ''\) return null/.test(pay));
  ok_('the engine has the same rule', /const perStaff=\(v\)=> \(v!=null && v!=='' && isFinite\(Number\(v\)\)\) \? Number\(v\) : null;/.test(eng));
  ok_('...and both apply it to the child rate as well', /perStaff\(pc\.ChildMultiplier\)/.test(eng) && /pcNum_\(\(pc \|\| \{\}\)\.ChildMultiplier\)/.test(pay));
  /* THE CLAIM, not a line's shape: neither half may name a child-rate number of its own. A `|| 31`
   * or `|| 300` anywhere in these two files is the bug coming back, wherever somebody puts it.
   *
   * 🔴 CODE ONLY — comments are stripped first. The note above each fix QUOTES the chain it
   * replaced, and a guard that fires on an explanation of a fixed bug teaches everyone to stop
   * writing explanations. (Same false positive the system auditor's R7 produced on 2026-10-22.) */
  const codeOnly = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const bad = /Child(Threshold|Multiplier)[^\n]*\|\|\s*(31|300)\b/;
  ok_('🔴 ไม่มีเลขเรทเด็กฝังอยู่ในโค้ดทั้งสองฝั่ง',
    !bad.test(codeOnly(pay)) && !bad.test(codeOnly(eng)) &&
    !/ExtraChild(Threshold|Rate)\s*\|\|/.test(codeOnly(eng)));
  ok_('the reason is written where the money is worked out', /was never opened here at all|The middle step was missing/.test(pay));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
