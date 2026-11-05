/**
 * tools/test_fast_forward.js — the app takes the fast host's "not mine" and asks Apps Script itself
 *   node tools/test_fast_forward.js
 *
 * 2026-11-05. server/host.js answers NOT_ON_FAST_HOST for the 180 Code.gs ROUTES (and a write with an
 * image), and READ_ONLY_HOST for a write it has not been proven on — in both cases having run NOTHING
 * (before the handler, or after a rollback). Until the app forwards those to Apps Script, switching on
 * FAST_URL would break every screen that asks for one of them. This drives the REAL webapp/api.js in a
 * vm with a fake host and a fake Apps Script and checks:
 *
 *   1  FAST_URL empty and no pilot: not one request reaches the fast host (today, for everybody)
 *   2  the per-device pilot accepts ONLY our own service's URL — a token cannot be sent elsewhere
 *   3  a single "not mine" → asked again on Apps Script, the screen gets Apps Script's answer
 *   4  a batch with some calls "not mine" → ONLY those go to Apps Script, answers land in place
 *   5  host unreachable: a read falls back to GAS and the host is rested 5 minutes;
 *      🔴 a WRITE is NOT re-sent (it may have been saved) and the person is told to check first
 *   6  a write refused READ_ONLY_HOST (nothing saved) → sent to GAS exactly once
 *   7  🔴 a batch where the host already SAVED a write: that write is never sent again
 *   8  BUSY / WRITE_GUARD are not forwarded — GAS shares the lock and the rule, it would say the same
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0;
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  console.log((okk ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (okk ? '' : ' want=' + JSON.stringify(want)));
  okk ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const src0 = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'api.js'), 'utf8');
/* the test may add a WRITE to the declared list (none is there today) — the rest of the file is untouched */
const src = src0.replace('const FAST_ACTIONS = {', 'const FAST_ACTIONS = window.__FA = {');
const HOST = 'https://atom-fast-120486339414.asia-southeast1.run.app/';
const GAS = 'https://example.test/exec';

/* host(body) → reply object, or 'down' to make the request fail at the network */
function boot(opts) {
  opts = opts || {};
  const sent = { host: [], gas: [] }, store = {};
  const mkStore = () => ({ getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }, key: i => Object.keys(store)[i], get length() { return Object.keys(store).length; } });
  const ctx = {
    console, setTimeout, clearTimeout, clearInterval, Promise, JSON, Math, Date, Object, Array, String, Number, isFinite,
    setInterval: () => 0, Blob: function () {},
    localStorage: mkStore(), sessionStorage: mkStore(),
    navigator: { userAgent: 'Mozilla/5.0 (iPhone)', connection: { effectiveType: '4g' }, sendBeacon: null, maxTouchPoints: 5 },
    performance: { getEntriesByType: () => [] },
    document: { addEventListener: () => {}, hidden: false, currentScript: null }
  };
  ctx.window = ctx; ctx.matchMedia = () => ({ matches: false }); ctx.addEventListener = () => {};
  const one = (who, a) => ({ ok: true, data: { from: who, a: a } });
  const gasReply = body => body.action === 'batch'
    ? { ok: true, a: 'batch', data: (body.payload.calls || []).map(c => (opts.gasCall ? opts.gasCall(c) : one('gas', c.action))) }
    : Object.assign({ a: body.action }, one('gas', body.action));
  ctx.fetch = (url, init) => {
    const body = JSON.parse(init.body);
    if (body.action === 'perfLog') return Promise.resolve({ status: 200, text: () => Promise.resolve('{"ok":true}') });
    if (url === GAS) { sent.gas.push(body); return Promise.resolve({ status: 200, url, text: () => Promise.resolve(JSON.stringify(gasReply(body))) }); }
    sent.host.push({ url, body });
    const r = opts.host ? opts.host(body) : null;
    if (r === 'down') return Promise.reject(new TypeError('Load failed'));
    const rep = r || (body.action === 'batch'
      ? { ok: true, a: 'batch', data: body.payload.calls.map(c => one('host', c.action)) }
      : Object.assign({ a: body.action }, one('host', body.action)));
    return Promise.resolve({ status: 200, url, text: () => Promise.resolve(JSON.stringify(Object.assign({ a: body.action }, rep))) });
  };
  if (opts.pilot !== undefined) store.atom_fast_pilot = opts.pilot;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  ctx.CONFIG.MODE = 'gas'; ctx.CONFIG.GAS_URL = GAS;
  (opts.addFast || []).forEach(a => { ctx.__FA[a] = 1; });
  return { ctx, sent, api: (a, p) => ctx.api(a, p || {}) };
}
const settle = () => new Promise(r => setTimeout(r, 30));
const NOT_MINE = { ok: false, error: { code: 'NOT_ON_FAST_HOST', message: 'action นี้ยังต้องทำงานบน Apps Script' } };

