/**
 * server/routes.js — Code.gs ROUTES that the fast host runs itself, as Apps Script's OWN functions
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * 180 actions are answered on live by a Code.gs route, not the engine. The host answers those
 * NOT_ON_FAST_HOST and the app re-asks Apps Script (webapp/api.js postFast) — correct, but a screen
 * that holds one of them pays for two trips. `notifications` is on every screen's header.
 *
 * NOT A SECOND COPY. The src/*.gs files are loaded whole into a sandbox, and the handler that runs is
 * the one Apps Script runs. Only what it READS is swapped: each ported route declares the sheets it
 * reads, the host reads exactly those from Postgres (PG.readSheet — sheet column names, the shape
 * readObjects_ returns) before the call, and readObjects_ answers from them.
 *
 * 🔴 READ-ONLY, AND LOUD ABOUT IT. A ported route's sheets are not in M, so the host's "did anything
 * change?" check cannot see a write here. Every write primitive therefore THROWS, and so does a read
 * of a sheet the route did not declare — a missing declaration must fail a test, not answer "nothing".
 * A route that writes is ported only once it has a writer and a staging proof, like the engine's.
 *
 * Synchronous: the shims are set and the handler runs with no await between, so two requests on one
 * instance never see each other's rows.
 *
 * Each entry here has a parity suite: tools/test_fast_routes.js (GAS harness vs this, offline) and
 * tools/test_fast_routes_live.js (GAS harness vs server/host.js through staging Postgres).
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const PG = require(path.join(ROOT, 'tools', 'pg_engine.js'));   // the table columns (PG.colsOf) — the sheet headers on Apps Script

/** action → the Apps Script function ROUTES calls, every sheet it reads (incl. via helpers), and —
 *  for a route that writes — the ONLY cells it may change: { SHEET: [columns] }, updates of existing
 *  rows only. Anything else it tries (another column, a new row, a delete, a cache, LINE) fails the call. */
