/**
 * tools/test_fast_route_writes.js — a WRITE route on the fast host leaves the data exactly as Apps Script does
 *   node tools/test_fast_route_writes.js          (offline — the GAS harness on one side, server/routes.js on the other)
 *
 * W0 + W1 of docs/FAST_HOST_WRITES_PLAN.md (2026-11-07). server/routes.js now records three kinds of write
 * — change a row, add a row, delete a row — and the host saves them in one transaction. A reply that
 * matches proves nothing about a write; the STATE after it is the thing. So:
 *
 *   one Apps Script (harness) and one host "database" start from the SAME rows, then the SAME twenty steps
 *   run on both, in order, and after EVERY step every row of every sheet below is compared — the audit
 *   logs of both workbooks included (MAIN → AUDIT_LOG, HR → HR_AUDIT_LOG: one name, two tables).
 *
 * And the rules that make it safe:
 *   🔴 a write the route did not declare (a sheet, a column, an add, a delete) fails the call — nothing recorded
 *   🔴 an image is refused (Drive belongs to Apps Script) — the app sends that one to Apps Script
 *   🔴 a refused call leaves nothing behind, even what it wrote before it was refused
 */
'use strict';
const path = require('path');
let pass = 0, fail = 0;
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  console.log((okk ? '  ok   ' : '  FAIL ') + label + (okk ? '' : '\n         got=' + JSON.stringify(got).slice(0, 500) + '\n        want=' + JSON.stringify(want).slice(0, 500)));
  okk ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const ROUTES = require(path.join(__dirname, '..', 'server', 'routes.js'));
delete process.env.ATOM_DB;
const FILES = ['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Checkin', 'Triggers', 'Leave', 'Notify', 'Parent', 'Staff',
  'GasEngine', 'Engine', 'Payroll', 'Day6', 'OtStaff', 'OT', 'Certificate', 'Dspm', 'DspmAdmin', 'Journal', 'Announce'];
const G = require('./gas_test_harness.js')(FILES);

/* where each sheet lives on Apps Script, and its name on the host */
const SHEETS = [
  ['MAIN', 'SCHOOL_CONFIG'], ['MAIN', 'DSPM_CRITERIA'], ['HR', 'LEAVE_REQUEST'], ['MAIN', 'LEAVE_REQUEST_STD'],
  ['MAIN', 'DAILY_JOURNAL'], ['MAIN', 'STUDENTS'], ['MAIN', 'ANNOUNCEMENTS'], ['MAIN', 'AUDIT_LOG'], ['HR', 'AUDIT_LOG']];
const hostName = (wb, s) => (wb === 'HR' && s === 'AUDIT_LOG') ? 'HR_AUDIT_LOG' : s;

const FIX = {
  SCHOOL_CONFIG: [['Departments', 'N1,N2'], ['LeaveQuota', '{"ลาป่วย":30}'], ['CertTitleTH', 'เกียรติบัตรเดิม']],
  DSPM_CRITERIA: [
    { ItemNo: 1, AgeFrom: 0, AgeTo: 6, AgeLabelTH: '0-6 เดือน', Skill: 'GM', Description: 'ยกศีรษะ', Track: 'Teacher' },
    { ItemNo: 2, AgeFrom: 0, AgeTo: 6, AgeLabelTH: '0-6 เดือน', Skill: 'FM', Description: 'มองตาม', Track: 'Teacher' },
    { ItemNo: 1, AgeFrom: 0, AgeTo: 6, AgeLabelTH: '0-6 เดือน', Skill: 'GM', Description: 'ฉบับผู้ปกครอง', Track: 'Parent' }],
  LEAVE_REQUEST: [
    { LeaveID: 'LV-1', StaffID: 'STF-T', Type: 'ลาป่วย', StartDate: '2026-11-17', EndDate: '2026-11-17', Days: 1, Reason: 'ไข้', Status: 'APPROVED', HalfDay: '' },
    { LeaveID: 'LV-2', StaffID: 'STF-T', Type: 'ลากิจ', StartDate: '2026-11-20', EndDate: '2026-11-21', Days: 2, Reason: 'ธุระ', Status: 'PENDING_ADMIN', HalfDay: '' },
    { LeaveID: 'LV-3', StaffID: 'STF-U', Type: 'ลากิจ', StartDate: '2026-11-17', EndDate: '2026-11-17', Days: 1, Reason: 'x', Status: 'APPROVED', HalfDay: '' }],
  LEAVE_REQUEST_STD: [{ LeaveID: 'LVS-1', StudentID: 'STD-1', Date: '2026-11-10', Reason: 'ป่วย', Type: 'sick', Status: 'Notified' }],
  STUDENTS: [{ StudentID: 'STD-1', Name: 'เด็กหนึ่ง', Nickname: 'หนึ่ง', Class: 'N1', Status: 'ACTIVE' }],
  DAILY_JOURNAL: [{ Date: '2026-11-05', StudentID: 'STD-1', TeacherID: 'STF-T', Mood: 'ยิ้ม', Theme: 'ผีเสื้อ', Status: 'SUBMITTED', SubmittedAt: '2026-11-05 16:00' }],
  ANNOUNCEMENTS: [{ AnnID: 'ANN1', Title: 'ประกาศเดิม', Content: 'เนื้อหา', Date: '2026-11-01', Type: 'news', TargetGroup: 'all', Popup: false, Priority: 0 }]
};

