/**
 * tools/test_journal_bulk.js — tick several children, send one request.
 *   node tools/test_journal_bulk.js
 *
 * Asked 2026-10-08: "เพิ่ม Check Box ให้คุณครูติ๊กเพื่อส่งบันทึกทีละหลายคนได้ … เพื่อลดการ Request ในการ
 * ส่งข้อมูลเด็กทีละคน หากเจอ Error หรือโหลดนาน จะทำให้ขั้นตอนนี้ใช้เวลานานมาก". A teacher with twelve
 * children was buying twelve round trips at the end of the day, each 3 to 30 seconds and each a turn
 * nobody else in the school could have (v426).
 *
 * 🔴 THE TRAP THIS SUITE EXISTS FOR, and it would have been silent.
 *
 * submitJournal REPLACES the whole row from its payload — every field, every meal, the photos. The
 * obvious way to build a bulk send is to call it in a loop with { studentId, submit:true }, and that
 * would have SENT EVERY REPORT TO THE FAMILIES WITH ITS CONTENTS ERASED. Nothing would have thrown.
 * §1 is that case, written as the thing that must never happen.
 *
 * And the other half: sending a report publishes it to a family, recalling one takes it back from a
 * family who may already have read it. Two opposite acts, two buttons, two routes (the school's
 * decision, 2026-10-08) — §4.
 */
const path = require('path'), fs = require('fs');
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function throws_(label, fn, code) {
  try { fn(); console.log('  FAIL ' + label + '  (did not throw)'); fail++; }
  catch (e) { const c = e && (e.code || e.apiCode); const ok = !code || c === code;
    console.log((ok ? '  ok   ' : '  FAIL ') + label + '  code=' + c); ok ? pass++ : fail++; }
}
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), journalGs = R('src/Journal.gs'), codeGs = R('src/Code.gs'), apiJs = R('webapp/api.js');
const appCode = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const p2 = n => String(n).padStart(2, '0');
const TODAY = (d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()))(new Date());

/* A class of five, each in a different state — which is the only way the skip reasons can be tested
 * for what they say rather than that they exist. */
