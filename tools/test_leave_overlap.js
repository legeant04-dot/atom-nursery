/**
 * tools/test_leave_overlap.js — one person, one leave per slot
 *   node tools/test_leave_overlap.js
 *
 * Asked 2026-11-06 with ครูก้อย holding two approved ลากิจ for the afternoon of 6 Nov: "ห้ามลาซ้ำในช่วงวัน
 * และเวลาเดียวกันกับที่ขอมา ถ้าเจอให้แจ้งเตือนว่า ไม่สามารถลาได้เนื่องจากซ้ำกับการลาก่อนหน้า". Nothing refused it.
 * The school's rules: waiting or approved holds the slot (rejected does not) · AM and PM of one day do
 * not clash · every door is held to it (the form, the early-leave half day, the admin's edit) · the
 * duplicates already on file are FLAGGED for the admin, never changed.
 *
 *   1  the live route (src/Leave.gs) through the real dispatch_ with real sessions
 *   2  the admin's edit is refused onto another leave, allowed on its own slot
 *   3  allLeaves flags the duplicates already on file, both halves of the pair, nothing else
 *   4  the engine gives the same answers on the same cases
 *   5  the screens: the message names the earlier leave, the admin card says ลาซ้ำ
 */
'use strict';
const path = require('path'), fs = require('fs');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));
let pass = 0, fail = 0;
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  console.log((okk ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (okk ? '' : ' want=' + JSON.stringify(want)));
  okk ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

/* what is already on file, for ครูก้อย (STF-K) and one colleague (STF-P) */
const ON_FILE = [
  { LeaveID: 'LV-FULL', StaffID: 'STF-K', Type: 'ลาป่วย', StartDate: '2026-11-17', EndDate: '2026-11-17', Days: 1, HalfDay: '', Status: 'APPROVED' },
  { LeaveID: 'LV-PM', StaffID: 'STF-K', Type: 'ลากิจ', StartDate: '2026-11-18', EndDate: '2026-11-18', Days: 0.5, HalfDay: 'PM', Status: 'PENDING_LEADER' },
  { LeaveID: 'LV-RANGE', StaffID: 'STF-K', Type: 'ลาพักร้อน', StartDate: '2026-11-24', EndDate: '2026-11-26', Days: 3, HalfDay: '', Status: 'PENDING_ADMIN' },
  { LeaveID: 'LV-NO', StaffID: 'STF-K', Type: 'ลากิจ', StartDate: '2026-11-19', EndDate: '2026-11-19', Days: 1, HalfDay: '', Status: 'REJECTED' },
  // the pair from the screenshot — already on file, both approved, same afternoon
  { LeaveID: 'LV-DUP1', StaffID: 'STF-K', Type: 'ลากิจ', StartDate: '2026-11-06', EndDate: '2026-11-06', Days: 0.5, HalfDay: 'PM', Status: 'APPROVED' },
  { LeaveID: 'LV-DUP2', StaffID: 'STF-K', Type: 'ลากิจ', StartDate: '2026-11-06', EndDate: '2026-11-06', Days: 0.5, HalfDay: 'PM', Status: 'APPROVED' },
  { LeaveID: 'LV-P', StaffID: 'STF-P', Type: 'ลาป่วย', StartDate: '2026-11-06', EndDate: '2026-11-06', Days: 0.5, HalfDay: 'PM', Status: 'APPROVED' }];
/* [label, request, expected code ('' = accepted)] — run in order on ONE school, so an accepted one stays */
const ASKS = [
  ['ครึ่งวันบ่ายในวันที่ลาเต็มวันแล้ว', { startDate: '2026-11-17', endDate: '2026-11-17', halfDay: 'PM' }, 'LEAVE_OVERLAP'],
  ['เต็มวันในวันที่มีครึ่งบ่ายอยู่แล้ว', { startDate: '2026-11-18', endDate: '2026-11-18' }, 'LEAVE_OVERLAP'],
  ['บ่าย + บ่าย วันเดียวกัน', { startDate: '2026-11-18', endDate: '2026-11-18', halfDay: 'PM' }, 'LEAVE_OVERLAP'],
  ['เช้า + บ่าย วันเดียวกัน — ไม่ซ้ำ', { startDate: '2026-11-18', endDate: '2026-11-18', halfDay: 'AM' }, ''],
  ['...และเช้าอีกใบ = ซ้ำกับเช้าที่เพิ่งยื่น', { startDate: '2026-11-18', endDate: '2026-11-18', halfDay: 'AM' }, 'LEAVE_OVERLAP'],
  ['ช่วงที่ทับวันสุดท้ายของใบลาหลายวัน', { startDate: '2026-11-26', endDate: '2026-11-27' }, 'LEAVE_OVERLAP'],
  ['ช่วงที่ครอบใบลาหลายวันทั้งช่วง', { startDate: '2026-11-23', endDate: '2026-11-30' }, 'LEAVE_OVERLAP'],
  ['วันถัดจากใบลาหลายวัน — ไม่ซ้ำ', { startDate: '2026-11-27', endDate: '2026-11-27' }, ''],
  ['วันที่ใบเดิมถูกปฏิเสธ — ยื่นใหม่ได้', { startDate: '2026-11-19', endDate: '2026-11-19' }, '']];

// ============================================================================
const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin', 'Triggers', 'Leave',
  'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup', 'PaySlips', 'PayAdjust', 'Password', 'Certificate', 'Dspm',
  'BillRun', 'GasEngine', 'Engine', 'Day6', 'Journal', 'Perf']);
