/**
 * tools/bench_finance.js — how much work does financeSummary actually do?
 *   node tools/bench_finance.js
 *
 * Measure before changing. This builds a dataset at the live school's scale and counts the passes
 * over each collection, so the optimisation targets what is actually expensive rather than what
 * looks expensive.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

const N_STUDENTS = 31, MONTHS = 12, OT_PER_STUDENT = 10, CHARGES_PER_STUDENT = 3, SLIPS_PER_STUDENT = 16;
const MONTH = '2026-08';

function dataset() {
  const students = [], payments = [], otDaily = [], studentCharges = [], paymentSlips = [], prepayments = [];
  for (let i = 1; i <= N_STUDENTS; i++) {
    const sid = 'STD-' + i;
    students.push({ StudentID: sid, NameTH: 'เด็ก ' + i, NameEN: 'Kid ' + i, Nickname: 'น้อง' + i, Class: 'Nursery 1', Status: 'ACTIVE', Plan: 'p_6900' });
    for (let m = 1; m <= MONTHS; m++) {
      const mo = '2026-' + String(m).padStart(2, '0');
      const bid = 'BL-' + mo + '-' + sid;
      payments.push({ BillingID: bid, StudentID: sid, Month: mo, Amount: 6900, Status: m % 3 ? 'PAID' : 'UNPAID' });
      if (m % 3) paymentSlips.push({ SlipID: 'SL-b' + m + '-' + sid, RefKind: 'bill', RefID: bid, StudentID: sid, Amount: 6900, Status: 'CONFIRMED' });
    }
    for (let k = 0; k < OT_PER_STUDENT; k++) {
      const oid = 'OT-' + sid + '-' + k;
      otDaily.push({ OTID: oid, StudentID: sid, Date: MONTH + '-' + String((k % 28) + 1).padStart(2, '0'), Amount: 100, Status: k % 2 ? 'PAID' : 'UNPAID' });
      if (k % 2) paymentSlips.push({ SlipID: 'SL-o' + k + '-' + sid, RefKind: 'ot', RefID: oid, StudentID: sid, Amount: 100, Status: 'CONFIRMED' });
    }
    for (let k = 0; k < CHARGES_PER_STUDENT; k++) {
      const cid = 'CH-' + sid + '-' + k;
      studentCharges.push({ ChargeID: cid, StudentID: sid, Month: MONTH, Amount: 500, Status: k ? 'UNPAID' : 'PAID' });
      if (!k) paymentSlips.push({ SlipID: 'SL-c' + k + '-' + sid, RefKind: 'charge', RefID: cid, StudentID: sid, Amount: 500, Status: 'CONFIRMED' });
    }
    while (paymentSlips.filter(s => s.StudentID === sid).length < SLIPS_PER_STUDENT) {
      paymentSlips.push({ SlipID: 'SL-x' + paymentSlips.length, RefKind: 'bill', RefID: 'BL-old-' + sid, StudentID: sid, Amount: 0, Status: 'REJECTED' });
    }
  }
  const staff = [];
  for (let i = 1; i <= 10; i++) staff.push({ StaffID: 'STF-' + i, NameTH: 'ครู ' + i, Role: 'Teacher' });
  const payroll = staff.map(s => ({ StaffID: s.StaffID, Month: MONTH, NetPay: 15000, SlipSent: 'YES' }));
  return { students, payments, otDaily, studentCharges, paymentSlips, prepayments, staff, payroll };
}

function boot(counters) {
  const d = dataset();
  const M = {
    config: { Plans: [], LeaveQuota: {} },
    parents: [], userLinks: [], leaves: [], checkinStudent: [], journals: [], comments: [],
    holidays: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    payrollConfig: {}, studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [],
    announcements: [], notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [],
    classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [],
    surveyResponses: [], injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {},
    feed: [], calendar: [], classes: [], studentAttendanceToday: [], studentCheckins: []
  };
  Object.assign(M, d);
  // count every full pass over the big collections
  ['payments', 'otDaily', 'studentCharges', 'paymentSlips', 'prepayments'].forEach(k => {
    const arr = M[k];
    ['filter', 'find', 'forEach', 'reduce', 'some', 'map'].forEach(fn => {
      const real = arr[fn].bind(arr);
      arr[fn] = function () { counters[k] = (counters[k] || 0) + 1; counters.rows = (counters.rows || 0) + arr.length; return real.apply(null, arguments); };
    });
  });
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Map, Set };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(R('webapp/engine.js'), ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}

const counters = {};
const { H } = boot(counters);
const t0 = Date.now();
const out = H.financeSummary({ month: MONTH });
const ms = Date.now() - t0;

console.log('\ndataset: ' + N_STUDENTS + ' students · ' + (N_STUDENTS * MONTHS) + ' bills · ' +
  (N_STUDENTS * OT_PER_STUDENT) + ' OT rows · ' + (N_STUDENTS * CHARGES_PER_STUDENT) + ' charges · ' +
  (N_STUDENTS * SLIPS_PER_STUDENT) + ' slips');
console.log('financeSummary: ' + ms + ' ms in node');
console.log('\npasses over each collection:');
Object.keys(counters).filter(k => k !== 'rows').sort().forEach(k => console.log('  ' + k.padEnd(16) + counters[k]));
console.log('  ' + 'ROWS VISITED'.padEnd(16) + counters.rows.toLocaleString());
console.log('\nresult: students=' + out.students.length + ' income=' + out.income +
  ' tuitionOutstanding=' + out.tuitionOutstanding + ' otherOutstanding=' + out.otherOutstanding + '\n');
