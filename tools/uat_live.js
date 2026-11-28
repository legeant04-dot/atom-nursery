#!/usr/bin/env node
/*
 * tools/uat_live.js — a live view of the UAT, read from the app's own telemetry (perf_log).
 *
 *   node tools/uat_live.js --db atom-prod.env [--port 8095] [--from "2026-11-28 12:30"]
 *   → open http://127.0.0.1:8095
 *
 * WHAT IT SHOWS (refreshes every 10 s): who is on the system now (role + device, no names — PDPA),
 * what they are doing (screen, last action), every request's time and outcome, the slowest and
 * the failing actions, which UAT_CHECKLIST tasks have been seen to work, and how each action's
 * speed compares with the previous UAT round (secrets/export/uat_perf_log_*.json, if present).
 *
 * 🔴 READ-ONLY. One SELECT on perf_log per refresh; the only file it writes is a CSV export into
 *    secrets/export/ (gitignored) when the button is pressed.
 * 🔴 Listens on 127.0.0.1 only — nothing is reachable from the network. The database password
 *    stays in secrets/<file>.env and never reaches the browser; the page only sees aggregates.
 * 🔴 --db is REQUIRED. Without it pg_lib would quietly use staging, and a quiet empty dashboard
 *    during the test would look exactly like "nobody has started yet".
 *
 * Telemetry facts the numbers depend on (src/Perf.gs, webapp/api.js):
 *  · ts is when the SERVER received the batch, not when the tap happened — rows arrive in
 *    flushes, so "live" here means within ~10–30 s.
 *  · type: api (one request, ms = tap→answer incl. queue + network + server), nav (screen drawn),
 *    boot (app start), err (client-side failure), healed (lost reply recovered), fastFwd (fast host
 *    handed the request to Apps Script), cache (hit/miss counters, count in `batch`).
 *  · role comes from the verified session; 'anon' = no valid sign-in.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DB = arg('--db');
if (!DB) { console.error('🔴 ต้องระบุ --db <ไฟล์ใน secrets/> เช่น --db atom-prod.env'); process.exit(2); }
process.env.ATOM_PG_ENV = DB;
const PORT = Number(arg('--port', 8095));
const ROOT = path.join(__dirname, '..');
const { acquire, closePool } = require('./pg_lib');

/* ---- which path each action takes (same lists the UAT build uses) ------------------------- */
function listFrom(src, name) {
  const m = new RegExp('const ' + name + ' = \\{([\\s\\S]*?)\\n  \\};').exec(src);
  const out = {};
  if (m) for (const x of m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').matchAll(/([A-Za-z0-9_]+):\s*1/g)) out[x[1]] = 1;
  return out;
}
const apiSrc = fs.readFileSync(path.join(ROOT, 'webapp', 'api.js'), 'utf8');
const FAST_READ = listFrom(apiSrc, 'FAST_ACTIONS');
const FAST_WRITE = listFrom(apiSrc, 'FAST_WRITES');
/* 🔴 This is the LIST an action is on, not the road it took. api.js sends a screen's calls as one batch and
 * the batch goes to the fast host only if EVERY call in it is listed (fastRoute) — one GAS-only call
 * (e.g. parentHome) takes the whole batch to Apps Script. The telemetry does not record which road;
 * a listed action with a p50 of seconds rode with something unlisted. */
const pathOf = a => FAST_READ[a] ? 'รายชื่อเร็ว·อ่าน' : FAST_WRITE[a] ? 'รายชื่อเร็ว·เขียน' : 'GAS';

/* ---- error codes: a refusal the app meant vs. the system failing -------------------------- */
// OFFLINE = the phone could not reach us; NO_SESSION / SESSION_* = asked to sign in again. Neither is a rule
// the app meant to apply, and both are what a tester experiences as "broken".
const SYSTEM_CODES = /^(INTERNAL|ERR|TIMEOUT|NETWORK|BAD_REPLY|LOST|HTTP|FAST_DOWN|LOCK|BUSY|QUOTA|OFFLINE|NO_SESSION|SESSION|\d+$)/i;
const isSystemFail = r => String(r.ok) !== '1' && (!r.code || SYSTEM_CODES.test(r.code));

/* ---- UAT_CHECKLIST tasks the telemetry can see -------------------------------------------- *
 * role '*' = any signed-in role. expectRefusal = the task PASSES when the app refuses (outside
 * the radius, a reused slip, a wrong PIN) — seen as an api row with ok=0 and a business code.
 * This is a hint for the support team, not the verdict: the verdict is a person looking at the
 * screen (right amount, right LINE). */
const TASKS = [
  ['① ทุกคน', '*', 'ล็อกอินเข้าหน้าแรก', ['parentHome', 'staffSelf', 'myAttendanceToday', 'financeSummary', 'notifications']],
  ['② ผู้ปกครอง', 'Parent', 'หน้าแรก', ['parentHome']],
  ['② ผู้ปกครอง', 'Parent', 'เช็คอิน/เช็คเอาท์ลูก (เช็คอินได้ทุกที่)', ['parentCheckin']],
  ['② ผู้ปกครอง', 'Parent', 'เช็คเอาท์นอกรัศมี → ถูกปฏิเสธ', ['parentCheckin'], 1],
  ['② ผู้ปกครอง', 'Parent', 'ดูบิลเดือนนี้', ['payments', 'parentDue', 'billDocument']],
  ['② ผู้ปกครอง', 'Parent', 'อัปโหลดสลิป', ['uploadSlip', 'verifySlip', 'payCombined', 'payCharge', 'payOT']],
  ['② ผู้ปกครอง', 'Parent', 'สลิปซ้ำ/สลิปเดิมกับบิลอื่น → ถูกปฏิเสธ', ['uploadSlip', 'verifySlip', 'payCombined', 'payCharge', 'payOT'], 1],
  ['② ผู้ปกครอง', 'Parent', 'แจ้งลาลูก', ['studentAbsence', 'submitLeave']],
  ['② ผู้ปกครอง', 'Parent', 'อ่านสมุดสื่อสาร', ['getJournal', 'journalHistory', 'journalMonth']],
  ['② ผู้ปกครอง', 'Parent', 'ตอบความเห็นสมุดสื่อสาร', ['saveParentComment', 'addComment']],
  ['② ผู้ปกครอง', 'Parent', 'ดูชำระล่วงหน้า', ['prepayTiers', 'studentBillBase']],
  ['③ ครู', 'Teacher', 'ลงเวลาเข้างาน', ['staffCheckin']],
  ['③ ครู', 'Teacher', 'ลงเวลาออกงาน', ['staffCheckout']],
  ['③ ครู', 'Teacher', 'เช็คอิน/รับกลับเด็กแทนผู้ปกครอง', ['staffStudentCheckin']],
  ['③ ครู', 'Teacher', 'บันทึกสมุดสื่อสาร', ['submitJournal', 'submitJournalsMany']],
  ['③ ครู', 'Teacher', 'แจ้งบาดเจ็บ', ['submitInjury']],
  ['③ ครู', 'Teacher', 'ยื่นใบลา', ['submitLeave']],
  ['③ ครู', 'Teacher', 'ขอ OT / แก้เวลา', ['submitTimeRequest']],
  ['③ ครู', 'Teacher', 'รหัสสลิปเงินเดือนผิด → ถูกปฏิเสธ', ['checkStaffPassword'], 1],
  ['④ แอดมิน', 'Admin', 'กระดิ่ง 🔔', ['notifications', 'markNotifsRead']],
  ['④ แอดมิน', 'Admin', 'อนุมัติใบลา', ['approveLeave']],
  ['④ แอดมิน', 'Admin', 'อนุมัติ OT / เวลา', ['approveOT', 'approveTimeRequest', 'confirmTimeRequest', 'confirmOT']],
  ['④ แอดมิน', 'Admin', 'ยืนยันสลิป', ['confirmSlip', 'confirmPayment']],
  ['④ แอดมิน', 'Admin', 'ปฏิเสธสลิป', ['rejectSlip', 'rejectPayment']],
  ['④ แอดมิน', 'Admin', 'รับเงินสด', ['recordCashPayment', 'payCombinedCash']],
  ['④ แอดมิน', 'Admin', 'ออกบิลเดือนถัดไป', ['generateMonthlyBills', 'issueBillsFor', 'issueBill']],
  ['④ แอดมิน', 'Admin', 'ยกเลิกรอบบิล', ['undoBillRun']],
  ['④ แอดมิน', 'Admin', 'คำนวณเงินเดือน', ['computePayroll']],
  ['④ แอดมิน', 'Admin', 'ดูสลิปเงินเดือน', ['getPayslip']],
  ['④ แอดมิน', 'Admin', 'สรุปการเงิน', ['financeSummary', 'financeTrend']],
  ['④ แอดมิน', 'Admin', 'ตรวจ LINE', ['lineUsage', 'lineRecipients']],
  ['④ แอดมิน', 'Admin', 'ออกจากระบบทุกเครื่อง', ['signOutEverywhere']],
];

/* ---- previous UAT round, for "did it get faster or slower" -------------------------------- */
function pct(a, p) { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); }
let BASE = {}, BASE_NAME = '';
try {
  const dir = path.join(ROOT, 'secrets', 'export');
  const f = fs.readdirSync(dir).filter(n => /^uat_perf_log_.*\.json$/.test(n)).sort().pop();
  if (f) {
    const by = {};
    for (const r of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      if (r.type !== 'api' || String(r.ok) !== '1' || r.ms == null) continue;
      (by[r.action] = by[r.action] || []).push(Number(r.ms));
    }
    for (const a in by) BASE[a] = { n: by[a].length, p50: pct(by[a], 0.5) };
    BASE_NAME = f;
  }
} catch (e) { /* no baseline is fine */ }