G.g.__FIX = JSON.stringify(FIX); G.g.__SHEETS = JSON.stringify(SHEETS);
G.run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var F = JSON.parse(__FIX), main = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
  var cfg = sheet_(main, 'SCHOOL_CONFIG');
  if (cfg.getLastRow() > 1) cfg.deleteRows(2, cfg.getLastRow() - 1);           // only the keys this suite names
  F.SCHOOL_CONFIG.forEach(function (kv) { appendObject_(cfg, { Key: kv[0], Value: kv[1] }); });
  JSON.parse(__SHEETS).forEach(function (x) {
    var sh = sheet_(x[0] === 'HR' ? hr : main, x[1]);
    if (x[1] !== 'SCHOOL_CONFIG' && sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    (x[1] === 'SCHOOL_CONFIG' ? [] : (F[x[1]] || [])).forEach(function (r) { appendObject_(sh, r); });
  });
  _configCache = null;
  return '';
});

/* what Apps Script holds now — normalised the way Postgres would hand it back (Dates → ISO) */
const gasState = () => JSON.parse(G.run(function () {
  var out = {}, main = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
  JSON.parse(__SHEETS).forEach(function (x) {
    out[(x[0] === 'HR' && x[1] === 'AUDIT_LOG') ? 'HR_AUDIT_LOG' : x[1]] = readObjects_(sheet_(x[0] === 'HR' ? hr : main, x[1]))
      .map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; return o; });
  });
  return JSON.stringify(out);
}));

/* the host's "database": the same rows, each with an id, changed ONLY by the ops a route records */
let nextId = 1;
const db = {};
{ const s = gasState(); Object.keys(s).forEach(k => { db[k] = s[k].map(r => Object.assign({ __id: 'r' + (nextId++) }, r)); }); }
const applyOps = ops => ops.forEach(o => {
  const t = db[o.sheet] || (db[o.sheet] = []);
  if (o.op === 'insert') { const id = 'r' + (nextId++); t.push(Object.assign({ __id: id }, JSON.parse(JSON.stringify(o.row)))); o.__real = id; return; }
  const id = String(o.id).indexOf('new:') === 0 ? ops.find(x => x.tmp === o.id).__real : o.id;
  const i = t.findIndex(r => r.__id === id); if (i < 0) throw new Error('op on a missing row ' + o.sheet + ' ' + id);
  if (o.op === 'update') Object.assign(t[i], JSON.parse(JSON.stringify(o.patch))); else t.splice(i, 1);
});
const host = (action, payload) => {
  const raw = {}; ROUTES.needs([action]).forEach(s => { raw[s] = JSON.parse(JSON.stringify(db[s] || [])); });
  const sink = [];
  try { const data = ROUTES.run(action, payload, raw, {}, {}, sink); applyOps(sink); return { ok: true, data, ops: sink.length }; }
  catch (e) { return { ok: false, code: e.apiCode || e.message, msg: e.message, ops: 0 }; }
};
const gas = (fn, payload) => { G.g.__P = JSON.stringify(payload); G.g.__F = fn; return JSON.parse(G.run(function () {
  _configCache = null;
  try { return JSON.stringify({ ok: true, data: this[__F](JSON.parse(__P)) }); }
  catch (e) { return JSON.stringify({ ok: false, code: e.apiCode || e.message }); } })); };

