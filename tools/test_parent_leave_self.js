/**
 * tools/test_parent_leave_self.js — a leave the family filed, and can still take back.
 *   node tools/test_parent_leave_self.js
 *
 * Asked 2026-08-29. Filing was one-way: a wrong date, the wrong child, or a change of plan meant
 * ringing the school and asking somebody to go and edit a spreadsheet.
 *
 * THE INTERESTING PART IS WHAT IS REFUSED, and the school's answer to the question was "เฉพาะวันนี้
 * และวันข้างหน้า". Three rules, and each one is a different kind of harm:
 *
 *   1. A PAST DATE is not a plan any more, it is the ATTENDANCE RECORD of a day the school taught —
 *      the register, the absence count, and the teacher's own account of who was there. A family
 *      that could edit it afterwards could quietly rewrite history.
 *   2. A leave a TEACHER filed is the school saying a child was not here. Theirs to correct.
 *   3. Somebody else's child is somebody else's child, whatever LeaveID is posted.
 *
 * And the two that are easy to forget while building the interesting part:
 *   · the TEACHER has to be told when a leave is withdrawn — they were told it was filed, and a
 *     class list still showing a child as away is a child nobody is looking for that morning;
 *   · both actions must be classified as WRITES, which neither of their names says.
 */
const fs = require('fs'), path = require('path');
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));

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
const app = R('webapp/app.js'), api = R('webapp/api.js'),
      codeGs = R('src/Code.gs'), parentGs = R('src/Parent.gs'), engGs = R('src/Engine.gs');
const appCode = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const p2 = n => String(n).padStart(2, '0');
const dstr = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const shift = n => { const d = new Date(); d.setDate(d.getDate() + n); return dstr(d); };
const TODAY = shift(0), TOMORROW = shift(1), YESTERDAY = shift(-1), NEXTWEEK = shift(7), IN3 = shift(3);

function fresh() {
  const M = {
    config: { Plans: [{ id: 'p1', price: 6900, end: '17:00' }], Departments: 'Nursery 1' },
    students: [{ StudentID: 'STD-01', NameTH: 'เด็กหนึ่ง', Nickname: 'หนึ่ง', Class: 'Nursery 1', Status: 'ACTIVE', ParentID: 'PAR-01' },
               { StudentID: 'STD-09', NameTH: 'เด็กบ้านอื่น', Class: 'Nursery 1', Status: 'ACTIVE', ParentID: 'PAR-09' }],
    parents: [{ ParentID: 'PAR-01', NameTH: 'พ่อ', StudentID: 'STD-01', LineUID: 'U1' },
              { ParentID: 'PAR-09', NameTH: 'พ่อบ้านอื่น', StudentID: 'STD-09', LineUID: 'U9' }],
    staff: [{ StaffID: 'STF-T', NameTH: 'ครู', Role: 'Teacher', PositionLevel: 'Staff', Department: 'Nursery 1', Classes: 'Nursery 1' }],
    studentLeaves: [
      { LeaveID: 'LVS-past',  StudentID: 'STD-01', Date: YESTERDAY, Type: 'ลาป่วย', Reason: 'เป็นไข้', Status: 'Notified' },
      { LeaveID: 'LVS-today', StudentID: 'STD-01', Date: TODAY,     Type: 'ลาป่วย', Reason: 'ไอ',     Status: 'Notified' },
      { LeaveID: 'LVS-soon',  StudentID: 'STD-01', Date: TOMORROW,  Type: 'ลากิจ',  Reason: 'ไปหาหมอ', Status: 'Notified' },
      { LeaveID: 'LVS-sch',   StudentID: 'STD-01', Date: NEXTWEEK,  Type: 'ลาป่วย', Reason: '', Status: 'Notified', FiledBy: 'STF-T' },
      { LeaveID: 'LVS-other', StudentID: 'STD-09', Date: TOMORROW,  Type: 'ลากิจ',  Reason: '', Status: 'Notified' }
    ],
    classes: [], holidays: [], feed: [], activityLog: [], userLinks: [], payments: [],
    checkinStudent: [], studentCheckins: [], studentAttendanceToday: []
  };
  return { M, H: createAtomAPI(M).H };
}
const P = { parentId: 'PAR-01', uid: 'U1', studentId: 'STD-01' };