/* ---- the one query, then everything is arithmetic ---------------------------------------- */
async function rowsSince(from) {
  const h = await acquire(), c = h.client;
  try {
    const r = await c.query(
      `select to_char(ts at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI:SS') t, extract(epoch from ts)*1000 e,
              sid, role, type, action, ms, ok, code, batch, screen, dev, net, pwa, ver, os
         from perf_log where ts >= $1::timestamptz order by ts, seq`, [from]);
    h.release();
    return r.rows;
  } catch (e) { h.release(true); throw e; }
}

function build(rows, nowMs) {
  const sess = {}, act = {}, scr = {}, errs = {}, task = TASKS.map(() => ({ ok: 0, refused: 0, fail: 0, last: '', who: {} }));
  let hit = 0, miss = 0, api = 0, apiFail = 0, sysFail = 0, fwd = 0;
  const allMs = [];
  for (const r of rows) {
    const s = sess[r.sid] = sess[r.sid] || { sid: r.sid, role: r.role, dev: r.dev, os: r.os, net: r.net, ver: r.ver, pwa: r.pwa,
      first: r.t, last: r.t, lastE: 0, n: 0, fail: 0, ms: [], screen: '', action: '', done: {} };
    s.last = r.t; s.lastE = Number(r.e); if (r.role && r.role !== 'anon') s.role = r.role; s.net = r.net || s.net;
    if (r.screen && r.type !== 'cache') s.screen = r.screen;
    if (r.type === 'cache') { if (r.action === 'readCache') hit += Number(r.batch) || 0; else miss += Number(r.batch) || 0; continue; }
    if (r.type === 'fastFwd') { fwd++; continue; }
    if (r.type === 'nav' || r.type === 'boot') {
      const k = (r.type === 'boot' ? '⏻ เปิดแอป · ' + (r.role || '') : r.action || r.screen || '?');
      const x = scr[k] = scr[k] || { k, ms: [] }; if (r.ms != null) x.ms.push(Number(r.ms));
      continue;
    }
    if (r.type === 'err' || r.type === 'healed') {
      const k = r.type + ' · ' + (r.action || '') + ' · ' + String(r.code || '').slice(0, 60);
      const x = errs[k] = errs[k] || { k, n: 0, sids: {}, last: '' }; x.n++; x.sids[r.sid] = 1; x.last = r.t;
      if (r.type === 'err') { s.fail++; sysFail++; }
      continue;
    }
    if (r.type !== 'api') continue;
    api++; s.n++; s.action = r.action;
    const ms = r.ms == null ? null : Number(r.ms);
    const good = String(r.ok) === '1';
    if (ms != null) { s.ms.push(ms); allMs.push(ms); }
    const a = act[r.action] = act[r.action] || { a: r.action, path: pathOf(r.action), n: 0, fail: 0, sys: 0, ms: [], codes: {}, roles: {}, sids: {} };
    a.n++; a.roles[r.role] = 1; a.sids[r.sid] = 1; if (ms != null && good) a.ms.push(ms);
    if (!good) {
      a.fail++; apiFail++; s.fail++; a.codes[r.code || '?'] = (a.codes[r.code || '?'] || 0) + 1;
      if (isSystemFail(r)) { a.sys++; sysFail++; }
      const k = 'api · ' + r.action + ' · ' + (r.code || '?');
      const x = errs[k] = errs[k] || { k, n: 0, sids: {}, last: '', business: !isSystemFail(r) }; x.n++; x.sids[r.sid] = 1; x.last = r.t;
    }
    TASKS.forEach((t, i) => {
      if (t[3].indexOf(r.action) < 0) return;
      if (t[1] !== '*' && t[1] !== r.role) return;
      if (t[1] === '*' && (!r.role || r.role === 'anon')) return;
      const st = task[i];
      const sys = !good && isSystemFail(r);
      if (good) st.ok++; else if (sys) st.fail++; else st.refused++;
      st.last = r.t;
      // what counts as "this person did this task": the outcome the checklist expects (success, or a
      // rule refusal for the ต้องถูกปฏิเสธ rows). A system failure never counts.
      if (t[4] ? (!good && !sys) : good) { st.who[r.sid] = 1; s.done[i] = 1; }
    });
  }
  const sessions = Object.values(sess).map(s => ({
    sid: s.sid, role: s.role || 'anon', dev: s.dev, os: s.os, net: s.net, ver: s.ver, pwa: s.pwa, first: s.first, last: s.last,
    agoSec: Math.round((nowMs - s.lastE) / 1000), n: s.n, fail: s.fail, p50: pct(s.ms, 0.5), screen: s.screen, action: s.action,
    done: Object.keys(s.done).map(Number).sort((a, b) => a - b),
    // tasks this role is expected to do: its own rows plus the 'ทุกคน' rows
    mine: TASKS.filter(t => t[1] === '*' || t[1] === (s.role || 'anon')).length
  })).sort((a, b) => a.agoSec - b.agoSec);
  const actions = Object.values(act).map(a => ({
    a: a.a, path: a.path, n: a.n, fail: a.fail, sys: a.sys, p50: pct(a.ms, 0.5), p95: pct(a.ms, 0.95), max: a.ms.length ? Math.round(Math.max(...a.ms)) : null,
    total: Math.round(a.ms.reduce((x, y) => x + y, 0)), roles: Object.keys(a.roles).join(' '), people: Object.keys(a.sids).length,
    codes: Object.entries(a.codes).map(([k, v]) => k + '×' + v).join(' '), base: BASE[a.a] || null
  })).sort((x, y) => y.total - x.total);
  const screens = Object.values(scr).map(x => ({ k: x.k, n: x.ms.length, p50: pct(x.ms, 0.5), p95: pct(x.ms, 0.95) })).sort((a, b) => (b.p50 || 0) - (a.p50 || 0));
  const errors = Object.values(errs).map(x => ({ k: x.k, n: x.n, people: Object.keys(x.sids).length, last: x.last, business: !!x.business })).sort((a, b) => b.n - a.n);
  const passOf = (t, i) => t[4] ? task[i].refused > 0 : task[i].ok > 0;
  const groups = {};
  TASKS.forEach((t, i) => { const g = groups[t[0]] = groups[t[0]] || { g: t[0], pass: 0, total: 0 }; g.total++; if (passOf(t, i)) g.pass++; });
  const taskPass = TASKS.filter(passOf).length;
  const roles = {};
  for (const s of sessions) if (s.agoSec <= 300) roles[s.role] = (roles[s.role] || 0) + 1;
  const feed = rows.filter(r => r.type !== 'cache').slice(-60).reverse().map(r => ({
    t: r.t.slice(11), sid: String(r.sid || '').slice(-4), role: r.role, type: r.type, action: r.action, ms: r.ms == null ? null : Math.round(r.ms),
    ok: String(r.ok) === '1', code: r.code, screen: r.screen, path: r.type === 'api' ? pathOf(r.action) : ''
  }));
  return {
    now: new Date(nowMs).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }), rows: rows.length,
    summary: { activeNow: sessions.filter(s => s.agoSec <= 300).length, roles, sessions: sessions.length, api, apiFail, sysFail, fwd,
      p50: pct(allMs, 0.5), p95: pct(allMs, 0.95), cacheHit: hit + miss ? Math.round(100 * hit / (hit + miss)) : null,
      taskPass, taskTotal: TASKS.length, taskPct: Math.round(100 * taskPass / TASKS.length), groups: Object.values(groups) },
    sessions, actions, screens, errors, feed, baseName: BASE_NAME,
    tasks: TASKS.map((t, i) => ({ g: t[0], role: t[1], label: t[2], expectRefusal: !!t[4], ok: task[i].ok, refused: task[i].refused,
      fail: task[i].fail, last: task[i].last, who: Object.keys(task[i].who) }))
  };
}

