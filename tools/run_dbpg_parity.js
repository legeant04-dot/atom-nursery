/**
 * tools/run_dbpg_parity.js — every Apps Script suite, run through the Postgres door (week 2)
 *   node tools/run_dbpg_parity.js            → summary + docs/WEEK2_DBPG_FINDINGS.md
 *
 * Each suite that loads src/*.gs through tools/gas_test_harness.js is run twice: as it is, and with
 * ATOM_DB=pg, where every sheet is answered through src/DbPg.gs. A suite that passes the first way
 * and fails the second has found something the move to Postgres would break — and so has a column
 * the schema never declared, a value a typed column refuses, or a sheet with no table at all.
 *
 * Gate for week 2 (docs/SPEED_FIRST_PLAN.md): every suite that passes on Sheets passes here too.
 * Not part of test_all.js until it is green — a known-red suite in the release gate blocks releases
 * for findings that are not regressions.
 */
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const suites = fs.readdirSync(__dirname).filter(f => /^test_.*\.js$/.test(f) && f !== 'run_dbpg_parity.js')
  .filter(f => /gas_test_harness/.test(fs.readFileSync(path.join(__dirname, f), 'utf8'))).sort();

const run = (f, pg) => {
  const env = Object.assign({}, process.env, pg ? { ATOM_DB: 'pg', ATOM_DB_TRACE: '1' } : { ATOM_DB: '' });
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, f)], { env, encoding: 'utf8', timeout: 300000, cwd: ROOT });
  const out = (r.stdout || '') + (r.stderr || '');
  const trace = (/\[dbpg\] (\{.*\})/.exec(out) || [])[1];
  return { ok: r.status === 0, out, trace: trace ? JSON.parse(trace) : null,
    fails: out.split('\n').filter(l => /^\s*FAIL\b|Error:/.test(l)).slice(0, 8).map(l => l.trim().slice(0, 160)) };
};

const rows = [], unknown = {}, rejects = {}, missing = {};
let same = 0, broke = 0, wasRed = 0, untouched = 0;
for (const f of suites) {
  const a = run(f, false), b = run(f, true);
  const t = b.trace || { statements: {}, rejects: [], unknown: [], missing: [] };
  t.unknown.forEach(k => (unknown[k] = unknown[k] || new Set()).add(f));
  t.rejects.forEach(k => (rejects[k.split('=')[0]] = rejects[k.split('=')[0]] || new Set()).add(k.split('=').slice(1).join('=')));
  t.missing.forEach(k => (missing[k] = missing[k] || new Set()).add(f));
  const nst = Object.values(t.statements).reduce((x, y) => x + y, 0);
  if (!a.ok) wasRed++;
  else if (b.ok) same++; else broke++;
  if (!nst) untouched++;
  rows.push({ f, sheets: a.ok, pg: b.ok, nst, fails: a.ok && !b.ok ? b.fails : [] });
  process.stdout.write((a.ok ? (b.ok ? '  ok   ' : '  PG✗  ') : '  red  ') + f + '  (' + nst + ' statements)\n');
}

const md = [];
md.push('# สัปดาห์ 2 — ผลรันชุดทดสอบผ่านประตู Postgres (src/DbPg.gs)', '',
  '> สร้างโดย `node tools/run_dbpg_parity.js` · ' + new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date()) +
  ' · ข้อมูลทดสอบทั้งหมดเป็นข้อมูลสมมติ (fake Jdbc ในหน่วยความจำ — ไม่มีอะไรออกจากเครื่อง)', '',
  '| | ชุด |', '|---|---|',
  '| ผ่านทั้งสองทาง | **' + same + '** |', '| ผ่านบนชีต แต่พังผ่าน Postgres | **' + broke + '** |',
  '| แดงอยู่แล้วบนชีต (ไม่นับ) | ' + wasRed + ' |', '| ไม่ได้แตะข้อมูลเลย | ' + untouched + ' |', '',
  '## 🔴 คอลัมน์ที่ระบบเขียน แต่ไม่มีใน schema — จะหายในวันย้าย', '');
Object.keys(unknown).sort().forEach(k => md.push('- `' + k + '` — ' + [...unknown[k]].join(', ')));
if (!Object.keys(unknown).length) md.push('- ไม่มี');
md.push('', '## 🔴 ค่าที่คอลัมน์ชนิดนี้ไม่รับ — จะกลายเป็นค่าว่างในวันย้าย', '');
Object.keys(rejects).sort().forEach(k => md.push('- `' + k + '` ← ' + [...rejects[k]].slice(0, 6).map(v => '`' + v + '`').join(' · ')));
if (!Object.keys(rejects).length) md.push('- ไม่มี');
md.push('', '## 🔴 ชีตที่ไม่มีตารางใน Postgres', '');
Object.keys(missing).sort().forEach(k => md.push('- `' + k + '` — ' + [...missing[k]].join(', ')));
if (!Object.keys(missing).length) md.push('- ไม่มี');
md.push('', '## ชุดที่พังผ่าน Postgres', '');
rows.filter(r => r.sheets && !r.pg).forEach(r => { md.push('### ' + r.f); r.fails.forEach(l => md.push('    ' + l)); md.push(''); });
fs.writeFileSync(path.join(ROOT, 'docs', 'WEEK2_DBPG_FINDINGS.md'), md.join('\n') + '\n');

console.log('\n' + same + ' same · ' + broke + ' broke through Postgres · ' + wasRed + ' red already · ' +
  Object.keys(unknown).length + ' undeclared columns · ' + Object.keys(rejects).length + ' refused columns · ' +
  Object.keys(missing).length + ' sheets without a table');
console.log('→ docs/WEEK2_DBPG_FINDINGS.md');
process.exit(broke ? 1 : 0);
