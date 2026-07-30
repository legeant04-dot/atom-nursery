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

fs.rmSync(OUT, { recursive: true, force: true });
const files = walk(SRC);
let before = 0, after = 0, min = 0;

for (const rel of files) {
  const from = path.join(SRC, rel), to = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const raw = fs.readFileSync(from);
  before += raw.length;
  const ext = path.extname(rel).toLowerCase();
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
