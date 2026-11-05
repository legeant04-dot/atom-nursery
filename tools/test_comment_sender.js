/**
 * tools/test_comment_sender.js — the chat keeps who sent each message, and the phone cannot choose it
 *   node tools/test_comment_sender.js
 *
 * ผอ., 2026-11-05: เก็บชื่อผู้ส่ง — "เซิร์ฟเวอร์ใส่ชื่อเอง".
 *
 * Found by tools/test_fast_host_writes_live.js: COMMENTS had no SenderName column, so GasEngine's
 * writeRows_ dropped the name the app sent, every time, and the bubble fell back to the role. The
 * name the app sent was USER.nameEN (blank for most families) and, being from the phone, could be
 * edited to read like a teacher's.
 *
 *   1  the live sheet GAINS the column on the next write (ensureCollectionSheet_), at the END, with
 *      every existing column where it was — and the name is stored
 *   2  a signed-in parent is named from THEIR parent record — a forged senderName / senderRole is ignored
 *   3  a teacher is named from their staff record
 *   4  an unstamped payload (Admin, the in-browser demo) keeps what was sent
 * 2–4 run Code.gs's own applyIdentity_ (server/gate.js) before the handler, which is the live path.
 */
'use strict';
const path = require('path');
let pass = 0, fail = 0;
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  console.log((okk ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (okk ? '' : ' want=' + JSON.stringify(want)));
  okk ? pass++ : fail++;
}

console.log('\n1) ชีตจริงได้คอลัมน์ SenderName ต่อท้าย และเก็บชื่อได้');
{
  const H = require('./gas_test_harness.js');
  // Checkin.gs holds ensureColumns_ — without it the top-up fails INSIDE a try and nothing says so
  const { run } = H(['Config', 'Db', 'Checkin', 'GasEngine']);
  const r = JSON.parse(run(function () {
    var ss = SpreadsheetApp.create('MAIN');
    PropertiesService.getScriptProperties().setProperty('WB_MAIN_ID', ss.getId());
    /* the sheet exactly as the school has it today — no SenderName */
    var sh = ss.insertSheet('COMMENTS');
    sh.getRange(1, 1, 1, 7).setValues([['CommentID', 'StudentID', 'ParentID', 'SenderRole', 'Message', 'Timestamp', 'ReadStatus']]);
    sh.getRange(2, 1, 1, 7).setValues([['CM-1', 'STD-1', 'PAR-1', 'Parent', 'เก่า', '2026-10-01 08:00', 'read']]);
    writeCollection_('comments', [
      { CommentID: 'CM-1', StudentID: 'STD-1', ParentID: 'PAR-1', SenderRole: 'Parent', Message: 'เก่า', Timestamp: '2026-10-01 08:00', ReadStatus: 'read' },
      { CommentID: 'CM-2', StudentID: 'STD-1', ParentID: 'PAR-1', SenderRole: 'Parent', SenderName: 'นางสาวทดสอบ ใจดี', Message: 'ใหม่', Timestamp: '2026-11-05 09:00', ReadStatus: 'unread' }]);
    var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
    return JSON.stringify({ hdr: v[0], row1: v[1], row2: v[2] });
  }));
  eq('หัวตาราง: คอลัมน์เดิมอยู่ที่เดิม + SenderName ต่อท้าย', r.hdr,
    ['CommentID', 'StudentID', 'ParentID', 'SenderRole', 'Message', 'Timestamp', 'ReadStatus', 'SenderName']);
  eq('แถวเดิมไม่ขยับ (ชื่อว่าง)', [r.row1[0], r.row1[4], r.row1[7]], ['CM-1', 'เก่า', '']);
  eq('แถวใหม่เก็บชื่อผู้ส่ง', [r.row2[0], r.row2[7]], ['CM-2', 'นางสาวทดสอบ ใจดี']);
}

