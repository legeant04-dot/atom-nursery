/**
 * tools/test_perf_hour.js — Phase 1: answer a complaint about a TIME with a time.
 *   node tools/test_perf_hour.js
 *
 * The director reported the app being slow "ช่วงค่ำ" on 10/09/26, and the speed report could say
 * nothing whatever about that: every figure in it was a total across two and a half days. The
 * timestamp has been on every row since the first version — nothing was reading it.
 *
 * Two additions, and they answer different halves of the same question:
 *
 *   BY HOUR — the shape of the day. Is the evening actually worse, and does it land on the 18:30
 *   and 20:00 triggers, which run as the same Google account every request in the school runs as?
 *
 *   SLOWEST SINGLE CALLS — the opposite of a percentile. `finance p95=125.9s` on a screen visited
 *   twelve times IS one or two visits, and averaging them away turns a two-minute wait into a number
 *   nobody can act on. With a stamp on it, it becomes a moment that can be looked at.
 *
 * Neither is a fix. Both exist so that Phase 2 is chosen from numbers instead of from a hunch — the
 * discipline that has paid for itself repeatedly in this project, most recently when a whole day was
 * spent chasing a LINE ID that turned out not to be the right one.
 */
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const perf = R('src/Perf.gs'), app = R('webapp/app.js'), api = R('webapp/api.js');
const srcCode = s => s.replace(/image\/\*/g, 'image_ANY')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** the real handlePerfSummary, over rows shaped exactly like the sheet's */
function summarise(rows) {
  const H = require(path.join(__dirname, 'gas_test_harness.js'));
  const { run } = H(['Config', 'Db', 'Perf']);
  // the rows are baked into the source: `run` stringifies the function, and a bound function has no
  // readable body
  return JSON.parse(run(new Function(`
    var main = SpreadsheetApp.create('MAIN'), hr = SpreadsheetApp.create('HR');
    PropertiesService.getScriptProperties().setProperty('WB_MAIN_ID', main.getId());
    PropertiesService.getScriptProperties().setProperty('WB_HR_ID', hr.getId());
    main.insertSheet('SCHOOL_CONFIG').appendRow(['Key', 'Value']);
    var sh = main.insertSheet('PERF_LOG');
    sh.appendRow(PERF_HEADERS);
    ${JSON.stringify(rows)}.forEach(function (r) { sh.appendRow(r); });
    return JSON.stringify(handlePerfSummary({ days: 7 }));
  `)));
}
// today's date in the LOCAL day, the way the engine and perfStamp_ both work
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const TODAY = ymd(new Date());
const row = (hh, mm, action, ms, opts) => {
  const o = opts || {};
  return [TODAY + ' ' + hh + ':' + mm + ':00', o.sid || 'S1', o.role || 'admin', 'api', action,
    ms, o.ok === false ? 0 : 1, o.code || '', 1, o.screen || 'home', o.dev || 'Desktop', '4g', 0, 'v1', ''];
};

console.log('1) the shape of the day');
{
  const res = summarise([
    row('09', '00', 'dashboard', 1000), row('09', '10', 'dashboard', 2000),
    row('20', '05', 'financeSummary', 30000, { sid: 'S2' }),
    row('20', '30', 'dashboard', 40000, { sid: 'S3' }),
    row('20', '40', 'dashboard', 50000, { sid: 'S3' })
  ]);
  const byHour = {}; (res.byHour || []).forEach(h => { byHour[h.hour] = h; });
  // p50 is the report's own nearest-rank percentile, the same one every other section uses — with
  // two samples it is the upper. Matched here rather than re-implemented, or the hourly figures
  // would mean something subtly different from the ones printed beside them.
  eq('the morning is its own bucket', [byHour['09'].n, byHour['09'].p50], [2, 2000]);
  eq('...and the evening its own', byHour['20'].n, 3);
  ok_('...and the evening is measurably worse, which is the whole question', byHour['20'].p50 > byHour['09'].p50);
  eq('sessions are counted per hour, not calls', [byHour['09'].sessions, byHour['20'].sessions], [1, 2]);
  /* IN CLOCK ORDER, never re-sorted by badness — the point is to read it against a clock, and an
   * ordering by size makes "is the evening worse" unanswerable at a glance. */
  eq('the hours come back in clock order', (res.byHour || []).map(h => h.hour), ['09', '20']);
  eq('an hour nobody used is simply absent', (res.byHour || []).length, 2);
}
{
  // a REFUSAL is not a failure here either — the same rule the rest of the report already follows
  const res = summarise([
    row('07', '30', 'staffCheckin', 900, { ok: false, code: 'OUT_OF_RANGE' }),
    row('07', '35', 'staffCheckin', 900, { ok: false, code: 'INTERNAL' })
  ]);
  const h7 = (res.byHour || []).find(h => h.hour === '07');
  eq('the hour counts both calls', h7.n, 2);
  eq('...but only the real failure', [h7.fail, h7.rate], [1, 50]);
}

