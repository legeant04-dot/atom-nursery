/**
 * tools/test_fast_route_sandbox_files.js — every `typeof fn === 'function'` guard in the sandbox finds its function
 *   node tools/test_fast_route_sandbox_files.js
 *
 * 🔴 Found 2026-11-10 (W3). Apps Script code guards optional helpers with `typeof paySlipSum_ === 'function'`.
 * On Apps Script every .gs file is loaded, so the guard is always true. server/routes.js loads a LIST of files,
 * and PaySlips.gs was not on it: the guard went false in silence, otMoneyReceived_ stopped seeing slips that
 * were SUBMITTED but not yet verified, and a second pick-up re-priced a late fee a family had already paid.
 * Nothing failed — a missing file looks exactly like "no slips". So: every guarded name defined in some
 * src/*.gs must be defined in a file the sandbox loads, unless it is on the short list below, each with why.
 */
'use strict';
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', 'src');
let pass = 0, fail = 0;
const ok_ = (label, cond) => { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; };

const routesSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes.js'), 'utf8');
const FILES = routesSrc.match(/const FILES = \[([\s\S]*?)\];/)[1].match(/'(\w+)'/g).map(x => x.slice(1, -1));
const NOT_ON_HOST = {
  pgEnabled_: 'DbPg.gs — Apps Script reading Postgres; the host IS Postgres',
  pgWriteLock_: 'DbPg.gs — the host takes the same advisory lock itself (server/host.js)',
  pgCacheKey_: 'DbPg.gs — the host bumps cache versions itself (PG.bumpCacheVersions)',
  demoOn_: 'Demo.gs — needs Script Properties; the sandbox LINE recorder applies DemoMode itself (stricter)'
};
const defined = {};
fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).forEach(f => {
  for (const m of fs.readFileSync(path.join(SRC, f), 'utf8').matchAll(/^function (\w+)\s*\(/gm)) (defined[m[1]] = defined[m[1]] || []).push(f.slice(0, -3));
});
const loaded = new Set(FILES);
ok_('every file the sandbox loads exists', FILES.every(f => fs.existsSync(path.join(SRC, f + '.gs'))));
const missing = [];
FILES.forEach(f => {
  for (const m of fs.readFileSync(path.join(SRC, f + '.gs'), 'utf8').matchAll(/typeof (\w+) === 'function'/g)) {
    const n = m[1];
    if (defined[n] && !defined[n].some(x => loaded.has(x)) && !NOT_ON_HOST[n]) missing.push(n + ' (in ' + defined[n].join(',') + ', guarded in ' + f + '.gs)');
  }
});
ok_('no guarded helper is silently missing from the sandbox' + (missing.length ? '\n         ' + [...new Set(missing)].join('\n         ') : ''), !missing.length);
ok_('PaySlips.gs is loaded (otMoneyReceived_ → paySlipSum_)', loaded.has('PaySlips'));
console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
