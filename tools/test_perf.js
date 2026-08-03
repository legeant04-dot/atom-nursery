/**
 * tools/test_perf.js — Phase 0 telemetry: sanitising, safety fences, and the ranked summary.
 *   node tools/test_perf.js
 *
 * Perf.gs is GAS code, so this loads it into a vm with stubbed Apps Script globals and a fake sheet.
 * The point of these tests is NOT that the numbers are pretty — it is that an UNAUTHENTICATED,
 * hostile caller cannot use the public perfLog route to hurt the school's spreadsheet, and that a
 * telemetry failure can never surface as a user-facing error.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

// ---- fake sheet / spreadsheet -----------------------------------------------------------
function fakeSheet(name) {
  const s = { name, rows: [] };
  s.getLastRow = () => s.rows.length;
  s.getLastColumn = () => (s.rows[0] || []).length;
  s.setFrozenRows = () => s;
  s.getRange = (r, c, nr, nc) => ({
    setValues: v => { for (let i = 0; i < v.length; i++) s.rows[r - 1 + i] = v[i].slice(); return this; },
    getValues: () => { const out = []; for (let i = 0; i < nr; i++) out.push((s.rows[r - 1 + i] || []).slice(c - 1, c - 1 + nc)); return out; },
    setFontWeight: () => {}
  });
  s.deleteRows = (start, n) => { s.rows.splice(start - 1, n); };
  return s;
}
function makeCtx(cfg) {
  const sheets = {};
  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = fakeSheet(n)),
    getSpreadsheetTimeZone: () => 'Asia/Bangkok',
    getName: () => 'MAIN'
  };
  let lockOk = true;
  const ctx = {
    console,
    __sheets: sheets, __ss: ss,
    __setLock: v => { lockOk = v; },
    getConfig_: (k, d) => ((cfg && cfg[k] !== undefined) ? cfg[k] : d),
    getMainSpreadsheet_: () => ss,
    Logger: { log: () => {} },
    Utilities: { formatDate: (d, tz, f) => {
      const p = n => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
             p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    } },
    LockService: { getDocumentLock: () => ({ tryLock: () => lockOk, releaseLock: () => {} }) }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'Perf.gs'), 'utf8'), ctx);
  return ctx;
}
const row = (o) => Object.assign({ t: 'api', a: 'dashboard', ms: 100, ok: 1, c: '', b: 1, s: 'home' }, o);

// ============================================================================
console.log('\n1) A hostile caller cannot put a live formula in the school spreadsheet');
{
  const c = makeCtx();
  c.handlePerfLog({ sid: 'x', rows: [row({ t: 'err', a: '=IMPORTXML(A1,"//x")', c: '@SUM(A:A)' })] });
  const sh = c.__sheets.PERF_LOG;
  const r = sh.rows[1];
  eq('formula in Action is neutralised', r[4][0], "'");
  eq('formula in Code is neutralised', r[7][0], "'");
  c.handlePerfLog({ sid: 'x', rows: [row({ t: 'err', a: '+1+1', c: '-2-2' })] });
  eq('leading + neutralised', sh.rows[2][4][0], "'");
  eq('leading - neutralised', sh.rows[2][7][0], "'");
}

console.log('\n2) Personal data is scrubbed out of free-text error messages (PDPA)');
{
  const c = makeCtx();
  c.handlePerfLog({ sid: 'x', rows: [row({ t: 'err', a: 'onerror', c: 'failed for STD-0123 parent bob.smith@mail.com uid Ua1b2c3d4e5f6a7b8c9d0e1 tel 0812345678' })] });
  const code = c.__sheets.PERF_LOG.rows[1][7];
  ok_('student id removed', code.indexOf('STD-0123') < 0 && code.indexOf('STD-…') >= 0);
  ok_('email removed', code.indexOf('bob.smith@mail.com') < 0);
  ok_('LINE uid removed', code.indexOf('Ua1b2c3d4e5f6a7b8c9d0e1') < 0);
  ok_('phone number removed', code.indexOf('0812345678') < 0);
}

console.log('\n3) The role is taken from the verified session, never from the client');
{
  const c = makeCtx();
  // a caller claiming to be Admin, with no session at all
  c.handlePerfLog({ sid: 'x', role: 'Admin', Role: 'Admin', rows: [row({})] });
  eq('no session -> anon (client claim ignored)', c.__sheets.PERF_LOG.rows[1][2], 'anon');
  c.handlePerfLog({ sid: 'x', role: 'Admin', __sess: { role: 'Parent' }, rows: [row({})] });
  eq('session wins over client claim', c.__sheets.PERF_LOG.rows[2][2], 'Parent');
}

console.log('\n4) Flood control: a runaway client cannot fill the sheet');
{
  const c = makeCtx();
  const many = []; for (let i = 0; i < 500; i++) many.push(row({}));
  const r = c.handlePerfLog({ sid: 'x', rows: many });
  eq('capped at 60 rows per call', r.written, 60);
  eq('sheet holds header + 60', c.__sheets.PERF_LOG.rows.length, 61);
}
{
  const c = makeCtx();
  c.PERF_MAX_KEEP = 100;
  for (let i = 0; i < 5; i++) c.handlePerfLog({ sid: 'x', rows: Array.from({ length: 60 }, () => row({})) });
  ok_('sheet trimmed to the cap (' + (c.__sheets.PERF_LOG.rows.length - 1) + ' rows)', c.__sheets.PERF_LOG.rows.length - 1 <= 100);
}

console.log('\n5) Telemetry never throws — a failure here must not become a user-facing error');
{
  const c = makeCtx();
  eq('rows not an array', c.handlePerfLog({ sid: 'x', rows: 'boom' }).ok, false);
  eq('no payload at all', c.handlePerfLog(null).written, 0);
  eq('rows full of junk', c.handlePerfLog({ rows: [null, undefined, 5, 'x'] }).written, 4);
  c.__setLock(false);
  eq('lock busy -> dropped, not thrown', c.handlePerfLog({ sid: 'x', rows: [row({})] }).skipped, 'busy');
}
{
  const c = makeCtx({ PerfLog: 'off' });
  eq('config off -> collects nothing', c.handlePerfLog({ sid: 'x', rows: [row({})] }).skipped, 'off');
  ok_('and no sheet is even created', !c.__sheets.PERF_LOG);
}
{
  const c = makeCtx();
  c.getMainSpreadsheet_ = () => { throw new Error('sheets down'); };
  eq('spreadsheet unreachable -> ok:false, no throw', c.handlePerfLog({ sid: 'x', rows: [row({})] }).ok, false);
}

console.log('\n6) Numbers are coerced, never trusted');
{
  const c = makeCtx();
  c.handlePerfLog({ sid: 'x'.repeat(999), dev: 'y'.repeat(99), rows: [row({ ms: -50, b: 99999, a: 'z'.repeat(200) })] });
  const r = c.__sheets.PERF_LOG.rows[1];
  eq('negative duration -> 0', r[5], 0);
  eq('absurd batch size clamped', r[8], 50);
  eq('action name capped at 40', r[4].length, 40);
  eq('sid capped at 20', r[1].length, 20);
  eq('device capped at 10', r[10].length, 10);
}

console.log('\n7) The summary answers the four Phase 0 questions');
{
  const c = makeCtx();
  const mk = (o, n) => Array.from({ length: n || 1 }, () => row(o));
  c.handlePerfLog({ sid: 'a', dev: 'iOS', net: '4g', ver: 'v187', hit: 90, miss: 10, rows: [].concat(
    mk({ a: 'financeSummary', ms: 2000 }, 10),   // slow AND frequent -> should rank first
    mk({ a: 'oneOff', ms: 5000 }, 1),            // slower, but once -> ranks lower
    mk({ a: 'dashboard', ms: 120 }, 30),
    mk({ a: 'payments', ms: 300, ok: 0, c: 'NO_SESSION' }, 4),
    mk({ t: 'nav', a: 'finance', ms: 3200 }, 3),
    mk({ t: 'nav', a: 'home', ms: 400 }, 5),
    mk({ t: 'err', a: 'screen:finance', c: 'BAD_RESPONSE' }, 2)
  ) });
  c.handlePerfLog({ sid: 'b', dev: 'Android', net: '3g', rows: mk({ t: 'err', a: 'screen:finance', c: 'BAD_RESPONSE' }, 1) });

  const s = c.handlePerfSummary({ days: 7 });
  eq('two distinct sessions counted', s.sessions, 2);
  eq('ranked by total waiting time, not by single-call slowness', s.slowest[0].action, 'financeSummary');
  ok_('the one-off 5s call ranks below it', s.slowest.findIndex(x => x.action === 'oneOff') > 0);
  eq('slowest screen surfaced', s.slowScreens[0].screen, 'finance');
  eq('the top problem is the one that hit the most PEOPLE', s.problems[0].what, 'screen:finance');
  eq('...and it hit 2 people', s.problems[0].users, 2);
  eq('failing action listed', s.failing[0].action, 'payments');
  eq('with its error code', s.failing[0].codes.NO_SESSION, 4);
  eq('cache hit rate', s.cacheRate, 90);
  eq('device breakdown present', s.byDev.map(d => d.dev).sort(), ['Android', 'iOS']);
  ok_('connection breakdown present', s.byNet.length >= 1);
  ok_('p95 is at least p50', s.p95 >= s.p50);
}
{
  const c = makeCtx();
  const s = c.handlePerfSummary({ days: 7 });
  eq('empty log reports empty, does not throw', s.empty, true);
  ok_('and says so in Thai', /ยังไม่มีข้อมูล/.test(s.note));
}
{
  const c = makeCtx();
  c.handlePerfLog({ sid: 'a', rows: [row({})] });
  // an old row must fall outside a 1-day window
  c.__sheets.PERF_LOG.rows[1][0] = '2020-01-01 00:00:00';
  eq('rows outside the window are excluded', c.handlePerfSummary({ days: 1 }).calls, 0);
  eq('days is clamped to <= 30', c.handlePerfSummary({ days: 9999 }).days, 30);
  eq('days is clamped to >= 1', c.handlePerfSummary({ days: -5 }).days, 1);
}

console.log('\n8) Clearing the log leaves the header intact');
{
  const c = makeCtx();
  c.handlePerfLog({ sid: 'a', rows: [row({}), row({})] });
  eq('cleared 2', c.handlePerfClear({}).cleared, 2);
  eq('header survives', c.__sheets.PERF_LOG.rows.length, 1);
  eq('clearing an empty log is a no-op', c.handlePerfClear({}).cleared, 0);
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' : 'ALL PASS ') + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
