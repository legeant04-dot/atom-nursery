/**
 * tools/test_release_version.js — one version number, and a build that cannot ship a mixed one.
 *   node tools/test_release_version.js
 *
 * A release used to mean editing three things by hand: APP_VERSION in app.js, ?v=NN seven times in
 * index.html, and CACHE in sw.js. Missing one is not an error anybody sees — it is a browser serving
 * last week's app.js beside this week's index.html for as long as the cache lasts, with nothing on
 * the outside to say so. It had to be remembered, correctly, by a person, every single time.
 *
 * Now: APP_VERSION is the only one edited, tools/release.js writes the other two, and build_web.js
 * stamps the OUTPUT from the same source — so the deployed copy is coherent whatever state the
 * sources are left in. This file exists so none of that can be quietly undone.
 */
const fs = require('fs'), path = require('path'), cp = require('child_process');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond, detail) { console.log((cond ? '  ok   ' : '  FAIL ') + label + (cond || !detail ? '' : '  → ' + detail)); cond ? pass++ : fail++; }
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const app = read('webapp/app.js'), html = read('webapp/index.html'), sw = read('webapp/sw.js');
const build = read('tools/build_web.js'), rel = read('tools/release.js');

console.log('\n1) the three agree right now');
{
  const ver = (/APP_VERSION\s*=\s*'Version\s+\d+\.(\d+)'/.exec(app) || [])[1];
  const hv = [...new Set([...html.matchAll(/\?v=(\d+)/g)].map(x => x[1]))];
  const sv = (/atom-v(\d+)/.exec(sw) || [])[1];
  ok_('app.js declares a version', !!ver);
  eq('index.html asks for exactly one of them', hv.length, 1);
  eq('...and it is that one', hv[0], ver);
  eq('sw.js caches under the same one', sv, ver);
  ok_('index.html still busts the cache on every file', [...html.matchAll(/\?v=\d+/g)].length >= 6);
}

console.log('\n2) the check is a command, and it fails when it should');
{
  const run = args => { try { return { code: 0, out: cp.execSync('node tools/release.js ' + args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString() }; }
                        catch (e) { return { code: e.status || 1, out: String(e.stdout || '') + String(e.stderr || '') }; } };
  const r = run('--check');
  eq('a matching tree passes', r.code, 0);
  ok_('...and says so plainly', /all agree/.test(r.out), r.out.trim());

  // break it on purpose, in a copy of the tree's own file, then put it back
  const p = path.join(ROOT, 'webapp', 'sw.js'), original = fs.readFileSync(p);
  try {
    fs.writeFileSync(p, original.toString('utf8').replace(/atom-v\d+/, 'atom-v1'));
    const bad = run('--check');
    eq('a mismatched sw.js FAILS', bad.code, 1);
    ok_('...naming the file and both numbers', /sw\.js CACHE atom-v1 but APP_VERSION is \d+/.test(bad.out), bad.out.trim());
    ok_('...and saying how to fix it', /run: node tools\/release\.js \d+/.test(bad.out));
  } finally { fs.writeFileSync(p, original); }
  eq('...and the tree is left exactly as it was', run('--check').code, 0);
}

console.log('\n3) the BUILD stamps it, so a forgotten source cannot ship');
{
  ok_('the build reads APP_VERSION as the one source', /const VER_M = \/APP_VERSION\\s\*=\\s\*'Version\\s\+\\d\+\\\.\(\\d\+\)'\/\.exec\(APP_JS\)/.test(build)
    || /APP_VERSION\\s\*=\\s\*'Version/.test(build));
  ok_('...and refuses to build without it', /refusing to build/.test(build) && /process\.exit\(1\)/.test(build));
  ok_('index.html is stamped', /if \(rel === 'index\.html'\) return text\.replace\(\/\\\?v=\\d\+\/g, '\?v=' \+ VER\);/.test(build));
  ok_('sw.js is stamped', /if \(rel === 'sw\.js'\) return text\.replace\(\/atom-v\\d\+\/g, 'atom-v' \+ VER\);/.test(build));
  ok_('...before it is minified, or the replacement would miss', build.indexOf('stampVersion(rel, src0)') < build.indexOf('esbuild.transformSync'));
  ok_('and the build says which version it produced', /version: \$\{VER\} \(from APP_VERSION\)/.test(build));
}

console.log('\n4) the built output really is coherent');
{
  const out = path.join(ROOT, 'dist_pages');
  if (!fs.existsSync(path.join(out, 'index.html'))) {
    console.log('  (dist_pages not built yet — run node tools/build_web.js; skipping)');
  } else {
    const ver = (/APP_VERSION\s*=\s*'Version\s+\d+\.(\d+)'/.exec(app) || [])[1];
    const dh = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    const ds = fs.readFileSync(path.join(out, 'sw.js'), 'utf8');
    const da = fs.readFileSync(path.join(out, 'app.js'), 'utf8');
    eq('the shipped index.html asks for this version', [...new Set([...dh.matchAll(/\?v=(\d+)/g)].map(x => x[1]))], [ver]);
    eq('the shipped sw.js caches under it', (/atom-v(\d+)/.exec(ds) || [])[1], ver);
    ok_('the shipped app.js reports it', da.indexOf('Version 1.' + ver) > 0);
  }
}

console.log('\n5) release.js does the bumping, and nothing else');
{
  ok_('it writes all three', /fs\.writeFileSync\(P\.app,/.test(rel) && /fs\.writeFileSync\(P\.html,/.test(rel) && /fs\.writeFileSync\(P\.sw,/.test(rel));
  ok_('...and verifies itself afterwards', /const after = check\(\);/.test(rel));
  ok_('it does NOT deploy', !/clasp|deploy\(/.test(rel));
  ok_('...and says why that is deliberate', /Deciding to put something in front of a school is a person's job/.test(rel));
  ok_('the reason the whole thing exists is written down', /until the cache expires/.test(rel));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