const res = JSON.parse(run(eval(`(function () { var ON_FILE = ${JSON.stringify(ON_FILE)}, ASKS = ${JSON.stringify(ASKS)};
  _configCache = null; setupAll(); _configCache = null;
  setConfigValue_('RequireSessionToken', 'true'); _configCache = null;
  var hr = getHrSpreadsheet_();
  appendObject_(sheet_(hr, 'STAFF'), { StaffID: 'STF-K', Name: 'ครูก้อย', Nickname: 'ก้อย', Role: 'Teacher', PositionLevel: 'Teacher', Department: 'Nursery 2', Status: 'ACTIVE', StartDate: '2025-01-01', LineUID: 'U-K' });
  appendObject_(sheet_(hr, 'STAFF'), { StaffID: 'STF-P', Name: 'ครูแพรว', Nickname: 'แพรว', Role: 'Teacher', PositionLevel: 'Teacher', Department: 'Nursery 2', Status: 'ACTIVE', StartDate: '2025-01-01', LineUID: 'U-P' });
  appendObject_(sheet_(hr, 'STAFF'), { StaffID: 'STF-A', Name: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', StartDate: '2025-01-01', LineUID: 'U-A' });
  ON_FILE.forEach(function (r) { appendObject_(sheet_(hr, 'LEAVE_REQUEST'), r); });
  try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}
  var tK = issueSession_('U-K', 'Teacher', 'STF-K'), tP = issueSession_('U-P', 'Teacher', 'STF-P'), tA = issueSession_('U-A', 'Admin', 'STF-A');
  function call(a, p, t) { var j = JSON.parse(dispatch_(a, p || {}, t).getContent()); return j.ok ? { ok: true, data: j.data } : { ok: false, code: j.error.code, msg: j.error.message }; }
  var out = { asks: [] };
  ASKS.forEach(function (x) { var p = JSON.parse(JSON.stringify(x[1])); p.type = 'ลากิจ'; p.reason = 'ทดสอบ'; out.asks.push(call('submitLeave', p, tK)); });
  out.colleague = call('submitLeave', { startDate: '2026-11-17', endDate: '2026-11-17', type: 'ลาป่วย', reason: 'x' }, tP);
  out.editOnto = call('editLeave', { leaveId: 'LV-RANGE', startDate: '2026-11-17', endDate: '2026-11-17', staffId: 'STF-A' }, tA);
  out.editSelf = call('editLeave', { leaveId: 'LV-RANGE', startDate: '2026-11-24', endDate: '2026-11-25', staffId: 'STF-A' }, tA);
  out.editReason = call('editLeave', { leaveId: 'LV-FULL', reason: 'แก้เหตุผลอย่างเดียว', staffId: 'STF-A' }, tA);
  out.all = call('allLeaves', {}, tA);
  out.rangeAfter = readObjects_(sheet_(hr, 'LEAVE_REQUEST')).filter(function (r) { return r.LeaveID === 'LV-RANGE'; }).map(function (r) { return ymdCell_(r.StartDate) + '>' + ymdCell_(r.EndDate); })[0];
  return JSON.stringify(out); })`)));

console.log('\n1) ครูยื่นใบลา — route จริง (Leave.gs) ผ่าน dispatch_ ด้วย session จริง');
ASKS.forEach((x, i) => eq(x[0], res.asks[i].ok ? '' : res.asks[i].code, x[2]));
const firstMsg = res.asks[0].msg || '';
ok_('ข้อความบอกว่าซ้ำกับใบไหน: "' + firstMsg + '"', /^ไม่สามารถลาได้เนื่องจากซ้ำกับการลาก่อนหน้า \(LV-FULL · ลาป่วย 2026-11-17\)$/.test(firstMsg));
ok_('...ใบลาหลายวันบอกช่วงวันที่ และครึ่งวันบอกว่าเช้าหรือบ่าย',
  /LV-RANGE · ลาพักร้อน 2026-11-24 ถึง 2026-11-26/.test(res.asks[5].msg || '') && /LV-PM · ลากิจ 2026-11-18 · ครึ่งวันบ่าย/.test(res.asks[1].msg || ''));
eq('เพื่อนครูลาวันเดียวกับก้อยได้ (คนละคน)', res.colleague.ok, true);