const PORTED = {
  // the 🔔 bell — Admin inbox · a staff member's inbox · a family's inbox (src/Notify.gs)
  notifications: { fn: 'handleNotifications', reads: ['ADMIN_INBOX', 'PARENTS', 'USER_LINKS'] },
  // ...and "mark as read": the same three audiences, the same three sheets, one cell (Read = 'YES')
  markNotifsRead: { fn: 'handleMarkNotifsRead', reads: ['ADMIN_INBOX', 'PARENTS', 'USER_LINKS'], writes: { ADMIN_INBOX: ['Read'] } },
  // the approver's queue — Admin sees PENDING_ADMIN, a Leader PENDING_LEADER, anyone else NO_PERMISSION (src/Leave.gs)
  pendingLeaves: { fn: 'handlePendingLeaves', reads: ['LEAVE_REQUEST', 'STAFF'] },
  // Big Cleaning: the dates, the allowance and the day's own hours — all from SCHOOL_CONFIG (src/Checkin.gs)
  bigCleaningDays: { fn: 'handleBigCleaningDays', reads: [] },
  // the admin's whole leave list, newest first (src/Leave.gs) — a family is refused it at the gate (NOT_FOR_FAMILIES_)
  allLeaves: { fn: 'handleAllLeaves', reads: ['LEAVE_REQUEST', 'STAFF'] },
  /* 💰 one month's payslip (src/Payroll.gs) — the saved row, the provident-fund running total over
   * every saved month, the school's match rate (SCHOOL_CONFIG), and the "not approved = not there"
   * rule for a teacher. Money: test_fast_routes compares it figure for figure, Sheets types vs text. */
  getPayslip: { fn: 'handleGetPayslip', reads: ['PAYROLL', 'STAFF'] },
  // a child's insurance: the enrolment form (INSURANCE_PCHI, by id or national id) and the school's policy (src/Day6.gs)
  insuranceStatus: { fn: 'handleInsuranceStatus', reads: ['STUDENTS', 'INSURANCE_PCHI'] },
  /* 💰 the rest of the teacher's payslip screen (2026-11-06) — with getPayslip, the whole screen now
   * answers here. myPayslipMonths: the months that HAVE a slip (approved, one per month). otCarryOver:
   * OT approved after an earlier month's payroll was saved — baht, hours and the days behind them,
   * from OT_RECORDS against every saved PAYROLL row and the school's OTEveningRate. */
  myPayslipMonths: { fn: 'handleMyPayslipMonths', reads: ['PAYROLL'] },
  otCarryOver: { fn: 'handleOtCarryOver', reads: ['PAYROLL', 'OT_RECORDS'] },
  // admin: the days OT is waived (SCHOOL_CONFIG.OTWaiveDays) and whether today is one (src/OT.gs)
  otWaiveDays: { fn: 'handleOtWaiveDays', reads: [] },
  // admin: the certificate's wording lines and whether its artwork is uploaded — all SCHOOL_CONFIG (src/Certificate.gs)
  certText: { fn: 'handleCertText', reads: [] },

  /* ═══ W1 · WRITES with no money and no LINE (docs/FAST_HOST_WRITES_PLAN.md, 2026-11-07) ═══════════════
   * Each one proven by tools/test_fast_route_writes.js: run on Apps Script and here from the same rows,
   * then EVERY row of every declared sheet compared — not just the reply — and nothing undeclared moved. */
  // school settings, one key per write (setConfigValue_: the row if it exists, a new row if not)
  addDepartment:    { fn: 'handleAddDepartment', reads: [], writes: { SCHOOL_CONFIG: ['Value'] }, appends: ['SCHOOL_CONFIG'] },
  removeDepartment: { fn: 'handleRemoveDepartment', reads: [], writes: { SCHOOL_CONFIG: ['Value'] }, appends: ['SCHOOL_CONFIG'] },
  renameDepartment: { fn: 'handleRenameDepartment', reads: [], writes: { SCHOOL_CONFIG: ['Value'] }, appends: ['SCHOOL_CONFIG'] },
  setLeaveQuota:    { fn: 'handleSetLeaveQuota', reads: [], writes: { SCHOOL_CONFIG: ['Value'] }, appends: ['SCHOOL_CONFIG'] },
  saveCertText:     { fn: 'handleSaveCertText', reads: [], writes: { SCHOOL_CONFIG: ['Value'] }, appends: ['SCHOOL_CONFIG'] },
  saveDocInfo:      { fn: 'handleSaveDocInfo', reads: [], writes: { SCHOOL_CONFIG: ['Value'] }, appends: ['SCHOOL_CONFIG'] },
  // DSPM criteria (src/DspmAdmin.gs): edit by ItemNo+Track, else a new item numbered max+1; delete by ItemNo+Track
  saveDspmCriteria: { fn: 'handleSaveDspmCriteria', reads: ['DSPM_CRITERIA'], appends: ['DSPM_CRITERIA'],
    writes: { DSPM_CRITERIA: ['AgeFrom', 'AgeTo', 'AgeLabelTH', 'Skill', 'Description', 'DescriptionEN', 'Method', 'PassCriteria', 'Track'] } },
  deleteDspmCriteria: { fn: 'handleDeleteDspmCriteria', reads: ['DSPM_CRITERIA'], deletes: ['DSPM_CRITERIA'] },
  // staff leave (src/Leave.gs) — the admin corrects or cancels; the overlap rule of 2026-11-06 holds here too
  editLeave:   { fn: 'handleEditLeave', reads: ['LEAVE_REQUEST'], writes: { LEAVE_REQUEST: ['Type', 'StartDate', 'EndDate', 'Reason', 'HalfDay', 'Days'] } },
  cancelLeave: { fn: 'handleCancelLeave', reads: ['LEAVE_REQUEST'], deletes: ['LEAVE_REQUEST'] },
  // a child's leave, corrected by the office (src/Parent.gs)
  editStudentLeave: { fn: 'handleEditStudentLeave', reads: ['LEAVE_REQUEST_STD'], writes: { LEAVE_REQUEST_STD: ['Date', 'Reason', 'Type'] } },
  // a sent daily report back to draft (src/Journal.gs) — content untouched, only the two status cells
  unlockJournal: { fn: 'handleUnlockJournal', reads: ['DAILY_JOURNAL', 'STUDENTS'], writes: { DAILY_JOURNAL: ['Status', 'SubmittedAt'] } },
  // announcements (src/Announce.gs) — one WITH an image is refused here (Drive) and goes to Apps Script
  addAnnouncement:    { fn: 'handleAddAnnouncement', reads: ['ANNOUNCEMENTS'], appends: ['ANNOUNCEMENTS'] },
  editAnnouncement:   { fn: 'handleEditAnnouncement', reads: ['ANNOUNCEMENTS'],
    writes: { ANNOUNCEMENTS: ['Title', 'TitleEN', 'Content', 'ContentEN', 'Popup', 'StartDate', 'EndDate', 'Priority', 'StartTime', 'EndTime', 'Image'] } },
  deleteAnnouncement: { fn: 'handleDeleteAnnouncement', reads: ['ANNOUNCEMENTS'], deletes: ['ANNOUNCEMENTS'] }
};
/* 🔴 SCHOOL_CONFIG is readable by every ported route, as by every line of Apps Script: getConfig_ is
 * Db.gs's own (raw Key/Value rows, cached per execution in _configCache — reset per request here),
 * NOT the engine's M.config, which hydrateConfig_ has already turned into arrays and numbers. The two
 * disagree on purpose; a route must see what Apps Script's getConfig_ sees. */