/* compare: every sheet, every row, every column — an audit row's Timestamp only as "a time, just now" */
const strip = rows => rows.map(r => { const o = Object.assign({}, r); delete o.__id; return o; });
const comparable = (name, rows) => strip(rows).map(r => {
  if (/AUDIT_LOG$/.test(name)) { const t = Date.parse(r.Timestamp); r.Timestamp = (isFinite(t) && Math.abs(Date.now() - t) < 120000) ? 'now' : r.Timestamp; }
  return r;
});
const sameState = label => {
  const s = gasState(); const diff = [];
  Object.keys(s).forEach(k => { if (JSON.stringify(comparable(k, s[k])) !== JSON.stringify(comparable(k, db[k] || []))) diff.push(k); });
  ok_(label + ' — ทุกชีตเท่ากันทุกแถว' + (diff.length ? '  ต่างที่: ' + diff.join(', ') : ''), !diff.length);
  if (diff.length) diff.forEach(k => console.log('         ' + k + '\n           gas=' + JSON.stringify(comparable(k, s[k])).slice(0, 400) + '\n          host=' + JSON.stringify(comparable(k, db[k] || [])).slice(0, 400)));
};

console.log('\n1) ยี่สิบขั้นเดียวกัน ทั้งสองฝั่ง — เทียบสถานะทั้งหมดหลังทุกขั้น');
const STEPS = [
  ['addDepartment', 'handleAddDepartment', { name: 'N3' }, 'เพิ่มแผนก'],
  ['addDepartment', 'handleAddDepartment', { name: 'N3' }, 'เพิ่มแผนกซ้ำ → DUP'],
  ['renameDepartment', 'handleRenameDepartment', { old: 'N1', new: 'Nursery 1' }, 'เปลี่ยนชื่อแผนก'],
  ['removeDepartment', 'handleRemoveDepartment', { name: 'N2' }, 'ลบแผนก'],
  ['setLeaveQuota', 'handleSetLeaveQuota', { type: 'ลาพักร้อน', days: 6, adminId: 'STF-A' }, 'โควตาวันลา (เพิ่มประเภท + บันทึกตรวจสอบ)'],
  ['saveCertText', 'handleSaveCertText', { CertTitleTH: 'เกียรติบัตรใหม่', CertLine1TH: 'ขอมอบให้', adminId: 'STF-A' }, 'ข้อความใบประกาศ (แก้ 1 คีย์ · เพิ่ม 1 คีย์)'],
  ['saveDocInfo', 'handleSaveDocInfo', { DocSchoolName: ' Atom Nursery ', DocPhone: '02-000-0000', adminId: 'STF-A' }, 'ข้อมูลบนใบเสร็จ (เพิ่มคีย์ใหม่)'],
  ['saveDspmCriteria', 'handleSaveDspmCriteria', { itemNo: 2, track: 'Teacher', data: { Description: 'มองตามของเล่น', AgeTo: '7' } }, 'แก้เกณฑ์ DSPM'],
  ['saveDspmCriteria', 'handleSaveDspmCriteria', { data: { AgeFrom: 7, AgeTo: 9, AgeLabelTH: '7-9 เดือน', Skill: 'GM', Description: 'นั่งเอง', Track: 'Teacher' } }, 'เพิ่มเกณฑ์ DSPM (เลขถัดไป)'],
  ['deleteDspmCriteria', 'handleDeleteDspmCriteria', { itemNo: 1, track: 'Parent' }, 'ลบเกณฑ์ DSPM (เฉพาะสาย Parent)'],
  ['deleteDspmCriteria', 'handleDeleteDspmCriteria', { itemNo: 99, track: 'Teacher' }, 'ลบเกณฑ์ที่ไม่มี → NOT_FOUND'],
  ['editLeave', 'handleEditLeave', { leaveId: 'LV-2', startDate: '2026-11-24', endDate: '2026-11-25', reason: 'ย้ายวัน', staffId: 'STF-A' }, 'แอดมินแก้วันลา (+ บันทึกตรวจสอบ HR)'],
  ['editLeave', 'handleEditLeave', { leaveId: 'LV-2', startDate: '2026-11-17', endDate: '2026-11-17', staffId: 'STF-A' }, '🔴 แก้ไปทับใบเดิม → LEAVE_OVERLAP ไม่มีอะไรเปลี่ยน'],
  ['editLeave', 'handleEditLeave', { leaveId: 'LV-1', halfDay: 'PM', staffId: 'STF-A' }, 'เปลี่ยนเป็นครึ่งวันบ่าย'],
  ['cancelLeave', 'handleCancelLeave', { leaveId: 'LV-3', staffId: 'STF-A' }, 'แอดมินยกเลิกใบลา (ลบแถว)'],
  ['editStudentLeave', 'handleEditStudentLeave', { leaveId: 'LVS-1', date: '2026-11-11', reason: 'ไปหาหมอ' }, 'แก้ใบลาของเด็ก'],
  ['unlockJournal', 'handleUnlockJournal', { studentId: 'STD-1', date: '2026-11-05', staffId: 'STF-A' }, 'ดึงบันทึกที่ส่งแล้วกลับเป็นร่าง'],
  ['addAnnouncement', 'handleAddAnnouncement', { title: 'ปิดเทอม', content: 'หยุด 1-5 ธ.ค.', popup: true, startDate: '2026-11-07', priority: 2 }, 'เพิ่มประกาศ (รหัสถัดไป)'],
  ['editAnnouncement', 'handleEditAnnouncement', { annId: 'ANN1', title: 'ประกาศแก้แล้ว', popup: true }, 'แก้ประกาศ'],
  ['deleteAnnouncement', 'handleDeleteAnnouncement', { annId: 'ANN1' }, 'ลบประกาศ']
];
const got = {};
for (const [a, fn, p, label] of STEPS) {
  const w = gas(fn, p), h = host(a, p);
  got[label] = { gas: w, host: h };
  const sameReply = JSON.stringify(w.ok ? { ok: true, data: w.data } : { ok: false, code: w.code }) === JSON.stringify(h.ok ? { ok: true, data: h.data } : { ok: false, code: h.code });
  ok_(a + ' · ' + label + ' — คำตอบเท่ากัน' + (sameReply ? '' : '\n         gas=' + JSON.stringify(w).slice(0, 300) + '\n        host=' + JSON.stringify(h).slice(0, 300)), sameReply);
  sameState(a + ' · ' + label);
}

