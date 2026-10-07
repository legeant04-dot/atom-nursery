/**
 * tools/test_inline_handlers.js — every onclick in the app must reach a function that exists.
 *   node tools/test_inline_handlers.js
 *
 * WHY THIS SUITE EXISTS. app.js is one IIFE, and almost every control in this app is an inline
 * `onclick="..."` attribute written into a template string. Those attributes run in GLOBAL scope.
 * Anything the IIFE keeps to itself — `toast`, `err`, `modal`, every helper — is simply NOT THERE
 * when the attribute fires, and the failure is a ReferenceError in a console nobody has open.
 *
 * Found 2026-10-07 while checking the whole app over: the callback-URL box in the LINE sign-in check
 * called `toast(...)` from its onclick. Tapping it copied the URL (that was the left half of an `&&`)
 * and then threw, so the admin was never told it had worked. One dead reference in 505 — exactly the
 * kind of thing that is invisible to every other test here, because nothing clicks it.
 *
 * It is a whole-file audit rather than a list of known names: a new screen written tomorrow is
 * covered the moment it is saved, which is the only way a check like this stays true.
 */
const path = require('path'), fs = require('fs');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js');

/* WHAT THE BROWSER WILL HAVE WHEN THE ATTRIBUTE FIRES: anything any module hung on `window`, plus
 * top-level function declarations, plus the language's own built-ins. Nothing else. */
const BUILTIN = new Set(['String','Number','Math','JSON','Date','Object','Array','Promise','RegExp','Set','Map',
  'Function','parseInt','parseFloat','isNaN','encodeURIComponent','decodeURIComponent','alert','confirm','prompt',
  'setTimeout','clearTimeout','setInterval','console','document','window','navigator','location','event','this']);
const defined = new Set(BUILTIN);
for (const f of ['webapp/app.js', 'webapp/api.js', 'webapp/i18n.js', 'webapp/xlsx_min.js']) {
  const s = R(f);
  for (const m of s.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1]);
  for (const m of s.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
}

/* EVERY NAME CALLED FROM AN INLINE HANDLER.
 *
 * Two things are deliberately NOT counted, because neither runs at click time:
 *   · anything inside a `${...}` — that is evaluated while the HTML is being BUILT, in module scope,
 *     where the private helpers are perfectly visible (A_otMonth('${monthStr()}') is correct code);
 *   · a method call, `x.foo()` — the dot means it is looked up on an object, not in scope.
 */
/* ...and three more that are not calls at all, each of which this detector flagged on its first run:
 *   · `if (`, `catch (` — keywords;
 *   · `:not([disabled])` — a CSS pseudo-class inside a quoted selector, where the character before
 *     the name is a colon rather than a dot. */
const KEYWORD = new Set(['if','for','while','switch','catch','return','typeof','function','new','do','else','await','delete','void','in','of','try']);
function handlerCalls(src) {
  const found = new Map();            // name -> a sample of the attribute it was seen in
  const attr = /\son(?:click|change|input|submit|keydown|keyup|blur|focus)\s*=\s*(["'])([\s\S]*?)\1/g;
  for (const m of src.matchAll(attr)) {
    // drop the ${...} regions: those are render-time, not click-time
    let body = m[2], prev;
    do { prev = body; body = body.replace(/\$\{[^{}]*\}/g, ' '); } while (body !== prev);
    // a leading '.' is a method, a leading ':' is a CSS pseudo-class — neither is a scope lookup
    for (const c of body.matchAll(/(?:^|[^.:\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (!KEYWORD.has(c[1]) && !found.has(c[1])) found.set(c[1], m[2].slice(0, 90));
    }
  }
  return found;
}

console.log('\n1) 🔴 no inline handler calls something that is not there');
{
  const calls = handlerCalls(app);
  ok_('the audit actually found handlers to check', calls.size > 100);
  const missing = [...calls.keys()].filter(n => !defined.has(n)).sort();
  eq('🔴 every name an onclick calls is a global', missing.map(n => n + '  ← ' + calls.get(n)), []);
}

console.log('\n2) the audit can still see a dead handler when there is one');
{
  /* A CHECK THAT CANNOT FAIL IS NOT A CHECK. The real file is clean, so the detector is run against
   * a deliberately broken copy — otherwise a regex that silently stopped matching anything would
   * report "all clear" for ever. */
  const broken = app + '\n  const x = `<button onclick="thisDoesNotExistAnywhere()">x</button>`;\n';
  const miss = [...handlerCalls(broken).keys()].filter(n => !defined.has(n));
  eq('🔴 a planted dead handler IS caught', miss, ['thisDoesNotExistAnywhere']);
  // ...and the two things it must NOT flag
  const okCases = '\n  const a = `<button onclick="A_otMonth(\'${monthStr()}\')">x</button>`;' +
                  '\n  const b = `<button onclick="this.closest(\'.modal\').remove()">x</button>`;';
  eq('a ${…} call is render-time and not flagged',
    [...handlerCalls(okCases).keys()].filter(n => !defined.has(n)), []);
}

console.log('\n3) the one it found, and the fix for it');
{
  /* toast() lives inside the IIFE and is used from forty places in module scope, which is right. It
   * was used from ONE onclick, which was not. The replacement is a real global, and it also answers
   * the case the old line never did: navigator.clipboard is absent outside a secure context, where
   * the previous code silently did nothing at all. */
  ok_('🔴 no onclick calls toast() any more', ![...handlerCalls(app).keys()].includes('toast'));
  ok_('toast is still module-private, as it should be', !/window\.toast\s*=/.test(app));
  ok_('🔴 there is a global for copying instead', /window\.COPY_ = \(text\) =>/.test(app));
  ok_('...and the callback-URL box uses it', /onclick="COPY_\(this\.textContent\)"/.test(app));
  ok_('🔴 ...which says so when the clipboard is unavailable, instead of doing nothing',
    /Select the text and copy it by hand|กรุณาเลือกข้อความแล้วคัดลอกเอง/.test(app));
  ok_('...and when the browser refuses the write, which is a different failure',
    /Could not copy|คัดลอกอัตโนมัติไม่ได้/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
