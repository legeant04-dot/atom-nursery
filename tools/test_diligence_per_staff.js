/**
 * tools/test_diligence_per_staff.js — a per-person เบี้ยขยัน that saves, reads back, and can be undone.
 *   node tools/test_diligence_per_staff.js
 *
 * REPORTED 2026-08-24: "ผมต้องการปรับเบี้ยขยันจาก Default 500 เป็น 1000 แต่พอกดบันทึกแล้ว ระบบแจ้ง
 * บันทึกข้อมูล แต่ข้อมูลที่แสดงยังคงเป็น 500"
 *
 * THE SAVE AND THE READ WERE LOOKING AT DIFFERENT SHEETS. Saving wrote to PAYROLL_CONFIG — correctly;
 * it is where the payroll screen reads them and where they belong. Drawing the form read
 * `s.DiligenceAttendanceAmount` off the STAFF row, which has no such column and never had one. So the
 * box came up empty, showed the school-wide 500 as its placeholder, and the 1,000 that HAD been
 * stored was invisible. The admin could not tell a saved override from a default.
 *
 * Two more faults sat behind it, both about money:
 *
 *  · CLEARING THE BOXES DID NOTHING. The write was skipped unless at least one had a value, so the
 *    way you go back to the school-wide figure — empty both — left the override in place for ever.
 *
 *  · A BLANK OVERRIDE WAS READ AS ZERO. Clearing writes '' into the config, and `'' != null` is true,
 *    so the old test took the override and Number('') is 0. Somebody who removed their per-person
 *    figure would have been paid no เบี้ยขยัน at all, silently.
 *
 * And on the Apps Script side, PAYROLL_CONFIG is not in COLLECTION_MAP (it hydrates into a map, not a
 * list), so ensureCollectionSheet_ never topped up its header — and writeRows_ drops a field with no
 * column WITHOUT AN ERROR. On a sheet created before those columns were declared, the save would
 * report success and store nothing.
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
const eng = R('webapp/engine.js'), app = R('webapp/app.js'), ge = R('src/GasEngine.gs'), cfgGs = R('src/Config.gs');

function boot() {
  const M = {
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [], Departments: '',
      DiligenceAttendanceAmount: 500, DiligenceFacebookAmount: 500, ExtraChildRate: 0, ExtraChildThreshold: 31 },
    staff: [{ StaffID: 'T1', NameTH: 'ครูฟาง', Nickname: 'ฟาง', Role: 'Teacher', PositionLevel: 'Teacher',
      Status: 'ACTIVE', BaseSalary: 11000, StartDate: '2026-08-24' }],
    payrollConfig: {}, payroll: [], leaves: [], otRecords: [], staffAttendanceToday: [],
    staffAttendanceHistory: [], workSchedule: [], staffGroups: [], students: [], classes: [], parents: [],
    userLinks: [], payments: [], studentCharges: [], prepayments: [], otDaily: [], paymentSlips: [],
    checkinStudent: [], studentCheckins: [], studentAttendanceToday: [], studentLeaves: [], journals: [],
    comments: [], absenceLog: [], dspmCriteria: [], activityLog: [], announcements: [], notifications: [],
    vaccines: [], growth: [], growthRecords: [], assessments: [], classChanges: [], timeRequests: [],
    adminInbox: [], foodMenus: [], foodItems: [], surveys: [], surveyResponses: [], injuries: [],
    insurance: [], bigCleaning: [], departments: [], permissions: {}, feed: [], calendar: [],
    holidays: [], holidayAttend: []
  };
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
// what the payroll screen asks for: attendance earned, no Facebook post
const payFor = (H, over) => H.computePayroll(Object.assign(
  { staffId: 'T1', month: '2026-08', attendanceEligible: true, facebookPosted: true }, over || {}));

console.log('\n1) the school default, when nothing is set for the person');
{
  const { H } = boot();
  const r = payFor(H);
  eq('both halves come from the school figure', [r.DiligenceAttendance, r.DiligenceFacebook], [500, 500]);
  eq('...and add up', r.DiligenceTotal, 1000);
}

console.log('\n2) 500 → 1,000 for one person: it saves, it reads back, and it is PAID');
{
  const { H, M } = boot();
  H.setPayrollConfig({ staffId: 'T1', config: { DiligenceAttendanceAmount: 1000, DiligenceFacebookAmount: 1000 } });
  eq('it is stored against that person', M.payrollConfig.T1.DiligenceAttendanceAmount, 1000);
  eq('...and reads back from where the form now looks', H.payrollConfig({ staffId: 'T1' }).DiligenceAttendanceAmount, 1000);
  const r = payFor(H);
  eq('...and it is what the payslip pays', [r.DiligenceAttendance, r.DiligenceFacebook, r.DiligenceTotal], [1000, 1000, 2000]);
}
{
  // one of the two on its own — the other still falls back to the school's figure
  const { H } = boot();
  H.setPayrollConfig({ staffId: 'T1', config: { DiligenceAttendanceAmount: 1000 } });
  const r = payFor(H);
  eq('an override on one half leaves the other on the default', [r.DiligenceAttendance, r.DiligenceFacebook], [1000, 500]);
}

console.log('\n3) an override can be REMOVED, and removing it is not the same as zero');
{
  const { H } = boot();
  H.setPayrollConfig({ staffId: 'T1', config: { DiligenceAttendanceAmount: 1000, DiligenceFacebookAmount: 1000 } });
  // the admin clears both boxes — which is how you go back to the school-wide figure
  H.setPayrollConfig({ staffId: 'T1', config: { DiligenceAttendanceAmount: '', DiligenceFacebookAmount: '' } });
  const r = payFor(H);
  eq('blank falls back to the school default, NOT to nothing', [r.DiligenceAttendance, r.DiligenceFacebook], [500, 500]);
  ok_('...which is the whole point: nobody is quietly paid 0', r.DiligenceTotal === 1000);
}
{
  // ...while a deliberate zero IS a zero. Somebody may genuinely be on no diligence bonus.
  const { H } = boot();
  H.setPayrollConfig({ staffId: 'T1', config: { DiligenceAttendanceAmount: 0, DiligenceFacebookAmount: 0 } });
  const r = payFor(H);
  eq('an explicit 0 is respected', [r.DiligenceAttendance, r.DiligenceFacebook], [0, 0]);
}
{
  const { H } = boot();
  H.setPayrollConfig({ staffId: 'T1', config: { DiligenceAttendanceAmount: 'ห้าร้อย' } });
  const r = payFor(H);
  eq('a value that is not a number falls back rather than paying NaN', r.DiligenceAttendance, 500);
}

console.log('\n4) the form asks the right sheet');
{
  ok_('it reads the saved config after the modal is up', /A_staffDiligence\(id\);/.test(app) && /api\('payrollConfig',\{staffId:id\}\)/.test(app));
  ok_('...and no longer reads the STAFF row, which never held it',
    !/id="sf_DiligenceAttendanceAmount"[^>]*value="\$\{esc\(s\.DiligenceAttendanceAmount/.test(app));
  ok_('an empty box and a box holding the default look identical — so it says which is in force',
    /ตั้งไว้เฉพาะคนนี้/.test(app) && /กำลังใช้ค่ากลางของโรงเรียน/.test(app));
  ok_('clearing both is still saved', /if\(sid && att && fb\)\{/.test(app));
  ok_('...as "" rather than as undefined, so it reaches the sheet at all',
    /DiligenceAttendanceAmount: att\.value===''\?'':\+att\.value/.test(app));
  ok_('a brand-new staff record does not fetch a config that cannot exist yet', /if\(!id\)\{ paint\(null\); return; \}/.test(app));
}

console.log('\n5) the sheet is given its columns, or the write is dropped without a word');
{
  ok_('the header is topped up before writing', /ensureColumns_\(sh, SCHEMA\[WB\.HR\]\.PAYROLL_CONFIG\)/.test(ge));
  ok_('...against the declared schema', /PAYROLL_CONFIG:\['StaffID'[\s\S]{0,220}'DiligenceAttendanceAmount', 'DiligenceFacebookAmount'/.test(cfgGs));
  ok_('...and the reason is written where it happens', /report success and store nothing/.test(ge));
  ok_('the rule about blank lives in ONE place', (eng.match(/const perStaff=\(v\)=>/g) || []).length === 1);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