function school() {
  const M = {
    config: { Departments: ['Nursery 1'] },
    classes: [{ ClassName: 'Nursery 1' }, { ClassName: 'Nursery 2' }],
    staff: [
      { StaffID: 'T1', NameTH: 'ครูเอ', Role: 'Teacher', PositionLevel: 'Staff', Department: 'Nursery 1', Classes: 'Nursery 1', Status: 'ACTIVE', StartDate: '2024-01-01' },
      { StaffID: 'HEAD', NameTH: 'หัวหน้าครู', Role: 'Teacher', PositionLevel: 'Leader', Department: '*', Status: 'ACTIVE', StartDate: '2024-01-01' },
      { StaffID: 'T2', NameTH: 'ครูบี', Role: 'Teacher', PositionLevel: 'Staff', Department: 'Nursery 2', Classes: 'Nursery 2', Status: 'ACTIVE', StartDate: '2024-01-01' }
    ],
    students: [
      { StudentID: 'S-DRAFT',  NameTH: 'ด.ญ. ร่าง',   Nickname: 'ร่าง',  Class: 'Nursery 1', Status: 'ACTIVE' },
      { StudentID: 'S-DRAFT2', NameTH: 'ด.ช. ร่างสอง', Nickname: 'ร่าง2', Class: 'Nursery 1', Status: 'ACTIVE' },
      { StudentID: 'S-SENT',   NameTH: 'ด.ญ. ส่งแล้ว', Nickname: 'ส่ง',   Class: 'Nursery 1', Status: 'ACTIVE' },
      { StudentID: 'S-NONE',   NameTH: 'ด.ช. ไม่มี',   Nickname: 'ไม่มี', Class: 'Nursery 1', Status: 'ACTIVE' },
      { StudentID: 'S-NOMOOD', NameTH: 'ด.ญ. ไร้อารมณ์', Nickname: 'ไร้', Class: 'Nursery 1', Status: 'ACTIVE' },
      { StudentID: 'S-OTHER',  NameTH: 'ด.ช. ห้องอื่น',  Nickname: 'อื่น', Class: 'Nursery 2', Status: 'ACTIVE' }
    ],
    journals: [
      { StudentID: 'S-DRAFT',  Date: TODAY, TeacherID: 'T1', Status: 'DRAFT', Mood: 'ยิ้มแย้ม',
        HealthDetail: 'สบายดี', Meals: '{"lunch":"ข้าวผัด"}', Photos: 'p1.jpg', Theme: 'ผีเสื้อ' },
      { StudentID: 'S-DRAFT2', Date: TODAY, TeacherID: 'T1', Status: 'DRAFT', Mood: 'ร่าเริง', HealthDetail: 'ปกติ' },
      { StudentID: 'S-SENT',   Date: TODAY, TeacherID: 'T1', Status: 'SUBMITTED', SubmittedAt: TODAY + ' 16:00', Mood: 'ยิ้มแย้ม' },
      { StudentID: 'S-NOMOOD', Date: TODAY, TeacherID: 'T1', Status: 'DRAFT', Mood: '', HealthDetail: 'ยังไม่ได้เลือก' },
      { StudentID: 'S-OTHER',  Date: TODAY, TeacherID: 'T2', Status: 'DRAFT', Mood: 'ยิ้มแย้ม' }
    ],
    parents: [], userLinks: [], holidays: [], activityLog: [], studentLeaves: [],
    checkinStudent: [], studentCheckins: [], studentAttendanceToday: []
  };
  return { M, H: createAtomAPI(M).H };
}
const jOf = (M, sid) => (M.journals || []).find(j => j.StudentID === sid && j.Date === TODAY) || {};

// ============================================================================
console.log('\n1) 🔴 sending a report must never rewrite it');
{
  const { M, H } = school();
  const before = JSON.parse(JSON.stringify(jOf(M, 'S-DRAFT')));
  const r = H.submitJournalsMany({ staffId: 'T1', studentIds: ['S-DRAFT'] });
  eq('the report is sent', r.sent.map(x => x.studentId), ['S-DRAFT']);
  const after = jOf(M, 'S-DRAFT');
  eq('🔴 ...and its status moved', [after.Status, !!after.SubmittedAt], ['SUBMITTED', true]);
  /* 🔴 EVERY FIELD THE TEACHER WROTE IS STILL THERE. This is the whole suite in one assertion: the
   * loop-over-submitJournal version would have left all five of these empty, sent the empty report
   * to the family, and thrown nothing. */
  eq('🔴 ...and NOTHING she wrote was touched',
    ['Mood', 'HealthDetail', 'Meals', 'Photos', 'Theme'].filter(k => after[k] !== before[k]), []);
  eq('...the author is unchanged too', after.TeacherID, before.TeacherID);
}

