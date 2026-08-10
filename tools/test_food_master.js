/**
 * tools/test_food_master.js — master food list, meal slots per class, and the two live bug fixes.
 *   node tools/test_food_master.js
 *
 * Reported live:
 *   - a teacher's time request arrived as a NOTIFICATION to the admin, but the admin's own screen
 *     said "no requests" — it only ever listed stage-2, so anything still with the head teacher was
 *     invisible to the one person told about it
 *   - a parent attached a slip and the finance list still called it ค้างชำระ
 */
const path = require('path'), fs = require('fs');
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
const TODAY = (() => { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })();  // LOCAL date, like the engine's todayLocal(). A UTC date here silently disagrees with the
// engine for the 7 hours after 17:00 Bangkok time, and the suite fails for reasons nobody changed.
const MONTH = TODAY.slice(0, 7);

function fresh() {
  const M = {
    config: { Plans: [{ id: 'p1', price: 6900, end: '17:00' }], Departments: 'Nursery 1\nNursery 2',
      SchoolName: 'Atom Nursery', LeaveQuota: {}, OTRatePerHour: 100, OTGraceMinutes: 21 },
    students: [{ StudentID: 'STD-01', NameTH: 'เด็กหนึ่ง', Nickname: 'หนึ่ง', Class: 'Nursery 1',
      Plan: 'p1', Status: 'ACTIVE', DOB: '2023-01-01', ParentID: 'PAR-01' }],
    staff: [{ StaffID: 'STF-A', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Department: 'Nursery 1' },
            { StaffID: 'STF-L', NameTH: 'หัวหน้าครู', Role: 'Teacher', PositionLevel: 'Leader', Department: 'Nursery 1' },
            { StaffID: 'STF-T', NameTH: 'ครู', Role: 'Teacher', PositionLevel: 'Staff', Department: 'Nursery 1' }],
    parents: [{ ParentID: 'PAR-01', NameTH: 'พ่อ', StudentID: 'STD-01', LineUID: 'U1' }],
    classes: [{ ClassID: 'C1', ClassName: 'Nursery 1', TeacherID: 'STF-T' }],
    foodItems: [], foodMenus: [], surveys: [], surveyResponses: [],
    userLinks: [{ UserUID: 'U1', StudentID: 'STD-01' }],
    growthRecords: [], assessments: [], dspmCriteria: [], journals: [],
    payments: [], prepayments: [], studentCharges: [], paymentSlips: [], otDaily: [],
    otRecords: [], payroll: [], feed: [], injuryReports: [],
    checkinStudent: [], studentCheckins: [], studentAttendanceToday: [], staffAttendanceToday: [],
    activityLog: [], studentLeaves: [], comments: [], leaves: [], leaveUsed: {}, announcements: [],
    withdrawals: [], attendanceReq: [], classChangeReq: [], absenceLog: [], workSchedule: []
  };
  return { M, H: createAtomAPI(M).H };
}

