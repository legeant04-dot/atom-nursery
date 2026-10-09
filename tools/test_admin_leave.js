/**
 * tools/test_admin_leave.js — the leave the office files, and the pop-up that says it did not save.
 *   node tools/test_admin_leave.js
 *
 * REPORTED 2026-10-07, for น้องโมน่า: "Admin จะแจ้งลาป่วยให้น้องแต่ระบบไม่บันทึกให้ และแจ้งว่าไม่พบ
 * ผู้ปกครอง". The family's record was fine. The leave button was the ONE call on the parent screens
 * that did not say whose child it was for — and for a signed-in family that changed nothing, because
 * applyIdentity_ fills the parent in from their session and never reads what the client sent.
 *
 * An ADMIN's payload is returned UNTOUCHED (that is what makes "ดูมุมมองผู้ปกครอง" work at all), so
 * for them nothing filled it in and the write was refused. The failure then announced itself as the
 * family's record having gone missing, which is why two things are pinned here and not one:
 *
 *   1. the call CARRIES the scope — the same shape of bug as staffAttendanceMonth in v419;
 *   2. the refusal would have been IMPOSSIBLE TO MISREAD — a failed write now has to be dismissed,
 *      instead of a 3.6-second toast over a screen that still looks normal.
 *
 * AND WHO THE SCHOOL SAYS FILED IT. The school's call on the same day: an office entry is the
 * SCHOOL's record (FiledBy), so the family cannot withdraw it — which is the rule parentEditLeave has
 * always enforced for a teacher-filed leave. That cannot be decided from the payload, because an
 * admin in view-as posts the family's own parentId; it is decided from the SESSION's role.
 */
const fs = require('fs'), path = require('path');
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
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), apiJs = R('webapp/api.js'),
      codeGs = R('src/Code.gs'), parentGs = R('src/Parent.gs');

const p2 = n => String(n).padStart(2, '0');
const dstr = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const shift = n => { const d = new Date(); d.setDate(d.getDate() + n); return dstr(d); };
/* 🔴 A WEEKDAY, not "tomorrow". The engine refuses a leave whose whole range is a school holiday
 * ("ช่วงวันที่เลือกเป็นวันหยุดโรงเรียนทั้งหมด"), so a suite that files one for shift(1) passes all
 * week and throws every Friday and Saturday. Found 2026-10-09 — a Friday. The same trap
 * test_checkin_byline hit, and the reason this file now asks for the next working day instead. */
const nextWeekday = (from) => { const d = new Date(); d.setDate(d.getDate() + (from || 1));
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1); return dstr(d); };
const TOMORROW = nextWeekday(1);
const IN3 = (() => { const d = new Date(TOMORROW + 'T00:00:00'); d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1); return dstr(d); })();

function fresh() {
  const M = {
    config: { Plans: [{ id: 'p1', price: 6900, end: '17:00' }], Departments: 'Nursery 1' },
    students: [{ StudentID: 'STD-MONA', NameTH: 'เด็กโมน่า', Nickname: 'โมน่า', Class: 'Nursery 1', Status: 'ACTIVE', ParentID: 'PAR-01' }],
    parents: [{ ParentID: 'PAR-01', NameTH: 'คุณแม่', StudentID: 'STD-MONA', LineUID: 'U1' }],
    staff: [{ StaffID: 'STF-T', NameTH: 'ครู', Role: 'Teacher', PositionLevel: 'Staff', Department: 'Nursery 1', Classes: 'Nursery 1' },
            { StaffID: 'ADM-1', NameTH: 'ผอ.', Role: 'Admin', PositionLevel: 'Leader' }],
    studentLeaves: [],
    classes: [], holidays: [], feed: [], activityLog: [], userLinks: [], payments: [],
    checkinStudent: [], studentCheckins: [], studentAttendanceToday: []
  };
  return { M, H: createAtomAPI(M).H };
}
/* The family's own scope. An admin in view-as posts EXACTLY this — the parent they picked — which is
 * precisely why the role cannot be read off the payload. */
const FAMILY = { parentId: 'PAR-01', uid: 'U1' };
const OFFICE = Object.assign({ __role: 'Admin', __meId: 'ADM-1' }, FAMILY);

