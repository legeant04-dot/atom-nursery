// Generate a sample salary-slip HTML (3 staff) to preview the print layout.
const fs = require('fs');
const path = require('path');
const harness = require('./gas_test_harness');
const { run } = harness(['Config','Db','Audit','Line','Auth','Code','Setup','Dspm_Seed','Checkin','Triggers','Leave','Parent','Dspm','Journal','Payroll','Slips']);

const html = run(function () {
  _configCache = null; setupAll(); _configCache = null;
  const HR = getHrSpreadsheet_();
  const people = [
    ['STF-1', 'สมหญิง ใจดี', 'ครูประจำชั้น', 18000],
    ['STF-2', 'มานี รักเรียน', 'พี่เลี้ยง', 12000],
    ['STF-3', 'ปิติ ขยันมาก', 'แม่บ้าน', 10000]
  ];
  people.forEach(p => appendObject_(sheet_(HR, 'STAFF'), {
    StaffID: p[0], Name: p[1], Position: p[2], Role: 'Teacher', Department: 'Nursery 1',
    PositionLevel: 'Officer', LineUID: '', StartDate: new Date(), BaseSalary: p[3], Status: 'ACTIVE'
  }));
  computePayroll({ staffId: 'STF-1', month: '2026-06', facebookPosted: true, extraChildCount: 4, trainingCertCount: 1, holidayBonus: 1000 });
  computePayroll({ staffId: 'STF-2', month: '2026-06', facebookPosted: false, extraChildCount: 0, trainingCertCount: 2, otEvening: 800 });
  computePayroll({ staffId: 'STF-3', month: '2026-06', attendanceOverride: true, otherDeductions: 200 });
  return buildSlipsHtml_('2026-06');
});

const out = path.join(__dirname, '..', 'samples', 'salary_slips_sample.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html, 'utf8');
console.log('Wrote', out, '(' + html.length + ' bytes) — open in a browser and Ctrl+P (A4 landscape) to preview 3 slips/sheet');
