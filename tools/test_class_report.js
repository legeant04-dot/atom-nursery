/**
 * tools/test_class_report.js — the class report the school did not have, and the PDF/JPG exports.
 *   node tools/test_class_report.js
 *
 * The figure the school ACTS on is consecutive absence: several days in a row is a phone call home.
 * Counting it needs the school days in order, skipping weekends and holidays — otherwise a Friday
 * and the following Monday read as four days apart instead of two in a row.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = R('webapp/app.js'), rc = R('webapp/report_card.js'), code = R('src/Code.gs');

/* The 1st of September, not the 31st of August. The intent has always been "the month is finished,
 * so every school day counts" — and the 31st was itself a Monday, i.e. TODAY. Since v285 a child who
 * has not been dropped off yet today is not an absence (the day is not over; the staff report has
 * always worked this way), so asking about August from inside August would leave one day undecided
 * and every total here one short. Standing outside the month is what the comment always meant. */
const TODAY = '2026-09-01';
function boot(over) {
  const M = {
    config: { Plans: [], LeaveQuota: {}, Departments: 'Nursery 1' },
    students: [], parents: [], userLinks: [], staff: [], leaves: [], payments: [], otDaily: [],
    studentCharges: [], prepayments: [], paySlips: [], checkinStudent: [], journals: [], comments: [],
    holidays: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    payroll: [], payrollConfig: {}, studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [],
    announcements: [], notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [],
    classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [],
    surveyResponses: [], injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {},
    feed: [], calendar: [], classes: []
  };
  Object.assign(M, over || {});
  const ctx = { window: {}, console, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.Date = class extends Date { constructor(...a){ if(!a.length) super(TODAY+'T18:00:00'); else super(...a); } static now(){ return new Date(TODAY+'T18:00:00').getTime(); } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(R('webapp/engine.js'), ctx);
  return ctx.createAtomAPI(M, {}).H;
}
const ADMIN = { StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', RequireCheckin: false };
const kid = (id, cls, over) => Object.assign({ StudentID: id, NameTH: id, Nickname: id, Class: cls, Status: 'ACTIVE', DOB: '2024-08-01' }, over || {});
const IN = (sid, d) => ({ Date: d, Time: '08:00', StudentID: sid, Type: 'IN' });
const find = (r, sid) => r.classes.reduce((a,c)=>a.concat(c.students),[]).find(s=>s.studentId===sid);

console.log('\n1) The report exists, grouped by class');
{
  const H = boot({ staff: [ADMIN], students: [kid('เอ','Nursery 1'), kid('บี','Nursery 1'), kid('ซี','Nursery 2')] });
  const r = H.studentMonthReport({ month: '2026-08', staffId: 'ADM' });
  eq('grouped by class', r.classes.map(c=>c.className).sort(), ['Nursery 1','Nursery 2']);
  eq('with a headcount each', r.classes.map(c=>c.count).sort(), [1,2]);
  eq('and a school total', r.totals.students, 3);
  // August 2026: 31 days, 10 of them weekend → 21 school days
  eq('school days exclude weekends', r.schoolDays, 21);
}
{
  const H = boot({ staff: [ADMIN], students: [kid('เอ','Nursery 1')], holidays: [{ Date: '2026-08-12', NameTH: 'วันแม่' }] });
  eq('a public holiday is not a school day', H.studentMonthReport({ month: '2026-08', staffId: 'ADM' }).schoolDays, 20);
}

console.log('\n2) Present / absent / sick / personal');
{
  const H = boot({
    staff: [ADMIN], students: [kid('เอ','Nursery 1')],
    checkinStudent: [IN('เอ','2026-08-03'), IN('เอ','2026-08-04'), IN('เอ','2026-08-05')],
    studentLeaves: [
      { LeaveID:'a', StudentID:'เอ', Date:'2026-08-06', Type:'ลาป่วย', Reason:'ไข้' },
      { LeaveID:'b', StudentID:'เอ', Date:'2026-08-07', Type:'ลากิจ' },
      { LeaveID:'c', StudentID:'เอ', Date:'2026-08-10', Type:'' }          // unlabelled
    ]
  });
  const s = find(H.studentMonthReport({ month: '2026-08', staffId: 'ADM' }), 'เอ');
  eq('days present', s.present, 3);
  eq('sick leave', s.sick, 1);
  eq('personal leave counts an unlabelled leave too', s.personal, 2);
  eq('everything else in the month is absence', s.absent, 21 - 3 - 3);
  eq('...and the four add up to the school days', s.present + s.sick + s.personal + s.absent, 21);
}

console.log('\n3) Consecutive absence — the number the school acts on');
{
  // present on the 3rd, then away the 4th, 5th, 6th, back on the 7th
  const H = boot({
    staff: [ADMIN], students: [kid('เอ','Nursery 1')],
    checkinStudent: ['2026-08-03','2026-08-07','2026-08-11','2026-08-12','2026-08-13','2026-08-14',
                     '2026-08-17','2026-08-18','2026-08-19','2026-08-20','2026-08-21','2026-08-24',
                     '2026-08-25','2026-08-26','2026-08-27','2026-08-28','2026-08-31'].map(d=>IN('เอ',d))
  });
  const s = find(H.studentMonthReport({ month: '2026-08', staffId: 'ADM' }), 'เอ');
  eq('three days in a row is reported as three', s.maxConsecutive, 3);
  eq('...and the 10th is the only other gap', s.absent, 4);
}
{
  // absent Friday the 7th and Monday the 10th: a weekend between them does NOT break the run
  const all = [];
  for (let d = 3; d <= 31; d++) { const ds = '2026-08-' + String(d).padStart(2,'0');
    const dow = new Date(ds).getDay(); if (dow===0||dow===6) continue;
    if (ds==='2026-08-07' || ds==='2026-08-10') continue; all.push(IN('เอ', ds)); }
  const H = boot({ staff: [ADMIN], students: [kid('เอ','Nursery 1')], checkinStudent: all });
  const s = find(H.studentMonthReport({ month: '2026-08', staffId: 'ADM' }), 'เอ');
  eq('Friday then Monday is TWO days in a row, not four', s.maxConsecutive, 2);
}
{
  const H = boot({ staff: [ADMIN], students: [kid('เอ','Nursery 1'), kid('บี','Nursery 1')],
    checkinStudent: [] });   // nobody came all month
  const r = H.studentMonthReport({ month: '2026-08', staffId: 'ADM' });
  eq('every child absent all month is flagged to follow up', r.totals.watch, 2);
  eq('...and the class says how many', r.classes[0].watch, 2);
}
{
  /* a child on temporary leave is not expected in — that is not an absence
   * PauseTo is the day they COME BACK (v254), so it is the first day an absence can count again.
   * They return on the 2nd of September rather than the 1st for one reason: the `paused` flag on
   * the row means "away RIGHT NOW", and TODAY is the 1st — a child whose leave ends this morning is
   * back, so the flag would (correctly) be false and the row would stop being about this case. */
  const H = boot({ staff: [ADMIN],
    students: [kid('เอ','Nursery 1', { Status:'PAUSED', PauseFrom:'2026-08-01', PauseTo:'2026-09-02' })] });
  const s = find(H.studentMonthReport({ month: '2026-08', staffId: 'ADM' }), 'เอ');
  eq('temporary leave is not absence', s.absent, 0);
  eq('...nor a run to follow up', s.maxConsecutive, 0);
  ok_('but the child is still listed, marked', s.paused === true);
}

console.log('\n4) Growth and DSPM sit beside the attendance');
{
  const H = boot({
    staff: [ADMIN], students: [kid('เอ','Nursery 1'), kid('บี','Nursery 1')],
    growthRecords: [
      { Date:'2026-04-02', StudentID:'เอ', AgeMonth:20, Weight:8.5, Height:70 },
      { Date:'2026-07-02', StudentID:'เอ', AgeMonth:23, Weight:9.2, Height:74 }
    ],
    dspmCriteria: [
      { ItemNo:1, AgeFrom:0, AgeTo:60, Skill:'GM', Description:'x', AgeLabelTH:'a' },
      { ItemNo:2, AgeFrom:0, AgeTo:60, Skill:'FM', Description:'y', AgeLabelTH:'a' },
      { ItemNo:3, AgeFrom:0, AgeTo:60, Skill:'RL', Description:'z', AgeLabelTH:'a' }
    ],
    assessments: [
      { StudentID:'เอ', ItemNo:1, Result:'ผ่าน', Date:'2026-08-01' },
      { StudentID:'เอ', ItemNo:2, Result:'ไม่ผ่าน', Date:'2026-08-01' }
    ]
  });
  const r = H.studentMonthReport({ month: '2026-08', staffId: 'ADM' });
  const a = find(r,'เอ'), b = find(r,'บี');
  eq('the LATEST measurement, not the first', [a.weight, a.height], [9.2, 74]);
  eq('...with the date it was taken', a.measuredAt, '2026-07-02');
  eq('a child never measured says so rather than showing zero', [b.weight, b.height, b.measuredAt], [0, 0, '']);
  eq('DSPM: how many items apply', a.dspmTotal, 3);
  eq('...how many were assessed', a.dspmDone, 2);
  eq('...and how many passed — "ไม่ผ่าน" is not a pass', a.dspmPass, 1);
  eq('a child with nothing assessed reads 0 of 3, not blank', [b.dspmTotal, b.dspmDone], [3, 0]);
  eq('the class counts who still has DSPM outstanding', r.classes[0].dspmPending, 2);
  eq('...and who has never been weighed', r.classes[0].noGrowth, 1);
}

console.log('\n5) It is admin-only, like the staff report');
{
  const H = boot({ staff: [ADMIN, { StaffID:'T1', NameTH:'ครู', Role:'Teacher' }, { StaffID:'OB', NameTH:'ผู้ตรวจ', Role:'Observer' }],
    students: [kid('เอ','Nursery 1')] });
  let denied = false;
  try { H.studentMonthReport({ month:'2026-08', staffId:'T1' }); } catch (e) { denied = /แอดมิน/.test(e.message); }
  ok_('a teacher cannot pull the whole school', denied);
  ok_('an admin can', !!H.studentMonthReport({ month:'2026-08', staffId:'ADM' }).classes);
  ok_('an Observer can — it is a read', !!H.studentMonthReport({ month:'2026-08', staffId:'OB' }).classes);
  ok_('and admin-only at the route', /studentMonthReport: 1/.test(code));
}

console.log('\n6) Export: one A4 renderer, used by both reports');
{
  ok_('there is a generic table renderer', /function renderTable\(spec\)/.test(rc));
  ok_('...and a save that produces PDF or JPG', /function saveTable\(spec, kind\)/.test(rc));
  ok_('both are exported', /renderTable: renderTable,[\s\S]{0,40}saveTable: saveTable/.test(rc));
  ok_('a long report runs onto more sheets rather than being cut', /function room\(px\) \{ if \(y \+ px > H - 70\)/.test(rc));
  ok_('every sheet repeats the title, so a loose page still says what it is', /function newPage\(\)[\s\S]{0,600}text\(ctx, spec\.title/.test(rc));
  ok_('...and carries a page number', /\(i \+ 1\) \+ ' \/ ' \+ pagesOut\.length/.test(rc));
  ok_('the column header repeats on every sheet', /room\(px\)[\s\S]{0,80}headerRow\(\)/.test(rc));
  ok_('a PDF is ONE file even when the table runs to several sheets', /kind === 'pdf'[\s\S]{0,220}buildPdf\(sheets\)/.test(rc));
  ok_('a JPEG is one file per sheet, numbered so none is mistaken for the whole thing',
    /_' \+ \(i \+ 1\) \+ 'of' \+ r\.pageCount/.test(rc));
  ok_('a long name is clipped instead of running into the next column', /clipText\(ctx, v,/.test(rc));

  ok_('the staff month can be exported', /window\.A_staffMonthExport = \(kind\)/.test(app));
  ok_('the class report can be exported', /window\.A_studentReportExport = \(kind\)/.test(app));
  ok_('both offer PDF and JPG', (app.match(/A_staffMonthExport\('pdf'\)|A_staffMonthExport\('jpg'\)|A_studentReportExport\('pdf'\)|A_studentReportExport\('jpg'\)/g)||[]).length === 4);
  ok_('the renderer is fetched only when a report is actually exported', /const withReportKit = fn => __atomLoadScript\('report_card\.js'/.test(app));
  ok_('the class report is on the student tab', /'📊',EN\(\)\?'Class report':'สรุปรายชั้นเรียน','A_studentReport\(\)'/.test(app));
  // it is built on the device — no report of a child leaves the school
  ok_('nothing is uploaded to build it', !/fetch\(|XMLHttpRequest/.test(rc));
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' : 'ALL PASS ') + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
