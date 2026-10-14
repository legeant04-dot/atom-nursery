/**
 * tools/test_export_school.js — PHASE 4.6: the school's own copy, and what must never be in it.
 *   node tools/test_export_school.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 WHAT THIS IS GUARDING
 *
 * The export is the most concentrated read in the app: every child, every family, every salary and
 * every daily journal entry, in one file, in one click. Three things can go wrong with it, and only
 * one of them is visible to whoever presses the button:
 *
 *   1. IT LEAKS A CREDENTIAL.   "Everything" includes STAFF.PasswordHash and the school's LINE
 *      channel access token. A portability feature that mails the school a token which pushes LINE
 *      messages AS the school has handed an attacker every parent in the school, through whichever
 *      inbox the file ends up in. INVISIBLE — the file looks complete and correct.
 *   2. IT IS QUIETLY INCOMPLETE. A table missing from the file is a promise not kept, and the
 *      promise is in a signed document (docs/pdpa/01_DPA.md §9). ALSO INVISIBLE.
 *   3. Excel refuses the file. Loud, and therefore the least dangerous of the three.
 *
 * So sections 1 and 2 are the point of this suite, and they are written as the CLAIM — "no secret
 * value appears anywhere in the output", not "these four columns were handled" — because a test
 * that lists what it checked cannot notice the fifth thing.
 */
const path = require('path'), fs = require('fs');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                    'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                    'PaySlips', 'PayAdjust', 'Password', 'Certificate', 'Dspm', 'BillRun',
                    'Portability', 'GasEngine', 'Engine', 'Day6']);

/* The whole export, run end to end, exactly the way the admin screen drives it: manifest, then every
 * table paged to the end. Then the ENTIRE output is handed back as one blob so the secret checks can
 * look at all of it rather than at the places we remembered to look. */
