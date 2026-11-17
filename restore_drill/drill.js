/**
 * restore_drill/drill.js — prove the newest backup can be restored, and that what comes back is
 * exactly what atom-prod holds. Cloud Run Job `atom-restore-drill`; docs/BACKUP.md "ซ้อมกู้".
 *
 * Gate (ผอ. 16 Nov 2026): a backup that has never been restored is a hope, not a backup —
 * restore fails = no move.
 *
 *   1. find the newest object under gs://$BUCKET/$PREFIX/ (or $OBJECT), download it, check its MD5
 *   2. start an EMPTY PostgreSQL 17 inside this container (socket only, no network listener)
 *   3. pg_restore into it with --exit-on-error — one error is a failed drill, not a warning
 *   4. per table: row count + MD5 of every row (sorted) — on the restored copy AND on atom-prod
 *   5. pass = every table present and every count and fingerprint equal
 *
 * atom-prod is only READ: the fingerprint query runs inside `begin; set transaction read only;`
 * so even a bug in this file cannot write there. The restored copy lives in /tmp of this container
 * and disappears with it. Output is table names and numbers only — never a row, never a credential.
 *
 * Run it straight after a backup (`gcloud run jobs execute atom-backup --wait`) while nobody is
 * writing (the rehearsal, move night): a row written between the dump and the comparison shows up
 * as a difference, and the report says so rather than calling it a broken backup.
 *
 * ── MODE=target — THE REAL RECOVERY: restore the backup INTO the database in SUPABASE_DB_URL ──────
 * Everything above runs first (the file must restore cleanly into an empty Postgres before it is
 * allowed near a real one). Then, in ONE transaction on the target: every object the backup holds
 * is dropped and recreated from it (pg_restore --clean --if-exists --single-transaction). Any error
 * rolls the whole thing back and the target is exactly as it was. The schema `public` itself is
 * kept (Supabase's grants live on it); tables the backup does not have are left alone and reported.
 * Afterwards every table on the target must equal the backup, row for row.
 *
 * It replaces data, so it will not run unless CONFIRM is exactly
 *     restore-into-<TARGET_LABEL>-<today, Bangkok, YYYY-MM-DD>
 * passed at execute time:
 *     gcloud run jobs execute atom-restore-drill --update-env-vars MODE=target,CONFIRM=restore-into-atom-prod-2026-11-18
 * A command copied from yesterday's notes is refused. Into a NEW database (the real disaster):
 * add --update-secrets SUPABASE_DB_URL=<that database's secret>:latest and TARGET_LABEL=<its name>.
 */
'use strict';
const fs = require('fs'), crypto = require('crypto'), { spawnSync } = require('child_process');

const BUCKET = process.env.BUCKET || '';
const PREFIX = (process.env.PREFIX || 'atom-prod').replace(/[^a-z0-9_-]/gi, '');
const OBJECT = process.env.OBJECT || '';                 // optional: drill a specific file
const MIN_TABLES = Number(process.env.MIN_TABLES || 60);
const COMPARE = process.env.COMPARE !== '0';             // 0 = restore only (no live comparison)
const MODE = process.env.MODE || 'drill';                // 'target' = restore INTO SUPABASE_DB_URL
const TARGET_LABEL = (process.env.TARGET_LABEL || 'atom-prod').replace(/[^a-z0-9_-]/gi, '');
const bkkDay = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

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
const secretBits = cfg ? [url, cfg.password, cfg.user, cfg.host].filter(x => x && x.length >= 4).sort((a, b) => b.length - a.length) : [url].filter(Boolean);
const scrub = s => { let o = String(s || ''); secretBits.forEach(b => { o = o.split(b).join('«ซ่อนไว้»'); }); return o; };
const fail = msg => { console.error('🔴 RESTORE DRILL FAILED: ' + scrub(msg)); process.exit(1); };
const step = msg => console.log('· ' + scrub(msg));