// ============================================================================
console.log('\n1) Master food list — the journal picks from this');
{
  const { M, H } = fresh();
  const r = H.saveFoodItem({ staffId: 'STF-A', item: { nameTH: 'ข้าวต้มไก่', nameEN: 'Chicken rice porridge', category: 'savoury' } });
  ok_('added with an id', !!r.itemId);
  const list = H.foodItems({});
  eq('it is in the list', list.map(i => i.nameTH), ['ข้าวต้มไก่']);
  eq('with both names', [list[0].nameTH, list[0].nameEN], ['ข้าวต้มไก่', 'Chicken rice porridge']);
  eq('and a category', list[0].category, 'savoury');
}
{
  const { H } = fresh();
  H.saveFoodItem({ staffId: 'STF-A', item: { nameTH: 'ข้าวต้มไก่', category: 'savoury' } });
  const again = H.saveFoodItem({ staffId: 'STF-A', item: { nameTH: 'ข้าวต้มไก่', category: 'other' } });
  eq('the same dish twice is not two dishes', [H.foodItems({}).length, again.existed], [1, true]);
  throws_('a nameless dish is refused', () => H.saveFoodItem({ staffId: 'STF-A', item: { nameTH: ' ' } }), 'BAD_INPUT');
}
{
  // this is the point of the design: a TEACHER may add, so the list grows from real use
  const { H } = fresh();
  const r = H.saveFoodItem({ staffId: 'STF-T', item: { nameTH: 'ข้าวผัดกุ้ง', nameEN: 'Shrimp fried rice', category: 'savoury' } });
  ok_('a teacher can add a dish the kitchen actually made', !!r.itemId);
  eq('and it becomes a normal choice', H.foodItems({}).length, 1);
}
{
  const { H } = fresh();
  const r = H.saveFoodItem({ staffId: 'STF-A', item: { nameTH: 'ข้าวต้มไก่', category: 'savoury' } });
  throws_('but only an admin may EDIT the master list', () =>
    H.saveFoodItem({ staffId: 'STF-T', item: { itemId: r.itemId, nameTH: 'อื่น' } }), 'NO_PERMISSION');
  throws_('or retire an item', () => H.deleteFoodItem({ staffId: 'STF-T', itemId: r.itemId }), 'NO_PERMISSION');
}
{
  const { M, H } = fresh();
  const r = H.saveFoodItem({ staffId: 'STF-A', item: { nameTH: 'เลิกใช้', category: 'other' } });
  H.deleteFoodItem({ staffId: 'STF-A', itemId: r.itemId });
  eq('retiring hides it from the picker', H.foodItems({}).length, 0);
  eq('but the row survives — old journals name it', M.foodItems.length, 1);
  eq('and admin can still see it', H.foodItems({ all: true }).length, 1);
}
{
  const { H } = fresh();
  const r = H.seedFoodItems({ staffId: 'STF-A' });
  ok_('the school list seeds ' + r.added + ' dishes', r.added > 25);
  const list = H.foodItems({});
  ok_('every seeded dish has an English name', list.every(i => !!i.nameEN));
  ok_('savoury dishes are there', list.some(i => i.nameTH === 'ข้าวมันไก่' && i.nameEN === 'Hainanese chicken rice'));
  ok_('fruit is categorised as fruit', list.filter(i => i.category === 'fruit').length >= 10);
  ok_('sorted savoury -> dessert -> fruit -> other',
    list.map(i => ['savoury', 'dessert', 'fruit', 'other'].indexOf(i.category)).every((v, i, a) => i === 0 || a[i - 1] <= v));
  eq('seeding twice adds nothing new', H.seedFoodItems({ staffId: 'STF-A' }).added, 0);
  throws_('a teacher cannot seed', () => H.seedFoodItems({ staffId: 'STF-T' }), 'NO_PERMISSION');
}

console.log('\n2) Which meals a class records');
{
  const { H } = fresh();
  eq('Nursery 1 eats dinner here', H.mealSlots({ className: 'Nursery 1' }).slots.map(s => s.key),
    ['Breakfast', 'Lunch', 'Dinner', 'Snack']);
  // The school's rule: the babies are fed on their own schedule and recorded as milk feeds, so the
  // meal section is EMPTY for them — not "all four".
  eq('the baby class records no meals at all', H.mealSlots({ className: 'Nursery Baby' }).slots.map(s => s.key), []);
  eq('...however it is written', H.mealSlots({ className: 'เนอสเซอรี่ เบบี้' }).slots.length, 0);
  eq('Nursery 2 goes home before dinner', H.mealSlots({ className: 'Nursery 2' }).slots.map(s => s.key),
    ['Breakfast', 'Lunch', 'Snack']);
  eq('Nursery 3 as well', H.mealSlots({ className: 'Nursery 3' }).slots.map(s => s.key),
    ['Breakfast', 'Lunch', 'Snack']);
  eq('and Premium', H.mealSlots({ className: 'Nursery Premium' }).slots.map(s => s.key),
    ['Breakfast', 'Lunch', 'Snack']);
  ok_('every slot is labelled in both languages',
    H.mealSlots({ className: 'Nursery 1' }).slots.every(s => s.th && s.en));
}

