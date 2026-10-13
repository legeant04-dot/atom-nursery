/**
 * tools/test_all_pg.js — Phase 2.3. Every suite, with its data coming out of Postgres.
 *   node tools/test_all_pg.js              (ต้องมี secrets/supabase.env)
 *   node tools/test_all_pg.js leave ot     only suites whose name contains one of these
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 WHAT "เขียวทั้งหมด" CAN AND CANNOT MEAN
 *
 * The plan says "รัน 168 test suites บน Postgres — ต้องเขียวทั้งหมด ไม่มีข้อยกเว้น". Run literally,
 * that sentence would be satisfied by running all 168 and watching them pass — which most of them
 * would do with the database switched off, because most of them never touch data at all. Roughly a
 * hundred are assertions about SOURCE TEXT (does app.js still wire this button to that handler),
 * and another thirty drive src/*.gs against an in-memory sheet mock. Postgres is not in either
 * picture, and reporting them as "passed on Postgres" would be the report lying about itself —
 * exactly the defect found in the speed report two days ago.
 *
 * So this prints THREE numbers, not one:
 *
 *     on postgres   the suite built an engine, and every M that engine saw had been written to
 *                   Postgres and hydrated back first. This is the phase gate.
 *     offline       the suite never built an engine. It passed; the database was not involved.
 *     failed        either.
 *
 * A suite that silently stopped reaching the database would otherwise be indistinguishable from one
 * that passed on it, and that is the single most likely way this phase could be wrong. The hook
 * prints its own count on the way out and this reads it back.
 *
 * ALL DATA IS FABRICATED — it is the suites' own fixtures — and every row is deleted on both sides
 * of every round trip. PDPA (Phase 1.5) is unsigned, so the staging database must end as empty as
 * it began; `--verify` at the end counts the rows to prove it.
 */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const want = process.argv.slice(2).filter(a => a[0] !== '-');

function run(cmd, label) {
  const t0 = Date.now();
  try {
    const out = cp.execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 }).toString();
    return { ok: true, ms: Date.now() - t0, out, label };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, label, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}
function tally(out) {
  const lines = out.trim().split('\n').filter(l => /(passed|PASS|checks|failed)/i.test(l));
  return (lines[lines.length - 1] || '').trim().replace(/^[✅❌]\s*/, '');
}
/** the hook's own exit line — the proof that the database was actually in the loop */
function pgStats(out) {
  const m = /\[pg\] engine builds=(\d+) round-tripped=(\d+) collections=(\d+) rows=(\d+)/.exec(out);
  return m ? { builds: +m[1], trips: +m[2], collections: +m[3], rows: +m[4] } : null;
}

/* The three network suites are not re-run through the hook: they ARE the database tests, they
 * manage their own tenants, and putting a bridge between a suite and the database it is testing
 * would prove nothing about either. Run them by name, as the plan already says. */
const SKIP = new Set(['test_pg_engine.js', 'test_pg_load.js', 'test_all.js']);
const suites = fs.readdirSync(path.join(ROOT, 'tools'))
  .filter(f => /^test_.*\.js$/.test(f) && !SKIP.has(f) && f !== 'test_all_pg.js')
  .filter(f => !want.length || want.some(w => f.indexOf(w) >= 0))
  .sort();

console.log('\n=== Phase 2.3 · ทุกชุดทดสอบ โดยข้อมูลมาจาก Postgres ===\n');

let failed = 0, onPg = 0, offline = 0, trips = 0, rows = 0;
const broken = [];
suites.forEach(f => {
  const r = run('node -r ./tools/pg_hook.js tools/' + f, f);
  const t = tally(r.out);
  const st = pgStats(r.out);
  const mute = r.ok && !t;                   // a suite that printed no summary has not passed
  const bad = !r.ok || mute;
  if (bad) { failed++; broken.push({ f, out: r.out }); }
  else if (st && st.builds > 0) { onPg++; trips += st.trips; rows += st.rows; }
  else offline++;
  const tag = bad ? ' FAIL ' : (st && st.builds ? '  pg  ' : '  --  ');
  console.log(tag + f.replace(/\.js$/, '').padEnd(34) +
    (t || '(NO SUMMARY — it did not finish)') +
    (st && st.builds ? '   [' + st.trips + ' round trips]' : ''));
  if (bad) r.out.split('\n').filter(l => /^\s*FAIL |Error|error:/.test(l)).slice(0, 5)
    .forEach(l => console.log('        ' + l.trim()));
});

/* 🔴 AND THE DATABASE MUST END AS EMPTY AS IT STARTED. Each suite deletes its own rows and its own
 * tenant on the way out, and 168 of 169 did — one process exited the hard way and left a tenant
 * behind. "Almost always tidies up" is not a thing to say about a database that may not hold real
 * data until a PDPA agreement exists (Phase 1.5), so the sweep checks and clears afterwards rather
 * than trusting each of a hundred and seventy exits. */
const sweep = run('node tools/pg_sweep_tenants.js --apply', 'cleanup');
const left = /ROWS LEFT (\d+)/.exec(sweep.out);
console.log('\n' + (sweep.ok && left && left[1] === '0'
  ? '  🧹 ฐานข้อมูล staging ว่างเหมือนเดิม (0 แถว)'
  : '  🔴 เก็บกวาดไม่สมบูรณ์:\n' + sweep.out.trim().split('\n').slice(-4).map(l => '     ' + l).join('\n')));

console.log('\n──────────────────────────────────────────────────────────────');
console.log('  🐘 บน Postgres : ' + onPg + ' ชุด  (' + trips + ' round trips · ' + rows + ' แถว)');
console.log('  ⚪ ไม่แตะข้อมูล : ' + offline + ' ชุด  (ตรวจซอร์ส / mock ของ Sheets — ฐานข้อมูลไม่เกี่ยว)');
console.log('  ' + (failed ? '❌ ล้มเหลว     : ' + failed + ' ชุด' : '✅ ล้มเหลว     : 0 ชุด'));
console.log('──────────────────────────────────────────────────────────────\n');
process.exit(failed ? 1 : 0);
