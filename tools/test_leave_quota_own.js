/**
 * tools/test_leave_quota_own.js — leave entitlement belongs to a PERSON, not to the school.
 *   node tools/test_leave_quota_own.js
 *
 * ASKED 2026-09-14: "เพิ่มข้อมูลสิทธิการลาของครูแต่ละท่าน ให้สามารถปรับได้เนื่องจากสิทธิการลาจะขึ้นอยู่
 * กับอายุงาน และทางโรงเรียนจะแก้ไข/เพิ่ม/ลดได้เอง … เช่น ครู A ได้พักร้อน 6 วัน / ครู B ได้พักร้อน 8 วัน
 * … Default ลาป่วย 30 วัน / ลากิจ 3 วัน"
 *
 * SCHOOL_CONFIG.LeaveQuota was one table for everybody. Entitlement follows length of service, so
 * it never could be — and the school was carrying the difference in their heads.
 *
 * THE DESIGN DECISION THAT MATTERS: a staff row holds OVERRIDES, merged over the school's table, not
 * a replacement for it.
 *
 *   Replacement would mean setting one teacher's holiday to 8 also freezes their sick leave at
 *   whatever the school's number happened to be that day. Raise ลาป่วย to 35 next year and it
 *   reaches everybody except the people somebody once edited — which is precisely the group most
 *   likely to be senior, and precisely the bug nobody would find until a teacher was told they had
 *   run out of sick leave they were entitled to.
 *
 * And a BLANK box is not zero. '' is how a cleared field is stored; reading it as 0 would take a
 * person's leave away entirely, silently, from a form the admin thought they had left alone.
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
const eng = R('webapp/engine.js'), app = R('webapp/app.js'), cfgGs = R('src/Config.gs'), staffGs = R('src/Staff.gs'), day6 = R('src/Day6.gs');

const SCHOOL = { 'ลาป่วย': 30, 'ลากิจ': 3, 'ลาพักร้อน': 6 };
function boot(over) {
  over = over || {};
  const M = {
    config: Object.assign({ Plans: [], BigCleaningDays: [], Departments: 'Nursery 1',
      LeaveQuota: over.schoolQuota || SCHOOL }, over.config || {}),
    staff: over.staff || [], leaves: over.leaves || [],
    /* `leaveUsed` is a DERIVED collection — GasEngine builds it from LEAVE_REQUEST (deriveLeaveUsed_)
     * and mockdata ships it ready-made, so the engine reads it rather than recomputing. The fixture
     * has to supply it for the same reason: days used and days granted are two different sources,
     * and this suite is about the granted half. Approved leave only, keyed {staffId:{type:days}}. */
    leaveUsed: (over.leaves || []).reduce((a, l) => {
      if (String(l.Status || '').toUpperCase() !== 'APPROVED') return a;
      (a[l.StaffID] = a[l.StaffID] || {});
      a[l.StaffID][l.Type] = (a[l.StaffID][l.Type] || 0) + (Number(l.Days) || 0);
      return a;
    }, {}),
    students: [], parents: [], userLinks: [], classes: [{ ClassName: 'Nursery 1' }], staffGroups: [],
    payments: [], studentCharges: [], prepayments: [], otDaily: [], paymentSlips: [], otRecords: [],
    payroll: [], payrollConfig: {}, checkinStudent: [], studentCheckins: [], studentAttendanceToday: [],
    studentLeaves: [], journals: [], comments: [], workSchedule: [], staffAttendanceToday: [],
    staffAttendanceHistory: [], absenceLog: [], absenceFollowups: [], absenceFollowupLogs: [],
    dspmCriteria: [], activityLog: [], announcements: [], notifications: [], vaccines: [], growth: [],
    growthRecords: [], assessments: [], classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [],
    foodItems: [], surveys: [], surveyResponses: [], injuries: [], insurance: [], insurancePCHI: [],
    bigCleaning: [], departments: [], permissions: {}, feed: [], calendar: [], holidays: [],
    holidayAttend: [], pickupPersons: [], vaccineRecords: []
  };
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
const T = (id, over) => Object.assign({ StaffID: id, NameTH: 'ครู ' + id, Role: 'Teacher',
  PositionLevel: 'Staff', Status: 'ACTIVE', Department: 'Nursery 1' }, over || {});
const by = (rows, type) => rows.find(r => r.type === type) || {};

