/**
 * tools/pg_hook.js — Phase 2.3. Run the existing suites with their data coming from Postgres.
 *   node -r ./tools/pg_hook.js tools/test_whatever.js
 *   node tools/test_all_pg.js                 (does it for every suite that runs a handler)
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 WHY A HOOK AND NOT 168 NEW SUITES
 *
 * The plan's row reads "รัน 168 test suites บน Postgres — ต้องเขียวทั้งหมด ไม่มีข้อยกเว้น". Writing
 * Postgres versions of them would prove that the copies pass, which is a different claim and a
 * weaker one. What has to be true is that **the suites we already trust still pass when their data
 * comes out of Postgres instead of out of a literal** — same assertions, same handlers, same
 * expected values, different door.
 *
 * So nothing in tools/test_*.js is edited. This preload wraps createAtomAPI: every M handed to the
 * engine is first written to Postgres and hydrated back, and only then do the handlers see it.
 *
 * IN PLACE, not a copy. A suite commonly does `const {H,M}=boot()`, calls a handler that mutates M,
 * and then asserts on M. Handing the engine a different object would break that relationship and
 * the failures would be about this file rather than about the migration. So each collection array
 * is emptied and refilled with the hydrated rows, and `M` stays the same object.
 *
 * 🔴 WHAT A FAILURE HERE MEANS. Hydrate returns only columns the schema DECLARES. A field that
 * survives in a literal and vanishes through Postgres is the Phase 2.2 debt showing itself — a
 * column the engine really reads that nothing ever declared, which on migration day would go
 * missing in silence. That is the finding this phase exists to produce, and it is why the triage is
 * per-field rather than per-suite.
 *
 * ALL DATA IS FABRICATED (it is test fixtures) and every row is deleted on both sides of every
 * round trip. PDPA (Phase 1.5) is unsigned, so the staging database must end as empty as it began.
 */
const path = require('path');
const fs = require('fs');
const Module = require('module');
const { spawn } = require('child_process');

const ENGINE = path.join(__dirname, '..', 'webapp', 'engine.js');
const { COLLECTIONS } = require('./pg_engine');

/* 🔴 A TENANT PER PROCESS, generated here. The first version used one fixed uuid for everything,
 * and the moment two suites ran at the same time they wrote the same fixture ids into the same
 * tables: `duplicate key value violates unique constraint "students_code_uq"`, in whichever of them
 * lost the race. Forty-seven suites "failed" on the first full sweep and almost none of them had
 * anything wrong with them.
 *
 * A uuid per process makes that impossible, and it is also what the real system does — these are
 * separate schools as far as the database is concerned. The row is deleted on the way out. */
function uuid4() {
  const b = require('crypto').randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-');
}
const TENANT = process.env.ATOM_PG_TENANT || uuid4();

let proc = null, CHAN = null;

/* 🔴 A CHILD PROCESS AND TWO FILES — the third design, and the first that works.
 *
 *   1. worker_threads + SharedArrayBuffer + Atomics.wait. The usual recipe for making an async
 *      thing synchronous, and it DEADLOCKS: a freshly constructed Worker still needs the parent's
 *      event loop to tick before it is up, and the parent blocks on the very next line. The suite
 *      printed one heading and then nothing at all.
 *   2. a child process with pipes read by fs.readSync. On Windows a spawned child's stdout has no
 *      usable descriptor — `proc.stdout.fd` is undefined — so there is nothing to read from.
 *   3. this: the parent writes a request file and spins on a reply file. Both sides publish by
 *      RENAME, which is atomic, so a half-written reply can never be read. The child is free to be
 *      asynchronous, which it must be, because it is talking to a database.
 *
 * The spin costs a core for the length of a query (~30ms); the alternative was a node start and a
 * ~250ms connect on each of 256 calls.
 *
 * `env` without NODE_OPTIONS, so the child cannot re-enter this file and build a bridge to itself. */
function bridge() {
  if (proc) return;
  CHAN = fs.mkdtempSync(path.join(require('os').tmpdir(), 'atom-pg-'));
  const env = Object.assign({}, process.env, { ATOM_PG_TENANT: TENANT, ATOM_PG_CHAN: CHAN });
  delete env.NODE_OPTIONS;
  proc = spawn(process.execPath, [path.join(__dirname, 'pg_bridge_worker.js')],
    { stdio: ['ignore', 'inherit', 'inherit'], env });
  const hello = await_(60000);         // it says hello once the connection is open
  if (!hello || !hello.ok) throw new Error('bridge did not start: ' + ((hello && hello.error) || '?'));
  process.on('exit', () => {
    /* Ask it to clear up BEFORE killing it. PDPA (Phase 1.5) is unsigned, so the staging database
     * must end every run as empty as it began — and a tenant row left behind for each of a hundred
     * and seventy suites is a mess nobody would ever go and tidy. */
    try { callSync({ op: 'close' }); } catch (e) {}
    try { proc.kill(); } catch (e) {}
    try { fs.rmSync(CHAN, { recursive: true, force: true }); } catch (e) {}
  });
}

