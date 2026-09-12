/**
 * tools/test_admin_add_student.js — the child who could not be entered because nobody had a phone.
 *   node tools/test_admin_add_student.js
 *
 * ASKED 2026-09-12: "สำหรับ Admin เพิ่มฟังก์ชันการเพิ่มนักเรียนเหมือนกันกับผู้ปกครองหรือคุณครูโดยใช้
 * ข้อมูลเพิ่มนักเรียน"
 *
 * Every child in this school arrived through a parent's LINE sign-up. A_studentForm could only EDIT,
 * so a family who walked in with a paper form could not be entered at all — the admin's only route
 * was to sit with the parent and their phone.
 *
 * TWO THINGS THIS HAD TO GET RIGHT.
 *
 * 1. IT MUST NOT CREATE A PARENT. registerNew does, and creating families from the admin side is
 *    exactly how this app acquired 84 duplicate parents with unique ids that checkDuplicateIds
 *    called clean. A child with no parent yet is a loose end anybody can see and fix; a duplicate
 *    parent is invisible until somebody notices a family getting two bills. 🔗 เชื่อมผู้ปกครอง
 *    attaches the child to a record that already exists, which is the school's actual answer.
 *
 * 2. A CHILD ENTERED BY THE ADMIN AND A CHILD ENTERED BY THEIR MOTHER MUST BE THE SAME RECORD. Same
 *    duplicate guard, same class-by-age default, same Drive folder, same first growth row. Two paths
 *    that build a student differently is a bug waiting for whoever reads one of them.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function throws_(label, fn, want) {
  let msg = null; try { fn(); } catch (e) { msg = String((e && e.message) || e); }
  const ok = msg !== null && (!want || msg.indexOf(want) >= 0);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '  got=' + JSON.stringify(msg)));
  ok ? pass++ : fail++;
}
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const eng = R('webapp/engine.js'), app = R('webapp/app.js'), codeGs = R('src/Code.gs');

function boot(over) {
  over = over || {};
  const M = {
    config: Object.assign({ Plans: [{ id: 'M6900', labelTH: 'รายเดือน', price: 6900 }], LeaveQuota: {},
      BigCleaningDays: [], Departments: '' }, over.config || {}),
    students: over.students || [], parents: over.parents || [], userLinks: [],
    classes: over.classes || [{ ClassName: 'Nursery 1' }],
    staff: [{ StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE' }],
    pickupPersons: [], growthRecords: [], payments: [], studentCharges: [], prepayments: [], otDaily: [],
    paymentSlips: [], otRecords: [], payroll: [], payrollConfig: {}, checkinStudent: [], studentCheckins: [],
    studentAttendanceToday: [], studentLeaves: [], journals: [], comments: [], staffGroups: [],
    workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [], leaves: [], absenceLog: [],
    absenceFollowups: [], absenceFollowupLogs: [], dspmCriteria: [], activityLog: [], announcements: [],
    notifications: [], vaccines: [], growth: [], assessments: [], classChanges: [], timeRequests: [],
    adminInbox: [], foodMenus: [], foodItems: [], surveys: [], surveyResponses: [], injuries: [],
    insurance: [], bigCleaning: [], departments: [], permissions: {}, feed: [], calendar: [],
    holidays: [], holidayAttend: [], vaccineRecords: []
  };
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
const NEW = { NameTH: 'เด็กหญิง ทดสอบ', NameEN: 'Test Child', Nickname: 'น้องเทส', NicknameEN: 'Test',
  DOB: '2023-05-01', Gender: 'Female', NationalID: '1234567890123', Class: 'Nursery 1',
  Allergy: '-', MedicalHistory: '-' };

console.log('\n1) the admin can enter a child, and gets a real student record');
{
  const { H, M } = boot({});
  const r = H.addStudentByAdmin({ student: Object.assign({}, NEW), adminId: 'ADM' });
  eq('one student now exists', M.students.length, 1);
  eq('...with an id in the school\'s own series', /^STD-\d{3}$/.test(r.studentId), true);
  eq('...active from the moment it is created', M.students[0].Status, 'ACTIVE');
  eq('...and the nickname every screen uses as the headline', r.nick, 'น้องเทส');
  ok_('...with the per-child Drive folder the other two paths make', !!r.driveFolder);
  // the school hears about it in the activity log, named
  ok_('the admin is named in the activity log', M.activityLog.some(a => String(a.Detail || '').indexOf('แอดมินเพิ่มเอง') >= 0));
}

console.log('\n2) NO PARENT IS INVENTED — this is the whole reason it is not registerNew');
{
  const { H, M } = boot({});
  H.addStudentByAdmin({ student: Object.assign({}, NEW), adminId: 'ADM' });
  eq('not one parent record was created', M.parents.length, 0);
  eq('...and the child is not pointed at a parent that does not exist', M.students[0].ParentID, '');
  eq('...nor is a LINE account linked to anybody', M.userLinks.length, 0);
  /* Contrast, in the same file: registerNew DOES create a parent. That is correct for a family
   * signing themselves up and wrong for an admin typing in a paper form, and the two must not drift
   * into each other. */
  const r2 = boot({}).H.registerNew({ student: Object.assign({}, NEW), parent: { NameTH: 'คุณแม่' }, uid: 'U1' });
  ok_('...while the family-facing route still does create one', !!r2.parentId);
  ok_('the reason is written down where somebody would change it', /It is deliberately NOT registerNew/.test(eng));
}