console.log('\n1) the school default is the answer for everybody nobody has touched');
{
  const { H } = boot({ staff: [T('A')] });
  const q = H.leaveQuota({ staffId: 'A' });
  eq('sick leave defaults to 30', by(q, 'ลาป่วย').quota, 30);
  eq('...personal leave to 3', by(q, 'ลากิจ').quota, 3);
  eq('...holiday to the school’s 6', by(q, 'ลาพักร้อน').quota, 6);
  eq('and none of it is marked as personal to them', q.filter(x => x.own).length, 0);
}

console.log('\n2) ครู A 6 วัน / ครู B 8 วัน — the case the school asked for, verbatim');
{
  const { H } = boot({ staff: [T('A'), T('B', { LeaveQuota: '{"ลาพักร้อน":8}' })] });
  eq('A is on the school’s 6', by(H.leaveQuota({ staffId: 'A' }), 'ลาพักร้อน').quota, 6);
  eq('B has the 8 the school gave her', by(H.leaveQuota({ staffId: 'B' }), 'ลาพักร้อน').quota, 8);
  eq('...and B’s screen can say that 8 is hers, not the standard', by(H.leaveQuota({ staffId: 'B' }), 'ลาพักร้อน').own, true);
  /* MERGED, NOT REPLACED — the whole design. Setting B's holiday must not freeze her sick leave at
   * today's number, or raising the school's ลาป่วย next year reaches everybody except the people
   * somebody once edited. */
  eq('B still gets the school’s sick leave, which nobody re-typed', by(H.leaveQuota({ staffId: 'B' }), 'ลาป่วย').quota, 30);
  eq('...and it is NOT marked as hers', by(H.leaveQuota({ staffId: 'B' }), 'ลาป่วย').own, false);
}
{
  // ...and the proof: the school raises its own number afterwards, and B moves with it
  const { H } = boot({ staff: [T('B', { LeaveQuota: '{"ลาพักร้อน":8}' })], schoolQuota: { 'ลาป่วย': 35, 'ลากิจ': 3, 'ลาพักร้อน': 6 } });
  const q = H.leaveQuota({ staffId: 'B' });
  eq('raising the school’s sick leave reaches an overridden teacher too', by(q, 'ลาป่วย').quota, 35);
  eq('...while her own holiday figure stays hers', by(q, 'ลาพักร้อน').quota, 8);
}

console.log('\n3) A BLANK IS NOT A ZERO — this one silently takes leave away');
{
  const cases = [['', 'an empty cell'], ['   ', 'whitespace'], ['not json', 'something unparseable'],
                 [null, 'null'], ['[]', 'an array'], ['{}', 'an empty object']];
  cases.forEach(([v, label]) => {
    const q = boot({ staff: [T('A', { LeaveQuota: v })] }).H.leaveQuota({ staffId: 'A' });
    eq(label + ' leaves them on the school’s numbers', [by(q, 'ลาป่วย').quota, by(q, 'ลาพักร้อน').quota], [30, 6]);
  });
  // a blank INSIDE the object is the same thing: the admin cleared that one box
  const q = boot({ staff: [T('A', { LeaveQuota: '{"ลาพักร้อน":"","ลากิจ":5}' })] }).H.leaveQuota({ staffId: 'A' });
  eq('a cleared box falls back, while the one beside it still applies', [by(q, 'ลาพักร้อน').quota, by(q, 'ลากิจ').quota], [6, 5]);
  // ...but a real 0 IS an override: "no holiday this year" is a decision the school may make
  const z = boot({ staff: [T('A', { LeaveQuota: '{"ลาพักร้อน":0}' })] }).H.leaveQuota({ staffId: 'A' });
  eq('an explicit 0 is honoured — it is a decision, not a blank', [by(z, 'ลาพักร้อน').quota, by(z, 'ลาพักร้อน').own], [0, true]);
}
{
  // an object (not a string) is what the engine sees in mock and what JSON.parse gives on GAS
  const q = boot({ staff: [T('A', { LeaveQuota: { 'ลาพักร้อน': 12 } })] }).H.leaveQuota({ staffId: 'A' });
  eq('an already-parsed object works too', by(q, 'ลาพักร้อน').quota, 12);
}

