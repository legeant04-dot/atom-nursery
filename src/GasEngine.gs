/**
 * GasEngine.gs — the "data connector": run the SHARED engine (Engine.gs) on Google Sheets.
 * ------------------------------------------------------------------
 * Code.gs routes any action NOT in its explicit ROUTES to engineDispatch_(action, payload).
 *
 * LAZY hydration (perf): M's collections are getters that read their sheet only on FIRST access,
 * so a handler only pays for the sheets it actually touches (getPlans reads 0, parentChildren ~2,
 * dashboard ~5 — not all 30). On finish, only collections that were accessed AND changed are written.
 *
 * Object/array cells are JSON-encoded; a few sheet headers are aliased to the engine's field names
 * (sheet `Name` <-> engine `NameTH`). Attendance/leave views are derived from the canonical CHECKIN
 * and LEAVE sheets; vaccine schedule / permission matrices are seeded from ENGINE_REF.
 * ------------------------------------------------------------------
 */

// M-collection key -> { wb:'MAIN'|'HR', sheet }. Read lazily; rewritten if changed.
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
  paymentSlips:    { wb: 'MAIN', sheet: 'PAYMENT_SLIPS' },
  holidays:        { wb: 'MAIN', sheet: 'HOLIDAYS' },
  announcements:   { wb: 'MAIN', sheet: 'ANNOUNCEMENTS' },
  studentLeaves:   { wb: 'MAIN', sheet: 'LEAVE_REQUEST_STD' },
  comments:        { wb: 'MAIN', sheet: 'COMMENTS' },
  checkinStudent:  { wb: 'MAIN', sheet: 'CHECKIN_STUDENT' },
  withdrawals:     { wb: 'MAIN', sheet: 'WITHDRAWALS' },
  injuryReports:   { wb: 'MAIN', sheet: 'INJURY_REPORTS' },
  insurancePCHI:   { wb: 'MAIN', sheet: 'INSURANCE_PCHI' },
  activityLog:     { wb: 'MAIN', sheet: 'ACTIVITY_LOG' },
  staff:           { wb: 'HR',   sheet: 'STAFF' },
  staffGroups:     { wb: 'HR',   sheet: 'STAFF_GROUPS' },
  workSchedule:    { wb: 'HR',   sheet: 'WORK_SCHEDULE' },
  leaves:          { wb: 'HR',   sheet: 'LEAVE_REQUEST' },
  otRecords:       { wb: 'HR',   sheet: 'OT_RECORDS' },
  attendanceReq:   { wb: 'HR',   sheet: 'ATTENDANCE_REQUEST' },
  classChangeReq:  { wb: 'HR',   sheet: 'CLASS_CHANGE_REQ' },
  payroll:         { wb: 'HR',   sheet: 'PAYROLL' }
};
var FIELD_ALIAS = { STUDENTS: { Name: 'NameTH' }, PARENTS: { Name: 'NameTH' }, STAFF: { Name: 'NameTH' },
  // engine uses Key/Dates; sheet columns are VaccineKey/DoseDate. DoseDate holds a JSON array of dose
  // dates (encodeCell_ serializes the array; decodeCell_ parses it back) — supports multiple doses.
  VACCINE_RECORDS: { VaccineKey: 'Key', DoseDate: 'Dates' } };
var CONFIG_ARRAY_KEYS = { Departments: 1, GrowthUpdateMonths: 1, PositionLevels: 1, BigCleaningDays: 1 };

// ---- main entry --------------------------------------------------
function engineDispatch_(action, payload) {
  var ctx = hydrateLazy_();
  var H = createAtomAPI(ctx.M, null).H;          // GROWTH_STD=null -> growth bands null (records still returned)
  var h = H[action];
  if (!h) throw apiError_('UNKNOWN_ACTION', 'ไม่รู้จัก action: ' + action);
  var data = h(payload || {});
  ctx.persist();
  return data;
}

