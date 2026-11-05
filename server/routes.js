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

/** action → the Apps Script function ROUTES calls, and every sheet it reads (incl. via helpers) */
const PORTED = {
  // the 🔔 bell — Admin inbox · a staff member's inbox · a family's inbox (src/Notify.gs)
  notifications: { fn: 'handleNotifications', reads: ['ADMIN_INBOX', 'PARENTS', 'USER_LINKS'] }
};

const FILES = ['Config', 'Auth', 'Notify'];
let box = null;
function load() {
  if (box) return box;
  box = { console: { log() {}, error() {} }, Logger: { log() {} } };
  vm.createContext(box);
  FILES.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', f + '.gs'), 'utf8'), box, { filename: f + '.gs' }));
  Object.keys(PORTED).forEach(a => {
    if (typeof box[PORTED[a].fn] !== 'function') throw new Error('routes: ' + PORTED[a].fn + ' not found in src/*.gs');
  });
  return box;
}

const p2 = n => String(n).padStart(2, '0');
/** Utilities.formatDate, for the one zone and the patterns the ported routes use — anything else throws */
function formatDate(d, tz, fmt) {
  if (tz !== 'Asia/Bangkok') throw new Error('routes: formatDate in ' + tz + ' is not supported');
  const t = new Date(new Date(d).getTime() + 7 * 3600000);
  const parts = { yyyy: t.getUTCFullYear(), MM: p2(t.getUTCMonth() + 1), dd: p2(t.getUTCDate()), HH: p2(t.getUTCHours()), mm: p2(t.getUTCMinutes()), ss: p2(t.getUTCSeconds()) };
  if (!/^(yyyy|MM|dd|HH|mm|ss|[-/: ])+$/.test(fmt)) throw new Error('routes: formatDate pattern ' + fmt + ' is not supported');
  return fmt.replace(/yyyy|MM|dd|HH|mm|ss/g, k => String(parts[k]));
}


/** Sheets to read from Postgres before running these actions */
function needs(actions) {
  const s = new Set();
  actions.forEach(a => { if (PORTED[a]) PORTED[a].reads.forEach(x => s.add(x)); });
  return [...s];
}

/**
 * Run the ported route `action` with the payload the gate already stamped (applyIdentity_).
 * raw   { SHEET: rows } — read for this request (needs())
 * H     the engine handlers on this request's M, for routes that fall through (engineDispatch_)
 */
function run(action, payload, raw, H, config) {
  const def = PORTED[action];
  if (!def) throw new Error('routes: ' + action + ' is not ported');
  const b = load();
  const allowed = new Set(def.reads);
  /* 🔴 Apps Script's own code wraps reads in try {} catch (e) {} (inboxStudentsForParent_ does), so a
   * throw alone would be swallowed and the answer would quietly be "nothing". The first violation is
   * REMEMBERED and thrown after the handler returns, whatever the handler did with it. */
  let violation = null;
  const breach = msg => { const e = new Error(msg); if (!violation) violation = e; throw e; };
  const refuseWrite = name => () => breach('routes: a ported route tried to write (' + name + ') — not allowed on the fast host');
  const rows = name => {
    if (!allowed.has(name)) breach('routes: ' + action + ' read ' + name + ' which it does not declare');
    return JSON.parse(JSON.stringify(raw[name] || [])).map((r, i) => Object.assign(r, { _row: i + 2 }));
  };
  const sheetObj = name => ({ getName: () => name, __sheet: name });
  const nameOf = s => (s && s.__sheet) || s;
  b.getMainSpreadsheet_ = () => ({ getSheetByName: n => sheetObj(n) });
  b.getHrSpreadsheet_ = b.getMainSpreadsheet_;
  b.sheet_ = (wb, name) => sheetObj(name);
  b.readObjects_ = s => rows(nameOf(s));
  b.findObject_ = (s, pred) => rows(nameOf(s)).find(pred) || null;
  b.getConfig_ = (k, d) => { const v = (config || {})[k]; return (v === undefined || v === '') ? d : v; };
  b.tz_ = () => b.getConfig_('Timezone', 'Asia/Bangkok');
  b.Utilities = { formatDate };
  b.engineDispatch_ = (a, p) => { const h = H && H[a]; if (typeof h !== 'function') throw new Error('UNKNOWN_ACTION ' + a); return h(p || {}); };
  ['updateRow_', 'appendObject_', 'appendRows_', 'deleteRow_', 'writeRows_', 'bustSheetCache_', 'inboxBust_', 'inboxAdd_',
    'linePushText_', 'logAudit'].forEach(n => { b[n] = refuseWrite(n); });
  b.CacheService = { getScriptCache: refuseWrite('CacheService') };
  b.LockService = { getScriptLock: refuseWrite('LockService') };
  b.UrlFetchApp = { fetch: refuseWrite('UrlFetchApp') };
  b.__p = JSON.parse(JSON.stringify(payload || {}));
  let out, thrown = null;
  try { out = vm.runInContext(def.fn + '(__p)', b); } catch (e) { thrown = e; }
  if (violation) throw violation;
  if (thrown) throw thrown;
  return out === undefined ? out : JSON.parse(JSON.stringify(out));
}

module.exports = { PORTED, has: a => Object.prototype.hasOwnProperty.call(PORTED, a), needs, run, formatDate };
