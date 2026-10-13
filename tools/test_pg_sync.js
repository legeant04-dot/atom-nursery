/**
 * tools/test_pg_sync.js — Phase 2.4. The mirror must change only what actually changed.
 *   node tools/test_pg_sync.js            (offline — the diff is a pure function, on purpose)
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 WHAT THIS IS GUARDING
 *
 * §1  a row that did not change is NOT touched. The whole value of a diff is that "0 changes" is a
 *     true statement about the two databases — which is what Phase 2.5's daily check will read.
 *     A diff that reports spurious changes is a check that cries wolf, and it is also a write.
 * §2  the comparison crosses the two databases' idea of a value without inventing a difference:
 *     Postgres gives a Date where the sheet gave '2026-10-13', and a numeric as '18000.00' where
 *     the sheet gave 18000. Neither is a change.
 * §3  🔴 THE SCHOOL'S CALENDAR, NOT THE SERVER'S. A date compared in UTC is off by a day for seven
 *     hours out of every twenty-four — and it would not fail, it would rewrite every dated row in
 *     the school, every evening, for ever.
 * §4  composite keys, because most of the school's data has no id of its own — one journal per
 *     child per day, one clock-in per teacher per day.
 * §5  🔴 a log is append-only. Diffing an audit log would turn "somebody trimmed the spreadsheet"
 *     into "delete those rows from Postgres too", which is the PDPA record erasing the evidence of
 *     its own erasure.
 * §6  every table is accounted for. A table with no way to match a row must be REPORTED, never
 *     quietly skipped, or "0 changes" becomes reachable by not having looked.
 * §7  and --apply refuses while PDPA (Phase 1.5) is unsigned.
 */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok_(l, c) { console.log((c ? '  ok   ' : '  FAIL ') + l); c ? pass++ : fail++; }
function eq(l, got, want) {
  const o = JSON.stringify(got) === JSON.stringify(want);
  console.log((o ? '  ok   ' : '  FAIL ') + l + (o ? '' : '\n         got =' + JSON.stringify(got) + '\n         want=' + JSON.stringify(want)));
  o ? pass++ : fail++;
}
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const { diffTable, same, rowKeys, dateText, MATCH_KEY_ } = require('./pg_sync.js');
const { targetSchema } = require('./pg_migrate.js');

// students: the sheet column → pg column map the planner produces
const COLS = { StudentID: 'student_id', NameTH: 'name', Class: 'class', Status: 'status',
               EnrollDate: 'enroll_date', BaseSalary: 'base_salary' };
const TYPES = { student_id: 'text', name: 'text', class: 'text', status: 'text',
                enroll_date: 'date', base_salary: 'numeric(12,2)' };

// ============================================================================
console.log('\n1) 🔴 ไม่เปลี่ยน = ไม่แตะ');
{
  const sheet = [
    { StudentID: 'S-1', NameTH: 'เด็กหนึ่ง', Class: 'Nursery 1', Status: 'ACTIVE', EnrollDate: '2026-01-05' },
    { StudentID: 'S-2', NameTH: 'เด็กสอง', Class: 'Nursery 2', Status: 'ACTIVE', EnrollDate: '2026-02-01' }
  ];
  const pg = [
    { id: 'u1', student_id: 'S-1', name: 'เด็กหนึ่ง', class: 'Nursery 1', status: 'ACTIVE', enroll_date: new Date('2026-01-04T17:00:00Z') },
    { id: 'u2', student_id: 'S-2', name: 'เด็กสอง', class: 'Nursery 2', status: 'ACTIVE', enroll_date: new Date('2026-01-31T17:00:00Z') }
  ];
  const d = diffTable(sheet, pg, COLS, ['StudentID'], TYPES, null);
  /* 🔴 THE ONE THAT MATTERS. Both rows are identical; the enrol dates came back as Date objects at
   * 17:00 UTC, which is midnight in Bangkok. If this reports a change, the sync rewrites every
   * dated row in the school every time it runs, and Phase 2.5's "nothing differs" never happens. */
  eq('🔴 สองแถวเหมือนกันทุกประการ → ไม่มีอะไรต้องทำ', [d.insert.length, d.update.length, d.del.length], [0, 0, 0]);
}