const ALWAYS_READ = ['SCHOOL_CONFIG'];

/* Config/Auth: constants · Notify/Leave: the handlers · Checkin: resolveStaff_ · Code: apiError_ ·
 * GasEngine: decodeCell_. Loaded whole, as Apps Script loads them. */
const FILES = ['Config', 'Db', 'Audit', 'Auth', 'Checkin', 'Code', 'GasEngine', 'Notify', 'Leave', 'Payroll', 'Day6', 'OtStaff', 'OT', 'Certificate',
  'Staff', 'Dspm', 'DspmAdmin', 'Parent', 'Journal', 'Announce'];   // Dspm: getStudent_
let box = null, pristine = null;
function load() {
  if (box) return box;
  box = { console: { log() {}, error() {} }, Logger: { log() {} } };
  vm.createContext(box);
  FILES.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', f + '.gs'), 'utf8'), box, { filename: f + '.gs' }));
  Object.keys(PORTED).forEach(a => {
    if (typeof box[PORTED[a].fn] !== 'function') throw new Error('routes: ' + PORTED[a].fn + ' not found in src/*.gs');
    /* 🔴 ONLY A REAL Code.gs ROUTE. An action live answers from the ENGINE (myLeaves, 2026-11-06 — its name
     * is in another Code.gs list, not ROUTES) is already answered on the host by the same engine; running a
     * .gs handler for it instead would answer a different shape from live. Refused at load. */
    if (!box.ROUTES || !Object.prototype.hasOwnProperty.call(box.ROUTES, a)) throw new Error('routes: ' + a + ' is not a Code.gs route — live answers it from the engine');
  });
  /* 🔴 EVERY REQUEST STARTS FROM THE STATE THE FILES LOAD INTO — as every Apps Script execution does.
   * The .gs files keep module-level memos that are safe there only because an execution ends:
   * Leave.gs caches the whole STAFF sheet in _leaveStaffIdx on first use. In one long-lived sandbox
   * that memo would hand the NEXT request — another school, or the same school after a change —
   * this request's staff. So every non-function global is remembered here as it was after loading,
   * and restored (a fresh copy) before each run; globals created at run time are removed. */
  pristine = {};
  FN_AT_LOAD = new Set(Object.keys(box).filter(k => typeof box[k] === 'function'));
  Object.keys(box).forEach(k => {
    const v = box[k];
    if (typeof v === 'function') return;
    try { pristine[k] = { v: structuredClone(v) }; } catch (e) { pristine[k] = { ref: v }; }   // holds a function: kept as loaded
  });
  return box;
}
function resetBox(b) {
  Object.keys(b).forEach(k => {
    if (Object.prototype.hasOwnProperty.call(pristine, k)) return;
    if (typeof b[k] === 'function' && FN_AT_LOAD.has(k)) return;
    delete b[k];
  });
  Object.keys(pristine).forEach(k => { const p = pristine[k]; b[k] = 'v' in p ? structuredClone(p.v) : p.ref; });
}
let FN_AT_LOAD = null;

