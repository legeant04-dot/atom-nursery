/**
 * GasEngine.gs — the "data connector": run the SHARED engine (Engine.gs) on Google Sheets.
 * ------------------------------------------------------------------
 * Flow per request:  hydrateM_()  →  createAtomAPI(M, null).H[action](payload)  →  persist changed
 * Code.gs routes any action NOT in its explicit ROUTES to engineDispatch_(action, payload), so all
 * ~116 engine handlers work without re-implementation.
 *
 * Persistence = "changed-collection rewrite" (snapshot before, diff after, rewrite only what changed).
 * Object/array cells are JSON-encoded; a few sheet headers are aliased to the engine's field names
 * (sheet `Name` ↔ engine `NameTH`). Attendance/leave views are derived from the canonical CHECKIN
 * and LEAVE sheets on hydrate and written back on the relevant mutations.
 * ------------------------------------------------------------------
 */

// M-collection key -> { wb:'MAIN'|'HR', sheet }. Read on hydrate, rewritten on change.
var COLLECTION_MAP = {
  students:        { wb: 'MAIN', sheet: 'STUDENTS' },
  classes:         { wb: 'MAIN', sheet: 'CLASSES' },
  parents:         { wb: 'MAIN', sheet: 'PARENTS' },
  pickupPersons:   { wb: 'MAIN', sheet: 'PICKUP_PERSONS' },
  userLinks:       { wb: 'MAIN', sheet: 'USER_LINKS' },
  journals:        { wb: 'MAIN', sheet: 'DAILY_JOURNAL' },
  assessments:     { wb: 'MAIN', sheet: 'DSPM_ASSESSMENT' },
  dspmCriteria:    { wb: 'MAIN', sheet: 'DSPM_CRITERIA' },
  payments:        { wb: 'MAIN', sheet: 'BILLING' },
  studentCharges:  { wb: 'MAIN', sheet: 'STUDENT_CHARGES' },
  prepayments:     { wb: 'MAIN', sheet: 'PREPAYMENTS' },
  otDaily:         { wb: 'MAIN', sheet: 'OT_DAILY' },
  growthRecords:   { wb: 'MAIN', sheet: 'GROWTH_RECORDS' },
  absenceLog:      { wb: 'MAIN', sheet: 'ABSENCE_LOG' },
  absenceFollowups:{ wb: 'MAIN', sheet: 'ABSENCE_FOLLOWUP' },
  vaccineRecords:  { wb: 'MAIN', sheet: 'VACCINE_RECORDS' },
  holidays:        { wb: 'MAIN', sheet: 'HOLIDAYS' },
  announcements:   { wb: 'MAIN', sheet: 'ANNOUNCEMENTS' },
  studentLeaves:   { wb: 'MAIN', sheet: 'LEAVE_REQUEST_STD' },
  comments:        { wb: 'MAIN', sheet: 'COMMENTS' },
  checkinStudent:  { wb: 'MAIN', sheet: 'CHECKIN_STUDENT' },   // raw parent check-in/out events
  withdrawals:     { wb: 'MAIN', sheet: 'WITHDRAWALS' },
  injuryReports:   { wb: 'MAIN', sheet: 'INJURY_REPORTS' },
  insurancePCHI:   { wb: 'MAIN', sheet: 'INSURANCE_PCHI' },
  activityLog:     { wb: 'MAIN', sheet: 'ACTIVITY_LOG' },
  staff:           { wb: 'HR',   sheet: 'STAFF' },
  staffGroups:     { wb: 'HR',   sheet: 'STAFF_GROUPS' },
  workSchedule:    { wb: 'HR',   sheet: 'WORK_SCHEDULE' },
  leaves:          { wb: 'HR',   sheet: 'LEAVE_REQUEST' },
  payroll:         { wb: 'HR',   sheet: 'PAYROLL' }
};

// sheet header <-> engine field (only where they differ).
var FIELD_ALIAS = { STUDENTS: { Name: 'NameTH' }, PARENTS: { Name: 'NameTH' }, STAFF: { Name: 'NameTH' } };

// SCHOOL_CONFIG keys whose value is a comma list the engine wants as an array.
var CONFIG_ARRAY_KEYS = { Departments: 1, GrowthUpdateMonths: 1, PositionLevels: 1 };

