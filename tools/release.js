/**
 * tools/release.js — bump the version in ONE place and prove the build still holds.
 *   node tools/release.js            → next version (255 -> 256)
 *   node tools/release.js 260        → that version
 *   node tools/release.js --check    → change nothing; just verify the three agree
 *
 * A release used to mean editing three things by hand: APP_VERSION in app.js, ?v=NN seven times in
 * index.html, and CACHE in sw.js. Missing one is not an error anybody sees — it is a browser serving
 * last week's app.js beside this week's index.html until the cache expires, and nothing on the
 * outside says so. It had to be remembered, every time, by a person.
 *
 * Now APP_VERSION is the only one edited; this writes the other two and build_web.js stamps the
 * OUTPUT from the same source, so the deployed copy cannot be inconsistent whatever state the
 * sources are in. tools/test_release_version.js fails if any of that is undone.
 *
 * It deliberately does NOT deploy. Deciding to put something in front of a school is a person's job.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const P = {
  app: path.join(ROOT, 'webapp', 'app.js'),
  html: path.join(ROOT, 'webapp', 'index.html'),
  sw: path.join(ROOT, 'webapp', 'sw.js')
};
const read = f => fs.readFileSync(f, 'utf8');
const VER_RE = /(APP_VERSION\s*=\s*'Version\s+)(\d+)\.(\d+)(')/;

function current() {
  const m = VER_RE.exec(read(P.app));
  if (!m) { console.error('release: cannot find APP_VERSION in webapp/app.js'); process.exit(1); }
  return { major: m[1].length ? m[2] : '1', minor: Number(m[3]) };
}

/** What each file SAYS the version is — the three numbers that have to agree. */
function state() {
  const cur = current();
  const html = read(P.html), sw = read(P.sw);
  const hv = [...html.matchAll(/\?v=(\d+)/g)].map(x => x[1]);
  const sv = (/atom-v(\d+)/.exec(sw) || [])[1];
  return { app: String(cur.minor), major: cur.major, html: hv, sw: sv,
           htmlSet: [...new Set(hv)], count: hv.length };
}

function check() {
  const s = state();
  const bad = [];
  if (s.htmlSet.length > 1) bad.push('index.html has mixed ?v= values: ' + s.htmlSet.join(', '));
  if (s.htmlSet.length && s.htmlSet[0] !== s.app) bad.push('index.html ?v=' + s.htmlSet[0] + ' but APP_VERSION is ' + s.app);
  if (s.sw !== s.app) bad.push('sw.js CACHE atom-v' + s.sw + ' but APP_VERSION is ' + s.app);
  if (!s.count) bad.push('index.html has no ?v= at all — the cache-buster is gone');
  return { ok: !bad.length, problems: bad, state: s };
}

function write(next) {
  const cur = current();
  fs.writeFileSync(P.app, read(P.app).replace(VER_RE, (m, a, maj, min, z) => a + maj + '.' + next + z));
  fs.writeFileSync(P.html, read(P.html).replace(/\?v=\d+/g, '?v=' + next));
  fs.writeFileSync(P.sw, read(P.sw).replace(/atom-v\d+/g, 'atom-v' + next));
  return { from: cur.minor, to: next };
}

const arg = process.argv[2];
if (arg === '--check') {
  const r = check();
  if (r.ok) { console.log('version ' + r.state.major + '.' + r.state.app + ' — app.js, index.html (×' + r.state.count + ') and sw.js all agree'); process.exit(0); }
  r.problems.forEach(p => console.error('  ✗ ' + p));
  console.error('run: node tools/release.js ' + r.state.app + '   (to make them agree without bumping)');
  process.exit(1);
}
const next = arg ? Number(arg) : current().minor + 1;
if (!Number.isFinite(next) || next <= 0) { console.error('release: give a version number, or nothing for the next one'); process.exit(1); }
const done = write(next);
const after = check();
if (!after.ok) { after.problems.forEach(p => console.error('  ✗ ' + p)); process.exit(1); }
console.log('version ' + done.from + ' -> ' + done.to + '  (app.js, index.html ×' + after.state.count + ', sw.js)');
console.log('next: node tools/build_engine.js && node tools/build_web.js');