// ---- batch: run many actions in ONE request sharing one lazy M (huge perf win) --------
// payload.calls = [{action, payload}, ...] -> returns [{ok,data}|{ok:false,error}, ...] in order.
// Engine actions share the same hydrated M (each sheet read at most once for the whole batch);
// explicit ROUTES (auth/leave/checkin) run their own path. Persist happens once at the end.
function handleBatch(p) {
  var calls = (p && p.calls) || [];
  var sess = p && p.__sess;                                            // verified session from dispatch_ (null when dormant)
  var ctx = hydrateLazy_();
  var H = createAtomAPI(ctx.M, null).H;
  var out = calls.map(function (c) {
    try {
      var pl = (typeof applyIdentity_ === 'function') ? applyIdentity_(c.action, c.payload || {}, sess) : (c.payload || {});
      var fn = (typeof ROUTES !== 'undefined') ? ROUTES[c.action] : null;
      var data;
      if (fn && c.action !== 'batch') data = fn(pl);                   // explicit route
      else if (H[c.action]) data = H[c.action](pl);                    // engine (shared M)
      else throw apiError_('UNKNOWN_ACTION', 'ไม่รู้จัก action: ' + c.action);
      return { ok: true, data: data };
    } catch (e) { return { ok: false, error: { code: e.apiCode || 'INTERNAL', message: e.message || String(e) } }; }
  });
  ctx.persist();
  return out;
}

// ---- lazy M ------------------------------------------------------
function hydrateLazy_() {
  var cache = {}, snap = {}, M = {};
  var ckStaff;                                    // memoized raw CHECKIN_STAFF read
  function rawCheckinStaff() { if (ckStaff === undefined) ckStaff = readRows_('HR', 'CHECKIN_STAFF'); return ckStaff; }
  var t = gasToday_();

  M.config = hydrateConfig_();                    // eager (1 sheet, used by almost everything)

  // writable + snapshotted (persisted): each COLLECTION_MAP key + payrollConfig + staffAttendanceToday
  Object.keys(COLLECTION_MAP).forEach(function (key) {
    lazyRW_(M, cache, snap, key, function () { return readCollection_(key); });
  });
  lazyRW_(M, cache, snap, 'payrollConfig', function () { return hydratePayrollConfig_(); });
  lazyRW_(M, cache, snap, 'staffAttendanceToday', function () {
    return rawCheckinStaff().filter(function (r) { return String(r.Date).slice(0, 10) === t; })
      .map(function (r) { return { StaffID: r.StaffID, CheckIn: r.CheckIn, CheckOut: r.CheckOut, Status: r.Status, Late: Number(r.LateMinutes) || 0, OTHours: Number(r.OTHours) || 0, InManual: r.InManual, OutManual: r.OutManual }; });
  });

  // read-only derived / seeded (not persisted)
  lazyRO_(M, cache, 'staffAttendanceHistory', function () {
    return rawCheckinStaff().filter(function (r) { return String(r.Date).slice(0, 10) !== t; })
      .map(function (r) { return { Date: String(r.Date).slice(0, 10), StaffID: r.StaffID, In: r.CheckIn, Out: r.CheckOut, InManual: r.InManual, OutManual: r.OutManual }; });
  });
  lazyRO_(M, cache, 'studentCheckins', function () { return deriveStudentCheckins_(M.checkinStudent); });
  lazyRO_(M, cache, 'studentAttendanceToday', function () { return deriveStudentToday_(M.checkinStudent, M.studentLeaves, t); });
  lazyRO_(M, cache, 'leaveUsed', function () { return deriveLeaveUsed_(M.leaves); });
  lazyRO_(M, cache, 'dspmEN', function () { var e = {}; (M.dspmCriteria || []).forEach(function (c) { if (c.DescriptionEN) e[c.ItemNo] = c.DescriptionEN; }); return e; });
  lazyRO_(M, cache, 'vaccineSchedule', function () { return ENGINE_REF.vaccineSchedule; });
  lazyRO_(M, cache, 'permMatrix', function () { return ENGINE_REF.permMatrix; });
  lazyRO_(M, cache, 'permissions', function () { return ENGINE_REF.permissions; });
  ['calendar', 'feed'].forEach(function (k) { lazyRO_(M, cache, k, function () { return []; }); });  // dutyRoster now hydrates from its sheet

  function persist() {
    for (var key in COLLECTION_MAP) {
      if (snap.hasOwnProperty(key) && JSON.stringify(cache[key]) !== snap[key]) writeCollection_(key, cache[key]);
    }
    if (snap.hasOwnProperty('payrollConfig') && JSON.stringify(cache.payrollConfig) !== snap.payrollConfig) writePayrollConfig_(cache.payrollConfig);
    if (snap.hasOwnProperty('staffAttendanceToday') && JSON.stringify(cache.staffAttendanceToday) !== snap.staffAttendanceToday) writeCheckinStaff_(rawCheckinStaff(), cache.staffAttendanceToday);
  }
  return { M: M, persist: persist };
}

