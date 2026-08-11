/**
 * tools/test_shape_guard.js — a reply that lost its list shape must not reach the screen.
 *   node tools/test_shape_guard.js
 *
 * Live telemetry (4 days, 466 sessions) showed ~12 people hitting "x.map is not a function" on the
 * home screen, and more on the leave screen. Those users were shown a message about JavaScript
 * instead of their child's information. The cause is still unproven, so the guard does not assume
 * one: it remembers what shape each action returned and re-asks when a reply disagrees.
 *
 * The property that matters most here is that it CANNOT BREAK A WORKING SCREEN. An action that
 * legitimately changes shape must still get through — at most one extra round trip, once.
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

// ---- a browser and a network we control ----------------------------------------------------
function boot(reply) {
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
    __sent: sent, __fire: n => (listeners[n] || []).forEach(f => f({}))
  };
  ctx.window = ctx; ctx.matchMedia = () => ({ matches: false }); ctx.addEventListener = ctx.document.addEventListener;
  ctx.fetch = (url, init) => {
    const body = JSON.parse(init.body); sent.push(body);
    return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(reply(body, sent))) });
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'webapp', 'api.js'), 'utf8'), ctx);
  ctx.CONFIG.MODE = 'gas'; ctx.CONFIG.GAS_URL = 'https://example.test/exec';
  return ctx;
}
// count only real calls to an action (telemetry rides its own action name)
const callsTo = (c, a) => c.__sent.filter(b => b.action === a).length;
const perfRows = c => c.__sent.filter(b => b.action === 'perfLog').reduce((all, b) => all.concat(b.payload.rows || []), []);
const flushPerf = async c => { c.document.hidden = true; c.__fire('visibilitychange'); await wait(20); };

// ============================================================================================
console.log('\n1) A list that arrives as an object is re-asked for, and the screen gets its list');
{
  (async () => {
    let n = 0;
    const c = boot(b => {
      if (b.action !== 'myLeaves') return { ok: true, data: { from: b.action } };
      n++;
      return { ok: true, data: n === 2 ? { broken: true } : [{ id: n }] };   // 2nd reply is corrupt
    });
    const first = await c.api('myLeaves', { a: 1 });          // learn the shape
    eq('first reply is a list', first, [{ id: 1 }]);
    const second = await c.api('myLeaves', { a: 2 });         // corrupt, then repaired
    ok_('the screen receives a LIST, not the corrupt object', Array.isArray(second));
    eq('...and it is the re-asked reply', second, [{ id: 3 }]);
    eq('exactly one extra round trip was spent', n, 3);

    await flushPerf(c);
    const rows = perfRows(c);
    ok_('the disagreement is recorded', rows.some(r => r.a === 'shapeChanged' && /myLeaves/.test(r.c)));
    ok_('...with the real shape, which is what identifies the cause', rows.some(r => /keys=broken/.test(r.c || '')));
    ok_('and the repair is recorded too', rows.some(r => r.a === 'shapeRepaired'));

    // ---------------------------------------------------------------------------------------
    console.log('\n2) An action that GENUINELY changes shape is not blocked');
    {
      let k = 0;
      const c2 = boot(b => {
        if (b.action !== 'summary') return { ok: true, data: { from: b.action } };
        k++;
        return { ok: true, data: k === 1 ? [] : { total: 5 } };     // really is an object from now on
      });
      const a = await c2.api('summary', { m: 1 });
      eq('first call learns "list"', a, []);
      const bb = await c2.api('summary', { m: 2 });
      eq('the object gets through rather than being rejected', bb, { total: 5 });
      eq('it cost one retry to establish that', k, 3);
      const cc = await c2.api('summary', { m: 3 });
      eq('and the new shape is remembered', cc, { total: 5 });
      eq('...so it is never re-asked again', k, 4);
    }

    // ---------------------------------------------------------------------------------------
    console.log('\n3) A healthy app pays nothing');
    {
      let k = 0;
      const c3 = boot(b => { if (b.action === 'listStudents') k++; return { ok: true, data: b.action === 'listStudents' ? [{ id: 1 }] : { from: b.action } }; });
      await c3.api('listStudents', { p: 1 });
      await c3.api('listStudents', { p: 2 });
      await c3.api('listStudents', { p: 3 });
      eq('three calls, three round trips — no extra traffic', k, 3);
      await flushPerf(c3);
      ok_('and nothing is reported as a problem', !perfRows(c3).some(r => r.a === 'shapeChanged'));
    }

    // ---------------------------------------------------------------------------------------
    console.log('\n4) An object that stays an object is left alone');
    {
      let k = 0;
      const c4 = boot(b => { if (b.action === 'dashboard') k++; return { ok: true, data: { from: b.action } }; });
      await c4.api('dashboard', { p: 1 }); await c4.api('dashboard', { p: 2 });
      eq('no retry for a stable object shape', k, 2);
    }

    // ---------------------------------------------------------------------------------------
    console.log('\n5) A batch answering the wrong NUMBER of results');
    {
      // matched by position: a short reply would hand every later call another action's data, and
      // leave the tail of the batch waiting forever on "กำลังโหลด…"
      let batches = 0;
      const c5 = boot(b => {
        if (b.action === 'batch') { batches++; return { ok: true, data: [{ ok: true, data: [{ x: 1 }] }] }; }  // 1 result for 3 calls
        return { ok: true, data: [{ solo: b.action }] };
      });
      const [r1, r2, r3] = await Promise.all([c5.api('classList'), c5.api('myLeaves'), c5.api('notifications')]);
      eq('every call still gets ITS OWN data', [r1, r2, r3],
        [[{ solo: 'classList' }], [{ solo: 'myLeaves' }], [{ solo: 'notifications' }]]);
      ok_('nothing was left hanging', r3 !== undefined);
      eq('the short batch was tried once, then abandoned', batches, 1);
      await flushPerf(c5);
      const rows5 = perfRows(c5);
      ok_('the mismatch is recorded', rows5.some(r => r.a === 'batchLength'));
      ok_('...with both counts', rows5.some(r => /got 1 for 3/.test(r.c || '')));
      ok_('...and which calls shared the batch', rows5.some(r => /classList/.test(r.c || '')));
    }

    // ---------------------------------------------------------------------------------------
    console.log('\n6) The guard never fires on a cached read (it was already checked once)');
    {
      let k = 0;
      const c6 = boot(b => { if (b.action === 'holidays') k++; return { ok: true, data: b.action === 'holidays' ? [1, 2] : { from: b.action } }; });
      await c6.api('holidays', {}); await c6.api('holidays', {});
      eq('the second read came from cache', k, 1);
    }

    // ---------------------------------------------------------------------------------------
    console.log('\n7) A WRITE is never re-sent, whatever shape comes back');
    {
      // The retry exists to repair a corrupt reply. Applying it to a write would submit the payment
      // (or the check-in) a second time — strictly worse than the screen failing honestly.
      let k = 0;
      const c7 = boot(b => {
        if (b.action !== 'payCombined') return { ok: true, data: { from: b.action } };
        k++; return { ok: true, data: k === 1 ? [{ slip: 1 }] : { slip: 2 } };
      });
      const one = await c7.api('payCombined', { amount: 100 });
      eq('the first payment goes through', one, [{ slip: 1 }]);
      const two = await c7.api('payCombined', { amount: 100 });
      eq('the second reply is handed over as-is', two, { slip: 2 });
      eq('THE PAYMENT WAS SENT ONCE, NOT TWICE', k, 2);
      await flushPerf(c7);
      ok_('and the disagreement is still recorded for diagnosis',
        perfRows(c7).some(r => r.a === 'shapeChanged' && /payCombined/.test(r.c)));
    }
    {
      let k = 0;
      const c8 = boot(b => { if (b.action !== 'checkinStudent') return { ok: true, data: { from: b.action } };
        k++; return { ok: true, data: k === 1 ? [1] : { done: true } }; });
      await c8.api('checkinStudent', { id: 'S1' }); await c8.api('checkinStudent', { id: 'S1' });
      eq('a check-in is not repeated either', k, 2);
    }

    console.log('\n7b) "nothing yet" is not a shape change — the alarm that cried wolf 237 times');
    {
      // getJournal answers null until the teacher writes the entry, and an object afterwards. That
      // is normal, and it produced 237 of the 240 shapeChanged rows from 34 people in the
      // 2026-08-11 report, burying the real ones. Same for getPayslip since v215.
      let k = 0;
      const c9 = boot(b => { if (b.action !== 'getJournal') return { ok: true, data: { from: b.action } };
        k++; return { ok: true, data: k === 1 ? null : { Mood: 'happy' } }; });
      eq('no entry yet → null reaches the screen', await c9.api('getJournal', { studentId: 'S1' }, { fresh: true }), null);
      eq('written → the entry reaches the screen', await c9.api('getJournal', { studentId: 'S1' }, { fresh: true }), { Mood: 'happy' });
      eq('and it was never re-asked', k, 2);
      await flushPerf(c9);
      eq('NOTHING was reported', perfRows(c9).filter(r => r.a === 'shapeChanged').length, 0);
    }
    {
      // and the other way round: object first, then null
      let k = 0;
      const c10 = boot(b => { if (b.action !== 'getPayslip') return { ok: true, data: { from: b.action } };
        k++; return { ok: true, data: k === 1 ? { BaseSalary: 15000 } : null }; });
      await c10.api('getPayslip', { month: '2026-08' }, { fresh: true });
      eq('a month with no slip returns null', await c10.api('getPayslip', { month: '2026-07' }, { fresh: true }), null);
      eq('not re-asked', k, 2);
      await flushPerf(c10);
      eq('and not reported', perfRows(c10).filter(r => r.a === 'shapeChanged').length, 0);
    }
    {
      // THE EXCEPTION THAT MUST SURVIVE: a LIST that comes back null is what crashes a screen's .map
      let k = 0;
      const c11 = boot(b => { if (b.action !== 'myLeaves') return { ok: true, data: { from: b.action } };
        k++; return { ok: true, data: k === 1 ? [{ id: 1 }] : (k === 2 ? null : [{ id: 2 }]) }; });
      await c11.api('myLeaves', {}, { fresh: true });
      eq('a list that turns null IS re-asked, and the list is recovered', await c11.api('myLeaves', {}, { fresh: true }), [{ id: 2 }]);
      eq('...which cost exactly one extra round trip', k, 3);
      await flushPerf(c11);
      ok_('...and it IS reported', perfRows(c11).some(r => r.a === 'shapeChanged' && /myLeaves/.test(r.c)));
    }
    {
      // a first-ever null must not teach the guard that this action returns a 'value'
      let k = 0;
      const c12 = boot(b => { if (b.action !== 'getJournal') return { ok: true, data: { from: b.action } };
        k++; return { ok: true, data: k <= 2 ? null : { Mood: 'ok' } }; });
      await c12.api('getJournal', { studentId: 'A' }, { fresh: true });
      await c12.api('getJournal', { studentId: 'B' }, { fresh: true });
      await c12.api('getJournal', { studentId: 'C' }, { fresh: true });
      await flushPerf(c12);
      eq('two nulls then an object is still silent', perfRows(c12).filter(r => r.a === 'shapeChanged').length, 0);
      eq('and none of them was re-asked', k, 3);
    }

    console.log('\n8) A failed service-worker update check is not a crash');
    {
      // 18 reported "crashes" across 13 people in one week were this, and not one of them affected
      // anything: the app keeps running from the cache it already has. They were uncaught promises.
      const html = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'index.html'), 'utf8');
      ok_('the first update check is caught', /reg\.update\(\)\.catch\(/.test(html));
      ok_('the periodic one is caught too', /getRegistration\(\)\.then\(r => r && r\.update\(\)\)\.catch\(/.test(html));
      ok_('registration failure was already caught', /register\('sw\.js'\)[\s\S]{0,400}\}\)\.catch\(/.test(html));
      ok_('the poll does not run in the background, where nobody is waiting for new code',
        /setInterval\(\(\) => \{\s*\n?\s*if \(document\.hidden\) return;/.test(html));
      // every promise in this block must end in a catch, or it becomes a reported crash again
      const blk = html.slice(html.indexOf("if ('serviceWorker' in navigator)"), html.indexOf('</script>', html.indexOf("if ('serviceWorker' in navigator)")));
      const thens = (blk.match(/\.then\(/g) || []).length, catches = (blk.match(/\.catch\(/g) || []).length;
      ok_('no promise chain is left uncaught (' + catches + ' catches for ' + thens + ' thens)', catches >= 3);
    }

    console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' : 'ALL PASS ') + (pass + fail) + ' checks');
    process.exit(fail ? 1 : 0);
  })();
}