const PGDATA = '/tmp/pgdrill', SOCK = '/tmp', DUMP = '/tmp/drill.dump';
/* the restored copy: a local socket, its own superuser, no password, no TCP listener */
const localEnv = () => {
  const e = Object.assign({}, process.env, { PGHOST: SOCK, PGPORT: '5432', PGUSER: 'postgres', PGDATABASE: 'drill',
    PGTZ: 'UTC', PGDATESTYLE: 'ISO, YMD' });
  delete e.SUPABASE_DB_URL; delete e.PGPASSWORD; return e;
};
const prodEnv = () => {
  const e = Object.assign({}, process.env, { PGHOST: cfg.host, PGPORT: String(cfg.port), PGDATABASE: cfg.database,
    PGUSER: cfg.user, PGPASSWORD: cfg.password, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '30',
    PGTZ: 'UTC', PGDATESTYLE: 'ISO, YMD' });
  delete e.SUPABASE_DB_URL; return e;
};
const run = (cmd, args, env, label, timeoutMin) => {
  const r = spawnSync(cmd, args, { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: (timeoutMin || 10) * 60000 });
  if (r.error) fail(label + ': ' + r.error.message);
  if (r.status !== 0) fail(label + ' exit ' + r.status + ': ' + (r.stderr || r.stdout || '').slice(-1500));
  return r.stdout;
};
const psql = (env, sql, label) => run('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-F', '\t', '-c', sql], env, label);

async function token() {
  const r = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } });
  if (!r.ok) throw new Error('metadata token ' + r.status);
  return (await r.json()).access_token;
}