function csv(rows) {
  const cols = ['t', 'sid', 'role', 'type', 'action', 'ms', 'ok', 'code', 'batch', 'screen', 'dev', 'net', 'pwa', 'ver', 'os'];
  const q = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '﻿' + cols.join(',') + '\n' + rows.map(r => cols.map(c => q(r[c])).join(',')).join('\n') + '\n';
}

const DEFAULT_FROM = arg('--from', null);
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const from = u.searchParams.get('from') || DEFAULT_FROM || new Date(Date.now() - 3 * 3600e3).toISOString();
  try {
    if (u.pathname === '/data') {
      const rows = await rowsSince(from.includes('+') || from.endsWith('Z') ? from : from + '+07:00');
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(build(rows, Date.now())));
    }
    if (u.pathname === '/export') {
      const rows = await rowsSince(from.includes('+') || from.endsWith('Z') ? from : from + '+07:00');
      const dir = path.join(ROOT, 'secrets', 'export'); fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).replace(/[: ]/g, '-').slice(0, 16);
      const f = path.join(dir, 'uat_live_' + stamp + '.csv');
      fs.writeFileSync(f, csv(rows));
      const sumF = f.replace(/\.csv$/, '_summary.json');
      fs.writeFileSync(sumF, JSON.stringify(build(rows, Date.now()), null, 1));
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, rows: rows.length, file: path.relative(ROOT, f), summary: path.relative(ROOT, sumF) }));
    }
    if (u.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(PAGE);
    }
    res.writeHead(404); res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: String(e && e.message || e).replace(/postgres\S+/g, '[url]').slice(0, 300) }));
  }
});