/** Spin until the reply file appears. Synchronous on purpose — see the note above. */
function await_(ms) {
  const res = path.join(CHAN, 'res.ready'), until = Date.now() + ms;
  for (;;) {
    if (fs.existsSync(res)) {
      const txt = fs.readFileSync(res, 'utf8');
      fs.unlinkSync(res);
      return JSON.parse(txt);
    }
    if (proc.exitCode !== null) throw new Error('bridge exited (' + proc.exitCode + ')');
    if (Date.now() > until) throw new Error('no reply within ' + (ms / 1000) + 's');
  }
}

/** Ask the database and wait for it. The suites are synchronous; so is this. */
function callSync(msg) {
  bridge();
  const tmp = path.join(CHAN, 'req.tmp');
  fs.writeFileSync(tmp, JSON.stringify(msg));
  fs.renameSync(tmp, path.join(CHAN, 'req.ready'));
  const m = await_(120000);
  if (!m || !m.ok) throw new Error((m && m.error) || 'bridge closed');
  return m.data;
}

let calls = 0, roundTripped = 0;
const STATS = { calls: 0, collections: 0, rows: 0 };

function throughPostgres(M) {
  if (!M || typeof M !== 'object') return M;
  /* Only arrays that correspond to a real table. `config` is an object, `permMatrix` is seeded
   * reference data, and a suite's own scratch keys are not the migration's business. */
  const keys = Object.keys(M).filter(k =>
    COLLECTIONS[k] && COLLECTIONS[k].known && Array.isArray(M[k]));
  if (!keys.length) return M;
  const back = callSync({ op: 'rt', keys, M: JSON.parse(JSON.stringify(
    keys.reduce((o, k) => (o[k] = M[k], o), {}))) });
  /* 🔴 THE SAME ROW OBJECTS, NOT JUST THE SAME ARRAY.
   *
   * Refilling the array with fresh objects is not enough. A suite commonly keeps a handle on one
   * row and edits it between questions —
   *
   *     const pol = expiry => { KID.InsuranceExpiry = expiry; return H.studentProfile(…).policy; };
   *
   * — and if the array now holds different objects, that assignment lands on something nothing
   * reads. The insurance suite reported an expired policy as still covering a child, which is a
   * frightening thing to read and was entirely this harness's doing.
   *
   * A round trip neither adds nor removes rows, so each one is matched by position: the original
   * object is emptied and refilled with what Postgres gave back. Identity survives at both levels. */
  keys.forEach(k => {
    const rows = back[k] || [];
    STATS.rows += rows.length;
    for (let i = 0; i < rows.length; i++) {
      if (i < M[k].length && M[k][i] && typeof M[k][i] === 'object') {
        const row = M[k][i];
        Object.keys(row).forEach(f => { delete row[f]; });
        Object.assign(row, rows[i]);
      } else M[k].push(rows[i]);
    }
    M[k].length = rows.length;             // same array object — see the note at the top
  });
  STATS.collections += keys.length;
  roundTripped++;
  return M;
}

/** Wrap whatever object is holding createAtomAPI, wherever it came from. */
function wrapHolder(holder) {
  if (!holder || typeof holder.createAtomAPI !== 'function' || holder.__atomPgWrapped) return holder;
  const orig = holder.createAtomAPI;
  holder.createAtomAPI = function (M, growth) {
    STATS.calls++;
    try { throughPostgres(M); }
    catch (e) {
      // loud, and fatal: a silently skipped round trip would turn this whole phase into the
      // ordinary test run wearing a different name
      console.error('\n🔴 pg bridge failed: ' + e.message + '\n');
      process.exit(3);
    }
    return orig.apply(this, arguments);
  };
  try { holder.__atomPgWrapped = true; } catch (e) {}
  return holder;
}

// ── door 1: `const { createAtomAPI } = require('webapp/engine.js')` ──────────────────────────────
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const m = origLoad.apply(this, arguments);
  try { wrapHolder(m); } catch (e) {}
  return m;
};

/* ── door 2: `vm.runInContext(R('webapp/engine.js'), ctx)` ────────────────────────────────────────
 * Twenty-four suites load the engine into a vm context instead of requiring it, usually so they can
 * stub a global or run two copies side by side. Module._load never sees those, and without this
 * they would run on literals while reporting themselves as part of a Postgres run — the one way
 * this phase could quietly lie. The hook's exit line counts the builds, so a miss is visible. */
const vm = require('vm');
const origRIC = vm.runInContext;
vm.runInContext = function (code, ctx, opts) {
  const r = origRIC.apply(this, arguments);
  try { wrapHolder(ctx); } catch (e) {}
  return r;
};
const origScriptRIC = vm.Script.prototype.runInContext;
vm.Script.prototype.runInContext = function (ctx, opts) {
  const r = origScriptRIC.apply(this, arguments);
  try { wrapHolder(ctx); } catch (e) {}
  return r;
};

/* Printed on the way out so a suite that never reached the database cannot be mistaken for one that
 * passed on it — the single most likely way this phase could lie to us. */
process.on('exit', () => {
  try {
    process.stdout.write('\n[pg] engine builds=' + STATS.calls + ' round-tripped=' + roundTripped +
      ' collections=' + STATS.collections + ' rows=' + STATS.rows + '\n');
  } catch (e) {}
});

module.exports = { STATS };
