/**
 * server/gate.js — Apps Script's own door, run on the fast host
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 WHY (2026-11-04, porting writes). The host verified the token and then ran any handler it was
 * asked for. Every rule Code.gs applies between "who are you" and "run it" was missing:
 *
 *   · ADMIN_ONLY — 150+ actions. A PARENT token could call listParents and read every family's
 *     national id, address and phone, exactly the hole closed on GAS on 2026-10-15.
 *   · a parent naming a studentId that is not theirs (parentOwnsStudent_), and the grace window
 *     that closes a family's access after the child leaves (parentAccessClosed_)
 *   · staff who have not started, are on ลาชั่วคราว, or have left (NOT_STARTED / PAUSED / ENDED)
 *   · the Observer, who may read everything and write nothing
 *   · CLOSED_ROUTES_ — doors that answer UNKNOWN_ACTION because they must not exist from outside
 *   · and, quietly the largest: 180 explicit ROUTES. On GAS these win over the engine, so for
 *     135 engine handlers what LIVE runs is a different function (src/Journal.gs, Checkin.gs …).
 *     The host answering those from the engine would answer a different question — even the
 *     teacher home's `notifications` is one.
 *
 * NOT A SECOND COPY. Code.gs, Auth.gs, Db.gs, Checkin.gs, Audit.gs, Leave.gs, GasEngine.gs and Config.gs are
 * loaded whole into a sandbox — the same files Apps Script runs — and applyIdentity_,
 * isMutatingAction_, ROUTES and CLOSED_ROUTES_ are THEIRS. Only what they read is swapped: their
 * sheet lookups (sheet_ / findObject_ / readObjects_) answer from the M this request already
 * loaded from Postgres, in SHEET column names, and the config from M.config.
 *
 * Synchronous by design: the shims are set and applyIdentity_ runs without an await in between,
 * so two requests in flight on one instance can never see each other's M.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const PG = require(path.join(__dirname, '..', 'tools', 'pg_engine.js'));

const ROOT = path.join(__dirname, '..');
const FILES = ['Config', 'Db', 'Checkin', 'Audit', 'Auth', 'Leave', 'Code', 'GasEngine'];

let box = null;
function load() {
  if (box) return box;
  box = { console: { log() {}, error() {} }, Logger: { log() {} } };
  vm.createContext(box);
  FILES.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', f + '.gs'), 'utf8'), box, { filename: f + '.gs' }));
  ['applyIdentity_', 'isMutatingAction_', 'publicAction_'].forEach(n => {
    if (typeof box[n] !== 'function') throw new Error('gate: ' + n + ' not found in src/*.gs');
  });
  if (!box.ROUTES || !box.CLOSED_ROUTES_) throw new Error('gate: ROUTES / CLOSED_ROUTES_ not found');
  return box;
}

const bangkokYmd = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d);

/** Rows of one SHEET, as Code.gs's readObjects_ would return them: sheet column names. */
function sheetRows(M, sheet, memo) {
  if (memo[sheet]) return memo[sheet];
  const key = Object.keys(PG.COLLECTIONS).find(k => PG.COLLECTIONS[k].sheet === sheet);
  const c = key && PG.COLLECTIONS[key];
  const rows = (c && M[key] || []).map(r => {
    const o = {};
    Object.keys(r).forEach(f => { if (f !== '__id') o[(c.toSheet && c.toSheet[f]) || f] = r[f]; });
    return o;
  });
  return (memo[sheet] = rows);
}

/**
 * The gate for ONE call, against the M this request loaded.
 * Returns the payload with the caller's identity stamped on it (Code.gs's own applyIdentity_), or
 * throws the same apiError_ Apps Script would throw.
 */
function identity(action, payload, sess, M) {
  const b = load(), memo = {}, audit = [];
  b.sessionRequired_ = () => true;                      // the host never runs without a session
  b.getMainSpreadsheet_ = () => 'MAIN';
  b.getHrSpreadsheet_ = () => 'HR';
  b.sheet_ = (wb, name) => name;
  b.readObjects_ = name => sheetRows(M, name, memo);
  b.findObject_ = (name, pred) => sheetRows(M, name, memo).find(pred) || null;
  b.getConfig_ = (k, d) => { const v = (M.config || {})[k]; return (v === undefined || v === '') ? d : v; };
  b.dateStr_ = d => bangkokYmd(d);
  b.decodeCell_ = v => v;                               // values from Postgres are already decoded
  b.logAudit = (...a) => { audit.push(a); };
  return b.applyIdentity_(action, payload || {}, sess);
}

module.exports = {
  identity,
  isMutating: a => load().isMutatingAction_(a),
  isPublic: a => load().publicAction_(a),
  /** Live runs a Code.gs route for this, not the engine — the host must not answer it. */
  isRoute: a => a !== 'batch' && Object.prototype.hasOwnProperty.call(load().ROUTES, a),
  isClosed: a => !!load().CLOSED_ROUTES_[a],
  observerMessage: () => load().OBSERVER_READ_ONLY_MSG_,
  busyMessage: () => load().BUSY_MSG_,
  routeCount: () => Object.keys(load().ROUTES).length,
  /** GasEngine's WRITE_GUARD list and Db.gs's image columns — theirs, not restated */
  noShrink: sheet => !!load().NO_SHRINK_SHEETS[sheet],
  imageCol: col => !!load().IMAGE_COLS_[col]
};
