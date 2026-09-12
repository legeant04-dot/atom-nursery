/**
 * tools/test_staff_profile.js — a teacher may spell their own name; a teacher may not set their own
 * salary.
 *   node tools/test_staff_profile.js
 *
 * ASKED 2026-09-12: "ข้อมูลส่วนตัวของคุณครู กดตรงมุมขวา Profile สามารถแก้ไขได้ในส่วนของข้อมูลส่วนตัว
 * ทั้งหมด ยกเว้นเรื่องเงิน/เวลา/การตั้งค่าที่เป็นเงื่อนไขของโรงเรียน"
 *
 * saveStaffSelf takes staffId from the SESSION, so it can only ever write the caller's own row. That
 * makes the whitelist the entire security of the route: not "whose record" but "which of your own
 * fields". Widening it is therefore the one change here that can do damage, and the boundary is not
 * a matter of taste —
 *
 *   MONEY  BaseSalary, BankName/BankAccount, Contribution*, PauseSalary* — naming your own salary,
 *          or the account it is paid into, is the definition of what this must refuse.
 *   TIME   StaffGroup (the shift, so what counts as late), RequireCheckin (whether you clock in at
 *          all), StartDate/EndDate, PauseFrom/To — all of them decide what a day is worth.
 *   POLICY Role, PositionLevel, Position, Department, Classes, CanClassOrg, CanFoodMenu, ReportsTo —
 *          every one is a permission. Department='*' is what MAKES somebody a head teacher, and Role
 *          is what decides which app you see. A teacher who could write these could promote
 *          themselves to Admin, from their own profile page, in one request.
 *   LOGIN  NationalID is the USERNAME (the password screen says so). Editing it is changing how you
 *          sign in, not a personal detail — and a typo locks you out of your own account.
 *
 * The half that was simply wrong: NameTH, NicknameEN and Photo were locked for no reason anybody
 * could state. A teacher who married had to ask an admin to spell their own name.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function throws_(label, fn, want) {
  let msg = null; try { fn(); } catch (e) { msg = String((e && e.message) || e); }
  const ok = msg !== null && (!want || msg.indexOf(want) >= 0);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '  got=' + JSON.stringify(msg)));
  ok ? pass++ : fail++;
}
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const eng = R('webapp/engine.js'), app = R('webapp/app.js');

const ME = { StaffID: 'T1', NationalID: '1101700100013', NameTH: 'สมหญิง ใจดี', NameEN: 'Somying J.',
  Nickname: 'หญิง', NicknameEN: 'Ying', Phone: '0812345678', DOB: '1995-04-02', Email: 'ying@example.com',
  Role: 'Teacher', PositionLevel: 'Staff', Position: 'ครูประจำชั้น', Department: 'Nursery 1',
  StaffGroup: 'ATMG-01', Classes: 'Nursery 1', BaseSalary: 15000, BankName: 'SCB', BankAccount: '1234567890',
  RequireCheckin: true, StartDate: '2024-01-15', Status: 'ACTIVE', CanClassOrg: '', CanFoodMenu: '' };

function boot(over) {
  const M = {
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [], Departments: 'Nursery 1' },
    staff: [Object.assign({}, ME, over || {})], students: [], parents: [], userLinks: [], classes: [{ ClassName: 'Nursery 1' }],
    staffGroups: [{ GroupName: 'ATMG-01', CheckInTime: '07:30', CheckOutTime: '17:00' }],
    payments: [], studentCharges: [], prepayments: [], otDaily: [], paymentSlips: [], otRecords: [],
    payroll: [], payrollConfig: {}, checkinStudent: [], studentCheckins: [], studentAttendanceToday: [],
    studentLeaves: [], journals: [], comments: [], workSchedule: [], staffAttendanceToday: [],
    staffAttendanceHistory: [], leaves: [], absenceLog: [], absenceFollowups: [], absenceFollowupLogs: [],
    dspmCriteria: [], activityLog: [], announcements: [], notifications: [], vaccines: [], growth: [],
    growthRecords: [], assessments: [], classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [],
    foodItems: [], surveys: [], surveyResponses: [], injuries: [], insurance: [], bigCleaning: [],
    departments: [], permissions: {}, feed: [], calendar: [], holidays: [], holidayAttend: [],
    pickupPersons: [], vaccineRecords: []
  };
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
const me = M => M.staff[0];

console.log('\n1) a teacher can now edit their own personal details — all of them');
{
  const { H, M } = boot();
  H.saveStaffSelf({ staffId: 'T1', data: { NameTH: 'สมหญิง รักเรียน', NameEN: 'Somying R.',
    Nickname: 'ยิง', NicknameEN: 'Ying R.', Phone: '0899999999', DOB: '1995-04-03',
    Email: 'ying.new@example.com', Photo: 'drive://photos/ying.jpg' } });
  eq('their legal name — the thing an admin used to have to be asked for', me(M).NameTH, 'สมหญิง รักเรียน');
  eq('...the English one', me(M).NameEN, 'Somying R.');
  eq('...both nicknames', [me(M).Nickname, me(M).NicknameEN], ['ยิง', 'Ying R.']);
  eq('...phone and date of birth', [me(M).Phone, me(M).DOB], ['0899999999', '1995-04-03']);
  eq('...their sign-in address', me(M).Email, 'ying.new@example.com');
  eq('...and their photo', me(M).Photo, 'drive://photos/ying.jpg');
}

console.log('\n2) MONEY, TIME AND PERMISSIONS ARE NOT PERSONAL DETAILS');
{
  const { H, M } = boot();
  // one request, every field somebody would want if they were trying
  H.saveStaffSelf({ staffId: 'T1', data: {
    BaseSalary: 99999, BankName: 'OTHER', BankAccount: '9999999999',
    StaffGroup: 'ATMG-99', RequireCheckin: false, StartDate: '2020-01-01', EndDate: '2030-01-01',
    Role: 'Admin', PositionLevel: 'Admin', Position: 'ผู้อำนวยการ', Department: '*',
    Classes: '*', CanClassOrg: 'YES', CanFoodMenu: 'YES', ReportsTo: '',
    NationalID: '9999999999999', Status: 'ACTIVE', PasswordHash: 'x', LineUID: 'Uzzz', GoogleSub: 'g'
  } });
  eq('the salary is untouched', me(M).BaseSalary, 15000);
  eq('...and so is the account it is paid into', [me(M).BankName, me(M).BankAccount], ['SCB', '1234567890']);
  eq('the shift that decides "late" is untouched', me(M).StaffGroup, 'ATMG-01');
  eq('...and so is whether they clock in at all', me(M).RequireCheckin, true);
  eq('...and the start date the school gave them', me(M).StartDate, '2024-01-15');
  eq('no end date was granted either', me(M).EndDate, undefined);
  /* THE ONE THAT MATTERS MOST. Role and Department='*' are the two fields that decide which app a
   * person sees and whether they are a head teacher. If either were writable here, promoting
   * yourself to Admin would be one request from your own profile page. */
  eq('they did not promote themselves', [me(M).Role, me(M).PositionLevel], ['Teacher', 'Staff']);
  eq('...nor make themselves a head teacher', me(M).Department, 'Nursery 1');
  eq('...nor hand themselves the class-organise tool', [me(M).CanClassOrg, me(M).CanFoodMenu], ['', '']);
  eq('...nor take every class', me(M).Classes, 'Nursery 1');
  eq('the username they sign in with is unchanged', me(M).NationalID, '1101700100013');
  eq('...and so are the credentials nobody types by hand', [me(M).PasswordHash, me(M).LineUID, me(M).GoogleSub], [undefined, undefined, undefined]);
  ok_('every exclusion has its reason written beside it, not just its name',
    /MONEY\.\n\s+\*\s+Naming your own salary/.test(eng) && /IT IS THE USERNAME/.test(eng)
    && /could promote themselves to Admin/.test(eng));
}

