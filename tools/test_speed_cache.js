/**
 * tools/test_speed_cache.js — the work to cut the 9-second wait.
 *   node tools/test_speed_cache.js
 *
 * Live telemetry: p50 8.9s, p95 27.6s, cache hit 45%. A request that touches no sheet at all takes
 * about 3s, so roughly 6s per call was our own doing. Two causes are addressed here.
 *
 *   CLIENT — reads that only LOOKED like writes were never cached AND wiped the whole cache; and a
 *   real write left the cache empty, so every screen afterwards waited on the server again.
 *   SERVER — the workbook was re-opened from 116 call sites, and the busiest sheets were skipped by
 *   the cache for being too large, so they were re-read in full on every request.
 *
 * The rule that must not bend: a WRITE is still never cached and never re-sent.
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
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function boot() {
  const sent = [], listeners = {}, store = {};
  const mkStore = () => ({ getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }, key: i => Object.keys(store)[i], get length() { return Object.keys(store).length; } });
  const ctx = {
    console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval, Promise, JSON, Math, Date, Object, Array, String, Number, isFinite,
    Blob: function (a, b) { this.parts = a; this.type = b && b.type; },
    localStorage: mkStore(), sessionStorage: mkStore(),
    navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', connection: { effectiveType: '4g' }, sendBeacon: null, maxTouchPoints: 5 },
    performance: { getEntriesByType: () => [] },
    document: { addEventListener: (n, f) => { (listeners[n] = listeners[n] || []).push(f); }, hidden: false, currentScript: null },
    __sent: sent, __store: store
  };
  ctx.window = ctx; ctx.matchMedia = () => ({ matches: false }); ctx.addEventListener = ctx.document.addEventListener;
  ctx.fetch = (url, init) => {
    const body = JSON.parse(init.body); sent.push(body);
    const one = a => ({ ok: true, data: [{ a: a }] });
    return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(
      body.action === 'batch' ? { ok: true, data: (body.payload.calls || []).map(c => one(c.action)) } : one(body.action)))});
  };
  vm.createContext(ctx);
  vm.runInContext(R('webapp/api.js'), ctx);
  ctx.CONFIG.MODE = 'gas'; ctx.CONFIG.GAS_URL = 'https://example.test/exec';
  return ctx;
}
// how many times an action actually reached the network (batched or alone)
const reached = (c, a) => c.__sent.reduce((n, b) =>
  n + (b.action === a ? 1 : (b.action === 'batch' ? (b.payload.calls || []).filter(x => x.action === a).length : 0)), 0);

(async () => {
  console.log('\n1) Reads that only LOOKED like writes are cached again');
  {
    const c = boot();
    // 'payments' matches the /^pay/ verb rule. Parents open this screen to pay school fees.
    await c.api('payments', { studentId: 'S1' });
    await c.api('payments', { studentId: 'S1' });
    await c.api('payments', { studentId: 'S1' });
    eq('three opens of the payment screen, one round trip', reached(c, 'payments'), 1);
  }
  {
    const c = boot();
    await c.api('classList', {});                       // something worth keeping
    await c.api('payments', { studentId: 'S1' });       // used to wipe everything
    await c.api('classList', {});
    eq('opening the payment screen no longer throws the rest away', reached(c, 'classList'), 1);
  }
  {
    const c = boot();
    for (const a of ['prepayments', 'prepayTiers', 'paymentLog', 'paymentSlips', 'payrollConfig',
                     'absenceReport', 'staffCheckinLog', 'studentCheckinHistory', 'payrollReminderDue']) {
      await c.api(a, {}); await c.api(a, {});
      eq(a + ' is cached', reached(c, a), 1);
    }
  }

  console.log('\n2) ...but a real write is still a write');
  {
    const c = boot();
    await c.api('payCombined', { amount: 100 });
    await c.api('payCombined', { amount: 100 });
    eq('a payment is NEVER served from cache', reached(c, 'payCombined'), 2);
    const src = R('webapp/api.js');
    ok_('exportStudent is not on the read list — it stamps Status=EXPORTED',
      !/READ_ONLY = \{[\s\S]{0,400}exportStudent/.test(src));
    // every name on the list was verified against its handler; a write here could be re-sent
    const list = (/const READ_ONLY = \{([\s\S]*?)\};/.exec(src) || [])[1] || '';
    const names = list.match(/[A-Za-z]+(?=: 1)/g) || [];
    // twelve since v285 (prepaidStudents — its NAME starts with "prepay"; staffMissingCheckout, the
    // eleventh, contains "Checkout"). Pinned deliberately: every entry here has been read against
    // its handler, and the count is what makes an unchecked addition impossible to slip in.
    eq('the list is exactly the twelve that were checked', names.length, 12);
    const eng = R('webapp/engine.js');
    names.forEach(n => {
      const i = eng.indexOf('\n    ' + n + ':');
      // stop at the NEXT handler, or a one-liner runs into its neighbour and gets blamed for it
      // (prepayTiers sits directly above savePrepayTiers, which does log a write)
      const rest = i < 0 ? '' : eng.slice(i + 1);
      const nxt = /\n    [A-Za-z_$][\w$]*:\s/.exec(rest);
      const body = nxt ? rest.slice(0, nxt.index) : rest.slice(0, 700);
      // a handler that pushes into M or records an action in the audit log is writing something
      ok_(n + ' really is read-only in the engine', i >= 0 && !/M\.\w+\.push\(|logAct\(/.test(body));
    });
  }

  console.log('\n3) A write empties what it CHANGED, then fills it again');
  {
    /* v246: a write used to empty the whole cache. It now empties what that write could have
     * changed and leaves the rest — writing a journal cannot alter the class list. The measured
     * reason: an admin saves constantly, and clearing everything each time cost them 482 requests
     * per visit against a teacher's 99. What must not change is the part below: the LIVE entries
     * still go, and they come back by themselves in one batched request.
     * The narrowing itself is covered by tools/test_phase1b_write_scope.js. */
    const c = boot();
    await c.api('classList', {});
    await c.api('notifications', {});
    await c.api('submitJournal', { studentId: 'S1' });        // a write: the live cache must go
    const left = c.__store ? Object.keys(c.__store).filter(k => k.indexOf('atom_rc_') === 0) : [];
    ok_('the live entry really was emptied', !left.some(k => k.indexOf('notifications') >= 0));
    ok_('...and the class list, which the journal cannot have changed, was kept', left.some(k => k.indexOf('classList') >= 0));
    await wait(1500);                                        // debounce window
    eq('the emptied entry came back on its own', reached(c, 'notifications'), 2);
    eq('...and the kept one was not re-fetched', reached(c, 'classList'), 1);
    // and now the next screen costs nothing
    const before = reached(c, 'notifications');
    await c.api('notifications', {});
    eq('the next tap is instant', reached(c, 'notifications'), before);
  }
  {
    // a write that DOES own a long entry still clears it, and the re-warm is still one request
    const c = boot();
    await c.api('classList', {});
    await c.api('notifications', {});
    await c.api('orgMoveStudent', { studentId: 'S1' });       // this one DOES change the class list
    await wait(1500);
    ok_('both came back', reached(c, 'classList') === 2 && reached(c, 'notifications') === 2);
    const last = c.__sent[c.__sent.length - 1];
    eq('...in ONE batched request, not one each', last.action, 'batch');
  }
  {
    const c = boot();
    await c.api('classList', {});
    // a check-in rush: ten writes in a row must not mean ten refills
    for (let i = 0; i < 10; i++) await c.api('checkinStudent', { id: 'S' + i });
    await wait(1500);
    eq('a burst of check-ins costs ONE refill', reached(c, 'classList'), 2);
  }
  {
    const c = boot();
    const src = R('webapp/api.js');
    ok_('the refill is capped', /REWARM_MAX = \d+/.test(src));
    ok_('...and debounced', /REWARM_WAIT = \d+/.test(src));
    ok_('it does not pop the "new data" bar — nothing moved under the user',
      !/rewarmLater[\s\S]{0,600}scheduleRender/.test(src));
  }

  console.log('\n4) SERVER: the workbook is opened once, not once per call site');
  {
    const cfg = R('src/Config.gs');
    ok_('the handle is memoised', /_WB_CACHE_\.main \|\| \(_WB_CACHE_\.main =/.test(cfg));
    ok_('so is the HR one', /_WB_CACHE_\.hr\s+\|\| \(_WB_CACHE_\.hr\s+=/.test(cfg));
    ok_('the script property is memoised too', /_WB_ID_CACHE_\[propKey\]/.test(cfg));
    ok_('there is a way to drop it', /function resetWorkbookCache_/.test(cfg));
    // setupAll CREATES the workbooks and then stores the id — a memo from before that points at a
    // workbook that no longer exists, and setup would write into the wrong file
    ok_('setup drops it after creating a workbook',
      /props\.setProperty\(propKey, ss\.getId\(\)\);[\s\S]{0,200}resetWorkbookCache_\(\)/.test(R('src/Setup.gs')));
    ok_('this was worth doing — it is called from many places',
      (R('src/Config.gs') + R('src/GasEngine.gs')).indexOf('getMainSpreadsheet_') > 0);
  }

  console.log('\n5) SERVER: the busiest sheets are cached instead of skipped');
  {
    const ge = R('src/GasEngine.gs');
    ok_('a value over the limit is split rather than dropped', /CACHE_PART_ =/.test(ge) && /putAll\(map, ttl\)/.test(ge));
    ok_('the pointer is written LAST, so it can never point at parts that are not there yet',
      /putAll\(map, ttl\);[\s\S]{0,120}put\(k, '__parts:'/.test(ge));
    ok_('a missing part counts as a miss, not as half the data', /if \(part == null\) return null;/.test(ge));
    ok_('something genuinely enormous still falls back to a live read', /n > CACHE_MAX_PARTS_/.test(ge));
    ok_('deleting an entry deletes its parts', /function cacheDel_[\s\S]{0,300}removeAll\(keys\)/.test(ge));
    // ~20 places bust the cache directly with removeAll(['col:X','rows:X']) rather than cacheDel_.
    // They remove the POINTER, and cacheGet_ reads the pointer first, so they still work.
    ok_('the pointer is read before anything else, so the existing bust sites still work',
      /var v = CacheService\.getScriptCache\(\)\.get\(k\);[\s\S]{0,120}if \(!v\) return null;/.test(ge));
  }

  console.log('\n6) The server can be timed from outside, so this is provable');
  {
    const code = R('src/Code.gs');
    ok_('ping can report what a request pays before it does any work', /openFirst: t1 - t0/.test(code));
    ok_('...including that the second open is free', /openAgain/.test(code));
    // a normal ping must not pay for the probe — every request in the app goes through this action
    ok_('it only does so when asked', /if \(p && p\.probe\) \{/.test(code));
    ok_('the heavier read timing needs its own opt-in', /p\.probe === 2 \|\| p\.probe === '2'/.test(code));
    ok_('and it returns timings only — no school data', !/students|payments|NameTH/.test((/ping:\s*function[\s\S]{0,700}?\},/.exec(code) || [''])[0]));
  }

  console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' : 'ALL PASS ') + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})();