console.log("\n3) BUG: the admin was notified about a request they could not see");
{
  const { M, H } = fresh();
  // a plain teacher submits -> the request waits with the HEAD TEACHER
  H.submitTimeRequest({ staffId: 'STF-T', type: 'IN', date: TODAY, time: '08:00', reason: 'ลืมลงเวลา' });
  eq('it is waiting on the head teacher', M.attendanceReq[0].Status, 'PENDING_LEADER');
  const seen = H.pendingAdminTimeRequests({ staffId: 'STF-A' });
  eq('the ADMIN can now see it (this used to be empty)', seen.length, 1);
  eq('and is told which step it is on', seen[0].stage, 'leader');
}
{
  const { M, H } = fresh();
  H.submitTimeRequest({ staffId: 'STF-L', type: 'IN', date: TODAY, time: '08:00' });  // a leader skips step 1
  eq('a leader\'s own request goes straight to the admin', M.attendanceReq[0].Status, 'PENDING_ADMIN');
  eq('and is labelled as theirs to decide', H.pendingAdminTimeRequests({ staffId: 'STF-A' })[0].stage, 'admin');
}
{
  const { M, H } = fresh();
  H.submitTimeRequest({ staffId: 'STF-T', type: 'IN', date: TODAY, time: '08:00' });
  const id = M.attendanceReq[0].ReqID;
  H.confirmTimeRequest({ staffId: 'STF-A', reqId: id, decision: 'approve' });
  eq('an admin can settle it without waiting for the head teacher', M.attendanceReq[0].Status, 'APPROVED');
  ok_('and the record says the admin stood in for step 1 — not that a leader approved it',
    /แอดมินอนุมัติแทน/.test(M.attendanceReq[0].Step1By));
  eq('once settled it leaves the queue', H.pendingAdminTimeRequests({ staffId: 'STF-A' }).length, 0);
  throws_('and cannot be decided twice', () =>
    H.confirmTimeRequest({ staffId: 'STF-A', reqId: id, decision: 'reject' }), 'BAD_STATE');
}
{
  const { M, H } = fresh();
  H.submitTimeRequest({ staffId: 'STF-T', type: 'IN', date: TODAY, time: '08:00' });
  const id = M.attendanceReq[0].ReqID;
  H.approveTimeRequest({ staffId: 'STF-L', reqId: id, decision: 'approve' });   // normal 2-step path
  H.confirmTimeRequest({ staffId: 'STF-A', reqId: id, decision: 'approve' });
  eq('the normal route still records the real leader', M.attendanceReq[0].Step1By, 'หัวหน้าครู');
  ok_('with no stand-in note', !/แอดมินอนุมัติแทน/.test(M.attendanceReq[0].Step1By));
}
{
  const { H } = fresh();
  throws_('a teacher cannot read the admin queue', () =>
    H.pendingAdminTimeRequests({ staffId: 'STF-T' }), 'NO_PERMISSION');
}

console.log('\n4) BUG: a slip already sent must not read as ค้างชำระ');
{
  const { M, H } = fresh();
  M.otDaily.push({ OTID: 'OT-1', Date: TODAY, StudentID: 'STD-01', PickupTime: '19:00', PlanEnd: '17:00',
    LateMinutes: 120, Hours: 2, FullAmount: 200, Discount: 0, Amount: 200, Status: 'PARTIAL', SlipRef: '', SlipAmount: 200 });
  M.paymentSlips.push({ SlipID: 'SL-1', RefKind: 'ot', RefID: 'OT-1', StudentID: 'STD-01',
    Amount: 200, Url: 'x', Status: 'CONFIRMED', SubmittedDate: TODAY });
  const s = H.financeSummary({ month: MONTH }).students.find(x => x.studentId === 'STD-01');
  eq('a CONFIRMED slip clears the debt (it used to be ignored)', s.otOpen, 0);
  eq('and counts as money in', s.collected >= 200, true);
}
{
  const { M, H } = fresh();
  M.otDaily.push({ OTID: 'OT-1', Date: TODAY, StudentID: 'STD-01', PickupTime: '19:00', PlanEnd: '17:00',
    LateMinutes: 120, Hours: 2, FullAmount: 200, Discount: 0, Amount: 200, Status: 'PARTIAL', SlipRef: '', SlipAmount: 100 });
  M.paymentSlips.push({ SlipID: 'SL-1', RefKind: 'ot', RefID: 'OT-1', StudentID: 'STD-01',
    Amount: 100, Url: 'x', Status: 'CONFIRMED', SubmittedDate: TODAY });
  const s = H.financeSummary({ month: MONTH }).students.find(x => x.studentId === 'STD-01');
  eq('a part payment leaves only the remainder owing', s.otOpen, 100);
}
{
  // the exact report: parent attached a slip, admin has not checked it yet
  const { M, H } = fresh();
  M.otDaily.push({ OTID: 'OT-1', Date: TODAY, StudentID: 'STD-01', PickupTime: '19:00', PlanEnd: '17:00',
    LateMinutes: 120, Hours: 2, FullAmount: 200, Discount: 0, Amount: 200, Status: 'PENDING_VERIFY', SlipRef: '', SlipAmount: 200 });
  M.paymentSlips.push({ SlipID: 'SL-1', RefKind: 'ot', RefID: 'OT-1', StudentID: 'STD-01',
    Amount: 200, Url: 'x', Status: 'SUBMITTED', SubmittedDate: TODAY });
  const s = H.financeSummary({ month: MONTH }).students.find(x => x.studentId === 'STD-01');
  eq('it is still technically open until checked', s.otherOpen, 200);
  eq('but the whole of it is flagged as awaiting the SCHOOL, not the family', s.otherPending, 200);
  ok_('so the screen can stop calling it overdue', s.otherPending >= s.otherOpen);
}
{
  const { M, H } = fresh();
  // 200 owed: 120 already sent and waiting to be checked, 80 genuinely not paid
  M.otDaily.push({ OTID: 'OT-1', Date: TODAY, StudentID: 'STD-01', PickupTime: '19:00', PlanEnd: '17:00',
    LateMinutes: 120, Hours: 2, FullAmount: 120, Discount: 0, Amount: 120, Status: 'PENDING_VERIFY', SlipRef: '', SlipAmount: 120 });
  M.otDaily.push({ OTID: 'OT-2', Date: TODAY, StudentID: 'STD-01', PickupTime: '18:00', PlanEnd: '17:00',
    LateMinutes: 60, Hours: 1, FullAmount: 80, Discount: 0, Amount: 80, Status: 'UNPAID', SlipRef: '', SlipAmount: 0 });
  M.paymentSlips.push({ SlipID: 'SL-1', RefKind: 'ot', RefID: 'OT-1', StudentID: 'STD-01',
    Amount: 120, Url: 'x', Status: 'SUBMITTED', SubmittedDate: TODAY });
  const s = H.financeSummary({ month: MONTH }).students.find(x => x.studentId === 'STD-01');
  eq('200 open in total', s.otherOpen, 200);
  eq('120 of it is in the admin\'s queue', s.otherPending, 120);
  eq('so only 80 is really overdue', s.otherOpen - s.otherPending, 80);
}
{
  const { M, H } = fresh();
  M.payments.push({ BillingID: 'BL-1', StudentID: 'STD-01', Month: MONTH, Amount: 6900, Status: 'PENDING_VERIFY', SlipAmount: 6900 });
  M.paymentSlips.push({ SlipID: 'SL-1', RefKind: 'bill', RefID: 'BL-1', StudentID: 'STD-01',
    Amount: 6900, Url: 'x', Status: 'SUBMITTED', SubmittedDate: TODAY });
  const s = H.financeSummary({ month: MONTH }).students.find(x => x.studentId === 'STD-01');
  eq('tuition awaiting a check is flagged the same way', s.tuitionPending, 6900);
  eq('and reported together', s.pendingVerify, 6900);
}
{
  const { H } = fresh();
  const s = H.financeSummary({ month: MONTH }).students.find(x => x.studentId === 'STD-01');
  eq('a family with nothing outstanding flags nothing', [s.otherPending, s.tuitionPending], [0, 0]);
}