console.log('\n2) แอดมินแก้ไขวันที่');
eq('🔴 ย้ายใบลาไปทับวันที่ลาเต็มวันอยู่แล้ว → ปฏิเสธ', res.editOnto.ok ? '' : res.editOnto.code, 'LEAVE_OVERLAP');
eq('...และใบนั้นไม่ถูกเปลี่ยนเลย', res.rangeAfter, '2026-11-24>2026-11-25');
eq('ย่นใบลาในช่วงของตัวเอง (ไม่นับว่าซ้ำกับตัวเอง)', res.editSelf.ok, true);
eq('แก้เหตุผลอย่างเดียว ไม่ถูกตรวจซ้ำ', res.editReason.ok, true);

console.log('\n3) ⚠️ ใบที่ซ้ำอยู่แล้วในระบบ — ติดป้ายให้แอดมิน ไม่เปลี่ยนอะไร');
const byId = {}; (res.all.data || []).forEach(l => { byId[l.LeaveID] = l.overlapWith; });
eq('LV-DUP1 ซ้ำกับ LV-DUP2', byId['LV-DUP1'], ['LV-DUP2']);
eq('LV-DUP2 ซ้ำกับ LV-DUP1', byId['LV-DUP2'], ['LV-DUP1']);
eq('ของเพื่อนครูวันเดียวกันไม่ติดป้าย', byId['LV-P'], []);
eq('ใบที่ถูกปฏิเสธไม่ติดป้าย', byId['LV-NO'], []);
eq('ใบอื่นไม่ติดป้าย', ['LV-FULL', 'LV-PM', 'LV-RANGE'].map(k => byId[k]), [[], [], []]);
ok_('ทั้งคู่ยังอยู่ อนุมัติแล้วเหมือนเดิม', (res.all.data || []).filter(l => /^LV-DUP/.test(l.LeaveID) && l.Status === 'APPROVED').length === 2);

console.log('\n4) engine ตอบเหมือนกันทุกกรณี');
{
  const M = { config: {}, classes: [], students: [], parents: [], userLinks: [], holidays: [], activityLog: [], journals: [],
    staff: [{ StaffID: 'STF-K', NameTH: 'ครูก้อย', Role: 'Teacher', PositionLevel: 'Teacher', Status: 'ACTIVE', StartDate: '2025-01-01' },
            { StaffID: 'STF-A', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', StartDate: '2025-01-01' }],
    leaves: JSON.parse(JSON.stringify(ON_FILE)) };
  const H = createAtomAPI(M).H;
  const got = ASKS.map(x => { try { H.submitLeave(Object.assign({ staffId: 'STF-K', type: 'ลากิจ', reason: 'ทดสอบ' }, x[1])); return ''; } catch (e) { return e.code; } });
  eq('ทุกกรณีเหมือน route จริง', got, ASKS.map(x => x[2]));
  let e1 = ''; try { H.editLeave({ staffId: 'STF-A', leaveId: 'LV-RANGE', startDate: '2026-11-17', endDate: '2026-11-17' }); } catch (e) { e1 = e.code; }
  eq('แอดมินย้ายไปทับ → LEAVE_OVERLAP', e1, 'LEAVE_OVERLAP');
  eq('...และใบนั้นไม่ถูกเปลี่ยน', M.leaves.find(l => l.LeaveID === 'LV-RANGE').StartDate, '2026-11-24');
  const all = H.allLeaves({});
  eq('allLeaves ติดป้ายคู่ที่ซ้ำ', all.filter(l => l.overlapWith.length).map(l => l.LeaveID + '>' + l.overlapWith.join()).sort(), ['LV-DUP1>LV-DUP2', 'LV-DUP2>LV-DUP1']);
}

console.log('\n5) หน้าจอ');
{
  const app = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'app.js'), 'utf8');
  ok_('การ์ดใบลาของแอดมินแสดง "ลาซ้ำ: … ซ้ำกับ …"', /leaveDupTag\(l\)/.test(app) && /ลาซ้ำ: \$\{esc\(l\.LeaveID\)\} ซ้ำกับ/.test(app));
  ok_('ข้อความผิดพลาดแสดงประโยคของเซิร์ฟเวอร์ (บอกใบเดิม) + คำแนะนำ', /code==='LEAVE_OVERLAP'\)\{[\s\S]{0,300}head = raw/.test(app));
  ok_('ลาครึ่งวันตอนออกก่อนเวลา ใช้ route เดียวกัน (จึงถูกกันด้วยกฎเดียวกัน)', /window\.T_earlyLeaveDo[\s\S]{0,900}api\('submitLeave'/.test(app));
  ok_('LEAVE_OVERLAP เป็นการปฏิเสธที่คาดไว้ ไม่ใช่ความผิดพลาดของระบบ', /LEAVE_OVERLAP: 1/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'Perf.gs'), 'utf8')));
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
