/**
 * tools/test_phase1_ttl.js — Phase 1: stop asking again for answers that cannot have changed.
 *   node tools/test_phase1_ttl.js
 *
 * MEASURED, one day, the live school: 17,308 calls · 244 sessions · p50 7.6s · p95 23.5s. That is
 * 71 requests per session, and roughly 2,500 of them were re-asking for things that change once a
 * term (getPlans ×329, classList ×594, payrollConfig ×230) or once a day (schoolDay ×608,
 * announcements ×344).
 *
 * Two causes, both in webapp/api.js:
 *   · every read was treated as stale after 30 seconds, whatever it was;
 *   · a 60-second heartbeat called revalidateAll(), which re-fetched EVERY cached entry — including
 *     screens nobody was looking at.
 * Apps Script runs one execution at a time per user, so those requests queue, and everything else
 * waits in that queue. It is why every action measured the same 6–8 seconds no matter how little
 * work it did.
 *
 * What must not break while fixing it:
 *   · a WRITE still clears the cache and is never replayed;
 *   · live data (check-ins, journals, notifications) still refreshes on the old 30-second footing;
 *   · nothing dated survives midnight;
 *   · a screen someone is still looking at keeps refreshing.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const src = R('webapp/api.js');

// ---- a browser-ish sandbox with a CONTROLLABLE clock and a real timer for the heartbeat ---------
function boot(opts) {
  opts = opts || {};
  const sent = [], listeners = {}, store = {}, timers = [];
  const mkStore = () => ({ getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }, key: i => Object.keys(store)[i], get length() { return Object.keys(store).length; } });
  let now = Date.UTC(2026, 7, 15, 9, 0, 0);
  class FakeDate extends Date {
    constructor(...a) { if (!a.length) super(now); else super(...a); }
    static now() { return now; }
  }
  const ctx = {
    console, setTimeout, clearTimeout, clearInterval, Promise, JSON, Math, Date: FakeDate, Object, Array, String, Number, isFinite,
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    Blob: function (a, b) { this.parts = a; this.type = b && b.type; },
    localStorage: mkStore(), sessionStorage: mkStore(),
    navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', connection: { effectiveType: '4g' }, sendBeacon: null, maxTouchPoints: 5 },
    performance: { getEntriesByType: () => [] },
    document: { addEventListener: (n, f) => { (listeners[n] = listeners[n] || []).push(f); }, hidden: false, currentScript: null },
    __sent: sent
  };
  ctx.window = ctx; ctx.matchMedia = () => ({ matches: false }); ctx.addEventListener = ctx.document.addEventListener;
  ctx.fetch = (url, init) => {
    const body = JSON.parse(init.body); sent.push(body);
    const one = a => ({ ok: true, data: { a: a, at: now } });
    return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(
      body.action === 'batch' ? { ok: true, data: (body.payload.calls || []).map(c => one(c.action)) } : one(body.action))) });
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  ctx.CONFIG.MODE = 'gas'; ctx.CONFIG.GAS_URL = 'https://example.test/exec';
  // let real promises settle between simulated steps
  const settle = () => new Promise(r => setTimeout(r, 30));
  return {
    ctx, sent, timers, listeners, settle,
    advance: ms => { now += ms; },
    heartbeat: async () => { timers.forEach(t => { if (t.ms === 60000) t.fn(); }); await settle(); },
    fire: async (ev) => { (listeners[ev] || []).forEach(f => f()); await settle(); }
  };
}
const reached = (sent, a) => sent.reduce((n, b) =>
  n + (b.action === a ? 1 : (b.action === 'batch' ? (b.payload.calls || []).filter(x => x.action === a).length : 0)), 0);
const total = sent => sent.reduce((n, b) => n + (b.action === 'batch' ? (b.payload.calls || []).length : 1), 0);

(async () => {

console.log('\n1) an answer keeps for as long as it is actually good for');
{
  const t = boot();
  ok_('there IS a table saying so, rather than one number for everything', /const TTL_BY_ACTION = \{/.test(src));
  ok_('...and the default is still the cautious 30 seconds', /const RC_TTL = 30000;/.test(src) && /TTL_BY_ACTION\[a\] \|\| RC_TTL/.test(src));
  // an old build has no table at all — these must FAIL, not blow the run up
  const ttl = t.ctx.__atomTtlOf || (() => null);
  eq('the attendance dashboard is live data and is unchanged', ttl('dashboard'), 30000);
  eq('...so is a journal', ttl('getJournal'), 30000);
  eq('...and a notification', ttl('notifications'), 30000);
  eq('the class list is structural', ttl('classList'), 4 * 3600000);
  eq('...and so is the payroll config that measured 13.8s', ttl('payrollConfig'), 4 * 3600000);
  eq('is-the-school-open changes once a day', ttl('schoolDay'), 600000);
  eq('...as do announcements', ttl('announcements'), 600000);
  // money and the roll are deliberately NOT in the long tier: another device changing a price or a
  // child's class has to reach this one in minutes
  eq('prices sit in the SHORT tier on purpose', ttl('getPlans'), 600000);
  eq('...and so does the child list a parent sees', ttl('parentChildren'), 600000);
  eq('a bill is live — it is money owed right now', ttl('payments'), 30000);
}

console.log('\n2) the heartbeat stops re-fetching what nobody is looking at');
{
  ok_('it no longer refreshes every cached key', !/function revalidateAll\(\) \{ _rc\.forEach\(\(e, ck\) => revalidate\(ck\)\); \}/.test(src));
  ok_('it refreshes only what is IN USE and DUE', /function revalidateDue\(now\)/.test(src) && /if \(now - used > ACTIVE_WINDOW\) return;/.test(src));
  const t = boot();
  await t.ctx.api('classList', {});          // structural — 4 hours
  await t.ctx.api('getPlans', {});           // 10 minutes
  await t.ctx.api('notifications', {});    // live — 30 seconds
  await t.settle();
  eq('three screens, three fetches', total(t.sent), 3);

  t.advance(61000); await t.heartbeat();
  eq('a minute later the live one has refreshed', reached(t.sent, 'notifications'), 2);
  eq('...the 10-minute one has NOT', reached(t.sent, 'getPlans'), 1);
  eq('...and neither has the class list', reached(t.sent, 'classList'), 1);

  // eleven minutes in: the 10-minute tier is due, the 4-hour one still is not
  t.advance(11 * 60000); await t.fire('pointerdown'); await t.heartbeat();
  eq('after eleven minutes the price list refreshes once', reached(t.sent, 'getPlans'), 2);
  eq('...the class list still has not', reached(t.sent, 'classList'), 1);
}
{
  // the measured waste, reproduced: an app left open for an hour on one screen
  const t = boot();
  const screen = ['classList', 'getPlans', 'payrollConfig', 'announcements', 'schoolDay', 'staffSelf',
                  'listStaff', 'holidays', 'students', 'notifications', 'getJournal', 'dashboard'];
  for (const a of screen) await t.ctx.api(a, {});
  await t.settle();
  const first = total(t.sent);
  eq('opening the screen costs one call per read', first, 12);
  for (let i = 0; i < 60; i++) { t.advance(60000); await t.fire('pointerdown'); await t.heartbeat(); }
  const anHour = total(t.sent) - first;
  // OLD behaviour: 12 keys × 60 ticks = 720. Now only the three live ones are due each minute, and
  // the 10-minute tier six times each.
  ok_('an hour on that screen now costs far less than the 720 calls it used to (' + anHour + ')', anHour < 250);
  eq('the class list was fetched once, all hour', reached(t.sent, 'classList'), 1);
  eq('...so was the payroll config that measured 13.8s', reached(t.sent, 'payrollConfig'), 1);
  ok_('the live notification list kept refreshing every minute', reached(t.sent, 'notifications') >= 55);
}

console.log('\n3) a screen someone is still looking at keeps refreshing');
{
  const t = boot();
  await t.ctx.api('notifications', {}); await t.settle();
  // ten minutes of watching the drop-off list without touching anything, then a tap
  for (let i = 0; i < 10; i++) { t.advance(60000); await t.heartbeat(); }
  const idle = reached(t.sent, 'notifications');
  await t.fire('pointerdown');
  t.advance(61000); await t.heartbeat();
  ok_('a tap says "I am still here" and the screen keeps updating', reached(t.sent, 'notifications') > idle);
  ok_('...and a tap on its own fetches nothing', /addEventListener\(ev, bumpActive/.test(src) && !/bumpActive[\s\S]{0,120}guarded\(/.test(src));
  ok_('the working set kept alive is capped at one screen', /const ACTIVE_SET = 12;/.test(src));
}
{
  const t = boot();
  await t.ctx.api('notifications', {}); await t.settle();
  const before = total(t.sent);
  t.ctx.document.hidden = true;
  t.advance(10 * 60000); await t.heartbeat();
  eq('an app in the background fetches nothing at all', total(t.sent), before);
  t.ctx.document.hidden = false;
  await t.fire('visibilitychange');
  ok_('coming back refreshes what is on screen', total(t.sent) > before);
}

console.log('\n4) the rules that must not bend');
{
  const t = boot();
  await t.ctx.api('classList', {}); await t.settle();
  const before = total(t.sent);
  await t.ctx.api('saveStaff', { staffId: 'S1' });        // a write
  await t.settle();
  eq('a write goes to the server every time', total(t.sent) - before >= 1, true);
  const after = total(t.sent);
  await t.ctx.api('classList', {}); await t.settle();
  // v246: a write now throws away what it COULD have changed rather than everything. saveStaff is
  // named as an owner of classList (a teacher's department decides the class they are shown
  // against), so this still holds — and tools/test_phase1b_write_scope.js covers the narrowing.
  ok_('...and throws away the long-tier entries it owns', total(t.sent) > after);
}
{
  // nothing dated may cross midnight, however long its tier is
  const t = boot();
  await t.ctx.api('schoolDay', {}); await t.settle();
  const before = reached(t.sent, 'schoolDay');
  t.advance(60000); await t.heartbeat();
  eq('a minute later it is not re-asked', reached(t.sent, 'schoolDay'), before);
  t.advance(20 * 3600000);                                 // now it is tomorrow
  const fresh = await t.ctx.api('schoolDay', {}); await t.settle();
  eq('but the next DAY it is re-asked, not served from yesterday', reached(t.sent, 'schoolDay'), before + 1);
  ok_('...and the day is what decides it, not a duration', /const rcSameDay = e =>/.test(src) && /e\.d === rcDay\(\)/.test(src));
  ok_('the caller still gets an answer', !!fresh);
}
{
  const t = boot();
  await t.ctx.api('classList', {}); await t.settle();
  const before = total(t.sent);
  await t.ctx.api('classList', {}, { fresh: true }); await t.settle();
  eq('opts.fresh still bypasses the cache whatever the tier', total(t.sent), before + 1);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
})();