// getter loads+memoizes+snapshots on first access; setter records a baseline snapshot then stores (-> dirty).
function lazyRW_(M, cache, snap, key, loader) {
  Object.defineProperty(M, key, {
    enumerable: true,
    get: function () { if (!(key in cache)) { cache[key] = loader(); snap[key] = JSON.stringify(cache[key]); } return cache[key]; },
    set: function (v) { if (!snap.hasOwnProperty(key)) snap[key] = JSON.stringify((key in cache) ? cache[key] : loader()); cache[key] = v; }
  });
}
// read-only lazy (memoized); settable in-memory but never persisted (rebuilt from source sheets next call).
function lazyRO_(M, cache, key, loader) {
  Object.defineProperty(M, key, {
    enumerable: true,
    get: function () { if (!(key in cache)) cache[key] = loader(); return cache[key]; },
    set: function (v) { cache[key] = v; }
  });
}

// ---- sheet IO ----------------------------------------------------
function wbOf_(which) { return which === 'HR' ? getHrSpreadsheet_() : getMainSpreadsheet_(); }

// ---- short-lived sheet cache (CacheService) — cuts repeated sheet reads across requests ----
// Best-effort: skips values >~95KB (cache limit) and degrades to live reads if CacheService is absent.
function cacheTtl_() { var t = Number(getConfig_ ? getConfig_('CacheTTL', 60) : 60); return (t >= 1 && t <= 600) ? t : 60; }
function cacheGet_(k) { try { var v = CacheService.getScriptCache().get(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function cachePut_(k, o) { try { var s = JSON.stringify(o); if (s.length < 95000) CacheService.getScriptCache().put(k, s, cacheTtl_()); } catch (e) {} }
function cacheDel_(k) { try { CacheService.getScriptCache().remove(k); } catch (e) {} }

function readRows_(wb, sheet) {
  var hit = cacheGet_('rows:' + sheet); if (hit) return hit;
  var sh = wbOf_(wb).getSheetByName(sheet);
  var r = sh ? readObjects_(sh).map(function (row) { var o = {}; for (var c in row) o[c] = decodeCell_(row[c]); return o; }) : [];
  cachePut_('rows:' + sheet, r); return r;
}
function readCollection_(key) {
  var def = COLLECTION_MAP[key];
  var hit = cacheGet_('col:' + def.sheet); if (hit) return hit;
  var sh = wbOf_(def.wb).getSheetByName(def.sheet);
  if (!sh) return [];
  var alias = FIELD_ALIAS[def.sheet] || {};
  var rows = readObjects_(sh).map(function (r) { var o = {}; for (var col in r) o[alias[col] || col] = decodeCell_(r[col]); return o; });
  cachePut_('col:' + def.sheet, rows); return rows;
}
function writeCollection_(key, list) { writeRows_(COLLECTION_MAP[key].wb, COLLECTION_MAP[key].sheet, list, FIELD_ALIAS[COLLECTION_MAP[key].sheet] || {}); }

// Sheets whose rows must NEVER disappear via a full-collection rewrite. Every legitimate deletion
// there goes through an explicit in-place route (deleteRow). So ANY shrink here is a truncation bug
// (stale/partial read, concurrent write) → abort loudly instead of destroying data.
var NO_SHRINK_SHEETS = { STUDENTS: 1, PARENTS: 1, STAFF: 1, BILLING: 1, USER_LINKS: 1, PICKUP_PERSONS: 1 };

function writeRows_(wb, sheet, list, alias) {
  alias = alias || {};
  var sh = wbOf_(wb).getSheetByName(sheet); if (!sh) return;
  var hdr = headers_(sh);
  var values = (list || []).map(function (o) {
    return hdr.map(function (col) { var field = alias[col] || col; var v = o[field]; if (v === undefined) v = o[col];
      // offload inline base64 images to Drive so the 50,000-char cell limit never breaks the write
      if (typeof driveifyImage_ === 'function' && IMAGE_COLS_[col]) v = driveifyImage_(v, col + '-' + Date.now() + '.jpg');
      return encodeCell_(v); });
  });
  var existing = Math.max(0, sh.getLastRow() - 1);
  var incoming = values.length;

  // ---- DATA-LOSS GUARD (applies to every activity that persists a collection) ----
  if (incoming < existing) {
    var drop = existing - incoming;
    // identity/money sheets: no shrink at all. Others: block a mass deletion (>5 rows AND >25%).
    var fatal = NO_SHRINK_SHEETS[sheet] || (drop > 5 && drop > existing * 0.25);
    if (fatal) {
      try { Logger.log('WRITE_GUARD blocked ' + sheet + ': ' + existing + ' -> ' + incoming); } catch (e) {}
      var msg = 'ยกเลิกการบันทึกชีต ' + sheet + ' เพื่อป้องกันข้อมูลหาย (' + existing + ' → ' + incoming + ' แถว)';
      throw (typeof apiError_ === 'function') ? apiError_('WRITE_GUARD', msg) : new Error(msg);
    }
  }

  // Write FIRST, then clear only the trailing surplus rows. The old code cleared everything before
  // writing, so a concurrent request could read an empty sheet and persist that emptiness back.
  if (incoming) sh.getRange(2, 1, incoming, hdr.length).setValues(values);
  if (existing > incoming) sh.getRange(incoming + 2, 1, existing - incoming, hdr.length).clearContent();
  cacheDel_('col:' + sheet); cacheDel_('rows:' + sheet);   // invalidate this sheet's cache on write
}

function writeCheckinStaff_(rawAll, todayList) {
  var t = gasToday_();
  var past = (rawAll || []).filter(function (r) { return String(r.Date).slice(0, 10) !== t; });
  var todayRows = (todayList || []).map(function (a) { return { Date: t, StaffID: a.StaffID, CheckIn: a.CheckIn, CheckOut: a.CheckOut, LateMinutes: a.Late || 0, OTHours: a.OTHours || 0, Status: a.Status }; });
  writeRows_('HR', 'CHECKIN_STAFF', past.concat(todayRows), {});
}
function writePayrollConfig_(obj) {
  var rows = Object.keys(obj || {}).map(function (id) { var o = {}; for (var k in obj[id]) o[k] = obj[id][k]; o.StaffID = id; return o; });
  writeRows_('HR', 'PAYROLL_CONFIG', rows, {});
}
function hydratePayrollConfig_() {
  var map = {};
  readRows_('HR', 'PAYROLL_CONFIG').forEach(function (r) { var id = r.StaffID; if (!id) return; var o = {}; for (var k in r) { if (k !== 'StaffID') o[k] = coerce_(r[k]); } map[id] = o; });
  return map;
}

// ---- derivations -------------------------------------------------
// A Time cell written as "16:50" text is sometimes coerced by Sheets into a Date/time value. Reading it
// back then yields a Date — normalise to a clean "HH:mm" in the school timezone so the app never shows a
// shifted/garbled time. Strings pass through (trimmed to HH:mm).
function ciTimeHHmm_(v) {
  if (v instanceof Date) { try { return Utilities.formatDate(v, getConfig_('Timezone', 'Asia/Bangkok'), 'HH:mm'); } catch (e) { return ''; } }
  var m = /(\d{1,2}):(\d{2})/.exec(String(v == null ? '' : v)); return m ? (('0' + m[1]).slice(-2) + ':' + m[2]) : String(v || '');
}
function deriveStudentCheckins_(events) {
  var byDay = {};
  (events || []).forEach(function (e) {
    var d = String(e.Date).slice(0, 10), key = d + '|' + e.StudentID; var tm = ciTimeHHmm_(e.Time);
    if (!byDay[key]) byDay[key] = { Date: d, StudentID: e.StudentID, InTime: '', OutTime: '' };
    if (e.Type === 'IN') byDay[key].InTime = tm; else if (e.Type === 'OUT') byDay[key].OutTime = tm;
  });
  return Object.keys(byDay).map(function (k) { return byDay[k]; });
}
function deriveStudentToday_(events, leaves, today) {
  var st = {};
  (events || []).filter(function (e) { return String(e.Date).slice(0, 10) === today; })
    .forEach(function (e) { st[e.StudentID] = { StudentID: e.StudentID, Status: e.Type, Time: ciTimeHHmm_(e.Time) }; });
  (leaves || []).filter(function (l) { return String(l.Date).slice(0, 10) === today; })
    .forEach(function (l) { st[l.StudentID] = { StudentID: l.StudentID, Status: 'LEAVE', Reason: l.Reason || 'ลา' }; });
  return Object.keys(st).map(function (k) { return st[k]; });
}
function deriveLeaveUsed_(leaves) {
  var used = {}, yr = gasToday_().slice(0, 4);
  (leaves || []).filter(function (l) { return l.Status === 'APPROVED' && String(l.StartDate).slice(0, 4) === yr; })
    .forEach(function (l) { (used[l.StaffID] = used[l.StaffID] || {})[l.Type] = (used[l.StaffID][l.Type] || 0) + (Number(l.Days) || 0); });
  return used;
}

// ---- helpers -----------------------------------------------------
function gasToday_() { return Utilities.formatDate(new Date(), getConfig_('Timezone', 'Asia/Bangkok'), 'yyyy-MM-dd'); }
var _ssTz;
function ssTz_() { if (!_ssTz) { try { _ssTz = getMainSpreadsheet_().getSpreadsheetTimeZone() || 'Asia/Bangkok'; } catch (e) { _ssTz = 'Asia/Bangkok'; } } return _ssTz; }
function decodeCell_(v) {
  // Sheets returns date/time cells as Date objects, but the engine compares/slices them as strings.
  // Format in the SPREADSHEET's own timezone (so a "date" reads back as midnight -> date-only):
  //   year < 1900 -> time-only 'HH:mm' (e.g. 08:05) ; midnight -> 'yyyy-MM-dd' ; else 'yyyy-MM-dd HH:mm:ss'.
  if (Object.prototype.toString.call(v) === '[object Date]') {
    var tz = ssTz_();
    if (v.getFullYear() < 1900) return Utilities.formatDate(v, tz, 'HH:mm');
    var hms = Utilities.formatDate(v, tz, 'HH:mm:ss');
    return Utilities.formatDate(v, tz, hms === '00:00:00' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm:ss');
  }
  if (typeof v === 'string' && /^[\[{]/.test(v.trim())) { try { return JSON.parse(v); } catch (e) {} }
  return v;
}
function encodeCell_(v) { if (v === undefined || v === null) return ''; if (typeof v === 'object') return JSON.stringify(v); return v; }
function coerce_(v) { if (v === 'true') return true; if (v === 'false') return false; if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v); return v; }

function hydrateConfig_() {
  var hit = cacheGet_('cfg'); if (hit) return hit;
  var raw = getAllConfig_(), cfg = {};
  for (var k in raw) {
    var v = raw[k];
    if (CONFIG_ARRAY_KEYS[k]) cfg[k] = String(v).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    else if (typeof v === 'string' && /^[\[{]/.test(v.trim())) { try { cfg[k] = JSON.parse(v); } catch (e) { cfg[k] = v; } }
    else if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) cfg[k] = Number(v);
    else cfg[k] = v;
  }
  if (cfg.GrowthUpdateMonths && cfg.GrowthUpdateMonths.map) cfg.GrowthUpdateMonths = cfg.GrowthUpdateMonths.map(Number);
  cfg.Links = { line: raw.Links_LINE || '', facebook: raw.Links_Facebook || '', website: raw.Links_Website || '', map: raw.Links_Map || '' };
  if (!cfg.LeaveQuota) cfg.LeaveQuota = { 'ลาป่วย': 30, 'ลากิจ': 7, 'ลาพักร้อน': 6 };
  if (!cfg.Insurance) cfg.Insurance = ENGINE_REF.Insurance;
  cachePut_('cfg', cfg); return cfg;
}

// ---- reference data (mirror of mockdata reference lists) ---------
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