console.log('\n2) เพิ่ม · แก้ · ลบ');
{
  const sheet = [
    { StudentID: 'S-1', NameTH: 'เด็กหนึ่ง', Class: 'Nursery 2', Status: 'ACTIVE' },   // moved class
    { StudentID: 'S-3', NameTH: 'เด็กสาม', Class: 'Nursery 1', Status: 'ACTIVE' }      // new
  ];
  const pg = [
    { id: 'u1', student_id: 'S-1', name: 'เด็กหนึ่ง', class: 'Nursery 1', status: 'ACTIVE' },
    { id: 'u2', student_id: 'S-2', name: 'เด็กสอง', class: 'Nursery 2', status: 'ACTIVE' }   // gone from the sheet
  ];
  const d = diffTable(sheet, pg, COLS, ['StudentID'], TYPES, null);
  eq('เด็กใหม่ → insert', d.insert.map(r => r.StudentID), ['S-3']);
  eq('ย้ายห้อง → update', d.update.map(u => u.id), ['u1']);
  eq('...และบอกว่าคอลัมน์ไหนเปลี่ยน', d.update[0].changed, ['Class']);
  eq('ไม่มีในชีตแล้ว → delete', d.del.map(x => x.key), ['S-2']);
}

console.log('\n3) 🔴 ค่าที่หน้าตาต่างแต่ความหมายเดียวกัน');
{
  eq('numeric กลับมาเป็นข้อความ', same(18000, '18000.00', 'numeric(12,2)'), true);
  eq('...และ 0 กับ "0.00"', same(0, '0.00', 'numeric(12,2)'), true);
  eq('CONTROL: คนละจำนวนจริงๆ ต้องต่าง', same(18000, '18500.00', 'numeric(12,2)'), false);
  eq('ช่องว่างกับ null', same('', null, 'text'), true);
  eq('ช่องว่างกับช่องว่าง', same('', '', 'text'), true);
  eq('CONTROL: ว่างกับมีค่า ต้องต่าง', same('', 'x', 'text'), false);
  eq('boolean: true กับ true', same('YES', true, 'boolean'), true);
  eq('boolean: ว่างกับ false', same('', false, 'boolean'), true);
  /* 🔴 เที่ยงคืนกรุงเทพ = 17:00 UTC ของวันก่อนหน้า. อ่านเป็น UTC แล้ววันจะเคลื่อนไป 1 วัน
   * ซึ่งจะไม่ error แต่จะเขียนทับทุกแถวที่มีวันที่ ทุกเย็น ตลอดไป */
  eq('🔴 วันที่ — เทียบด้วยปฏิทินของโรงเรียน', same('2026-01-05', new Date('2026-01-04T17:00:00Z'), 'date'), true);
  eq('🔴 ...และ 23:00 ตามเวลาไทยก็ยังเป็นวันเดียวกัน', same('2026-01-05', new Date('2026-01-05T16:00:00Z'), 'date'), true);
  eq('CONTROL: คนละวันจริงๆ ต้องต่าง', same('2026-01-05', new Date('2026-01-05T17:00:00Z'), 'date'), false);
  eq('timestamp เต็มรูปแบบ', dateText(new Date('2026-10-13T09:00:00Z'), 'timestamptz'), '2026-10-13 16:00:00');
  eq('เที่ยงคืน → วันที่เฉยๆ', dateText(new Date('2026-10-12T17:00:00Z'), 'timestamptz'), '2026-10-13');
}