(async () => {
  const t0 = Date.now();
  if (!BUCKET) fail('BUCKET not set');
  if (COMPARE && !cfg) fail('SUPABASE_DB_URL ไม่ได้ตั้ง หรืออ่านไม่ออก (ตั้ง COMPARE=0 ถ้าจะกู้อย่างเดียว)');
  if (MODE !== 'drill' && MODE !== 'target') fail('MODE ต้องเป็น drill หรือ target');
  if (MODE === 'target') {
    const want = 'restore-into-' + TARGET_LABEL + '-' + bkkDay();
    if (process.env.CONFIRM !== want) fail('MODE=target จะแทนที่ข้อมูลใน ' + TARGET_LABEL + ' — ต้องส่ง CONFIRM=' + want + ' (วันที่ของวันนี้)');
    if (!cfg) fail('MODE=target ต้องมี SUPABASE_DB_URL');
    step('⚠️ MODE=target: จะกู้ไฟล์สำรองลงฐาน ' + TARGET_LABEL + ' (แทนที่ทุกตารางที่อยู่ในไฟล์)');
  }
  const auth = { Authorization: 'Bearer ' + await token() };
  const api = 'https://storage.googleapis.com/storage/v1/b/' + encodeURIComponent(BUCKET) + '/o';

  // 1. newest backup
  let meta;
  if (OBJECT) {
    const r = await fetch(api + '/' + encodeURIComponent(OBJECT), { headers: auth });
    if (!r.ok) fail('object ' + OBJECT + ': ' + r.status);
    meta = await r.json();
  } else {
    let items = [], pageToken = '';
    do {
      const r = await fetch(api + '?prefix=' + encodeURIComponent(PREFIX + '/') + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''), { headers: auth });
      if (!r.ok) fail('list ' + r.status + ': ' + (await r.text()).slice(0, 300));
      const j = await r.json(); items = items.concat(j.items || []); pageToken = j.nextPageToken || '';
    } while (pageToken);
    items = items.filter(o => /\.dump$/.test(o.name)).sort((a, b) => a.name < b.name ? 1 : -1);
    if (!items.length) fail('ไม่มีไฟล์สำรองใน gs://' + BUCKET + '/' + PREFIX + '/');
    meta = items[0];
  }
  const ageMin = Math.round((Date.now() - Date.parse(meta.timeCreated)) / 60000);
  step('ไฟล์สำรอง: ' + meta.name + ' · ' + meta.size + ' bytes · สร้างเมื่อ ' + ageMin + ' นาทีที่แล้ว');
  const dl = await fetch(api + '/' + encodeURIComponent(meta.name) + '?alt=media', { headers: auth });
  if (!dl.ok) fail('download ' + dl.status);
  const buf = Buffer.from(await dl.arrayBuffer());
  const md5 = crypto.createHash('md5').update(buf).digest('base64');
  if (md5 !== meta.md5Hash) fail('MD5 ของไฟล์ที่ดาวน์โหลดไม่ตรงกับที่เก็บไว้ (' + md5 + ' ≠ ' + meta.md5Hash + ')');
  fs.writeFileSync(DUMP, buf);

  // 2. empty PostgreSQL 17, socket only
  run('initdb', ['-D', PGDATA, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--locale=C'], process.env, 'initdb');
  run('pg_ctl', ['-D', PGDATA, '-w', '-t', '60', '-l', '/tmp/pgdrill.log', '-o', "-k " + SOCK + " -c listen_addresses=''", 'start'], process.env, 'pg_ctl start');
  const le = localEnv();
  psql(Object.assign({}, le, { PGDATABASE: 'postgres' }), 'create database drill', 'create database');
  /* what Supabase provides and our schema refers to: the API roles, and auth.jwt() used by every
   * row-level-security policy. A stub is enough — the drill reads as superuser, which bypasses RLS. */
  psql(le, `drop schema public cascade;
    do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
    end $$;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $f$ select '{}'::jsonb $f$;
    create schema extensions;
    create extension if not exists pgcrypto schema extensions;`, 'prepare');   /* where Supabase keeps it; gen_random_uuid() is core */

  // 3. restore — any error fails the drill
  const tr = Date.now();
  run('pg_restore', ['--no-owner', '--no-acl', '--exit-on-error', '--single-transaction', '-d', 'drill', DUMP], le, 'pg_restore', 30);
  const restoreSec = Math.round((Date.now() - tr) / 100) / 10;
  step('กู้เสร็จใน ' + restoreSec + ' วินาที');

  // 4. fingerprint every table
  const tables = psql(le, "select tablename from pg_tables where schemaname='public' order by 1", 'list tables').split('\n').filter(Boolean);
  if (tables.length < MIN_TABLES) fail('กู้ได้ ' + tables.length + ' ตาราง ต้องมีอย่างน้อย ' + MIN_TABLES);
  const fp = tables.map(t => {
    const q = '"' + t.replace(/"/g, '""') + '"';
    return `select '${t.replace(/'/g, "''")}', count(*), md5(coalesce(string_agg(x.r, '|' order by x.r), '')) from (select t::text r from public.${q} t) x`;
  }).join('\nunion all\n');
  const parse = out => Object.fromEntries(out.split('\n').filter(Boolean).map(l => { const [t, n, h] = l.split('\t'); return [t, { n: Number(n), h }]; }));
  const restored = parse(psql(le, fp, 'fingerprint restored'));
  const rows = Object.values(restored).reduce((a, b) => a + b.n, 0);

  const report = { ok: true, object: 'gs://' + BUCKET + '/' + meta.name, backupAgeMinutes: ageMin, bytes: Number(meta.size),
    restoreSeconds: restoreSec, tables: tables.length, rows, compared: COMPARE, differences: [] };

  // 5. compare with atom-prod (read-only transaction)
  /* MODE=target skips this: a broken target (the reason for restoring) may not even have the tables */
  if (COMPARE && MODE !== 'target') {
    const live = parse(psql(prodEnv(), 'begin; set transaction read only;\n' + fp + ';\ncommit;', 'fingerprint atom-prod'));
    for (const t of tables) {
      const a = restored[t], b = live[t];
      if (!b) report.differences.push({ table: t, problem: 'ไม่มีใน atom-prod' });
      else if (a.n !== b.n) report.differences.push({ table: t, problem: 'จำนวนแถว', backup: a.n, live: b.n });
      else if (a.h !== b.h) report.differences.push({ table: t, problem: 'ข้อมูลในแถวต่างกัน', rows: a.n });
    }
    Object.keys(live).filter(t => !restored[t]).forEach(t => report.differences.push({ table: t, problem: 'ไม่มีในไฟล์สำรอง' }));
    if (report.differences.length) {
      report.ok = false;
      report.hint = 'ถ้ามีคนเขียนข้อมูลหลังไฟล์นี้ถูกสร้าง (' + ageMin + ' นาทีที่แล้ว) ความต่างนี้เป็นเรื่องปกติ — สำรองใหม่แล้วซ้อมทันทีตอนไม่มีใครใช้';
    }
  }
  run('pg_ctl', ['-D', PGDATA, '-m', 'fast', 'stop'], process.env, 'pg_ctl stop');

  // 6. MODE=target — restore INTO the real database, then prove it equals the backup
  if (MODE === 'target') {
    /* keep schema public (and its comment) — Supabase's grants are on it; everything else in the file is replaced */
    const list = run('pg_restore', ['--list', DUMP], process.env, 'list').split('\n')
      .filter(l => !/^\d+;.* SCHEMA - public /.test(l) && !/^\d+;.* COMMENT - SCHEMA public /.test(l)).join('\n');
    fs.writeFileSync('/tmp/target.list', list);
    const tt = Date.now();
    run('pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-acl', '--exit-on-error', '--single-transaction',
      '-L', '/tmp/target.list', '-d', cfg.database, DUMP], prodEnv(), 'pg_restore into ' + TARGET_LABEL, 30);
    report.targetRestoreSeconds = Math.round((Date.now() - tt) / 100) / 10;
    step('กู้ลง ' + TARGET_LABEL + ' เสร็จใน ' + report.targetRestoreSeconds + ' วินาที');
    const after = parse(psql(prodEnv(), 'begin; set transaction read only;\n' + fp + ';\ncommit;', 'fingerprint target after'));
    for (const t of tables) {
      const a = restored[t], b = after[t];
      if (!b) report.differences.push({ table: t, problem: 'ไม่มีหลังกู้' });
      else if (a.n !== b.n) report.differences.push({ table: t, problem: 'จำนวนแถว', backup: a.n, target: b.n });
      else if (a.h !== b.h) report.differences.push({ table: t, problem: 'ข้อมูลในแถวต่างกัน', rows: a.n });
    }
    report.extraTablesOnTarget = psql(prodEnv(), "select tablename from pg_tables where schemaname='public' order by 1", 'list target')
      .split('\n').filter(t => t && !restored[t]);
    report.mode = 'target'; report.target = TARGET_LABEL; report.ok = !report.differences.length;
  }
  report.seconds = Math.round((Date.now() - t0) / 1000);
  console.log(JSON.stringify(report));
  if (MODE === 'target') {
    if (!report.ok) fail('กู้ลง ' + TARGET_LABEL + ' แล้ว ' + report.differences.length + ' ตารางไม่ตรงกับไฟล์สำรอง');
    console.log('✅ RESTORE INTO ' + TARGET_LABEL + ' PASSED: ' + report.tables + ' ตาราง · ' + rows + ' แถว · ตรงกับไฟล์สำรองทุกตาราง');
    return;
  }
  if (!report.ok) fail(report.differences.length + ' ตารางไม่ตรง — ดูบรรทัด JSON ด้านบน');
  console.log('✅ RESTORE DRILL PASSED: ' + report.tables + ' ตาราง · ' + rows + ' แถว · ตรงกับ atom-prod ทุกตาราง');
})().catch(e => fail(e && e.stack || e));
