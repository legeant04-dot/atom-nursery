/**
 * tools/test_fast_writes_web.js — the app sends the day's WRITES (W1–W3) to the fast host only in the UAT /
 * move-night build, and never anything to do with money
 *   node tools/test_fast_writes_web.js
 *
 * 2026-11-14. webapp/api.js gained FAST_WRITES, switched on by CONFIG.FAST_WRITES === true AND a FAST_URL in
 * the shipped build (tools/build_web.js --uat). Drives the REAL api.js in a vm with a fake host + fake GAS:
 *
 *   1  today's build (FAST_URL '' · no FAST_WRITES): a pilot device still sends READS only — never a write
 *   2  FAST_URL set but FAST_WRITES absent: writes go to Apps Script (switching reads ≠ switching writes)
 *   3  🔴 pilot + FAST_WRITES but no FAST_URL: writes still go to Apps Script (pilot points at staging)
 *   4  UAT build: every listed write goes to the host; money and admin-W4 writes go to Apps Script
 *   5  a write the host refuses before saving (NOT_ON_FAST_HOST — an image) → Apps Script, exactly once
 *   6  🔴 host down: a listed write is NOT re-sent to Apps Script (it may have been saved) — except the
 *      punches the server itself refuses twice (IDEMPOTENT_WRITE)
 *   7  the list is what the host can do: each is a ported route or a proven engine write, none is money
 *      (MONEY_PROVEN, Code.gs PIN_MONEY_ACTIONS_), none moved to W4
 *   8  batch: a write + reads go together to the host when on, together to Apps Script when off
 *   9  build_web --uat writes the switches into the OUTPUT only; the normal build and webapp/ are unchanged
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  console.log((okk ? '  ok   ' : '  FAIL ') + label + (okk ? '' : '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
  okk ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const API = fs.readFileSync(path.join(ROOT, 'webapp', 'api.js'), 'utf8');
const HOST = 'https://atom-fast-120486339414.asia-southeast1.run.app/';
const UATHOST = 'https://atom-uat-1.asia-southeast1.run.app';
const GAS = 'https://example.test/exec';
const names = (src, decl) => {
  const i = src.indexOf(decl); if (i < 0) return [];
  const body = src.slice(i, src.indexOf('};', i));
  return [...body.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').matchAll(/([a-zA-Z][a-zA-Z0-9]*): 1/g)].map(m => m[1]);
};
const FW = names(API, 'const FAST_WRITES = {');
const FA = names(API, 'const FAST_ACTIONS = {');

function boot(opts) {
  opts = opts || {};
  const sent = { host: [], gas: [] }, store = {};
  const mkStore = () => ({ getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }, key: i => Object.keys(store)[i], get length() { return Object.keys(store).length; } });
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, clearInterval, Promise, JSON, Math, Date, Object, Array, String, Number, isFinite,
    setInterval: () => 0, Blob: function () {},
    localStorage: mkStore(), sessionStorage: mkStore(),
    navigator: { userAgent: 'Mozilla/5.0 (iPhone)', connection: { effectiveType: '4g' }, sendBeacon: null, maxTouchPoints: 5 },
    performance: { getEntriesByType: () => [] },
    document: { addEventListener: () => {}, hidden: false, currentScript: null }
  };
  ctx.window = ctx; ctx.matchMedia = () => ({ matches: false }); ctx.addEventListener = () => {};
  const one = (who, a) => ({ ok: true, data: { from: who, a: a } });
  ctx.fetch = (url, init) => {
    const body = JSON.parse(init.body);
    if (body.action === 'perfLog') return Promise.resolve({ status: 200, text: () => Promise.resolve('{"ok":true}') });
    if (url === GAS) {
      sent.gas.push(body);
      const rep = body.action === 'batch'
        ? { ok: true, a: 'batch', data: (body.payload.calls || []).map(c => one('gas', c.action)) }
        : Object.assign({ a: body.action }, one('gas', body.action));
      return Promise.resolve({ status: 200, url, text: () => Promise.resolve(JSON.stringify(rep)) });
    }
    sent.host.push({ url, body });
    const r = opts.host ? opts.host(body) : null;
    if (r === 'down') return Promise.reject(new TypeError('Load failed'));
    const rep = r || (body.action === 'batch'
      ? { ok: true, data: body.payload.calls.map(c => one('host', c.action)) }
      : one('host', body.action));
    return Promise.resolve({ status: 200, url, text: () => Promise.resolve(JSON.stringify(Object.assign({ a: body.action }, rep))) });
  };
  if (opts.pilot) store.atom_fast_pilot = opts.pilot;
  vm.createContext(ctx);
  vm.runInContext(API, ctx);
  ctx.CONFIG.MODE = 'gas'; ctx.CONFIG.GAS_URL = GAS;
  if (opts.fastUrl) ctx.CONFIG.FAST_URL = opts.fastUrl;
  if (opts.writes !== undefined) ctx.CONFIG.FAST_WRITES = opts.writes;
  return { sent, api: (a, p) => ctx.api(a, p || {}) };
}
const settle = () => new Promise(r => setTimeout(r, 30));
const MONEY_AND_W4 = ['confirmSlip', 'recordCashPayment', 'payCombinedCash', 'confirmOT', 'adminAddOT', 'computePayroll',
  'issueBill', 'prepay', 'cancelLeave', 'confirmTimeRequest', 'editStaffAttendance', 'holidayAttendSet', 'uploadSlip', 'deleteBill'];

(async () => {
console.log('\nรายการ: FAST_WRITES ' + FW.length + ' ตัว · FAST_ACTIONS (อ่าน) ' + FA.length + ' ตัว');
ok_('มีรายการจริง (≥ 40)', FW.length >= 40);
eq('ไม่มีชื่อซ้ำ', FW.length, new Set(FW).size);
eq('ไม่ซ้ำกับรายการอ่าน', FW.filter(a => FA.includes(a)), []);

console.log('\n1) รุ่นที่ใช้วันนี้ + เครื่อง pilot → อ่านไปโฮสต์ · เขียนไม่ไปเลย');
{
  ok_('🔴 api.js: FAST_URL ว่าง · ไม่มี FAST_WRITES: true', /FAST_URL: ''/.test(API) && !/FAST_WRITES:\s*true/.test(API));
  const t = boot({ pilot: HOST });
  await t.api('classList');
  for (const a of ['staffCheckin', 'parentCheckin', 'submitLeave', 'studentAbsence']) await t.api(a, { x: 1 });
  eq('อ่าน → โฮสต์', t.sent.host.map(x => x.body.action), ['classList']);
  eq('เขียน → Apps Script ทั้งหมด', t.sent.gas.map(b => b.action), ['staffCheckin', 'parentCheckin', 'submitLeave', 'studentAbsence']);
}

console.log('\n2) FAST_URL ตั้ง แต่ไม่มี FAST_WRITES → เขียนไป Apps Script');
{
  const t = boot({ fastUrl: UATHOST });
  await t.api('staffCheckin', { x: 1 });
  eq('staffCheckin → Apps Script', [t.sent.host.length, t.sent.gas.map(b => b.action)], [0, ['staffCheckin']]);
  const u = boot({ fastUrl: UATHOST, writes: 'true' });
  await u.api('staffCheckin', { x: 1 });
  eq("FAST_WRITES: 'true' (สตริง) ไม่นับ — ต้องเป็น true จริง", u.sent.host.length, 0);
}

console.log('\n3) 🔴 pilot + FAST_WRITES แต่ไม่มี FAST_URL → เขียนไป Apps Script');
{
  const t = boot({ pilot: HOST, writes: true });
  await t.api('staffCheckin', { x: 1 }); await t.api('classList');
  eq('เขียน → Apps Script · อ่าน → โฮสต์', [t.sent.gas.map(b => b.action), t.sent.host.map(x => x.body.action)], [['staffCheckin'], ['classList']]);
}

console.log('\n4) รุ่น UAT: งานประจำวันไปโฮสต์ · เงิน/งานแอดมิน W4 ไป Apps Script');
{
  const t = boot({ fastUrl: UATHOST, writes: true });
  for (const a of FW) await t.api(a, { x: 1 });
  eq('ทุกตัวใน FAST_WRITES → โฮสต์ (' + FW.length + ')', t.sent.host.map(x => x.body.action), FW);
  eq('ไม่มีตัวไหนไป Apps Script', t.sent.gas.map(b => b.action), []);
  ok_('ไป URL ของ UAT', t.sent.host.every(x => x.url === UATHOST));
  const m = boot({ fastUrl: UATHOST, writes: true });
  for (const a of MONEY_AND_W4) await m.api(a, { x: 1 });
  eq('🔴 เงิน + W4 → Apps Script ทั้งหมด', [m.sent.host.length, m.sent.gas.map(b => b.action)], [0, MONEY_AND_W4]);
}

console.log('\n5) โฮสต์ปฏิเสธก่อนบันทึก (มีรูป) → Apps Script ครั้งเดียว');
{
  const t = boot({ fastUrl: UATHOST, writes: true, host: () => ({ ok: false, error: { code: 'NOT_ON_FAST_HOST', message: 'image' } }) });
  const d = await t.api('submitInjury', { photos: ['data:image/png;base64,x'] });
  eq('คำตอบมาจาก Apps Script · ส่งครั้งเดียว', [d && d.from, t.sent.host.length, t.sent.gas.length], ['gas', 1, 1]);
}

console.log('\n6) 🔴 โฮสต์ล่ม: การเขียนไม่ถูกส่งซ้ำไป Apps Script (ยกเว้นตัวที่ server กันซ้ำเอง)');
{
  const IDEM = /^(staffCheckin|staffCheckout|staffStudentCheckin|parentCheckin|submitJournal|studentAbsence|submitAssessment)$/;
  ok_('IDEMPOTENT_WRITE ในแอปตรงกับที่ชุดทดสอบใช้', API.indexOf("const IDEMPOTENT_WRITE = /^(staffCheckin|staffCheckout|staffStudentCheckin|parentCheckin|submitJournal|studentAbsence|submitAssessment)$/;") >= 0);
  const resent = [], notTold = [];
  for (const a of FW) {
    const t = boot({ fastUrl: UATHOST, writes: true, host: () => 'down' });
    let threw = null; try { await t.api(a, { x: 1 }); } catch (e) { threw = e; }
    await settle();
    if (IDEM.test(a)) continue;
    if (t.sent.gas.length) resent.push(a);
    if (!threw || !/OFFLINE|TIMEOUT/.test(String(threw.code))) notTold.push(a);
  }
  eq('ไม่มีการเขียนตัวไหนถูกส่งซ้ำไป Apps Script', resent, []);
  eq('ทุกตัวบอกผู้ใช้ให้ตรวจก่อนทำซ้ำ (OFFLINE)', notTold, []);
  const p = boot({ fastUrl: UATHOST, writes: true, host: () => 'down' });
  const d = await p.api('staffCheckin', { x: 1 });
  eq('ลงเวลา (server กันซ้ำเอง) → Apps Script ตอบแทน', d && d.from, 'gas');
}

console.log('\n7) รายการตรงกับที่โฮสต์ทำได้ · ไม่มีเงิน');
{
  const R = require(path.join(ROOT, 'server', 'routes.js'));
  const { WRITE_PROVEN, MONEY } = require(path.join(ROOT, 'server', 'write_proven.js'));
  ok_('อ่านรายชื่อ route ของโฮสต์ได้ (' + Object.keys(R.PORTED).length + ')', Object.keys(R.PORTED).length > 80);
  /* a ported route that DECLARES a write (routes.writes) — or an engine write proven by the live suite */
  eq('ทุกตัวเป็น route เขียนของโฮสต์ หรือการเขียนของเอนจินที่พิสูจน์แล้ว', FW.filter(a => !(R.has(a) && R.writes(a)) && !WRITE_PROVEN[a]), []);
  eq('🔴 ไม่มีตัวไหนอยู่ใน MONEY_PROVEN', FW.filter(a => MONEY.includes(a)), []);
  const code = fs.readFileSync(path.join(ROOT, 'src', 'Code.gs'), 'utf8');
  const pinBody = code.slice(code.indexOf('var PIN_MONEY_ACTIONS_ = {'), code.indexOf('};', code.indexOf('var PIN_MONEY_ACTIONS_ = {')));
  const pin = [...pinBody.replace(/\/\/[^\n]*/g, '').matchAll(/([a-zA-Z][a-zA-Z0-9]*): 1/g)].map(m => m[1]);
  ok_('อ่านรายการ PIN เงินได้ (' + pin.length + ')', pin.length > 30);
  eq('🔴 ไม่มีตัวไหนอยู่ในรายการ PIN เงินของแอดมิน', FW.filter(a => pin.includes(a)), []);
  eq('🔴 งานแอดมินที่ ผอ. ย้ายไป W4 ไม่อยู่ในรายการ', FW.filter(a => ['cancelLeave', 'confirmTimeRequest', 'holidayAttendSet', 'editStaffAttendance',
    'adminAddOT', 'adminAddHolidayOT', 'adminEditOT', 'adminDeleteOT', 'adminUpdateOT', 'adminCancelOT', 'adminRestoreOT', 'confirmOT'].includes(a)), []);
}