const GATE = require(path.join(__dirname, '..', 'server', 'gate.js'));
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));
function fresh() {
  return {
    config: {}, comments: [],
    staff: [{ StaffID: 'STF-T', NameTH: 'ครูทดสอบ ใจเย็น', Nickname: 'ครูที', Role: 'Teacher', Status: 'ACTIVE', StartDate: '2025-01-01' }],
    students: [{ StudentID: 'STD-1', NameTH: 'เด็กทดสอบ', ParentID: 'PAR-1', Status: 'ACTIVE' }],
    parents: [{ ParentID: 'PAR-1', NameTH: 'นางสาวทดสอบ ใจดี', NameEN: 'Ms. Test', StudentID: 'STD-1', LineUID: 'U-P' },
              { ParentID: 'PAR-2', NameTH: '', NameEN: 'Mr. English Only', StudentID: 'STD-1', LineUID: 'U-Q' }],
    userLinks: [{ UserUID: 'U-P', StudentID: 'STD-1' }, { UserUID: 'U-Q', StudentID: 'STD-1' }], studentTerms: []
  };
}
/** the live path: Code.gs's applyIdentity_ against a verified session, then the engine */
function send(M, sess, payload) {
  const p = GATE.identity('addComment', payload, sess, M);
  return createAtomAPI(M, null).H.addComment(p);
}

console.log('\n2) 🔴 ผู้ปกครองที่ล็อกอิน — ชื่อจากทะเบียนของตัวเอง ปลอมไม่ได้');
{
  const M = fresh();
  const c = send(M, { uid: 'U-P', role: 'Parent', linkedId: 'PAR-1' },
    { studentId: 'STD-1', message: 'สวัสดีค่ะ', senderRole: 'Teacher', senderName: 'ครูเอ' });
  eq('ชื่อ = ชื่อในทะเบียนผู้ปกครอง ไม่ใช่ "ครูเอ" ที่ส่งมา', c.SenderName, 'นางสาวทดสอบ ใจดี');
  eq('🔴 บทบาท = Parent แม้จะส่ง senderRole:"Teacher" มา', c.SenderRole, 'Parent');
  eq('ParentID มาจาก session', c.ParentID, 'PAR-1');
  const d = send(M, { uid: 'U-Q', role: 'Parent', linkedId: 'PAR-2' }, { studentId: 'STD-1', message: 'hi', senderRole: 'Parent', senderName: '' });
  eq('ไม่มีชื่อไทย → ใช้ชื่ออังกฤษในทะเบียน', d.SenderName, 'Mr. English Only');
}

console.log('\n3) ครู — ชื่อจากทะเบียนพนักงาน');
{
  const M = fresh();
  const c = send(M, { uid: 'U-T', role: 'Teacher', linkedId: 'STF-T' }, { studentId: 'STD-1', message: 'รับทราบค่ะ', senderRole: 'Teacher', senderName: 'ผอ.' });
  eq('ชื่อ = ชื่อครูในทะเบียน ไม่ใช่ "ผอ." ที่ส่งมา', c.SenderName, 'ครูทดสอบ ใจเย็น');
  eq('บทบาทตามที่ส่ง (Teacher)', c.SenderRole, 'Teacher');
}

console.log('\n4) payload ที่ไม่มีใครประทับตัวตน (แอดมิน · โหมดสาธิตในเบราว์เซอร์) — ใช้ตามที่ส่ง');
{
  const M = fresh();
  const a = send(M, { uid: 'U-A', role: 'Admin', linkedId: 'STF-A' }, { studentId: 'STD-1', message: 'แจ้งจากสำนักงาน', senderRole: 'Teacher', senderName: 'สำนักงาน' });
  eq('แอดมิน: ชื่อตามที่ส่ง', [a.SenderName, a.SenderRole], ['สำนักงาน', 'Teacher']);
  const demo = createAtomAPI(fresh(), null).H.addComment({ studentId: 'STD-1', parentId: 'PAR-1', senderRole: 'Parent', senderName: 'Ms.Karn', message: 'x' });
  eq('โหมดสาธิต (ไม่ผ่าน applyIdentity_): ชื่อตามที่ส่ง', demo.SenderName, 'Ms.Karn');
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