// ---- main entry --------------------------------------------------
function engineDispatch_(action, payload) {
  var M = hydrateM_();
  // snapshot collections that can change (generic + the derived/keyed ones we persist specially)
  var before = {};
  for (var k in COLLECTION_MAP) before[k] = JSON.stringify(M[k] || []);
  before.__staffToday = JSON.stringify(M.staffAttendanceToday || []);
  before.__payrollConfig = JSON.stringify(M.payrollConfig || {});

  var H = createAtomAPI(M, null).H;            // GROWTH_STD=null -> growth bands null (records still returned)
  var h = H[action];
  if (!h) throw apiError_('UNKNOWN_ACTION', 'ไม่รู้จัก action: ' + action);
  var data = h(payload || {});

  for (var c in COLLECTION_MAP) if (JSON.stringify(M[c] || []) !== before[c]) writeCollection_(c, M[c] || []);
  if (JSON.stringify(M.staffAttendanceToday || []) !== before.__staffToday) writeCheckinStaff_(M);
  if (JSON.stringify(M.payrollConfig || {}) !== before.__payrollConfig) writePayrollConfig_(M.payrollConfig);
  return data;
}

// ---- hydrate -----------------------------------------------------
function hydrateM_() {
  var M = engineSeed_();
  M.config = hydrateConfig_();
  for (var key in COLLECTION_MAP) M[key] = readCollection_(key);

  // derived: dspmEN from DSPM_CRITERIA.DescriptionEN
  M.dspmEN = {};
  (M.dspmCriteria || []).forEach(function (c) { if (c.DescriptionEN) M.dspmEN[c.ItemNo] = c.DescriptionEN; });

  // per-staff payroll config (object keyed by StaffID)
  M.payrollConfig = hydratePayrollConfig_();

  // staff attendance: split CHECKIN_STAFF into today (view) + history (view) + keep past raw for persist
  var today = gasToday_();
  var ck = readRows_('HR', 'CHECKIN_STAFF');
  M._checkinStaffPast = ck.filter(function (r) { return String(r.Date).slice(0, 10) !== today; });
  M.staffAttendanceToday = ck.filter(function (r) { return String(r.Date).slice(0, 10) === today; })
    .map(function (r) { return { StaffID: r.StaffID, CheckIn: r.CheckIn, CheckOut: r.CheckOut, Status: r.Status, Late: Number(r.LateMinutes) || 0, OTHours: Number(r.OTHours) || 0 }; });
  M.staffAttendanceHistory = M._checkinStaffPast
    .map(function (r) { return { Date: String(r.Date).slice(0, 10), StaffID: r.StaffID, In: r.CheckIn, Out: r.CheckOut }; });

  // student attendance derived from CHECKIN_STUDENT raw events
  deriveStudentAttendance_(M, today);

  // leave used this year (for quota) derived from approved LEAVE_REQUEST
  M.leaveUsed = deriveLeaveUsed_(M.leaves);
  return M;
}

function wbOf_(which) { return which === 'HR' ? getHrSpreadsheet_() : getMainSpreadsheet_(); }
function readRows_(wb, sheet) { var sh = wbOf_(wb).getSheetByName(sheet); return sh ? readObjects_(sh) : []; }

function readCollection_(key) {
  var def = COLLECTION_MAP[key];
  var sh = wbOf_(def.wb).getSheetByName(def.sheet);
  if (!sh) return [];
  var alias = FIELD_ALIAS[def.sheet] || {};
  return readObjects_(sh).map(function (r) {
    var o = {}; for (var col in r) o[alias[col] || col] = decodeCell_(r[col]); return o;
  });
}

function writeCollection_(key, list) { writeRows_(COLLECTION_MAP[key].wb, COLLECTION_MAP[key].sheet, list, FIELD_ALIAS[COLLECTION_MAP[key].sheet] || {}); }

/** Replace a sheet's data rows from a list of engine objects (alias engine field -> sheet header). */
function writeRows_(wb, sheet, list, alias) {
  alias = alias || {};
  var sh = wbOf_(wb).getSheetByName(sheet); if (!sh) return;
  var hdr = headers_(sh);
  var values = (list || []).map(function (o) {
    return hdr.map(function (col) {
      var field = alias[col] || col;           // sheet header -> engine field
      var v = o[field]; if (v === undefined) v = o[col];
      return encodeCell_(v);
    });
  });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, hdr.length).clearContent();
  if (values.length) sh.getRange(2, 1, values.length, hdr.length).setValues(values);
}

/** CHECKIN_STAFF = untouched past rows + today's rows rebuilt from the staffAttendanceToday view. */
function writeCheckinStaff_(M) {
  var todayRows = (M.staffAttendanceToday || []).map(function (a) {
    return { Date: gasToday_(), StaffID: a.StaffID, CheckIn: a.CheckIn, CheckOut: a.CheckOut, LateMinutes: a.Late || 0, OTHours: a.OTHours || 0, Status: a.Status };
  });
  writeRows_('HR', 'CHECKIN_STAFF', (M._checkinStaffPast || []).concat(todayRows), {});
}