(async () => {

console.log('\n1) วันนี้: FAST_URL ว่าง ไม่มี pilot → ไม่มีคำขอไปโฮสต์ใหม่เลย');
{
  const t = boot();
  await Promise.all([t.api('classList'), t.api('payments')]); await t.api('staffSelf');
  eq('คำขอถึงโฮสต์ใหม่', t.sent.host.length, 0);
  ok_('ทุกคำขอไป Apps Script', t.sent.gas.length >= 2);
  ok_('🔴 FAST_URL ใน api.js ยังว่าง', /FAST_URL: ''/.test(src0));
}

console.log('\n2) pilot ทีละเครื่อง — รับเฉพาะ URL ของบริการเรา');
{
  const evil = boot({ pilot: 'https://evil.example.com/' });
  await evil.api('classList');
  eq('🔴 URL อื่น → ไม่ส่ง token ไปที่นั่น', evil.sent.host.length, 0);
  const lookalike = boot({ pilot: 'https://atom-fast-120486339414.asia-southeast1.run.app.evil.com/' });
  await lookalike.api('classList');
  eq('🔴 URL หน้าตาคล้าย → ไม่ส่ง', lookalike.sent.host.length, 0);
  const t = boot({ pilot: HOST });
  const d = await t.api('classList');
  eq('URL ของเรา → classList ไปโฮสต์ใหม่', [t.sent.host.length, d && d.from], [1, 'host']);
  await t.api('uploadSlip', { x: 1 });
  eq('action ที่ไม่ได้ประกาศ → Apps Script', t.sent.gas.map(b => b.action), ['uploadSlip']);
}

console.log('\n3) คำขอเดี่ยวที่โฮสต์ตอบ "ไม่ใช่ของฉัน" → ถาม Apps Script ให้เอง');
{
  const t = boot({ pilot: HOST, host: b => b.action === 'notifications' ? NOT_MINE : null });
  const d = await t.api('notifications');
  eq('หน้าจอได้คำตอบจาก Apps Script', d && d.from, 'gas');
  eq('ถามโฮสต์ 1 ครั้ง · Apps Script 1 ครั้ง', [t.sent.host.length, t.sent.gas.length], [1, 1]);
  for (const code of ['UNKNOWN_ACTION', 'NO_SESSION']) {
    const u = boot({ pilot: HOST, host: () => ({ ok: false, error: { code, message: '-' } }) });
    const r = await u.api('classList');
    eq(code + ' → Apps Script ตัดสินแทน', r && r.from, 'gas');
  }
}

console.log('\n4) batch: ส่งต่อเฉพาะ call ที่โฮสต์ไม่ได้ทำ แล้ววางคำตอบกลับที่เดิม');
{
  const t = boot({ pilot: HOST, host: b => b.action === 'batch'
    ? { ok: true, data: b.payload.calls.map(c => c.action === 'notifications' ? NOT_MINE : { ok: true, data: { from: 'host', a: c.action } }) }
    : null });
  const got = await Promise.all([t.api('staffSelf'), t.api('notifications'), t.api('classList')]);
  eq('คำตอบอยู่ตำแหน่งเดิม', got.map(x => x && x.from + ':' + x.a), ['host:staffSelf', 'gas:notifications', 'host:classList']);
  eq('Apps Script ได้เฉพาะ call ที่ขาด', t.sent.gas.map(b => b.action + ':' + (b.payload.calls || []).map(c => c.action).join(',')), ['batch:notifications']);
  eq('ไม่มีการถามโฮสต์ซ้ำ', t.sent.host.length, 1);
}
{
  const t = boot({ pilot: HOST, host: b => b.action === 'batch' ? { ok: true, data: b.payload.calls.map(() => NOT_MINE) } : null,
    gasCall: c => c.action === 'notifications' ? { ok: false, error: { code: 'FORBIDDEN', message: 'no' } } : { ok: true, data: { from: 'gas', a: c.action } } });
  const r = await Promise.allSettled([t.api('notifications'), t.api('classList')]);
  eq('คำตอบ/ข้อผิดพลาดของ Apps Script ส่งถึงหน้าจอตามจริง', r.map(x => x.status === 'fulfilled' ? x.value.from : (x.reason && x.reason.code)), ['FORBIDDEN', 'gas']);
}

console.log('\n5) โฮสต์ติดต่อไม่ได้');
{
  const t = boot({ pilot: HOST, host: () => 'down' });
  const d = await t.api('classList');
  eq('การอ่าน → Apps Script ตอบแทน', d && d.from, 'gas');
  await t.api('payments'); await t.api('holidays');
  eq('พักเส้นเร็ว 5 นาที: คำขอถัดไปไป Apps Script ตรง ๆ', [t.sent.host.length, t.sent.gas.length], [1, 3]);
}
{
  const t = boot({ pilot: HOST, host: () => 'down', addFast: ['addComment'] });
  let err = null;
  await t.api('addComment', { text: 'x' }).catch(e => { err = e; });
  eq('🔴 การเขียน → ไม่ส่งซ้ำไป Apps Script', t.sent.gas.length, 0);
  ok_('...และบอกให้ตรวจก่อนทำซ้ำ เพราะอาจบันทึกไปแล้ว', !!err && /อาจบันทึกไปแล้ว/.test(err.message));
}

console.log('\n6) การเขียนที่โฮสต์ยังบันทึกไม่ได้ (ไม่มีอะไรถูกบันทึก) → Apps Script ครั้งเดียว');
{
  const t = boot({ pilot: HOST, addFast: ['addStudentCharge'],
    host: () => ({ ok: false, error: { code: 'READ_ONLY_HOST', message: 'เส้นทางนี้ยังบันทึกข้อมูลนี้ไม่ได้ — ไม่มีอะไรถูกบันทึก' } }) });
  const d = await t.api('addStudentCharge', { studentId: 'S1', amount: 350 });
  eq('บันทึกที่ Apps Script', d && d.from, 'gas');
  eq('🔴 ส่งไป Apps Script ครั้งเดียว', t.sent.gas.filter(b => b.action === 'addStudentCharge').length, 1);
}

console.log('\n7) 🔴 batch ที่โฮสต์บันทึกไปแล้ว — การเขียนนั้นต้องไม่เกิดซ้ำ');
{
  const t = boot({ pilot: HOST, addFast: ['addComment'], host: b => b.action === 'batch'
    ? { ok: true, data: b.payload.calls.map(c => c.action === 'notifications' ? NOT_MINE : { ok: true, data: { from: 'host', a: c.action } }) } : null });
  const got = await Promise.all([t.api('addComment', { text: 'hi' }), t.api('notifications')]);
  eq('ได้คำตอบครบ', got.map(x => x && x.from), ['host', 'gas']);
  const gasActions = [].concat(...t.sent.gas.map(b => b.action === 'batch' ? b.payload.calls.map(c => c.action) : [b.action]));
  eq('🔴 addComment ไม่ถูกส่งไป Apps Script', gasActions.indexOf('addComment'), -1);
}
{
  // the forwarded part holds a write and the host saved nothing: the whole batch goes, keeping write-then-read order
  const t = boot({ pilot: HOST, addFast: ['addStudentCharge'], host: b => b.action === 'batch'
    ? { ok: true, data: b.payload.calls.map(c => c.action === 'addStudentCharge' ? NOT_MINE : { ok: true, data: { from: 'host', a: c.action } }) } : null });
  const got = await Promise.all([t.api('addStudentCharge', { studentId: 'S1', amount: 1 }), t.api('studentCharges', { studentId: 'S1' })]);
  eq('เขียน+อ่านไปด้วยกันที่ Apps Script', got.map(x => x && x.from), ['gas', 'gas']);
  eq('...ส่งครั้งเดียว ทั้ง batch', t.sent.gas.map(b => (b.payload.calls || []).map(c => c.action).join(',')), ['addStudentCharge,studentCharges']);
}

console.log('\n8) ไม่ส่งต่อคำตอบที่ Apps Script จะตอบเหมือนกัน');
for (const code of ['BUSY', 'WRITE_GUARD', 'READ_ONLY']) {
  const t = boot({ pilot: HOST, addFast: ['addComment'], host: () => ({ ok: false, error: { code, message: '-' } }) });
  let err = null;
  await t.api('addComment', { text: 'x' }).catch(e => { err = e; });
  eq(code + ' → ถึงหน้าจอ ไม่ส่งไป Apps Script', [err && err.code, t.sent.gas.length], [code, 0]);
}

await settle();
console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