const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;

  // a school with something in it, including the two kinds of row that matter
  /* `Name`, not `NameTH` — the STUDENTS and STAFF sheet columns are both literally `Name`, and the
   * engine only sees `NameTH` because FIELD_ALIAS renames it on the way in. Writing NameTH here put
   * the child's name in a column the export does not know about, and the "is the data really in the
   * file" check below went red rather than passing on an empty haystack. */
  appendObject_(sheet_(getMainSpreadsheet_(), 'STUDENTS'), { StudentID: 'S-1', Name: 'เด็กทดสอบ',
    Nickname: 'ทด', Class: 'Nursery 1', Status: 'ACTIVE', DOB: '2023-04-15' });
  appendObject_(sheet_(getHrSpreadsheet_(), 'STAFF'), { StaffID: 'T-1', Name: 'ครูทดสอบ',
    Role: 'Teacher', Status: 'ACTIVE', StartDate: '2024-01-01', BaseSalary: 18000,
    /* 🔴 THE BAIT. A hash that is unmistakable in a haystack, so "the column was dropped" and "the
     * column was empty anyway" cannot be confused — the mistake that makes a redaction test pass
     * while redacting nothing. */
    PasswordHash: 'HASH-MUST-NOT-APPEAR-9f2b' });
  appendObject_(sheet_(getMainSpreadsheet_(), 'USERS'), { UserID: 'U-1', LineUID: 'Uabc',
    Role: 'Admin', LinkedID: 'T-1', PasswordHash: 'HASH2-MUST-NOT-APPEAR-7c41', Status: 'ACTIVE' });
  /* 🔴 A BAIT IN THE HR ACCESS LOG. The prefix alone only proves the two tabs are NAMED differently;
   * this proves HR_AUDIT_LOG reads the HR workbook. Keyed by sheet name, the lookup found MAIN's log
   * twice and this row would have been in neither tab. */
  appendObject_(sheet_(getHrSpreadsheet_(), 'AUDIT_LOG'), { Timestamp: '2026-10-14 09:00',
    UserID: 'ADM', Action: 'HR-ONLY-ROW-MUST-APPEAR', TableName: 'PAYROLL', RecordID: 'PR-1' });
  // ...and the live-shaped secrets, with values nothing else could produce
  setConfigValue_('SlipOK_ApiKey', 'SECRET-SLIPOK-MUST-NOT-APPEAR');
  setConfigValue_('LineChannelAccessToken', 'SECRET-LINETOKEN-MUST-NOT-APPEAR');
  setConfigValue_('LineLoginChannelSecret', 'SECRET-LOGIN-MUST-NOT-APPEAR');
  setConfigValue_('SeedMockKey', 'SECRET-SEEDKEY-MUST-NOT-APPEAR');
  // a key that LOOKS secret by name but was never declared — the second net has to catch it
  setConfigValue_('SomeNewVendorToken', 'SECRET-UNDECLARED-MUST-NOT-APPEAR');
  // ...and one that is NOT a secret and must survive, or the net is just deleting the settings
  setConfigValue_('GoogleClientId', '120486339414-public.apps.googleusercontent.com');
  _configCache = null;
  try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}

  var man = handleExportManifest({ staffId: 'ADM' });
  var sheets = [], pages = 0;
  man.tables.forEach(function (t) {
    var rows = [t.cols.slice()], offset = 0, guard = 0;
    for (;;) {
      var pg = handleExportTable({ key: t.key, offset: offset, limit: man.pageSize });
      pg.rows.forEach(function (r) { rows.push(r); });
      offset += pg.rows.length; pages++;
      if (pg.done || !pg.rows.length || ++guard > 200) break;
    }
    sheets.push({ name: t.key, rows: rows, declared: t.rows });
  });

  // did it refuse a table nobody declared?
  var undeclared = null;
  try { handleExportTable({ key: 'PASSWORD_RESETS_PRIVATE' }); undeclared = 'ALLOWED'; }
  catch (e) { undeclared = (e && e.apiCode) || 'ERR'; }

  // was the export recorded? (PDPA §39 — a copy of the whole school leaving is an event)
  var audit = [];
  try {
    audit = readObjects_(sheet_(getMainSpreadsheet_(), 'AUDIT_LOG'))
      .filter(function (a) { return String(a.Action) === 'EXPORT_SCHOOL'; })
      .map(function (a) { return { by: String(a.UserID || ''), tbl: String(a.TableName || '') }; });
  } catch (e) {}

  return JSON.stringify({ man: man, sheets: sheets, pages: pages, undeclared: undeclared,
    audit: audit, declaredKeys: SCHOOL_CONFIG_DEFAULTS.map(function (r) { return r[0]; }) });
}));

/* Everything that came out, as one string. The secret assertions search THIS, not a field we chose. */
const ALL = JSON.stringify(res.sheets);

console.log('\n1) 🔴 ไม่มีรหัสผ่านและคีย์เชื่อมต่อหลุดออกไปในไฟล์');
['HASH-MUST-NOT-APPEAR-9f2b', 'HASH2-MUST-NOT-APPEAR-7c41'].forEach((bait, i) =>
  ok_('รหัสผ่าน (hash) ไม่ปรากฏที่ไหนเลยในไฟล์ #' + (i + 1), ALL.indexOf(bait) < 0));
['SECRET-SLIPOK', 'SECRET-LINETOKEN', 'SECRET-LOGIN', 'SECRET-SEEDKEY'].forEach(bait =>
  ok_('คีย์ที่ประกาศไว้ไม่ปรากฏ: ' + bait, ALL.indexOf(bait) < 0));
ok_('🔴 ...และคีย์ที่ยังไม่มีใครประกาศ แต่ชื่อบอกว่าเป็นความลับ ก็ไม่ปรากฏ (ตาข่ายชั้นที่สอง)',
  ALL.indexOf('SECRET-UNDECLARED') < 0);