console.log('\n2) the individual worst moments, with their stamps');
{
  const res = summarise([
    row('20', '14', 'financeSummary', 125900, { screen: 'finance', role: 'admin' }),
    row('08', '02', 'parentHome', 5000, { screen: 'home', role: 'parent' }),
    row('21', '00', 'dashboard', 61000, { screen: 'home', role: 'admin', ok: false, code: 'BUSY' })
  ]);
  const sm = res.slowMoments || [];
  eq('only the slow ones are kept', sm.map(x => x.action), ['financeSummary', 'dashboard']);
  eq('...worst first', sm[0].ms, 125900);
  ok_('...with the exact moment it happened', sm[0].ts.indexOf('20:14') > 0);
  eq('...and who was where', [sm[0].screen, sm[0].role, sm[0].dev], ['finance', 'admin', 'Desktop']);
  eq('...and whether it even succeeded', [sm[1].ok, sm[1].code], [false, 'BUSY']);
  eq('the threshold is reported, so the list cannot be misread as "everything"', res.slowMs, 20000);
}
{
  /* THE COLLISION THIS NEARLY SHIPPED WITH. `slowest` already existed — the per-ACTION list, whose
   * `.ms` is an ARRAY. A second `var slowest` in the same function is the same binding, so the new
   * rows were destroyed and then the old list was re-sorted by subtracting two arrays. Both must
   * survive, and they are different shapes. */
  const res = summarise([row('20', '14', 'financeSummary', 125900), row('09', '00', 'dashboard', 1000)]);
  ok_('the per-action SLOWEST list still works', (res.slowest || []).some(x => x.action === 'financeSummary' && x.n === 1));
  ok_('...and is a different thing from the per-moment list', !(res.slowest || [])[0].ts);
  ok_('...which the source keeps under its own name', /var SLOW_MS = 20000, slowMoments = \[\];/.test(perf)
    && /var slowest = Object\.keys\(acts\)/.test(perf));
}

console.log('\n3) the report prints both');
{
  const c = srcCode(app);
  ok_('by hour', /L\.push\('BY HOUR \(เวลาไทย\):'\)/.test(c));
  ok_('...in clock order, as the server sent them', /d\.byHour\.forEach/.test(c) && !/byHour[\s\S]{0,60}\.sort\(/.test(c));
  ok_('the worst single calls', /SLOWEST SINGLE CALLS \(over/.test(c));
  ok_('...with the stamp first, because that is what is being looked up', /x\.ts\+'  '\+ms\(x\.ms\)/.test(c));
  ok_('nothing else in the report moved', /L\.push\('NETWORK: '\+\(d\.byNet\|\|\[\]\)\.filter\(x=>x\.net\)\.map\(x=>x\.net\+' x'\+x\.n\+' p50='\+ms\(x\.p50\)\)\.join\(' \| '\)\);/.test(c));
}

console.log('\n4) a lost reply is retried at once, because nothing ran');
{
  const a = srcCode(api);
  /* The mechanism stopped being a guess when the 08–11/09 report printed the three fields the code
   * had asked for: `batch got health http=200 redirected via=script.googleusercontent.com`. A POST
   * is answered with a 302, the browser re-issues a 302'd POST as a GET, and doGet answers with the
   * health check. Nothing executed — so there is nothing to let settle. */
  ok_('the first retry no longer waits', /if \(attempt > 0\) await sleep\(400 \* attempt\);/.test(a));
  ok_('...and the second still backs off, where the cause is no longer known', /400 \* attempt/.test(a));
  ok_('a WRITE is still never repeated on its own', /canRepeat\(body\) && attempt < 2/.test(a));
  ok_('...and the diagnostics that identified it are still recorded', /' http=' \+ r\.status/.test(a));
}

console.log(fail ? `\nFAILED ${pass} passed, ${fail} failed` : `\nPASSED ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