const p2 = n => String(n).padStart(2, '0');
/** Utilities.formatDate, for the one zone and the patterns the ported routes use — anything else throws */
function formatDate(d, tz, fmt) {
  if (tz !== 'Asia/Bangkok') throw new Error('routes: formatDate in ' + tz + ' is not supported');
  const t = new Date(new Date(d).getTime() + 7 * 3600000);
  const parts = { yyyy: t.getUTCFullYear(), MM: p2(t.getUTCMonth() + 1), dd: p2(t.getUTCDate()), HH: p2(t.getUTCHours()), mm: p2(t.getUTCMinutes()), ss: p2(t.getUTCSeconds()) };
  if (!/^(yyyy|MM|dd|HH|mm|ss|[-/: ])+$/.test(fmt)) throw new Error('routes: formatDate pattern ' + fmt + ' is not supported');
  return fmt.replace(/yyyy|MM|dd|HH|mm|ss/g, k => String(parts[k]));
}


/** Sheets to read from Postgres before running these actions — with row ids where the route may write */
/* rows are loaded for what a route READS, CHANGES or DELETES (to find them); a sheet it only APPENDS to
 * (the audit log) is never loaded — appendObject_ does not read the sheet */
function needs(actions) {
  const s = new Set();
  actions.forEach(a => { const d = PORTED[a]; if (d) ALWAYS_READ.concat(d.reads || [], Object.keys(d.writes || {}), d.deletes || []).forEach(x => s.add(x)); });
  return [...s];
}
/* ...and with row ids where it may change or delete them */
function writable(actions) {
  const s = new Set();
  actions.forEach(a => { const d = PORTED[a]; if (d) Object.keys(d.writes || {}).concat(d.deletes || [], d.appends || []).forEach(x => s.add(x)); });
  return [...s];
}
const writes = a => { const d = PORTED[a]; return !!(d && (d.writes || d.appends || d.deletes)); };

/**
 * Run the ported route `action` with the payload the gate already stamped (applyIdentity_).
 * raw   { SHEET: rows } — read for this request (needs())
 * H     the engine handlers on this request's M, for routes that fall through (engineDispatch_)
 * sink  array the route's writes are pushed to: { sheet, id, patch } — the host saves them under its
 *       lock (PG.updateSheetRows). The change is ALSO applied to raw, so a later call in the same batch
 *       reads it, exactly as the next call on Apps Script would read the sheet.
 */