ok_('ค่าที่ไม่ใช่ความลับยังอยู่ (ตาข่ายไม่ได้ลบการตั้งค่าทิ้ง)',
  ALL.indexOf('120486339414-public.apps.googleusercontent.com') >= 0);
{
  // ...and the KEY itself is kept, so the school can see the setting exists and is filled in
  const cfg = res.sheets.filter(s => s.name === 'SCHOOL_CONFIG')[0] || { rows: [] };
  const row = cfg.rows.filter(r => r[0] === 'LineChannelAccessToken')[0] || [];
  eq('🔴 แถวยังอยู่ · เฉพาะ "ค่า" ที่ถูกปิด (ถ้าลบทั้งแถว โรงเรียนจะเข้าใจว่ายังไม่ได้ตั้งค่า)',
    row, ['LineChannelAccessToken', '(ไม่ส่งออก)']);
}
{
  // no column called PasswordHash anywhere — dropped, not blanked, because a blank column invites
  // somebody to "fill it back in" from a backup
  const hasCol = res.sheets.some(s => (s.rows[0] || []).indexOf('PasswordHash') >= 0);
  ok_('ไม่มีคอลัมน์ PasswordHash อยู่ในไฟล์เลย', !hasCol);
}

console.log('\n2) 🔴 ครบทุกตาราง — "ข้อมูลทั้งหมด" ต้องหมายความว่าทั้งหมดจริง');
{
  /* Read from Config.gs the way tools/schema_inventory.js does, and compare against what came out.
   * This is the assertion that a table added to the app next month is in the export the same day —
   * the alternative is a hand-kept list, and a hand-kept list of "all your data" is the thing this
   * whole feature exists to stop. */
  const cfg = R('src/Config.gs').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const perWb = { MAIN: [], HR: [] };
  for (const wb of ['MAIN', 'HR']) {
    const start = cfg.indexOf(`SCHEMA[WB.${wb}] = {`); if (start < 0) continue;
    const end = cfg.indexOf('\n};', start);
    const block = cfg.slice(start, end < 0 ? undefined : end);
    const re = /^\s{2}([A-Z][A-Z0-9_]*):\s*\[([\s\S]*?)\],?\s*$/gm;
    let m; while ((m = re.exec(block))) if ((m[2].match(/'([^']+)'/g) || []).length) perWb[wb].push(m[1]);
  }
  /* 🔴 ONE TABLE PER (WORKBOOK, SHEET) PAIR, NOT PER NAME. AUDIT_LOG is declared in both workbooks
   * and they are two different logs — MAIN's general access log, and HR's log of who read the
   * salaries. Counting by name said 46 tables when the school has 47, and the missing one was the
   * confidential record. The HR copy is prefixed, exactly as the Postgres table names are. */
  const declared = perWb.MAIN.concat(perWb.HR.map(n =>
    perWb.MAIN.indexOf(n) >= 0 ? 'HR_' + n : n));
  ok_('🔴 AUDIT_LOG ประกาศไว้ทั้งสองไฟล์ และต้องออกมาเป็นสองแท็บที่ต่างกัน',
    declared.indexOf('AUDIT_LOG') >= 0 && declared.indexOf('HR_AUDIT_LOG') >= 0);
  const got = res.sheets.map(s => s.name).sort();
  eq('ทุกตารางที่ประกาศใน SCHEMA อยู่ในไฟล์ (ไม่ขาดไปเงียบๆ)',
    declared.slice().sort().filter(d => got.indexOf(d) < 0), []);
  ok_('...และไม่มีตารางแปลกปลอมเกินมา', got.filter(g => declared.indexOf(g) < 0).length === 0);
  ok_('มีมากกว่า 40 ตาราง (ถ้าร่วงเหลือหยิบมือเดียว คือ parser พัง ไม่ใช่โรงเรียนว่าง)',
    got.length > 40);
}
{
  // a table with no rows still has its header tab — "no withdrawals" and "we did not give you
  // withdrawals" are different messages to whoever reads this file in a year
  const empty = res.sheets.filter(s => s.rows.length === 1);
  ok_('ตารางที่ยังไม่มีข้อมูล ยังมีแท็บและหัวคอลัมน์', empty.length > 0 &&
    empty.every(s => (s.rows[0] || []).length > 0));
  // ...and the rows really are there for the ones that have data
  const stu = res.sheets.filter(s => s.name === 'STUDENTS')[0];
  ok_('ข้อมูลเด็กอยู่ในไฟล์จริง', JSON.stringify(stu.rows).indexOf('เด็กทดสอบ') >= 0);
  /* 🔴 THE TWO AUDIT LOGS ARE REALLY TWO. The HR one records who read the salaries, and keyed by
   * sheet name it was MAIN's log exported twice — a tab labelled AUDIT_LOG~2 full of the wrong
   * rows, and the confidential record silently absent from a file that claims to be everything. */
  const hrLog = res.sheets.filter(s => s.name === 'HR_AUDIT_LOG')[0] || { rows: [] };
  const mainLog = res.sheets.filter(s => s.name === 'AUDIT_LOG')[0] || { rows: [] };
  ok_('🔴 HR_AUDIT_LOG อ่านจากไฟล์ฝ่ายบุคคลจริง (ไม่ใช่สำเนาของ AUDIT_LOG หลัก)',
    JSON.stringify(hrLog.rows).indexOf('HR-ONLY-ROW-MUST-APPEAR') >= 0);
  ok_('...และ AUDIT_LOG หลักไม่มีแถวของฝ่ายบุคคลปนมา',
    JSON.stringify(mainLog.rows).indexOf('HR-ONLY-ROW-MUST-APPEAR') < 0);
}

console.log('\n3) 🔴 ขอตารางที่ไม่ได้ประกาศไว้ ต้องถูกปฏิเสธ');
eq('ปฏิเสธด้วย BAD_INPUT (ถ้าเปิดให้อ่านตามชื่อที่ส่งมา การปิดคอลัมน์ลับจะไม่มีผล)',
  res.undeclared, 'BAD_INPUT');

console.log('\n4) 🔴 การสำรองข้อมูลทั้งโรงเรียน ถูกบันทึกไว้ว่าใครทำ (PDPA ม.39)');
eq('มี 1 รายการ', res.audit.length, 1);
eq('...และรู้ว่าใครกด', (res.audit[0] || {}).by, 'ADM');

console.log('\n5) ทุกคีย์ใน SCHOOL_CONFIG ถูกจัดประเภทแล้ว — คีย์ใหม่ต้องมีคนตัดสิน');
{
  /* The declared-vs-pattern split is the lesson from Phase 2.3 applied forward: a name pattern
   * cannot answer a question about meaning, so every key is a decision. What this asserts is that
   * no key has been ADDED without one — either it is in the declared secret list, or it does not
   * look like a secret, and nothing sits in the gap being handled by luck. */
  const src = R('src/Portability.gs');
  const declaredSecret = (src.split('EXPORT_SECRET_CONFIG_ = {')[1] || '').split('}')[0];
  const looksSecret = k => /secret|token|apikey|api_key|passwor|privatekey|private_key/i.test(k);
  const unclassified = (res.declaredKeys || []).filter(k =>
    looksSecret(k) && declaredSecret.indexOf(k) < 0);
  /* An empty list here does NOT mean "nothing looks secret" — it means every key that does is also
   * declared. The pattern net would still catch a new one; this is about it being a DECISION. */
  eq('คีย์ที่ชื่อเหมือนความลับ แต่ยังไม่ได้ประกาศ', unclassified, []);
  ok_('🔴 LiffID / GoogleClientId / LineLoginChannelId ยังส่งออกได้ (id ที่ส่งให้ทุกเบราว์เซอร์ ไม่ใช่ความลับ)',
    !looksSecret('LiffID') && !looksSecret('GoogleClientId') && !looksSecret('LineLoginChannelId'));
}

console.log('\n6) ชื่อแท็บที่ Excel ยอมรับ — และนี่คือจุดที่ Excel ปฏิเสธไฟล์ทั้งไฟล์');
{
  /* Loaded by evaluating xlsx_min.js with a stub window: the sheet-name rules decide whether the
   * file opens at all, and asserting them should not need a browser or a download. */
  const sandbox = { window: {}, Blob: function () {}, URL: {}, document: {} };
  const vm = require('vm');
  vm.createContext(sandbox);
  vm.runInContext(R('webapp/xlsx_min.js'), sandbox);
  const safe = sandbox.window.XLSXMin._safeNames;
  ok_('_safeNames ถูก export ออกมาให้ทดสอบได้', typeof safe === 'function');
  eq('ตัดอักขระที่ Excel ห้าม : \\ / ? * [ ]',
    safe([{ name: 'A:B/C\\D?E*F[G]H' }]), ['A_B_C_D_E_F_G_H']);
  eq('ยาวไม่เกิน 31 ตัวอักษร',
    safe([{ name: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' }]), ['ABCDEFGHIJKLMNOPQRSTUVWXYZ01234']);
  eq('ชื่อว่าง → ตั้งชื่อให้', safe([{ name: '' }]), ['Sheet1']);
  /* 🔴 Case-INSENSITIVE uniqueness. Excel treats DAILY_JOURNAL and daily_journal as the same sheet
   * and refuses the workbook; a check that only compared exact strings would let it through. */
  eq('ชื่อซ้ำ (ไม่สนตัวพิมพ์ใหญ่เล็ก) → ต่อท้ายให้ไม่ซ้ำ',
    safe([{ name: 'JOURNAL' }, { name: 'journal' }, { name: 'Journal' }]),
    ['JOURNAL', 'journal~2', 'Journal~3']);
  // ...and the de-duplicating suffix must itself fit inside 31, or the fix is as invalid as the bug
  const long = safe([{ name: 'A'.repeat(31) }, { name: 'A'.repeat(31) }]);
  ok_('🔴 ตัวต่อท้ายต้องอยู่ใน 31 ตัวอักษรด้วย', long[1].length <= 31 && long[1] !== long[0]);
  // every real table name survives unchanged — if any needed mangling the file would open with tabs
  // the school cannot match back to anything
  const names = res.sheets.map(s => s.name);
  eq('ชื่อตารางจริงทุกชื่อผ่านโดยไม่ถูกแก้', safe(names.map(n => ({ name: n }))), names);
}

console.log('\n7) เส้นทางนี้เป็นการอ่าน และเป็นของแอดมินเท่านั้น');
{
  const code = R('src/Code.gs');
  ok_('exportManifest + exportTable อยู่ในรายการ admin-only',
    /exportManifest:\s*1/.test(code) && /exportTable:\s*1/.test(code));
  ok_('🔴 ไม่เข้าเงื่อนไข MUTATING_RE (จะได้ไม่ไปรอคิว write lock ของคนอื่น)',
    !/^(submit|save|add|remove|delete|set|register|pay|upload|confirm|reject|issue|generate|move|import|compute|cancel|prepay|link|notify|request|mark|approve|edit|rename|update|change|seed|recompute|restore|bind|provision)/i.test('exportManifest') &&
    !/^(submit|save|add|remove|delete|set|register|pay|upload|confirm|reject|issue|generate|move|import|compute|cancel|prepay|link|notify|request|mark|approve|edit|rename|update|change|seed|recompute|restore|bind|provision)/i.test('exportTable'));
  ok_('หน้าจอแอดมินเรียกทั้งสองเส้นทาง',
    /api\('exportManifest'/.test(R('webapp/app.js')) && /api\('exportTable'/.test(R('webapp/app.js')));
  ok_('ปุ่มบอกด้วยว่าไฟล์นี้ไม่มีรหัสผ่านและคีย์',
    /ie\.exportAllSafe/.test(R('webapp/app.js')) && /ie\.exportAllSafe/.test(R('webapp/i18n.js')));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
