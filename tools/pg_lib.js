/**
 * tools/pg_lib.js — one way to reach the staging database, shared by every tool here.
 *
 * Exists because pg_connect.js had already learned two things the hard way and nothing else could
 * use them: a connection string must be split into fields rather than handed to pg whole (pg
 * percent-decodes it, so a `%` or `/` in a generated password is mangled), and the dashboard's
 * `[YOUR-PASSWORD]` placeholder gets replaced WITH the brackets left on more often than not.
 *
 * NOTHING HERE PRINTS A CREDENTIAL. Callers get a client and a `scrub` for their error messages.
 */
const fs = require('fs'), path = require('path');

const ENVFILE = path.join(__dirname, '..', 'secrets', 'supabase.env');

function readEnv() {
  /* ON CLOUD RUN THERE IS NO FILE (2026-11-04). The connection string arrives as an environment
   * variable mounted from Secret Manager — never baked into the image, never in the repo. Only the
   * keys this file already knows are taken, so a stray variable cannot change what it does.
   * 🔴 TRIMMED, the same as the file reader below. The first deploy put the value into Secret
   * Manager with the one leading space the file has after `=`; the file reader trims it, this did
   * not, and every request crashed the instance with "อ่าน SUPABASE_DB_URL ไม่ออก". */
  if (process.env.SUPABASE_DB_URL && !fs.existsSync(ENVFILE)) {
    const out = {};
    ['SUPABASE_DB_URL', 'SUPABASE_REGION', 'TENANT_CODE', 'PDPA_SIGNED'].forEach(k => { if (process.env[k]) out[k] = String(process.env[k]).trim(); });
    return out;
  }
  if (!fs.existsSync(ENVFILE)) {
    console.log('\n🔴 ยังไม่มีไฟล์ secrets/supabase.env — ดู secrets/supabase.env.example\n');
    process.exit(2);
  }
  const out = {};
  fs.readFileSync(ENVFILE, 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/); if (m) out[m[1]] = m[2].trim();
  });
  return out;
}

/** Split a connection string into discrete fields — no URL parsing, so no percent-decoding. */
function parseConn(s) {
  const m = String(s).match(/^postgres(?:ql)?:\/\/(.*)$/i); if (!m) return null;
  const rest = m[1], at = rest.lastIndexOf('@');          // a password may contain '@'
  if (at < 0) return null;
  const cred = rest.slice(0, at), hostPart = rest.slice(at + 1);
  const colon = cred.indexOf(':');                        // a username may not contain ':'
  let pass = colon < 0 ? '' : cred.slice(colon + 1);
  if (/^\[.*\]$/.test(pass)) pass = pass.slice(1, -1);    // the dashboard's brackets, left on
  const hm = hostPart.match(/^([^:/?]+)(?::(\d+))?(?:\/([^?]*))?/); if (!hm) return null;
  return { user: colon < 0 ? cred : cred.slice(0, colon), password: pass,
           host: hm[1], port: Number(hm[2] || 5432), database: hm[3] || 'postgres' };
}

function makeScrub(env, url) {
  const bits = [url];
  Object.keys(env).forEach(k => { const v = env[k]; if (v && v.length >= 6) bits.push(v); });
  const c = parseConn(url); if (c) { bits.push(c.password, c.user); }
  const uniq = [...new Set(bits.filter(Boolean))].sort((a, b) => b.length - a.length);
  return s => { let o = String(s == null ? '' : s); uniq.forEach(b => { o = o.split(b).join('«ซ่อนไว้»'); }); return o; };
}

/** Connect, or exit with a message that says what to fix. Returns { client, scrub }. */
async function connect() {
  const env = readEnv();
  const url = env.SUPABASE_DB_URL || '';
  const scrub = makeScrub(env, url);
  const cfg = parseConn(url);
  if (!cfg) { console.log('\n🔴 อ่าน SUPABASE_DB_URL ไม่ออก\n'); process.exit(2); }
  const { Client } = require('pg');
  const client = new Client(Object.assign({}, cfg,
    { ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 }));
  try { await client.connect(); }
  catch (e) { console.log('\n🔴 เชื่อมต่อไม่สำเร็จ: ' + scrub(e.message) + '\n'); process.exit(1); }
  /* 🔴 THE SCHOOL'S CLOCK, ON EVERY CONNECTION (Phase 2.3, 2026-10-13).
   *
   * A `timestamptz` written as the bare text '2026-10-13 16:00' is interpreted in the SESSION's
   * timezone, and the server's is UTC. So a journal sent at 16:00 was stored as 16:00 UTC and read
   * back as 23:00 — every SubmittedAt, every approval time, every audit line, seven hours out, and
   * nothing anywhere would have thrown. A suite asserting that a sent report keeps its own time is
   * what caught it.
   *
   * This project has paid for this exact trap twice already, in payslip months and in leave counts,
   * and the note in pg_engine's decode_ says so. The READ side was fixed there by converting in the
   * school's zone; this is the write side, and it belongs on the connection so that no tool can be
   * written later that forgets it. */
  try { await client.query("set time zone 'Asia/Bangkok'"); } catch (e) {}
  return { client, scrub, env };
}

