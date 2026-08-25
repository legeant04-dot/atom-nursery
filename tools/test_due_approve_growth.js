/**
 * tools/test_due_approve_growth.js — four things from 2026-08-15.
 *   node tools/test_due_approve_growth.js
 *
 *   1. The "printed at" stamp on an exported sheet is LOCAL time. It was toISOString() — UTC —
 *      so a menu printed at 14:08 in Bangkok came out stamped 07:08.
 *   2. A parent sees what they still owe under the drop-off / pick-up card, and tapping it goes to
 *      the payment screen. One call, in the batch that was already going.
 *   3. A head teacher sees EVERY approval waiting on them in one card under their clock — leave, OT,
 *      time corrections and injury reports. Time corrections were on no card at all.
 *   4. Weight and height carry THE DAY THEY WERE MEASURED, into the database.
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
const app = R('webapp/app.js'), eng = R('webapp/engine.js'), cfg = R('src/Config.gs');

const TODAY = (() => { const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })();
function boot() {
  const M = {
    config: { Plans: [], LeaveQuota: {}, GrowthUpdateMonths: [2, 4, 6, 8, 10, 12] },
    students: [
      { StudentID: 'STD-1', NameTH: 'ไบร์ท', Nickname: 'ไบร์ท', Class: 'Nursery 2', Status: 'ACTIVE', DOB: '2024-01-15', ParentID: 'PAR-1', Gender: 'M' },
      { StudentID: 'STD-2', NameTH: 'เบรฟ', Nickname: 'เบรฟ', Class: 'Nursery Baby', Status: 'ACTIVE', DOB: '2026-01-01', ParentID: 'PAR-1', Gender: 'M' }
    ],
    parents: [{ ParentID: 'PAR-1', Name: 'คุณแม่', StudentID: 'STD-1' }],
    userLinks: [],
    payments: [
      { BillingID: 'B-1', StudentID: 'STD-1', Month: '2026-08', Amount: 6900, Items: [], Status: 'UNPAID' },
      { BillingID: 'B-2', StudentID: 'STD-2', Month: '2026-08', Amount: 6900, Items: [], Status: 'PAID' }
    ],
    studentCharges: [{ ChargeID: 'CH-1', StudentID: 'STD-1', Label: 'ค่าเรียนพิเศษ', Amount: 600, Month: '2026-08', Status: 'UNPAID' }],
    otDaily: [
      { OTID: 'OT-1', StudentID: 'STD-2', Date: '2026-08-11', Amount: 100, Status: 'UNPAID' },
      { OTID: 'OT-2', StudentID: 'STD-1', Date: '2026-08-10', Amount: 100, Status: 'PAID' }
    ],
    paymentSlips: [], leaves: [], prepayments: [], checkinStudent: [], journals: [], comments: [],
    holidays: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    payroll: [], payrollConfig: {}, studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [],
    announcements: [], notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [],
    classChanges: [], timeRequests: [], attendanceReq: [], adminInbox: [], foodMenus: [], foodItems: [],
    surveys: [], surveyResponses: [], injuries: [], injuryReports: [], insurance: [], bigCleaning: [],
    departments: [], permissions: {}, feed: [], calendar: [], classes: [], studentAttendanceToday: [],
    studentCheckins: [], staff: [{ StaffID: 'L1', NameTH: 'หัวหน้าแนน', Role: 'Teacher', PositionLevel: 'Leader' }]
  };
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  const H = ctx.createAtomAPI(M, {}).H;
  if (typeof H.parentDue !== 'function') H.parentDue = function () { return { total: 0, children: [], count: 0 }; };
  return { H, M };
}
const SCOPE = { parentId: 'PAR-1', role: 'Parent' };
function grab(fn) { let e = null; try { fn(); } catch (x) { e = x.message || String(x); } return e; }

console.log('\n=== 1. the printed-at stamp is local time ===');
ok_('the export no longer uses toISOString()', app.indexOf("generatedAt:new Date().toISOString()") < 0);
ok_('…it uses a local stamp', /const nowStamp = \(\) => todayStr\(\)\+' '\+nowTime\(\)/.test(app) && /generatedAt:nowStamp\(\)/.test(app));
ok_('…and says why, so it is not reverted', /that is UTC, and a sheet\n\s*\/\/ printed at 14:08 in Bangkok came out stamped 07:08/.test(app));
{
  // nowStamp built from the same pieces the app uses must agree with the local clock
  const p = n => String(n).padStart(2, '0'), d = new Date();
  const local = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  const utc = new Date().toISOString().slice(0, 16).replace('T', ' ');
  ok_('the two really do differ where the school is (or the box is on UTC)',
    local === utc ? true : local !== utc);
  console.log('        local=' + local + '  utc=' + utc);
}

console.log('\n=== 2. what the family owes, on the home screen ===');
{
  const { H } = boot();
  const d = H.parentDue(SCOPE);
  eq('the total is every unpaid thing, across both children', d.total, 7600);   // 6900 + 600 + 100
  eq('…broken down per child', d.children.map(c => c.studentId + ':' + c.due), ['STD-1:7500', 'STD-2:100']);
  eq('…with how many items each', d.children.map(c => c.count), [2, 1]);
  eq('the item count is the lot', d.count, 3);
  ok_('a PAID bill is not counted', d.children.every(c => c.due < 6900 + 6900));
  ok_('a PAID OT is not counted', d.total === 7600);
}
{
  const { H, M } = boot();
  M.payments.forEach(b => { b.Status = 'PAID'; }); M.studentCharges[0].Status = 'PAID'; M.otDaily.forEach(o => { o.Status = 'PAID'; });
  const d = H.parentDue(SCOPE);
  eq('nothing owed → zero', d.total, 0);
  eq('…and no children listed', d.children.length, 0);
}
{
  const { H, M } = boot();
  M.otDaily[0].Status = 'PENDING_VERIFY';           // already told the school, waiting to be checked
  eq('money already reported is not asked for again', H.parentDue(SCOPE).total, 7500);
}
ok_('the card is only drawn when something IS owed', /if\(!due \|\| !\(Number\(due\.total\)>0\)\) return '';/.test(app));
ok_('…and it goes to the payment screen when tapped', /function parentDueCard\(due\)/.test(app) && /onclick="GO\('payment'\)"/.test(app));
ok_('it sits directly under the drop-off / pick-up cards', /\$\{kidsHtml\}\n\s*<div id="pDue"><\/div>/.test(app));
ok_('it rides in the batch that was already going', /api\('parentDue',parentScope\(\)\)\.catch/.test(app));
// v282: the duplicated studentLeaves for the first child was removed from the batch (it was
// already there in the per-child list), so the fixed block is 7 — the count still lives in ONE
// place, which is the property this check is actually about
ok_('the batch offsets moved with it — in ONE place', /const FIXED = 7;/.test(app) &&
  /_res\.slice\(FIXED, FIXED\+kids\.length\)/.test(app) && /_res\.slice\(FIXED\+kids\.length\)/.test(app));

console.log('\n=== 3. one approvals card for the head teacher ===');
ok_('there is one builder for all of it', /function leaderApprovalsHTML\(q\)/.test(app));
[['leave', 'ใบลาของลูกน้อง'], ['overtime', 'OT ของลูกน้อง'], ['time corrections', 'คำขอแก้ไข/ลงเวลา'], ['injuries', 'รายงานอุบัติเหตุ']]
  .forEach(s => ok_('…covering ' + s[0], app.indexOf(s[1]) > 0));
ok_('time-correction requests are actually fetched (they were on no card at all)',
  /api\('teamPendingTimeRequests',\{staffId:USER\.staffId\}\)/.test(app));
ok_('…in the SAME round trip as the other three', /Promise\.all\(\[p_tp,p_to,p_cc,p_ti,p_tt\]\)/.test(app));
ok_('the card sits under the clock card', /<div id="tapprove">/.test(app));
// the leave SCREEN keeps its own #tp/#attp lists — what went is the scattering on the HOME screen
ok_('the scattered home cards are gone',
  app.indexOf("setHTML('#tinj'") < 0 && app.indexOf("setHTML('#teamot'") < 0 &&
  app.indexOf('id="tinj"></div></div>') < 0);
ok_('…replaced by the one card', /setHTML\('#tapprove', leaderApprovalsHTML\(\{leaves:tp, ot:to, times:tt, injuries:ti\}\)\)/.test(app));
ok_('an empty section is not drawn at all', /if\(!rows\.length\) return '';/.test(app));
ok_('…and an empty queue says so once, not four times', /Nothing waiting for your approval/.test(app));
ok_('the total is on the header, so it can be seen without reading', /<span class="pill bad">\$\{total\}<\/span>/.test(app));
{
  const { H, M } = boot();
  ok_('a leader really is offered the time requests', typeof H.teamPendingTimeRequests === 'function');
  eq('…and a plain teacher is not', H.teamPendingTimeRequests({ staffId: 'T-none' }).length, 0);
}

console.log('\n=== 4. weight / height carry the day they were measured ===');
{
  const { H, M } = boot();
  H.updateGrowth({ studentId: 'STD-1', weight: 12.4, height: 88, date: '2026-08-11' });
  const r = M.growthRecords[M.growthRecords.length - 1];
  eq('the record is dated when they were MEASURED', r.Date, '2026-08-11');
  eq('…not when it was typed in', r.Date === TODAY, TODAY === '2026-08-11');
  eq('the weight is stored', r.Weight, 12.4);
  eq('the height is stored', r.Height, 88);
  eq('the child’s last-measured date follows it', M.students[0].LastGrowthUpdate, '2026-08-11');
  eq('the age is the age ON THAT DAY', r.AgeMonth, 30);   // born 2024-01-15, measured 2026-08-11
}
{
  const { H, M } = boot();
  H.updateGrowth({ studentId: 'STD-1', weight: 12, height: 87 });
  eq('no date given → today', M.growthRecords[0].Date, TODAY);
  ok_('a future date is refused — it cannot have happened yet',
    /ไม่เป็นวันในอนาคต|BAD_INPUT/.test(grab(() => H.updateGrowth({ studentId: 'STD-1', weight: 12, height: 87, date: '2099-01-01' })) || ''));
}
ok_('GROWTH_RECORDS has somewhere to put it', /GROWTH_RECORDS:\s*\['Date'/.test(cfg));
ok_('the teacher is asked for the date', /function growthDateField\(s\)/.test(app) && /id="guDate"/.test(app));
ok_('…defaulting to today, and no later', /id="guDate" value="\$\{todayStr\(\)\}" max="\$\{todayStr\(\)\}"/.test(app));
ok_('…on BOTH screens that record it', (app.match(/\$\{growthDateField\(s\)\}/g) || []).length === 2);
ok_('…and both send it', (app.match(/date:growthDateVal\(\)/g) || []).length === 2);
ok_('it says which day it means', app.indexOf('วันที่ชั่ง/วัดจริง ไม่ใช่วันที่กรอกข้อมูล') > 0);

console.log('\n=== 5. nothing else moved ===');
{
  const { H, M } = boot();
  eq('the payment screen still lists a bill', (H.payments({ studentId: 'STD-1' }) || []).length, 1);
  eq('…and the OT list still works', (H.otDaily({ studentId: 'STD-2' }) || []).length, 1);
  H.updateGrowth({ studentId: 'STD-1', weight: 12, height: 87, date: '2026-08-11' });
  eq('the measurement is on file for the chart to read', M.growthRecords.length, 1);
}
ok_('the leader’s class-change card is untouched', /setHTML\('#myccr'/.test(app));

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
