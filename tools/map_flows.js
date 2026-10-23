/**
 * tools/map_flows.js — the app's navigation and data map, DERIVED FROM THE CODE.
 *   node tools/map_flows.js              สรุปบนหน้าจอ
 *   node tools/map_flows.js --json       เครื่องอ่าน
 *   node tools/map_flows.js --role Parent    เจาะทีละ Role
 *   node tools/map_flows.js --md docs/FLOWMAP.md   เขียนเป็นเอกสาร
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * ผอ. 2026-10-23: *"เรายังต้องสร้าง Data Flow ด้วยว่า กดอะไรไปไหน ได้อะไร ย้อนกลับไปเจออะไร ที่ไหน
 * ทุก Role ทุกปุ่ม ... เพื่อที่เราจะได้ออกแบบทั้งหมดให้ทำงานได้ถูกต้อง และรวมถึงวางรากฐานให้กับ
 * Operation System ด้วย"*
 *
 * 🔴 WHY THIS IS EXTRACTED AND NOT WRITTEN BY HAND.
 *
 * A hand-drawn flow chart is a photograph: correct the day it is taken, and silently wrong from the
 * next commit onward. Everything it would say is already IN the source — SCREENS declares the
 * screens, NAVS declares the tabs, GO() declares the edges, api() declares the data each screen
 * asks for, ROUTES/ADMIN_ONLY declare who may ask. So this READS the app rather than describing it,
 * and can be re-run after any change.
 *
 * It follows handlers transitively: a button `onclick="A_studentForm()"` is resolved to that
 * function's body, so the GO() and api() calls inside it belong to the screen that offers the
 * button — which is the question a designer actually has ("what happens when I tap this?").
 *
 * 🔴 WHAT IT CANNOT TELL YOU, stated so nobody mistakes the output for the whole answer:
 *   · what SHOULD happen — only what does
 *   · a screen that was never built is invisible here; absence is not in the source
 *   · nothing about whether an order of information is the RIGHT order
 * Those are the ผอ.'s, and they are the reason the map is an input to design, not a substitute.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), eng = R('webapp/engine.js'), code = R('src/Code.gs');
const L = app.split('\n');

const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const has = k => argv.includes(k);

/* ── 1. THE TABS, per role — the only screens reachable without tapping something first ───────── */
const navs = {};
{
  const m = app.match(/const NAVS = \{([\s\S]*?)\n  \};/);
  const body = m ? m[1] : '';
  for (const line of body.split('\n')) {
    const r = line.match(/^\s*(Parent|Teacher|Admin|Observer):\s*\[(.*)\],?\s*$/);
    if (!r) continue;
    navs[r[1]] = [...r[2].matchAll(/\['([a-zA-Z0-9_]+)'/g)].map(x => x[1]);
  }
}

/* ── 2. THE SCREENS, and the span of file each one owns ──────────────────────────────────────── */
const screens = [];
L.forEach((line, i) => {
  /* 🔴 EVERY assignment on the line, not the first. `SCREENS.Teacher.absence = absenceScreen;
   * SCREENS.Admin.absence = absenceScreen;` share one line, and reading only the first made the
   * map report four non-existent faults — Admin screens "jumping to a screen Admin does not have"
   * when Admin has it, on the same line. */
  for (const m of line.matchAll(/SCREENS\.(Parent|Teacher|Admin|Observer)\.([a-zA-Z0-9_]+)\s*=/g))
    screens.push({ role: m[1], name: m[2], line: i + 1 });
});
screens.sort((a, b) => a.line - b.line);

/* 🔴 THE SCREEN'S OWN BODY, by brace balance — not "everything until the next screen".
 *
 * The first version gave each screen the whole span up to the next SCREENS assignment, so every
 * helper function parked between two screens was attributed to the one above it. That is how the
 * map claimed Admin's chat screen navigates to the teacher's leave, schedule and slip screens: the
 * chat screen is 47 lines and the ~300 lines of shared helpers after it are not part of it.
 *
 * A screen body ends when the braces and parens opened on its assignment line come back to zero.
 * Strings and comments are skipped so a `{` inside a Thai label cannot end a screen early. */
const bodyEnd = (startLine) => {
  /* 🔴 A ONE-LINE SCREEN IS ONE LINE. `SCREENS.Admin.injuries = async () => A_injuries();` has no
   * braces of its own, so a brace scan runs on and adopts the NEXT function's body — which is how
   * the map blamed Admin's injuries screen for a GO('injury') that lives inside T_injurySave. */
  const first = L[startLine - 1] || '';
  if (!first.includes('{') && /;\s*$/.test(first.trim())) return startLine;
  let depth = 0, started = false;
  for (let i = startLine - 1; i < L.length && i < startLine + 6000; i++) {
    const line = L[i];
    let inS = null, j = 0;
    while (j < line.length) {
      const c = line[j], n2 = line.slice(j, j + 2);
      if (inS) { if (c === '\\') { j += 2; continue; } if (c === inS) inS = null; j++; continue; }
      if (c === '"' || c === "'" || c === '`') { inS = c; j++; continue; }
      if (n2 === '//') break;
      if (n2 === '/*') { const e = line.indexOf('*/', j + 2); if (e < 0) return null; j = e + 2; continue; }
      /* BRACES ONLY. Counting parens too made every screen end on its own first line —
       * `SCREENS.Parent.home = async (pre) => {` closes the parameter list before the body opens,
       * which collapsed 52 navigation edges to 4. A one-line screen with no braces falls back to
       * its single line, which is correct: that is all there is of it. */
      if (c === '{') { depth++; started = true; }
      else if (c === '}') { depth--; if (started && depth <= 0) return i + 1; }
      j++;
    }
  }
  return null;
};
screens.forEach((s, i) => {
  const hard = i + 1 < screens.length ? screens[i + 1].line - 1 : L.length;
  const brace = bodyEnd(s.line);
  s.end = brace && brace <= hard ? brace : hard;      // never run past the next screen
});

/* ── 3. EVERY NAMED HANDLER and its body — so a button can be followed ───────────────────────── */
const fns = new Map();
L.forEach((line, i) => {
  const m = line.match(/^\s*(?:window\.)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(?/) ||
            line.match(/^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
  if (!m) return;
  const name = m[1];
  if (!/^(window|const|let|var)$/.test(name) && !fns.has(name)) fns.set(name, { start: i + 1 });
});
/* End of a handler = the line before the next top-level definition. Crude, and deliberately so:
 * a real parser would be exact and would also be a second language to maintain. Over-reach makes
 * the map say a button does MORE than it does, which is the safe direction for a design input. */
const starts = [...fns.values()].map(v => v.start).sort((a, b) => a - b);
for (const [, v] of fns) {
  const nxt = starts.find(s => s > v.start);
  v.end = Math.min((nxt || L.length + 1) - 1, v.start + 160);   // cap: handlers are not 1000 lines
}
const bodyOf = (from, to) => L.slice(from - 1, to).join('\n');

/* ── 4. WHAT A SPAN OF CODE DOES ─────────────────────────────────────────────────────────────── */
const scan = text => ({
  go:   [...new Set([...text.matchAll(/GO\('([a-zA-Z0-9_]+)'/g)].map(m => m[1]))],
  api:  [...new Set([...text.matchAll(/api\('([a-zA-Z0-9_]+)'/g)].map(m => m[1]))],
  /* 🔴 BOTH WAYS A SCREEN HANDS WORK ON — a button (`onclick="A_studentForm("`) and a plain call
   * (`P_journal(kids[0].StudentID)`). Following only buttons made every delegating screen look
   * empty: Parent.journal is one line that calls P_journal, and the map reported it as a screen
   * with no data and no buttons while it is the screen a parent reads every evening. */
  calls:[...new Set([
    ...[...text.matchAll(/onclick="([A-Za-z_][A-Za-z0-9_]*)\(/g)].map(m => m[1]),
    ...[...text.matchAll(/\b([PTAO]_[A-Za-z0-9_]+)\s*\(/g)].map(m => m[1])
  ])],
  modals: (text.match(/modal\(/g) || []).length
});

for (const s of screens) {
  const own = bodyOf(s.line, s.end);
  const direct = scan(own);
  // follow the buttons one hop — that is where most of a screen's real behaviour lives
  const seen = new Set();
  const reached = { go: [], api: [], modals: 0 };
  /* 🔴 DO NOT FOLLOW A HANDLER THAT BELONGS TO ANOTHER ROLE.
   * The injury screens share save/view handlers, and `A_viewInjury` ends with GO('injuries') —
   * an Admin destination. Following it from the TEACHER's screen made the map report that a
   * teacher navigates to a screen teachers do not have. The prefix is the role: A_ Admin,
   * T_ Teacher, P_ Parent. A helper with no prefix is shared and is followed by everyone. */
  const mine = { Admin: 'A', Teacher: 'T', Parent: 'P', Observer: 'A' }[s.role];
  for (const c of direct.calls) {
    const f = fns.get(c);
    if (!f || seen.has(c)) continue;
    const pre = (c.match(/^([PTAO])_/) || [])[1];
    if (pre && pre !== mine) continue;
    seen.add(c);
    const r = scan(bodyOf(f.start, f.end));
    reached.go.push(...r.go); reached.api.push(...r.api); reached.modals += r.modals;
  }
  s.go = [...new Set([...direct.go, ...reached.go])].sort();
  s.api = [...new Set([...direct.api, ...reached.api])].sort();
  s.buttons = direct.calls.length;
  s.followed = seen.size;
  s.modals = direct.modals + reached.modals;
  s.lines = s.end - s.line + 1;
}

/* ── 5. THE SERVER SIDE — who may ask for what ───────────────────────────────────────────────── */
const serverRoutes = new Set([...code.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9_]*):\s*function/gm)].map(m => m[1]));
const engineRoutes = new Set([...eng.matchAll(/^    ([a-zA-Z][a-zA-Z0-9_]*):\s*(?:async\s*)?[(p]/gm)].map(m => m[1]));
const adminOnly = new Set();
{
  const m = code.match(/var ADMIN_ONLY = \{([\s\S]*?)\};/);
  if (m) for (const x of m[1].matchAll(/([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*1/g)) adminOnly.add(x[1]);
}
const clientRoutes = new Set([...app.matchAll(/api\('([a-zA-Z0-9_]+)'/g)].map(m => m[1]));
const known = r => serverRoutes.has(r) || engineRoutes.has(r);

/* ── 6. WHAT THE MAP SAYS IS WRONG ───────────────────────────────────────────────────────────── */
const findings = [];
const byRole = {};
for (const s of screens) (byRole[s.role] = byRole[s.role] || new Set()).add(s.name);

for (const s of screens) {
  for (const dest of s.go) {
    if (!byRole[s.role].has(dest))
      findings.push({ kind: 'GO_TO_SCREEN_THIS_ROLE_DOES_NOT_HAVE', role: s.role, from: s.name, to: dest });
  }
}
for (const r of clientRoutes) if (!known(r)) findings.push({ kind: 'CLIENT_CALLS_UNKNOWN_ROUTE', route: r });

/* 🔴 "NO WAY IN" IS NOT THE SAME AS "NOT ON THE TAB BAR".
 *
 * A screen is also opened by a render function — the teacher reaches the journal by tapping a
 * child, which calls T_journal(sid) directly and never calls GO(). Reporting those as unreachable
 * was the map's second false alarm. What IS worth saying is weaker and true: no button navigates
 * to this screen BY NAME, so it is only ever restored from history or entered through a helper —
 * which is exactly the kind of screen a back button lands on and nobody can get back to. */
/* 🔴 AND REACHABILITY IS A WHOLE-FILE QUESTION, not a per-screen one.
 * The notification router (`openerFor`) is a plain object literal sitting in no screen's body, and
 * it is what takes an admin to the slip queue from a bell notification: `verify:()=>GO('verify')`.
 * Asking only "which screen GO()s here" called that screen unreachable while a tap on a
 * notification opens it every day. So: any GO('x') ANYWHERE counts as a way in. */
const goAnywhere = new Set([...app.matchAll(/GO\('([a-zA-Z0-9_]+)'/g)].map(m => m[1]));
for (const role of Object.keys(byRole)) {
  const tabs = new Set(navs[role] || []);
  for (const name of byRole[role]) {
    if (tabs.has(name) || goAnywhere.has(name)) continue;
    /* 🔴 A REDIRECT IS NOT AN ORPHAN — DECLARED, not pattern-matched away.
     * `SCREENS.Parent.checkin = () => GO('journal')` is the whole body: the รับ-ส่ง tab was removed
     * and this line keeps the back button working for anyone whose history still holds it. Nothing
     * should navigate TO it, and that is the point. (Declare exceptions; see the RLS work.) */
    const self = screens.find(x => x.role === role && x.name === name);
    const body = self ? bodyOf(self.line, self.end) : '';
    if (/^\s*SCREENS\.[A-Za-z]+\.[A-Za-z0-9_]+\s*=\s*\(\)\s*=>\s*GO\('[a-zA-Z0-9_]+'\)\s*;?\s*$/.test(body)) continue;
    const mine = { Admin: 'A', Teacher: 'T', Parent: 'P', Observer: 'A' }[role];
    const opener = [...fns.keys()].find(f => f === mine + '_' + name) ||
                   [...fns.keys()].find(f => new RegExp('^[PTAO]_' + name + '$', 'i').test(f));
    findings.push({ kind: opener ? 'ENTERED_ONLY_VIA_HELPER' : 'NO_WAY_IN_AT_ALL',
                    role, screen: name, via: opener || '—' });
  }
}

/* ── 7. OUTPUT ───────────────────────────────────────────────────────────────────────────────── */
const roleFilter = arg('--role');
const shown = roleFilter ? screens.filter(s => s.role === roleFilter) : screens;

const summary = {
  screens: screens.length,
  roles: Object.keys(byRole).length,
  tabsPerRole: Object.fromEntries(Object.entries(navs).map(([k, v]) => [k, v.length])),
  navigationEdges: screens.reduce((a, s) => a + s.go.length, 0),
  routesCalledByClient: clientRoutes.size,
  routesOnServer: serverRoutes.size,
  routesInEngine: engineRoutes.size,
  adminOnlyRoutes: adminOnly.size,
  handlersFollowed: screens.reduce((a, s) => a + s.followed, 0),
  findings: findings.length
};

if (has('--json')) {
  console.log(JSON.stringify({ summary, navs, screens: shown, findings }, null, 1));
} else {
  console.log('\n════════ แผนผังหน้าจอและข้อมูล — อ่านจากโค้ดจริง ════════\n');
  for (const [k, v] of Object.entries(summary)) console.log("  " + k.padEnd(22) + (typeof v === "object" ? JSON.stringify(v) : v));
  console.log('\n──── ทีละหน้า ────');
  let role = '';
  for (const s of shown) {
    if (s.role !== role) { role = s.role; const t = navs[role] || [];
      console.log('\n● ' + role + '  (แถบล่าง ' + t.length + ' ปุ่ม: ' + t.join(' · ') + ')'); }
    const tab = (navs[s.role] || []).includes(s.name) ? '📌' : '  ';
    console.log('  ' + tab + ' ' + s.name.padEnd(12) +
      String(s.lines).padStart(5) + ' บรรทัด · ปุ่ม ' + String(s.buttons).padStart(3) +
      ' · กล่อง ' + String(s.modals).padStart(3));
    if (s.go.length)  console.log('        → ไปต่อ : ' + s.go.join(', '));
    if (s.api.length) console.log('        ⇅ ข้อมูล: ' + s.api.slice(0, 14).join(', ') +
      (s.api.length > 14 ? '  (+' + (s.api.length - 14) + ')' : ''));
  }
  if (findings.length) {
    console.log('\n──── 🔴 ที่แผนผังบอกว่าผิด ' + findings.length + ' ข้อ ────');
    const grouped = {};
    for (const f of findings) (grouped[f.kind] = grouped[f.kind] || []).push(f);
    for (const [kind, list] of Object.entries(grouped)) {
      console.log('\n  ' + kind + '  ×' + list.length);
      for (const f of list.slice(0, 12))
        console.log('    · ' + Object.entries(f).filter(([k]) => k !== 'kind').map(([k, v]) => k + '=' + v).join('  '));
      if (list.length > 12) console.log('    · … อีก ' + (list.length - 12));
    }
  } else {
    console.log('\n  ✅ ไม่พบความขัดแย้งในแผนผัง');
  }
  console.log('');
}

const md = arg('--md');
if (md) {
  const out = [];
  out.push('# แผนผังหน้าจอและข้อมูล (Flow map)\n');
  out.push('> สร้างด้วย `node tools/map_flows.js --md docs/FLOWMAP.md` — **อ่านจากโค้ดจริง ไม่ได้เขียนมือ**');
  out.push('> รันใหม่ได้ทุกครั้งที่แก้โค้ด แผนผังจึงไม่มีวันเก่ากว่าแอป\n');
  out.push('| | |\n|---|---:|');
  for (const [k, v] of Object.entries(summary)) out.push('| ' + k + ' | ' + (typeof v === 'object' ? Object.entries(v).map(([a,b])=>a+' '+b).join(' · ') : v) + ' |');
  for (const role of Object.keys(byRole)) {
    out.push('\n## ' + role + '\n');
    out.push('แถบล่าง: ' + (navs[role] || []).map(t => '`' + t + '`').join(' · ') + '\n');
    out.push('| หน้า | บนแถบล่าง | ปุ่ม | กล่อง | ไปต่อได้ที่ไหน | ข้อมูลที่ขอ |');
    out.push('|---|:---:|---:|---:|---|---|');
    for (const s of screens.filter(x => x.role === role))
      out.push('| **' + s.name + '** | ' + ((navs[role] || []).includes(s.name) ? '📌' : '') + ' | ' +
        s.buttons + ' | ' + s.modals + ' | ' + (s.go.join(', ') || '—') + ' | ' + (s.api.join(', ') || '—') + ' |');
  }
  if (findings.length) {
    out.push('\n## 🔴 ความขัดแย้งที่แผนผังจับได้\n');
    out.push('| ชนิด | รายละเอียด |\n|---|---|');
    for (const f of findings)
      out.push('| `' + f.kind + '` | ' + Object.entries(f).filter(([k]) => k !== 'kind').map(([k, v]) => k + '=' + v).join(' · ') + ' |');
  }
  fs.writeFileSync(path.join(ROOT, md), out.join('\n') + '\n');
  console.log('เขียนแล้ว: ' + md);
}
