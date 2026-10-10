/**
 * tools/test_parent_bell.js — the family's 🔔 bell, which did not exist before 2026-10-10.
 *   node tools/test_parent_bell.js
 *
 * 🔴 WHY THIS IS A SEPARATE SUITE
 *
 * Asked for with the App / Line OA columns: "เรื่องไหนแจ้งในแอปพอ เรื่องไหนให้ Line แจ้ง". For a
 * teacher or an admin the first half already worked. For a PARENT it did not exist at all:
 * handleNotifications' parent branch fell through to the engine's `notifications`, which reads
 * `M.feed` — hard-coded to `[]` by GasEngine and never written to by any code in the repo. A
 * parent's bell had therefore been empty since go-live, and all seven family topics were LINE or
 * nothing.
 *
 * So the App column could not honestly be offered until there was something behind it. This suite
 * runs the REAL handlers against the harness and asks the three questions that decide whether the
 * thing behind it works:
 *
 *   §1  does a family notification reach the right family, and only that family
 *   §2  does it stay OUT of the admin's tray (the leak this change could easily have caused)
 *   §3  do the two channels really move independently
 */
const harness = require('./gas_test_harness');
const { run } = harness(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed',
                         'Checkin', 'Triggers', 'Leave', 'Notify', 'Parent', 'Journal']);