const PAGE = String.raw`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>UAT Live · Atom</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#1d2433;--mut:#6b7385;--line:#e4e7ee;--ok:#1f8a4c;--warn:#b7791f;--bad:#c53030;--fast:#2b6cb0}
*{box-sizing:border-box}body{margin:0;font:13px/1.45 system-ui,"Segoe UI",Tahoma,sans-serif;background:var(--bg);color:var(--ink)}
header{position:sticky;top:0;z-index:2;background:#1d2433;color:#fff;padding:10px 16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
header b{font-size:15px}header input{font:inherit;padding:3px 6px;border-radius:6px;border:0;width:150px}
header button{font:inherit;padding:4px 10px;border-radius:6px;border:0;cursor:pointer;background:#e2e8f0}
.mut{color:var(--mut)}header .mut{color:#a9b3c7}
main{padding:12px 16px;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(520px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;overflow:auto;max-height:560px}
.card h2{font-size:14px;margin:0 0 8px;position:sticky;top:-10px;background:var(--card);padding-top:2px}
.wide{grid-column:1/-1}
.kpis{display:flex;gap:10px;flex-wrap:wrap}.kpi{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 12px;min-width:120px}
.kpi .v{font-size:22px;font-weight:700}.kpi .l{color:var(--mut);font-size:12px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:4px 6px;border-bottom:1px solid var(--line);white-space:nowrap;vertical-align:top}
th{font-weight:600;color:var(--mut);font-size:12px}td.n{text-align:right;font-variant-numeric:tabular-nums}
.ok{color:var(--ok)}.bad{color:var(--bad);font-weight:600}.warn{color:var(--warn)}.fast{color:var(--fast)}
.pill{display:inline-block;padding:0 6px;border-radius:9px;font-size:11px;background:#edf2f7}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px}
input.lbl{width:110px;font:inherit;padding:1px 4px;border:1px solid var(--line);border-radius:4px}
tr.idle td{color:#a0a7b5}
td .small{display:block;white-space:normal;max-width:280px;font-size:11px}
</style></head><body>
<header><b>🧪 UAT Live · Atom Nursery</b>
<span>ตั้งแต่ <input id="from" placeholder="2026-11-28 12:30"></span>
<button onclick="load()">รีเฟรช</button><button onclick="exp()">💾 บันทึกผล (CSV + สรุป)</button>
<span class="mut" id="stamp"></span><span class="mut" id="msg"></span></header>
<main>
<div class="wide kpis" id="kpis"></div>
<div class="card"><h2>👥 คนในระบบตอนนี้ <span class="mut">(เห็นภายใน 5 นาที · ใส่ชื่อเล่นเองได้ เก็บในเครื่องนี้เท่านั้น)</span></h2><div id="sessions"></div></div>
<div class="card"><h2>✅ งานตามเช็คลิสต์ <span class="mut">(เห็นจากระบบ — ผู้ทดสอบต้องดูยอด/LINE ด้วยตาเอง)</span></h2><div id="tasks"></div></div>
<div class="card"><h2>⚠️ ข้อผิดพลาด</h2><div id="errors"></div></div>
<div class="card"><h2>📡 ความเคลื่อนไหวล่าสุด</h2><div id="feed"></div></div>
<div class="card wide"><h2>⏱️ เวลาต่อคำสั่ง <span class="mut">(เรียงตามเวลาที่ผู้ใช้รอรวม · เทียบ UAT รอบก่อน · คำสั่งในรายชื่อเร็วที่ใช้หลายวินาที = ถูกส่งไปพร้อมคำสั่งที่ยังอยู่ Apps Script)</span></h2><div id="actions"></div></div>
<div class="card"><h2>🖥️ เวลาเปิดหน้าจอ</h2><div id="screens"></div></div>
</main>
<script>
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const LBL=JSON.parse(localStorage.getItem('uatLabels')||'{}');
window.setLbl=(sid,v)=>{LBL[sid]=v;localStorage.setItem('uatLabels',JSON.stringify(LBL));};
$('from').value=localStorage.getItem('uatFrom')||'';
const ms=v=>v==null?'–':(v>=1000?(v/1000).toFixed(1)+'s':v+'ms');
const tone=v=>v==null?'':v>=8000?'bad':v>=3000?'warn':'ok';
function q(){const f=$('from').value.trim();localStorage.setItem('uatFrom',f);return f?'?from='+encodeURIComponent(f):'';}
async function load(){
  try{const r=await fetch('/data'+q());const d=await r.json();if(d.error)throw new Error(d.error);draw(d);$('msg').textContent='';}
  catch(e){$('msg').textContent='⚠️ '+e.message;}
}
async function exp(){const r=await fetch('/export'+q());const d=await r.json();$('msg').textContent=d.ok?('บันทึกแล้ว '+d.rows+' แถว → '+d.file):('⚠️ '+d.error);}
function draw(d){
  const s=d.summary;$('stamp').textContent='อัปเดต '+d.now+' · '+d.rows+' แถว';
  const roles=Object.entries(s.roles).map(([k,v])=>k+' '+v).join(' · ')||'–';
  $('kpis').innerHTML=[
    ['ทดสอบแล้ว',s.taskPct+'%',s.taskPass+'/'+s.taskTotal+' งานในเช็คลิสต์',s.taskPct>=100?'ok':''],['ออนไลน์ตอนนี้',s.activeNow,roles],['เครื่องทั้งหมด',s.sessions,'ตั้งแต่เวลาที่เลือก'],
    ['คำขอ',s.api,'ล้มเหลว '+s.apiFail],['ระบบพัง',s.sysFail,'ไม่นับการปฏิเสธตามกฎ',s.sysFail?'bad':'ok'],
    ['เวลา p50',ms(s.p50),'p95 '+ms(s.p95),tone(s.p50)],['แคชตอบเอง',s.cacheHit==null?'–':s.cacheHit+'%','อ่านซ้ำไม่ต้องรอ'],
    ['ส่งต่อ GAS',s.fwd,'โฮสต์เร็วส่งให้ Apps Script']
  ].map(k=>'<div class="kpi"><div class="v '+(k[3]||'')+'">'+esc(k[1])+'</div><div class="l">'+esc(k[0])+' · '+esc(k[2])+'</div></div>').join('');
  $('sessions').innerHTML='<table><tr><th>เครื่อง</th><th>ชื่อ (ใส่เอง)</th><th>บทบาท</th><th>มือถือ</th><th>หน้าจอ</th><th>ทำล่าสุด</th><th>ล่าสุด</th><th class="n">คำขอ</th><th class="n">พัง</th><th class="n">p50</th><th>งานที่ผ่าน</th></tr>'+
    d.sessions.map(x=>'<tr class="'+(x.agoSec>300?'idle':'')+'"><td><span class="dot" style="background:'+(x.agoSec<=60?'#1f8a4c':x.agoSec<=300?'#d69e2e':'#cbd5e0')+'"></span>'+esc(String(x.sid).slice(-4))+'</td>'+
      '<td><input class="lbl" value="'+esc(LBL[x.sid]||'')+'" onchange="setLbl(\''+esc(x.sid)+'\',this.value)"></td><td>'+esc(x.role)+'</td><td>'+esc([x.dev,x.os,x.net].filter(Boolean).join(' '))+'</td>'+
      '<td>'+esc(x.screen)+'</td><td>'+esc(x.action)+'</td><td>'+(x.agoSec<60?x.agoSec+' วิ':Math.round(x.agoSec/60)+' นาที')+'</td><td class="n">'+x.n+'</td><td class="n '+(x.fail?'bad':'')+'">'+x.fail+'</td><td class="n '+tone(x.p50)+'">'+ms(x.p50)+'</td><td><b>'+x.done.length+'/'+x.mine+'</b> <span class="mut small">'+esc(x.done.map(i=>d.tasks[i].label).join(' · '))+'</span></td></tr>').join('')+'</table>';
  let g='';$('tasks').innerHTML='<table>'+d.tasks.map(t=>{
    const pass=t.expectRefusal?t.refused>0:t.ok>0;const icon=pass?'✅':t.fail?'🔴':(t.expectRefusal&&t.ok)?'🟡':(!t.expectRefusal&&t.refused)?'🟡':'⬜';
    const G=d.summary.groups.find(x=>x.g===t.g);const head=t.g!==g?'<tr><th colspan="3">'+esc(t.g)+' <span class="mut">'+G.pass+'/'+G.total+' · '+Math.round(100*G.pass/G.total)+'%</span></th></tr>':'';g=t.g;
    const who=t.who.map(k=>LBL[k]||String(k).slice(-4)).join(', ');
    const det=[t.ok?'สำเร็จ '+t.ok:'',t.refused?'ถูกปฏิเสธ '+t.refused:'',t.fail?'พัง '+t.fail:''].filter(Boolean).join(' · ');
    return head+'<tr><td>'+icon+'</td><td>'+esc(t.label)+(t.expectRefusal?' <span class="pill">ต้องถูกปฏิเสธ</span>':'')+'</td><td class="mut">'+esc(det)+(t.last?' · '+esc(t.last.slice(11)):'')+(who?' · โดย '+esc(who):'')+'</td></tr>';}).join('')+'</table>';
  $('errors').innerHTML=d.errors.length?'<table><tr><th>อะไร</th><th class="n">ครั้ง</th><th class="n">เครื่อง</th><th>ล่าสุด</th></tr>'+d.errors.map(e=>'<tr><td class="'+(e.business?'warn':'bad')+'">'+esc(e.k)+(e.business?' <span class="pill">ปฏิเสธตามกฎ</span>':'')+'</td><td class="n">'+e.n+'</td><td class="n">'+e.people+'</td><td>'+esc(String(e.last).slice(11))+'</td></tr>').join('')+'</table>':'<span class="ok">ยังไม่มี</span>';
  $('feed').innerHTML='<table>'+d.feed.map(f=>'<tr><td class="mut">'+esc(f.t)+'</td><td>'+esc(f.sid)+'</td><td>'+esc(LBL[Object.keys(LBL).find(k=>k.slice(-4)===f.sid)]||f.role)+'</td><td>'+esc(f.type)+'</td><td>'+esc(f.action||f.screen)+'</td><td class="'+(f.path.startsWith('รายชื่อเร็ว')?'fast':'mut')+'">'+esc(f.path)+'</td><td class="n '+tone(f.ms)+'">'+ms(f.ms)+'</td><td class="'+(f.ok?'ok':'bad')+'">'+(f.type==='api'?(f.ok?'✓':'✗ '+esc(f.code)):'')+'</td></tr>').join('')+'</table>';
  $('actions').innerHTML='<table><tr><th>คำสั่ง</th><th title="อยู่ในรายชื่อเส้นเร็วหรือไม่ — ไม่ใช่ทางที่วิ่งจริง: ทั้งชุดคำขอต้องอยู่ในรายชื่อจึงจะไปเส้นเร็ว">รายชื่อ</th><th>บทบาท</th><th class="n">ครั้ง</th><th class="n">เครื่อง</th><th class="n">p50</th><th class="n">p95</th><th class="n">ช้าสุด</th><th class="n">รอบก่อน p50</th><th class="n">ต่าง</th><th class="n">ล้มเหลว</th><th>รหัส</th></tr>'+
    d.actions.map(a=>{const b=a.base;const diff=b&&a.p50!=null?Math.round(100*(a.p50-b.p50)/Math.max(1,b.p50)):null;
      return '<tr><td>'+esc(a.a)+'</td><td class="'+(a.path.startsWith('รายชื่อเร็ว')?'fast':'mut')+'">'+esc(a.path)+'</td><td>'+esc(a.roles)+'</td><td class="n">'+a.n+'</td><td class="n">'+a.people+'</td><td class="n '+tone(a.p50)+'">'+ms(a.p50)+'</td><td class="n '+tone(a.p95)+'">'+ms(a.p95)+'</td><td class="n">'+ms(a.max)+'</td><td class="n mut">'+(b?ms(b.p50):'–')+'</td><td class="n '+(diff==null?'':diff>20?'bad':diff<-20?'ok':'mut')+'">'+(diff==null?'':(diff>0?'+':'')+diff+'%')+'</td><td class="n '+(a.sys?'bad':a.fail?'warn':'')+'">'+(a.fail||'')+'</td><td class="mut">'+esc(a.codes)+'</td></tr>';}).join('')+'</table>'+
    (d.baseName?'<div class="mut">รอบก่อน = '+esc(d.baseName)+'</div>':'');
  $('screens').innerHTML='<table><tr><th>หน้าจอ</th><th class="n">ครั้ง</th><th class="n">p50</th><th class="n">p95</th></tr>'+d.screens.map(x=>'<tr><td>'+esc(x.k)+'</td><td class="n">'+x.n+'</td><td class="n '+tone(x.p50)+'">'+ms(x.p50)+'</td><td class="n '+tone(x.p95)+'">'+ms(x.p95)+'</td></tr>').join('')+'</table>';
}
load();setInterval(()=>{if(!document.hidden)load();},10000);
</script></body></html>`;

server.listen(PORT, '127.0.0.1', () => console.log('UAT live → http://127.0.0.1:' + PORT + '  (ฐาน: ' + DB + ' · อ่านอย่างเดียว)'));
const stop = () => { server.close(); closePool().finally(() => process.exit(0)); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