console.log('\n3) a blank name is not an edit');
{
  const { H, M } = boot();
  throws_('it is refused', () => H.saveStaffSelf({ staffId: 'T1', data: { NameTH: '   ' } }), 'กรุณากรอกชื่อ');
  eq('...and the name that was there is still there', me(M).NameTH, 'สมหญิง ใจดี');
  ok_('the screen catches it too, before the round trip', /if\(!data\.NameTH\)\{ toast\(EN\(\)\?'Your name cannot be blank'/.test(app));
}

console.log('\n4) it leaves a trail — more editable means more that can change quietly');
{
  const { H, M } = boot();
  H.saveStaffSelf({ staffId: 'T1', data: { NameTH: 'สมหญิง รักเรียน', Phone: '0899999999' } });
  const log = M.activityLog.filter(a => a.Action === 'saveStaffSelf');
  eq('the change is logged once', log.length, 1);
  ok_('...naming the fields that actually moved', /NameTH/.test(log[0].Detail) && /Phone/.test(log[0].Detail));
  ok_('...and the person who moved them', String(log[0].Actor || log[0].ActorName || '').indexOf('สมหญิง') >= 0
    || String(JSON.stringify(log[0])).indexOf('T1') >= 0);
  // a save that changes nothing must not produce a line claiming it did
  const b = boot();
  b.H.saveStaffSelf({ staffId: 'T1', data: { NameTH: ME.NameTH, Phone: ME.Phone } });
  eq('a save that changed nothing writes no log line', b.M.activityLog.filter(a => a.Action === 'saveStaffSelf').length, 0);
  // ...and the photo is deliberately not watched: it is a fresh Drive URL on every upload
  const c = boot();
  c.H.saveStaffSelf({ staffId: 'T1', data: { Photo: 'drive://photos/new.jpg' } });
  eq('re-picking a photo is not reported as a change to anything', c.M.activityLog.filter(a => a.Action === 'saveStaffSelf').length, 0);
  eq('...but it IS saved', me(c.M).Photo, 'drive://photos/new.jpg');
}

console.log('\n5) the screen');
{
  const form = app.slice(app.indexOf('window.T_profile = async () => {'), app.indexOf('window.T_slipUnlock='));
  ['NameTH', 'NameEN', 'Nickname', 'NicknameEN', 'Phone', 'DOB', 'Email']
    .forEach(k => ok_(k + ' is an editable box', new RegExp("f\\('" + k + "'").test(form)));
  ok_('...and a photo can be changed', /photoField\('sp_Photo'/.test(form));
  ok_('the save sends every one of them', /NameTH:g\('NameTH'\), NameEN:g\('NameEN'\), Nickname:g\('Nickname'\), NicknameEN:g\('NicknameEN'\)/.test(app));
  /* A PICTURE IS ONLY SENT WHEN ONE WAS PICKED. photoVal returns '' when the user did not touch the
   * field, and sending that would blank the photo they already had — the same trap the injury form
   * and the student form both hit. */
  ok_('...but only sends a photo when one was actually picked',
    /const ph=photoVal\(document,'sp_Photo'\); if\(ph\) data\.Photo=ph;/.test(app));
  // the locked half must say WHY, or it reads as a brush-off on your own date of birth
  ok_('the locked card says what it is', /🔒 \$\{EN\(\)\?'Set by the school':'ข้อมูลที่โรงเรียนกำหนด'\}/.test(form));
  ok_('...and why those fields are the school\'s', /มีผลกับเงิน เวลาทำงาน หรือสิทธิ์การใช้งาน/.test(form));
  ok_('the national id is explained as the USERNAME, not as another arbitrary lock',
    /เลขบัตรประชาชน \(ใช้เป็นชื่อผู้ใช้\)/.test(form));
  ok_('salary is not printed on this screen at all', !/BaseSalary/.test(form) && /ดูได้ที่สลิปเงินเดือน/.test(form));
  ok_('...and neither is a bank account', !/BankAccount/.test(form));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