/* ── THE SERVER'S POOL (2026-11-14) ───────────────────────────────────────────────────────────────
 * connect() above is for tools: one client, and a failure ends the process with a message. That is
 * right for a script and wrong for server/host.js, which used it per request — every request paid a
 * full TLS + login to Supabase, and one failed connect called process.exit and took the whole
 * instance (and every request in flight on it) down with it.
 *
 * acquire() hands out a client from a pool kept per process. The rules that make reuse safe:
 *
 *   🔴 THE SCHOOL'S CLOCK is set once per physical connection, before its first use, and a client
 *      whose `set time zone` failed is destroyed, never handed out (see connect() for why it matters).
 *   🔴 A CLIENT GOES BACK ONLY WHEN IT IS CLEAN: release() asks the driver for the transaction status
 *      and destroys the connection unless it is idle ('I'). A request that died inside begin…commit
 *      cannot leave a transaction — or the advisory lock it holds — open for the next request.
 *      The caller also destroys it after any error (release(true)).
 *   🔴 A CONNECTION THAT SAT IDLE is pinged before use and replaced if dead: Cloud Run throttles the
 *      CPU between requests, so the pool's own idle timer cannot be trusted to have run.
 *   Session-level settings beyond the time zone are not allowed on a pooled client — use `set local`
 *   inside a transaction (host.js does: lock_timeout).
 *
 * Size: PG_POOL_MAX (default 4) per instance. Cloud Run max-instances × this must stay under the
 * Supabase pooler's limit — docs/CLOUD_RUN.md. A request waits up to 15s for a free slot. */
let POOL_ = null, POOL_SCRUB_ = s => s;
const POOL_IDLE_PING_MS_ = 30 * 1000;
const poolMax_ = () => Math.max(1, Math.min(20, Math.floor(Number(process.env.PG_POOL_MAX)) || 4));

function pool_() {
  if (POOL_) return POOL_;
  const env = readEnv();
  const url = env.SUPABASE_DB_URL || '';
  const cfg = parseConn(url);
  if (!cfg) throw new Error('อ่าน SUPABASE_DB_URL ไม่ออก');
  POOL_SCRUB_ = makeScrub(env, url);
  const { Pool } = require('pg');
  POOL_ = new Pool(Object.assign({}, cfg, {
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000,
    max: poolMax_(), idleTimeoutMillis: 5 * 60 * 1000, maxLifetimeSeconds: 30 * 60,
    allowExitOnIdle: true                               // a tool or test that used the host still exits
  }));
  /* an idle connection the server dropped must not crash the process (pg emits 'error' on the pool) */
  POOL_.on('error', e => { try { console.log('pool: ปิดการเชื่อมต่อที่เสีย — ' + POOL_SCRUB_((e && e.message) || e)); } catch (x) {} });
  return POOL_;
}

async function checkout_(pool) {
  let c;
  try { c = await pool.connect(); }
  catch (e) { throw new Error('เชื่อมต่อฐานข้อมูลไม่สำเร็จ: ' + POOL_SCRUB_((e && e.message) || e)); }
  try {
    if (!c.__atomTz) { await c.query("set time zone 'Asia/Bangkok'"); c.__atomTz = true; }
    else if (Date.now() - (c.__atomUsed || 0) > POOL_IDLE_PING_MS_) await c.query('select 1');
    return c;
  } catch (e) { try { c.release(true); } catch (x) {} return null; }
}

/** A pooled client for one request. Returns { client, release(bad) } — call release exactly once. */
async function acquire() {
  const pool = pool_();
  /* every idle one may have died together (a quiet night): each dead one is destroyed, so within
   * max + 1 tries the pool has opened a fresh connection */
  let c = null;
  for (let i = 0; !c && i <= poolMax_(); i++) c = await checkout_(pool);
  if (!c) throw new Error('เชื่อมต่อฐานข้อมูลไม่สำเร็จ (ตั้งเวลาโรงเรียนไม่ได้)');
  let done = false;
  return {
    client: c,
    release(bad) {
      if (done) return; done = true;
      const st = typeof c.getTransactionStatus === 'function' ? c.getTransactionStatus() : 'I';
      const clean = !bad && (st === 'I' || st == null);
      if (clean) c.__atomUsed = Date.now();
      try { c.release(clean ? undefined : true); } catch (e) {}
    }
  };
}

async function closePool() { const p = POOL_; POOL_ = null; if (p) await p.end(); }
const poolStats = () => POOL_ ? { total: POOL_.totalCount, idle: POOL_.idleCount, waiting: POOL_.waitingCount, max: poolMax_() } : null;

module.exports = { connect, parseConn, readEnv, acquire, closePool, poolStats };
