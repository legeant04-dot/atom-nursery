/**
 * tools/test_meals_fund.js — the savings fund total, the not-yet-started teacher, and meals by class.
 *   node tools/test_meals_fund.js
 *
 * The fund is the one that matters most: it is the teacher's own money. เงินสมทบ deducts the
 * teacher's half AND the school matches it, so 200 deducted must add 400 to the fund. A slip saved
 * before the school's half was recorded holds a total short by that half for every such month —
 * which is "35,200 where it should say 35,400".
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
const app = R('webapp/app.js'), eng = R('webapp/engine.js'), pay = R('src/Payroll.gs'), code = R('src/Code.gs'), ge = R('src/GasEngine.gs');

function boot(over) {
  const M = {
    config: { Plans: [], LeaveQuota: {}, ContributionMatchRate: 1 },
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
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(R('webapp/engine.js'), ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}

console.log('\n1) เงินสมทบ: the fund grows by BOTH halves');
{
  // the reported case: opening 35,000, one month of 200 — the school matches it, so 35,400
  const { H } = boot({
    staff: [{ StaffID: 'S1', NameTH: 'ครู', Role: 'Teacher', ContributionOpening: 35000 }],
    payroll: [{ PayrollID: 'PR-1', StaffID: 'S1', Month: '2026-08', Contribution: 200,
                ContributionEmployer: '', ContributionAccum: 35200 }]   // saved before the match was recorded
  });
  const slip = H.getPayslip({ staffId: 'S1', month: '2026-08' });
  eq('the stored 35,200 was short by the school’s half', slip.ContributionAccum, 35400);
  eq('...and the school’s half is filled in rather than shown blank', slip.ContributionEmployer, 200);
  eq('the deduction itself is untouched — it is the teacher’s half only', slip.Contribution, 200);
}
{
  // several months, some recorded before the employer half existed and some after
  const { H } = boot({
    staff: [{ StaffID: 'S1', ContributionOpening: 1000 }],
    payroll: [
      { StaffID: 'S1', Month: '2026-06', Contribution: 200, ContributionEmployer: '' },   // reconstructed → 200
      { StaffID: 'S1', Month: '2026-07', Contribution: 200, ContributionEmployer: 200 },
      { StaffID: 'S1', Month: '2026-08', Contribution: 300, ContributionEmployer: 300 }
    ]
  });
  eq('1000 + (200+200) + (200+200) + (300+300)', H.getPayslip({ staffId: 'S1', month: '2026-08' }).ContributionAccum, 2400);
  eq('an earlier month shows the SAME running total, not a partial one',
    H.getPayslip({ staffId: 'S1', month: '2026-06' }).ContributionAccum, 2400);
}
{
  // the school can set its match to something other than 1:1
  const { H } = boot({
    config: { ContributionMatchRate: 0.5, Plans: [], LeaveQuota: {} },
    staff: [{ StaffID: 'S1', ContributionOpening: 0 }],
    payroll: [{ StaffID: 'S1', Month: '2026-08', Contribution: 200, ContributionEmployer: '' }]
  });
  eq('a half match reconstructs as 100, so the fund holds 300', H.getPayslip({ staffId: 'S1', month: '2026-08' }).ContributionAccum, 300);
}
{
  const { H } = boot({ staff: [{ StaffID: 'S1', ContributionOpening: 500 }], payroll: [] });
  eq('no payroll rows yet → just the opening balance', H.getPayslip({ staffId: 'S1', month: '2026-08' }), null);
}
{
  const { H, M } = boot({
    staff: [{ StaffID: 'S1', ContributionOpening: 1000 }],
    payroll: [{ StaffID: 'S1', Month: '2026-08', Contribution: 200, ContributionEmployer: '', ContributionAccum: 1200 }]
  });
  H.getPayslip({ staffId: 'S1', month: '2026-08' });
  eq('reading a slip does not rewrite the stored row', M.payroll[0].ContributionAccum, 1200);
}
{
  // the live path is the ROUTE, not the engine — an engine-only fix would have changed nothing
  ok_('getPayslip is routed, so the route is what had to be fixed', /getPayslip:\s*function/.test(code));
  ok_('the route derives the total instead of reading it back', /function handleGetPayslip[\s\S]{0,1600}accum \+= num_\(r\.Contribution\) \+ empOf\(r\)/.test(pay));
  ok_('...reconstructing a missing employer half at the current rate', /function handleGetPayslip[\s\S]{0,1400}round2_\(own \* matchRate\)/.test(pay));
  ok_('a failure to total must not take the payslip down', /catch \(e\) \{ accum = num_\(row\.ContributionAccum\); \}/.test(pay));
  ok_('the engine mirrors it, so mock and live agree', /getPayslip: p => \{[\s\S]{0,900}ContributionAccum:Math\.round\(accum\*100\)\/100/.test(eng));
}

console.log('\n2) A teacher who has not started sees the date, not live buttons');
{
  ok_('the card shows the start date instead', /att\.notStarted\?`<div style="background:var\(--warn-bg\)/.test(app));
  ok_('...naming the first working day', /วันแรกของการทำงาน/.test(app));
  ok_('...and saying nothing counts against them yet', /ระบบไม่นับสาย\/ขาดงาน/.test(app));
  // the buttons are in the branch that is now skipped entirely
  const i = app.indexOf("${me0.RequireCheckin===false?");
  const card = app.slice(i, app.indexOf('<div id="tcatt">', i));
  ok_('the check-in buttons are not rendered at all before the start date',
    card.indexOf('att.notStarted') < card.indexOf("T_punch('in'"));
  ok_('the server still refuses it independently of the screen', /function assertStaffStarted_/.test(R('src/Checkin.gs')));
  ok_('and the engine tells the screen which case it is', /notStarted:!staffStarted_\(me\), startDate:/.test(eng));
}

console.log('\n3) Meals per class — the school’s rule');
{
  const { H } = boot({});
  const keys = c => H.mealSlots({ className: c }).slots.map(s => s.key);
  eq('Nursery Baby records NO meals', keys('Nursery Baby'), []);
  eq('Nursery 1 records all four, dinner included', keys('Nursery 1'), ['Breakfast','Lunch','Dinner','Snack']);
  eq('Nursery 2 — everything except dinner', keys('Nursery 2'), ['Breakfast','Lunch','Snack']);
  eq('Nursery 3 the same', keys('Nursery 3'), ['Breakfast','Lunch','Snack']);
  eq('Nursery Premium the same', keys('Nursery Premium'), ['Breakfast','Lunch','Snack']);
  // "Nursery 1" must not be matched by a number that merely contains a 1
  eq('Nursery 10 is not Nursery 1', keys('Nursery 10'), ['Breakfast','Lunch','Snack']);
  eq('nor Nursery 21', keys('Nursery 21'), ['Breakfast','Lunch','Snack']);
  eq('a Thai baby class is still the baby class', keys('เนอสเซอรี่ เบบี้'), []);
  eq('an unknown class gets the common three rather than nothing', keys('ชั้นใหม่'), ['Breakfast','Lunch','Snack']);
}

console.log('\n4) The monthly menu fills the journal in');
{
  const { H } = boot({
    foodMenus: [{ MenuID:'m1', Class:'Nursery 1', Date:'2026-08-10',
      Breakfast:'ข้าวต้มไก่', Lunch:'ข้าวผัด', Dinner:'ก๋วยเตี๋ยว', SnackAM:'กล้วย', SnackPM:'นม' }]
  });
  const r = H.mealSlots({ className:'Nursery 1', date:'2026-08-10' });
  eq('what the kitchen planned comes back per meal',
    r.planned, { Breakfast:'ข้าวต้มไก่', Lunch:'ข้าวผัด', Dinner:'ก๋วยเตี๋ยว', Snack:'กล้วย' });
}
{
  // each class has its OWN monthly menu — so this needs a Nursery 2 menu that (wrongly) carries a
  // dinner, to prove the dinner is dropped for a class that does not eat one
  const { H } = boot({
    foodMenus: [{ MenuID:'m2', Class:'Nursery 2', Date:'2026-08-10',
      Breakfast:'โจ๊ก', Lunch:'ข้าวไก่', Dinner:'ผัดไทย', SnackAM:'ส้ม' }]
  });
  const r2 = H.mealSlots({ className:'Nursery 2', date:'2026-08-10' });
  eq('a class that does not eat dinner is not offered the dinner plan', Object.keys(r2.planned).sort(), ['Breakfast','Lunch','Snack']);
  eq('...the other three still come through', [r2.planned.Breakfast, r2.planned.Lunch, r2.planned.Snack], ['โจ๊ก','ข้าวไก่','ส้ม']);
  eq('no menu for that day → nothing is pre-filled', H.mealSlots({ className:'Nursery 1', date:'2026-08-11' }).planned, {});
  eq('no date asked for → nothing is pre-filled', H.mealSlots({ className:'Nursery 1' }).planned, {});
  eq('the baby class is never pre-filled, having no meals', H.mealSlots({ className:'Nursery Baby', date:'2026-08-10' }).planned, {});
}
{
  const { H } = boot({ foodMenus: [{ Class:'Nursery 1', Date:'2026-08-10', SnackPM:'ขนมปัง' }] });
  eq('with only an afternoon snack planned, that is what the one snack slot uses',
    H.mealSlots({ className:'Nursery 1', date:'2026-08-10' }).planned.Snack, 'ขนมปัง');
}
{
  ok_('the journal asks for the plan when it opens', /api\('mealSlots',\{className:s\.Class\|\|'',date:todayStr\(\)\}\)/.test(app));
  // a teacher's own entry must win — the menu is a starting point, not an override
  ok_('what the teacher wrote takes precedence over the plan', /const chosen = k => items\[k\] \|\| JPLAN\[k\] \|\| ''/.test(app));
  ok_('a pre-filled slot says where it came from', /จากเมนูประจำเดือน/.test(app));
  ok_('a class with no meals says so instead of showing an empty box', /บันทึกเป็นมื้อนมแทนมื้ออาหาร/.test(app));
}

console.log('\n5) Dinner exists everywhere the menu does');
{
  ok_('the sheet has a Dinner column', /FOOD_MENU:[^\]]*'Lunch', 'Dinner', 'SnackPM'/.test(ge));
  ok_('the menu reads it back', /lunch:r\.Lunch\|\|'', dinner:r\.Dinner\|\|''/.test(eng));
  ok_('and writes it', /Lunch:d\.lunch\|\|'', Dinner:d\.dinner\|\|''/.test(eng));
  ok_('a day holding only a dinner is not treated as empty and deleted', /const blank=!\(d\.breakfast\|\|d\.snackAM\|\|d\.lunch\|\|d\.dinner\|\|d\.snackPM\|\|d\.note\)/.test(eng));
  ok_('the editor offers a dinner field', /\['dinner',\(\)=>EN\(\)\?'Dinner':'อาหารเย็น'\]/.test(app));
  ok_('...and sends it', /dinner:g\('dinner'\)/.test(app));
  ok_('the editor only shows the meals that class actually records', /FM_MEALS\.filter\(\(\[k\]\)=>fmShows\(k\)\)/.test(app));
  ok_('both snacks map onto the journal’s single snack slot', /if\(k==='snackAM'\|\|k==='snackPM'\) return slots\.indexOf\('Snack'\)>=0/.test(app));
  ok_('the menu carries the slot list so the screens cannot invent their own rule', /slots: mealSlotsFor_\(cls\)/.test(eng));
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' : 'ALL PASS ') + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
