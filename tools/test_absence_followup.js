/**
 * tools/test_absence_followup.js — the child nobody was told to chase, and the trail that was
 * overwritten every time somebody did.
 *   node tools/test_absence_followup.js
 *
 * ASKED 2026-09-12: "ฟังก์ชันการติดตามนักเรียนของ Role คุณครูไม่มีอะไรแจ้งเตือนให้คุณครูทราบว่า
 * ต้องติดตามใคร ขาดไปแล้วกี่วัน เพิ่ม Notification วงกลมสีแดงบนมุมของเมนู และเพิ่มในส่วนของ log ว่า
 * ใครเป็นผู้ติดตาม วันไหน ติดตามแล้ว และรายงานในส่วนของดำเนินการ Admin … ว่าตอนนี้มีนักเรียนกี่คนที่
 * ขาดแล้ว มากกว่า 2 วัน 5 วัน ในแต่ละนักเรียนเพิ่มการแนบรูป (ใบรับรองแพทย์)"
 *
 * Three faults, one screen. It could be read; it could not be USED.
 *
 *  1. NOTHING POINTED AT IT. The screen has existed for months behind a button on the teacher's home
 *     page. A child could be away a fortnight and the only way to find out was to open it for some
 *     other reason.
 *
 *  2. IT SHOWED THE WHOLE SCHOOL TO A TEACHER WHO COVERS ONE ROOM. Thirty names from six classes is
 *     not a list of people to ring; it is a list to scroll past. This is also a privacy question —
 *     the trail carries medical certificates.
 *
 *  3. ABSENCE_FOLLOWUP KEEPS ONE ROW PER CHILD AND OVERWRITES IT. So it could say where a child
 *     stood and never who had already tried: two teachers ring the same family, and the school
 *     cannot show what was done. The state row stays; the trail is new, and append-only.
 *
 * The number that has to be right is the one in the red circle. A badge that counts work already
 * finished is a badge people stop reading, so `watch` excludes ติดตามแล้ว / ลายาว / ออกกลางคัน — and
 * it is computed from the SAME rows the screen draws, so the circle and the list cannot disagree.
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
const eng = R('webapp/engine.js'), app = R('webapp/app.js'),
      cfgGs = R('src/Config.gs'), gasEng = R('src/GasEngine.gs'), codeGs = R('src/Code.gs');

function boot(over) {
  over = over || {};
  const M = {
    config: Object.assign({ Plans: [], LeaveQuota: {}, BigCleaningDays: [], Departments: '' }, over.config || {}),
    students: over.students || [],
    studentLeaves: over.studentLeaves || [], absenceLog: over.absenceLog || [],
    absenceFollowups: over.absenceFollowups || [], absenceFollowupLogs: over.absenceFollowupLogs || [],
    staff: over.staff || [], classes: over.classes || [{ ClassName: 'Nursery 1' }, { ClassName: 'Nursery 2' }],
    classCover: [], payments: [], studentCharges: [], prepayments: [], otDaily: [], paymentSlips: [],
    otRecords: [], parents: [], userLinks: [], payroll: [], payrollConfig: {}, checkinStudent: [],
    studentCheckins: over.studentCheckins || [], studentAttendanceToday: [], journals: [], comments: [],
    staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [], leaves: [],
    dspmCriteria: [], activityLog: [], announcements: [], notifications: [], vaccines: [], growth: [],
    growthRecords: [], assessments: [], classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [],
    foodItems: [], surveys: [], surveyResponses: [], injuries: [], insurance: [], bigCleaning: [],
    departments: [], permissions: {}, feed: [], calendar: [], holidays: [], holidayAttend: [],
    pickupPersons: [], vaccineRecords: []
  };
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
const kid = (id, nick, cls) => ({ StudentID: id, NameTH: 'เด็ก ' + id, Nickname: nick, Class: cls || 'Nursery 1',
  Status: 'ACTIVE', ParentID: 'PAR-' + id, DOB: '2023-01-01' });
const away = (id, dates) => dates.map(d => ({ StudentID: id, Date: d, Type: 'leave', Reason: 'ป่วย' }));
const TEACHER = { StaffID: 'T1', NameTH: 'ครูเอ', Role: 'Teacher', Status: 'ACTIVE', Department: 'Nursery 1', Classes: 'Nursery 1' };
const HEAD    = { StaffID: 'T9', NameTH: 'ครูใหญ่', Role: 'Teacher', Status: 'ACTIVE', Department: '*' };
const ADMIN   = { StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE' };

console.log('\n1) a teacher is told about THEIR OWN rooms, and nobody else\'s');
{
  const { H } = boot({
    students: [kid('S1', 'เอ', 'Nursery 1'), kid('S2', 'บี', 'Nursery 2')],
    studentLeaves: [].concat(away('S1', ['2026-09-01', '2026-09-02', '2026-09-03']),
                             away('S2', ['2026-09-01', '2026-09-02', '2026-09-03'])),
    staff: [TEACHER, HEAD, ADMIN], classes: [{ ClassName: 'Nursery 1', TeacherID: 'T1' }, { ClassName: 'Nursery 2' }]
  });
  eq('the class teacher sees the child in their room', H.absenceReport({ staffId: 'T1' }).map(x => x.studentId), ['S1']);
  eq('...the head teacher sees both', H.absenceReport({ staffId: 'T9' }).map(x => x.studentId).sort(), ['S1', 'S2']);
  eq('...and so does the admin', H.absenceReport({ staffId: 'ADM' }).map(x => x.studentId).sort(), ['S1', 'S2']);
  /* ASKING WITH NO staffId STILL ANSWERS FOR THE WHOLE SCHOOL. The daily digest and the admin
   * dashboard have called it that way since it was written; scoping by default would silently
   * shrink the school's own report to nothing. */
  eq('asking with nobody named is still the whole school', H.absenceReport({}).map(x => x.studentId).sort(), ['S1', 'S2']);
}

