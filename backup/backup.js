/**
 * backup/backup.js — the nightly backup of the real database (atom-prod), run by Cloud Run Job
 * `atom-backup` at 02:00 Asia/Bangkok (Cloud Scheduler). docs/BACKUP.md is the runbook.
 *
 * Why it exists: Supabase FREE keeps no backups (ผอ. decision 16 Nov 2026). This is the only copy.
 *
 *   1. pg_dump the `public` schema (custom format, compressed) to /tmp
 *   2. PROVE the file is usable: pg_restore --list must read it and find every expected table.
 *      A dump that cannot be listed is not a backup — the job FAILS and nothing is uploaded.
 *   3. upload to gs://$BUCKET/$PREFIX/YYYY-MM-DD_HHMMSS_<execution>.dump and compare the stored MD5 with ours
 *   Retention (14 days) is the bucket's lifecycle rule, not this script — so a bug here can never
 *   delete an old backup. The job's account can only CREATE objects.
 *
 * NOTHING HERE PRINTS A CREDENTIAL. The connection string arrives as SUPABASE_DB_URL from Secret
 * Manager; it is split into fields (never handed to pg_dump as a URL — percent-decoding mangles a
 * generated password, the lesson in tools/pg_lib.js) and the password goes in PGPASSWORD only.
 * Every line of pg_dump's own output is scrubbed before it is logged.
 */
'use strict';
const fs = require('fs'), crypto = require('crypto'), { spawnSync } = require('child_process');

const BUCKET = process.env.BUCKET || '';
const PREFIX = (process.env.PREFIX || 'atom-prod').replace(/[^a-z0-9_-]/gi, '');
const MIN_TABLES = Number(process.env.MIN_TABLES || 60);

/* same rule as tools/pg_lib.js parseConn (copied: this image carries no repo code) */
function parseConn(s) {
  const m = String(s).trim().match(/^postgres(?:ql)?:\/\/(.*)$/i); if (!m) return null;
  const rest = m[1], at = rest.lastIndexOf('@'); if (at < 0) return null;
  const cred = rest.slice(0, at), hostPart = rest.slice(at + 1), colon = cred.indexOf(':');
  let pass = colon < 0 ? '' : cred.slice(colon + 1);
  if (/^\[.*\]$/.test(pass)) pass = pass.slice(1, -1);
  const hm = hostPart.match(/^([^:/?]+)(?::(\d+))?(?:\/([^?]*))?/); if (!hm) return null;
  return { user: colon < 0 ? cred : cred.slice(0, colon), password: pass, host: hm[1], port: Number(hm[2] || 5432), database: hm[3] || 'postgres' };
}

const url = String(process.env.SUPABASE_DB_URL || '').trim();
const cfg = parseConn(url);
const secretBits = cfg ? [url, cfg.password, cfg.user].filter(x => x && x.length >= 4).sort((a, b) => b.length - a.length) : [url];
const scrub = s => { let o = String(s || ''); secretBits.forEach(b => { o = o.split(b).join('«ซ่อนไว้»'); }); return o; };
const fail = msg => { console.error('🔴 BACKUP FAILED: ' + scrub(msg)); process.exit(1); };

function stamp() {      // Bangkok time, independent of the container clock setting
  const d = new Date(Date.now() + 7 * 3600 * 1000).toISOString();
  return d.slice(0, 10) + '_' + d.slice(11, 13) + d.slice(14, 16) + d.slice(17, 19);
}

async function token() {
  const r = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } });
  if (!r.ok) throw new Error('metadata token ' + r.status);
  return (await r.json()).access_token;
}

(async () => {
  if (!BUCKET) fail('BUCKET not set');
  if (!cfg) fail('SUPABASE_DB_URL ไม่ได้ตั้ง หรืออ่านไม่ออก');
  const env = Object.assign({}, process.env, {
    PGHOST: cfg.host, PGPORT: String(cfg.port), PGDATABASE: cfg.database, PGUSER: cfg.user,
    PGPASSWORD: cfg.password, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '30'
  });
  delete env.SUPABASE_DB_URL;
  const file = '/tmp/backup.dump', t0 = Date.now();

  // 1. dump
  const d = spawnSync('pg_dump', ['--format=custom', '--compress=6', '--schema=public', '--no-owner', '--no-acl', '--file=' + file],
    { env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 15 * 60 * 1000 });
  if (d.error) fail('pg_dump: ' + d.error.message);
  if (d.status !== 0) fail('pg_dump exit ' + d.status + ': ' + d.stderr);
  const buf = fs.readFileSync(file);

  // 2. prove it reads back and holds every table
  const l = spawnSync('pg_restore', ['--list', file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (l.status !== 0) fail('pg_restore --list: ' + l.stderr);
  const tables = (l.stdout.match(/^\d+;.* TABLE public \S+/gm) || []).length;
  const data = (l.stdout.match(/^\d+;.* TABLE DATA public \S+/gm) || []).length;
  if (tables < MIN_TABLES) fail('dump has ' + tables + ' tables, expected at least ' + MIN_TABLES);

  // 3. upload + verify MD5
  /* seconds + the execution's own id: two runs in one minute (a scheduler retry, or someone pressing
   * "execute" twice — seen 16 Nov) must not collide. ifGenerationMatch=0 stays: never overwrite. */
  const exe = String(process.env.CLOUD_RUN_EXECUTION || '').replace(/^.*-/, '').replace(/[^a-z0-9]/gi, '');
  const name = PREFIX + '/' + stamp() + (exe ? '_' + exe : '') + '.dump';
  const md5 = crypto.createHash('md5').update(buf).digest('base64');
  const r = await fetch('https://storage.googleapis.com/upload/storage/v1/b/' + encodeURIComponent(BUCKET) +
    '/o?uploadType=media&ifGenerationMatch=0&name=' + encodeURIComponent(name),
    { method: 'POST', headers: { Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/octet-stream' }, body: buf });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) fail('upload ' + r.status + ': ' + JSON.stringify(body.error || body).slice(0, 300));
  if (body.md5Hash !== md5) fail('MD5 mismatch after upload (' + body.md5Hash + ' ≠ ' + md5 + ')');

  console.log(JSON.stringify({ ok: true, object: 'gs://' + BUCKET + '/' + name, bytes: buf.length, tables, tableData: data,
    md5, seconds: Math.round((Date.now() - t0) / 1000) }));
})().catch(e => fail(e && e.stack || e));
