/**
 * tools/pg_bridge_worker.js — the database end of the Phase 2.3 bridge.
 *
 * A separate PROCESS, talking newline-delimited JSON over stdin/stdout, because the caller has to
 * be synchronous and nothing else is.
 *
 * 🔴 WHY NOT A WORKER THREAD. That was the first design — worker_threads + SharedArrayBuffer +
 * Atomics.wait, which is the usual recipe for "make an async thing synchronous". It deadlocks: a
 * freshly constructed Worker still needs the PARENT's event loop to tick before it is fully up, and
 * the parent blocks in Atomics.wait on the very next line. The suite printed its first heading and
 * then nothing, for ever. A child process has no such handshake — fs.writeSync / fs.readSync on the
 * pipes need no event loop at either end.
 *
 * One process for the life of the run, so the ~250ms connect is paid once instead of 256 times.
 */
const fs = require('fs');
const { connect } = require('./pg_lib');
const { COLLECTIONS, hydrate, persist } = require('./pg_engine');

let client = null;
const TENANT = process.env.ATOM_PG_TENANT || '33333333-3333-4333-8333-333333333333';

/** Everything this tenant wrote, gone — on both sides of every round trip. */
async function wipe(keys) {
  const tables = [...new Set((keys || Object.keys(COLLECTIONS))
    .map(k => COLLECTIONS[k] && COLLECTIONS[k].known && COLLECTIONS[k].table).filter(Boolean))];
  const missing = [];
  for (const t of tables) {
    try { await client.query(`delete from ${t} where tenant_id = $1`, [TENANT]); }
    catch (e) { missing.push(t); }
  }
  return missing;
}

/**
 * Put a fixture through Postgres and bring it back.
 *
 * 🔴 ONLY the collections Postgres knows about. An M also carries `config`, seeded reference data
 * and whatever else a suite invented; those are not tables and must come back untouched, or this
 * would be testing the bridge's imagination instead of the migration.
 */
async function roundTrip(payload) {
  const keys = payload.keys;
  await wipe(keys);
  const fresh = {}, snap = {};
  // persist() treats a row with no __id as new, which is exactly what a fixture row is
  keys.forEach(k => { fresh[k] = (payload.M[k] || []).map(r => Object.assign({}, r)); snap[k] = []; });
  await persist(client, TENANT, fresh, snap, keys);
  const back = await hydrate(client, TENANT, keys);
  await wipe(keys);
  const out = {};
  // __id is an artefact of the bridge; no handler and no assertion may ever see it
  keys.forEach(k => { out[k] = (back.M[k] || []).map(r => { const o = Object.assign({}, r); delete o.__id; return o; }); });
  return out;
}

/* ── the channel: two files and a rename ─────────────────────────────────────────────────────────
 *
 * Not pipes. The parent has to READ synchronously, and on Windows a spawned child's stdout has no
 * usable file descriptor — `proc.stdout.fd` is undefined, so fs.readSync has nothing to read from.
 * (That is the second design this bridge went through; the first, worker_threads + Atomics.wait,
 * deadlocked because a new Worker needs the parent's event loop before it is up.)
 *
 * A file the parent polls for has neither problem, and the write is made visible by a RENAME, which
 * is atomic — so the parent can never read half a reply. The child is free to be asynchronous, which
 * it has to be: it is talking to a database.
 */
const DIR = process.env.ATOM_PG_CHAN;
const reqReady = DIR + '/req.ready', resTmp = DIR + '/res.tmp', resReady = DIR + '/res.ready';

function respond(obj) {
  fs.writeFileSync(resTmp, JSON.stringify(obj));
  fs.renameSync(resTmp, resReady);
}

async function handle(msg) {
  try {
    if (msg.op === 'close') {
      // everything this run wrote, including the tenant itself — see the note in pg_hook.js
      try { await wipe(null); await client.query('delete from tenant where id = $1', [TENANT]); } catch (e) {}
      try { await client.end(); } catch (e) {}
      respond({ ok: true }); process.exit(0);
    }
    if (msg.op === 'wipe') return respond({ ok: true, data: { missing: await wipe(null) } });
    respond({ ok: true, data: await roundTrip(msg) });
  } catch (e) {
    respond({ ok: false, error: String((e && e.message) || e) });
  }
}

(async () => {
  const c = await connect();
  client = c.client;
  /* A tenant row of this run's own. Every table's tenant_id is a foreign key to it, so without this
   * the very first insert is refused — and the suites would have reported a migration fault that
   * was really a missing fixture. Fabricated, like everything else here, and removed on close. */
  await client.query(
    // `code` is unique too, so it carries the tenant's own id — a fixed string collided the moment
    // two suites ran at once, which is the whole reason the tenant is per-process
    "insert into tenant (id, code, name_th) values ($1, $2, 'โรงเรียนทดสอบ (Phase 2.3)') on conflict (id) do nothing",
    [TENANT, 'p23-' + String(TENANT).slice(0, 8)]);
  respond({ ok: true, ready: true });
  let busy = false;
  const tick = setInterval(async () => {
    if (busy || !fs.existsSync(reqReady)) return;
    busy = true;
    let msg = null;
    try { msg = JSON.parse(fs.readFileSync(reqReady, 'utf8')); fs.unlinkSync(reqReady); }
    catch (e) { busy = false; return; }
    await handle(msg);
    busy = false;
  }, 2);
  tick.unref && void 0;   // keep the process alive; the parent kills it
})();