console.log('\n4) the days come OFF that person’s own entitlement');
{
  const { H } = boot({
    staff: [T('B', { LeaveQuota: '{"ลาพักร้อน":8}' })],
    leaves: [{ LeaveID: 'L1', StaffID: 'B', Type: 'ลาพักร้อน', StartDate: '2026-03-02', EndDate: '2026-03-04', Days: 3, Status: 'APPROVED' },
             { LeaveID: 'L2', StaffID: 'B', Type: 'ลาป่วย', StartDate: '2026-04-01', EndDate: '2026-04-01', Days: 1, Status: 'APPROVED' }]
  });
  const q = H.leaveQuota({ staffId: 'B' });
  eq('three days used off her eight leaves five', [by(q, 'ลาพักร้อน').used, by(q, 'ลาพักร้อน').remain], [3, 5]);
  eq('...and the sick day comes off the school’s thirty', [by(q, 'ลาป่วย').used, by(q, 'ลาป่วย').remain], [1, 29]);
  // the same two leaves against the SCHOOL's 6 would have left 3 — this is the whole point
  const a = boot({ staff: [T('A')],
    leaves: [{ LeaveID: 'L1', StaffID: 'A', Type: 'ลาพักร้อน', StartDate: '2026-03-02', EndDate: '2026-03-04', Days: 3, Status: 'APPROVED' }]
  }).H.leaveQuota({ staffId: 'A' });
  eq('a teacher on the standard entitlement has three left, not five', by(a, 'ลาพักร้อน').remain, 3);
}

console.log('\n5) the admin form, and the column it writes to');
{
  ok_('the boxes are on the staff form', /\$\{quotaFields\('sf',s\)\}/.test(app));
  ok_('...and the save sends them', /data\.LeaveQuota = quotaRead\(m,'sf'\);/.test(app));
  /* THE TYPES COME FROM THE SCHOOL'S OWN TABLE, not a hard-coded three. A school that adds ลาคลอด
   * gets a box for it without anybody editing this function. */
  ok_('the boxes are built from the school’s table', /const school=schoolQuota\(\), own=staffQuota\(s\|\|\{\}\), keys=Object\.keys\(school\);/.test(app)
    && /keys\.map\(\(k,i\)=>/.test(app));
  ok_('...fetched in the SAME batch as the rest of the manage screen, not a trip of its own',
    /api\('getLeaveQuota'\)\.catch\(\(\)=>null\)\]\)/.test(app));
  /* A Thai string in an element id has to be CSS.escape()d at every query; one place forgetting it
   * reads back nothing and drops that teacher's entitlement without a word. Keyed by index instead,
   * with the type carried in a data- attribute. */
  ok_('the boxes are keyed by index, not by a Thai id', /id="\$\{pre\}_q\$\{i\}"/.test(app) && /data-qk="\$\{esc\(k\)\}"/.test(app));
  ok_('an empty form saves as blank, which means "use the school’s"',
    /return Object\.keys\(out\)\.length \? JSON\.stringify\(out\) : '';/.test(app));
  ok_('the form says a blank box means the school default', /เว้นว่าง = ใช้ค่าของโรงเรียน/.test(app));
  ok_('...and shows the school’s number as the placeholder', /placeholder="\$\{esc\(String\(school\[k\]\)\)\}"/.test(app));
  ok_('the column is declared', /'LeaveQuota'\]/.test(cfgGs) || /'LeaveQuota'/.test(cfgGs));
  ok_('...and topped up on save, or the write is dropped in silence',
    /ensureColumns_\(sh, \[[\s\S]*?'LeaveQuota'\]\)/.test(staffGs));
  // the teacher's own screen tells them when a figure was set for them personally
  ok_('the teacher sees which figures are theirs', /q\.own\?` <span title="\$\{EN\(\)\?'set for you'/.test(app));
  ok_('...and a negative balance is not printed as an ordinary number',
    /Number\(q\.remain\)<0\?' style="color:var\(--bad\)"'/.test(app));
}

console.log('\n6) 🛡️ the insurance list leads with the nickname — both halves of it');
{
  ok_('the ENGINE sends the nickname', /nick:s\.Nickname, nickEN:s\.NicknameEN,\n\s+nationalId:s\.NationalID, class:s\.Class, filled:!!rec, record:rec/.test(eng));
  /* AND THE LIVE ROUTE. handleInsuranceList SHADOWS the engine — adding the field to the engine
   * alone would have changed nothing on the school's screen, which is the mistake made twice this
   * week and the reason tools/test_shadow_routes.js exists. */
  ok_('...and so does the LIVE route that shadows it', /nick: s\.Nickname, nickEN: s\.NicknameEN/.test(day6));
  ok_('the row leads with the nickname', /<b>\$\{esc\(dnick\(x\)\|\|x\.name\)\}<\/b>/.test(app));
  ok_('...with the full name, class and id underneath in small text',
    /<br><small class="muted">\$\{esc\(EN\(\)\?\(x\.nameEN\|\|x\.name\):x\.name\)\} · \$\{esc\(x\.class\|\|''\)\}/.test(app));
  ok_('...and falls back to the full name for a child with no nickname, so no row is ever blank',
    /dnick\(x\)\|\|x\.name/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
