/**
 * tools/test_phase1b_write_scope.js — a save throws away what it CHANGED, not everything.
 *   node tools/test_phase1b_write_scope.js
 *
 * MEASURED after Phase 1 (17–18 Aug), with the role breakdown Phase 2 added:
 *     Admin   7,713 calls / 16 sessions = 482 per visit, p50 10.6s
 *     Teacher 4,748 / 48 =  99      Parent 3,845 / 119 = 32
 * Sixteen admin visits made 47% of all traffic. The cache hit rate FELL from 75% to 67% after the
 * long tiers were added, and payrollConfig — a FOUR-HOUR entry — was still fetched 220 times at
 * p50 13.8s. Teachers and parents were fine; the admin was not.
 *
 * The cause was one line: every write called rcClear(), which empties the whole cache including the
 * four-hour tier, and then refetched the ten most recent keys. A parent writes twice a day and never
 * notices. The admin saves constantly, and so spent the day destroying their own cache.
 *
 * The fix is a table of what OWNS each long-lived read. A write not in that read's owner list cannot
 * have changed it, so it survives. Everything not listed is cleared exactly as before — that is the
 * safety property, and it is the point: forgetting an entry costs a refetch, never a stale screen.
 * A teacher shown yesterday's roll would be far worse than any delay.
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

function boot() {
  const sent = [], listeners = {}, store = {}, timers = [];
  const mkStore = () => ({ getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }, key: i => Object.keys(store)[i], get length() { return Object.keys(store).length; } });
  const ctx = {
    console, setTimeout, clearTimeout, clearInterval, Promise, JSON, Math, Date, Object, Array, String, Number, isFinite,
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    Blob: function (a, b) { this.parts = a; this.type = b && b.type; },
    localStorage: mkStore(), sessionStorage: mkStore(),
    navigator: { userAgent: 'Mozilla/5.0 (Macintosh)', connection: { effectiveType: '4g' }, sendBeacon: null, maxTouchPoints: 0 },
    performance: { getEntriesByType: () => [] },
    document: { addEventListener: (n, f) => { (listeners[n] = listeners[n] || []).push(f); }, hidden: false, currentScript: null }
  };
  ctx.window = ctx; ctx.matchMedia = () => ({ matches: false }); ctx.addEventListener = ctx.document.addEventListener;
  ctx.fetch = (url, init) => {
    const body = JSON.parse(init.body);
    if (body.action === 'perfLog') return Promise.resolve({ status: 200, text: () => Promise.resolve('{"ok":true,"data":{}}') });
    sent.push(body);
    const one = a => ({ ok: true, data: { a: a } });
    return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(
      body.action === 'batch' ? { ok: true, data: (body.payload.calls || []).map(c => one(c.action)) } : one(body.action))) });
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  ctx.CONFIG.MODE = 'gas'; ctx.CONFIG.GAS_URL = 'https://example.test/exec';
  const settle = () => new Promise(r => setTimeout(r, 40));
  return { ctx, sent, settle };
}
const reached = (sent, a) => sent.reduce((n, b) =>
  n + (b.action === a ? 1 : (b.action === 'batch' ? (b.payload.calls || []).filter(x => x.action === a).length : 0)), 0);
const total = sent => sent.reduce((n, b) => n + (b.action === 'batch' ? (b.payload.calls || []).length : 1), 0);

(async () => {

console.log('\n1) the structural reads survive a write that cannot have changed them');
{
  const t = boot();
  // an admin opens the payroll screen: the four-hour reads it needs
  for (const a of ['payrollConfig', 'classList', 'getPlans', 'holidays', 'schoolDay', 'staffGroups'])
    await t.ctx.api(a, {});
  await t.settle();
  const first = total(t.sent);
  eq('six reads, six fetches', first, 6);

  // …then saves an OT. That cannot have changed any of them.
  await t.ctx.api('adminAddHolidayOT', { staffIds: ['S1'], amount: 500 });
  await t.settle();
  for (const a of ['payrollConfig', 'classList', 'getPlans', 'holidays', 'schoolDay', 'staffGroups'])
    await t.ctx.api(a, {});
  await t.settle();
  eq('payrollConfig — the 13.8s one — was NOT re-fetched', reached(t.sent, 'payrollConfig'), 1);
  eq('nor the class list', reached(t.sent, 'classList'), 1);
  eq('nor the price list', reached(t.sent, 'getPlans'), 1);
  eq('nor the calendar', [reached(t.sent, 'holidays'), reached(t.sent, 'schoolDay')], [1, 1]);
  eq('nor the staff groups', reached(t.sent, 'staffGroups'), 1);
}
{
  // the measured pattern: an admin saving twenty times in one visit
  const t = boot();
  const screen = ['payrollConfig', 'classList', 'getPlans', 'holidays', 'schoolDay', 'staffGroups', 'departments', 'announcements'];
  for (const a of screen) await t.ctx.api(a, {});
  await t.settle();
  const afterLoad = total(t.sent);
  for (let i = 0; i < 20; i++) {
    await t.ctx.api('adminAddOT', { i: i });
    await t.settle();
    for (const a of screen) await t.ctx.api(a, {});   // the screen redraws after each save
    await t.settle();
  }
  const cost = total(t.sent) - afterLoad;
  // OLD behaviour: 20 writes + 20×8 refetches = 180. Now: 20 writes and (almost) nothing else.
  ok_('twenty saves cost twenty requests, not a hundred and eighty (' + cost + ')', cost <= 40);
}

console.log('\n2) …and are thrown away by the write that OWNS them');
{
  const cases = [
    ['holidays',      'addHoliday'],
    ['schoolDay',     'addBigCleaning'],
    ['bigCleaningDays', 'removeBigCleaning'],
    ['getPlans',      'savePlans'],
    ['payrollConfig', 'setPayrollConfig'],
    ['classList',     'orgMoveStudent'],
    ['departments',   'addDepartment'],
    ['announcements', 'editAnnouncement'],
    ['staffSelf',     'saveStaff'],
    ['leaveQuota',    'approveLeave'],
    ['dspmCriteria',  'saveDspmCriteria']
  ];
  for (const [read, write] of cases) {
    const t = boot();
    await t.ctx.api(read, {}); await t.settle();
    await t.ctx.api(write, {}); await t.settle();
    await t.ctx.api(read, {}); await t.settle();
    eq(read + ' IS re-read after ' + write, reached(t.sent, read), 2);
  }
}
{
  // a config change touches almost everything, and must
  const t = boot();
  for (const a of ['getPlans', 'holidays', 'payrollConfig', 'staffGroups']) await t.ctx.api(a, {});
  await t.settle();
  await t.ctx.api('setSchoolConfig', { values: {} }); await t.settle();
  for (const a of ['getPlans', 'holidays', 'payrollConfig', 'staffGroups']) await t.ctx.api(a, {});
  await t.settle();
  eq('setSchoolConfig re-reads all four', ['getPlans', 'holidays', 'payrollConfig', 'staffGroups'].map(a => reached(t.sent, a)), [2, 2, 2, 2]);
}

console.log('\n3) the safety property: anything NOT in the table behaves exactly as before');
{
  const t = boot();
  // live data — a roll, a journal, a bill. None of these is in the table.
  for (const a of ['dashboard', 'getJournal', 'payments', 'notifications', 'teacherClassAttendance'])
    await t.ctx.api(a, {});
  await t.settle();
  await t.ctx.api('submitJournal', { studentId: 'S1' }); await t.settle();
  for (const a of ['dashboard', 'getJournal', 'payments', 'notifications', 'teacherClassAttendance'])
    await t.ctx.api(a, {});
  await t.settle();
  eq('every live read is thrown away by a write, as before',
    ['dashboard', 'getJournal', 'payments', 'notifications', 'teacherClassAttendance'].map(a => reached(t.sent, a)), [2, 2, 2, 2, 2]);
}
{
  // an UNKNOWN write must be treated as if it could have changed anything
  const t = boot();
  await t.ctx.api('payrollConfig', {}); await t.ctx.api('dashboard', {}); await t.settle();
  await t.ctx.api('saveSomethingNobodyHasWrittenYet', {}); await t.settle();
  await t.ctx.api('payrollConfig', {}); await t.ctx.api('dashboard', {}); await t.settle();
  eq('an unlisted write still clears the long tier — safe by default', reached(t.sent, 'payrollConfig'), 2);
  eq('...and the live one', reached(t.sent, 'dashboard'), 2);
}
{
  ok_('the rule is a table, not scattered conditions', /const OWNED_BY = \{/.test(src));
  ok_('...and the reason it is safe is written down', /forgetting to list something costs a refetch, never a stale screen/.test(src));
  ok_('the clear asks the table', /function rcClearFor\(action\)/.test(src) && /const own = rcOwner\(ck\); if \(own && !own\.test\(action\)\) keep\.push/.test(src));
  ok_('the write path uses it', /if \(isMutating\(action\)\) \{ const was = rcRecentKeys\(\); rcClearFor\(action\);/.test(src));
  ok_('...and rcClear itself is untouched, for logout', /window\.__atomCacheClear = rcClear;/.test(src));
  ok_('a write must be named as reasoned-about, not just absent from an owner list', /const SCOPED_WRITES = new RegExp/.test(src));
  ok_('...and the hole that would leave is written down', /an unknown write, one nobody has thought about yet,\s*\n\s*\* would slip through/.test(src));
}
{
  /* The two tables have to agree: every write named as the OWNER of a read must also be a write we
   * have reasoned about, or it will clear everything anyway and the owner entry is a lie that reads
   * as an optimisation. This is the drift these two lists are prone to. */
  const owners = (src.match(/const OWNED_BY = \{[\s\S]*?\n  \};/) || [''])[0];
  const scoped = (src.match(/const SCOPED_WRITES = new RegExp\([\s\S]*?'i'\);/) || [''])[0];
  const named = [...new Set((owners.match(/\^\(?[a-zA-Z|]+/g) || [])
    .join('|').replace(/[\^()]/g, '').split('|').filter(w => w && w.length > 3))];
  const missing = named.filter(w => {
    // the owner table uses fragments like "add|remove)Holiday" — check the whole word appears
    const re = new RegExp("'" + w, 'i');
    const asWord = new RegExp("'[a-z]*" + w + "[a-z]*'", 'i');
    return !re.test(scoped) && !asWord.test(scoped);
  });
  ok_('every owner named in the table is a write we have reasoned about' + (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''), missing.length === 0);
}

console.log('\n4) nothing else about a write moved');
{
  const t = boot();
  await t.ctx.api('classList', {}); await t.settle();
  const before = total(t.sent);
  await t.ctx.api('adminAddOT', {}); await t.settle();
  eq('a write still goes to the server every time', total(t.sent) - before, 1);
  const after = total(t.sent);
  await t.ctx.api('adminAddOT', {}); await t.settle();
  eq('...and is never served from a cache', total(t.sent) - after, 1);
}
{
  // survivors must be kept on DISK too, or a reload undoes the saving
  const t = boot();
  await t.ctx.api('payrollConfig', {}); await t.settle();
  await t.ctx.api('adminAddOT', {}); await t.settle();
  const keys = Object.keys(t.ctx.localStorage).length !== undefined ? null : null;
  let found = false;
  for (let i = 0; i < t.ctx.localStorage.length; i++) {
    const k = t.ctx.localStorage.key(i);
    if (k && k.indexOf('payrollConfig') >= 0) found = true;
  }
  ok_('a survivor is still on disk after the write', found);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
})();
