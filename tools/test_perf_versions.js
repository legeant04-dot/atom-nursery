/**
 * tools/test_perf_versions.js — which iOS, and which LINE app.
 *   node tools/test_perf_versions.js
 *
 * Asked 2026-09-08, after a parent who "used to get in" could not. Two things outside our code can
 * change the sign-in with no deploy from us:
 *
 *   · Safari's own storage rules — it deletes localStorage, IndexedDB and the service worker after
 *     7 days without the site being interacted with, which is where BOTH our session and LIFF's
 *     LINE session live. That behaviour differs by iOS version.
 *   · the LINE app, which is what actually performs the hand-off that fails.
 *
 * The device bucket answered "iPhone or Android" and no more, so both were guesses. This is the
 * column that ends the guessing.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const apijs = R('webapp/api.js'), perf = R('src/Perf.gs'), app = R('webapp/app.js');

/** run the REAL derivation out of api.js against a user agent we choose */
function osOf(ua) {
  const src = apijs.slice(apijs.indexOf('const osv = (function () {'), apijs.indexOf('const net = () =>'));
  const ctx = { navigator: { userAgent: ua }, console, RegExp, String };
  vm.createContext(ctx);
  vm.runInContext(src + '\n__out = osv;', ctx);
  return ctx.__out;
}

console.log('1) what the phone says about itself');
{
  // Safari on an iPhone
  eq('iPhone, Safari', osOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'), 'iOS17.5');
  // the same phone with the app opened INSIDE LINE — the version that performs the hand-off
  eq('iPhone, inside LINE', osOf('Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_10 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Line/14.2.0'), 'iOS16.7 L14.2.0');
  eq('Android, Chrome', osOf('Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36'), 'And13');
  eq('Android, inside LINE', osOf('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36 Line/14.1.1/IAB'), 'And14 L14.1.1');
  eq('an iPad reports its OS too', osOf('Mozilla/5.0 (iPad; CPU OS 15_8 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'), 'iOS15.8');
  // a desktop has neither, and an empty string is the honest answer — not a guess
  eq('a desktop says nothing', osOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'), '');
  eq('...and so does a user agent we cannot read', osOf(''), '');
}
{
  /* COARSE, like `dev`. A platform and two version numbers is a fact about SOFTWARE. It must not
   * become a fingerprint — no model, no build, no locale. */
  const long = osOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Line/14.2.0.1234567890');
  ok_('the value is capped', long.length <= 24);
  ok_('no device model is recorded', osOf('Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A) Line/14.2.0').indexOf('SM-A536E') < 0);
}

console.log('\n2) it reaches the sheet');
{
  ok_('the column is declared', /'Ver', 'Os'\]/.test(perf));
  ok_('...and sent by the client', /os: osv,/.test(apijs));
  ok_('...read from the payload, capped', /os = perfCell_\(p\.os, 24\)/.test(perf));
  ok_('...written on every row', /perfCell_\(r\.s, 30\), dev, net, pwa, ver, os\]/.test(perf));
  ok_('...including the cache rows, so a device is never half-recorded', (perf.match(/pwa, ver, os\]/g) || []).length >= 3);
  /* The LIVE sheet was created with the headers of its day. A column added later has to be named on
   * it too, or the rows carry a value under a blank heading. */
  ok_('an existing sheet gets the new heading', /if \(sh\.getLastColumn\(\) < PERF_HEADERS\.length\)/.test(perf));
  ok_('...and it only ever widens', !/deleteColumn|setNumColumns/.test(perf));
}

console.log('\n3) the report answers the question');
{
  ok_('rows are grouped by version', /var byOs = Object\.keys\(oss\)/.test(perf));
  ok_('...and returned to the client', /byOs: byOs/.test(perf));
  /* THE VERSION THAT CANNOT SIGN PEOPLE IN WILL NEVER BE THE BIGGEST BUCKET — a phone that cannot
   * get in makes very few calls, precisely because it cannot get in. Sorting by size would bury the
   * answer under the versions that are working. */
  ok_('sorted by sign-in faults first, not by size', /\(y\.signin - x\.signin\) \|\| \(y\.n - x\.n\)/.test(perf));
  ok_('...counting the two the client names for itself', /action === 'lineHandoff' \|\| action === 'lineStaleToken'/.test(perf));
  ok_('the admin report prints the section', /VERSIONS \(L = opened inside LINE\)/.test(app));
  ok_('...flagging the sign-in count', /sign-in x'\+x\.signin/.test(app));
  ok_('...and saying what L means, so nobody has to guess', /L = opened inside LINE/.test(app));
}

console.log('\n4) the numbers still add up per version');
{
  const seg = perf.slice(perf.indexOf('var byOs = Object.keys(oss)'), perf.indexOf('var byOs = Object.keys(oss)') + 600);
  ok_('sessions are counted, not calls', /Object\.keys\(o\.sids\)\.length/.test(seg));
  ok_('a failure rate is per version', /Math\.round\(o\.fail \/ o\.n \* 100\)/.test(seg));
  // an err row has no ms; counting it into the timing would drag the median of a broken phone to 0
  const errSeg = perf.slice(perf.indexOf("if (type === 'err')"), perf.indexOf("if (type === 'err')") + 900);
  ok_('an error row counts against the version but adds no timing', /oe\.n\+\+; oe\.fail\+\+;/.test(errSeg) && !/oe\.ms\.push/.test(errSeg));
}

console.log(fail ? `\nFAILED ${pass} passed, ${fail} failed` : `\nPASSED ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