function writePayrollConfig_(obj) {
  var rows = Object.keys(obj || {}).map(function (id) { var o = {}; for (var k in obj[id]) o[k] = obj[id][k]; o.StaffID = id; return o; });
  writeRows_('HR', 'PAYROLL_CONFIG', rows, {});
}

function hydratePayrollConfig_() {
  var map = {};
  readRows_('HR', 'PAYROLL_CONFIG').forEach(function (r) {
    var id = r.StaffID; if (!id) return; var o = {};
    for (var k in r) { if (k === 'StaffID') continue; o[k] = coerce_(r[k]); }
    map[id] = o;
  });
  return map;
}

/** Build studentCheckins (per day in/out) + studentAttendanceToday (status) from raw CHECKIN_STUDENT. */
function deriveStudentAttendance_(M, today) {
  var byDay = {};
  (M.checkinStudent || []).forEach(function (e) {
    var d = String(e.Date).slice(0, 10), key = d + '|' + e.StudentID;
    if (!byDay[key]) byDay[key] = { Date: d, StudentID: e.StudentID, InTime: '', OutTime: '' };
    if (e.Type === 'IN') byDay[key].InTime = e.Time; else if (e.Type === 'OUT') byDay[key].OutTime = e.Time;
  });
  M.studentCheckins = Object.keys(byDay).map(function (k) { return byDay[k]; });

  var todayStatus = {};
  (M.checkinStudent || []).filter(function (e) { return String(e.Date).slice(0, 10) === today; })
    .forEach(function (e) { todayStatus[e.StudentID] = { StudentID: e.StudentID, Status: e.Type, Time: e.Time }; });
  // overlay today's student leaves as LEAVE
  (M.studentLeaves || []).filter(function (l) { return String(l.Date).slice(0, 10) === today; })
    .forEach(function (l) { todayStatus[l.StudentID] = { StudentID: l.StudentID, Status: 'LEAVE', Reason: l.Reason || 'ลา' }; });
  M.studentAttendanceToday = Object.keys(todayStatus).map(function (k) { return todayStatus[k]; });
}

function deriveLeaveUsed_(leaves) {
  var used = {}, yr = gasToday_().slice(0, 4);
  (leaves || []).filter(function (l) { return l.Status === 'APPROVED' && String(l.StartDate).slice(0, 4) === yr; })
    .forEach(function (l) { (used[l.StaffID] = used[l.StaffID] || {})[l.Type] = (used[l.StaffID][l.Type] || 0) + (Number(l.Days) || 0); });
  return used;
}