// ============================================================================
console.log('\n1) 🔴 the call says whose child it is — the Mona bug');
{
  /* READ OUT OF THE SOURCE, not retyped. A test that asserts on its own copy of the call passes
   * while the screen stays broken — which is how this one survived in the first place. */
  const i = app.indexOf("api('studentAbsence'");
  ok_('the screen still calls studentAbsence at all', i > 0);
  const seg = app.slice(i, i + 400);
  ok_('🔴 ...and it carries parentScope() — without it an admin files nothing',
    /parentScope\(\)/.test(seg));

  /* CONTROL — the scope has to be MERGED, not replace the leave's own fields. A fix that posted only
   * the parent would have been a quiet second bug: no student, no date, nothing filed, and the same
   * screen behaviour as before. */
  ok_('...and the child, the dates, the type and the reason are all still sent',
    /studentId:/.test(seg) && /date:/.test(seg) && /dateTo:/.test(seg) && /type:/.test(seg) && /reason:/.test(seg));
}

// ============================================================================
console.log('\n2) 🔴 the session decides who filed it, never the payload');
{
  const seg = codeGs.slice(codeGs.indexOf("if (action === 'studentAbsence')"), codeGs.indexOf("if (action === 'studentAbsence')") + 200);
  ok_('applyIdentity_ stamps studentAbsence with the session role', /__role = sess\.role/.test(seg));
  ok_('...and with the session’s own id', /__meId = sess\.linkedId/.test(seg));

  /* 🔴 ORDER. The stamp is useless if it runs after the line that returns an Admin's payload
   * untouched — which is the only case it exists for. */
  const at = codeGs.indexOf("if (action === 'studentAbsence')");
  const adminReturn = codeGs.indexOf("if (sess.role === 'Admin' || sess.role === ROLES.OBSERVER) return payload;");
  ok_('🔴 ...and it is stamped BEFORE the Admin payload is returned untouched', at > 0 && adminReturn > at);

  /* ...and it does NOT return early itself: a parent must still have parentId forced onto them and a
   * teacher must still be checked for an EndDate. Stamping and then skipping all of that would open
   * this one route to somebody who left the school last week. */
  ok_('🔴 ...and stamping does not skip the rest of the identity checks',
    !/if \(action === 'studentAbsence'\) \{[^}]*return payload;/.test(codeGs));
}

// ============================================================================
console.log('\n3) an office leave belongs to the school; a family leave belongs to the family');
{
  const { M, H } = fresh();
  const r = H.studentAbsence(Object.assign({ studentId: 'STD-MONA', date: TOMORROW, type: 'ลาป่วย', reason: 'เป็นไข้' }, OFFICE));
  ok_('the office can file a leave at all — the whole point of the report', r.days === 1);
  const l = M.studentLeaves.find(x => x.LeaveID === r.leaveId);
  eq('🔴 ...and it is stamped with the admin who filed it', String(l.FiledBy), 'ADM-1');

  // ...and the family cannot then withdraw a decision the office made
  throws_('🔴 the family cannot cancel an office leave',
    () => H.parentCancelLeave(Object.assign({ leaveId: r.leaveId, studentId: 'STD-MONA' }, FAMILY)), 'FILED_BY_SCHOOL');
  throws_('🔴 ...nor edit it',
    () => H.parentEditLeave(Object.assign({ leaveId: r.leaveId, studentId: 'STD-MONA', reason: 'เปลี่ยนใจ' }, FAMILY)), 'FILED_BY_SCHOOL');
}
{
  /* CONTROL — THE FAMILY'S OWN LEAVE MUST STILL BE THEIRS. A FiledBy written for everybody would
   * have silently taken the cancel button away from every parent in the school, and the suite above
   * would not have noticed: every one of its assertions would still pass. */
  const { M, H } = fresh();
  const r = H.studentAbsence(Object.assign({ studentId: 'STD-MONA', date: TOMORROW, type: 'ลาป่วย', reason: 'เป็นไข้' }, FAMILY));
  const l = M.studentLeaves.find(x => x.LeaveID === r.leaveId);
  eq('CONTROL · a parent’s own leave is filed by nobody', String(l.FiledBy || ''), '');
  ok_('CONTROL · ...and they can still edit it',
    !!H.parentEditLeave(Object.assign({ leaveId: r.leaveId, studentId: 'STD-MONA', date: IN3 }, FAMILY)));
  ok_('CONTROL · ...and still cancel it',
    !!H.parentCancelLeave(Object.assign({ leaveId: r.leaveId, studentId: 'STD-MONA' }, FAMILY)));
}
{
  /* 🔴 A PARENT CANNOT CLAIM TO BE THE OFFICE. The stamp is overwritten from the session on every
   * request, so this payload is what a crafted one would look like AFTER applyIdentity_ has had it:
   * role Parent. If FiledBy were read from anything the client controls, a family could file a leave
   * the school could never trace and they could never withdraw. */
  const { M, H } = fresh();
  const r = H.studentAbsence(Object.assign({ studentId: 'STD-MONA', date: TOMORROW, type: 'ลาป่วย' },
    FAMILY, { __role: 'Parent', __meId: 'PAR-01' }));
  eq('🔴 a parent posting __role cannot file as the office',
    String((M.studentLeaves.find(x => x.LeaveID === r.leaveId) || {}).FiledBy || ''), '');
}

