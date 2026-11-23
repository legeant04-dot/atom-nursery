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
 *
 * UAT build (2026-11-14 · docs/UAT_CHECKLIST.md):
 *   node tools/build_web.js --uat --fast <Cloud Run UAT url> --gas <UAT Apps Script /exec url> --liff <UAT LIFF id> [outDir]
 *   (default outDir dist_uat/) — the same app with FAST_URL + GAS_URL of the UAT copy and FAST_WRITES on,
 *   a separate service-worker cache, and a "UAT" badge so nobody mistakes it for the real app.
 *   🔴 Refuses the LIVE Apps Script URL, and anything not https Cloud Run / script.google.com.
 *   🔴 --liff is REQUIRED (2026-11-16): without it the UAT page kept the live LIFF, whose endpoint is the LIVE
 *      site — signing in with LINE on UAT would have landed testers in the real app. The live id is refused.
 *   webapp/ is never changed — the overrides exist only in the output.
 */
const fs = require('fs'), path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'webapp');
const ARGV = process.argv.slice(2);
const UAT = ARGV.includes('--uat');
const flag = n => { const i = ARGV.indexOf(n); return i >= 0 ? String(ARGV[i + 1] || '') : ''; };
const POS = ARGV.filter((a, i) => a.indexOf('--') !== 0 && !['--fast', '--gas', '--liff'].includes(ARGV[i - 1]));
const OUT = path.resolve(ROOT, POS[0] || (UAT ? 'dist_uat' : 'dist_pages'));
const die = m => { console.error('build_web: ' + m); process.exit(1); };
const UAT_FAST_RE = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.run\.app\/?$/;
const UAT_GAS_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/;
const UAT_LIFF_RE = /^[0-9]{10}-[A-Za-z0-9]{8}$/;
let UAT_FAST = '', UAT_GAS = '', UAT_LIFF = '';
if (UAT) {
  UAT_FAST = flag('--fast'); UAT_GAS = flag('--gas');
  if (!UAT_FAST_RE.test(UAT_FAST)) die('--uat needs --fast <https://…run.app> (got "' + UAT_FAST + '")');
  if (!UAT_GAS_RE.test(UAT_GAS)) die('--uat needs --gas <https://script.google.com/macros/s/…/exec> (got "' + UAT_GAS + '")');
  const live = /GAS_URL: '([^']*)'/.exec(fs.readFileSync(path.join(SRC, 'api.js'), 'utf8'));
  if (!live) die('cannot find GAS_URL in webapp/api.js');
  if (live[1] === UAT_GAS) die('🔴 --gas is the LIVE Apps Script — UAT must use its own copy');
  UAT_LIFF = flag('--liff');
  if (!UAT_LIFF_RE.test(UAT_LIFF)) die('--uat needs --liff <UAT LIFF id, e.g. 1234567890-AbCdEfGh> (got "' + UAT_LIFF + '")');
  const liveLiff = /LIFF_ID: '([^']*)'/.exec(fs.readFileSync(path.join(SRC, 'api.js'), 'utf8'));
  if (liveLiff && liveLiff[1] === UAT_LIFF) die('🔴 --liff is the LIVE LIFF — its endpoint is the real app; UAT needs its own');
}
/** the UAT overrides, applied to the OUTPUT only (before minify) — each must match exactly once */
function uatize(rel, text) {
  if (!UAT) return text;
  const once = (t, re, to, what) => { const n = (t.match(re) || []).length; if (n !== 1) die('UAT: ' + what + ' matched ' + n + '×'); return t.replace(re, to); };
  if (rel === 'api.js') {
    // ...from today's build (FAST_URL '') or the move-night one (FAST_WRITES + production host) alike
    text = once(text, /window\.CONFIG = \{ (?:FAST_WRITES: true, )?FAST_URL: '[^']*',/g, "window.CONFIG = { FAST_WRITES: true, FAST_URL: '" + UAT_FAST.replace(/\/$/, '') + "',", 'CONFIG.FAST_URL');
    text = once(text, /LIFF_ID: '[^']*'/g, "LIFF_ID: '" + UAT_LIFF + "'", 'CONFIG.LIFF_ID');
    return once(text, /GAS_URL: '[^']*'/g, "GAS_URL: '" + UAT_GAS + "'", 'CONFIG.GAS_URL');
  }
  if (rel === 'sw.js') return once(text, /atom-v(\d+)/g, 'atom-uat-v$1', 'sw cache name');
  if (rel === 'index.html') return once(text, /<\/body>/g,
    '<div style="position:fixed;top:0;left:0;z-index:99999;pointer-events:none;background:#d92d20;color:#fff;font:700 11px/1 sans-serif;padding:4px 8px;border-bottom-right-radius:8px">UAT · ข้อมูลทดสอบ</div></body>', 'index </body>');
  return text;
}

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
  if (UAT && (rel === 'api.js' || rel === 'sw.js' || rel === 'index.html')) raw = Buffer.from(uatize(rel, raw.toString('utf8')), 'utf8');
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
console.log(`${path.basename(OUT)}${UAT ? ' (UAT)' : ''}: ${files.length} files (${min} minified) — ${kb(before)} -> ${kb(after)}`);
console.log(`version: ${VER} (from APP_VERSION)` + (stamped ? ` — stamped into ${stamped} file(s) that were out of step` : ' — sources already matched'));