// ---- helpers -----------------------------------------------------
function gasToday_() { return Utilities.formatDate(new Date(), getConfig_('Timezone', 'Asia/Bangkok'), 'yyyy-MM-dd'); }
function decodeCell_(v) { if (typeof v === 'string' && /^[\[{]/.test(v.trim())) { try { return JSON.parse(v); } catch (e) {} } return v; }
function encodeCell_(v) { if (v === undefined || v === null) return ''; if (typeof v === 'object') return JSON.stringify(v); return v; }
function coerce_(v) {
  if (v === 'true') return true; if (v === 'false') return false;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function hydrateConfig_() {
  var raw = getAllConfig_(), cfg = {};
  for (var k in raw) {
    var v = raw[k];
    if (CONFIG_ARRAY_KEYS[k]) cfg[k] = String(v).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    else if (typeof v === 'string' && /^[\[{]/.test(v.trim())) { try { cfg[k] = JSON.parse(v); } catch (e) { cfg[k] = v; } }
    else if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) cfg[k] = Number(v);
    else cfg[k] = v;
  }
  if (cfg.GrowthUpdateMonths && cfg.GrowthUpdateMonths.map) cfg.GrowthUpdateMonths = cfg.GrowthUpdateMonths.map(Number);
  cfg.Links = { line: raw.Links_LINE || '', facebook: raw.Links_Facebook || '', website: raw.Links_Website || '' };
  if (!cfg.LeaveQuota) cfg.LeaveQuota = { 'ลาป่วย': 30, 'ลากิจ': 7, 'ลาพักร้อน': 6 };
  if (!cfg.Insurance) cfg.Insurance = ENGINE_REF.Insurance;
  return cfg;
}

/** Reference/derived collections that aren't a 1:1 sheet. */
function engineSeed_() {
  return {
    leaveUsed: {}, payrollConfig: {}, dutyRoster: [], calendar: [], feed: [],
    staffAttendanceToday: [], staffAttendanceHistory: [], studentAttendanceToday: [], studentCheckins: [],
    vaccineSchedule: ENGINE_REF.vaccineSchedule, permMatrix: ENGINE_REF.permMatrix, permissions: ENGINE_REF.permissions
  };
}

// Reference data (mirror of mockdata reference lists — keep in sync if they change in mockdata.js).
var ENGINE_REF = {
  Insurance: {
    CompanyName: 'Atom Nursery', PolicyNo: '',
    Titles: ['ด.ช.', 'ด.ญ.', 'MSTR.', 'MISS', 'MR.', 'MRS.', 'MS.', 'นาย', 'นาง', 'นางสาว', 'คุณ'],
    Genders: ['Male', 'Female'], MemberStatuses: ['Child', 'Employee', 'Spouse'],
    Plans: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
    MaritalStatuses: ['Single', 'Married', 'Divorced', 'Separated in fact', 'Widow/Widower'],
    Relationships: ['Father', 'Mother', 'Spouse', 'Child', 'Brother', 'Sister', 'Relative', 'Others']
  },
  permMatrix: {
    Admin:   { students: true, staff: true, payroll: true, parentPII: true, edit: true, approve: true },
    Leader:  { students: true, staff: true, payroll: false, parentPII: true, edit: false, approve: true },
    Teacher: { students: true, staff: false, payroll: false, parentPII: false, edit: false, approve: false },
    Parent:  { students: true, staff: false, payroll: false, parentPII: false, edit: false, approve: false }
  },
  permissions: [],
  // standard child vaccine schedule (1 month – 6 years)
  vaccineSchedule: [
    { ageTH: '1 เดือน', ageEN: '1 month', items: [
      { key: 'HB2', th: 'ตับอักเสบบี (HB) เข็มที่ 2', en: 'Hepatitis B (HB) dose 2', m: 1 } ] },
    { ageTH: '2-6 เดือน', ageEN: '2-6 months', items: [
      { key: 'DTPHBHib1', th: 'รวม คอตีบ-บาดทะยัก-ไอกรน-ตับอักเสบบี-ฮิบ (DTP-HB-Hib) เข็มที่ 1', en: 'DTP-HB-Hib dose 1', m: 2 },
      { key: 'DTPHBHib2', th: 'DTP-HB-Hib เข็มที่ 2', en: 'DTP-HB-Hib dose 2', m: 4 },
      { key: 'DTPHBHib3', th: 'DTP-HB-Hib เข็มที่ 3', en: 'DTP-HB-Hib dose 3', m: 6 },
      { key: 'Polio1', th: 'โปลิโอ (IPV/OPV) เข็มที่ 1', en: 'Polio (IPV/OPV) dose 1', m: 2 },
      { key: 'Polio2', th: 'โปลิโอ เข็มที่ 2', en: 'Polio dose 2', m: 4 },
      { key: 'Polio3', th: 'โปลิโอ เข็มที่ 3', en: 'Polio dose 3', m: 6 },
      { key: 'Rota', th: 'โรต้า (Rota) ป้องกันท้องเสียรุนแรง', en: 'Rotavirus (Rota)', m: 2 } ] },
    { ageTH: '9-12 เดือน', ageEN: '9-12 months', items: [
      { key: 'MMR1', th: 'หัด-คางทูม-หัดเยอรมัน (MMR) เข็มที่ 1', en: 'MMR dose 1', m: 9 },
      { key: 'JE1', th: 'ไข้สมองอักเสบเจอี (JE) เข็มที่ 1', en: 'Japanese Encephalitis (JE) dose 1', m: 9 } ] },
    { ageTH: '1 ปี 6 เดือน (18 เดือน)', ageEN: '18 months', items: [
      { key: 'DTPb1', th: 'DTP เข็มกระตุ้นที่ 1', en: 'DTP booster 1', m: 18 },
      { key: 'Poliob1', th: 'โปลิโอ (OPV/IPV) เข็มกระตุ้น', en: 'Polio booster', m: 18 },
      { key: 'JE2', th: 'JE เข็มที่ 2', en: 'JE dose 2', m: 18 } ] },
    { ageTH: '2 ปี 6 เดือน (30 เดือน)', ageEN: '30 months', items: [
      { key: 'MMR2', th: 'MMR เข็มที่ 2', en: 'MMR dose 2', m: 30 } ] },
    { ageTH: '4-6 ปี', ageEN: '4-6 years', items: [
      { key: 'DTPb2', th: 'DTP เข็มกระตุ้นที่ 2', en: 'DTP booster 2', m: 48 },
      { key: 'Poliob2', th: 'โปลิโอ (OPV) เข็มกระตุ้น', en: 'Polio booster 2', m: 48 } ] }
  ]
};
