/**
 * tools/measure_cloud_run.js — gate 1 of docs/SPEED_FIRST_PLAN.md, measured on the REAL host
 *   node tools/measure_cloud_run.js                 30 rounds of the teacher home batch
 *   node tools/measure_cloud_run.js --n=50
 *
 * measure_fast_host.js timed the engine from this machine. This times what a phone would wait for:
 * HTTPS from Bangkok → Cloud Run (asia-southeast1) → Supabase (Singapore) → back, with the same
 * one-request batch api.js sends for the teacher's home screen. Target: p50 < 1.5s.
 *
 * 🔴 THE SERVICE IS PRIVATE WHILE THIS RUNS (2026-11-04). It is reached with a Google identity
 * token of the account that owns the project, not opened to allUsers — so nothing but this script
 * can call it. The session token is signed with session-secret-staging, a random value that is not
 * the live Apps Script secret; it is read from Secret Manager into memory and never printed.
 * The tenant is wh-a75f7402 — fabricated data only.
 */
'use strict';
const cp = require('child_process'), https = require('https'), path = require('path');
const { sign_ } = require(path.join(__dirname, '..', 'server', 'session.js'));

const URL_ = process.env.FAST_HOST_URL || 'https://atom-fast-120486339414.asia-southeast1.run.app/';
const ROUNDS = Number((process.argv.find(a => a.startsWith('--n=')) || '').slice(4)) || 30;
const GCLOUD = process.env.GCLOUD || 'C:/Users/Pattara.Th/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd';
const gcloud = args => cp.execSync('"' + GCLOUD + '" ' + args.join(' '), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const TEACHER_HOME = ['staffSelf', 'classList', 'myAttendanceToday', 'journalStatus', 'studentAlerts',
  'notifications', 'myHolidayOTNext', 'holidayAttendList', 'teacherClassAttendance', 'staffMissingCheckout'];

function post(body, idToken) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now(), u = new URL(URL_), data = JSON.stringify(body);
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), authorization: 'Bearer ' + idToken } },
      res => { let s = ''; res.on('data', c => s += c); res.on('end', () => resolve({ ms: Date.now() - t0, status: res.statusCode, server: res.headers['x-atom-ms'], body: s })); });
    req.on('error', reject); req.setTimeout(60000, () => req.destroy(new Error('timeout'))); req.end(data);
  });
}
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
const ms = v => v >= 1000 ? (v / 1000).toFixed(2) + 's' : Math.round(v) + 'ms';

(async () => {
  const idToken = gcloud(['auth', 'print-identity-token']);
  const secret = gcloud(['secrets', 'versions', 'access', 'latest', '--secret=session-secret-staging']);
  const now = Date.now();
  const body = Buffer.from(JSON.stringify({ uid: 'U-PERF', role: 'Teacher', linkedId: 'STF-002', iat: now, exp: now + 3600e3 })).toString('base64');
  const token = body + '.' + sign_(body, secret);
  const batch = { action: 'batch', token, payload: { calls: TEACHER_HOME.map(a => ({ action: a, payload: {} })) } };

  /* the refusals first — a host that answers without a valid session is not one to measure */
  const noTok = await post({ action: 'listStudents' }, idToken);
  const bad = await post({ action: 'listStudents', token: body + '.AAAA' }, idToken);
  const refused = r => /NO_SESSION/.test(r.body);
  console.log('\n🔒 ไม่มี token → ' + (refused(noTok) ? 'ปฏิเสธ ✅' : '🔴 ' + noTok.body.slice(0, 80)) +
              ' · token ปลอม → ' + (refused(bad) ? 'ปฏิเสธ ✅' : '🔴 ' + bad.body.slice(0, 80)));
  console.log('   (คำขอแรกนี้รวมเวลาปลุกเครื่อง: ' + ms(noTok.ms) + ')');

  const tot = [], srv = [], hyd = [], run = []; let okCalls = 0, allCalls = 0, firstErr = ''; const byAction = {}; const forwarded = new Set();
  for (let i = 0; i < ROUNDS; i++) {
    const r = await post(batch, idToken);
    tot.push(r.ms);
    try { const x = JSON.parse(r.server || '{}'); srv.push(x.total || 0); hyd.push(x.hydrate || 0); run.push(x.run || 0); } catch (e) {}
    try {
      const j = JSON.parse(r.body);
      (j.data || []).forEach((c, k) => { allCalls++; if (c.ok) okCalls++;
        /* a Code.gs ROUTE on live — the host refuses to answer it from the engine, the app must ask GAS */
        else if (c.error && c.error.code === 'NOT_ON_FAST_HOST') { forwarded.add(TEACHER_HOME[k]); }
        else { if (!firstErr) firstErr = JSON.stringify(c.error).slice(0, 120);
        byAction[TEACHER_HOME[k]] = byAction[TEACHER_HOME[k]] || (c.error && c.error.message || '?').slice(0, 90); } });
      if (!j.ok && !firstErr) firstErr = JSON.stringify(j.error).slice(0, 120);
    } catch (e) { if (!firstErr) firstErr = 'HTTP ' + r.status + ' ' + r.body.slice(0, 80); }
  }
  console.log('\n⏱️  หน้าหลักคุณครู (' + TEACHER_HOME.length + ' call ใน 1 คำขอ) × ' + ROUNDS + ' รอบ · กรุงเทพฯ → Cloud Run สิงคโปร์');
  console.log('   ที่โทรศัพท์รอ   p50 ' + ms(pct(tot, .5)) + ' · p95 ' + ms(pct(tot, .95)) + ' · ช้าสุด ' + ms(Math.max.apply(null, tot)));
  console.log('   ในเซิร์ฟเวอร์   p50 ' + ms(pct(srv, .5)) + ' · p95 ' + ms(pct(srv, .95)) + '   (โหลดข้อมูล p50 ' + ms(pct(hyd, .5)) + ' · รัน handler p50 ' + ms(pct(run, .5)) + ')');
  const nFwd = forwarded.size * ROUNDS;
  console.log('   call ที่ตอบสำเร็จ ' + okCalls + '/' + (allCalls - nFwd) + (nFwd ? '  · ส่งต่อ Apps Script (route ของ Code.gs): ' + [...forwarded].join(', ') : '') +
    (firstErr ? '   ตัวอย่างที่ไม่สำเร็จ: ' + firstErr : ''));
  const p50 = pct(tot, .5);
  /* 🔴 A FAST FAILURE IS NOT A PASS. The first run against the real host printed "ผ่าน" with
   * p50 43ms — every one of those was a 503 from an instance that had crashed. A time only counts
   * when every call in every round came back ok. */
  const answered = allCalls === ROUNDS * TEACHER_HOME.length && okCalls === allCalls - nFwd && okCalls > 0;
  Object.keys(byAction).forEach(a => console.log('     ✗ ' + a.padEnd(24) + byAction[a]));
  if (!answered) { console.log('\n🔴 วัดไม่ได้ — มี call ที่ไม่ตอบสำเร็จ เวลาข้างบนจึงไม่มีความหมาย\n'); process.exit(1); }
  console.log('\n' + (p50 < 1500 ? '✅ ผ่านประตูชั้นที่ 1 (p50 < 1.5s)' : '🔴 ไม่ผ่านประตูชั้นที่ 1 (p50 ≥ 1.5s)') +
              ' · ของจริงวันนี้บน Apps Script: p50 7.9s · p95 20.0s\n');
})().catch(e => { console.error('🔴 ' + String(e && e.message || e).replace(/eyJ[\w.-]+/g, '<token>')); process.exit(1); });