// ============================================================================
console.log('\n4) the live route agrees with the engine');
{
  ok_('handleStudentAbsence reads the stamped role', /payload\.__role \|\| ''\) === 'Admin'/.test(parentGs));
  ok_('🔴 ...and writes FiledBy only for the office', /FiledBy: byOffice \?/.test(parentGs));
  /* The column has to EXIST or writeRows_ drops the field silently — the trail would be empty and
   * every office leave would come back as the family's to cancel. */
  ok_('...and the sheet is topped up with the FiledBy column first',
    /ensureColumns_\(sheet, \['Type', 'FiledBy'/.test(parentGs));
  // the audit trail must name whoever actually did it, or the one record that says "the school
  // decided this" points at the family
  ok_('the audit trail names the admin, not the parent', /STUDENT_ABSENCE_BY_OFFICE/.test(parentGs));
  // ...and the teacher's LINE message must not claim the family rang in
  ok_('...and the teacher is told the school entered it', /บันทึกโดยทางโรงเรียน/.test(parentGs));
}

// ============================================================================
console.log('\n5) 🔴 a write that failed cannot be a toast');
{
  ok_('api.js stamps the failed action onto the error', /e\.action = action;/.test(apiJs));
  ok_('🔴 ...and whether that action writes', /e\.mutating = isMutating\(action\)/.test(apiJs));
  /* NOT OVERWRITTEN. app.js wraps window.api again for the busy overlay; a stamp that clobbered an
   * existing one would relabel somebody else's failure with the wrapper's own name. */
  ok_('...and never relabels an error that already named its action', /!e\.action/.test(apiJs));

  // to the end of err(), not a guessed number of characters — the body grew and a fixed window
  // silently stopped covering the half of the change it was meant to pin
  const _e0 = app.indexOf('function err(e)');
  const seg = app.slice(_e0, app.indexOf('\n  function modal(html)', _e0));
  ok_('the suite is reading the whole of err()', seg.length > 1500 && seg.length < 9000);
  ok_('err() opens a dialog for a failed write', /const writes =/.test(seg) && /modal\(/.test(seg));
  ok_('🔴 ...and the dialog has its own close button', /ปิดหน้าแจ้งเตือน/.test(seg));
  ok_('🔴 ...and says plainly that nothing was saved', /ข้อมูลยังไม่ถูกบันทึก/.test(seg));
  /* The CODE is shown. "ลองใหม่อีกครั้ง" is nothing the office can report back to us, and
   * LOST_REQUEST and BAD_RESPONSE are different faults with different answers. */
  ok_('...and names the action and the code, for the person on the phone to the office',
    /e&&e\.action, code/.test(seg));

  /* 🔴 READS KEEP THE TOAST, and this is the half that is easy to lose. On live the median call takes
   * 7.3 seconds and roughly one in forty fails — almost all of them badges and counts on a home
   * screen. A dialog for each would put a teacher behind five pop-ups before reaching a button. */
  ok_('🔴 a read that fails still only toasts', /if\(writes && typeof modal==='function'\)/.test(seg));
  ok_('...the toast is still there for everything else', /toast\('⚠️ '\+head/.test(seg));
  /* ...and the dialog must not be dismissed by the tap still landing from the button just pressed */
  ok_('...and a stray backdrop tap does not close it', /m\.onclick=null/.test(seg));
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' : 'ALL PASS ') + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