// ============================================================================
console.log('\n4) 🔴 คีย์ประกอบ — ข้อมูลส่วนใหญ่ของโรงเรียนไม่มีรหัสของตัวเอง');
{
  const C = { StudentID: 'student_id', Date: 'date', Mood: 'mood' };
  const T = { student_id: 'text', date: 'date', mood: 'text' };
  const sheet = [
    { StudentID: 'S-1', Date: '2026-10-12', Mood: 'ยิ้มแย้ม' },
    { StudentID: 'S-1', Date: '2026-10-13', Mood: 'ง่วง' },      // same child, next day
    { StudentID: 'S-2', Date: '2026-10-13', Mood: 'ยิ้มแย้ม' }
  ];
  const pg = [
    { id: 'j1', student_id: 'S-1', date: new Date('2026-10-11T17:00:00Z'), mood: 'ยิ้มแย้ม' },
    { id: 'j2', student_id: 'S-1', date: new Date('2026-10-12T17:00:00Z'), mood: 'ร้องไห้' }
  ];
  const d = diffTable(sheet, pg, C, ['StudentID', 'Date'], T, null);
  /* 🔴 THE POINT. Keyed on the child alone, the second day would look like a change to the first
   * and three journals would collapse into one — which is exactly what the unique index Phase 2.3
   * removed would have enforced. */
  eq('🔴 เด็กคนเดียวกัน คนละวัน = คนละแถว', [d.insert.length, d.update.length, d.del.length], [1, 1, 0]);
  eq('...แถวใหม่คือเด็กอีกคนของวันที่ 13', d.insert[0].StudentID, 'S-2');
  eq('...และที่แก้คืออารมณ์ของวันที่ 13', d.update[0].changed, ['Mood']);
  /* a separator no id can contain, so ('S-1','2026-10-13') cannot collide with ('S-12','026-10-13') */
  const tricky = diffTable(
    [{ StudentID: 'S-1', Date: '2026-10-13', Mood: 'a' }, { StudentID: 'S-12', Date: '026-10-13', Mood: 'b' }],
    [], C, ['StudentID', 'Date'], T, null);
  eq('🔴 คีย์ที่ต่อกันแล้วหน้าตาเหมือนกัน ต้องไม่ชนกัน', tricky.insert.length, 2);
}

// ============================================================================
console.log('\n5) 🔴 บันทึกการตรวจสอบ — เพิ่มได้อย่างเดียว');
{
  const C = { Timestamp: 'timestamp', UserID: 'user_id', Action: 'action' };
  const T = { timestamp: 'text', user_id: 'text', action: 'text' };
  const sheet = [{ Timestamp: '2026-10-13 09:00:00', UserID: 'U1', Action: 'VIEW' }];
  const pg = [
    { id: 'a1', timestamp: '2026-10-13 09:00:00', user_id: 'U1', action: 'VIEW' },
    { id: 'a2', timestamp: '2026-10-12 09:00:00', user_id: 'U9', action: 'DELETE' }   // not in the sheet any more
  ];
  const d = diffTable(sheet, pg, C, ['Timestamp', 'UserID', 'Action'], T, 'APPEND_ONLY');
  /* Somebody trimmed the audit sheet. In diff mode that becomes "delete the evidence from Postgres
   * too". The log may only ever grow. */
  eq('🔴 แถวที่หายไปจากชีต ต้องไม่ถูกลบในฐานข้อมูล', d.del.length, 0);
  eq('...และไม่มีการแก้ไขแถวเดิม', d.update.length, 0);
  const grew = diffTable(
    sheet.concat([{ Timestamp: '2026-10-13 10:00:00', UserID: 'U2', Action: 'EDIT' }]), pg, C, ['Timestamp', 'UserID', 'Action'], T, 'APPEND_ONLY');
  eq('แถวใหม่ยังถูกเพิ่มตามปกติ', grew.insert.length, 1);
  ['audit_log', 'hr_audit_log', 'backup_log', 'perf_log'].forEach(t =>
    eq('🔴 ' + t + ' ถูกประกาศว่าเพิ่มได้อย่างเดียว', MATCH_KEY_[t], 'APPEND_ONLY'));
}

