/**
 * tools/guard_lookups.js — one-shot repair: every `const x = studentById(...)` / `staffById(...)`
 * that is dereferenced on the spot without checking gets `|| {}`.
 *   node tools/guard_lookups.js [--check]
 *
 * The crash it prevents is the one reported as "dspmStatus INTERNAL ×4": a child or a staff member
 * who is no longer on the roll makes the lookup return undefined, and the next line reads a field
 * off it. The user sees "INTERNAL", which says nothing to them and nothing to us.
 *
 * `|| {}` is the right answer for a CALLER (no staff row = no permissions, which every one of these
 * already checks) and for LIST enrichment (one orphaned row must not take the whole list down).
 * Where a handler acts on ONE named child, an explicit NOT_FOUND was written by hand instead — this
 * script deliberately does not touch those, because "not found" is the answer the caller needs.
 *
 * Run with --check to fail (exit 1) without editing; tools/test_phase3_stability.js does the same
 * check on every run, so this file is the repair and that one is the guard.
 */
const fs = require('fs'), path = require('path');
const FILE = path.join(__dirname, '..', 'webapp', 'engine.js');
const CHECK = process.argv.indexOf('--check') >= 0;

const guardRe = v => new RegExp([
  'if\\s*\\(\\s*!' + v + '\\b',      // if (!s) …   /  if (!s || seen[..]) …
  '\\(\\s*' + v + '\\s*&&',          // if (s && …) /  return (s && canSee(s))
  'if\\s*\\(\\s*' + v + '\\s*\\)',   // if (s) { … }
  v + '\\s*\\|\\|\\s*\\{\\}',        // const s = … || {}
  v + '\\?\\.',                      // s?.x
  '!' + v + '\\.StaffID'             // the staff-lookup idiom used throughout
].join('|'));

function scan(lines) {
  for (let i = 0; i < lines.length; i++) {
    const m = /const (\w+)\s*=\s*(?:studentById|staffById_?)\(([^)]*)\)\s*;/.exec(lines[i]);
    if (!m) continue;
    const v = m[1], win = [lines[i], lines[i + 1] || '', lines[i + 2] || ''].join('\n');
    if (new RegExp('\\b' + v + '\\.[A-Za-z]').test(win) && !guardRe(v).test(win)) return { i, v };
  }
  return null;
}

let fixed = 0;
for (let round = 0; round < 60; round++) {
  const lines = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const hit = scan(lines);
  if (!hit) { console.log(fixed ? 'clean after ' + fixed + ' fixes' : 'clean — nothing to guard'); break; }
  if (CHECK) { console.log('UNGUARDED line ' + (hit.i + 1) + ': ' + lines[hit.i].trim().slice(0, 110)); process.exit(1); }
  const re = new RegExp('(const ' + hit.v + '\\s*=\\s*(?:studentById|staffById_?)\\([^)]*\\))\\s*;');
  lines[hit.i] = lines[hit.i].replace(re, '$1||{};');
  fs.writeFileSync(FILE, lines.join('\n'));
  fixed++;
  console.log('guarded line ' + (hit.i + 1) + ': ' + lines[hit.i].trim().slice(0, 90));
}
