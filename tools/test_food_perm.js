/**
 * tools/test_food_perm.js — the teacher the admin put in charge of the monthly food menu.
 *   node tools/test_food_perm.js
 *
 * The admin ticks "ให้ครูคนนี้จัดการเมนูอาหารรายเดือนได้" and the teacher sees nothing. Two
 * independent blockers, either of which alone makes the tick do nothing:
 *   1. staffSelf — what the teacher's home screen decides from — never returned CanFoodMenu.
 *   2. ADMIN_ONLY in src/Code.gs listed saveFoodMenu, so the save was refused before the engine's
 *      CanFoodMenu check could ever run.
 * The rule now lives in ONE function, canFoodMenu_, used by both the screen and the handler.
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
const app = R('webapp/app.js'), code = R('src/Code.gs'), gasEngine = R('src/Engine.gs');

function boot(over) {
  const M = {
    config: { Plans: [], LeaveQuota: {} },
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

const ADMIN = { StaffID: 'S-A', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin' };
const KITCHEN = { StaffID: 'S-K', NameTH: 'ครูกุ้ง', Role: 'Teacher', PositionLevel: 'Leader', CanFoodMenu: 'YES' };
const PLAIN = { StaffID: 'S-P', NameTH: 'ครูก้อย', Role: 'Teacher', PositionLevel: 'Officer', CanFoodMenu: '' };
const OBS = { StaffID: 'S-O', NameTH: 'ผู้ตรวจ', Role: 'Observer', PositionLevel: 'Officer' };
const staff = () => JSON.parse(JSON.stringify([ADMIN, KITCHEN, PLAIN, OBS]));

console.log('\n1) staffSelf tells the screen whether to show the button');
{
  const { H } = boot({ staff: staff() });
  eq('the delegated teacher: yes', H.staffSelf({ staffId: 'S-K' }).CanFoodMenu, true);
  eq('a teacher without the tick: no', H.staffSelf({ staffId: 'S-P' }).CanFoodMenu, false);
  eq('an admin: always', H.staffSelf({ staffId: 'S-A' }).CanFoodMenu, true);
  eq('an observer may open it (read-only is enforced on write)', H.staffSelf({ staffId: 'S-O' }).CanFoodMenu, true);
  // the flag must not have cost us the rest of the record
  ok_('the record is otherwise unchanged', H.staffSelf({ staffId: 'S-K' }).NameTH === 'ครูกุ้ง'
    && H.staffSelf({ staffId: 'S-K' }).CanClassOrg === true);
}

console.log('\n2) the tick is read in every shape a sheet can hold it');
{
  ['YES', 'yes', 'TRUE', 'true', '1', 1, true].forEach(v => {
    const { H } = boot({ staff: [Object.assign({}, PLAIN, { CanFoodMenu: v })] });
    eq('CanFoodMenu=' + JSON.stringify(v), H.staffSelf({ staffId: 'S-P' }).CanFoodMenu, true);
  });
  ['', 'NO', 'FALSE', 0, false, undefined].forEach(v => {
    const { H } = boot({ staff: [Object.assign({}, PLAIN, { CanFoodMenu: v })] });
    eq('CanFoodMenu=' + JSON.stringify(v) + ' → no', H.staffSelf({ staffId: 'S-P' }).CanFoodMenu, false);
  });
}

console.log('\n3) and the same answer decides whether the save is accepted');
{
  const days = [{ date: '2026-08-03', lunch: 'ข้าวมันไก่' }];
  const args = { className: 'Nursery 1', month: '2026-08', days: days };

  const a = boot({ staff: staff() });
  a.H.saveFoodMenu(Object.assign({ staffId: 'S-K' }, args));
  eq('the delegated teacher CAN save', a.M.foodMenus.length, 1);
  eq('...and it is the dish they picked', a.M.foodMenus[0].Lunch, 'ข้าวมันไก่');

  const b = boot({ staff: staff() });
  let refused = '';
  try { b.H.saveFoodMenu(Object.assign({ staffId: 'S-P' }, args)); } catch (e) { refused = e.message || String(e); }
  ok_('a teacher without the tick is refused', /ไม่มีสิทธิ์จัดการเมนูอาหาร/.test(refused));
  eq('...and nothing was written', b.M.foodMenus.length, 0);

  const c = boot({ staff: staff() });
  c.H.saveFoodMenu(Object.assign({ staffId: 'S-A' }, args));
  eq('an admin can still save', c.M.foodMenus.length, 1);

  const d = boot({ staff: staff() });
  let anon = '';
  try { d.H.saveFoodMenu(Object.assign({ staffId: 'nobody' }, args)); } catch (e) { anon = e.message || String(e); }
  ok_('an unknown staffId is refused', /ไม่มีสิทธิ์จัดการเมนูอาหาร/.test(anon));
}

console.log('\n4) the screen and the server agree, because it is one rule');
{
  const eng = R('webapp/engine.js');
  ok_('canFoodMenu_ exists', /function canFoodMenu_\(staff\)/.test(eng));
  ok_('staffSelf uses it', /CanFoodMenu: canFoodMenu_\(s\)/.test(eng));
  ok_('saveFoodMenu uses it', /if\(!canFoodMenu_\(ap\)\) fail\('NO_PERMISSION'/.test(eng));
  ok_('the old duplicated check is gone', !/const yes=\['YES','TRUE','1'\]\.indexOf\(String\(ap\.CanFoodMenu/.test(eng));
  ok_('the teacher home screen reads the flag', /const canFood = \['YES','TRUE','1'\]\.indexOf\(String\(me0\.CanFoodMenu/.test(app));
  ok_('and shows the button', /canFood\?`<button[^`]*A_foodMenu\(\)/.test(app));
}

console.log('\n5) the GAS gate no longer refuses the delegated teacher');
{
  const list = code.slice(code.indexOf('var ADMIN_ONLY'), code.indexOf('parentKidsMap: 1 }'));
  ok_('saveFoodMenu is NOT admin-only', !/(^|[^a-zA-Z])saveFoodMenu: 1/.test(list));
  // everything else about the food screens stays locked down
  ok_('seeding the master list is still admin-only', /seedFoodItems: 1/.test(list));
  ok_('retiring a dish is still admin-only', /deleteFoodItem: 1/.test(list));
  ok_('survey results are still admin-only', /surveyResults: 1/.test(list));
  ok_('the reason is written down where the next person will look', /CanFoodMenu/.test(list));
}

console.log('\n6) Engine.gs was rebuilt — an engine-only fix that is not pushed changes nothing live');
{
  ok_('canFoodMenu_ is in the built Engine.gs', /function canFoodMenu_\(staff\)/.test(gasEngine));
  ok_('staffSelf in Engine.gs returns it', /CanFoodMenu: canFoodMenu_\(s\)/.test(gasEngine));
  // and no explicit route may shadow either action, or the fix would be invisible on live
  const routes = code.slice(code.indexOf('var ROUTES'), code.indexOf('function applyIdentity_'));
  ok_('staffSelf is not shadowed by a route', !/\n\s*staffSelf:\s*function/.test(routes));
  ok_('saveFoodMenu is not shadowed by a route', !/\n\s*saveFoodMenu:\s*function/.test(routes));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
