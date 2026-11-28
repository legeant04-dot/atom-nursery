/**
 * tools/move_check.js — one command that says whether the move-night wiring is right, at any step.
 *
 *   ATOM_PG_ENV=atom-prod.env node tools/move_check.js
 *
 * READ ONLY. It reads the database, describes Cloud Run, pings the hosts and fetches the public site.
 * It changes nothing and PRINTS NO SECRET: no URL with a password, no token, no secret value — only
 * yes/no, counts, lengths and short digests (the same rule as docs/MOVE_NIGHT_RUNBOOK.md and the
 * secret-inspection note). Run it before step 1, after step 3, after 5b and after step 6; the lines
 * that are expected to be ❌ early (LINE still capture, old tenant) turn ✅ as the night goes on.
 */
'use strict';
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
if (process.env.ATOM_PG_ENV !== 'atom-prod.env') {
  console.error('🔴 ต้องรันด้วย ATOM_PG_ENV=atom-prod.env — ไม่ใส่ = ตรวจ staging ไม่ใช่ฐานจริง');
  process.exit(2);
}
const { acquire, closePool } = require('./pg_lib.js');
const REGION = 'asia-southeast1', PROJECT = 'atom-nursery';
const PROD_HOST = 'https://atom-fast-prod-120486339414.asia-southeast1.run.app';
const SITE = 'https://legeant04-dot.github.io/atom-nursery/';
let bad = 0;
const ok = (good, label, note) => { if (!good) bad++; console.log((good ? '  ✅ ' : '  ❌ ') + label + (note ? '  · ' + note : '')); };
const info = (label, note) => console.log('  ·  ' + label + (note ? '  · ' + note : ''));
const sh = cmd => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });   // app.js is > 1 MB
const branchFile = (ref, file) => { try { return sh(`git -C "${ROOT}" show ${ref}:${file}`); } catch (e) { return ''; } };
const post = async (url, body) => {
  const t0 = Date.now();
  try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body), redirect: 'follow' });
    return { j: JSON.parse(await r.text()), ms: Date.now() - t0 }; }
  catch (e) { return { err: String(e.message || e).slice(0, 80), ms: Date.now() - t0 }; }
};