console.log('\n8) batch ไปทางเดียวทั้งก้อน');
{
  const on = boot({ fastUrl: UATHOST, writes: true });
  await Promise.all([on.api('staffCheckin', { x: 1 }), on.api('classList')]);
  eq('เปิด: เขียน + อ่าน → โฮสต์ทั้งก้อน', [on.sent.host.length, on.sent.gas.length], [1, 0]);
  const off = boot({ fastUrl: UATHOST });
  await Promise.all([off.api('staffCheckin', { x: 1 }), off.api('classList')]);
  eq('ปิด: เขียน + อ่าน → Apps Script ทั้งก้อน', [off.sent.host.length, off.sent.gas.length], [0, 1]);
}

console.log('\n9) build_web --uat: สวิตช์อยู่ในผลลัพธ์เท่านั้น');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atom-uat-'));
  const run = args => cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build_web.js')].concat(args), { encoding: 'utf8' });
  const uatGas = 'https://script.google.com/macros/s/AKfycbUATuatUATuat0123456789/exec';
  const r = run(['--uat', '--fast', UATHOST, '--gas', uatGas, path.join(tmp, 'u')]);
  eq('สร้างรุ่น UAT สำเร็จ', r.status, 0);
  const ua = fs.readFileSync(path.join(tmp, 'u', 'api.js'), 'utf8');
  ok_('ผลลัพธ์: FAST_WRITES เปิด · FAST_URL/GAS_URL ของ UAT', /FAST_WRITES:!0/.test(ua) && ua.includes('FAST_URL:"' + UATHOST + '"') && ua.includes('GAS_URL:"' + uatGas + '"'));
  ok_('แคช service worker แยกจากของจริง', /atom-uat-v\d+/.test(fs.readFileSync(path.join(tmp, 'u', 'sw.js'), 'utf8')));
  ok_('มีป้าย UAT บนหน้าจอ', fs.readFileSync(path.join(tmp, 'u', 'index.html'), 'utf8').includes('UAT · ข้อมูลทดสอบ'));
  const n = run([path.join(tmp, 'n')]);
  const na = fs.readFileSync(path.join(tmp, 'n', 'api.js'), 'utf8');
  ok_('รุ่นปกติ: ไม่มี FAST_WRITES · FAST_URL ว่าง', n.status === 0 && !/FAST_WRITES:!0/.test(na) && /FAST_URL:""/.test(na));
  eq('webapp/api.js ไม่ถูกแก้', fs.readFileSync(path.join(ROOT, 'webapp', 'api.js'), 'utf8'), API);
  const live = /GAS_URL: '([^']*)'/.exec(API)[1];
  eq('🔴 ปฏิเสธ Apps Script ตัวจริง', run(['--uat', '--fast', UATHOST, '--gas', live, path.join(tmp, 'x')]).status, 1);
  eq('🔴 ปฏิเสธ URL ที่ไม่ใช่ Cloud Run', run(['--uat', '--fast', 'https://evil.example.com', '--gas', uatGas, path.join(tmp, 'y')]).status, 1);
  eq('🔴 ปฏิเสธ URL หน้าตาคล้าย', run(['--uat', '--fast', 'https://x.run.app.evil.com', '--gas', uatGas, path.join(tmp, 'z')]).status, 1);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\n' + (fail ? '❌' : '✅') + ' test_fast_writes_web: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