/* THE NAME THE APP ACTUALLY CALLS, read out of app.js rather than typed here.
 *
 * The first version of this suite called H.parentEditOwnLeave — and passed, in full, while the
 * feature was dead in mock mode: the engine's handlers were named ...OwnLeave and the screen calls
 * parentEditLeave. On GAS a ROUTE of that name existed, so live worked and the browser did not, and
 * nothing in 59 green checks could see it, because the test had invented its own entry point.
 * Now the action names come from the source, so the three can never drift apart again.
 */
const ACTIONS = [...new Set([...app.matchAll(/api\('(parent(?:Edit|Cancel)Leave)'/g)].map(m => m[1]))].sort();
eq('the screen calls exactly these two actions', ACTIONS, ['parentCancelLeave', 'parentEditLeave']);
const EDIT = ACTIONS[1], CANCEL = ACTIONS[0];
const call = (H, action, p) => { if (typeof H[action] !== 'function')
    throw Object.assign(new Error('the engine has no handler called ' + action), { code: 'UNKNOWN_ACTION' });
  return H[action](p); };

// ============================================================================
console.log('\n1) today and later — a plan the family can still change');
{
  const { M, H } = fresh();
  const r = call(H, EDIT, Object.assign({ leaveId: 'LVS-soon', date: IN3, type: 'ลาพักร้อน', reason: 'ไปต่างจังหวัด' }, P));
  ok_('tomorrow’s leave can be edited', r.ok);
  const l = M.studentLeaves.find(x => x.LeaveID === 'LVS-soon');
  eq('...date, type and reason all move', [l.Date, l.Type, l.Reason], [IN3, 'ลาพักร้อน', 'ไปต่างจังหวัด']);
  ok_('TODAY’s leave can be edited too — the day is not over',
    !!call(H, EDIT, Object.assign({ leaveId: 'LVS-today', reason: 'ไข้ยังไม่ลด' }, P)));
  eq('...and a field not sent is left alone', M.studentLeaves.find(x => x.LeaveID === 'LVS-today').Type, 'ลาป่วย');
}
{
  const { M, H } = fresh();
  ok_('tomorrow’s leave can be cancelled', call(H, CANCEL, Object.assign({ leaveId: 'LVS-soon' }, P)).ok);
  eq('...and it is gone, not merely marked', M.studentLeaves.filter(x => x.LeaveID === 'LVS-soon').length, 0);
  eq('...taking nothing else with it', M.studentLeaves.length, 4);
}

console.log('\n2) yesterday is the register, not a plan');
{
  const { M, H } = fresh();
  throws_('a past leave cannot be edited', () => call(H, EDIT, Object.assign({ leaveId: 'LVS-past', reason: 'x' }, P)), 'LEAVE_PAST');
  throws_('...nor cancelled', () => call(H, CANCEL, Object.assign({ leaveId: 'LVS-past' }, P)), 'LEAVE_PAST');
  eq('...and it is untouched', M.studentLeaves.find(x => x.LeaveID === 'LVS-past').Reason, 'เป็นไข้');
  /* THE BACK DOOR. Refusing to edit a past row is worthless if a FUTURE row can be dragged into the
   * past — the result is the same rewritten register, reached the other way round. */
  throws_('a future leave cannot be MOVED into the past either',
    () => call(H, EDIT, Object.assign({ leaveId: 'LVS-soon', date: YESTERDAY }, P)), 'LEAVE_PAST');
  eq('...and that one is untouched as well', M.studentLeaves.find(x => x.LeaveID === 'LVS-soon').Date, TOMORROW);
}

console.log('\n3) what the school filed is the school’s to correct');
{
  const { H } = fresh();
  throws_('a teacher-filed leave is not the family’s to edit',
    () => call(H, EDIT, Object.assign({ leaveId: 'LVS-sch', reason: 'x' }, P)), 'FILED_BY_SCHOOL');
  throws_('...nor to cancel', () => call(H, CANCEL, Object.assign({ leaveId: 'LVS-sch' }, P)), 'FILED_BY_SCHOOL');
  // ...and the refusal says which of the three rules it was, so the family knows who to ask
  try { call(H, CANCEL, Object.assign({ leaveId: 'LVS-sch' }, P)); } catch (e) {
    ok_('...and says to contact the school', /ติดต่อโรงเรียน/.test(String(e.message || '')));
  }
}

console.log('\n4) somebody else’s child, whatever id is posted');
{
  const { M, H } = fresh();
  throws_('a LeaveID belonging to another family is refused',
    () => call(H, CANCEL, { parentId: 'PAR-01', uid: 'U1', studentId: 'STD-01', leaveId: 'LVS-other' }), 'NO_ACCESS');
  eq('...and their leave still stands', M.studentLeaves.filter(x => x.LeaveID === 'LVS-other').length, 1);
  throws_('an id that does not exist is a plain not-found', () => call(H, CANCEL, Object.assign({ leaveId: 'LVS-nope' }, P)), 'NOT_FOUND');
}
{
  // moving a leave onto a day the child already has one would leave the register disagreeing with itself
  const { H } = fresh();
  throws_('two leaves cannot land on the same day',
    () => call(H, EDIT, Object.assign({ leaveId: 'LVS-soon', date: TODAY }, P)), 'DUPLICATE');
  ok_('...but a leave may be re-saved on its OWN date without tripping that',
    !!call(H, EDIT, Object.assign({ leaveId: 'LVS-soon', date: TOMORROW, reason: 'ยังไปหาหมอ' }, P)));
}

console.log('\n5) the same three rules on the GAS route, which SHADOWS the engine');
{
  ok_('the route exists for both', /parentEditLeave: function \(p\) \{ return handleParentEditLeave\(p\); \}/.test(codeGs)
    && /parentCancelLeave: function \(p\) \{ return handleParentCancelLeave\(p\); \}/.test(codeGs));
  ok_('the three checks are in ONE place, so the two actions cannot drift', /function parentOwnLeave_\(p\)/.test(parentGs));
  ok_('...the child is theirs', /if \(String\(l\.StudentID\) !== String\(p\.studentId\)\) throw apiError_\('NO_ACCESS'/.test(parentGs));
  ok_('...the school did not file it', /if \(String\(l\.FiledBy \|\| ''\)\.trim\(\)\) throw apiError_\('FILED_BY_SCHOOL'/.test(parentGs));
  ok_('...and the day has not gone', /if \(d < today\) throw apiError_\('LEAVE_PAST'/.test(parentGs));
  ok_('the back door is shut on the route too', /if \(nd < f\.today\) throw apiError_\('LEAVE_PAST'/.test(parentGs));
  /* THE TEACHER WAS TOLD THE CHILD WAS AWAY. If that is withdrawn and nobody says so, the class list
   * still shows a child who is now expected — and that morning, a child nobody is looking for. */
  ok_('cancelling tells the teacher', /notifyStudentTeacher_\(stu, '↩️ ยกเลิกใบลา/.test(parentGs));
  ok_('...and so does editing', /notifyStudentTeacher_\(stu, '✏️ แก้ไขใบลา/.test(parentGs));
  ok_('both are written to the audit log', /PARENT_LEAVE_EDIT/.test(parentGs) && /PARENT_LEAVE_CANCEL/.test(parentGs));
  /* NOT THE ADMIN PAIR. handleEditStudentLeave / handleDeleteStudentLeave are admin-only and check
   * none of the three rules above — routing a parent at them would have been the whole feature and
   * none of the safety. */
  ok_('they are separate handlers from the admin ones',
    /function handleEditStudentLeave/.test(parentGs) && /function handleParentEditLeave/.test(parentGs)
    && !/parentEditLeave: function \(p\) \{ return handleEditStudentLeave/.test(codeGs));
  ok_('the built engine carries the same rules', /parentEditLeave: p =>/.test(engGs) && /FILED_BY_SCHOOL/.test(engGs));
}
{
  /* NEITHER NAME STARTS WITH A MUTATING VERB. Left unlisted, the server would run them without the
   * write lock and the client would not clear its cache — so a family would cancel a leave and go
   * on being shown it. Both lists, because they have to agree. */
  const namesOf = s => (String(s).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    .match(/[A-Za-z_][A-Za-z0-9_]*(?=\s*:)/g) || []);
  const cW = namesOf((api.match(/const WRITES = \{([\s\S]*?)\};/) || [, ''])[1]);
  const sW = namesOf((codeGs.match(/var WRITES_ACTIONS_ = \{([\s\S]*?)\};/) || [, ''])[1]);
  ['parentEditLeave', 'parentCancelLeave'].forEach(n => {
    ok_(n + ' is a write on the client', cW.indexOf(n) >= 0);
    ok_('...and on the server', sW.indexOf(n) >= 0);
  });
  // and prove the classifier really would have got it wrong on its own
  ok_('...which the verb test alone would not have worked out',
    !/^(submit|save|add|remove|delete|set|register|pay|upload|confirm|reject|issue|generate|move|export|import|compute|cancel|prepay|link|notify|request|mark|approve|edit|rename|update|change|seed|dedup|reindex)/i.test('parentCancelLeave'));
}

console.log('\n6) the screen offers only what the server would accept');
{
  ok_('one rule decides whether the buttons are drawn', /const leaveEditable = l =>/.test(app));
  ok_('...and it is the same two conditions', /!String\(\(l&&l\.FiledBy\)\|\|''\)\.trim\(\) && String\(\(l&&l\.Date\)\|\|''\)\.slice\(0,10\) >= todayStr\(\)/.test(app));
  // run it, rather than reading it
  const src = /const leaveEditable = l => (.*);/.exec(app);
  const leaveEditable = new Function('l', 'todayStr', 'return ' + src[1] + ';').bind(null);
  const f = l => leaveEditable(l, () => TODAY);
  eq('tomorrow, filed by the family → editable', f({ Date: TOMORROW }), true);
  eq('today → editable', f({ Date: TODAY }), true);
  eq('yesterday → not', f({ Date: YESTERDAY }), false);
  eq('teacher-filed → not, however far in the future', f({ Date: NEXTWEEK, FiledBy: 'STF-T' }), false);
  /* A ROW WITH NO BUTTONS AND NO EXPLANATION READS AS A BUG. Both refusals say which one it was. */
  ok_('a row without buttons says why', /คุณครูบันทึก/.test(app) && /ผ่านมาแล้ว/.test(app));
  ok_('the date picker itself refuses the past', /<input type="date" id="eDate" min="\$\{todayStr\(\)\}"/.test(app));
  /* A confirm that says what will HAPPEN, not "are you sure" — the consequence is that the child is
   * expected at school, and that is the thing the parent is actually agreeing to. */
  ok_('cancelling confirms the consequence, not the click', /บุตรหลานจะมาเรียนตามปกติ/.test(app));
}

console.log('\n7) every child’s leave, not just the eldest’s');
{
  /* This card read slAll[0] with nothing on screen to say so, so a family with two children saw one
   * child's notices under a heading that names neither. It matters more now the rows can be
   * cancelled: a list you can act on that silently omits half of what you filed. */
  ok_('the card is built from every child’s list', /kids\.flatMap\(\(k,i\)=>\(slAll\[i\]\|\|\[\]\)\.map/.test(app));
  ok_('...and no longer from slAll[0] alone', !/const slHtml = sl\.map\(/.test(appCode));
  ok_('the child’s name is shown only when there is more than one', /const _multi = kids\.length > 1;/.test(app)
    && /P_leaveRow\(l, _multi\)/.test(app));
  ok_('the list folds', /<details style="margin-top:8px"\$\{slRows\.length\?'':' open'\}>/.test(app));
  ok_('...with the count on the summary line, so folding does not hide THAT there are any',
    /slRows\.length\?` <b style="color:var\(--ink\)">\$\{slRows\.length\}<\/b>`:''/.test(app));
  ok_('...and the "+ แจ้งลา" button stays outside the fold', /<button class="btn sm outline" style="flex:0 0 auto" onclick="P_absence\(\)">/.test(app));
}

console.log('\n8) ...and on GAS, end to end');
{
  const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin', 'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT']);
  const res = JSON.parse(run(function () {
    _configCache = null; setupAll(); _configCache = null;
    var MAIN = getMainSpreadsheet_();
    appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: 'STD-001', Name: 'น้องหนึ่ง', Class: 'Nursery 1', ParentID: 'PAR-001', Status: 'ACTIVE' });
    appendObject_(sheet_(MAIN, 'PARENTS'), { ParentID: 'PAR-001', Name: 'คุณแม่', LineUID: 'U1', StudentID: 'STD-001' });
    var p2 = function (n) { return ('0' + n).slice(-2); };
    var ds = function (off) { var d = new Date(); d.setDate(d.getDate() + off);
      return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
    var o = { today: ds(0), tomorrow: ds(1), yesterday: ds(-1) };
    var sh = sheet_(MAIN, 'LEAVE_REQUEST_STD');
    ensureColumns_(sh, ['Type', 'FiledBy']);
    appendObject_(sh, { LeaveID: 'LVS-0001', StudentID: 'STD-001', Date: o.tomorrow, Type: 'ลากิจ', Reason: 'ไปหาหมอ', Status: 'Notified' });
    appendObject_(sh, { LeaveID: 'LVS-0002', StudentID: 'STD-001', Date: o.yesterday, Type: 'ลาป่วย', Reason: 'เป็นไข้', Status: 'Notified' });
    appendObject_(sh, { LeaveID: 'LVS-0003', StudentID: 'STD-001', Date: ds(7), Type: 'ลาป่วย', Reason: '', Status: 'Notified', FiledBy: 'STF-T' });
    var attempt = function (fn) { try { return { ok: true, r: fn() }; } catch (e) { return { ok: false, code: e && e.apiCode, msg: String((e && e.message) || e) }; } };
    o.editFuture = attempt(function () { return handleParentEditLeave({ parentId: 'PAR-001', studentId: 'STD-001', leaveId: 'LVS-0001', date: ds(2), reason: 'เลื่อนนัดหมอ' }); });
    o.afterEdit = findObject_(sh, function (r) { return r.LeaveID === 'LVS-0001'; });
    o.afterEdit = { Date: otNormDate_(o.afterEdit.Date), Reason: String(o.afterEdit.Reason || '') };
    o.editPast = attempt(function () { return handleParentEditLeave({ parentId: 'PAR-001', studentId: 'STD-001', leaveId: 'LVS-0002', reason: 'x' }); });
    o.moveToPast = attempt(function () { return handleParentEditLeave({ parentId: 'PAR-001', studentId: 'STD-001', leaveId: 'LVS-0001', date: o.yesterday }); });
    o.editSchool = attempt(function () { return handleParentEditLeave({ parentId: 'PAR-001', studentId: 'STD-001', leaveId: 'LVS-0003', reason: 'x' }); });
    o.cancel = attempt(function () { return handleParentCancelLeave({ parentId: 'PAR-001', studentId: 'STD-001', leaveId: 'LVS-0001' }); });
    o.left = readObjects_(sh).map(function (r) { return String(r.LeaveID); }).sort();
    o.audit = readObjects_(sheet_(MAIN, 'AUDIT_LOG')).map(function (a) { return String(a.Action || ''); })
      .filter(function (a) { return /PARENT_LEAVE/.test(a); });
    return JSON.stringify(o);
  }));
  ok_('a future leave is edited on the live route', res.editFuture.ok);
  ok_('...and the row really changed', res.afterEdit.Reason === 'เลื่อนนัดหมอ' && res.afterEdit.Date !== res.tomorrow);
  eq('a past one is refused', [res.editPast.ok, res.editPast.code], [false, 'LEAVE_PAST']);
  eq('...and so is dragging a future one backwards', [res.moveToPast.ok, res.moveToPast.code], [false, 'LEAVE_PAST']);
  eq('a teacher-filed one is refused', [res.editSchool.ok, res.editSchool.code], [false, 'FILED_BY_SCHOOL']);
  eq('cancelling removes the row', [res.cancel.ok, res.cancel.code, res.cancel.msg], [true, null, null]);
  eq('...that row and no other', res.left, ['LVS-0002', 'LVS-0003']);
  eq('both actions are on the record', res.audit, ['PARENT_LEAVE_EDIT', 'PARENT_LEAVE_CANCEL']);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
