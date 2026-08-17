/**
 * tools/test_dspm_meta_bigclean.js
 *   node tools/test_dspm_meta_bigclean.js
 *
 * 1. A DSPM result is SOMEONE'S JUDGEMENT, ON A DAY. The row now carries who made it and the moment
 *    it was recorded, and an admin can add a note to ONE item — beside the teacher's result, never
 *    replacing it, because a second reader disagreeing is information and overwriting would destroy
 *    the very thing being discussed.
 *
 * 2. THE BUG (reported 2026-08-15, a Saturday): a Big Cleaning day is a working Saturday for the
 *    STAFF. No child comes to school. Treating it as "open" full stop left the children's drop-off /
 *    pick-up buttons live on a day the nursery was shut to them.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), eng = R('webapp/engine.js'), cfg = R('src/Config.gs'),
      ci = R('src/Checkin.gs'), par = R('src/Parent.gs'), code = R('src/Code.gs'), api = R('webapp/api.js');

const p2 = n => String(n).padStart(2, '0');
const TODAY = (() => { const d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); })();
// a Saturday and a weekday that are definitely not today
const nextDow = (want) => { const d = new Date(); d.setDate(d.getDate() + 1);
  for (let i = 0; i < 14; i++) { if (d.getDay() === want) return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); d.setDate(d.getDate() + 1); }
  return TODAY; };
const SAT = nextDow(6), WED = nextDow(3);

function boot(cfgExtra) {
  const M = {
    config: Object.assign({ Plans: [], LeaveQuota: {}, BigCleaningDays: [] }, cfgExtra || {}),
    students: [{ StudentID: 'S1', NameTH: 'บีม', Nickname: 'บีม', Class: 'Nursery 1', Status: 'ACTIVE', DOB: '2023-01-15', ParentID: 'PAR-1' }],
    parents: [{ ParentID: 'PAR-1', Name: 'แม่', StudentID: 'S1' }],
    staff: [
      { StaffID: 'T1', NameTH: 'ครูเอ มานะ', Nickname: 'เอ', Role: 'Teacher', PositionLevel: 'Officer', StartDate: '2024-01-01' },
      { StaffID: 'A1', NameTH: 'อารยา ผ่องใส', Role: 'Admin', PositionLevel: 'Admin', StartDate: '2024-01-01' }
    ],
    dspmCriteria: [
      { ItemNo: 51, AgeFrom: 24, AgeTo: 60, AgeLabelTH: '24-60 เดือน', Skill: 'GM', Description: 'ยืนขาเดียว' },
      { ItemNo: 52, AgeFrom: 24, AgeTo: 60, AgeLabelTH: '24-60 เดือน', Skill: 'FM', Description: 'วาดวงกลม' }
    ],
    assessments: [], classes: [{ ClassName: 'Nursery 1', TeacherID: 'T1' }],
    userLinks: [], leaves: [], payments: [], otDaily: [], studentCharges: [], prepayments: [],
    paymentSlips: [], checkinStudent: [], journals: [], comments: [], holidays: [], staffGroups: [],
    workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [], payroll: [], payrollConfig: {},
    studentLeaves: [], absenceLog: [], activityLog: [], announcements: [], notifications: [], vaccines: [],
    growth: [], growthRecords: [], classChanges: [], timeRequests: [], attendanceReq: [], adminInbox: [],
    foodMenus: [], foodItems: [], surveys: [], surveyResponses: [], injuries: [], injuryReports: [],
    insurance: [], bigCleaning: [], departments: [], permissions: {}, feed: [], calendar: [],
    studentAttendanceToday: [], studentCheckins: []
  };
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  const H = ctx.createAtomAPI(M, {}).H;
  if (typeof H.commentAssessment !== 'function') H.commentAssessment = function () { return { missing: true }; };
  return { H, M };
}
function grab(fn) { let e = null; try { fn(); } catch (x) { e = x.message || String(x); } return e; }

console.log('\n=== 1. an assessment says WHO and WHEN ===');
{
  const { H, M } = boot();
  const r = H.submitAssessment({ studentId: 'S1', staffId: 'T1', results: [{ itemNo: 51, result: 'pass' }] });
  const row = M.assessments[0];
  eq('the result is stored', row.Result, 'ผ่าน');
  eq('…with the assessor’s name, not just an id', row.TeacherName, 'ครูเอ มานะ');
  eq('…and their id too', row.TeacherID, 'T1');
  ok_('…and a timestamp with the time of day, not only the date', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(String(row.Timestamp || '')));
  eq('the day is still there for the chart', row.Date, TODAY);
  eq('the call says who saved it', r.by, 'ครูเอ มานะ');
  const st = H.dspmStatus({ studentId: 'S1' });
  const i51 = st.items.find(i => i.itemNo === 51);
  eq('the screen is told the assessor', i51.by, 'ครูเอ มานะ');
  ok_('…and the moment', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(String(i51.at || '')));
  const i52 = st.items.find(i => i.itemNo === 52);
  eq('an unassessed item carries no name', [i52.by, i52.at], ['', '']);
}
ok_('the columns exist to hold it', /'TeacherName', 'Timestamp', 'AdminComment', 'CommentBy', 'CommentAt'/.test(cfg));

console.log('\n=== 2. the admin’s note, per item ===');
{
  const { H, M } = boot();
  H.submitAssessment({ studentId: 'S1', staffId: 'T1', results: [{ itemNo: 51, result: 'fail' }] });
  ok_('a teacher may not write one', /NO_PERMISSION|เฉพาะแอดมิน/.test(
    grab(() => H.commentAssessment({ staffId: 'T1', studentId: 'S1', itemNo: 51, comment: 'x' })) || ''));
  const r = H.commentAssessment({ staffId: 'A1', studentId: 'S1', itemNo: 51, comment: 'ขอให้ประเมินซ้ำอีกครั้ง' });
  eq('the admin’s note is saved', r.comment, 'ขอให้ประเมินซ้ำอีกครั้ง');
  eq('…signed', r.by, 'อารยา ผ่องใส');
  ok_('…and dated', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(String(r.at || '')));
  eq('THE RESULT IS UNTOUCHED — the note sits beside it', M.assessments[0].Result, 'ไม่ผ่าน');
  eq('the teacher’s name is still on the result', M.assessments[0].TeacherName, 'ครูเอ มานะ');
  const i51 = H.dspmStatus({ studentId: 'S1' }).items.find(i => i.itemNo === 51);
  eq('the screen can read it back', [i51.comment, i51.commentBy], ['ขอให้ประเมินซ้ำอีกครั้ง', 'อารยา ผ่องใส']);
  // it is a note on ONE item
  const i52 = H.dspmStatus({ studentId: 'S1' }).items.find(i => i.itemNo === 52);
  eq('…and only on that item', i52.comment, '');
  H.commentAssessment({ staffId: 'A1', studentId: 'S1', itemNo: 51, comment: '' });
  const cleared = H.dspmStatus({ studentId: 'S1' }).items.find(i => i.itemNo === 51);
  eq('an empty note removes it', [cleared.comment, cleared.commentBy, cleared.commentAt], ['', '', '']);
  eq('…and STILL does not touch the result', M.assessments[0].Result, 'ไม่ผ่าน');
}
{
  const { H } = boot();
  ok_('a note on an item never assessed is refused', /NOT_FOUND|ยังไม่มีผลประเมิน/.test(
    grab(() => H.commentAssessment({ staffId: 'A1', studentId: 'S1', itemNo: 51, comment: 'x' })) || ''));
}
{
  const { H, M } = boot();
  H.submitAssessment({ studentId: 'S1', staffId: 'T1', results: [{ itemNo: 51, result: 'fail' }] });
  M.assessments[0].Date = '2020-01-01';                       // an old result
  H.submitAssessment({ studentId: 'S1', staffId: 'T1', results: [{ itemNo: 51, result: 'pass' }] });
  H.commentAssessment({ staffId: 'A1', studentId: 'S1', itemNo: 51, comment: 'ดีขึ้นมาก' });
  // a build without the note must FAIL cleanly, not crash the run
  eq('the note lands on the LATEST result, which is the one on screen',
    (M.assessments.find(a => a.AdminComment === 'ดีขึ้นมาก') || {}).Result, 'ผ่าน');
  eq('…and the old one is left alone', (M.assessments.find(a => a.Date === '2020-01-01') || {}).AdminComment, '');
}
ok_('it is classified as a WRITE on both sides — "comment" is not a mutating verb',
  /commentAssessment: 1/.test(code) && /commentAssessment: 1/.test(api));
ok_('the screen shows the assessor and the note', /function assessMetaHTML\(i, sid\)/.test(app));
ok_('…on the teacher’s screen AND the admin’s', (app.match(/\$\{assessMetaHTML\(i, sid\)\}/g) || []).length === 2);
ok_('only an admin is offered the button', /isAdmin\(\)\n\s*\? `<button class="btn sm outline" style="margin-top:6px" onclick="A_assessComment/.test(app));
ok_('the note is visibly a note, not a result', /💬 \$\{EN\(\)\?'Admin note':'ความเห็นแอดมิน'\}/.test(app));

console.log('\n=== 3. a Big Cleaning day is for the STAFF, not the children ===');
{
  const { H } = boot({ BigCleaningDays: [TODAY] });
  const d = H.schoolDay({});
  eq('the staff answer: open, they are working', d.closed, false);
  eq('THE CHILDREN’S ANSWER on a weekday: also open', d.closedForStudents, new Date(TODAY + 'T00:00:00').getDay() % 6 === 0);
}
{
  // the reported case: a SATURDAY that is a Big Cleaning day
  const { H, M } = boot({ BigCleaningDays: [SAT] });
  const d = H.schoolDay({ date: SAT });
  eq('the staff work it', d.closed, false);
  eq('the nursery is SHUT to the children', d.closedForStudents, true);
  eq('…and the card can say why', d.reason, 'วันหยุดสุดสัปดาห์');
  eq('it is still flagged as a cleaning day', d.bigCleaning, true);
}
{
  const { H, M } = boot({ BigCleaningDays: [TODAY] });
  // make today a holiday so the students' side is closed whatever day of the week it is
  M.holidays.push({ Date: TODAY, NameTH: 'วันแม่แห่งชาติ' });
  eq('a HOLIDAY that is also a cleaning day: staff in', H.schoolDay({}).closed, false);
  eq('…children out', H.schoolDay({}).closedForStudents, true);
  ok_('and a parent tapping anyway is refused',
    /SCHOOL_CLOSED|โรงเรียนหยุด/.test(grab(() => H.parentCheckin({ studentId: 'S1', type: 'IN', lat: 0, lng: 0, parentId: 'PAR-1' })) || ''));
  ok_('…while a teacher can still clock in',
    !/SCHOOL_CLOSED/.test(grab(() => H.staffCheckin({ staffId: 'T1', lat: 0, lng: 0 })) || ''));
}
{
  const { H } = boot();                                        // ordinary weekday, no cleaning day
  ok_('nothing changes on a normal day — the parent can check in',
    !/SCHOOL_CLOSED/.test(grab(() => H.parentCheckin({ studentId: 'S1', type: 'IN', lat: 0, lng: 0, parentId: 'PAR-1' })) || '') ||
    new Date(TODAY + 'T00:00:00').getDay() % 6 === 0);
}
// v244: + atTime, so a half-day holiday refuses only during its own window
ok_('the rule is written down once', /const schoolClosedFor_ = \(d, forStudents, atTime\)/.test(eng));
ok_('the parent path asks the children’s question', /assertSchoolOpen_\(null, true\);   \/\/ a Big Cleaning day is a working day for STAFF, not for children/.test(eng));
ok_('the GAS route asks it too', /assertSchoolOpen_\(null, true\);/.test(par) && /function assertSchoolOpen_\(d, forStudents\)/.test(ci));
ok_('…and the staff routes still do not', (ci.match(/assertSchoolOpen_\(\);/g) || []).length === 2);
ok_('the parent card reads closedForStudents', /window\._SCHOOLDAY\.closedForStudents/.test(app));
ok_('the teacher’s on-behalf button is closed too', /const stdClosed = !!\(window\._SCHOOLDAY && window\._SCHOOLDAY\.closedForStudents\)/.test(app));
ok_('…and says the nursery is shut to the children', /วันนี้โรงเรียนหยุดสำหรับนักเรียน/.test(app));

console.log('\n=== 4. nothing else moved ===');
{
  const { H, M } = boot();
  H.submitAssessment({ studentId: 'S1', staffId: 'T1', results: [{ itemNo: 51, result: 'pass' }, { itemNo: 52, result: 'fail' }] });
  eq('both results saved', M.assessments.length, 2);
  H.submitAssessment({ studentId: 'S1', staffId: 'T1', results: [{ itemNo: 51, result: 'nottested' }] });
  eq('"not assessed" still clears the item', M.assessments.filter(a => a.ItemNo === 51).length, 0);
  eq('…and the other one is untouched', M.assessments.filter(a => a.ItemNo === 52).length, 1);
  eq('the due-list still works off it', H.studentAlerts({ staffId: 'A1' }).dspmDue.length, 1);
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