console.log('\n2) ข้อเท็จจริง — ว่าการเทียบข้างบนเทียบของจริง ไม่ใช่ว่างกับว่าง');
const cfg = Object.fromEntries((db.SCHOOL_CONFIG || []).map(r => [r.Key, r.Value]));
eq('แผนกหลังสี่ขั้น', cfg.Departments, 'Nursery 1,N3');
eq('โควตาวันลา', JSON.parse(cfg.LeaveQuota), { 'ลาป่วย': 30, 'ลาพักร้อน': 6 });
eq('ใบประกาศ: แก้คีย์เดิม + เพิ่มคีย์ใหม่ · ข้อมูลใบเสร็จตัดช่องว่าง', [cfg.CertTitleTH, cfg.CertLine1TH, cfg.DocSchoolName], ['เกียรติบัตรใหม่', 'ขอมอบให้', 'Atom Nursery']);
eq('เกณฑ์ DSPM: แก้ข้อ 2 · เพิ่มข้อ 3 · ลบสาย Parent', db.DSPM_CRITERIA.map(r => r.Track + r.ItemNo + ':' + r.Description), ['Teacher1:ยกศีรษะ', 'Teacher2:มองตามของเล่น', 'Teacher3:นั่งเอง']);
eq('ใบลา: LV-2 ย้ายวัน · LV-1 ครึ่งวัน · LV-3 ถูกยกเลิก', db.LEAVE_REQUEST.map(r => r.LeaveID + ':' + String(r.StartDate).slice(0, 10) + ':' + r.Days), ['LV-1:2026-11-17:0.5', 'LV-2:2026-11-24:2']);
eq('🔴 การแก้ที่ทับใบเดิม ถูกปฏิเสธทั้งสองฝั่ง', [got['🔴 แก้ไปทับใบเดิม → LEAVE_OVERLAP ไม่มีอะไรเปลี่ยน'].gas.code, got['🔴 แก้ไปทับใบเดิม → LEAVE_OVERLAP ไม่มีอะไรเปลี่ยน'].host.code, got['🔴 แก้ไปทับใบเดิม → LEAVE_OVERLAP ไม่มีอะไรเปลี่ยน'].host.ops], ['LEAVE_OVERLAP', 'LEAVE_OVERLAP', 0]);
eq('บันทึกประจำวันกลับเป็นร่าง เนื้อหาเดิม', [db.DAILY_JOURNAL[0].Status, db.DAILY_JOURNAL[0].SubmittedAt, db.DAILY_JOURNAL[0].Theme], ['DRAFT', '', 'ผีเสื้อ']);
eq('ประกาศ: ใหม่ ANN-2 เหลืออยู่ ANN1 ถูกลบ', db.ANNOUNCEMENTS.map(r => r.AnnID + ':' + r.Title), ['ANN-2:ปิดเทอม']);
eq('บันทึกตรวจสอบ: MAIN 4 แถว (โควตา · ใบประกาศ · ใบเสร็จ · ดึงบันทึก) · HR 3 แถว (แก้ลา ×2 · ยกเลิก)', [db.AUDIT_LOG.length, db.HR_AUDIT_LOG.length], [4, 3]);
eq('...ของ HR ไปตาราง HR ไม่ปนกับ MAIN', db.HR_AUDIT_LOG.map(r => r.Action), ['LEAVE_EDIT', 'LEAVE_EDIT', 'LEAVE_CANCEL']);

