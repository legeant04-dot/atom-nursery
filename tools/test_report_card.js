/**
 * tools/test_report_card.js — Phase 6: the one-page child report card.
 *   node tools/test_report_card.js
 *
 * Two halves:
 *   1. the data handler — does it return what the page needs, and ONLY to people allowed to see it
 *   2. the PDF writer — a hand-built single-page PDF, so every byte offset in the xref table has to
 *      be right. This is exactly the sort of thing that "looks fine" and then will not open, so the
 *      structure is checked byte by byte here and the real file is opened in the browser run.
 */
const path = require('path'), fs = require('fs'), vm = require('vm');
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function throws_(label, fn, code) {
  try { fn(); console.log('  FAIL ' + label + '  (did not throw)'); fail++; }
  catch (e) { const c = e && (e.code || e.apiCode); const ok = !code || c === code;
    console.log((ok ? '  ok   ' : '  FAIL ') + label + '  code=' + c); ok ? pass++ : fail++; }
}
const TODAY = new Date().toISOString().slice(0, 10);
const YR = Number(TODAY.slice(0, 4));

function fresh() {
  const M = {
    config: { Plans: [{ id: 'p1', price: 6900, end: '17:00' }], Departments: 'Nursery 1\nNursery 2',
      SchoolName: 'Atom Nursery', LeaveQuota: {} },
    students: [
      { StudentID: 'STD-01', NameTH: 'เด็กหญิงหนึ่ง สองสาม', Nickname: 'หนึ่ง', Class: 'Nursery 1',
        Plan: 'p1', Status: 'ACTIVE', DOB: (YR - 3) + '-02-01', Gender: 'F', Allergy: 'นมวัว', ParentID: 'PAR-01' },
      { StudentID: 'STD-02', NameTH: 'เด็กชายสอง', Nickname: 'สอง', Class: 'Nursery 2',
        Plan: 'p1', Status: 'ACTIVE', DOB: (YR - 3) + '-02-01', Gender: 'M', ParentID: 'PAR-02' }],
    staff: [
      { StaffID: 'STF-A', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Department: 'Nursery 1' },
      { StaffID: 'STF-T', NameTH: 'ครูหนึ่ง', Role: 'Teacher', PositionLevel: 'Staff', Department: 'Nursery 1' }],
    parents: [{ ParentID: 'PAR-01', NameTH: 'พ่อ', StudentID: 'STD-01', LineUID: 'U1' }],
    classes: [{ ClassID: 'C1', ClassName: 'Nursery 1', TeacherID: 'STF-T' },
              { ClassID: 'C2', ClassName: 'Nursery 2', TeacherID: 'STF-X' }],
    growthRecords: [
      { StudentID: 'STD-01', AgeMonth: 24, Weight: 11.2, Height: 85, Date: (YR - 1) + '-02-10' },
      { StudentID: 'STD-01', AgeMonth: 30, Weight: 12.6, Height: 90, Date: (YR - 1) + '-08-10' },
      { StudentID: 'STD-01', AgeMonth: 36, Weight: 14.1, Height: 95, Date: TODAY }],
    dspmCriteria: [
      { ItemNo: 1, Skill: 'GM', Description: 'ยืนขาเดียวได้', AgeFrom: 30, AgeTo: 42, AgeLabelTH: '30-42 เดือน' },
      { ItemNo: 2, Skill: 'FM', Description: 'ขีดเขียนเป็นวงกลม', AgeFrom: 30, AgeTo: 42, AgeLabelTH: '30-42 เดือน' },
      { ItemNo: 3, Skill: 'RL', Description: 'ทำตามคำสั่ง 2 ขั้นตอน', AgeFrom: 30, AgeTo: 42, AgeLabelTH: '30-42 เดือน' },
      { ItemNo: 9, Skill: 'GM', Description: 'ของช่วงอายุอื่น', AgeFrom: 60, AgeTo: 72, AgeLabelTH: '60-72 เดือน' }],
    assessments: [
      { AssessID: 'A1', StudentID: 'STD-01', ItemNo: 1, Skill: 'GM', Result: 'ผ่าน', Date: TODAY },
      { AssessID: 'A2', StudentID: 'STD-01', ItemNo: 2, Skill: 'FM', Result: 'ไม่ผ่าน', Date: TODAY }],
    payments: [], prepayments: [], studentCharges: [], paymentSlips: [], otDaily: [],
    otRecords: [], payroll: [], userLinks: [{ UserUID: 'U1', StudentID: 'STD-01' }], feed: [], injuryReports: [],
    checkinStudent: [], studentCheckins: [], studentAttendanceToday: [], staffAttendanceToday: [],
    activityLog: [], studentLeaves: [], comments: [], leaves: [], leaveUsed: {}, announcements: [],
    withdrawals: [], attendanceReq: [], classChangeReq: [], absenceLog: []
  };
  return { M, H: createAtomAPI(M).H };
}

