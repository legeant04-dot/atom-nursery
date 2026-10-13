/**
 * tools/shadow_audit.js — Phase 2.6. WHY does each shadow route exist?
 *   node tools/shadow_audit.js              the classification
 *   node tools/shadow_audit.js --list read  just the names in one class
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 THE PLAN SAYS "COLLAPSE THEM BACK INTO THE ENGINE". NOT YET, AND THE REASON MATTERS.
 *
 * The plan's own argument is: these routes exist because the engine persists WHOLE COLLECTIONS and
 * Sheets needs in-place writes; on Postgres `update … where id = ?` is ordinary, so the reason
 * disappears. That is correct — **on Postgres**. The school is still on Sheets, and will be until
 * the cutover. Deleting a write route today does not simplify anything; it restores
 * whole-collection writes to the live system, which is the mechanism of the 2026-07-09 wipe.
 *
 * So the work that is both safe and useful NOW is not deletion. It is finding out which of these
 * routes have a reason at all, because the answer decides how much work the cutover actually is —
 * and because a route with NO reason is pure duplication that can go today, on Sheets, with no
 * change in behaviour.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 AND THE SECOND FINDING IS THE DANGEROUS ONE.
 *
 * A shadow pair is two implementations of one behaviour, and only one of them runs at the school.
 * Every test written against the engine half is a test of code the school does not execute. That has
 * already cost this project three times (saveStaffSelf v378, insuranceStatus v379, setSchoolConfig's
 * whitelist) — each one a change that went green and did nothing on live.
 *
 * A PURE READ that is shadowed is the worst kind: there is no Sheets mechanism forcing it, so the
 * two halves exist for no reason and are free to drift apart silently.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const codeGs = R('src/Code.gs');
const eng = R('webapp/engine.js');

/** every name in the ROUTES table (comments stripped — a commented-out route is not a route) */
function routeNames() {
  const block = /var ROUTES = \{([\s\S]*?)\n\};/.exec(codeGs);
  const body = strip(block[1]);
  return [...new Set((body.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm) || []).map(s => s.trim().replace(':', '')))];
}
function engineHandlers() {
  const body = eng.slice(eng.indexOf('const H = {'));
  return [...new Set((body.match(/^    ([A-Za-z_][A-Za-z0-9_]*)\s*:/gm) || []).map(s => s.trim().replace(':', '')))];
}