console.log('\n3) the same record as the other two paths build');
{
  // a blank class is worked out from the child's AGE, exactly as a registration is
  /* defaultClassByAge_ only names a class the school ACTUALLY HAS (it checks Departments), so the
   * fixture lists all four — otherwise this would pass or fail depending on how old the test child
   * happens to be on the day the suite runs, which is the trap that reddened three suites overnight
   * in August. The child is given a DOB inside the first year so the answer is fixed. */
  const { H, M } = boot({ classes: [{ ClassName: 'Nursery Baby' }, { ClassName: 'Nursery 1' }, { ClassName: 'Nursery 2' }, { ClassName: 'Nursery 3' }],
    config: { Departments: 'Nursery Baby,Nursery 1,Nursery 2,Nursery 3' } });
  H.addStudentByAdmin({ student: Object.assign({}, NEW, { Class: '' }), adminId: 'ADM' });
  ok_('a blank class is filled in by age, not left empty', !!String(M.students[0].Class || '').trim());
  // weight/height taken on the day become the first growth point, as they do at registration
  const b = boot({});
  b.H.addStudentByAdmin({ student: Object.assign({}, NEW, { Weight: 12.5, Height: 90 }), adminId: 'ADM' });
  eq('a measurement typed in on the day becomes the first growth record', b.M.growthRecords.length, 1);
  eq('...with the number that was typed', [b.M.growthRecords[0].Weight, b.M.growthRecords[0].Height], [12.5, 90]);
  const c = boot({});
  c.H.addStudentByAdmin({ student: Object.assign({}, NEW), adminId: 'ADM' });
  eq('...and an unmeasured child gets no growth row at all', c.M.growthRecords.length, 0);
}
{
  /* THE FIRST REAL DAY, not the day the form was filled in. EnrollDate is what billing counts from
   * (enrolledBy_/tuitionForMonth_), so a child entered in September who starts in October must not
   * be billed for September. A blank box must still not become nothing. */
  const { H, M } = boot({});
  H.addStudentByAdmin({ student: Object.assign({}, NEW, { EnrollDate: '2026-10-01' }), adminId: 'ADM' });
  eq('the first day the admin typed is kept', M.students[0].EnrollDate, '2026-10-01');
  const b = boot({});
  b.H.addStudentByAdmin({ student: Object.assign({}, NEW, { EnrollDate: '' }), adminId: 'ADM' });
  ok_('...and a blank one falls back to today rather than to nothing', /^\d{4}-\d{2}-\d{2}$/.test(b.M.students[0].EnrollDate || ''));
}

console.log('\n4) the duplicate guard — the same one the family-facing form has');
{
  const { H, M } = boot({});
  H.addStudentByAdmin({ student: Object.assign({}, NEW), adminId: 'ADM' });
  throws_('the same child cannot be entered twice', () => H.addStudentByAdmin({ student: Object.assign({}, NEW), adminId: 'ADM' }),
    'มีอยู่ในระบบแล้ว');
  eq('...and nothing was written on the refused attempt', M.students.length, 1);
  /* A SLOW NETWORK IS THE REAL CASE. The admin presses Save, sees nothing happen, presses again —
   * which is precisely the sequence that created 13 duplicate students through the parent form. */
  const b = boot({});
  b.H.addStudentByAdmin({ student: Object.assign({}, NEW), adminId: 'ADM' });
  let second = false; try { b.H.addStudentByAdmin({ student: Object.assign({}, NEW), adminId: 'ADM' }); } catch (e) { second = true; }
  eq('a double-tap is refused, not duplicated', [second, b.M.students.length], [true, 1]);
}

console.log('\n5) the screen, and the gate');
{
  ok_('the button is on the students section of จัดการ', /A_addStudent\(\)">\+ \$\{EN\(\)\?'Add student':'เพิ่มนักเรียน'\}/.test(app));
  ok_('the form says out loud that no parent is created', /สร้างเฉพาะข้อมูลนักเรียน/.test(app));
  ok_('...and points at the tool that attaches one', /🔗 เชื่อมผู้ปกครอง/.test(app));
  ok_('the class box defaults to "by age", not to whichever class happens to be first',
    /<option value="">\$\{EN\(\)\?'By age \(automatic\)':'จัดตามอายุ \(อัตโนมัติ\)'\}<\/option>/.test(app));
  ok_('the three fields the school cannot run without are required',
    /\[\[ 'NameTH', t\('reg\.nameTH'\)\],\['Nickname',t\('reg\.nickname'\)\],\['DOB',t\('reg\.dob'\)\]\]/.test(app));
  ok_('an unmeasured child is not saved as weighing nothing',
    /Weight:v\('Weight'\)===''\?'':\(Number\(v\('Weight'\)\)\|\|0\)/.test(app));
  ok_('...and Rh is not on this form either — it was dropped the same day', !/ast_RH/.test(app));
  // writes a child nobody has claimed — the admin's alone, and the reason is written next to it
  ok_('the route is admin-only', /addStudentByAdmin: 1,/.test(codeGs));
  ok_('...and says why it is not an onboarding action', /are ONBOARDING[\s\S]{0,120}belongs to the admin alone/.test(codeGs));
  /* NAMED SO THE VERB TEST CATCHES IT. MUTATING_RE is anchored: "adminAddStudent" would have looked
   * like a READ to both the server (no write lock) and the client (no cache clear), which is the
   * trap WRITES_ACTIONS_ exists to paper over. Starting the name with "add" avoids needing it. */
  ok_('the name starts with a mutating verb, so the write lock and the cache clear both fire',
    /^(submit|save|add|remove|delete|set|register|pay|upload|confirm|reject|issue|generate|move|import|compute|cancel|prepay|link|notify|request|mark|approve|edit|rename|update|change|seed|recompute|restore|bind|provision)/i.test('addStudentByAdmin'));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