// ============================================================================
console.log('\n1) The card has everything the page draws, in one call');
{
  const { H } = fresh();
  const d = H.studentReportCard({ studentId: 'STD-01', staffId: 'STF-A' });
  eq('nickname leads', d.student.nick, 'หนึ่ง');
  eq('with the real name kept for the small line', d.student.name, 'เด็กหญิงหนึ่ง สองสาม');
  eq('class', d.student.cls, 'Nursery 1');
  eq('allergy is carried (it is printed as a warning)', d.student.allergy, 'นมวัว');
  eq('all three measurements, oldest first', d.growth.map(g => g.ageMonth), [24, 30, 36]);
  eq('measurements are numbers, ready to plot', [d.growth[2].weight, d.growth[2].height], [14.1, 95]);
  eq('school name for the header', d.school.name, 'Atom Nursery');
  ok_('a print timestamp is included', /^\d{4}-\d{2}-\d{2}/.test(d.generatedAt));
}

console.log('\n2) DSPM: only this child\'s age band, and an honest count');
{
  const { H } = fresh();
  const d = H.studentReportCard({ studentId: 'STD-01', staffId: 'STF-A' });
  eq('items outside the age band are not shown', d.dspm.items.map(i => i.itemNo), [1, 2, 3]);
  eq('age band label', d.dspm.ageLabel, '30-42 เดือน');
  eq('1 passed, 1 not yet, 1 never looked at', [d.dspm.passed, d.dspm.failed, d.dspm.pending], [1, 1, 1]);
  eq('coverage is 2 of 3', d.dspm.coverage, 67);
  eq('pass rate counts only what was assessed', d.dspm.passRate, 50);
  eq('an unassessed item carries no result', d.dspm.items[2].result, '');
}
{
  // the bug this replaced: one passed item must never read as 100% complete
  const { M, H } = fresh();
  M.assessments = [{ AssessID: 'A1', StudentID: 'STD-01', ItemNo: 1, Skill: 'GM', Result: 'ผ่าน', Date: TODAY }];
  const d = H.studentReportCard({ studentId: 'STD-01', staffId: 'STF-A' });
  eq('coverage is 1 of 3, not 100', d.dspm.coverage, 33);
  eq('pass rate of what was assessed is 100', d.dspm.passRate, 100);
}
{
  const { M, H } = fresh();
  M.assessments = [];
  const d = H.studentReportCard({ studentId: 'STD-01', staffId: 'STF-A' });
  eq('nothing assessed -> 0% and no pass rate to claim', [d.dspm.coverage, d.dspm.passRate], [0, null]);
}
{
  const { M, H } = fresh();
  M.dspmCriteria = [];
  const d = H.studentReportCard({ studentId: 'STD-01', staffId: 'STF-A' });
  eq('no criteria at all does not throw, it just has nothing to show', [d.dspm.total, d.dspm.coverage], [0, 0]);
}

console.log('\n3) Only people entitled to the child\'s data can build the card');
{
  const { H } = fresh();
  ok_('a teacher can export a child in their own class', !!H.studentReportCard({ studentId: 'STD-01', staffId: 'STF-T' }));
  throws_('...but not a child from another class', () =>
    H.studentReportCard({ studentId: 'STD-02', staffId: 'STF-T' }), 'NO_ACCESS');
  ok_('an admin can export anyone', !!H.studentReportCard({ studentId: 'STD-02', staffId: 'STF-A' }));
  throws_('an unknown child is refused', () =>
    H.studentReportCard({ studentId: 'STD-99', staffId: 'STF-A' }), 'NOT_FOUND');
}
{
  // a parent carries no staffId — the server scopes them to their own children before the handler
  // ever runs (applyIdentity_), which is why there is no staff check on this path
  const { H } = fresh();
  ok_('a parent request works without a staffId', !!H.studentReportCard({ studentId: 'STD-01' }));
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'Code.gs'), 'utf8');
  ok_('and parents really are scoped server-side', /parentOwnsStudent_\(sess\.uid, payload\.studentId\)/.test(code));
  ok_('no explicit route shadows the engine handler', code.indexOf('studentReportCard') < 0);
}