/** route name → the handler function it calls, e.g. `submitJournal: p => handleSubmitJournal(p)` */
function routeTargets() {
  const block = /var ROUTES = \{([\s\S]*?)\n\};/.exec(codeGs);
  const body = strip(block[1]);
  const out = {};
  for (const m of body.matchAll(/^\s*([A-Za-z_]\w*)\s*:\s*function\s*\([^)]*\)\s*\{\s*return\s+(\w+)\s*\(/gm)) out[m[1]] = m[2];
  for (const m of body.matchAll(/^\s*([A-Za-z_]\w*)\s*:\s*(\w+)\s*,?\s*$/gm)) if (!out[m[1]]) out[m[1]] = m[2];
  for (const m of body.matchAll(/^\s*([A-Za-z_]\w*)\s*:\s*\w*\s*=>\s*(\w+)\s*\(/gm)) if (!out[m[1]]) out[m[1]] = m[2];
  return out;
}

/** every top-level function in src/*.gs, with its body */
function gasFunctions() {
  const out = {};
  for (const f of fs.readdirSync(path.join(ROOT, 'src')).filter(x => x.endsWith('.gs') && x !== 'Engine.gs')) {
    const src = R('src/' + f);
    const re = /^function\s+(\w+)\s*\(/gm;
    let m;
    const starts = [];
    while ((m = re.exec(src))) starts.push({ name: m[1], at: m.index });
    starts.forEach((s, i) => {
      out[s.name] = { file: f, body: strip(src.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : src.length)) };
    });
  }
  return out;
}

/* ── what a body needs that the engine cannot give it ─────────────────────────────────────────── */
const NEEDS = [
  ['write-in-place', /\b(updateRow_|appendObject_|deleteRow|setValues\s*\(|insertSheet|ensureColumns_)\b/,
    'เขียนทีละแถวบนชีต — engine เขียนทับทั้ง collection ซึ่งเป็นกลไกของเหตุข้อมูลหาย 09/07/2026'],
  ['drive', /\b(DriveApp|driveify|getBlob|createFile)\b/, 'ต้องใช้ Drive (รูปภาพ/ไฟล์)'],
  ['network', /\b(UrlFetchApp|linePush\w*|notifyAdmins_|notifyStaffMember_|familyBell_|inboxAdd)\b/,
    'ต้องยิงออกนอกระบบ หรือเขียนกระดิ่ง'],
  ['script-services', /\b(LockService|CacheService|ScriptApp|PropertiesProperties|Utilities\.(computeHmac|base64))\b/,
    'ต้องใช้บริการของ Apps Script'],
  ['session', /\b(__sess|renewSession_|mintSession_|verifyToken_|applyIdentity_)\b/, 'จัดการ session/ตัวตน'],
  ['audit', /\blogAudit\b/, 'เขียนบันทึกการตรวจสอบ (PDPA)']
];

/* 🔴 FOLLOW THE CALLS. The first version read only the handler's own body, and called
 * `addDepartment` read-only — a three-line function whose entire job is to call `writeDepartments_`,
 * which writes. A classifier that stops at the first function answers a question about line counts,
 * not about behaviour, and the list it produces would have been a list of things that are safe to
 * delete and are not.
 *
 * Bounded depth, because the point is to find what a route REACHES, not to inline the program. */
function reachableBody(fnName, FUNCS, depth, seen) {
  depth = depth == null ? 3 : depth; seen = seen || new Set();
  const f = FUNCS[fnName];
  if (!f || seen.has(fnName) || depth < 0) return '';
  seen.add(fnName);
  let out = f.body;
  for (const m of f.body.matchAll(/\b([a-zA-Z_]\w*_|handle[A-Z]\w*)\s*\(/g)) {
    if (FUNCS[m[1]] && !seen.has(m[1])) out += '\n' + reachableBody(m[1], FUNCS, depth - 1, seen);
  }
  return out;
}

function classify(body) {
  const hits = NEEDS.filter(([, re]) => re.test(body)).map(([k]) => k);
  return hits.length ? hits : ['read-only'];
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
const ROUTES = routeNames(), HANDLERS = new Set(engineHandlers());
const TARGETS = routeTargets(), FUNCS = gasFunctions();
const shadows = ROUTES.filter(r => HANDLERS.has(r));

const byClass = {}, unresolved = [];
const rows = shadows.map(r => {
  const fn = TARGETS[r];
  const f = fn && FUNCS[fn];
  if (!f) { unresolved.push(r); return null; }
  const kinds = classify(reachableBody(fn, FUNCS));
  kinds.forEach(k => { (byClass[k] = byClass[k] || []).push(r); });
  return { route: r, fn, file: f.file, kinds, lines: f.body.split('\n').length };
}).filter(Boolean);

if (process.argv.includes('--list')) {
  const want = process.argv[process.argv.indexOf('--list') + 1];
  (byClass[want] || []).sort().forEach(r => console.log(r));
  process.exit(0);
}

module.exports = { shadows, rows, byClass, readOnly: (byClass['read-only'] || []).sort(), classify, routeTargets, gasFunctions };
// a tool that prints when it is REQUIRED pollutes whatever required it — test_shadow_parity reads
// the lists and must not have this file's report land in the middle of its own
if (require.main !== module) return;

console.log('\n═══ Phase 2.6 · ทำไม route พวกนี้ถึงต้องมีซ้ำกับ engine ═══\n');
console.log('  route ใน Code.gs ทั้งหมด      ' + ROUTES.length);
console.log('  handler ใน engine ทั้งหมด     ' + HANDLERS.size);
console.log('  🔴 ที่มีทั้งสองที่ (shadow)     ' + shadows.length);
if (unresolved.length) console.log('  ⚠️  ตามหาฟังก์ชันไม่เจอ ' + unresolved.length + ': ' + unresolved.slice(0, 8).join(' '));

console.log('\n  ── เหตุผลที่ต้องแยก (route หนึ่งตัวมีได้หลายเหตุผล) ──');
Object.keys(byClass).sort((a, b) => byClass[b].length - byClass[a].length).forEach(k => {
  const why = (NEEDS.find(n => n[0] === k) || [, , 'ไม่มีเหตุผลเชิงกลไก — เป็นการอ่านอย่างเดียว'])[2];
  console.log('  ' + String(byClass[k].length).padStart(4) + '  ' + k.padEnd(16) + why);
});

/* 🔴 THE LIST THAT MATTERS. A read has no Sheets mechanism forcing it to be duplicated, so these
 * pairs exist for no reason this tool can find — and two copies of one answer, only one of which
 * the school runs, is how three changes have already shipped green and done nothing. */
const readOnly = (byClass['read-only'] || []).sort();
console.log('\n  🔴 shadow ที่เป็น "อ่านอย่างเดียว" — ไม่มีกลไกของชีตบังคับให้ต้องแยก (' + readOnly.length + ')');
readOnly.forEach(r => {
  const row = rows.find(x => x.route === r);
  console.log('     ' + r.padEnd(28) + row.fn.padEnd(30) + row.file + '  (' + row.lines + ' บรรทัด)');
});

console.log('\n  สรุป: ' + (shadows.length - readOnly.length) + ' ตัวมีเหตุผลเชิงกลไกบนชีต · ' +
  readOnly.length + ' ตัวไม่มี');
console.log('');

