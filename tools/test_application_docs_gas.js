/**
 * tools/test_application_docs_gas.js — 📎 ใบสมัคร ระยะ 2 through the REAL Apps Script dispatch, real sessions
 *   node tools/test_application_docs_gas.js
 *
 * ID cards, house registrations and birth certificates. What must hold on Apps Script, where the engine
 * cannot see Drive:
 *   1  🔴 the file is PRIVATE — never setSharing (every other picture in this app is a public link)
 *   2  🔴 only the owning family and the admin: a teacher, another family, a forged __role or a forged
 *      __internal (to plant a "signature") get nothing
 *   3  the finger signature is stored the same private way, not as a public-link Image
 *   4  delete → the Drive file is in the bin; a refused upload leaves no file behind
 *   5  accept → the files move into the child's folder
 *   6  declined + 90 days → the daily backup trigger bins the papers, keeps the signature
 */
'use strict';
const path = require('path');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));
let pass = 0, fail = 0;
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  console.log((okk ? '  ok   ' : '  FAIL ') + label + (okk ? '' : '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
  okk ? pass++ : fail++;
}

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin', 'Triggers', 'Leave',
  'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup', 'PaySlips', 'PayAdjust', 'Password', 'Certificate', 'Dspm',
  'BillRun', 'GasEngine', 'Engine', 'Day6', 'Apply']);
