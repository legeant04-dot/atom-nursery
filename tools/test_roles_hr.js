/**
 * tools/test_roles_hr.js — Observer, leaving/returning staff, start dates, UIDs, per-person bonuses,
 * and children on temporary leave.
 *   node tools/test_roles_hr.js
 *
 * The two rules that matter most, because getting either wrong is silent and expensive:
 *   an Observer must not be able to change ANYTHING, however the request is made; and
 *   a staff member who leaves must not take their payroll history with them.
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
const app = R('webapp/app.js'), eng = R('webapp/engine.js'), code = R('src/Code.gs'),
      staffGs = R('src/Staff.gs'), auth = R('src/Auth.gs'), checkin = R('src/Checkin.gs'), cfg = R('src/Config.gs');

// ---- run a GAS handler against a fake sheet -------------------------------------------------
function fakeSheet(rows) {
  const data = rows.map(r => Object.assign({}, r));
  return {
    _rows: data,
    findObject: fn => { const i = data.findIndex(fn); return i < 0 ? null : Object.assign({ _row: i + 2 }, data[i]); },
    update: (row, patch) => Object.assign(data[row - 2], patch)
  };
}
function runStaffEnd(payload, rows) {
  const sh = fakeSheet(rows || [{ StaffID: 'STF-1', Name: 'ฟาง', Status: 'ACTIVE', StartDate: '2026-08-13' }]);
  const audit = [];
  const ctx = {
    sheet_: () => sh, getHrSpreadsheet_: () => ({}), ensureColumns_: () => {},
    findObject_: (s, fn) => s.findObject(fn),
    updateRow_: (s, row, patch) => s.update(row, patch),
    staffCacheBust_: () => {}, logAuditHr: (...a) => audit.push(a),
    apiError_: (c, m) => Object.assign(new Error(m), { code: c }), console
  };
  vm.createContext(ctx);
  const i = staffGs.indexOf('var STAFF_END_REASONS_');
  const j = staffGs.indexOf('\n}', staffGs.indexOf('function handleSetStaffEnd'));
  vm.runInContext(staffGs.slice(i, j + 2), ctx);
  let out = null, thrown = null;
  try { out = ctx.handleSetStaffEnd(payload); } catch (e) { thrown = e; }
  return { out, thrown, row: sh._rows[0], audit };
}

console.log('\n1) Observer — sees everything, changes nothing');
{
  ok_('the role exists server-side', /OBSERVER: 'Observer'/.test(auth));
  // the gate is in dispatch_, which every request goes through — not in the screens
  ok_('every mutating action is refused for it', /if \(mutates && sess && String\(sess\.role\) === 'Observer'\)/.test(code));
  ok_('...with a plain explanation, not a bare code', /ดูอย่างเดียว \(Observer\)/.test(code));
  ok_('the refusal happens before the handler can run',
    code.indexOf("String(sess.role) === 'Observer'") < code.indexOf('return withWriteLock_'));
  ok_('it may READ the admin-only screens', /sess\.role !== ROLES\.OBSERVER\) throw apiError_\('NO_PERMISSION'/.test(code));
  ok_('...and open any record, like an admin', /sess\.role === 'Admin' \|\| sess\.role === ROLES\.OBSERVER\) return payload/.test(code));
  ok_('the engine lets it see what an admin sees', /const adminLike_ = s =>[\s\S]{0,120}Role==='Observer'/.test(eng));
  eq('no inline admin check was left behind', (eng.match(/PositionLevel!=='Admin'&&\w+\.Role!=='Admin'/g) || []).length, 0);
  ok_('thirty-five checks now go through the one helper', (eng.match(/!adminLike_\(/g) || []).length >= 30);
}
{
  ok_('the four screens are the SAME functions as the admin ones, not copies',
    /\['home','leaves','finance','dspm'\]\.forEach\(k => \{ SCREENS\.Observer\[k\] = \(\.\.\.a\) => SCREENS\.Admin\[k\]\(\.\.\.a\); \}\)/.test(app));
  { const navLine=(/^\s*Observer:\[.*$/m.exec(app)||[''])[0];
    ok_('the four whole-school screens are offered', /'home'/.test(navLine) && /'finance'/.test(navLine));
    ok_('the manage screen is not — every tool on it changes something', !/'manage'/.test(navLine)); }
  ok_('the app refuses a write before it leaves the phone', /isObserver\(\) && window\.__atomIsMutating/.test(app));
  ok_('...using the SAME rule as the server, not a second copy', /window\.__atomIsMutating = isMutating/.test(R('webapp/api.js')));
  ok_('the person is told up front, not by a button failing', /ดูอย่างเดียว — เปิดดูได้ทุกอย่าง แต่แก้ไขไม่ได้/.test(app));
  ok_('the role has a name in the header', /'role\.Observer'/.test(R('webapp/i18n.js')));
  ok_('an admin can set it from the staff form', /Observer — view only|ผู้ตรวจสอบ — ดูอย่างเดียว/.test(app));
  ok_('...and the form actually saves the role', /data\.Role=v\('Role'\)/.test(app));
}

console.log('\n1b) "View as" previews the person\'s OWN role');
{
  // This said 'Teacher' for every staff member, so previewing an Observer showed the teacher
  // screens — exactly what the preview exists to check. Reported live for พี่กุ้ง.
  const i = app.indexOf('window.A_viewAsStaff=');
  const body = app.slice(i, app.indexOf('window.A_viewAsParent=', i));
  ok_('the role comes from the staff record, not a constant', /String\(s\.Role\|\|''\)==='Observer' \? 'Observer' : 'Teacher'/.test(body));
  ok_('...and is what the preview switches to', /_enterViewAs\(\{role,/.test(body));
  ok_('no hard-coded Teacher role is left', !/_enterViewAs\(\{role:'Teacher'/.test(body));
  ok_('a leader still previews as a leader', /s\.PositionLevel==='Leader'\?'Leader':'Teacher'/.test(body));

  // run the real rule
  const pick = s => String(s.Role||'')==='Observer' ? 'Observer' : 'Teacher';
  eq('an Observer previews as Observer', pick({ Role: 'Observer', PositionLevel: 'Staff' }), 'Observer');
  eq('a teacher previews as Teacher', pick({ Role: 'Teacher' }), 'Teacher');
  eq('a staff row with no role set still previews as Teacher', pick({}), 'Teacher');

  ok_('the picker says which people are view-only, before you choose one',
    /Observer — view only|ผู้ตรวจสอบ \(ดูอย่างเดียว\)/.test(app));
  ok_('and the preview bar repeats it', /USER\.role==='Observer'\?[\s\S]{0,80}ดูอย่างเดียว/.test(app));
  // the four Observer screens exist, so switching to that role has somewhere to land
  ok_('the Observer screens are registered before any preview can use them', /SCREENS\.Observer\[k\] = /.test(app));
}

console.log('\n2) A staff member leaves — and the record stays');
{
  const r = runStaffEnd({ staffId: 'STF-1', endDate: '2026-08-31', reason: 'ลาออก', remark: 'ย้ายกลับต่างจังหวัด', adminId: 'A1' });
  ok_('no error', !r.thrown);
  eq('they come off the active lists', r.row.Status, 'INACTIVE');
  eq('the last working day is recorded', r.row.EndDate, '2026-08-31');
  eq('the reason too', r.row.EndReason, 'ลาออก');
  eq('and the free-text note', r.row.EndRemark, 'ย้ายกลับต่างจังหวัด');
  eq('THE RECORD IS STILL THERE — payroll history depends on it', r.row.StaffID, 'STF-1');
  eq('...including everything else about them', r.row.Name, 'ฟาง');
  ok_('it is written to the audit log', r.audit.length === 1 && /STAFF_END/.test(String(r.audit[0])));
  ok_('the row is patched in place, never deleted',
    /function handleSetStaffEnd[\s\S]{0,1400}updateRow_/.test(staffGs) && !/function handleSetStaffEnd[\s\S]{0,1400}deleteRow/.test(staffGs));
}
{
  ['ไม่ผ่านการทดลองงาน', 'ลาออก', 'ให้ออก'].forEach(x =>
    ok_('reason accepted: ' + x, !runStaffEnd({ staffId: 'STF-1', endDate: '2026-08-31', reason: x }).thrown));
  ok_('a reason outside the three is refused', !!runStaffEnd({ staffId: 'STF-1', endDate: '2026-08-31', reason: 'อื่นๆ' }).thrown);
  ok_('no reason at all is refused', !!runStaffEnd({ staffId: 'STF-1', endDate: '2026-08-31' }).thrown);
  ok_('no date is refused', !!runStaffEnd({ staffId: 'STF-1', reason: 'ลาออก' }).thrown);
  ok_('a malformed date is refused', !!runStaffEnd({ staffId: 'STF-1', endDate: '31/08/2026', reason: 'ลาออก' }).thrown);
  const bad = runStaffEnd({ staffId: 'STF-1', endDate: '', reason: 'ลาออก' });
  eq('...and nothing was written', bad.row.Status, 'ACTIVE');
}
{
  const back = runStaffEnd({ staffId: 'STF-1', restore: true, adminId: 'A1' },
    [{ StaffID: 'STF-1', Name: 'ฟาง', Status: 'INACTIVE', EndDate: '2026-08-31', EndReason: 'ลาออก', EndRemark: 'x' }]);
  eq('bringing them back restores the status', back.row.Status, 'ACTIVE');
  eq('...and clears the leaving date', back.row.EndDate, '');
  eq('...the reason', back.row.EndReason, '');
  eq('...and the note', back.row.EndRemark, '');
  ok_('logged as well', /STAFF_RESTORE/.test(String(back.audit[0])));
}
{
  ok_('the route exists', /setStaffEnd:\s*function/.test(code));
  ok_('admin-only', /setStaffEnd: 1/.test(code));
  ok_('it counts as a write (takes the lock, busts the cache)', /^(submit|save|add|remove|delete|set)/i.test('setStaffEnd'));
  ok_('the columns exist in the schema', /'EndDate', 'EndReason', 'EndRemark'/.test(cfg));
  ok_('...and are created on an older sheet that lacks them', /ensureColumns_\(sh, \['EndDate', 'EndReason', 'EndRemark'\]\)/.test(staffGs));
  ok_('the working list hides them', /_stAct=\(staff\|\|\[\]\)\.filter\(s=>!_left\(s\.Status\)\)/.test(app));
  ok_('but they are still reachable, with a way back', /_stGone\.length\?/.test(app) && /A_staffReturn/.test(app));
}

console.log('\n3) Someone who has not started yet is not part of attendance');
{
  ok_('the server refuses to log their time', /function assertStaffStarted_/.test(checkin));
  eq('both check-in and check-out are guarded', (checkin.match(/assertStaffStarted_\(staff\);/g) || []).length, 2);
  ok_('the message says WHEN they start, not just "no"', /วันแรกของการทำงานคือ/.test(checkin));
  ok_('no start date recorded → nothing changes for anyone else', /if \(!\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(start\)\) return;/.test(checkin));
  ok_('the engine agrees', /const staffStarted_ =/.test(eng));
  ok_('the screen can show it', /notStarted:!staffStarted_\(me\), startDate:/.test(eng));
  // the point of the request: no phantom absences before the first day
  ok_('they are not counted on the daily attendance board', /staffStat=M\.staff\.filter\([^)]*staffStarted_\(s\)\)/.test(eng));
  ok_('nor in the per-department present/total', /const team=M\.staff\.filter\(s=>covers[^;]*staffStarted_\(s\)\)/.test(eng));

  // run the real rule
  const ctx = { ymd: d => String(d || '').slice(0, 10), todayLocal: () => '2026-08-10' };
  vm.createContext(ctx);
  // `const` inside runInContext stays lexical and never lands on the context object — use var
  vm.runInContext(/^[ \t]*const staffStarted_ = .*$/m.exec(eng)[0].trim().replace(/^const /, 'var '), ctx);
  eq('starts on the 13th, today is the 10th → not yet', ctx.staffStarted_({ StartDate: '2026-08-13' }), false);
  eq('starts today → yes', ctx.staffStarted_({ StartDate: '2026-08-10' }), true);
  eq('started last year → yes', ctx.staffStarted_({ StartDate: '2025-01-05' }), true);
  eq('no start date → treated as already working', ctx.staffStarted_({}), true);
}

console.log('\n4) The LINE UID is editable, so a new phone is a paste and not a rebuild');
{
  ok_('staff have the field', /id="sf_LineUID"/.test(app));
  ok_('parents now do too', /id="pf_LineUID"/.test(app));
  ok_('...and it is saved', /LineUID:v\('LineUID'\)/.test(app));
  ok_('the column is created if the sheet predates it', /'Nickname', 'NicknameEN', 'Title', 'LineUID'/.test(staffGs));
  ok_('the screen explains what to paste and where it comes from', /หน้าเข้าสู่ระบบจะแสดง LINE ID ใหม่/.test(app));
}

console.log('\n5) The diligence bonus is per person');
{
  ok_('it is on the staff record form', /id="sf_DiligenceAttendanceAmount"/.test(app) && /id="sf_DiligenceFacebookAmount"/.test(app));
  ok_('saved with the rest of that person’s pay settings, not a second copy',
    /setPayrollConfig[\s\S]{0,300}DiligenceAttendanceAmount/.test(app));
  ok_('payroll already reads from there', /DiligenceAttendanceAmount!=null\?pc\.DiligenceAttendanceAmount/.test(app));
  ok_('blank means "use the school default"', /placeholder="\$\{esc\(String\(\(MOCK\.config&&MOCK\.config\.DiligenceAttendanceAmount\)\|\|500\)\)\}"/.test(app));
  // the amounts differ per person now, so a fixed number in the label is simply wrong
  const i18n = R('webapp/i18n.js');
  ok_('the "(+500)" is gone from the attendance bonus', !/มาครบ ไม่ลา ไม่สาย \(\+500\)/.test(i18n));
  ok_('...and from the Facebook one', !/โพสต์ Facebook \(\+500\)/.test(i18n));
  ok_('...in English too', !/\(\+500\)/.test(i18n));
}

console.log('\n6) A child on temporary leave: no attendance, but still billable');
{
  ok_('the parent still sees the child', /parentChildren: p => visibleStudents\(p\)/.test(eng));
  ok_('...with the pause flags the screen needs', /paused:studentPaused_\(s\), pauseFrom:/.test(eng));
  ok_('the drop-off / pick-up buttons are replaced by an explanation', /ยังไม่ถึงกำหนดเข้าเรียน/.test(app));
  ok_('a stale screen cannot slip a check-in through anyway', /STUDENT_PAUSED/.test(eng));
  // only the buttons are swapped — the name, class, age, package and allergy line are outside the
  // ternary, so a paused child's card still tells the family everything it did before
  ok_('only the buttons change, the rest of the card is untouched',
    /\$\{k\.paused[\s\S]{0,1400}: `<div class="row"[\s\S]{0,400}P_punch/.test(app));

  ok_('finance lists them, so a deposit can be billed before the child starts',
    /financeSummary: p =>[\s\S]{0,400}enrolledStudents\(\)\.map/.test(eng));
  ok_('...at the BOTTOM, so they never crowd the children attending',
    /\.sort\(\(a,b2\)=>\(a\.paused\?1:0\)-\(b2\.paused\?1:0\)\)/.test(eng));
  ok_('and they are marked, not silently mixed in', /on temporary leave|ลาชั่วคราว/.test(app));
  // an admin must still be able to look at the family exactly as before
  ok_('the parent link and "view as" are untouched', /A_viewAs=async/.test(app) && /studentLinkedParents|linkedParents/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' : 'ALL PASS ') + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
