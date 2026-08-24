/**
 * tools/test_menu_shared.js — one menu a day for the whole school.
 *   node tools/test_menu_shared.js
 *
 * The kitchen cooks once and every class eats the same food, so the menu is entered once per day and
 * the class picker is gone. WHO eats which meal is still a class rule, and it moved to where the
 * menu is READ:
 *     Nursery Baby            no meals at all (they record milk feeds)
 *     Nursery 1               every meal, dinner included
 *     Nursery 2 / 3 / Premium every meal EXCEPT dinner
 * The same rule has to hold in three places at once — the planner, the child's journal, and the
 * parent's copy — or the school would serve one thing and show another.
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
const app = R('webapp/app.js'), eng = R('webapp/engine.js');

const MONTH = '2026-08', DAY = '2026-08-03';
function boot(over) {
  const M = {
    config: { Plans: [], LeaveQuota: {} },
    students: [], parents: [], userLinks: [], staff: [], leaves: [], payments: [], otDaily: [],
    studentCharges: [], prepayments: [], paymentSlips: [], checkinStudent: [], journals: [], comments: [],
    holidays: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    payroll: [], payrollConfig: {}, studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [],
    announcements: [], notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [],
    classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [],
    surveyResponses: [], injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {},
    feed: [], calendar: [], classes: [], studentAttendanceToday: [], studentCheckins: []
  };
  Object.assign(M, over || {});
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(R('webapp/engine.js'), ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
const ADMIN = { StaffID: 'A1', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin' };
const FULL = { date: DAY, breakfast: 'โจ๊ก', snackAM: 'นม', lunch: 'ข้าวมันไก่', snackPM: 'ผลไม้', dinner: 'ข้าวต้ม' };

console.log('\n1) the menu is entered once, for everybody');
{
  const { H, M } = boot({ staff: [ADMIN] });
  let threw = ''; try { H.saveFoodMenu({ staffId: 'A1', month: MONTH, days: [FULL] }); } catch (e) { threw = e.message || String(e); }
  eq('no class has to be named to save one', threw, '');
  eq('one row is written, not one per class', M.foodMenus.length, 1);
  eq('...and it is not tied to a class', (M.foodMenus[0]||{}).Class, 'ALL');
  eq('every meal is kept', [(M.foodMenus[0]||{}).Breakfast, (M.foodMenus[0]||{}).Lunch, (M.foodMenus[0]||{}).Dinner], ['โจ๊ก', 'ข้าวมันไก่', 'ข้าวต้ม']);
  // whichever class asks, the food is the same
  ['Nursery 1', 'Nursery 2', 'Nursery 3', 'Nursery Premium', 'Nursery Baby'].forEach(c =>
    eq(c + ' is served the same lunch', (H.foodMenu({ className: c, month: MONTH }).days[0]||{}).lunch, 'ข้าวมันไก่'));
}

console.log('\n2) who is OFFERED each meal — the rule the school actually has');
{
  const { H } = boot({ staff: [ADMIN] });
  const keys = c => H.foodMenu({ className: c, month: MONTH }).slots.map(s => s.key);
  eq('Nursery Baby: no meals at all', keys('Nursery Baby'), []);
  eq('Nursery 1: every meal, dinner included', keys('Nursery 1'), ['Breakfast', 'Lunch', 'Dinner', 'Snack']);
  eq('Nursery 2: no dinner', keys('Nursery 2'), ['Breakfast', 'Lunch', 'Snack']);
  eq('Nursery 3: no dinner', keys('Nursery 3'), ['Breakfast', 'Lunch', 'Snack']);
  eq('Nursery Premium: no dinner', keys('Nursery Premium'), ['Breakfast', 'Lunch', 'Snack']);
  eq('the planner (no class) is offered everything', H.foodMenu({ month: MONTH }).slots.map(s => s.key), ['Breakfast', 'Lunch', 'Dinner', 'Snack']);
  // the boundary that makes this rule safe to write down
  eq('"Nursery 10" is NOT Nursery 1', keys('Nursery 10').indexOf('Dinner') >= 0, false);
  eq('"เบบี้" counts as the baby class', keys('เบบี้'), []);
}

console.log('\n3) the journal pre-fills from that one menu, per class');
{
  const { H } = boot({ staff: [ADMIN] });
  H.saveFoodMenu({ staffId: 'A1', month: MONTH, days: [FULL] });
  const planned = c => H.mealSlots({ className: c, date: DAY }).planned;
  eq('Nursery 1 gets all four, dinner included', planned('Nursery 1'),
    { Breakfast: 'โจ๊ก', Lunch: 'ข้าวมันไก่', Dinner: 'ข้าวต้ม', Snack: 'นม' });
  eq('Nursery 2 gets the same food, minus dinner', planned('Nursery 2'),
    { Breakfast: 'โจ๊ก', Lunch: 'ข้าวมันไก่', Snack: 'นม' });
  eq('Nursery Baby gets nothing to pre-fill', planned('Nursery Baby'), {});
  eq('...and no meal section either', H.mealSlots({ className: 'Nursery Baby', date: DAY }).slots, []);
  // the afternoon snack is the fallback when only it is planned
  const b = boot({ staff: [ADMIN] });
  b.H.saveFoodMenu({ staffId: 'A1', month: MONTH, days: [{ date: DAY, snackPM: 'ขนมปัง' }] });
  eq('an afternoon-only snack still reaches the journal', b.H.mealSlots({ className: 'Nursery 2', date: DAY }).planned, { Snack: 'ขนมปัง' });
}

console.log('\n4) menus typed per class BEFORE this change are not lost');
{
  const legacy = [
    { MenuID: 'FM-1', Class: 'Nursery 2', Date: DAY, Lunch: 'ของชั้น 2' },
    { MenuID: 'FM-2', Class: 'Nursery 1', Date: DAY, Lunch: 'ของชั้น 1', Dinner: 'เย็นของชั้น 1' }
  ];
  const { H } = boot({ staff: [ADMIN], foodMenus: legacy.slice() });
  const d = H.foodMenu({ month: MONTH });
  eq('the day still has a menu', d.days.length, 1);
  eq('the FULLEST old row wins, so the least is lost', [(d.days[0]||{}).lunch, (d.days[0]||{}).dinner], ['ของชั้น 1', 'เย็นของชั้น 1']);
  eq('and the screen can say where it came from', (d.days[0]||{}).legacyClass, 'Nursery 1');
  // a Nursery 2 family is still not shown a dinner they never had
  eq('Nursery 2 is not offered dinner from it', H.mealSlots({ className: 'Nursery 2', date: DAY }).planned, { Lunch: 'ของชั้น 1' });
}
{
  const { H, M } = boot({ staff: [ADMIN], foodMenus: [{ MenuID: 'FM-1', Class: 'Nursery 2', Date: DAY, Lunch: 'ของเก่า' }] });
  H.saveFoodMenu({ staffId: 'A1', month: MONTH, days: [{ date: DAY, lunch: 'ของใหม่' }] });
  eq('a shared menu overrides the old one', (H.foodMenu({ month: MONTH }).days[0]||{}).lunch, 'ของใหม่');
  eq('...and stops being flagged as legacy', (H.foodMenu({ month: MONTH }).days[0]||{}).legacyClass, '');
  eq('the old row is still on file, harmlessly', M.foodMenus.length, 2);
}
{
  // the trap: clearing a day must not resurrect the class menu underneath it
  const { H } = boot({ staff: [ADMIN], foodMenus: [{ MenuID: 'FM-1', Class: 'Nursery 2', Date: DAY, Lunch: 'ของเก่า' }] });
  H.saveFoodMenu({ staffId: 'A1', month: MONTH, days: [{ date: DAY, lunch: 'ของใหม่' }] });
  H.saveFoodMenu({ staffId: 'A1', month: MONTH, days: [{ date: DAY }] });
  eq('cleared means cleared', H.foodMenu({ month: MONTH }).days.length, 0);
  eq('...and the journal has nothing to pre-fill', H.mealSlots({ className: 'Nursery 1', date: DAY }).planned, {});
}

console.log('\n5) the same permission and the same guards as before');
{
  const teacher = { StaffID: 'T1', Role: 'Teacher', PositionLevel: 'Officer' };
  const kitchen = { StaffID: 'K1', Role: 'Teacher', PositionLevel: 'Officer', CanFoodMenu: 'YES' };
  const b = boot({ staff: [ADMIN, teacher, kitchen] });
  let refused = ''; try { b.H.saveFoodMenu({ staffId: 'T1', month: MONTH, days: [FULL] }); } catch (e) { refused = e.message || String(e); }
  ok_('a teacher without the tick is still refused', /ไม่มีสิทธิ์จัดการเมนูอาหาร/.test(refused));
  b.H.saveFoodMenu({ staffId: 'K1', month: MONTH, days: [FULL] });
  eq('the delegated teacher can still save', b.H.foodMenu({ month: MONTH }).days.length, 1);
  const c = boot({ staff: [ADMIN] });
  c.H.saveFoodMenu({ staffId: 'A1', month: MONTH, days: [{ date: '2020-01-05', lunch: 'นอกเดือน' }, FULL] });
  eq('a date outside the month is still refused', c.H.foodMenu({ month: MONTH }).days.map(d => d.date), [DAY]);
}

console.log('\n6) the screens follow the same rule');
{
  ok_('the planner has no class picker', !/id="fmCls"/.test(app));
  ok_('...and no class list is fetched for it', !/const list=\[\.\.\.new Set/.test(app.slice(app.indexOf('window.A_foodMenu='), app.indexOf('window.A_fmPick='))));
  ok_('the planner shows every meal', /FM_MEALS\.map\(\(\[k,lb\]\)=>/.test(app));
  ok_('...each labelled with who eats it', /fmWho\(k\)/.test(app) && /เฉพาะ Nursery 1/.test(app));
  ok_('the save sends no class', /api\('saveFoodMenu',\{staffId:USER\.staffId,month:FM_MONTH,days:A_fmCollect\(\)\}\)/.test(app));
  ok_('the month picker still works on its own', /A_fmPick=\(month\)=>/.test(app));
  // the parent's plan-only menu screen was removed in v221: the JOURNAL is where a family reads the
  // day's food, and it already applies the class rule (section 3 above)
  ok_('the parent has no separate menu screen to keep in step', !/window\.P_menu = async/.test(app));
  ok_('the rule itself lives in ONE place in the engine', /function mealSlotsFor_\(className\)/.test(eng) &&
    (eng.match(/staysForDinner_\(c\) \? all : all\.filter/g) || []).length === 1);
  ok_('a day from an old class menu is labelled on screen', /v\.legacyClass\?/.test(app));
  ok_('and the screen explains the rule to whoever is typing', /Nursery Baby ไม่แสดงมื้ออาหาร/.test(app));
}

console.log('\n7) the payment card finally adds up');
{
  const home = app.slice(app.indexOf('const payHtml='), app.indexOf('const remHtml ='));
  ok_('a grand total is shown', /ยอดทั้งหมดเดือนนี้/.test(home));
  /* v259: THREE kinds of money, not two. A ฿2,000 entry fee was billed and shown nowhere, and the
   * total added the OT twice — `fin.tuitionCollected` has never been tuition, it is Σ collected
   * (tuition + charges + OT), so adding otCollected to it counted the OT a second time. */
  ok_('it is tuition + extra charges + student OT', /_allTotal=_allIn\+_allOut/.test(app) &&
    /_allIn=Number\(fin\.collectedAll\|\|0\)/.test(app) && /_allOut=tuiOut\+_chOut\+_otOut/.test(app));
  ok_('...and each kind is counted once', /const collectedAll=collectedTuition\+collectedCharges\+collectedOT;/.test(eng));
  ok_('extra charges have a line of their own', /ค่าใช้จ่ายเพิ่มเติม/.test(home));
  ok_('with the split kept underneath it', /\$\{baht\(_allIn\)\}[\s\S]{0,120}\$\{baht\(_allOut\)\}/.test(home));
  ok_('it sits at the top of the card, before the tuition row', home.indexOf('ยอดทั้งหมดเดือนนี้') < home.indexOf('ค่าเทอมรายเดือน'));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
