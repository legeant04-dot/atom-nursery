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
  return { client, scrub, env };
}

module.exports = { connect, parseConn, readEnv };