console.log('\n5) The plumbing');
{
  const ge = fs.readFileSync(path.join(__dirname, '..', 'src', 'GasEngine.gs'), 'utf8');
  ok_('FOOD_ITEMS has declared headers', /FOOD_ITEMS:\s*\[/.test(ge));
  ok_('and is mapped so persist() writes it', /foodItems:\s*\{ wb:/.test(ge));
  const cfg = fs.readFileSync(path.join(__dirname, '..', 'src', 'Config.gs'), 'utf8');
  ok_('MealItems is in the journal schema', /DAILY_JOURNAL:[^\]]*MealItems/.test(cfg));
  const jr = fs.readFileSync(path.join(__dirname, '..', 'src', 'Journal.gs'), 'utf8');
  ok_('...is a saved journal field', /JOURNAL_FIELDS = \[[^\]]*'MealItems'/.test(jr));
  ok_('...and the column is created on write (a field with no column is dropped silently)',
    // don't pin it as the LAST column — the next new field would break this for no reason
    /ensureColumns_\(sheet, \[[^\]]*'MealItems'/.test(jr));
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'Code.gs'), 'utf8');
  ['deleteFoodItem', 'seedFoodItems'].forEach(a =>
    ok_(a + ' is admin-gated at the router too', new RegExp('\\b' + a + ': 1').test(code)));
  ok_('no route shadows the new engine handlers',
    !/\b(foodItems|saveFoodItem|mealSlots)\s*:\s*function/.test(code));
  const MUT = /^(submit|save|add|remove|delete|set|register|pay|upload|confirm|reject|issue|generate|move|import|compute|cancel|prepay|link|notify|request|mark|approve|edit|rename|update|change|seed|recompute|restore|bind|provision)/i;
  ['saveFoodItem', 'deleteFoodItem', 'seedFoodItems'].forEach(a => ok_(a + ' counts as a write', MUT.test(a)));
  ['foodItems', 'mealSlots'].forEach(a => ok_(a + ' correctly does not', !MUT.test(a)));
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' : 'ALL PASS ') + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