const res = JSON.parse(run(new Function('return (' + function () {
  _configCache = null; setupAll(); _configCache = null;
  setConfigValue_('RequireSessionToken', 'true'); setConfigValue_('ApplyRetentionYears', '5'); setConfigValue_('ApplyPdpaContact', 'LINE @atom');
  _configCache = null;
  var main = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
  appendObject_(sheet_(main, 'PARENTS'), { ParentID: 'PAR-9', Name: 'แม่ผู้สมัคร', LineUID: 'U-P9' });
  appendObject_(sheet_(main, 'PARENTS'), { ParentID: 'PAR-8', Name: 'บ้านอื่น', LineUID: 'U-P8' });
  appendObject_(sheet_(hr, 'STAFF'), { StaffID: 'STF-T9', Name: 'ครู', Role: 'Teacher', PositionLevel: 'Teacher', Status: 'ACTIVE', StartDate: '2025-01-01' });
  appendObject_(sheet_(hr, 'STAFF'), { StaffID: 'STF-A9', Name: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', StartDate: '2025-01-01' });
  try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}
  var P = issueSession_('U-P9', 'Parent', 'PAR-9'), Q = issueSession_('U-P8', 'Parent', 'PAR-8'),
      T = issueSession_('U-T9', 'Teacher', 'STF-T9'), A = issueSession_('U-A9', 'Admin', 'STF-A9');
  function call(a, p, tok) { var j = JSON.parse(dispatch_(a, p || {}, tok).getContent()); return j.ok ? { ok: true, d: j.data } : { ok: false, code: j.error.code }; }
  function codeOf(r) { return r.ok ? 'OK' : r.code; }
  var drive = DriveApp._state, files = function () { return Object.keys(drive.files).map(function (k) { return drive.files[k]; }); };
  var d12 = '110170012345', s = 0; for (var i = 0; i < 12; i++) s += (+d12[i]) * (13 - i); var NID = d12 + ((11 - (s % 11)) % 10);
  var info = call('applyInfo', {}, P).d;
  var out = {};
  var sub = call('submitApplication', { clientRef: 'g-1', child: { NameTH: 'ด.ญ. ทดลอง ใจดี', NameEN: 'T J', NicknameEN: 'Dee', Gender: 'F', DOB: '2024-06-01', IdType: 'TH', NationalID: NID },
    data: {}, consents: { pdpa: true, health: true, daily: true, photoJournal: true, photoPublic: true }, truth: true, signName: 'แม่ผู้สมัคร',
    consentVersion: info.version, signature: 'data:image/png;base64,iVBORw0KGgo=' }, P);
  out.sub = codeOf(sub);
  var appRow = readObjects_(sheet_(main, 'APPLICATIONS'))[0] || {};
  var docRows = function () { return readObjects_(sheet_(main, 'APPLICATION_DOCS')); };
  var sigRow = docRows().filter(function (d) { return d.DocType === 'signature'; })[0] || {};
  var sigFile = drive.files[sigRow.FileID] || {};
  out.sig = [appRow.Image || '', !!sigRow.FileID, sigFile.shared, sigFile.parent];
  // parent uploads a PDF
  var B64 = 'JVBERi0xLjQKJcfsj6IK';   // '%PDF-1.4…'
  var up = call('uploadApplicationDoc', { appId: 'APP-0001', docType: 'birth', data: 'data:application/pdf;base64,' + B64, name: 'birth.pdf' }, P);
  out.up = up.ok ? [up.d.type, up.d.mime, up.d.by] : up.code;
  var row = docRows().filter(function (d) { return d.DocType === 'birth'; })[0] || {};
  var f = drive.files[row.FileID] || {};
  out.file = [f.shared, f.parent, f.mime, f.trashed];
  var before = files().length;
  out.teacher = [codeOf(call('uploadApplicationDoc', { appId: 'APP-0001', docType: 'birth', data: 'data:application/pdf;base64,' + B64 }, T)),
    codeOf(call('applicationDocFile', { docId: up.ok ? up.d.docId : '' }, T)), codeOf(call('applicationDocs', { appId: 'APP-0001' }, T))];
  out.other = [codeOf(call('uploadApplicationDoc', { appId: 'APP-0001', docType: 'birth', data: 'data:application/pdf;base64,' + B64 }, Q)),
    codeOf(call('applicationDocFile', { docId: up.ok ? up.d.docId : '' }, Q))];
  out.forged = [codeOf(call('applicationDocFile', { docId: up.ok ? up.d.docId : '', __role: 'Admin' }, Q)),
    codeOf(call('uploadApplicationDoc', { appId: 'APP-0001', docType: 'signature', __internal: true, data: 'data:image/png;base64,iVBORw0KGgo=' }, P))];
  out.badType = codeOf(call('uploadApplicationDoc', { appId: 'APP-0001', docType: 'birth', data: 'data:application/msword;base64,AAAA' }, P));
  out.refusedLeftNoLiveFile = files().filter(function (x) { return !x.trashed; }).length === before;
  var fileRes = call('applicationDocFile', { docId: up.d.docId }, P);
  out.read = fileRes.ok ? fileRes.d.data === 'data:application/pdf;base64,' + B64 : fileRes.code;
  out.adminRead = codeOf(call('applicationDocFile', { docId: up.d.docId }, A));
  var adm = call('uploadApplicationDoc', { appId: 'APP-0001', docType: 'house', data: 'data:image/jpeg;base64,/9j/4AAQ' }, A);
  out.admUp = adm.ok ? adm.d.by : adm.code;
  out.parentCannotDeleteAdmins = codeOf(call('deleteApplicationDoc', { docId: adm.d.docId }, P));
  var del = call('deleteApplicationDoc', { docId: up.d.docId }, P);
  out.del = [codeOf(del), (drive.files[row.FileID] || {}).trashed];
  out.list = (call('applicationDocs', { appId: 'APP-0001' }, P).d || []).map(function (d) { return d.type; });
  // approve → moved to the child's folder
  var ap = call('approveApplication', { appId: 'APP-0001', startDate: '2099-02-01', className: 'Nursery 1' }, A);
  var houseRow = docRows().filter(function (d) { return d.DocType === 'house'; })[0] || {};
  out.moved = [codeOf(ap), String((drive.files[houseRow.FileID] || {}).parent || '').indexOf('AtomNursery_Students/' + (ap.d || {}).studentId) === 0,
    String((drive.files[sigRow.FileID] || {}).parent || '').indexOf('AtomNursery_Students/') === 0];
  // a second application, declined, 91 days ago → the daily backup bins the papers
  var sub2 = call('submitApplication', { clientRef: 'g-2', child: { NameTH: 'ด.ช. สอง', NameEN: 'Two', NicknameEN: 'Two', Gender: 'M', DOB: '2024-01-01', IdType: 'PASSPORT', Passport: 'AB12345' },
    data: {}, consents: { pdpa: true, health: true, daily: true, photoJournal: true, photoPublic: true }, truth: true, signName: 'แม่ผู้สมัคร',
    consentVersion: info.version, signature: 'data:image/png;base64,iVBORw0KGgo=' }, P);
  var up2 = call('uploadApplicationDoc', { appId: sub2.d.appId, docType: 'house', data: 'data:application/pdf;base64,' + B64 }, P);
  call('rejectApplication', { appId: sub2.d.appId }, A);
  var sh = sheet_(main, 'APPLICATIONS');
  readObjects_(sh).forEach(function (a) { if (a.AppID === sub2.d.appId) updateRow_(sh, a._row, { DecidedAt: '2020-01-01 10:00', UpdatedAt: '2020-01-01 10:00' }); });
  try { recCacheBust_('APPLICATIONS'); } catch (e) {}
  try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}
  dailyBackup();
  var r2 = docRows().filter(function (d) { return d.AppID === sub2.d.appId; });
  out.purge = r2.map(function (d) { return d.DocType + ':' + d.Status + ':' + (drive.files[d.FileID] || {}).trashed; }).sort();
  out.acceptedKept = docRows().filter(function (d) { return d.AppID === 'APP-0001' && d.Status === 'ACTIVE'; }).length;
  return JSON.stringify(out);
}.toString() + ')()')));

