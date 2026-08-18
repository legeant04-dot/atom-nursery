/**
 * tools/test_lost_request.js — a request that never arrived, and what the person is told about it.
 *   node tools/test_lost_request.js
 *
 * From the live log, one day: lostReply :: batch got health ×8 across SEVEN people, plus one each
 * for auth (twice — the retry was lost too), staffCheckin and studentCheckinHistory.
 *
 * What "got health" means: a POST whose body is lost in transit reaches the web app as an
 * action-less GET, and the server answers { ok:false, a:'health', error:{code:'NO_ACTION'} }. So the
 * server never dispatched anything — nothing ran and nothing was written.
 *
 * Three things were wrong with how that was handled, and none of them was the retry itself:
 *
 *   1. WE STILL CANNOT SAY WHY. Guessing is how the v186 crash went unexplained for months. Apps
 *      Script answers /exec with a 302 to googleusercontent.com, and a browser re-issues a POST as
 *      a GET when it follows a 302 — which is precisely what the server saw. The row now carries
 *      the HTTP status, whether the reply came via a redirect, and where it landed, so the next
 *      report either confirms that or rules it out.
 *   2. A RECOVERY LOOKED LIKE A FAILURE. Seven of the eight were retried and worked; the report
 *      showed seven people hitting an error none of them saw. (The same blind spot as NO_SESSION.)
 *   3. A TEACHER'S MORNING PUNCH WAS NOT RETRIED. staffCheckin is a write, and a write is never
 *      repeated — except that the SERVER refuses a second punch (ALREADY_CHECKED_IN) and, since
 *      v245, the app reads that refusal as the success it is. Those two actions are safe to repeat
 *      because the server makes them safe. Nothing to do with money is.
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

// the server's real answer to a request whose body never arrived (src/Code.gs doGet, no action)
const LOST = { ok: false, a: 'health', error: { code: 'NO_ACTION', service: 'Atom Nursery API', status: 'up' } };

function boot(opts) {
  opts = opts || {};
  const sent = [], listeners = {}, store = {}, logged = [];
  const mkStore = () => ({ getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }, key: i => Object.keys(store)[i], get length() { return Object.keys(store).length; } });
  const ctx = {
    console, setTimeout, clearTimeout, clearInterval, Promise, JSON, Math, Date, Object, Array, String, Number, isFinite,
    setInterval: () => 0,
    Blob: function (a, b) { this.parts = a; this.type = b && b.type; },
    localStorage: mkStore(), sessionStorage: mkStore(),
    navigator: { userAgent: 'Mozilla/5.0 (iPhone)', connection: { effectiveType: '4g' }, sendBeacon: null, maxTouchPoints: 5 },
    performance: { getEntriesByType: () => [] },
    document: { addEventListener: (n, f) => { (listeners[n] = listeners[n] || []).push(f); }, hidden: false, currentScript: null }
  };
  ctx.window = ctx; ctx.matchMedia = () => ({ matches: false }); ctx.addEventListener = ctx.document.addEventListener;
  // `loseFirst` = how many attempts come back as the lost-request answer before a real one does
  let lost = opts.loseFirst == null ? 1 : opts.loseFirst;
  ctx.fetch = (url, init) => {
    const body = JSON.parse(init.body);
    if (body.action === 'perfLog') { logged.push(body.payload); return Promise.resolve({ status: 200, redirected: false, url: url, text: () => Promise.resolve('{"ok":true,"data":{}}') }); }
    sent.push(body);
    if (lost > 0) { lost--; return Promise.resolve({ status: 200, redirected: true, url: 'https://script.googleusercontent.com/macros/echo?x=1', text: () => Promise.resolve(JSON.stringify(LOST)) }); }
    const one = a => ({ ok: true, data: { a: a } });
    return Promise.resolve({ status: 200, redirected: false, url: url, text: () => Promise.resolve(JSON.stringify(
      body.action === 'batch' ? { ok: true, a: 'batch', data: (body.payload.calls || []).map(c => one(c.action)) } : Object.assign({ a: body.action }, one(body.action)))) });
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  ctx.CONFIG.MODE = 'gas'; ctx.CONFIG.GAS_URL = 'https://example.test/exec';
  const settle = () => new Promise(r => setTimeout(r, 60));
  return {
    ctx, sent, settle,
    rows: async () => { ctx.document.hidden = true; (listeners.visibilitychange || []).forEach(f => f()); await settle();
      ctx.document.hidden = false; (listeners.visibilitychange || []).forEach(f => f()); await settle();
      return logged.reduce((a, p) => a.concat(p.rows || []), []); }
  };
}
const attempts = (sent, a) => sent.filter(b => b.action === a).length;

(async () => {

console.log('\n1) a lost READ is asked again, and the person never knows');
{
  const t = boot({ loseFirst: 1 });
  const d = await t.ctx.api('studentCheckinHistory', { studentId: 'S1' });
  await t.settle();
  ok_('the caller gets their answer, not an error', !!d);
  eq('...because it was asked a second time', attempts(t.sent, 'studentCheckinHistory'), 2);
  const rows = await t.rows();
  const lostRow = rows.find(r => r.t === 'err' && r.a === 'lostReply');
  ok_('the loss is still recorded — it did happen', !!lostRow);
  ok_('...saying which action, and which attempt', /studentCheckinHistory got health attempt=0/.test((lostRow || {}).c || ''));
  ok_('and the recovery is recorded too', rows.some(r => r.t === 'healed' && r.a === 'studentCheckinHistory'));
}
{
  // the reported case: a whole screen-load batch
  const t = boot({ loseFirst: 1 });
  const p = Promise.all([t.ctx.api('dashboard', {}), t.ctx.api('classList', {}), t.ctx.api('announcements', {})]);
  const got = await p; await t.settle();
  eq('all three screens got their data', got.filter(Boolean).length, 3);
  eq('...from one retried batch, not three', attempts(t.sent, 'batch'), 2);
  const rows = await t.rows();
  ok_('recorded as a batch that was lost', rows.some(r => r.t === 'err' && /^batch got health/.test(r.c || '')));
  ok_('...and as recovered', rows.some(r => r.t === 'healed' && r.a === 'batch'));
}

console.log('\n2) the facts that would identify WHY');
{
  const t = boot({ loseFirst: 1 });
  await t.ctx.api('classList', {}); await t.settle();
  const rows = await t.rows();
  const c = (rows.find(r => r.t === 'err' && r.a === 'lostReply') || {}).c || '';
  ok_('the HTTP status is recorded', /http=200/.test(c));
  ok_('whether it came back through a REDIRECT is recorded', /redirected/.test(c));
  ok_('...and where it actually landed', /via=script\.googleusercontent\.com/.test(c));
  ok_('the reasoning is written down, not left as a guess', /a browser re-issues a POST as|a 302 on a POST is\s*\n\s*\* re-issued by the browser as a\s*\n?\s*\* ?GET/.test(src) || /302 on a POST is re-issued by the browser as a\s*\n\s*\* GET/.test(src));
}

console.log('\n3) a teacher\'s morning punch is no longer lost with the request');
{
  const t = boot({ loseFirst: 1 });
  const d = await t.ctx.api('staffCheckin', { staffId: 'S1', lat: 1, lng: 2 });
  await t.settle();
  ok_('the check-in went through', !!d);
  eq('...because it was sent again', attempts(t.sent, 'staffCheckin'), 2);
  ok_('the exception is named and justified by the SERVER\'s guard', /const IDEMPOTENT_WRITE = \/\^\(staffCheckin\|staffCheckout\)\$\//.test(src));
  ok_('...and says why nothing else may join it', /Nothing to do with money is here, and nothing should be added\s*\n\s*\* without a guard on the handler to point at/.test(src));
}
{
  // …and a payment still is not, however lost it was
  const t = boot({ loseFirst: 1 });
  let err = null;
  await t.ctx.api('payCombined', { items: [{ kind: 'bill', id: 'B1' }], slipAmount: 6900 }).catch(e => { err = e; });
  await t.settle();
  eq('a payment is sent ONCE and never repeated', attempts(t.sent, 'payCombined'), 1);
  eq('...and the failure is reported', (err || {}).code, 'LOST_REQUEST');
  ok_('...telling the person nothing was saved, so it is safe to do again', /ยังไม่มีการบันทึกข้อมูล/.test((err || {}).message || ''));
}
{
  // a batch carrying a write is still not repeatable
  const t = boot({ loseFirst: 1 });
  let err = null;
  await Promise.all([
    t.ctx.api('dashboard', {}).catch(e => { err = err || e; }),
    t.ctx.api('payCombined', { items: [] }).catch(e => { err = err || e; })
  ]);
  await t.settle();
  eq('a batch containing a payment is not retried', attempts(t.sent, 'batch'), 1);
  eq('...and everyone in it is told', (err || {}).code, 'LOST_REQUEST');
}

console.log('\n4) the rule lives in ONE place now');
{
  ok_('there is a single canRepeat', /const canRepeat = body => \{/.test(src));
  eq('...used by all three paths that can retry', (src.match(/canRepeat\(body\)/g) || []).length, 3);
  ok_('and no path spells the rule out for itself any more',
    !/const safe0 = act0 === 'batch'/.test(src) && !/const safe = act === 'batch'/.test(src));
  ok_('the reason is recorded', /Three copies of one rule is how a batch ends up retryable on one path and not on/.test(src));
  // the promise that must never bend
  ok_('a plain write is still not repeatable', /const RETRY_SAFE = a => a === 'auth' \|\| a === 'ping' \|\| \(a !== 'batch' && !isMutating\(a\)\)/.test(src));
}
{
  // give up after two retries rather than hammering a service that is clearly unwell
  const t = boot({ loseFirst: 99 });
  let err = null;
  await t.ctx.api('classList', {}).catch(e => { err = e; });
  await t.settle();
  eq('a read is tried three times in all, then stops', attempts(t.sent, 'classList'), 3);
  eq('...and the caller is told', (err || {}).code, 'LOST_REQUEST');
  const rows = await t.rows();
  ok_('every attempt is recorded, so a repeat offender is visible', (rows.filter(r => r.t === 'err' && r.a === 'lostReply') || []).length >= 2);
  ok_('...and nothing claims it recovered', !rows.some(r => r.t === 'healed'));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
})();