console.log('\n2) the red circle counts work that is STILL OUTSTANDING');
{
  const base = {
    students: [kid('S1', 'เอ'), kid('S2', 'บี'), kid('S3', 'ซี'), kid('S4', 'ดี')],
    studentLeaves: [].concat(
      away('S1', ['2026-09-01', '2026-09-02']),                                            // 2 days
      away('S2', ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-08']), // 6 days
      away('S3', ['2026-09-01', '2026-09-02', '2026-09-03'])),                             // 3 days
    absenceFollowups: [{ StudentID: 'S3', Note: 'คุยกับคุณแม่แล้ว', Status: 'ติดตามแล้ว', Date: '2026-09-04' }],
    staff: [ADMIN]
  };
  const w = boot(base).H.absenceWatchCount({ staffId: 'ADM' });
  eq('three children are away 2 days or more', w.ge2, 3);
  eq('...one of them for more than five', w.ge5, 1);
  eq('...one has already been dealt with', w.done, 1);
  eq('...so the circle shows two, not three', w.watch, 2);
  // S4 never missed a day and must not be counted anywhere
  eq('a child who has not missed a day is in none of it', boot(base).H.absenceReport({}).some(x => x.studentId === 'S4'), false);
  /* THE CIRCLE AND THE LIST ARE THE SAME ROWS. absenceWatchCount calls absenceReport rather than
   * re-deriving the count, which is the only way a badge of 3 over a screen showing 2 is impossible.
   * Every summary tile in this app that was ever wrong was wrong because it counted separately. */
  ok_('the count is derived from the report, not computed a second way',
    /absenceWatchCount: p => \{\n\s+const rows=H\.absenceReport\(\{minDays:2, staffId:/.test(eng));
  // ...and it is scoped like the report, or a teacher's badge would count another room's children
  const sc = boot({
    students: [kid('S1', 'เอ', 'Nursery 1'), kid('S2', 'บี', 'Nursery 2')],
    studentLeaves: [].concat(away('S1', ['2026-09-01', '2026-09-02']), away('S2', ['2026-09-01', '2026-09-02'])),
    staff: [TEACHER], classes: [{ ClassName: 'Nursery 1', TeacherID: 'T1' }, { ClassName: 'Nursery 2' }]
  });
  eq('a teacher\'s badge counts only their own room', sc.H.absenceWatchCount({ staffId: 'T1' }).watch, 1);
}

console.log('\n3) THE TRAIL — every follow-up is kept, and says who did it');
{
  const b = boot({
    students: [kid('S1', 'เอ')],
    studentLeaves: away('S1', ['2026-09-01', '2026-09-02', '2026-09-03']),
    staff: [TEACHER, ADMIN], classes: [{ ClassName: 'Nursery 1', TeacherID: 'T1' }]
  });
  b.H.setAbsenceFollowup({ studentId: 'S1', note: 'โทรครั้งแรก ไม่รับสาย', status: 'กำลังติดตาม', staffId: 'T1' });
  b.H.setAbsenceFollowup({ studentId: 'S1', note: 'คุณแม่ส่งใบรับรองแพทย์', status: 'ติดตามแล้ว', staffId: 'T1',
    photo: 'data:image/jpeg;base64,AAAA' });
  eq('the state row still says where the child stands', b.M.absenceFollowups.length, 1);
  eq('...and it is the LATEST status', b.M.absenceFollowups[0].Status, 'ติดตามแล้ว');
  /* THE HALF THAT DID NOT EXIST. Two conversations, two rows — the first note is not destroyed by
   * the second, which is what "ใครเป็นผู้ติดตาม วันไหน" needs in order to have an answer at all. */
  eq('both follow-ups are kept', b.M.absenceFollowupLogs.length, 2);
  eq('...the first one still says what happened', b.M.absenceFollowupLogs[0].Note, 'โทรครั้งแรก ไม่รับสาย');
  eq('...and both name the teacher who did it', b.M.absenceFollowupLogs.map(l => l.ByName), ['ครูเอ', 'ครูเอ']);
  ok_('...with a date and a time on each', b.M.absenceFollowupLogs.every(l => /^\d{4}-\d{2}-\d{2}$/.test(l.Date) && /^\d{2}:\d{2}$/.test(l.Time)));
  /* THE CERTIFICATE IS ON THE LOG ROW, NOT THE STATE ROW. Put it on the child and the next
   * follow-up overwrites it — the school would collect a medical certificate and lose it the moment
   * anybody typed the next note. */
  eq('the certificate is attached to the follow-up it belongs to', b.M.absenceFollowupLogs[1].Photo, 'data:image/jpeg;base64,AAAA');
  eq('...and the earlier one, which had none, is untouched', b.M.absenceFollowupLogs[0].Photo, '');
  eq('the state row never carries a photo, so it cannot overwrite one', b.M.absenceFollowups[0].Photo, undefined);

  const log = b.H.absenceFollowupLog({ studentId: 'S1', staffId: 'T1' });
  eq('the trail reads back newest first', log.map(l => l.note), ['คุณแม่ส่งใบรับรองแพทย์', 'โทรครั้งแรก ไม่รับสาย']);
  eq('...naming the child by nickname', log[0].nick, 'เอ');
  eq('...and the person who followed up', log[0].by, 'ครูเอ');
  // the report carries the newest entry, so the card can say who tried WITHOUT a second round trip
  const rep = b.H.absenceReport({ staffId: 'T1' })[0];
  eq('the card knows who last followed this up', rep.followBy, 'ครูเอ');
  eq('...how many times anyone has', rep.followCount, 2);
  eq('...and how many documents are attached', rep.docs, 1);
}
{
  // ...and the trail is scoped too: it carries children's names and their medical certificates
  const b = boot({
    students: [kid('S1', 'เอ', 'Nursery 1'), kid('S2', 'บี', 'Nursery 2')],
    absenceFollowupLogs: [
      { LogID: 'L1', StudentID: 'S1', Date: '2026-09-02', Time: '09:00', ByStaffID: 'T1', ByName: 'ครูเอ', Status: '', Note: 'a', Photo: '' },
      { LogID: 'L2', StudentID: 'S2', Date: '2026-09-02', Time: '09:00', ByStaffID: 'T2', ByName: 'ครูบี', Status: '', Note: 'b', Photo: '' }],
    staff: [TEACHER, ADMIN], classes: [{ ClassName: 'Nursery 1', TeacherID: 'T1' }, { ClassName: 'Nursery 2' }]
  });
  eq('a teacher reads back only their own rooms', b.H.absenceFollowupLog({ staffId: 'T1' }).map(l => l.studentId), ['S1']);
  eq('...and the admin the lot', b.H.absenceFollowupLog({ staffId: 'ADM' }).map(l => l.studentId).sort(), ['S1', 'S2']);
}

console.log('\n4) the sheet exists, or the first teacher to chase a family writes into nothing');
{
  /* writeRows_ drops a collection whose sheet is missing IN SILENCE — the teacher would be told it
   * saved. Declared in BOTH places on purpose: Config.gs is the schema, COLLECTION_HEADERS_ is what
   * creates it on a school that is already running. */
  ok_('the trail is in the sheet schema', /ABSENCE_FOLLOWUP_LOG: \['LogID', 'StudentID', 'Date', 'Time', 'ByStaffID', 'ByName', 'Status', 'Note', 'Photo'\]/.test(cfgGs));
  ok_('...and in the list that creates a sheet that does not exist yet', /ABSENCE_FOLLOWUP_LOG: \['LogID'/.test(gasEng));
  ok_('...and the collection is mapped to it', /absenceFollowupLogs:\{ wb: 'MAIN', sheet: 'ABSENCE_FOLLOWUP_LOG' \}/.test(gasEng));
  /* The column is called Photo BECAUSE IMAGE_COLS_ recognises that name — a base64 certificate is
   * far past the 50,000-character cell limit, and under any other name setValues throws and the
   * save "does nothing". */
  ok_('the photo column is named so Drive takes the file', /'Note', 'Photo'\]/.test(cfgGs));
  ok_('...and the reason is written down next to it', /IMAGE_COLS_ in Db\.gs offloads[\s\S]{0,80}ใบรับรองแพทย์/.test(cfgGs));
  // the trail must be readable by the people who write it — see the note in Code.gs
  ok_('the trail is NOT admin-only, and says why', /absenceFollowupLog is deliberately NOT here/.test(codeGs));
}

console.log('\n5) the screens');
{
  ok_('the teacher home asks for the count in the SECOND batch, not a trip of its own',
    /const p_absWatch= api\('absenceWatchCount',\{staffId:USER\.staffId\}\)/.test(app));
  ok_('...and it lands on the นักเรียน tab', /NAV_setBadge\('class', w\.watch\)/.test(app));
  ok_('...with a line saying what the circle means', /ต้องติดตาม \$\{w\.watch\} คน/.test(app));
  ok_('the screen asks scoped to whoever opened it', /api\('absenceReport',\{minDays:2,staffId:USER\.staffId\|\|''\}\)/.test(app));
  ok_('the admin counts are on the screen — 2 days and 5 days', /ขาด\/ลา ตั้งแต่ 2 วัน/.test(app) && /ขาด\/ลา เกิน 5 วัน/.test(app));
  ok_('...computed from the same list the cards below are drawn from',
    /const openN=all\.filter\(s=>!ABS_DONE\[String\(s\.status\|\|''\)\]\)\.length;/.test(app));
  ok_('a certificate can be attached per child', /ABS_pick\('\$\{esc\(s\.studentId\)\}'/.test(app));
  ok_('...compressed larger than a profile photo, because it has to stay readable',
    /compressImage\(f,1400,0\.85\)/.test(app) && /has to stay READABLE/.test(app));
  ok_('...and sent with the follow-up', /photo:ABS_PHOTO\[sid\]\|\|''/.test(app));
  ok_('saving names the person doing it', /staffId:USER\.staffId\|\|'', adminId:USER\.role==='Admin'\?USER\.staffId:''/.test(app));
  ok_('the trail opens from a child\'s card', /A_absTrail\('\$\{esc\(s\.studentId\)\}'\)/.test(app));
  ok_('...and whole-school for the admin', /A_absTrail\(''\)/.test(app));
  ok_('the over-5 group is listed FIRST — it is the one that needs somebody today',
    app.indexOf('ขาดเกิน 5 วัน') < app.indexOf("EN()?'Absent 2–5 days':'ขาด 2–5 วัน'"));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