const result = run(function () {
  _configCache = null; setupAll(); _configCache = null;
  const MAIN = getMainSpreadsheet_();
  const cfg = sheet_(MAIN, 'SCHOOL_CONFIG');
  updateRow_(cfg, findObject_(cfg, r => r.Key === 'LineChannelAccessToken')._row, { Value: 'REALTOKEN' });
  const setTopic = (k, v) => { const r = findObject_(cfg, x => x.Key === k);
    if (r) updateRow_(cfg, r._row, { Value: v }); else appendObject_(cfg, { Key: k, Value: v });
    _configCache = null; };

  let pass = 0, fail = 0;
  const eq = (l, got, want) => { const o = JSON.stringify(got) === JSON.stringify(want);
    console.log((o ? '  ok   ' : '  FAIL ') + l + (o ? '' : '\n         got =' + JSON.stringify(got) + '\n         want=' + JSON.stringify(want)));
    o ? pass++ : fail++; };
  const ok_ = (l, c) => { console.log((c ? '  ok   ' : '  FAIL ') + l); c ? pass++ : fail++; };

  // ── two families, so "only that family" is a question with a wrong answer available ───────────
  const st = sheet_(MAIN, 'STUDENTS'), pa = sheet_(MAIN, 'PARENTS');
  appendObject_(st, { StudentID: 'S-A', Name: 'เด็กเอ', Class: 'Baby', ParentID: 'P-A', Status: 'ACTIVE' });
  appendObject_(st, { StudentID: 'S-B', Name: 'เด็กบี', Class: 'Baby', ParentID: 'P-B', Status: 'ACTIVE' });
  appendObject_(pa, { ParentID: 'P-A', StudentID: 'S-A', Name: 'แม่เอ', LineUID: 'U-A' });
  // the SECOND parent of the same child — a father linked later, no LineUID of his own yet
  appendObject_(pa, { ParentID: 'P-A2', StudentID: 'S-A', Name: 'พ่อเอ', LineUID: '' });
  appendObject_(pa, { ParentID: 'P-B', StudentID: 'S-B', Name: 'แม่บี', LineUID: 'U-B' });

  const kidA = findObject_(st, s => s.StudentID === 'S-A');
  const bell = p => handleNotifications(Object.assign({ role: 'Parent' }, p)).map(n => n.text);
  const inboxRows = () => readObjects_(inboxSheet_());

  console.log('\n1) 🔔 ข้อความถึงครอบครัว เข้ากระดิ่งของครอบครัวนั้น');
  {
    setTopic('NotifyParentJournal', 'app');          // in-app only — no quota spent
    PUSH.length = 0;
    notifyStudentParents_(kidA, '📒 บันทึกประจำวันของ เด็กเอ พร้อมแล้ว', 'parent.journal');

    eq('แม่ของเด็กเอ เห็นในกระดิ่ง', bell({ parentId: 'P-A' }), ['📒 บันทึกประจำวันของ เด็กเอ พร้อมแล้ว']);
    /* ONE ROW, BOTH PARENTS. The row is keyed by CHILD, not by parent — a father who linked later
     * has no row of his own to be forgotten, and neither parent sees it twice. */
    eq('...พ่อของเด็กเอ เห็นเหมือนกัน จากแถวเดียวกัน', bell({ parentId: 'P-A2' }), ['📒 บันทึกประจำวันของ เด็กเอ พร้อมแล้ว']);
    eq('🔴 ครอบครัวอื่นไม่เห็น', bell({ parentId: 'P-B' }), []);
    eq('...และเขียนแถวเดียว ไม่ใช่แถวละผู้ปกครอง', inboxRows().filter(r => String(r.StudentID) === 'S-A').length, 1);
    eq('🔴 ช่อง LINE ปิดอยู่ จึงไม่เสียโควตาเลย', PUSH.length, 0);
  }

  console.log('\n2) 🔴 ...และไม่หลุดเข้ากล่องของแอดมิน');
  {
    /* The shared Admin inbox is "every row with no StaffID". A family row also has no StaffID, so
     * without an explicit exclusion every child's journal would have poured into the admin's tray —
     * and the admin would have been the one to find out. */
    const adminSees = handleNotifications({ role: ROLES.ADMIN }).map(n => n.text);
    eq('🔴 กล่องแอดมินไม่มีข้อความของครอบครัว', adminSees.filter(t => /เด็กเอ/.test(t)), []);
    /* CONTROL — the admin's own inbox still works, or the check above passes on an empty tray.
     * The admin topic has to be switched ON for this, which is the point: the admin bell is itself
     * a channel now and the first draft of this control forgot that, so it failed. */
    setTopic('NotifyAdminApproval', 'app');
    notifyAdmins_('ทดสอบ: มีคำขออนุมัติ', 'approval');
    ok_('CONTROL: แต่เรื่องของแอดมินเองยังเข้าปกติ',
      handleNotifications({ role: ROLES.ADMIN }).some(n => /มีคำขออนุมัติ/.test(n.text)));
    eq('...และครอบครัวก็ไม่เห็นเรื่องของแอดมิน', bell({ parentId: 'P-A' }).filter(t => /คำขออนุมัติ/.test(t)), []);
  }

  console.log('\n3) 📱/💬 สองช่องทางเดินแยกกันจริง');
  {
    setTopic('NotifyParentLeave', 'line');           // LINE only — nothing in the bell
    PUSH.length = 0;
    const before = inboxRows().length;
    notifyStudentParents_(kidA, '🏠 คุณครูแจ้งลาให้ เด็กเอ', 'parent.leave');
    eq('ติ๊กแค่ LINE → ส่ง LINE', PUSH.map(p => p.to), ['U-A']);
    eq('...และไม่เพิ่มแถวในกระดิ่ง', inboxRows().length, before);

    setTopic('NotifyParentDspm', 'app,line');        // both
    PUSH.length = 0;
    notifyStudentParents_(kidA, '📝 ผลประเมิน เด็กเอ', 'parent.dspm');
    eq('ติ๊กทั้งคู่ → ส่ง LINE ด้วย', PUSH.map(p => p.to), ['U-A']);
    ok_('...และเข้ากระดิ่งด้วย', bell({ parentId: 'P-A' }).some(t => /ผลประเมิน/.test(t)));

    setTopic('NotifyParentOt', '');                  // neither — allowed, and warned about on screen
    PUSH.length = 0;
    const b2 = inboxRows().length;
    notifyStudentParents_(kidA, '⏰ รับช้า', 'parent.ot');
    eq('🔴 ไม่ติ๊กเลย → ไม่ถึงใครทั้งสองทาง', [PUSH.length, inboxRows().length - b2], [0, 0]);

    /* 🚨 ...and the one that cannot be switched off, with EVERY topic set to nothing. */
    PUSH.length = 0;
    const b3 = inboxRows().length;
    notifyStudentParents_(kidA, '🚨 แจ้งเหตุจากโรงเรียน', 'emergency');
    eq('🚨 อุบัติเหตุส่งทั้งสองทางเสมอ', [PUSH.map(p => p.to), inboxRows().length - b3], [['U-A'], 1]);
  }

  console.log('\n4) อ่านแล้วถือว่าอ่าน — และของครอบครัวตัวเองเท่านั้น');
  {
    handleMarkNotifsRead({ role: 'Parent', parentId: 'P-A' });
    eq('🔴 ของเด็กเอ ถูกทำเครื่องหมายว่าอ่านแล้ว',
      inboxRows().filter(r => String(r.StudentID) === 'S-A' && String(r.Read) !== 'YES').length, 0);
    /* CONTROL — build a row for family B and prove A's mark-read did not touch it. Without this the
     * assertion above passes just as happily on code that marks the WHOLE sheet read. */
    setTopic('NotifyParentJournal', 'app');
    notifyStudentParents_(findObject_(st, s => s.StudentID === 'S-B'), '📒 ของเด็กบี', 'parent.journal');
    handleMarkNotifsRead({ role: 'Parent', parentId: 'P-A' });
    eq('CONTROL: 🔴 ...แต่ของครอบครัวอื่นยังไม่ถูกอ่าน',
      inboxRows().filter(r => String(r.StudentID) === 'S-B' && String(r.Read) !== 'YES').length, 1);
  }

  console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
  return fail === 0;
});

process.exit(result ? 0 : 1);
