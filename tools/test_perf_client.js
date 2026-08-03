/**
 * tools/test_perf_client.js — the browser half of Phase 0 telemetry.
 *   node tools/test_perf_client.js
 *
 * Loads webapp/api.js in a vm with a stubbed browser and a fake network, then checks the two things
 * that matter: (a) it records what we need, and (b) it can NEVER break or slow the real app —
 * no extra round trips, no interference with the read cache, and a dead telemetry endpoint is
 * invisible to callers.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const wait = ms => new Promise(r => setTimeout(r, ms));

function boot(opts) {
  opts = opts || {};
  const sent = [];               // every request that reached the "network"
  const listeners = {};
  const store = {};
  const mkStore = () => ({
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    key: i => Object.keys(store)[i],
    get length() { return Object.keys(store).length; }
  });
  const ctx = {
    console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval, Promise, JSON, Math, Date, Object, Array, String, Number, isFinite, Blob: function (a, b) { this.parts = a; this.type = b && b.type; },
    localStorage: mkStore(), sessionStorage: mkStore(),
    navigator: { userAgent: opts.ua || 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', connection: { effectiveType: '4g' }, sendBeacon: null, maxTouchPoints: 5 },
    performance: { getEntriesByType: () => [] },
    document: { addEventListener: (n, f) => { (listeners[n] = listeners[n] || []).push(f); }, hidden: false, currentScript: null },
    __sent: sent,
    __fire: (n) => (listeners[n] || []).forEach(f => f({}))
  };
  ctx.window = ctx;
  ctx.matchMedia = () => ({ matches: false });
  ctx.addEventListener = ctx.document.addEventListener;
  ctx.fetch = (url, init) => {
    const body = JSON.parse(init.body);
    sent.push(body);
    if (body.action === 'perfLog' && opts.perfDown) return Promise.reject(new Error('telemetry endpoint down'));
    // default: behave like a healthy server — a batch answers ONE entry per call, in order
    const okReply = b => (b.action === 'batch'
      ? { ok: true, data: (b.payload.calls || []).map(c => ({ ok: true, data: { from: c.action } })) }
      : { ok: true, data: { from: b.action } });
    const reply = opts.reply ? opts.reply(body, okReply) : okReply(body);
    return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(reply)) });
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'webapp', 'api.js'), 'utf8'), ctx);
  ctx.CONFIG.MODE = 'gas';
  ctx.CONFIG.GAS_URL = 'https://example.test/exec';
  return ctx;
}
const perfCalls = ctx => ctx.__sent.filter(b => b.action === 'perfLog');
const realCalls = ctx => ctx.__sent.filter(b => b.action !== 'perfLog');

(async function () {
  console.log('\n1) Telemetry adds NO round trips to real work');
  {
    const c = boot();
    await Promise.all([c.api('dashboard'), c.api('financeSummary')]);
    await wait(30);
    eq('two reads still cost exactly one request', realCalls(c).length, 1);
    eq('...and it is still a batch', realCalls(c)[0].action, 'batch');
    eq('telemetry sent nothing yet (it is buffered)', perfCalls(c).length, 0);
  }

  console.log('\n2) It records latency, action names and the batch size');
  {
    const c = boot();
    await Promise.all([c.api('dashboard'), c.api('financeSummary')]);
    await wait(30);
    c.__fire('visibilitychange');            // document.hidden is false -> should NOT flush
    eq('a visible page does not flush', perfCalls(c).length, 0);
    c.document.hidden = true; c.__fire('visibilitychange');
    await wait(20);
    eq('hiding the app flushes what it has', perfCalls(c).length, 1);
    const p = perfCalls(c)[0].payload;
    eq('one row per action', p.rows.filter(r => r.t === 'api').map(r => r.a), ['dashboard', 'financeSummary']);
    eq('batch size recorded', p.rows[0].b, 2);
    eq('marked successful', p.rows[0].ok, 1);
    ok_('a duration was measured', typeof p.rows[0].ms === 'number' && p.rows[0].ms >= 0);
    eq('device class detected', p.dev, 'iOS');
    eq('connection class detected', p.net, '4g');
    ok_('session id present and short', typeof p.sid === 'string' && p.sid.length <= 20);
  }

  console.log('\n3) It records failures WITH the error code — the thing we could never see before');
  {
    const c = boot({ reply: () => ({ ok: false, error: { code: 'NO_SESSION', message: 'หมดอายุ' } }) });
    await c.api('dashboard').catch(() => {});
    await wait(30);
    c.document.hidden = true; c.__fire('visibilitychange'); await wait(20);
    const rows = perfCalls(c)[0].payload.rows;
    eq('failure recorded', rows[0].ok, 0);
    eq('with its code', rows[0].c, 'NO_SESSION');
  }

  console.log('\n4) The v186 incident (batch reply not an array) is now recorded, not just survived');
  {
    const c = boot({ reply: (b, okReply) => (b.action === 'batch' ? { ok: true, data: { oops: 1 } } : okReply(b)) });
    const [a, b] = await Promise.all([c.api('dashboard'), c.api('financeSummary')]);
    await wait(40);
    eq('the screen still loads', [a, b], [{ from: 'dashboard' }, { from: 'financeSummary' }]);
    c.document.hidden = true; c.__fire('visibilitychange'); await wait(20);
    const rows = perfCalls(c)[0].payload.rows;
    const shape = rows.find(r => r.a === 'batchShape');
    ok_('the bad shape is captured for diagnosis', !!shape && /typeof data=object/.test(shape.c));
    eq('and the resent calls are tagged', rows.filter(r => r.c === 'RESENT').length, 2);
  }

  console.log('\n5) A dead telemetry endpoint is invisible to the app');
  {
    const c = boot({ perfDown: true });
    const r = await c.api('dashboard');
    await wait(30);
    c.document.hidden = true; c.__fire('visibilitychange'); await wait(30);
    eq('the real call still returned its data', r, { from: 'dashboard' });
    ok_('telemetry was attempted', perfCalls(c).length >= 1);
    // if the rejection were unhandled, node would have printed a warning / crashed by now
    const r2 = await c.api('somethingElse');
    eq('and the app keeps working afterwards', r2, { from: 'somethingElse' });
  }

  console.log('\n6) The off switch really is off');
  {
    const c0 = boot();
    c0.localStorage.setItem('atom_perf_off', '1');
    // re-load the module so it re-reads the flag at start-up, as a real page load would
    const c = boot();
    c.localStorage.setItem('atom_perf_off', '1');
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'webapp', 'api.js'), 'utf8'), c);
    c.CONFIG.MODE = 'gas'; c.CONFIG.GAS_URL = 'https://example.test/exec';
    await c.api('dashboard'); await wait(30);
    c.document.hidden = true; c.__fire('visibilitychange'); await wait(20);
    eq('nothing is collected or sent', perfCalls(c).length, 0);
    ok_('but the app itself is unaffected', realCalls(c).length >= 1);
  }

  console.log('\n7) Cache hits are counted, not logged one by one');
  {
    const c = boot();
    await c.api('dashboard'); await wait(30);
    for (let i = 0; i < 25; i++) await c.api('dashboard');   // all served from cache
    await wait(10);
    c.document.hidden = true; c.__fire('visibilitychange'); await wait(20);
    const p = perfCalls(c)[0].payload;
    eq('25 cache hits cost 0 extra rows', p.rows.filter(r => r.t === 'api').length, 1);
    eq('...they are counted instead', p.hit, 25);
    eq('and the first miss is counted', p.miss, 1);
    eq('the cached reads made no network calls', realCalls(c).length, 1);
  }

  console.log('\n8) Telemetry never bypasses the session, and never becomes a write');
  {
    const c = boot();
    c.localStorage.setItem('atom_session_token', 'body.sig');
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'webapp', 'api.js'), 'utf8'), c);
    c.CONFIG.MODE = 'gas'; c.CONFIG.GAS_URL = 'https://example.test/exec';
    await c.api('dashboard'); await wait(30);
    c.document.hidden = true; c.__fire('visibilitychange'); await wait(20);
    eq('the token is sent so the SERVER can label the role', perfCalls(c)[0].token, 'body.sig');
    ok_('no role is self-reported by the client', !('role' in perfCalls(c)[0].payload));
    // a perfLog must never travel inside a batch: it would take the write lock path server-side
    ok_('perfLog is never batched', c.__sent.every(b => b.action !== 'batch' || !(b.payload.calls || []).some(x => x.action === 'perfLog')));
  }

  console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' : 'ALL PASS ') + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})();