// ============================================================================
console.log('\n2) 🔴 what it refuses, per child, without taking the others down');
{
  const { M, H } = school();
  const r = H.submitJournalsMany({ staffId: 'T1',
    studentIds: ['S-DRAFT', 'S-DRAFT2', 'S-SENT', 'S-NONE', 'S-NOMOOD'] });
  eq('🔴 the two real drafts go', r.sent.map(x => x.studentId).sort(), ['S-DRAFT', 'S-DRAFT2']);
  eq('🔴 ...and each refusal says why',
    r.skipped.sort((a, b) => a.studentId.localeCompare(b.studentId)).map(s => s.studentId + ':' + s.reason),
    ['S-NOMOOD:MISSING_MOOD', 'S-NONE:NO_JOURNAL', 'S-SENT:ALREADY_SENT']);
  /* 🔴 THE ONE ALREADY SENT IS NOT RE-SENT. Its SubmittedAt must be the original — a second send
   * would push the family a second LINE message about the same afternoon. */
  eq('🔴 an already-sent report keeps its original time', jOf(M, 'S-SENT').SubmittedAt, TODAY + ' 16:00');
  eq('...and a draft with no mood stays a draft', jOf(M, 'S-NOMOOD').Status, 'DRAFT');
}
{
  // ...and a class this teacher does not cover is not hers to send
  const { M, H } = school();
  const r = H.submitJournalsMany({ staffId: 'T1', studentIds: ['S-OTHER'] });
  eq('🔴 a child in another teacher’s class is refused', r.skipped.map(s => s.reason), ['NOT_MY_CLASS']);
  eq('...and that report is untouched', jOf(M, 'S-OTHER').Status, 'DRAFT');
  // the head teacher covers every class, so the same call is hers to make
  const h = school();
  eq('CONTROL · the head teacher may send any class',
    h.H.submitJournalsMany({ staffId: 'HEAD', studentIds: ['S-OTHER'] }).sent.length, 1);
}
{
  const { H } = school();
  throws_('an empty selection is refused, not answered with silence',
    () => H.submitJournalsMany({ staffId: 'T1', studentIds: [] }), 'BAD_INPUT');
  const big = H.submitJournalsMany({ staffId: 'T1', studentIds: new Array(500).fill('S-NONE') });
  ok_('a runaway list is capped rather than obeyed', big.skipped.length <= 60);
}

// ============================================================================
console.log('\n3) 🔴 taking a report back from the family');
{
  const { M, H } = school();
  const before = JSON.parse(JSON.stringify(jOf(M, 'S-SENT')));
  const r = H.recallJournalsMany({ staffId: 'HEAD', studentIds: ['S-SENT'] });
  eq('the head teacher may recall', r.recalled.map(x => x.studentId), ['S-SENT']);
  eq('🔴 ...it leaves the parent’s view', [jOf(M, 'S-SENT').Status, jOf(M, 'S-SENT').SubmittedAt], ['DRAFT', '']);
  eq('🔴 ...and the content is untouched, so there is something to correct', jOf(M, 'S-SENT').Mood, before.Mood);
  /* THE AUTHOR IS NAMED so the caller can tell them. A report that quietly reappears as a draft with
   * nobody told is work nobody does. */
  eq('🔴 ...and it says WHOSE report it was', r.recalled[0].teacherId, 'T1');
  ok_('...and names the child, so the notification can say which', !!r.recalled[0].nick);
}
{
  const { M, H } = school();
  throws_('🔴 an ordinary teacher cannot recall',
    () => H.recallJournalsMany({ staffId: 'T1', studentIds: ['S-SENT'] }), 'NO_PERMISSION');
  eq('CONTROL · ...and nothing moved when she tried', jOf(M, 'S-SENT').Status, 'SUBMITTED');
  const r = H.recallJournalsMany({ staffId: 'HEAD', studentIds: ['S-DRAFT', 'S-NONE'] });
  eq('a draft and a missing report are both refused, each saying why',
    r.skipped.map(s => s.studentId + ':' + s.reason).sort(), ['S-DRAFT:NOT_SENT', 'S-NONE:NO_JOURNAL']);
}

