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
  allLeaves: { fn: 'handleAllLeaves', reads: ['LEAVE_REQUEST', 'STAFF'] }
};
/* 🔴 SCHOOL_CONFIG is readable by every ported route, as by every line of Apps Script: getConfig_ is
 * Db.gs's own (raw Key/Value rows, cached per execution in _configCache — reset per request here),
 * NOT the engine's M.config, which hydrateConfig_ has already turned into arrays and numbers. The two
 * disagree on purpose; a route must see what Apps Script's getConfig_ sees. */
const ALWAYS_READ = ['SCHOOL_CONFIG'];

/* Config/Auth: constants · Notify/Leave: the handlers · Checkin: resolveStaff_ · Code: apiError_ ·
 * GasEngine: decodeCell_. Loaded whole, as Apps Script loads them. */
const FILES = ['Config', 'Db', 'Auth', 'Checkin', 'Code', 'GasEngine', 'Notify', 'Leave'];
let box = null, pristine = null;
function load() {
  if (box) return box;
  box = { console: { log() {}, error() {} }, Logger: { log() {} } };
  vm.createContext(box);
  FILES.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', f + '.gs'), 'utf8'), box, { filename: f + '.gs' }));
  Object.keys(PORTED).forEach(a => {
    if (typeof box[PORTED[a].fn] !== 'function') throw new Error('routes: ' + PORTED[a].fn + ' not found in src/*.gs');
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
function needs(actions) {
  const s = new Set();
  actions.forEach(a => { if (PORTED[a]) ALWAYS_READ.concat(PORTED[a].reads).forEach(x => s.add(x)); });
  return [...s];
}
function writable(actions) {
  const s = new Set();
  actions.forEach(a => { if (PORTED[a] && PORTED[a].writes) Object.keys(PORTED[a].writes).forEach(x => s.add(x)); });
  return [...s];
}

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
  const allowed = new Set(ALWAYS_READ.concat(def.reads));
  /* 🔴 Apps Script's own code wraps reads in try {} catch (e) {} (inboxStudentsForParent_ does), so a
   * throw alone would be swallowed and the answer would quietly be "nothing". The first violation is
   * REMEMBERED and thrown after the handler returns, whatever the handler did with it. */
  let violation = null;
  const breach = msg => { const e = new Error(msg); if (!violation) violation = e; throw e; };
  const refuseWrite = name => () => breach('routes: a ported route tried to write (' + name + ') — not allowed on the fast host');
  /* The call works on its OWN copy of each sheet. Only when it finishes cleanly do its writes reach
   * raw (for the next call in the batch) and the sink (for Postgres) — a call that fails halfway leaves
   * nothing behind, where Apps Script would have left the rows it got to. Stricter, never looser. */
  const work = {}, pending = [];
  const sheetRows = name => (work[name] || (work[name] = JSON.parse(JSON.stringify(raw[name] || []))));
  const rows = name => {
    if (!allowed.has(name)) breach('routes: ' + action + ' read ' + name + ' which it does not declare');
    return sheetRows(name).map((r, i) => {
      const o = JSON.parse(JSON.stringify(r)); delete o.__id;            // Apps Script never sees our row ids
      // NON-enumerable, exactly as Db.gs readObjects_ defines it — so a handler that copies a row with
      // for…in (leaveDecodeEnrich_ does) does not carry _row into the reply
      Object.defineProperty(o, '_row', { value: i + 2, enumerable: false });
      return o;
    });
  };
  const may = def.writes || {};
  const updateRow = (s, rowIndex, patch) => {
    const name = nameOf(s), cols = may[name];
    if (!cols) return breach('routes: ' + action + ' tried to write ' + name + ' which it does not declare');
    const keys = Object.keys(patch || {});
    const bad = keys.filter(k => cols.indexOf(k) < 0);
    if (bad.length) return breach('routes: ' + action + ' tried to write ' + name + '.' + bad.join(',') + ' which it does not declare');
    const row = sheetRows(name)[rowIndex - 2];
    if (!row || !row.__id) return breach('routes: ' + action + ' updated row ' + rowIndex + ' of ' + name + ' which has no id (read without withId?)');
    if (!sink) return breach('routes: ' + action + ' wrote with nowhere to record it');
    const clean = JSON.parse(JSON.stringify(patch));
    Object.assign(row, clean);
    pending.push({ sheet: name, id: row.__id, patch: clean });
  };
  const sheetObj = name => ({ getName: () => name, __sheet: name });
  const nameOf = s => (s && s.__sheet) || s;
  b.getMainSpreadsheet_ = () => ({ getSheetByName: n => sheetObj(n) });
  b.getHrSpreadsheet_ = b.getMainSpreadsheet_;
  b.sheet_ = (wb, name) => sheetObj(name);
  b.readObjects_ = s => rows(nameOf(s));
  b.findObject_ = (s, pred) => rows(nameOf(s)).find(pred) || null;
  b.Utilities = { formatDate };
  b.engineDispatch_ = (a, p) => { const h = H && H[a]; if (typeof h !== 'function') throw new Error('UNKNOWN_ACTION ' + a); return h(p || {}); };
  ['updateRow_', 'appendObject_', 'appendRows_', 'deleteRow_', 'writeRows_', 'bustSheetCache_', 'inboxBust_', 'inboxAdd_',
    'linePushText_', 'logAudit'].forEach(n => { b[n] = refuseWrite(n); });
  b.updateRow_ = updateRow;
  /* inboxBust_ clears Apps Script's CacheService copy of ADMIN_INBOX. Nothing on Apps Script reads that
   * copy (Notify.gs reads the sheet itself, and ADMIN_INBOX is no engine collection), so for a route
   * that may write the inbox, it is a no-op here rather than a refusal. */
  if (may.ADMIN_INBOX) b.inboxBust_ = () => {};
  b.CacheService = { getScriptCache: refuseWrite('CacheService') };
  b.LockService = { getScriptLock: refuseWrite('LockService') };
  b.UrlFetchApp = { fetch: refuseWrite('UrlFetchApp') };
  b.__p = JSON.parse(JSON.stringify(payload || {}));
  let out, thrown = null;
  try { out = vm.runInContext(def.fn + '(__p)', b); } catch (e) { thrown = e; }
  if (violation) throw violation;
  if (thrown) throw thrown;
  Object.keys(work).forEach(n => { if (pending.some(w => w.sheet === n)) raw[n] = work[n]; });
  pending.forEach(w => sink.push(w));
  return out === undefined ? out : JSON.parse(JSON.stringify(out));
}

module.exports = { PORTED, has: a => Object.prototype.hasOwnProperty.call(PORTED, a), needs, writable, run, formatDate };
