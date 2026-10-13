/**
 * tools/test_pg_phase23.js — the Phase 2.3 harness must not be able to overstate itself.
 *   node tools/test_pg_phase23.js            (offline — it reads the harness, it does not run it)
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 WHAT THIS IS GUARDING
 *
 * The gate for Phase 2.3 is "every suite passes with its data coming out of Postgres". The ways
 * that claim could be FALSE while the run looks green are all in the harness, not in the suites:
 *
 *   §1  the hook misses a door, so a suite runs on literals and is counted as having run on
 *       Postgres. Twenty-four suites load the engine through vm.runInContext rather than require.
 *   §2  a round trip fails and is swallowed, so the suite quietly becomes an ordinary offline run
 *       wearing the name of a database one.
 *   §3  the runner reports one number instead of three, so a hundred source-text suites that never
 *       touch data are counted as "passed on Postgres" — the same defect as the speed report
 *       counting one failed screen as ten failures.
 *   §4  two suites share a tenant and collide, which fails suites that are perfectly correct (it
 *       did: forty-seven of them, on the first full sweep).
 *   §5  the staging database does not end empty. PDPA (Phase 1.5) is unsigned, so every row and
 *       every tenant this creates must be gone again.
 */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
function ok_(l, c) { console.log((c ? '  ok   ' : '  FAIL ') + l); c ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const hook = R('tools/pg_hook.js'), worker = R('tools/pg_bridge_worker.js'),
      runner = R('tools/test_all_pg.js'), all = R('tools/test_all.js'), eng = R('tools/pg_engine.js');

console.log('\n1) 🔴 ทั้งสองประตูที่ชุดทดสอบใช้โหลด engine');
{
  ok_('ดักทาง require', /Module\._load = function/.test(hook) && /wrapHolder\(m\)/.test(hook));
  /* Module._load never sees a vm context. Without this, 24 suites would have run on literals and
     been counted as having run on Postgres — the exact shape of lie this phase must not tell. */
  ok_('🔴 ดักทาง vm.runInContext ด้วย', /vm\.runInContext = function/.test(hook) && /wrapHolder\(ctx\)/.test(hook));
  ok_('...รวมถึง new vm.Script(...).runInContext', /vm\.Script\.prototype\.runInContext = function/.test(hook));
  ok_('ห่อแล้วไม่ห่อซ้ำ', /__atomPgWrapped/.test(hook));
  /* and the count is PRINTED, so a suite that reached the database zero times cannot be read as
     one that passed on it */
  ok_('🔴 นับจำนวนครั้งที่สร้าง engine แล้วพิมพ์ออกมาเสมอ',
    /\[pg\] engine builds=/.test(hook) && /process\.on\('exit'/.test(hook));
}

console.log('\n2) 🔴 รอบที่ล้มเหลว ต้องหยุด ไม่ใช่ข้ามไปเงียบๆ');
{
  ok_('ล้มแล้วจบโปรเซส ไม่กลืนข้อผิดพลาด', /pg bridge failed/.test(hook) && /process\.exit\(3\)/.test(hook));
  /* an unbounded wait is indistinguishable from a deadlock, and the first design deadlocked */
  ok_('รอแบบมีเวลาจำกัด', /no reply within/.test(hook));
  ok_('และรู้ว่าตัวช่วยตายไปแล้ว', /proc\.exitCode !== null/.test(hook));
}

console.log('\n3) 🔴 รายงานต้องแยก "รันบน Postgres" ออกจาก "ไม่แตะข้อมูล"');
{
  ok_('อ่านจำนวน round trip กลับมาจากตัว hook', /engine builds=\(\\d\+\)/.test(runner) || /pgStats/.test(runner));
  ok_('รายงานสามตัวเลข ไม่ใช่ตัวเดียว',
    /บน Postgres/.test(runner) && /ไม่แตะข้อมูล/.test(runner) && /ล้มเหลว/.test(runner));
  /* a suite that printed no summary has not passed — the same rule as test_all.js, learned the
     same way (test_notify_parent threw before its first assertion for six releases) */
  ok_('ชุดที่ไม่พิมพ์สรุป = ยังไม่ผ่าน', /NO SUMMARY/.test(runner));
  /* and the ordinary run must not pick this up: it needs credentials, it takes a quarter of an
     hour, and it would recurse */
  ok_('🔴 test_all ไม่หยิบ test_all_pg มารันเอง', /'test_all_pg\.js'/.test(all));
}

console.log('\n4) 🔴 โรงเรียนคนละแห่งต่อหนึ่งโปรเซส');
{
  ok_('tenant สร้างใหม่ทุกครั้ง ไม่ใช่ค่าคงที่', /function uuid4\(\)/.test(hook) && /ATOM_PG_TENANT \|\| uuid4\(\)/.test(hook));
  /* `code` is unique as well — a fixed string collided the moment two suites ran at once */
  ok_('...และรหัสโรงเรียนก็ไม่ซ้ำ', /'p23-' \+ String\(TENANT\)/.test(worker));
}

console.log('\n5) 🔴 ฐานข้อมูล staging ต้องว่างเหมือนเดิมทุกครั้ง (PDPA ยังไม่เซ็น)');
{
  ok_('ลบก่อนและหลังทุกรอบ', (worker.match(/await wipe\(/g) || []).length >= 3);
  ok_('🔴 ปิดงานแล้วลบ tenant ของตัวเองด้วย', /delete from tenant where id = \$1/.test(worker));
  ok_('และ hook สั่งปิดก่อนฆ่าโปรเซส', /callSync\(\{ op: 'close' \}\)/.test(hook));
  /* __id is the bridge's own bookkeeping; a handler or an assertion seeing it would be this
     harness changing the data it is supposed to be carrying unchanged */
  ok_('__id ไม่หลุดไปถึง handler', /delete o\.__id/.test(worker));
  /* only real tables are round-tripped — `config`, seeded reference data and a suite's own scratch
     keys are not the migration's business and must come back untouched */
  ok_('แตะเฉพาะ collection ที่เป็นตารางจริง', /COLLECTIONS\[k\] && COLLECTIONS\[k\]\.known && Array\.isArray/.test(hook));
  /* 🔴 The same array object AND the same row objects, refilled in place. A suite that keeps a
     handle on one row and edits it between questions —
         const pol = expiry => { KID.InsuranceExpiry = expiry; return H.studentProfile(…).policy; };
     — writes to nothing at all if the array now holds different objects. That one reported an
     EXPIRED insurance policy as still covering a child, which was entirely this harness's doing. */
  ok_('🔴 เติมกลับใน array เดิม ไม่สร้างใหม่', /M\[k\]\.length = rows\.length;/.test(hook));
  ok_('🔴 ...และ object ของแต่ละแถวก็ตัวเดิม (ชุดทดสอบถือ reference ไว้แก้)',
    /Object\.keys\(row\)\.forEach\(f => \{ delete row\[f\]; \}\);/.test(hook) && /Object\.assign\(row, rows\[i\]\)/.test(hook));
}

console.log('\n6) 🔴 ชื่อคอลัมน์ที่เป็นคำสงวน');
{
  ok_('pg_engine ใส่เครื่องหมายคำพูดให้ทุกชื่อ', /const q = name =>/.test(eng));
  ok_('...ตอน insert', /cols\.map\(f => q\(c\.toPg\[f\]\)\)/.test(eng));
  ok_('...และตอน update', /q\(c\.toPg\[f\]\) \+ '=\$'/.test(eng));
  /* one answer to "what goes in this column", shared with the migrator — see pg_migrate.encode_ */
  ok_('🔴 ใช้ตัวแปลงค่าตัวเดียวกับตัว migrate', /require\('\.\/pg_migrate\.js'\)\.encode_/.test(eng));
  ok_('...และรู้ชนิดของคอลัมน์ตอนแปลง', /typeOf_\(c\.table, c\.toPg\[f\]\)/.test(eng));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