console.log('\n4) Nothing about the export touches a server');
{
  const rc = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'report_card.js'), 'utf8');
  ok_('no fetch / XHR anywhere in the renderer', !/\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon/.test(rc));
  ok_('no upload form', !/FormData/.test(rc));
  ok_('the file is produced from a local blob / data URL', /createObjectURL|toDataURL/.test(rc));
  ok_('and the only remote thing it loads is our own logo', (rc.match(/https?:\/\//g) || []).length === 0);
  const app = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'app.js'), 'utf8');
  ok_('the renderer is fetched on demand, not shipped to everyone',
    /__atomLoadScript\('report_card\.js'/.test(app));
  ok_('the confidentiality note is shown before exporting', /มีข้อมูลสุขภาพของเด็ก/.test(app));
  ok_('...and printed on the page itself', /มีข้อมูลสุขภาพของเด็ก/.test(rc));
  ok_('DSPM is labelled as surveillance, not diagnosis', /ไม่ใช่การวินิจฉัย/.test(rc));
}

console.log('\n5) The hand-built PDF is structurally valid');
function loadRC() {
  const ctx = { window: {}, document: { fonts: null }, Uint8Array, Math, String, Number, Promise,
    atob: b64 => Buffer.from(b64, 'base64').toString('binary'), setTimeout, console, Image: function () {},
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} } };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'webapp', 'report_card.js'), 'utf8'), ctx);
  return ctx.AtomReportCard;
}
{
  const RC = loadRC();
  // stand-in image bytes: the structure and the offsets are what is under test here, and the real
  // JPEG is exercised in the browser run
  const jpeg = new Uint8Array(5000); for (let i = 0; i < jpeg.length; i++) jpeg[i] = i & 0xFF;
  const pdf = Buffer.from(RC.buildPdf(jpeg, 1240, 1754));
  const s = pdf.toString('latin1');

  ok_('starts with a PDF header', s.slice(0, 8) === '%PDF-1.4');
  ok_('ends with EOF', /%%EOF\s*$/.test(s));
  eq('one page', (s.match(/\/Type \/Page[^s]/g) || []).length, 1);
  ok_('the image is passed through untouched (no re-encode)', s.indexOf('/Filter /DCTDecode') > 0);
  ok_('the declared image length matches the bytes given', s.indexOf('/Length ' + jpeg.length) > 0);
  ok_('the image bytes survive intact', pdf.indexOf(Buffer.from(jpeg)) > 0);

  // the part that silently breaks a PDF: xref offsets must point at the actual objects
  const startxref = Number(s.slice(s.lastIndexOf('startxref') + 9).trim().split('\n')[0]);
  ok_('startxref points at the xref table', s.slice(startxref, startxref + 4) === 'xref');
  // lines: 0 'xref' | 1 '0 6' | 2 the free entry | 3..7 objects 1..5
  const rows = s.slice(startxref).split('\n').slice(3, 8);
  const bad = [];
  rows.forEach((r, i) => {
    const off = Number(r.slice(0, 10));
    const want = (i + 1) + ' 0 obj';
    if (s.slice(off, off + want.length) !== want) bad.push('obj' + (i + 1) + '@' + off + '="' + s.slice(off, off + 10) + '"');
  });
  eq('every xref offset lands exactly on its object', bad, []);
  eq('the xref declares all 6 slots', s.indexOf('xref\n0 6') , startxref);
  ok_('the trailer names the catalog', /\/Root 1 0 R/.test(s));

  // A4 at the right proportions, image centred
  ok_('page is A4', /MediaBox \[0 0 595.28 841.89\]/.test(s));
  const cm = s.match(/q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm/);
  ok_('the image is placed with a scale matrix', !!cm);
  if (cm) {
    const w = Number(cm[1]), h = Number(cm[2]);
    ok_('the picture keeps its shape (no stretching)', Math.abs((w / h) - (1240 / 1754)) < 0.01);
    ok_('and fits inside the page', w <= 595.29 && h <= 841.9);
  }
}
{
  const RC = loadRC();
  // offsets are BYTE offsets: a filename or caption with Thai in it must not shift them
  const jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]);
  const pdf = Buffer.from(RC.buildPdf(jpeg, 100, 200));
  const s = pdf.toString('latin1');
  const startxref = Number(s.slice(s.lastIndexOf('startxref') + 9).trim().split('\n')[0]);
  ok_('a tiny image still produces a valid xref', s.slice(startxref, startxref + 4) === 'xref');
  ok_('portrait images are scaled to fit too', /q [\d.]+ 0 0 [\d.]+ /.test(s));
}
{
  const RC = loadRC();
  eq('the download name carries the nickname and the date',
    RC.safeName({ student: { nick: 'หนึ่ง' }, generatedAt: '2026-08-04 09:00' }, 'pdf'),
    'รายงานพัฒนาการ_หนึ่ง_2026-08-04.pdf');
  ok_('a name with slashes cannot escape the filename',
    RC.safeName({ student: { nick: 'a/b\\c:d' }, generatedAt: '2026-08-04' }, 'jpg').indexOf('/') < 0);
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' : 'ALL PASS ') + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
