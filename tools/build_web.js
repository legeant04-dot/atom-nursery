/* build_web.js — produce the deployable copy of webapp/ with the JS and CSS minified.
 *
 * webapp/ stays the readable source of truth (it is also what runs when you open it directly);
 * CI publishes dist_pages/ instead. Nothing is bundled or renamed: every file keeps its name and
 * the ?v=NN query strings in index.html still line up, so the service worker and the three-place
 * version bump work exactly as before.
 *
 * Minify settings are deliberately conservative:
 *   - no property mangling and no toplevel mangling. app.js hangs ~200 handlers off `window` and
 *     index.html calls them from inline onclick=, plus A_gsOpen runs `new Function("A_x('id')")` —
 *     renaming a global would break all of that silently.
 *   - keeps the IIFE structure; only local identifiers and whitespace go.
 *
 * Usage: node tools/build_web.js [outDir]   (default dist_pages/)
 */
const fs = require('fs'), path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'webapp');
const OUT = path.resolve(ROOT, process.argv[2] || 'dist_pages');

function walk(dir, base) {
  base = base || dir; let out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) out = out.concat(walk(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/* ---- ONE version number ----------------------------------------------------------------------
 * A release used to mean editing three things: APP_VERSION in app.js, ?v=NN seven times in
 * index.html, and CACHE in sw.js. Miss one and the result is not an error — it is a browser serving
 * last week's app.js beside this week's index.html, for as long as the cache lasts, and no way to
 * tell from the outside.
 *
 * So APP_VERSION is now the only one anyone edits, and the BUILD stamps the other two. The output
 * cannot be inconsistent, whatever state the sources are left in; tools/release.js keeps the sources
 * matching too, so opening webapp/ directly behaves the same as the deployed copy.
 */
const APP_JS = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
const VER_M = /APP_VERSION\s*=\s*'Version\s+\d+\.(\d+)'/.exec(APP_JS);
if (!VER_M) { console.error('build_web: cannot find APP_VERSION in webapp/app.js — refusing to build'); process.exit(1); }
const VER = VER_M[1];
function stampVersion(rel, text) {
  if (rel === 'index.html') return text.replace(/\?v=\d+/g, '?v=' + VER);
  if (rel === 'sw.js') return text.replace(/atom-v\d+/g, 'atom-v' + VER);
  return text;
}

fs.rmSync(OUT, { recursive: true, force: true });
const files = walk(SRC);
let before = 0, after = 0, min = 0, stamped = 0;

for (const rel of files) {
  const from = path.join(SRC, rel), to = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  let raw = fs.readFileSync(from);
  before += raw.length;
  const ext = path.extname(rel).toLowerCase();
  if (rel === 'index.html' || rel === 'sw.js') {
    const src0 = raw.toString('utf8'), src1 = stampVersion(rel, src0);
    if (src1 !== src0) stamped++;
    raw = Buffer.from(src1, 'utf8');
  }
  if (ext === '.js' || ext === '.css') {
    const res = esbuild.transformSync(raw.toString('utf8'), {
      loader: ext === '.js' ? 'js' : 'css',
      minify: true,
      // ES2019 keeps optional chaining/nullish compiled away for older iPads while leaving
      // everything the app actually uses intact
      target: 'es2019',
      legalComments: 'none',
      charset: 'utf8',           // keep Thai as UTF-8 instead of \u escapes (smaller after gzip)
    });
    fs.writeFileSync(to, res.code);
    after += Buffer.byteLength(res.code); min++;
  } else {
    fs.writeFileSync(to, raw);
    after += raw.length;
  }
}
const kb = n => (n / 1024).toFixed(1) + ' KB';
console.log(`dist_pages: ${files.length} files (${min} minified) — ${kb(before)} -> ${kb(after)}`);
console.log(`version: ${VER} (from APP_VERSION)` + (stamped ? ` — stamped into ${stamped} file(s) that were out of step` : ' — sources already matched'));
