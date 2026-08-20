/**
 * tools/test_parent_links.js — the admin's view of who is linked to whom must match the parent's.
 *   node tools/test_parent_links.js
 *
 * Reported live: อัจฉยะ อัศวเดชาสกุล is linked to น้องโมน่า — the parent view opens that child and
 * greets them by name — yet the admin's "view as parent" list showed the family as "👶 0".
 *
 * Two causes, and the shape of both is the same: the ADMIN side resolved links differently from the
 * PARENT side. So these tests check the two against each other, not against a hard-coded number.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

// ---- boot the real engine on a tiny school ---------------------------------------------------
function boot(over) {
  const M = {
    config: { Plans: [], LeaveQuota: {}, OTRatePerHour: 100 },
    students: [], parents: [], userLinks: [], staff: [], leaves: [], payments: [], otDaily: [],
    studentCharges: [], prepayments: [], paySlips: [], checkinStudent: [], journals: [], comments: [],
    holidays: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    payroll: [], payrollConfig: {}, studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [],
    announcements: [], notifications: [], vaccines: [], growth: [], assessments: [], classChanges: [],
    timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [], surveyResponses: [],
    injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {}, feed: [], calendar: []
  };
  Object.assign(M, over || {});
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'webapp', 'engine.js'), 'utf8'), ctx);
  return ctx.createAtomAPI(M, {}).H;
}
const kid = (id, over) => Object.assign({ StudentID: id, NameTH: 'ด.ญ. ' + id, Nickname: id, Class: 'Nursery Baby', Status: 'ACTIVE', DOB: '2026-07-01' }, over || {});
const par = (id, over) => Object.assign({ ParentID: id, Name: id, NameTH: id, Relationship: 'บิดา' }, over || {});

console.log('\n1) The reported case: a child on TEMPORARY LEAVE still belongs to their parent');
{
  // exactly the live shape: linked through USER_LINKS by LINE UID, child paused 03/08–20/08
  const H = boot({
    // PauseTo is the day the child COMES BACK (v254) — a date in the future keeps them away today
    students: [kid('โมน่า', { Status: 'PAUSED', PauseFrom: '2026-08-03', PauseTo: '2099-01-01' })],
    parents: [par('PAR-1', { NameTH: 'อัจฉยะ อัศวเดชาสกุล', LineUID: 'U_ajch' })],
    userLinks: [{ UserUID: 'U_ajch', StudentID: 'โมน่า' }]
  });
  const parentSees = H.parentChildren({ uid: 'U_ajch', parentId: 'PAR-1' });
  eq('the PARENT sees their child', parentSees.map(s => s.StudentID), ['โมน่า']);
  eq('...and the admin count now agrees', H.parentLinkCounts()['PAR-1'], parentSees.length);
  eq('...and so does the admin map', (H.parentKidsMap()['PAR-1'] || []).map(s => s.StudentID), ['โมน่า']);
  ok_('the child is flagged as paused, so the admin can see why', (H.parentKidsMap()['PAR-1'] || [])[0].paused === true);
}
{
  // the same family with the child back at school — must not change
  const H = boot({
    students: [kid('โมน่า')],
    parents: [par('PAR-1', { LineUID: 'U_ajch' })],
    userLinks: [{ UserUID: 'U_ajch', StudentID: 'โมน่า' }]
  });
  eq('an ordinary linked child still counts once', H.parentLinkCounts()['PAR-1'], 1);
}

console.log('\n2) All three ways a family can be linked are counted');
{
  const H = boot({
    students: [kid('A'), kid('B', { ParentID: 'PAR-B' }), kid('C')],
    parents: [par('PAR-A', { LineUID: 'U_a' }), par('PAR-B'), par('PAR-C', { StudentID: 'C' })],
    userLinks: [{ UserUID: 'U_a', StudentID: 'A' }]
  });
  const c = H.parentLinkCounts();
  eq('USER_LINKS by LINE UID', c['PAR-A'], 1);
  eq('the legacy STUDENTS.ParentID', c['PAR-B'], 1);
  eq('and PARENTS.StudentID — the oldest, which these lists used to ignore', c['PAR-C'], 1);
  const m = H.parentKidsMap();
  eq('the map agrees on all three', [m['PAR-A'].length, m['PAR-B'].length, m['PAR-C'].length], [1, 1, 1]);
  // the server already trusts PARENTS.StudentID for ACCESS, so calling it "not linked" was inconsistent
  ok_('...which is the same linkage the access check uses',
    /PARENTS'\);[\s\S]{0,200}String\(pr\.StudentID\) === String\(sid\)/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'Code.gs'), 'utf8')));
}
{
  const H = boot({
    students: [kid('A')],
    parents: [par('PAR-A', { LineUID: 'U_a', StudentID: 'A' })],
    userLinks: [{ UserUID: 'U_a', StudentID: 'A' }]
  });
  eq('a family linked THREE ways is still one child, not three', H.parentLinkCounts()['PAR-A'], 1);
  eq('...in the map too', H.parentKidsMap()['PAR-A'].length, 1);
}

console.log('\n3) A parent with no child really does read zero');
{
  const H = boot({ students: [kid('A')], parents: [par('PAR-A', { LineUID: 'U_a' }), par('PAR-NONE')], userLinks: [{ UserUID: 'U_a', StudentID: 'A' }] });
  eq('nobody linked → 0', H.parentLinkCounts()['PAR-NONE'], 0);
  eq('...and an empty list', (H.parentKidsMap()['PAR-NONE'] || []).length, 0);
}
{
  // a child who has LEFT the school must not keep counting
  const H = boot({
    students: [kid('A', { Status: 'WITHDRAWN' }), kid('B', { Status: 'EXPORTED' })],
    parents: [par('PAR-A', { LineUID: 'U_a' }), par('PAR-B', { StudentID: 'B' })],
    userLinks: [{ UserUID: 'U_a', StudentID: 'A' }]
  });
  eq('a withdrawn child is not counted', H.parentLinkCounts()['PAR-A'], 0);
  eq('nor an exported one, via the legacy link', H.parentLinkCounts()['PAR-B'], 0);
  eq('...and neither appears in the map', (H.parentKidsMap()['PAR-A'] || []).length + (H.parentKidsMap()['PAR-B'] || []).length, 0);
}

console.log('\n4) Several children, and two parents of one child');
{
  const H = boot({
    students: [kid('A'), kid('B', { Status: 'PAUSED', PauseFrom: '2026-08-01' }), kid('C')],
    parents: [par('DAD', { LineUID: 'U_d' }), par('MUM', { LineUID: 'U_m' })],
    userLinks: [{ UserUID: 'U_d', StudentID: 'A' }, { UserUID: 'U_d', StudentID: 'B' }, { UserUID: 'U_d', StudentID: 'C' },
                { UserUID: 'U_m', StudentID: 'A' }]
  });
  eq('a father with three children, one of them paused', H.parentLinkCounts()['DAD'], 3);
  eq('the mother of one of them', H.parentLinkCounts()['MUM'], 1);
  eq('the admin count matches what each parent actually sees (dad)',
    H.parentLinkCounts()['DAD'], H.parentChildren({ uid: 'U_d' }).length);
  eq('...and (mum)', H.parentLinkCounts()['MUM'], H.parentChildren({ uid: 'U_m' }).length);
}

console.log('\n5) The admin list and the parent view agree, whatever the linkage');
{
  // the property that actually failed live — check it directly, for every parent at once
  const H = boot({
    students: [kid('A'), kid('B', { Status: 'PAUSED', PauseFrom: '2026-08-01' }), kid('C', { ParentID: 'PAR-C' }), kid('D')],
    parents: [par('PAR-A', { LineUID: 'U_a' }), par('PAR-B', { LineUID: 'U_b' }), par('PAR-C'), par('PAR-D', { StudentID: 'D' })],
    userLinks: [{ UserUID: 'U_a', StudentID: 'A' }, { UserUID: 'U_b', StudentID: 'B' }]
  });
  const cnt = H.parentLinkCounts();
  [['PAR-A', { uid: 'U_a' }], ['PAR-B', { uid: 'U_b' }], ['PAR-C', { parentId: 'PAR-C' }]].forEach(([pid, scope]) => {
    eq(pid + ': admin count === what the parent sees', cnt[pid], H.parentChildren(scope).length);
  });
  ok_('PAR-D (oldest linkage) is no longer reported as unlinked', cnt['PAR-D'] === 1);
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' : 'ALL PASS ') + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
