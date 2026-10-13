/**
 * tools/test_notify_topics.js — one switch per topic, and nothing sends without one.
 *   node tools/test_notify_topics.js
 *
 * 🔴 WHAT THIS IS GUARDING, AND WHY IT EXISTS (2026-10-09 → 10-10)
 *
 * The ผอ. reported, for the second time, that parents were receiving LINE messages after the school
 * had turned notifications off. They attached two: a teacher's reply to a journal comment, and a
 * teacher filing a leave for a child.
 *
 * Neither was a bug in the sending. The switch was labelled
 *
 *     "ส่ง LINE ถึงผู้ปกครอง: รับ-ส่ง · บันทึกประจำวัน · ผลประเมิน DSPM"
 *
 * and it did exactly those three. The app sent families TEN kinds of message, and SIX of them read
 * no config at all — `notifyStudentParents_(student, text)` simply sent. The school turned the
 * switch on having read a label that described less than half of what the channel did.
 *
 * That is the failure this suite exists to make impossible to repeat:
 *
 *   §1  every LINE push to a family or a teacher passes through a declared topic
 *   §2  the topic list is the SAME list in all four places that need it
 *   §3  an undeclared topic sends NOTHING — it fails closed, it does not fall back to "send"
 *   §4  🚨 an emergency has no switch and cannot be turned off
 *
 * §3 is the one that matters in a year's time. Somebody will add a push site and forget the topic.
 * The consequence of forgetting must be silence, not a message to every family in the school.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const decom = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0, fail = 0;
function eq(l, got, want) {
  const o = JSON.stringify(got) === JSON.stringify(want);
  console.log((o ? '  ok   ' : '  FAIL ') + l + (o ? '' : '\n         got =' + JSON.stringify(got) + '\n         want=' + JSON.stringify(want)));
  o ? pass++ : fail++;
}
function ok_(l, c) { console.log((c ? '  ok   ' : '  FAIL ') + l); c ? pass++ : fail++; }

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n1) หัวข้อเดียวกัน ต้องตรงกันทั้ง 4 ที่');
// ════════════════════════════════════════════════════════════════════════════════════════════
const line = R('src/Line.gs'), config = R('src/Config.gs');
const app = R('webapp/app.js'), engine = R('webapp/engine.js');

/* the topic table in src/Line.gs — 'parent.leave': 'NotifyParentLeave' */
const topicTable = {};
{
  const m = /var LINE_TOPIC_KEYS_ = \{([\s\S]*?)\n\};/.exec(line);
  ok_('อ่านตาราง LINE_TOPIC_KEYS_ ใน Line.gs ได้', !!m);
  if (m) for (const x of m[1].matchAll(/'([\w.]+)'\s*:\s*'(\w+)'/g)) topicTable[x[1]] = x[2];
}
const topics = Object.keys(topicTable).sort();
const keys = Object.values(topicTable).sort();
ok_('มีหัวข้อครบทั้ง 3 ฝั่ง (ผู้ปกครอง · คุณครู · แอดมิน)',
  topics.some(t => t.indexOf('parent.') === 0) &&
  topics.some(t => t.indexOf('staff.') === 0) &&
  topics.some(t => t.indexOf('admin.') === 0));
ok_('...และมีมากกว่า 3 หัวข้อ (เดิมมี 3 สวิตช์คุมทั้งระบบ)', topics.length > 3);