(async () => {
  console.log('🔎 move_check · ' + new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }));

  /* ── 1. the database ─────────────────────────────────────────────────────────────────── */
  console.log('\n① ฐานข้อมูล (atom-prod)');
  let tenantId = '';
  const h = await acquire();
  try {
    const q = async (s, p) => (await h.client.query(s, p)).rows;
    const t = await q("select id from tenant where code = 'atom'");
    tenantId = t[0] ? String(t[0].id) : '';
    ok(!!tenantId, 'tenant atom', tenantId ? 'id …' + tenantId.slice(-6) : 'ไม่มี (ปกติหลังล้าง / ก่อนขั้น 3)');
    if (tenantId) {
      for (const tb of ['students', 'staff', 'parents', 'billing', 'checkin_student', 'daily_journal']) {
        try { const n = (await q(`select count(*)::int n from ${tb} where tenant_id = $1`, [tenantId]))[0].n; info(tb, n + ' แถว'); }
        catch (e) { info(tb, '? ' + e.code); }
      }
    }
    const fz = tenantId ? await q("select value from school_config where tenant_id = $1 and key = 'WriteFreeze'", [tenantId]).catch(() => []) : [];
    info('WriteFreeze ใน Postgres', fz[0] && String(fz[0].value || '').trim() ? 'ตั้งอยู่ (ปิดรับการเขียน)' : 'ไม่ได้ตั้ง');
    h.release();
  } catch (e) { h.release(true); ok(false, 'อ่านฐานข้อมูล', e.code || String(e.message).slice(0, 60)); }
  await closePool();
  try {
    const out = sh(`node "${path.join(ROOT, 'tools', 'pg_sync_schema.js')}"`);
    const num = re => { const m = re.exec(out); return m ? Number(m[1]) : NaN; };
    const miss = num(/ตารางที่ขาด\s+(\d+)/) + num(/คอลัมน์ที่ขาด\s+(\d+)/) + num(/คอลัมน์ผิดชนิด\s+(\d+)/);
    ok(miss === 0, 'โครงตารางครบ (pg_sync_schema)', 'ขาด/ผิด ' + miss);
  } catch (e) { ok(false, 'pg_sync_schema', 'รันไม่ได้'); }

  /* ── 2. the production fast host ──────────────────────────────────────────────────────── */
  console.log('\n② Cloud Run atom-fast-prod');
  try {
    const s = JSON.parse(sh(`gcloud run services describe atom-fast-prod --region ${REGION} --project ${PROJECT} --format=json`));
    const c = s.spec.template.spec.containers[0], env = n => ((c.env || []).find(e => e.name === n) || {});
    const v = n => String(env(n).value || '');
    const ann = s.spec.template.metadata.annotations || {};
    info('revision', s.status.latestReadyRevisionName + ' · image ' + String(c.image).split('@sha256:')[1].slice(0, 12));
    ok(ann['autoscaling.knative.dev/minScale'] === '1', 'min-instances 1');
    ok(v('LINE_SEND') === 'on', 'LINE_SEND = on', 'ตอนนี้ ' + (v('LINE_SEND') || '(ว่าง)') + ' — เปิดในขั้น 5b');
    ok(!!tenantId && v('TENANT_ID') === tenantId, 'TENANT_ID = tenant atom ในฐาน', v('TENANT_ID') ? 'ตั้งไว้ …' + v('TENANT_ID').slice(-6) : 'ว่าง');
    for (const n of ['SUPABASE_DB_URL', 'SESSION_SECRET', 'LINE_TOKEN']) {
      const ref = env(n).valueFrom && env(n).valueFrom.secretKeyRef;
      ok(!!ref, n + ' มาจาก Secret Manager', ref ? ref.name : 'ไม่ใช่ secret');
    }
    const origins = v('ALLOWED_ORIGINS').split(',');
    ok(origins.includes('https://legeant04-dot.github.io') && origins.includes('https://atomnurseryapp.com'), 'ALLOWED_ORIGINS มีที่อยู่เดิม + โดเมน');
    try {
      const vers = sh(`gcloud secrets versions list prod-session-secret --project ${PROJECT} --filter=state=enabled --format=value(name)`).trim().split(/\s+/).filter(Boolean);
      ok(vers.length >= 2, 'prod-session-secret มีรุ่นที่ ผอ. ใส่แล้ว', 'รุ่นที่เปิด ' + vers.length + ' (1 = ยังเป็นค่าชั่วคราว — ขั้น 5b)');
    } catch (e) { ok(false, 'อ่านรุ่นของ prod-session-secret'); }
  } catch (e) { ok(false, 'describe atom-fast-prod', String(e.message).slice(0, 60)); }
  const fp = await post(PROD_HOST, { action: 'ping' });
  ok(!!(fp.j && fp.j.error && fp.j.error.code === 'NO_SESSION'), 'โฮสต์ตัวจริงตอบ', fp.err || (fp.ms + ' ms'));

  /* ── 3. Apps Script (live) ────────────────────────────────────────────────────────────── */
  console.log('\n③ Apps Script ตัวจริง');
  const gasUrl = (/GAS_URL: '([^']+)'/.exec(branchFile('moveday', 'webapp/api.js')) || [])[1] || '';
  ok(/WPBsx-7d\/exec$/.test(gasUrl), 'รุ่นคืนย้ายชี้ deployment ตัวจริงเดิม');
  if (gasUrl) { const g = await post(gasUrl, { action: 'ping' }); ok(!!(g.j && g.j.ok), 'Apps Script ตอบ ping', g.err || (g.ms + ' ms')); }

  /* ── 4. the website ───────────────────────────────────────────────────────────────────── */
  console.log('\n④ หน้าเว็บ (GitHub Pages)');
  const want = (/APP_VERSION = 'Version 1\.(\d+)'/.exec(branchFile('moveday', 'webapp/app.js')) || [])[1] || '?';
  try {
    const html = await (await fetch(SITE + '?mc=' + Date.now())).text();
    const live = (/app\.js\?v=(\d+)/.exec(html) || [])[1] || '?';
    ok(live === want, 'เว็บเป็นรุ่นคืนย้าย', 'เว็บ v' + live + ' · moveday v' + want + (live !== want ? ' (ปกติจนถึงขั้น 6)' : ''));
    if (live === want) {
      const api = await (await fetch(SITE + 'api.js?v=' + live)).text();
      ok(api.includes('atom-fast-prod-120486339414'), 'เว็บชี้โฮสต์ตัวจริง (atom-fast-prod)');
    }
  } catch (e) { ok(false, 'เปิดหน้าเว็บ', String(e.message).slice(0, 60)); }

  /* ── 5. backups ───────────────────────────────────────────────────────────────────────── */
  console.log('\n⑤ สำรองข้อมูล');
  try {
    const ex = JSON.parse(sh(`gcloud run jobs executions list --job atom-backup --region ${REGION} --project ${PROJECT} --limit 1 --format=json`))[0];
    const done = ex && ex.status && ex.status.completionTime, good = ex && ex.status && ex.status.succeededCount >= 1;
    const ago = done ? Math.round((Date.now() - Date.parse(done)) / 60000) : null;
    ok(!!good, 'สำรองล่าสุดสำเร็จ', done ? ago + ' นาทีก่อน' : 'ไม่มีข้อมูล');
  } catch (e) { ok(false, 'อ่านประวัติ atom-backup'); }

  console.log('\n' + (bad ? '❌ ' + bad + ' ข้อยังไม่ผ่าน — ดูว่าเป็นข้อที่ "ปกติจนถึงขั้น…" หรือไม่' : '✅ ผ่านทุกข้อ'));
})().catch(e => { console.error('🔴', String(e.message || e).slice(0, 120)); process.exit(1); });