console.log('\n3) 🔴 กฎที่ทำให้เขียนนอก Apps Script ได้อย่างปลอดภัย');
{
  const before = JSON.stringify(db);
  const img = host('addAnnouncement', { title: 'มีรูป', image: 'data:image/png;base64,iVBORw0KGgo=' });
  ok_('🔴 ประกาศที่มีรูป → NOT_ON_FAST_HOST (แอปส่งต่อให้ Apps Script ซึ่งเก็บรูปลง Drive) และไม่บันทึกอะไร', !img.ok && img.code === 'NOT_ON_FAST_HOST' && /image/.test(img.msg) && JSON.stringify(db) === before);
  // a key that does not exist yet, so setConfigValue_ must ADD a row — with the append undeclared
  const saved = ROUTES.PORTED.saveDocInfo.appends; delete ROUTES.PORTED.saveDocInfo.appends;
  const noAppend = host('saveDocInfo', { DocTaxId: '0105500000000', adminId: 'STF-A' });
  ROUTES.PORTED.saveDocInfo.appends = saved;
  ok_('🔴 เพิ่มแถวในชีตที่ไม่ได้ประกาศ → ล้ม', !noAppend.ok && noAppend.code === 'NOT_ON_FAST_HOST' && /does not declare/.test(noAppend.msg) && JSON.stringify(db) === before);
  const savedW = ROUTES.PORTED.editStudentLeave.writes; ROUTES.PORTED.editStudentLeave.writes = { LEAVE_REQUEST_STD: ['Date'] };
  const badCol = host('editStudentLeave', { leaveId: 'LVS-1', date: '2026-11-12', reason: 'แอบแก้เหตุผล' });
  ROUTES.PORTED.editStudentLeave.writes = savedW;
  ok_('🔴 แก้คอลัมน์ที่ไม่ได้ประกาศ → ล้มทั้งคำขอ (แม้ช่องแรกจะถูกต้อง)', !badCol.ok && badCol.code === 'NOT_ON_FAST_HOST' && /Reason/.test(badCol.msg) && JSON.stringify(db) === before);
  const savedD = ROUTES.PORTED.deleteAnnouncement.deletes; delete ROUTES.PORTED.deleteAnnouncement.deletes;
  const noDel = host('deleteAnnouncement', { annId: 'ANN-2' });
  ROUTES.PORTED.deleteAnnouncement.deletes = savedD;
  ok_('🔴 ลบแถวในชีตที่ไม่ได้ประกาศ → ล้ม', !noDel.ok && noDel.code === 'NOT_ON_FAST_HOST' && /does not declare/.test(noDel.msg) && JSON.stringify(db) === before);
  ok_('route ที่อ่านอย่างเดียวยังเขียนไม่ได้เลย (ไม่มีชีตให้เพิ่มแม้แต่บันทึกตรวจสอบ)', !ROUTES.writes('getPayslip') && !ROUTES.writes('notifications'));
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