// ============================================================================
console.log('\n6) 🔴 ทุกตารางต้องมีวิธีจับคู่แถว — ไม่มีตารางไหนถูกข้ามเงียบๆ');
{
  const sql = R('docs/schema/001_init.sql');
  const keys = rowKeys(sql);
  const schema = targetSchema();
  const tables = Object.keys(schema).filter(t => t !== 'tenant');
  const orphan = tables.filter(t => !keys[t] && !MATCH_KEY_[t]);
  /* A table in neither list cannot be diffed, and the tool reports it — but it should be EMPTY,
   * because an unmatched table is data the mirror never checks. */
  eq('🔴 ไม่มีตารางไหนที่จับคู่แถวไม่ได้เลย', orphan, []);
  ok_('อ่าน unique index จากไฟล์สคีมาได้จริง', Object.keys(keys).length >= 30);
  ok_('...และ MATCH_KEY_ ครอบคลุมส่วนที่เหลือ', Object.keys(MATCH_KEY_).length >= 15);
  /* the tables Phase 2.3 stripped of a wrong unique index are exactly the ones that need a
     composite key here — if one is missing, that is data nobody is mirroring */
  ['checkin_staff', 'checkin_student', 'daily_journal', 'growth_records', 'vaccine_records',
   'pickup_persons', 'work_schedule', 'line_recipients', 'user_links']
    .forEach(t => ok_('🔴 ' + t + ' มีคีย์ประกอบ', Array.isArray(MATCH_KEY_[t]) && MATCH_KEY_[t].length >= 2));
  const src = R('tools/pg_sync.js');
  ok_('ตารางที่จับคู่ไม่ได้ ถูกรายงาน ไม่ใช่ข้าม', /ยังเทียบรายแถวไม่ได้/.test(src));
}

// ============================================================================
console.log('\n7) 🔴 PDPA — --apply ต้องถูกปฏิเสธจนกว่าจะเซ็น');
{
  const src = R('tools/pg_sync.js');
  ok_('มีประตูกั้น และดูจาก PDPA_SIGNED', /PDPA_SIGNED/.test(src));
  ok_('🔴 ปฏิเสธ ไม่ใช่แค่เตือน', /process\.exit\(3\)/.test(src) && /ถูกปฏิเสธ/.test(src));
  ok_('...และบอกว่าต้องทำอะไรจึงจะผ่าน', /secrets\/supabase\.env/.test(src) && /docs\/pdpa/.test(src));
  /* measured, not read: run it and see that it refuses */
  const out = cp.spawnSync('node', ['tools/pg_sync.js', '--file', 'docs/pdpa/README.md', '--apply'],
    { cwd: ROOT, encoding: 'utf8' });
  ok_('🔴 รันจริงแล้วถูกปฏิเสธ (exit 3)', out.status === 3);
  ok_('...ก่อนที่จะแตะฐานข้อมูลด้วยซ้ำ', /ยังไม่มีข้อตกลง PDPA/.test(out.stdout || ''));
  /* 🔴 and the network call must come AFTER the gate — refusing after connecting would still have
   * opened a connection to a database that may not hold this data yet */
  ok_('🔴 ประตูกั้นอยู่ก่อน connect()', src.indexOf('PDPA_SIGNED') < src.indexOf('await connect()'));
}

// ============================================================================
console.log('\n8) 📐 ทางเลือกเชิงออกแบบที่ห้ามเปลี่ยนเงียบๆ');
{
  const src = R('tools/pg_sync.js');
  /* The whole reason this is a reconciliation and not a write-through: an HTTPS call on every write
   * is the LINE-push-inside-the-write-lock mistake, on every write instead of a few. */
  ok_('🔴 เขียนไว้ว่าทำไมไม่ยิง Supabase ตอนเขียนชีต', /INSIDE the write lock/.test(src));
  ok_('...และทำไมต้องเป็นส่วนต่าง ไม่ใช่โหลดใหม่ทั้งก้อน', /NOT A RELOAD/.test(src));
  ok_('การลบถูกครอบด้วย transaction ต่อตาราง', /await c\.query\('begin'\)/.test(src) && /rollback/.test(src));
  ok_('ชื่อคอลัมน์ถูกใส่เครื่องหมายคำพูด (คำสงวน)', /'"' \+ n \+ '"'/.test(src));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