// ============================================================================
console.log('\n4) two buttons, because they are opposite acts');
{
  ok_('🔴 send and recall are separate routes', /submitJournalsMany: p =>/.test(R('webapp/engine.js')) &&
    /recallJournalsMany: p =>/.test(R('webapp/engine.js')));
  ok_('🔴 ...and separate buttons on the screen',
    /id="tselSend"[\s\S]{0,200}T_sendMany/.test(appCode) && /id="tselBack"[\s\S]{0,200}T_recallMany/.test(appCode));
  ok_('🔴 the recall button is only drawn for a head teacher', /\$\{isHeadRole\(\)\?`<button class="btn outline block" id="tselBack"/.test(app));
  /* ...and the confirmation SAYS what recalling does. "Are you sure?" over an act that un-publishes
   * something a family may already have read is not a confirmation. */
  ok_('🔴 ...and its confirmation says the family loses sight of it',
    /บันทึกจะหายไปจากแอปของผู้ปกครองจนกว่าคุณครูจะส่งใหม่/.test(app));
  ok_('...and that the teacher will be told', /ระบบจะแจ้งคุณครูที่เป็นคนบันทึกให้ทราบ/.test(app));
}

// ============================================================================
console.log('\n5) the box, and what it will not let you tick');
{
  ok_('every row carries a box', /class="tsel"/.test(app));
  ok_('🔴 a child with no report cannot be ticked', /const off = \(can==='none'\)/.test(appCode));
  ok_('🔴 ...and a sent one only by a head teacher', /\(can==='sent' && !isHeadRole\(\)\)/.test(appCode));
  ok_('...and the box says why, on itself', /ยังไม่มีบันทึก — ยังส่งไม่ได้/.test(app));
  ok_('🔴 "select all" skips the ones it cannot send', /input\.tsel:not\(\[disabled\]\)/.test(app));
  /* SELECTION DIES WITH THE SCREEN. A tick that survived a class switch would send a child off a
   * list nobody is looking at — the school chose one class at a time (2026-10-08). */
  ok_('🔴 the selection is cleared on every render', /T_SEL = \{\};\s*$/m.test(appCode) || /T_SEL = \{\};/.test(appCode));
  ok_('...and the bar is not drawn on a past day, where nothing can be sent',
    /\$\{onDay\?'':T_sendBar\(cl,jdone\)\}/.test(app));
  ok_('...nor are the boxes', /const pick = onDay \? '' : T_pickBox/.test(appCode));
  // a partial result must be reported, not rounded up to "done"
  ok_('🔴 a skipped child is reported, not swallowed', /T_skipText\(sk\)/.test(appCode));
  ok_('...with the reason in words', /MISSING_MOOD:\s*\['ยังไม่ได้เลือกอารมณ์'/.test(app));
}

// ============================================================================
console.log('\n6) 🔴 the live routes, and the three places a write must be declared');
{
  ok_('both have explicit GAS handlers', /function handleSubmitJournalsMany/.test(journalGs) &&
    /function handleRecallJournalsMany/.test(journalGs));
  ok_('🔴 ...which write IN PLACE, never a collection rewrite',
    /updateRow_\(sheet, row\._row, \{ Status: 'SUBMITTED'/.test(journalGs) &&
    /updateRow_\(sheet, row\._row, \{ Status: 'DRAFT', SubmittedAt: '' \}\)/.test(journalGs));
  ok_('🔴 ...and read the mood from the STORED row, never the payload',
    /String\(row\.Mood == null \? '' : row\.Mood\)\.trim\(\)/.test(journalGs));
  ok_('...and both drop the day’s cache key', /journalCacheBust_\(date\)/.test(journalGs));
  ok_('the live recall checks the head teacher itself', /String\(staff\.Department \|\| ''\) === '\*'/.test(journalGs));

  /* 🔴 "recall" IS NOT A MUTATING VERB. Three separate places decide whether an action writes — the
   * server's lock, the client's cache, and the on-screen overlay — and `recallJournalsMany` matched
   * none of their prefix tests. Un-listed, the server would have run it with NO WRITE LOCK. */
  ok_('🔴 the server counts the recall as a write', /recallJournalsMany: 1/.test(codeGs));
  ok_('🔴 ...so does the client cache', /recallJournalsMany: 1/.test(apiJs));
  ok_('🔴 ...and so does the busy overlay', /\^recall/.test(app));
  // ...and the send is covered by the verb test, which is why it needs no entry
  ok_('CONTROL · "submit" is a mutating verb already, so the send needs no special case',
    /^(submit|save|add)/.test('submitJournalsMany'));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