/* ② every key has a default in SCHOOL_CONFIG_DEFAULTS — without one, getConfig_ falls back to the
 * literal passed at the call site and the settings screen has nothing to read back */
{
  const missing = keys.filter(k => config.indexOf("['" + k + "',") < 0);
  eq('🔴 ทุกคีย์มีค่าเริ่มต้นใน Config.gs', missing, []);
}
/* ③ the engine's whitelist — the list that decides what an admin may SAVE */
{
  const m = /const NOTIFY_KEYS_ = \[([\s\S]*?)\];/.exec(engine);
  ok_('อ่าน NOTIFY_KEYS_ ใน engine.js ได้', !!m);
  const declared = m ? (m[1].match(/'(\w+)'/g) || []).map(s => s.slice(1, -1)).sort() : [];
  eq('🔴 รายชื่อใน engine.js ตรงกับตารางหัวข้อเป๊ะ', declared, keys);
}
/* ④ the settings screen — a topic with no row cannot be turned on; a row with no topic does nothing */
{
  const m = /const NOTIFY_TOPICS_ = \[([\s\S]*?)\n  \];/.exec(app);
  ok_('อ่าน NOTIFY_TOPICS_ ในหน้าตั้งค่าได้', !!m);
  const drawn = m ? (m[1].match(/k:'(\w+)'/g) || []).map(s => s.slice(3, -1)).sort() : [];
  eq('🔴 ทุกหัวข้อมีบรรทัดในหน้าตั้งค่า และไม่มีบรรทัดที่ไม่มีหัวข้อ', drawn, keys);
  // ...and every row says something in BOTH languages — a blank label is a switch nobody can use
  const rows = m ? [...m[1].matchAll(/\{[^}]*k:'(\w+)'[^}]*\}/g)] : [];
  const noLabel = rows.filter(r => !/th:'[^']+'/.test(r[0]) || !/en:'[^']+'/.test(r[0])).map(r => r[1]);
  eq('...และทุกบรรทัดมีข้อความทั้งไทยและอังกฤษ', noLabel, []);
}
/* ⑤ the live whitelist in Staff.gs is DERIVED from the table, not typed again */
ok_('🔴 Staff.gs เติม whitelist จากตารางหัวข้อ ไม่ได้พิมพ์ซ้ำ',
  /LINE_TOPIC_KEYS_\[t\]\]\s*=\s*1/.test(R('src/Staff.gs')));

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n2) 🔴 ไม่มีการส่ง LINE ถึงครอบครัว/คุณครู ที่ไม่ผ่านหัวข้อ');
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  /* Every caller of the three fan-out helpers must name a topic. These are the functions that reach
   * a FAMILY or a whole class of teachers — the ones that cost quota in bulk and that nobody sees
   * the volume of until the month ends. */
  const files = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.gs') && f !== 'Engine.gs');
  const bad = [];
  for (const f of files) {
    const src = decom(R('src/' + f));
    /* notifyStudentParents_(student, text, topic) — three arguments, and the third is the point.
     * Matched by counting top-level commas rather than by a fixed pattern, because the text argument
     * is a multi-line concatenation in every single caller. */
    /* `(?<!function )` — the declaration is not a call site. Without it this reported the function's
     * own signature as a caller that forgot its topic, which is the kind of false positive that gets
     * a suite edited until it stops complaining. */
    for (const m of src.matchAll(/(?<!function )notifyStudentParents_\(/g)) {
      const start = m.index + m[0].length;
      let depth = 1, i = start, commas = 0, inStr = '';
      while (i < src.length && depth > 0) {
        const c = src[i];
        if (inStr) { if (c === '\\') i++; else if (c === inStr) inStr = ''; }
        else if (c === "'" || c === '"') inStr = c;
        else if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth--;
        else if (c === ',' && depth === 1) commas++;
        i++;
      }
      const args = src.slice(start, i - 1);
      if (commas < 2) bad.push(f + ': notifyStudentParents_ ไม่ได้ส่ง topic');
      else if (!/,\s*'[\w.]+'\s*\)?\s*$/.test(args.trim()))
        bad.push(f + ': notifyStudentParents_ topic ไม่ใช่ค่าคงที่');
    }
  }
  eq('🔴 ทุกจุดที่ส่งหาผู้ปกครองแบบหว่าน ระบุหัวข้อครบ', bad, []);

  // ...and the two fan-outs to staff take it through opts.topic / the 5th argument
  /* ...และทั้งสองตัวแยก 2 ช่องทาง: กระดิ่งในแอปกับ LINE ปิด/เปิดอิสระจากกัน
   * (ก่อน 10/10 กระดิ่งของคุณครูเขียนเสมอ ปิดไม่ได้ — ตอนนี้ปิดได้ และหน้าจอเตือนถ้าปิดทั้งคู่) */
  {
    const parentGs = decom(R('src/Parent.gs')), notifyGs = R('src/Notify.gs');
    ok_('notifyStudentTeacher_ แยก app/line จาก notifyChannels_(opts.topic)',
      /var chans = notifyChannels_\(opts\.topic\);/.test(parentGs) &&
      /var lineOn = chans\.line, appOn = chans\.app;/.test(parentGs) &&
      /if \(appOn\) \{ inboxAdd_\(/.test(parentGs));
    ok_('notifyStaffMember_ แยก app/line เหมือนกัน',
      /function notifyStaffMember_\(staffId, text, category, ref, topic\)/.test(notifyGs) &&
      /var ch = notifyChannels_\(topic\);/.test(notifyGs) &&
      /if \(ch\.app\) \{ try \{ inboxAdd_\(/.test(notifyGs) &&
      /if \(!ch\.line\) return false;/.test(notifyGs));
  }

  /* 🔴 AND notifyLeaders_ GOES THROUGH THE HOUSE PATTERN (found 2026-10-12, and it was my break).
   *
   * It was LINE-ONLY, which was harmless while the push was unconditional: the head teacher always
   * heard. Putting `lineTopicOn_` in front of that one line — with every topic shipping OFF — meant
   * a leave request reached them through NO channel at all. It is still visible on their 📩 screen,
   * so nothing is lost, but nobody is prompted, and a request nobody is prompted about is a request
   * that waits.
   *
   * `s.LineUID &&` in the old condition also meant a Leader with no LINE account was never told
   * under ANY setting, since this was written. The bell does not need a LINE id. */
  {
    const leaveGs = R('src/Leave.gs');
    ok_('🔴 notifyLeaders_ ใช้ notifyStaffMember_ (กระดิ่งเสมอ · LINE ตามหัวข้อ)',
      /function notifyLeaders_[\s\S]{0,600}notifyStaffMember_\(s\.StaffID, text, 'approval', '', 'staff\.approvalQueue'\)/.test(leaveGs));
    ok_('...และไม่ต้องมี LineUID ถึงจะได้รับแจ้ง',
      !/PositionLevel\) === 'Leader'[\s\S]{0,120}s\.LineUID &&/.test(leaveGs));
    ok_('CONTROL: ยังกรองเฉพาะหัวหน้าที่ยังทำงานอยู่ และตามแผนกเมื่อระบุ',
      /String\(s\.PositionLevel\) !== 'Leader' \|\| String\(s\.Status\) !== 'ACTIVE'/.test(leaveGs) &&
      /if \(dept && String\(s\.Department\) !== String\(dept\)\) return;/.test(leaveGs));
  }

  /* ═══ 🔴 NO RAW LINE PUSH TO A MEMBER OF STAFF, ANYWHERE ══════════════════════════════════════
   *
   * The sweep above only followed the two FAN-OUT helpers. Four sites pushed a staff member
   * directly, and §2 could not see any of them — found on 2026-10-12 by reading every file by hand,
   * which is not a method:
   *
   *   AttReq.gs    the result of a time-correction request — UNGATED, ignoring every setting,
   *                the exact defect the per-topic switches existed to end
   *   ClassOrg.gs  "you have been moved to another class" — LINE only, so with the topic off a
   *                teacher was moved and never told by anything
   *   Leave.gs ×2  "your leave was approved / refused" — LINE only, same hole
   *
   * All four go through notifyStaffMember_ now: 🔔 bell by the app channel, LINE by the line
   * channel, one rule. This check is what makes the fifth one fail instead of being found by eye.
   *
   * `s.LineUID` in a condition is the tell: it means the code is reaching for a LINE id directly
   * rather than asking the helper to decide. */
  {
    const staffFiles = ['src/AttReq.gs', 'src/ClassOrg.gs', 'src/Leave.gs', 'src/Day6.gs'];
    const raw = [];
    staffFiles.forEach(f => {
      const src = decom(R(f));
      for (const m of src.matchAll(/linePushText_\(\s*(\w+)\.LineUID/g)) raw.push(f + ': ' + m[1] + '.LineUID');
    });
    eq('🔴 ไม่มีการยิง LINE ถึงพนักงานตรงๆ โดยไม่ผ่านตัวกลาง', raw, []);
    ok_('...AttReq ใช้ notifyStaffMember_',
      /notifyStaffMember_\(r\.StaffID, msg, 'approval', '', 'staff\.approval'\)/.test(R('src/AttReq.gs')));
    ok_('...ClassOrg ใช้ notifyStaffMember_', /notifyStaffMember_\(r\.StaffID[\s\S]{0,160}'staff\.org'\)/.test(R('src/ClassOrg.gs')));
    ok_('...และผลอนุมัติ/ปฏิเสธใบลา ทั้งสองขั้น',
      (R('src/Leave.gs').match(/notifyStaffMember_\(requester\.StaffID/g) || []).length === 2);
    /* CONTROL — the scan reads real files and can still find a push. Without this it would pass just
     * as happily on a typo in a filename. */
    ok_('CONTROL: ตัวตรวจยังอ่านไฟล์จริงอยู่',
      staffFiles.every(f => R(f).length > 500) && /linePushText_/.test(R('src/Checkin.gs')));
  }

  /* Every caller of notifyStudentTeacher_ must pass opts.topic. A caller that passes no opts at all
   * now reaches nobody on LINE — which is the safe direction, but it is still a bug, so name them. */
  const noTopic = [];
  for (const f of files) {
    const src = decom(R('src/' + f));
    for (const m of src.matchAll(/(?<!function )notifyStudentTeacher_\(([\s\S]{0,700}?)\n\s*(?:\}|logAudit|return|var |try)/g)) {
      if (!/topic:\s*'[\w.]+'/.test(m[1])) noTopic.push(f + ': ' + m[1].slice(0, 45).replace(/\s+/g, ' '));
    }
  }
  eq('🔴 ทุกจุดที่แจ้งคุณครูทั้งชั้น ระบุหัวข้อครบ', noTopic, []);
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n3) 🔴 ไม่รู้จักหัวข้อ = ไม่ส่ง (ไม่ใช่ส่งทุกคน)');
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  /* Run the real function. A reading of the source would pass on code that looks right and is not —
   * and "fails open" is a defect you cannot see by reading, because the mistake is the ABSENCE of a
   * branch. So: build the two things lineTopicOn_ depends on, and ask it. */
  const body = /function notifyChannels_\(topic\) \{([\s\S]*?)\n\}/.exec(line);
  ok_('อ่านตัว notifyChannels_ ออกมารันได้', !!body);
  const tbl = /var LINE_TOPIC_KEYS_ = \{[\s\S]*?\n\};/.exec(line)[0];

  const mkCh = cfg => new Function('getConfig_', tbl + '\nreturn function notifyChannels_(topic){' + body[1] + '\n};')(
    (k, d) => (cfg.hasOwnProperty(k) ? cfg[k] : d));
  const allOn = {}; keys.forEach(k => { allOn[k] = 'app,line'; });
  const on = t => mkCh(allOn)(t).line, off = t => mkCh({})(t).line;

  eq('🔴 หัวข้อที่ไม่มีในตาราง → ไม่ส่ง', on('parent.somethingNobodyDeclared'), false);
  eq('🔴 ไม่ใส่หัวข้อเลย (undefined) → ไม่ส่ง', on(undefined), false);
  eq('🔴 ส่งค่าว่าง → ไม่ส่ง', on(''), false);
  eq('CONTROL: หัวข้อจริงที่เปิดไว้ → ส่ง', on('parent.journalReply'), true);
  eq('CONTROL: หัวข้อจริงที่ยังไม่ได้ตั้งค่า → ไม่ส่ง (ค่าเริ่มต้นคือปิด)', off('parent.journalReply'), false);
  // the two the ผอ. reported, by name — these are the regression
  eq('🔴 ครูตอบกลับความคิดเห็น ปิดได้แล้ว', off('parent.journalReply'), false);
  eq('🔴 ครูแจ้งลาให้นักเรียน ปิดได้แล้ว', off('parent.leave'), false);

  console.log('\n3b) 📱/💬 สองช่องทางต่อหัวข้อ — แยกกันจริง');
  {
    const ch = cfg => mkCh(cfg)('parent.journal');
    eq('ติ๊กแค่ในแอป → ไม่ส่ง LINE', ch({ NotifyParentJournal: 'app' }), { app: true, line: false });
    eq('ติ๊กแค่ LINE → ไม่เข้ากระดิ่ง', ch({ NotifyParentJournal: 'line' }), { app: false, line: true });
    eq('ติ๊กทั้งคู่', ch({ NotifyParentJournal: 'app,line' }), { app: true, line: true });
    eq('ไม่ติ๊กเลย → ไม่ถึงใคร (โรงเรียนเลือกให้ทำได้ แต่เตือน)', ch({ NotifyParentJournal: '' }), { app: false, line: false });
    /* 🔴 ค่าเดิมจากวันก่อนหน้าที่ยังไม่มีช่องทาง — ผอ. ถูกบอกให้ไปตั้งค่าแล้ว บางตัวอาจเป็น 'true' อยู่
     * ถ้าอ่านเป็น "ไม่มีช่องทาง" จะเท่ากับปิดสิ่งที่เพิ่งเปิดไปเมื่อวานโดยเงียบๆ */
    eq("🔴 ค่าเก่า 'true' = เปิดทั้งสองช่อง ไม่ใช่ปิด", ch({ NotifyParentJournal: 'true' }), { app: true, line: true });
    eq("ค่าเก่า 'false' = ปิดทั้งคู่", ch({ NotifyParentJournal: 'false' }), { app: false, line: false });
    // CONTROL — a value that means nothing must not accidentally match 'app' or 'line'
    eq('CONTROL: ค่าขยะ → ไม่ถึงใคร', ch({ NotifyParentJournal: 'yes please' }), { app: false, line: false });
    // ...and the client reads the SAME format, or the boxes would disagree with the sending
    const appJs = R('webapp/app.js');
    ok_('🔴 หน้าตั้งค่าอ่านรูปแบบเดียวกัน (รวมค่าเก่า true)',
      /v==='true' \? true : v\.indexOf\(ch\)>=0/.test(appJs));
    ok_('...และบันทึกกลับเป็น "app,line"', /chans\[k\]\.join\(','\)/.test(appJs));
  }

  // ────────────────────────────────────────────────────────────────────────────────────────────
  console.log('\n4) 🚨 เหตุฉุกเฉิน ปิดไม่ได้');
  // ────────────────────────────────────────────────────────────────────────────────────────────
  eq('🚨 ทุกสวิตช์ปิดหมด — อุบัติเหตุยังส่ง', off('emergency'), true);
  eq('🚨 ...และทุกสวิตช์เปิดหมด ก็ยังส่ง (ไม่ได้บังเอิญผ่านเพราะค่าอื่น)', on('emergency'), true);
  eq('🚨 ...และเข้ากระดิ่งในแอปด้วยเสมอ', mkCh({})('emergency'), { app: true, line: true });
  ok_('🚨 ไม่มีคีย์ตั้งค่าสำหรับเหตุฉุกเฉิน — ปิดไม่ได้เลยแม้แก้ชีตเอง',
    !Object.keys(topicTable).some(t => t === 'emergency') &&
    !keys.some(k => /emergency|urgent|injury/i.test(k)));
  ok_('🚨 การแจ้งผู้ปกครองเรื่องอุบัติเหตุ ใช้หัวข้อ emergency',
    /notifyStudentParents_\([\s\S]{0,400}?'emergency'\)/.test(R('src/Notify.gs')));
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n4b) 🔔 กระดิ่งของผู้ปกครอง — ของใหม่ 10/10 และก่อนหน้านี้ไม่มีเลย');
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  /* 🔴 ก่อน 10/10/2026 ฝั่งผู้ปกครองของ handleNotifications ตกไปที่ engine ซึ่งอ่าน `M.feed`
   * — GasEngine ตั้งเป็น [] ตายตัว และไม่มีโค้ดบรรทัดไหนในระบบเขียนลงไปเลย
   * กระดิ่งของผู้ปกครองจึงว่างเปล่ามาตั้งแต่เปิดใช้ และทั้ง 7 เรื่องเป็น LINE หรือไม่มีอะไรเลย */
  const notify = R('src/Notify.gs'), parent = R('src/Parent.gs'), gas = R('src/GasEngine.gs');
  ok_('🔴 M.feed ยังเป็น [] ตายตัวบน GAS — ยืนยันว่าทางเดิมไม่เคยมีข้อมูล',
    /\['calendar', 'feed'\][\s\S]{0,120}return \[\];/.test(gas));
  ok_('มีตัวเขียนแถวแจ้งเตือนของครอบครัวแล้ว', /function inboxAddStudent_\(/.test(notify));
  ok_('...และตัวอ่านฝั่งผู้ปกครอง', /function inboxItemsForParent_\(/.test(notify));
  ok_('🔴 handleNotifications มีสาขาของผู้ปกครองก่อนจะตกไปที่ engine',
    /inboxItemsForParent_\(p\)[\s\S]{0,600}engineDispatch_\('notifications'/.test(notify));

  /* 🔴 THE LEAK THIS WOULD HAVE CAUSED. The shared Admin inbox is "every row with no StaffID", and
   * a family row also has no StaffID — so without an explicit exclusion every child's journal and
   * pick-up message would have poured into the admin's tray. */
  ok_('🔴 กล่องของแอดมินไม่หยิบแถวของครอบครัวมาแสดง',
    /String\(r\.StaffID \|\| ''\) === want && String\(r\.StudentID \|\| ''\) === ''/.test(notify));

  // ...and a family only ever sees its own children — resolved on the server, never from the request
  ok_('🔴 รายชื่อเด็กของครอบครัว resolve ที่ server ไม่รับจาก payload',
    /function inboxStudentsForParent_\(p\)[\s\S]{0,700}PARENTS[\s\S]{0,400}USER_LINKS/.test(notify));
  ok_('...และ markNotifsRead ของผู้ปกครองก็ใช้รายชื่อเดียวกัน',
    /var mine = inboxStudentsForParent_\(p\);[\s\S]{0,160}handleMarkInboxRead\(\{ studentIds: mine \}\)/.test(notify));

  // every family push writes the bell when the app channel is on
  ok_('notifyStudentParents_ เขียนกระดิ่งเมื่อเปิดช่องในแอป',
    /if \(ch\.app\)[\s\S]{0,200}inboxAddStudent_/.test(parent));
  ok_('...และจุดที่ส่งตรงหาผู้ปกครองใช้ familyBell_ ซึ่งคืนค่าว่าจะส่ง LINE ไหม',
    /function familyBell_\(topic, student, text, ref\)[\s\S]{0,400}return ch\.line;/.test(notify));
  {
    // ...at every one of them, so the bell cannot be forgotten at a site that only sends LINE
    const direct = ['src/Checkin.gs', 'src/Code.gs', 'src/Dspm.gs', 'src/Parent.gs', 'src/Journal.gs'];
    const missing = direct.filter(f => !/familyBell_\(/.test(R(f)));
    eq('🔴 ทุกไฟล์ที่ส่งตรงหาผู้ปกครอง เรียก familyBell_', missing, []);
    // Journal sends two ways (one child, and the bulk send) — both must ring the bell
    eq('...และ Journal.gs เรียกทั้งแบบส่งเดี่ยวและส่งหลายคน',
      (R('src/Journal.gs').match(/familyBell_\(/g) || []).length, 2);
  }
  // the StudentID column is DECLARED, or Phase 2.2's migration loses the family's notifications
  ok_('🔴 คอลัมน์ StudentID ประกาศไว้ในตัวสร้าง migration แล้ว',
    /ADMIN_INBOX'[\s\S]{0,160}'StudentID'/.test(R('tools/schema_inventory.js')));
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n5) ค่าเริ่มต้น: ปิดทุกหัวข้อ (ตามที่โรงเรียนเลือก 10/10)');
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  /* The school chose "ปิดทั้งหมด แล้วค่อยเปิดเอง" deliberately, and chose NOT to carry the old
   * values forward: they had been set against labels that misdescribed what they controlled, so
   * carrying them would have carried the misunderstanding. This pins that decision — if a default
   * ever flips to 'true', it is a product change somebody has to make on purpose. */
  const on = keys.filter(k => new RegExp("\\['" + k + "',\\s*'(?:true|app|line)").test(config));
  eq('🔴 ไม่มีหัวข้อไหนเปิดช่องทางไหนไว้เป็นค่าเริ่มต้น', on, []);
  const declared = keys.filter(k => new RegExp("\\['" + k + "',\\s*''\\]").test(config));
  eq('...และทุกหัวข้อประกาศค่าเริ่มต้นไว้ชัดเจนว่าไม่มีช่องทาง', declared.length, keys.length);

  // the three old keys are gone from the code that DECIDES — not merely unused
  const liveSrc = ['src/Line.gs', 'src/Parent.gs', 'src/Journal.gs', 'src/Checkin.gs', 'src/Dspm.gs',
    'src/Notify.gs', 'src/Staff.gs', 'src/Code.gs', 'src/Leave.gs', 'src/ClassOrg.gs', 'src/AttReq.gs']
    .map(f => decom(R(f))).join('\n');
  const old = ['AdminLineNotify', 'StaffLineNotify', 'ParentLineNotify'].filter(k => liveSrc.indexOf(k) >= 0);
  eq('🔴 ไม่มีโค้ดไหนอ่านสวิตช์รวมแบบเดิมอีกแล้ว', old, []);
  ok_('...และ parentLineOn_ ถูกลบจริง ไม่ได้แค่เปลี่ยนชื่อ',
    !/function parentLineOn_/.test(liveSrc));
}

console.log('\n6) 🔴 ติ๊กแล้วบันทึก แล้วเปิดใหม่ — ต้องเห็นสิ่งที่ติ๊กไว้');
{
  /* 🔴 THE INCIDENT, 2026-10-13: "ทดสอบติ๊กการแจ้งเตือน พอกดบันทึกแล้วระบบไม่บันทึก
   * เลยยังไม่มีการแจ้งเตือนใดๆเกิดขึ้นเลย".
   *
   * The save was never the problem. `_setOn` — written for yes/no switches and ending in
   * `String(v).toLowerCase()==='true'` — was handed to the channel dialog when the values became
   * 'app' / 'line' / 'app,line' on 10/10. So every stored value except the legacy 'true' read back
   * as FALSE, and every box drew empty.
   *
   * And then the second half, which is what actually destroyed the settings: an empty dialog saves
   * '' to all fifteen keys on purpose (a cleared topic must be written, or turning one off would do
   * nothing). So reopening the dialog and saving erased what the previous save had stored. The ผอ.
   * lost their settings by looking at them.
   *
   * Everything here was separately correct — the client collected the right keys, the route wrote
   * them, the server read them — so nothing failed, and no test asked the one question that spans
   * them: does a value survive being written and then displayed? */
  const app = R('webapp/app.js');
  const grab = (name) => {
    const i = app.indexOf('const ' + name + '=');
    return app.slice(i, app.indexOf('\n', i));
  };
  const ctx = {};
  // the real functions, lifted from the file rather than retyped
  eval(grab('_setOn') + '\nctx._setOn=_setOn;');
  eval(grab('_setRaw') + '\nctx._setRaw=_setRaw;');
  // ...and the real chOn out of _setNotifyHTML
  const chSrc = /const chOn = \(k, ch\) => \{([\s\S]*?)\};/.exec(app);
  ok_('อ่านตัวจริงจาก app.js ได้ทั้งสามตัว', !!ctx._setOn && !!ctx._setRaw && !!chSrc);
  const chOn = (rawOf) => new Function('rawOf', 'return (k, ch) => {' + chSrc[1] + '};')(rawOf);

  const sc = { NotifyParentCheckin: 'app,line', NotifyStaffApprovalQueue: 'app',
               NotifyStaffOrg: 'line', NotifyAdminApproval: 'true', NotifyParentBill: '' };
  const on = chOn(ctx._setRaw(sc, {}));
  eq('🔴 เก็บ "app,line" → ติ๊กทั้งสองช่อง', [on('NotifyParentCheckin','app'), on('NotifyParentCheckin','line')], [true, true]);
  eq('🔴 เก็บ "app" → ติ๊กเฉพาะแอป', [on('NotifyStaffApprovalQueue','app'), on('NotifyStaffApprovalQueue','line')], [true, false]);
  eq('🔴 เก็บ "line" → ติ๊กเฉพาะ LINE', [on('NotifyStaffOrg','app'), on('NotifyStaffOrg','line')], [false, true]);
  eq('ค่าเก่า "true" → ทั้งสองช่อง (ของเดิมก่อนมีช่องทาง)', [on('NotifyAdminApproval','app'), on('NotifyAdminApproval','line')], [true, true]);
  eq('ว่าง → ไม่ติ๊กเลย', [on('NotifyParentBill','app'), on('NotifyParentBill','line')], [false, false]);
  eq('ไม่มีค่าเลย → ไม่ติ๊ก', [on('NotifyParentDspm','app'), on('NotifyParentDspm','line')], [false, false]);

  /* 🔴 CONTROL — the actual defect, reproduced. Hand chOn the yes/no reader and the channel values
   * all vanish. This is here so the fix cannot be undone by "simplifying" the two readers back into
   * one, which is exactly how they came to be one. */
  const broken = chOn((k) => ctx._setOn(sc, {})(k, ''));
  eq('🔴 CONTROL: ถ้าใช้ตัวอ่านแบบ yes/no ค่าช่องทางจะหายหมด',
    [broken('NotifyParentCheckin','app'), broken('NotifyStaffApprovalQueue','app')], [false, false]);

  // and the dialog must be wired to the raw reader, not the boolean one
  ok_('🔴 กล่องติ๊กช่องทางอ่านค่าดิบ', /const chOn = \(k, ch\) => \{ const v = String\(rawOf\(k\)/.test(app));
  ok_('...และหน้าต่างส่งตัวอ่านค่าดิบเข้าไปจริง', /_setNotifyHTML\(_setOn\(sc,cfg\), _setRaw\(sc,cfg\)\)/.test(app));
  /* the two digest switches are yes/no and must KEEP the boolean reader — a single reader for both
   * is the mistake, in either direction */
  ok_('...แต่สวิตช์สรุปเช้า/เย็น ยังใช้ตัวอ่านแบบ yes/no', /cfgOn\('DigestMorning',true\)/.test(app));

  /* THE SECOND LOCK: a save that turns every topic off now has to be agreed to. The first lock is
   * the reader above; this one is what keeps a future reader bug from erasing the school's settings
   * silently rather than loudly. */
  ok_('🔴 บันทึกที่ปิดทุกหัวข้อ ต้องถามก่อน', /keys\.every\(k=>!chans\[k\]\.length\)/.test(app) && /confirm\(EN\(\)/.test(app));
  ok_('...และยังเขียน "" ให้หัวข้อที่ปิด (ไม่งั้นปิดไม่ติด)', /keys\.forEach\(k=>\{ gv\[k\]=chans\[k\]\.join\(','\); \}\)/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