function run(action, payload, raw, H, config, sink) {
  const def = PORTED[action];
  if (!def) throw new Error('routes: ' + action + ' is not ported');
  const b = load();
  resetBox(b);
  /* WHAT THIS ROUTE MAY TOUCH — all declared, nothing inferred (W0, 2026-11-07):
   *   reads    sheets it reads
   *   writes   { SHEET: [columns] } — cells of EXISTING rows it may change (updateRow_)
   *   appends  [SHEET] — sheets it may add rows to (appendObject_, setConfigValue_ for a new key)
   *   deletes  [SHEET] — sheets it may remove rows from (sheet.deleteRow)
   * A route that writes anything may also add to the audit log (logAudit → AUDIT_LOG, logAuditHr →
   * HR_AUDIT_LOG): that row is part of the write on Apps Script, so it is part of it here. */
  const may = def.writes || {};
  const appends = new Set(def.appends || []), deletes = new Set(def.deletes || []);
  if (def.writes || def.appends || def.deletes) { appends.add('AUDIT_LOG'); appends.add('HR_AUDIT_LOG'); }
  const readable = new Set(ALWAYS_READ.concat(def.reads || [], Object.keys(may), [...deletes]));
  /* 🔴 Apps Script's own code wraps reads in try {} catch (e) {} (inboxStudentsForParent_ does), so a
   * throw alone would be swallowed and the answer would quietly be "nothing". The first violation is
   * REMEMBERED and thrown after the handler returns, whatever the handler did with it. */
  let violation = null;
  /* A breach answers NOT_ON_FAST_HOST: nothing was recorded (the call's writes are discarded), and Apps
   * Script — which CAN do the thing (an image to Drive, a path this port never saw) — is asked instead
   * (webapp/api.js FAST_FORWARD). The message keeps the detail for the log and the tests. */
  const breach = msg => { const e = new Error(msg); e.apiCode = 'NOT_ON_FAST_HOST'; if (!violation) violation = e; throw e; };
  const refuseWrite = name => () => breach('routes: a ported route tried to write (' + name + ') — not allowed on the fast host');
  const isImage = v => typeof v === 'string' && /^data:image\//.test(v);
  /* The call works on its OWN copy of each sheet. Only when it finishes cleanly do its writes reach
   * raw (for the next call in the batch) and the sink (for Postgres) — a call that fails halfway leaves
   * nothing behind, where Apps Script would have left the rows it got to. Stricter, never looser. */
  const work = {}, ops = [], touched = new Set();
  let tmpN = 0;
  const clone = x => JSON.parse(JSON.stringify(x));
  const sheetRows = name => (work[name] || (work[name] = clone(raw[name] || [])));
  const view = (r, i) => {
    const o = clone(r); delete o.__id;                                   // Apps Script never sees our row ids
    // NON-enumerable, exactly as Db.gs readObjects_ defines it — so a handler that copies a row with
    // for…in (leaveDecodeEnrich_ does) does not carry _row into the reply
    Object.defineProperty(o, '_row', { value: i + 2, enumerable: false });
    return o;
  };
  const rows = name => {
    if (!readable.has(name)) breach('routes: ' + action + ' read ' + name + ' which it does not declare');
    return sheetRows(name).map(view);
  };
  const cols = name => { const c = PG.colsOf(name); if (!c.length) breach('routes: ' + action + ' touched ' + name + ' which has no table'); return c; };
  const updateRow = (s, rowIndex, patch) => {
    const name = nameOf(s), allowedCols = may[name];
    if (!allowedCols) return breach('routes: ' + action + ' tried to write ' + name + ' which it does not declare');
    const keys = Object.keys(patch || {});
    const bad = keys.filter(k => allowedCols.indexOf(k) < 0);
    if (bad.length) return breach('routes: ' + action + ' tried to write ' + name + '.' + bad.join(',') + ' which it does not declare');
    if (keys.some(k => isImage(patch[k]))) return breach('routes: ' + action + ' wrote an image — Drive is Apps Script\'s (NOT_ON_FAST_HOST)');
    const row = sheetRows(name)[rowIndex - 2];
    if (!row || !row.__id) return breach('routes: ' + action + ' updated row ' + rowIndex + ' of ' + name + ' which has no id (read without withId?)');
    if (!sink) return breach('routes: ' + action + ' wrote with nowhere to record it');
    const clean = clone(patch);
    Object.assign(row, clean);
    ops.push({ op: 'update', sheet: name, id: row.__id, patch: clean }); touched.add(name);
  };
  /* appendObject_: every header column, '' where the object has none — exactly the row Apps Script appends */
  const appendObject = (s, obj) => {
    const name = nameOf(s);
    if (!appends.has(name)) return breach('routes: ' + action + ' tried to add a row to ' + name + ' which it does not declare');
    if (!sink) return breach('routes: ' + action + ' wrote with nowhere to record it');
    const row = {};
    cols(name).forEach(h => { const v = (obj || {})[h]; row[h] = (v === undefined || v === null) ? '' : v; });
    if (Object.keys(row).some(k => isImage(row[k]))) return breach('routes: ' + action + ' wrote an image — Drive is Apps Script\'s (NOT_ON_FAST_HOST)');
    const clean = clone(row), tmp = 'new:' + (++tmpN);
    sheetRows(name).push(Object.assign({ __id: tmp }, clean));
    ops.push({ op: 'insert', sheet: name, tmp, row: clean }); touched.add(name);
    return sheetRows(name).length + 1;
  };
  /* sheet.deleteRow: the rows below move up one, as on the sheet — later row numbers mean what they mean there */
  const deleteRow = (name, rowIndex) => {
    if (!deletes.has(name)) return breach('routes: ' + action + ' tried to delete a row of ' + name + ' which it does not declare');
    if (!sink) return breach('routes: ' + action + ' wrote with nowhere to record it');
    const arr = sheetRows(name), row = arr[rowIndex - 2];
    if (!row || !row.__id) return breach('routes: ' + action + ' deleted row ' + rowIndex + ' of ' + name + ' which is not there');
    if (String(row.__id).indexOf('new:') === 0) {                         // added in this call: never reaches Postgres
      const i = ops.findIndex(o => o.op === 'insert' && o.tmp === row.__id); ops.splice(i, 1);
    } else ops.push({ op: 'delete', sheet: name, id: row.__id });
    arr.splice(rowIndex - 2, 1); touched.add(name);
  };
  /* a READ-ONLY range over the sheet as Apps Script would see it (row 1 = headers) — findJournalRow_ reads
   * two columns this way. Writing through a range is not supported: updateRow_ / appendObject_ only. */
  const range = (name, r, c, nr, nc) => ({
    getValues: () => {
      const h = cols(name), data = rows(name), out = [];
      for (let i = 0; i < (nr || 1); i++) {
        const rr = r + i, src = rr === 1 ? null : data[rr - 2];
        if (rr !== 1 && !src) break;
        out.push(h.slice(c - 1, c - 1 + (nc || 1)).map(k => rr === 1 ? k : src[k]));
      }
      return out;
    },
    getValue: () => range(name, r, c, 1, 1).getValues()[0][0],
    setValues: refuseWrite('Range.setValues'), setValue: refuseWrite('Range.setValue')
  });
  const sheetObj = name => ({
    __sheet: name, getName: () => name,
    getLastRow: () => rows(name).length + 1, getLastColumn: () => cols(name).length,
    getRange: (r, c, nr, nc) => range(name, r, c, nr, nc),
    deleteRow: i => deleteRow(name, i),
    appendRow: refuseWrite('appendRow'), deleteRows: refuseWrite('deleteRows'), sort: refuseWrite('sort'),
    insertRowsAfter: refuseWrite('insertRowsAfter'), clearContents: refuseWrite('clearContents')
  });
  const nameOf = s => (s && s.__sheet) || s;
  /* 🔴 the workbook matters for one sheet: AUDIT_LOG is two logs (MAIN / HR), two tables */
  const inBook = (wb, n) => (wb === 'HR' && n === 'AUDIT_LOG') ? 'HR_AUDIT_LOG' : n;
  const book = wb => ({ __wb: wb, getSheetByName: n => sheetObj(inBook(wb, n)), insertSheet: refuseWrite('insertSheet') });
  b.getMainSpreadsheet_ = () => book('MAIN');
  b.getHrSpreadsheet_ = () => book('HR');
  b.sheet_ = (wb, name) => sheetObj(inBook(wb && wb.__wb, name));
  b.readObjects_ = s => rows(nameOf(s));
  b.findObject_ = (s, pred) => rows(nameOf(s)).find(pred) || null;
  b.headers_ = s => cols(nameOf(s)).slice();
  b.ensureColumns_ = (s, want) => {                                      // the table has the columns it has
    const have = cols(nameOf(s)), missing = (want || []).filter(c => have.indexOf(c) < 0);
    if (missing.length) breach('routes: ' + nameOf(s) + ' has no column ' + missing.join(',') + ' in Postgres');
  };
  b.Utilities = { formatDate };
  b.engineDispatch_ = (a, p) => { const h = H && H[a]; if (typeof h !== 'function') throw new Error('UNKNOWN_ACTION ' + a); return h(p || {}); };
  ['appendRows_', 'deleteRow_', 'writeRows_', 'linePushText_'].forEach(n => { b[n] = refuseWrite(n); });
  b.updateRow_ = updateRow;
  b.appendObject_ = appendObject;
  /* Apps Script's CacheService copies cannot be cleared from here and need not be: every sheet this call
   * writes gets a new cache VERSION in the same transaction (host → PG.bumpCacheVersions), which retires
   * every key built on it (DbPg.gs pgCacheKey_ — 'cfg' included). So: nothing cached, nothing to clear. */
  ['cacheDel_', 'bustSheetCache_', 'inboxBust_', 'journalCacheBust_'].forEach(n => { b[n] = () => {}; });
  const noCache = { get: () => null, getAll: () => ({}), put() {}, putAll() {}, remove() {}, removeAll() {} };
  b.CacheService = { getScriptCache: () => noCache, getUserCache: () => noCache, getDocumentCache: () => noCache };
  b.LockService = { getScriptLock: refuseWrite('LockService') };
  b.UrlFetchApp = { fetch: refuseWrite('UrlFetchApp') };
  b.DriveApp = new Proxy({}, { get: () => refuseWrite('DriveApp') });
  b.__p = JSON.parse(JSON.stringify(payload || {}));
  let out, thrown = null;
  try { out = vm.runInContext(def.fn + '(__p)', b); } catch (e) { thrown = e; }
  if (violation) throw violation;
  if (thrown) throw thrown;
  touched.forEach(n => { raw[n] = work[n]; });
  ops.forEach(o => sink.push(o));
  return out === undefined ? out : JSON.parse(JSON.stringify(out));
}

module.exports = { PORTED, has: a => Object.prototype.hasOwnProperty.call(PORTED, a), needs, writable, writes, run, formatDate };