console.log('\n1–3) 🔴 ไฟล์แบบปิด · ลายเซ็นก็ปิด');
eq('ส่งใบสมัคร', res.sub, 'OK');
eq('🔴 ลายเซ็น: ไม่อยู่ในช่องรูป · เป็นไฟล์ · ไม่แชร์ · อยู่ในโฟลเดอร์ใบสมัคร', res.sig, ['', true, false, 'AtomNursery_Applications/APP-0001']);
eq('ผู้ปกครองแนบ PDF ได้', res.up, ['birth', 'application/pdf', 'parent']);
eq('🔴 ไฟล์ไม่แชร์ · อยู่ในโฟลเดอร์ของใบสมัคร · ชนิดถูก', res.file, [false, 'AtomNursery_Applications/APP-0001', 'application/pdf', false]);
console.log('\n2) 🔴 ประตู');
eq('ครู: แนบ · เปิด · ดูรายการ ไม่ได้ทั้งหมด', res.teacher, ['NO_PERMISSION', 'NO_PERMISSION', 'NO_PERMISSION']);
eq('บ้านอื่น: แนบ · เปิด ไม่ได้', res.other, ['NO_ACCESS', 'NO_ACCESS']);
eq('🔴 ส่ง __role:Admin ปลอม / __internal ปลอม ไม่ได้ผล', res.forged, ['NO_ACCESS', 'BAD_INPUT']);
eq('ชนิดไฟล์ไม่ถูก → ปฏิเสธ', res.badType, 'BAD_INPUT');
eq('🔴 คำขอที่ถูกปฏิเสธไม่ทิ้งไฟล์ค้างใน Drive', res.refusedLeftNoLiveFile, true);
eq('เจ้าของเปิดไฟล์ได้ (ผ่านเซิร์ฟเวอร์)', res.read, true);
eq('แอดมินเปิดไฟล์ได้', res.adminRead, 'OK');
eq('แอดมินถ่าย/อัปโหลดแทนได้', res.admUp, 'admin');
console.log('\n4) ลบ');
eq('ผู้ปกครองลบไฟล์ที่แอดมินแนบไม่ได้', res.parentCannotDeleteAdmins, 'BAD_STATE');
eq('ลบไฟล์ของตัวเอง → ไฟล์ใน Drive ไปถังขยะ', res.del, ['OK', true]);
eq('รายการเหลือเฉพาะที่ยังอยู่', res.list, ['house']);
console.log('\n5) รับเข้า → ย้ายเข้าโฟลเดอร์นักเรียน');
eq('รับเข้า · เอกสารย้าย · ลายเซ็นย้ายด้วย', res.moved, ['OK', true, true]);
console.log('\n6) 🔴 ไม่รับ + 90 วัน → สำรองข้อมูลประจำวันลบเอกสาร');
eq('เอกสารถูกลบ+ไฟล์ไปถังขยะ · ลายเซ็นยังอยู่', res.purge, ['house:DELETED:true', 'signature:ACTIVE:false']);
eq('ใบที่รับเข้าแล้วไม่ถูกแตะ', res.acceptedKept, 2);

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
