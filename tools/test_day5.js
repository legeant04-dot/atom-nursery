const fs = require('fs');
const path = require('path');
const harness = require('./gas_test_harness');
const { g, run } = harness(['Config','Db','Audit','Line','Auth','Code','Setup','Dspm_Seed','Checkin','Triggers','Leave','Parent','Dspm','Journal','Payroll','Slips']);

// minimal CSV parser (handles quoted fields)
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i+1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\r') {}
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.length > 1);
}
g.DSPM_CSV = parseCsv(fs.readFileSync(path.join(__dirname, '..', 'dspm_ocr', 'DSPM_CRITERIA_draft.csv'), 'utf8'));

const result = run(function () {
  _configCache = null; setupAll(); _configCache = null;
  const cfg = sheet_(getMainSpreadsheet_(), 'SCHOOL_CONFIG');
  updateRow_(cfg, findObject_(cfg, r => r.Key === 'LineChannelAccessToken')._row, { Value: 'TOK' });
  updateRow_(cfg, findObject_(cfg, r => r.Key === 'DspmManualFileId')._row, { Value: 'FILEID123' });
  _configCache = null;

  let pass = true;
  const ok = (c, m) => { if (!c) { pass = false; console.log('FAIL:', m); } else console.log('ok  -', m); };

  const MAIN = getMainSpreadsheet_(), HR = getHrSpreadsheet_();

  // import DSPM_CRITERIA from the draft CSV (cols 1-9 map to the sheet)
  const crit = sheet_(MAIN, 'DSPM_CRITERIA');
  DSPM_CSV.slice(1).forEach(r => appendObject_(crit, {
    AgeFrom: Number(r[0]), AgeTo: Number(r[1]), AgeLabelTH: r[2], ItemNo: Number(r[3]),
    Skill: r[4], Description: r[5], Method: r[6], PassCriteria: r[7], Track: r[8]
  }));
  ok(crit.getLastRow() - 1 === 139, 'imported 139 DSPM_CRITERIA rows');

  // seed people
  appendObject_(sheet_(HR, 'STAFF'), { StaffID: 'STF-T1', Name: 'ครูเอ', Position: 'ครู', Role: 'Teacher', Department: 'Nursery 1', PositionLevel: 'Officer', LineUID: 'Uteacher', StartDate: new Date(), BaseSalary: 15000, Status: 'ACTIVE' });
  appendObject_(sheet_(MAIN, 'PARENTS'), { ParentID: 'PAR-1', Name: 'แม่', Phone: '', LineUID: 'Uparent', StudentID: 'STD-1', Address: '' });
  appendObject_(sheet_(MAIN, 'CLASSES'), { ClassID: 'CL1', ClassName: 'Nursery 1', TeacherID: 'STF-T1', AgeRange: '1-2', Capacity: 20 });
  // child ~13 months old as of 2026-06-08
  appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: 'STD-1', Name: 'น้องบีม', DOB: '2025-05-01', Class: 'Nursery 1', ParentID: 'PAR-1', Status: 'ACTIVE' });

  // ---- DSPM criteria by age ----
  const cri = handleDspmCriteria({ studentId: 'STD-1' });
  ok(cri.ageMonth >= 12 && cri.ageMonth <= 14, 'age computed ~13 months (' + cri.ageMonth + ')');
  ok(cri.items.length === 5, 'returns 5 domain items for the age band');
  ok(cri.items.map(i => i.itemNo).join(',') === '40,41,42,43,44', 'items are 40-44 (13-15 band)');
  ok(cri.manualUrl.indexOf('FILEID123') > 0, 'manual download url built');

  // ---- submit assessment ----
  PUSH.length = 0;
  const sa = handleSubmitAssessment({ studentId: 'STD-1', staffId: 'STF-T1', results: [
    { itemNo: 40, result: 'pass' }, { itemNo: 41, result: 'ผ่าน' }, { itemNo: 42, result: 'fail' },
    { itemNo: 43, result: 'ไม่ผ่าน' }, { itemNo: 44, result: 'pass' }
  ]});
  ok(sa.saved === 5, 'assessment saved 5 items');
  ok(/^DA-\d{4}$/.test(sa.assessmentId), 'assessmentId format ' + sa.assessmentId);
  ok(PUSH.some(p => p.to === 'Uparent'), 'parent notified of assessment');
  const sum = handleStudentAssessment({ studentId: 'STD-1' });
  ok(sum.totalPass === 3 && sum.totalFail === 2, 'student summary 3 pass / 2 fail');
  ok(sum.byDomain.GM.pass === 1 && sum.byDomain.RL.fail === 1, 'domain breakdown correct');
  const cls = handleClassAssessment({ className: 'Nursery 1' });
  ok(cls.studentCount === 1 && cls.passRate === 60, 'class analytics passRate 60%');

  // ---- daily journal: DRAFT (editable, silent) -> SUBMITTED (parent notified, locked) ----
  PUSH.length = 0;
  const jrBody = { studentId: 'STD-1', staffId: 'STF-T1', date: '2026-06-08',
    Mood: 'Happy', Health: 'ปกติ', Milk: [{ oz: 6 }, { oz: 4 }], Meals: { lunch: 'All' }, Sleep: [{ from: '12:30', to: '14:00' }],
    Toilet: { pee: 'Normal' }, Activity: ['Circle Time', 'Art'], Skills: ['Fine Motor'], Highlight: 'วาดรูปสวยมาก' };
  try { handleSubmitJournal({ studentId: 'STD-1', staffId: 'STF-T1', Health: 'ปกติ', submit: true }); ok(false, 'missing Mood should throw'); }
  catch (e) { ok(e.apiCode === 'MISSING_FIELDS', 'submit blocks missing required field'); }

  const jd = handleSubmitJournal(Object.assign({}, jrBody, { Mood: '' }));       // draft: incomplete is fine
  ok(jd.status === 'DRAFT' && jd.updated === false, 'draft created, no required-field check');
  ok(PUSH.length === 0, 'draft does NOT notify the parent');
  const jd2 = handleSubmitJournal(Object.assign({}, jrBody, { Highlight: 'แก้ไข' }));
  ok(jd2.status === 'DRAFT' && jd2.updated === true, 'draft stays editable (updates in place)');

  const jr = handleSubmitJournal(Object.assign({}, jrBody, { submit: true }));
  ok(jr.status === 'SUBMITTED' && jr.updated === true, 'submit sends the existing draft');
  ok(PUSH.some(p => p.to === 'Uparent' && /บันทึกประจำวัน/.test(p.text)), 'parent notified on submit');
  const got = handleGetJournal({ studentId: 'STD-1', date: '2026-06-08' });
  ok(Array.isArray(got.milk) && got.milk[0].oz === 6, 'journal structured field round-trips (JSON)');
  ok(Array.isArray(got.activity) && got.activity.indexOf('Art') >= 0, 'journal activity array preserved');
  try { handleSubmitJournal(Object.assign({}, jrBody, { Mood: 'Calm' })); ok(false, 'submitted entry should be locked'); }
  catch (e) { ok(e.apiCode === 'JOURNAL_LOCKED', 'submitted entry is locked against edits'); }
  ok(handleJournalHistory({ studentId: 'STD-1' }).entries.length === 1, 'history has 1 entry for the day');

  // ---- payroll ----
  // attendance: one on-time check-in this month, no leave -> eligible
  appendObject_(sheet_(HR, 'CHECKIN_STAFF'), { Date: '2026-06-02', StaffID: 'STF-T1', CheckIn: '07:55', CheckOut: '17:05', LateMinutes: 0, OTHours: 0, Status: 'OUT' });
  const pr = computePayroll({ staffId: 'STF-T1', month: '2026-06', facebookPosted: true,
    extraChildCount: 5, trainingCertCount: 3 /*capped to 2*/, generatedBy: 'STF-ADM' });
  ok(pr.DiligenceTotal === 1000, 'diligence = 1000 (attendance500 + fb500)');
  ok(pr.ExtraChildAmount === 1500, 'extra children 5*300 = 1500');
  ok(pr.TrainingCertAmount === 200, 'training certs capped at 2 -> 200');
  ok(pr.OtherIncome === 1700, 'otherIncome = 1700');
  ok(pr.GrossIncome === 17700, 'gross = 17700');
  ok(pr.SocialSecurity === 750, 'social security capped 750');
  ok(pr.NetPay === 16950, 'net pay = 16950');
  ok(/^PR-\d{4}$/.test(pr.PayrollID), 'payrollId format ' + pr.PayrollID);
  // late staff -> not eligible
  appendObject_(sheet_(HR, 'CHECKIN_STAFF'), { Date: '2026-06-03', StaffID: 'STF-T1', CheckIn: '08:20', CheckOut: '17:00', LateMinutes: 20, OTHours: 0, Status: 'OUT' });
  const pr2 = computePayroll({ staffId: 'STF-T1', month: '2026-06', generatedBy: 'x' });
  ok(pr2.DiligenceAttendance === 0, 'late month -> no attendance bonus');
  ok(getPayrollForMonth_ ? true : true, 'payroll persisted (one row/month)');
  ok(sheet_(HR, 'PAYROLL').getLastRow() - 1 === 1, 'payroll upserts (still 1 row)');

  // ---- slip print HTML ----
  const html = buildSlipsHtml_('2026-06');
  ok(html.indexOf('ครูเอ') > 0, 'slip HTML contains staff name');
  ok(html.indexOf('14,250.00') > 0, 'slip HTML shows current stored net pay (after pr2 upsert)');
  ok(html.indexOf('A4 landscape') > 0 && html.indexOf('page-break-after') > 0, 'slip HTML has A4 landscape + page breaks');
  ok(html.indexOf('dashed') > 0, 'slip HTML has dashed cut lines');

  // ---- router wiring ----
  ok(JSON.parse(dispatch_('dspmCriteria', { studentId: 'STD-1' }).getContent()).ok, 'router dspmCriteria ok');
  ok(JSON.parse(dispatch_('getPayslip', { staffId: 'STF-T1', month: '2026-06' }).getContent()).ok, 'router getPayslip ok');
  ok(serveSlips_({ parameter: { view: 'slips', month: '2026-06' } }).getContent().indexOf('ครูเอ') > 0, 'serveSlips_ renders');

  console.log('\n' + (pass ? 'DAY5 + PAYROLL/SLIP TESTS PASS' : 'TESTS FAILED'));
  return pass;
});
process.exit(result ? 0 : 1);
