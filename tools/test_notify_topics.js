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
  ok_('notifyStudentTeacher_ ตัดสินด้วย lineTopicOn_(opts.topic)',
    /var lineOn = lineTopicOn_\(opts\.topic\)/.test(decom(R('src/Parent.gs'))));
  ok_('notifyStaffMember_ ตัดสินด้วย lineTopicOn_(topic)',
    /function notifyStaffMember_\(staffId, text, category, ref, topic\)/.test(R('src/Notify.gs')) &&
    /if \(!lineTopicOn_\(topic\)\) return false;/.test(R('src/Notify.gs')));

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
  const body = /function lineTopicOn_\(topic\) \{([\s\S]*?)\n\}/.exec(line);
  ok_('อ่านตัว lineTopicOn_ ออกมารันได้', !!body);
  const tbl = /var LINE_TOPIC_KEYS_ = \{[\s\S]*?\n\};/.exec(line)[0];

  // every key reads 'true' — so anything that comes back false came back false on purpose
  const mk = cfg => new Function('getConfig_', tbl + '\nreturn function lineTopicOn_(topic){' + body[1] + '\n};')(
    (k, d) => (cfg.hasOwnProperty(k) ? cfg[k] : d));
  const allOn = {}; keys.forEach(k => { allOn[k] = 'true'; });
  const on = mk(allOn), off = mk({});

  eq('🔴 หัวข้อที่ไม่มีในตาราง → ไม่ส่ง', on('parent.somethingNobodyDeclared'), false);
  eq('🔴 ไม่ใส่หัวข้อเลย (undefined) → ไม่ส่ง', on(undefined), false);
  eq('🔴 ส่งค่าว่าง → ไม่ส่ง', on(''), false);
  eq('CONTROL: หัวข้อจริงที่เปิดไว้ → ส่ง', on('parent.journalReply'), true);
  eq('CONTROL: หัวข้อจริงที่ยังไม่ได้ตั้งค่า → ไม่ส่ง (ค่าเริ่มต้นคือปิด)', off('parent.journalReply'), false);
  // the two the ผอ. reported, by name — these are the regression
  eq('🔴 ครูตอบกลับความคิดเห็น ปิดได้แล้ว', off('parent.journalReply'), false);
  eq('🔴 ครูแจ้งลาให้นักเรียน ปิดได้แล้ว', off('parent.leave'), false);

  // ────────────────────────────────────────────────────────────────────────────────────────────
  console.log('\n4) 🚨 เหตุฉุกเฉิน ปิดไม่ได้');
  // ────────────────────────────────────────────────────────────────────────────────────────────
  eq('🚨 ทุกสวิตช์ปิดหมด — อุบัติเหตุยังส่ง', off('emergency'), true);
  eq('🚨 ...และทุกสวิตช์เปิดหมด ก็ยังส่ง (ไม่ได้บังเอิญผ่านเพราะค่าอื่น)', on('emergency'), true);
  ok_('🚨 ไม่มีคีย์ตั้งค่าสำหรับเหตุฉุกเฉิน — ปิดไม่ได้เลยแม้แก้ชีตเอง',
    !Object.keys(topicTable).some(t => t === 'emergency') &&
    !keys.some(k => /emergency|urgent|injury/i.test(k)));
  ok_('🚨 การแจ้งผู้ปกครองเรื่องอุบัติเหตุ ใช้หัวข้อ emergency',
    /notifyStudentParents_\([\s\S]{0,400}?'emergency'\)/.test(R('src/Notify.gs')));
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n5) ค่าเริ่มต้น: ปิดทุกหัวข้อ (ตามที่โรงเรียนเลือก 10/10)');
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  /* The school chose "ปิดทั้งหมด แล้วค่อยเปิดเอง" deliberately, and chose NOT to carry the old
   * values forward: they had been set against labels that misdescribed what they controlled, so
   * carrying them would have carried the misunderstanding. This pins that decision — if a default
   * ever flips to 'true', it is a product change somebody has to make on purpose. */
  const on = keys.filter(k => new RegExp("\\['" + k + "',\\s*'true'\\]").test(config));
  eq('🔴 ไม่มีหัวข้อไหนเปิดไว้เป็นค่าเริ่มต้น', on, []);
  const declared = keys.filter(k => new RegExp("\\['" + k + "',\\s*'false'\\]").test(config));
  eq('...และทุกหัวข้อประกาศค่าเริ่มต้นไว้ชัดเจนว่า false', declared.length, keys.length);

  // the three old keys are gone from the code that DECIDES — not merely unused
  const liveSrc = ['src/Line.gs', 'src/Parent.gs', 'src/Journal.gs', 'src/Checkin.gs', 'src/Dspm.gs',
    'src/Notify.gs', 'src/Staff.gs', 'src/Code.gs', 'src/Leave.gs', 'src/ClassOrg.gs', 'src/AttReq.gs']
    .map(f => decom(R(f))).join('\n');
  const old = ['AdminLineNotify', 'StaffLineNotify', 'ParentLineNotify'].filter(k => liveSrc.indexOf(k) >= 0);
  eq('🔴 ไม่มีโค้ดไหนอ่านสวิตช์รวมแบบเดิมอีกแล้ว', old, []);
  ok_('...และ parentLineOn_ ถูกลบจริง ไม่ได้แค่เปลี่ยนชื่อ',
    !/function parentLineOn_/.test(liveSrc));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
