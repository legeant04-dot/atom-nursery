/**
 * tools/test_all.js — run every suite, and say plainly whether the tree is shippable.
 *   node tools/test_all.js            all of them
 *   node tools/test_all.js perf ot    only suites whose name contains one of these
 *
 * There are sixty-odd suites and they were run with a shell loop that had to be typed correctly each
 * time. A check nobody can run in one keystroke is a check that gets skipped on the release where it
 * mattered — so this is the keystroke.
 *
 * It also runs the two things that are not "tests" but decide whether a build is coherent at all:
 * the version consistency check, and rebuilding the engine (src/Engine.gs is generated from
 * webapp/engine.js — a stale copy means the suites pass against code the server will not run).
 */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const want = process.argv.slice(2).filter(a => a[0] !== '-');

function run(cmd, label) {
  const t0 = Date.now();
  try {
    const out = cp.execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 }).toString();
    return { ok: true, ms: Date.now() - t0, out: out, label: label };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, label: label,
             out: String((e.stdout || '')) + String((e.stderr || '')) };
  }
}
// the last line with a count on it — every suite prints one, in one of two house styles
function tally(out) {
  const lines = out.trim().split('\n').filter(l => /(passed|PASS|checks|failed)/i.test(l));
  return (lines[lines.length - 1] || '').trim().replace(/^[✅❌]\s*/, '');
}

const results = [];
if (!want.length) {
  // a stale generated engine makes every engine suite a lie — rebuild before believing any of them
  const g = run('node tools/build_engine.js', 'build_engine');
  results.push(g);
  if (!g.ok) { console.error('build_engine FAILED — stopping\n' + g.out); process.exit(1); }
  results.push(run('node tools/release.js --check', 'version consistency'));
}

const suites = fs.readdirSync(path.join(ROOT, 'tools'))
  .filter(f => /^test_.*\.js$/.test(f) && f !== 'test_all.js')
  .filter(f => !want.length || want.some(w => f.indexOf(w) >= 0))
  .sort();

let failed = 0;
suites.forEach(f => {
  const r = run('node tools/' + f, f);
  const t = tally(r.out);
  /* A SUITE THAT PRINTS NO SUMMARY HAS NOT PASSED — it has stopped. test_notify_parent.js threw a
   * ReferenceError before its first assertion for six releases and the old shell sweep, which looked
   * for the word FAIL, called it clean the whole time. Silence is the one result a test may never
   * give. */
  const mute = r.ok && !t;
  if (!r.ok || mute) failed++;
  results.push(r);
  console.log((r.ok && !mute ? '  ok   ' : '  FAIL ') + f.replace(/\.js$/, '').padEnd(34) +
    (t || '(NO SUMMARY — it did not finish)'));
  if (mute) r.out.trim().split('\n').slice(-4).forEach(l => console.log('        ' + l.trim()));
  if (!r.ok) r.out.split('\n').filter(l => /^\s*FAIL /.test(l)).slice(0, 6).forEach(l => console.log('        ' + l.trim()));
});

const pre = results.filter(r => !/^test_/.test(r.label));
pre.forEach(r => { if (!r.ok) { failed++; console.log('  FAIL ' + r.label.padEnd(34) + r.out.trim().split('\n')[0]); } });

const secs = (results.reduce((a, r) => a + r.ms, 0) / 1000).toFixed(1);
console.log('\n' + (failed ? '❌ ' + failed + ' of ' : '✅ all ') + suites.length + ' suites' +
  (failed ? '' : ' + ' + pre.length + ' checks') + ' — ' + secs + 's');
if (!failed && !want.length) console.log('shippable: node tools/release.js && node tools/build_web.js');
process.exit(failed ? 1 : 0);
