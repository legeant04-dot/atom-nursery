/**
 * tools/test_injury_approval.js — an injury report goes teacher → หัวหน้าครู → แอดมิน.
 *   node tools/test_injury_approval.js
 *
 * The same two steps as a leave request, so nobody has to learn a second vocabulary.
 *
 * THE ONE RULE THAT MUST NOT BEND: the approval is PAPERWORK, not a gate on telling people. The
 * emergency alert to admins, leaders and (if ticked) the parents goes out the moment the teacher
 * saves — a hurt child cannot wait for a signature. What the chain adds is that the document sent
 * to the authority has been read and agreed by two people.
 *
 * And because this is the record of an accident to a child: it stays correctable while it is still
 * moving, an admin can correct/unlock/delete it at any point, and every one of those is logged.
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
const app = R('webapp/app.js'), eng = R('webapp/engine.js'), code = R('src/Code.gs'),
      cfg = R('src/Config.gs'), notify = R('src/Notify.gs');

function boot() {
  const M = {
    config: { Plans: [], LeaveQuota: {} },
    students: [{ StudentID: 'STD-1', NameTH: 'บีม', NameEN: 'Beam', Nickname: 'บีม', Class: 'Nursery 1', Status: 'ACTIVE', DOB: '2023-01-01', Gender: 'M' }],
    staff: [
      { StaffID: 'T1', NameTH: 'ครูเอ', Role: 'Teacher', PositionLevel: 'Officer' },
      { StaffID: 'T2', NameTH: 'ครูบี', Role: 'Teacher', PositionLevel: 'Officer' },
      { StaffID: 'L1', NameTH: 'หัวหน้าแนน', Role: 'Teacher', PositionLevel: 'Leader' },
      { StaffID: 'A1', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin' }
    ],
    parents: [], userLinks: [], leaves: [], payments: [], otDaily: [],
    studentCharges: [], prepayments: [], paymentSlips: [], checkinStudent: [], journals: [], comments: [],
    holidays: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    payroll: [], payrollConfig: {}, studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [],
    announcements: [], notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [],
    classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [],
    surveyResponses: [], injuries: [], injuryReports: [], insurance: [], bigCleaning: [], departments: [],
    permissions: {}, feed: [], calendar: [], classes: [], studentAttendanceToday: [], studentCheckins: []
  };
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(R('webapp/engine.js'), ctx);
  const H = ctx.createAtomAPI(M, {}).H;
  // a build without the approval chain must FAIL these checks cleanly, not die on the first call
  ['approveInjury', 'editInjury', 'unlockInjury', 'deleteInjury', 'pendingInjuries'].forEach(function (k) {
    if (typeof H[k] !== 'function') H[k] = function () { return { missing: k }; };
  });
  return { H: H, M: M };
}
const FILE = { studentId: 'STD-1', date: '2026-08-12', time: '10:35', narrative: 'วิ่งชนขอบโต๊ะ', injuryTypes: [1] };
function file(H, by) { return H.submitInjury(Object.assign({ staffId: by || 'T1' }, FILE)); }
function grab(H, fn) { let e = null; try { fn(); } catch (x) { e = x.message || String(x); } return e; }

console.log('\n1) filed by a teacher — and it starts with the head teacher');
{
  const { H, M } = boot();
  const r = file(H);
  eq('the report exists', M.injuryReports.length, 1);
  eq('...waiting for the head teacher', M.injuryReports[0].Status, 'PENDING_LEADER');
  eq('...and the caller is told', r.status, 'PENDING_LEADER');
  eq('nobody has signed yet', [M.injuryReports[0].LeaderBy, M.injuryReports[0].AdminBy], ['', '']);
  // THE POINT: the alert does not wait for any of this
  ok_('an emergency notification is raised at once', (M.feed || []).some(f => /อุบัติเหตุ/.test(f.text) && f.category === 'emergency'));
  ok_('...to admins AND leaders', ((M.feed || [])[0] || {}).roles.join() === 'Admin,Leader');
  ok_('...and the LINE push is not behind the approval either', /if \(p\.notifyParent\)/.test(notify) && !/Status/.test(notify.slice(notify.indexOf('function handleSubmitInjury'), notify.indexOf('function handleSubmitInjury') + 900)));
}

console.log('\n2) step 1 — the head teacher');
{
  const { H, M } = boot(); const id = file(H).injuryId;
  eq('a teacher cannot approve it', grab(H, () => H.approveInjury({ staffId: 'T2', injuryId: id, decision: 'approve' })), 'เฉพาะหัวหน้าครูหรือแอดมิน');
  eq('...not even the one who filed it', grab(H, () => H.approveInjury({ staffId: 'T1', injuryId: id, decision: 'approve' })), 'เฉพาะหัวหน้าครูหรือแอดมิน');
  const r = H.approveInjury({ staffId: 'L1', injuryId: id, decision: 'approve' });
  eq('the head teacher can, and it moves on', r.status, 'PENDING_ADMIN');
  eq('...their name is on it', M.injuryReports[0].LeaderBy, 'หัวหน้าแนน');
  ok_('...with a timestamp', !!M.injuryReports[0].LeaderAt);
  ok_('and it is logged', (M.activityLog || []).some(a => /approveInjury/.test(a.Action || a.action || '')));
}

console.log('\n3) step 2 — the admin');
{
  const { H, M } = boot(); const id = file(H).injuryId;
  H.approveInjury({ staffId: 'L1', injuryId: id, decision: 'approve' });
  eq('a head teacher cannot take the second step', grab(H, () => H.approveInjury({ staffId: 'L1', injuryId: id, decision: 'approve' })), 'เฉพาะแอดมิน');
  eq('the admin finishes it', H.approveInjury({ staffId: 'A1', injuryId: id, decision: 'approve' }).status, 'APPROVED');
  eq('...and is named', M.injuryReports[0].AdminBy, 'แอดมิน');
  eq('a finished report cannot be approved again', grab(H, () => H.approveInjury({ staffId: 'A1', injuryId: id, decision: 'approve' })), 'รายงานนี้ดำเนินการเรียบร้อยแล้ว');
}
{
  // an admin may take the first step too — a school where the head teacher is away must not jam
  const { H } = boot(); const id = file(H).injuryId;
  eq('the admin can do step 1 as well', H.approveInjury({ staffId: 'A1', injuryId: id, decision: 'approve' }).status, 'PENDING_ADMIN');
}

console.log('\n4) sending it back');
{
  const { H, M } = boot(); const id = file(H).injuryId;
  eq('the head teacher can send it back', H.approveInjury({ staffId: 'L1', injuryId: id, decision: 'reject', reason: 'เวลาไม่ตรงกับกล้อง' }).status, 'REJECTED');
  eq('...with the reason kept, so the teacher knows what to fix', M.injuryReports[0].RejectReason, 'เวลาไม่ตรงกับกล้อง');
  eq('and the teacher who filed it can still correct it', H.editInjury({ staffId: 'T1', injuryId: id, data: { Time: '10:50' } }).status, 'REJECTED');
  eq('...the correction sticks', M.injuryReports[0].Time, '10:50');
}

console.log('\n5) correcting it — who, and until when');
{
  const { H, M } = boot(); const id = file(H).injuryId;
  eq('the teacher who filed it may', H.editInjury({ staffId: 'T1', injuryId: id, data: { Narrative: 'แก้ไขแล้ว' } }).injuryId, id);
  eq('another teacher may not', grab(H, () => H.editInjury({ staffId: 'T2', injuryId: id, data: { Narrative: 'x' } })), 'แก้ไขได้เฉพาะผู้บันทึกหรือหัวหน้าครู');
  eq('the head teacher may', H.editInjury({ staffId: 'L1', injuryId: id, data: { CauseObject: 'ขอบโต๊ะ' } }).injuryId, id);
  eq('...and it says who last touched it', M.injuryReports[0].UpdatedBy, 'หัวหน้าแนน');
  // once final it is locked to everyone but the admin
  H.approveInjury({ staffId: 'L1', injuryId: id, decision: 'approve' });
  H.approveInjury({ staffId: 'A1', injuryId: id, decision: 'approve' });
  eq('once approved, the teacher is locked out', grab(H, () => H.editInjury({ staffId: 'T1', injuryId: id, data: { Narrative: 'y' } })), 'รายงานนี้อนุมัติครบแล้ว — ให้แอดมินปลดล็อกก่อนแก้ไข');
  eq('...but the admin may still correct it', H.editInjury({ staffId: 'A1', injuryId: id, data: { Narrative: 'แก้โดยแอดมิน' } }).status, 'APPROVED');
  eq('...without silently reopening it', M.injuryReports[0].Status, 'APPROVED');
}
{
  // the approval trail is NOT something an edit can rewrite
  const { H, M } = boot(); const id = file(H).injuryId;
  H.approveInjury({ staffId: 'L1', injuryId: id, decision: 'approve' });
  H.editInjury({ staffId: 'A1', injuryId: id, data: { Status: 'APPROVED', LeaderBy: 'ใครก็ไม่รู้', AdminBy: 'ปลอม' } });
  eq('an edit cannot forge the status', M.injuryReports[0].Status, 'PENDING_ADMIN');
  eq('...nor the signatures', [M.injuryReports[0].LeaderBy, M.injuryReports[0].AdminBy], ['หัวหน้าแนน', '']);
}

console.log('\n6) the admin can unlock, and can delete');
{
  const { H, M } = boot(); const id = file(H).injuryId;
  H.approveInjury({ staffId: 'L1', injuryId: id, decision: 'approve' });
  H.approveInjury({ staffId: 'A1', injuryId: id, decision: 'approve' });
  eq('only an admin unlocks', grab(H, () => H.unlockInjury({ staffId: 'L1', injuryId: id })), 'เฉพาะแอดมิน');
  eq('unlocking sends it back to the start', H.unlockInjury({ staffId: 'A1', injuryId: id }).status, 'PENDING_LEADER');
  eq('...and clears the old signatures, which no longer apply', [M.injuryReports[0].LeaderBy, M.injuryReports[0].AdminBy], ['', '']);
  eq('the teacher can edit it again', H.editInjury({ staffId: 'T1', injuryId: id, data: { Narrative: 'z' } }).injuryId, id);
}
{
  const { H, M } = boot(); const id = file(H).injuryId;
  eq('only an admin deletes', grab(H, () => H.deleteInjury({ staffId: 'L1', injuryId: id })), 'เฉพาะแอดมิน');
  eq('the admin can', H.deleteInjury({ staffId: 'A1', injuryId: id }).ok, true);
  eq('...and it is gone', M.injuryReports.length, 0);
  ok_('...but the deletion is on the record', (M.activityLog || []).some(a => /deleteInjury/.test(a.Action || a.action || '')));
  eq('deleting something that is not there is an error, not a silent no-op', grab(H, () => H.deleteInjury({ staffId: 'A1', injuryId: 'nope' })), 'ไม่พบรายงานอุบัติเหตุ');
}

console.log('\n7) each person\'s queue');
{
  const { H } = boot();
  const a = file(H).injuryId, b = file(H).injuryId, c = file(H).injuryId;
  H.approveInjury({ staffId: 'L1', injuryId: b, decision: 'approve' });                 // → admin
  H.approveInjury({ staffId: 'L1', injuryId: c, decision: 'approve' });
  H.approveInjury({ staffId: 'A1', injuryId: c, decision: 'approve' });                 // → done
  eq('the head teacher sees only what is theirs to do', H.pendingInjuries({ staffId: 'L1' }).map(r => r.InjuryID), [a]);
  eq('the admin sees both open steps', H.pendingInjuries({ staffId: 'A1' }).map(r => r.InjuryID).sort(), [a, b].sort());
  eq('a plain teacher has no queue at all', H.pendingInjuries({ staffId: 'T1' }), []);
  eq('...and neither does nobody', H.pendingInjuries({}), []);
  ok_('the queue carries the child\'s nickname and class, for reading at a glance',
    H.pendingInjuries({ staffId: 'L1' })[0].nick === 'บีม' && H.pendingInjuries({ staffId: 'L1' })[0].className === 'Nursery 1');
}

console.log('\n8) stored, routed and gated in the right places');
{
  const hdr = /INJURY_REPORTS:\s*\[([\s\S]*?)\]/.exec(cfg);
  const cols = (hdr ? hdr[1].match(/'[^']+'/g) || [] : []).map(s => s.slice(1, -1));
  ['Status', 'LeaderBy', 'LeaderAt', 'AdminBy', 'AdminAt', 'RejectReason', 'UpdatedBy', 'UpdatedAt']
    .forEach(c => ok_(c + ' has a column, or it would vanish on write', cols.indexOf(c) >= 0));
  const adminOnly = code.slice(code.indexOf('var ADMIN_ONLY'), code.indexOf('parentKidsMap: 1 }'));
  ok_('unlocking is admin-only at the router too', /unlockInjury: 1/.test(adminOnly));
  ok_('so is deleting', /deleteInjury: 1/.test(adminOnly));
  ok_('approving is NOT — a head teacher takes the first step', !/approveInjury: 1/.test(adminOnly));
  ok_('editing is NOT — the teacher who filed it may correct it', !/editInjury: 1/.test(adminOnly));
  // unlockInjury starts with no mutating verb, so it must be listed or it writes without the lock
  ok_('unlockInjury is known to be a write', /unlockInjury: 1/.test(code.slice(code.indexOf('var WRITES_ACTIONS_'))));
  ok_('...on the client too', /unlockInjury: 1/.test(R('webapp/api.js')));
}

console.log('\n9) the screens offer only what the person may actually do');
{
  ok_('the status is shown wherever a report is listed', /function injStatusPill\(r\)/.test(app));
  ok_('...in words, not a raw code', /รอหัวหน้าครู/.test(app) && /ตีกลับให้แก้ไข/.test(app));
  ok_('a head teacher is offered step 1 only', /if\(s==='PENDING_LEADER'\) return isLeaderRole\(\);/.test(app));
  ok_('an admin is offered step 2', /if\(s==='PENDING_ADMIN'\) return isAdmin\(\);/.test(app));
  ok_('a finished report offers neither', /return false;\s*\n  \}/.test(app.slice(app.indexOf('function injCanDecide'))));
  ok_('sending back demands a reason, and does nothing without one', /if\(!reason\) return;/.test(app));
  ok_('unlock and delete are shown to admins only', /\$\{isAdmin\(\)\?`<div class="row" style="gap:8px;margin-top:8px">/.test(app));
  ok_('deleting a child\'s accident record asks first, in plain words', /นี่คือบันทึกอุบัติเหตุที่เกิดกับเด็ก/.test(app));
  ok_('the head teacher gets a queue on their home screen', /pendingInjuries/.test(app));
  ok_('...travelling with the other leader sections, not costing another round trip', /await Promise\.all\(\[p_tp,p_to,p_cc,p_ti,p_tt\]\)/.test(app));
}

console.log('\n10) a leaving date is the admin\'s business, not the teacher\'s');
{
  ok_('the roster shows it under the start date', /\$\{esc\(t\('staff\.tenure'\)\)\} \$\{esc\(tenure\(s\.StartDate\)\)\}<\/small>\$\{endNote\(s\)\}/.test(app));
  ok_('...naming the day, the reason and the note', /Last working day':'วันสิ้นสุดการทำงาน'/.test(app) && /s\.EndReason, s\.EndRemark/.test(app));
  ok_('nothing is shown when there is no date', /if\(!d\) return '';/.test(app.slice(app.indexOf('function endNote'))));
  // the teacher's own profile reads staffSelf — that whitelist must NOT carry it
  const self = eng.slice(eng.indexOf('staffSelf: p =>'), eng.indexOf('setRequireCheckin: p =>'));
  ok_('staffSelf does not hand a teacher their own leaving date', !/EndDate/.test(self));
  ok_('...nor the reason', !/EndReason/.test(self) && !/EndRemark/.test(self));
  ok_('the reason for that is written down', /nobody learns their last day from/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
