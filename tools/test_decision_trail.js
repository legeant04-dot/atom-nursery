/**
 * tools/test_decision_trail.js — three questions asked on 2026-09-04, all of them "what happened,
 * and who can tell?".
 *   node tools/test_decision_trail.js
 *
 * 1) OT — a child leaving at 16:00, picked up at 16:15, appeared on the OT screen. The school's rule
 *    is that OT starts only past the grace window, so this looked like the app charging early. It
 *    was not charging anything: the row exists because a LATER pick-up was recorded first and then
 *    corrected down, and otUpsertForPickup_ deliberately keeps the row at zero so the correction
 *    stays visible. The row has to SAY that, or the screen is telling the school a lie about its own
 *    rule.
 *
 * 2) Injury — the head teacher sends a report back for correction. Nobody told the teacher, and the
 *    corrected report had nowhere to go: REJECTED is not a status approveInjury accepts, so only an
 *    ADMIN could put it back in the queue. One correction could park an accident report for ever.
 *
 * 3) Time requests — a manual check-in writes real attendance and therefore moves late minutes, OT
 *    and pay. The moment one was decided it vanished from every screen an admin could open, and the
 *    sheet recorded WHO but never WHEN.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), attreq = R('src/AttReq.gs'), code = R('src/Code.gs'), notify = R('src/Notify.gs');

function boot(extra) {
  const M = Object.assign({
    config: { Plans: [{ id: 'P1', name: 'เต็มวัน', price: 6900, end: '17:00' }], LeaveQuota: {}, OTRatePerHour: 100, OTGraceMinutes: 21,
      DefaultCheckInTime: '08:00', DefaultCheckOutTime: '17:00', LateGraceMinutes: 0 },
    students: [{ StudentID: 'STD-1', NameTH: 'พิเพอร์', Nickname: 'พิเพอร์', Class: 'Nursery 2', Status: 'ACTIVE', Plan: 'P1', EndTime: '16:00' }],
    staff: [
      { StaffID: 'T1', NameTH: 'ครูเอ', Role: 'Teacher', PositionLevel: 'Officer' },
      { StaffID: 'L1', NameTH: 'หัวหน้าแนน', Role: 'Teacher', PositionLevel: 'Leader' },
      { StaffID: 'A1', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin' }
    ],
    parents: [], userLinks: [], leaves: [], payments: [], otDaily: [], otRecords: [],
    studentCharges: [], prepayments: [], paymentSlips: [], checkinStudent: [], journals: [], comments: [],
    holidays: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    payroll: [], payrollConfig: {}, studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [],
    announcements: [], notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [],
    classChanges: [], classChangeReq: [], attendanceReq: [], adminInbox: [], foodMenus: [], foodItems: [],
    surveys: [], surveyResponses: [], injuries: [], injuryReports: [], insurance: [], bigCleaning: [],
    departments: [], permissions: {}, feed: [], calendar: [], classes: [], studentAttendanceToday: [],
    studentCheckins: []
  }, extra || {});
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(R('webapp/engine.js'), ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M: M };
}

console.log('1) OT — a row inside the grace window explains itself');
{
  // exactly the reported shape: end 16:00, picked up 16:15, charge already cancelled by the correction
  const { H } = boot({ otDaily: [{ OTID: 'OT-1', Date: '2026-09-04', StudentID: 'STD-1', PickupTime: '16:15',
    PlanEnd: '16:00', LateMinutes: 15, Hours: 0, FullAmount: 0, Amount: 0, Status: 'CANCELLED',
    CancelledBy: 'AUTO_TIME', CancelNote: 'แก้เวลารับกลับเป็น 16:15 — ไม่เข้าเงื่อนไข OT' }] });
  const row = H.studentOtList({ month: '2026-09' })[0];
  eq('nothing is charged — the school rule holds', row.amount, 0);
  eq('...and the full charge is zero too, so no discount is implied', row.fullAmount, 0);
  eq('the screen is told the grace window, not left to guess it', row.graceMinutes, 21);
  eq('...and that 15 minutes is inside it', row.lateMinutes <= row.graceMinutes, true);
  eq('why the row is there travels with it', row.cancelNote.indexOf('ไม่เข้าเงื่อนไข OT') >= 0, true);
  eq('...and that it was the arithmetic, not an admin decision', row.cancelledBy, 'AUTO_TIME');
}
{
  // the grace comes from the SCHOOL's config, not a baked-in default — if the school changes the
  // rule, the screen has to change with it
  const { H } = boot({ config: Object.assign({}, boot().M.config, { OTGraceMinutes: 30 }),
    otDaily: [{ OTID: 'OT-2', Date: '2026-09-04', StudentID: 'STD-1', PickupTime: '16:25', PlanEnd: '16:00',
      LateMinutes: 25, Hours: 0, Amount: 0, Status: 'CANCELLED' }] });
  eq('a school that allows 30 minutes reports 30', H.studentOtList({ month: '2026-09' })[0].graceMinutes, 30);
}
{
  // and the reverse: a genuinely late pick-up must still read as a charge, not as "within grace"
  const { H } = boot({ otDaily: [{ OTID: 'OT-3', Date: '2026-09-04', StudentID: 'STD-1', PickupTime: '17:10',
    PlanEnd: '16:00', LateMinutes: 70, Hours: 2, FullAmount: 200, Amount: 200, Status: 'UNPAID' }] });
  const row = H.studentOtList({ month: '2026-09' })[0];
  eq('70 minutes late is outside any grace window', row.lateMinutes > row.graceMinutes, true);
  eq('...and is still charged', row.amount, 200);
}
{
  const sl = /const inGrace\s*=([\s\S]{0,220})/.exec(app);
  ok_('the screen decides "not OT" from the numbers, not from a marker string',
    !!sl && /lateMinutes/.test(sl[1]) && /graceMinutes|graceOf/.test(sl[1]));
  ok_('...so the pill says "not OT" rather than "cancelled"', /ไม่เข้าเงื่อนไข OT/.test(app));
  ok_('...and the card prints the rule it is inside', /อยู่ในเวลาผ่อนผัน/.test(app));
}

console.log('\n2) injury — sent back, and then what?');
{
  const { H, M } = boot();
  const id = H.submitInjury({ staffId: 'T1', studentId: 'STD-1', date: '2026-09-03', time: '10:25',
    narrative: 'ลื่นล้ม', injuryTypes: [1] }).injuryId;
  H.approveInjury({ staffId: 'L1', injuryId: id, decision: 'reject', reason: 'เวลาไม่ตรง' });
  const r = M.injuryReports[0];
  eq('the trail names who sent it back', r.RejectBy, 'หัวหน้าแนน');
  ok_('...and when', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(String(r.RejectAt || '')));
  // THE TEACHER IS TOLD. Not a status change on a screen they had no reason to open.
  const note = (M.feed || []).find(f => String(f.ref || '') === 'injury|' + id && /ตีกลับ/.test(f.text || ''));
  ok_('the teacher who filed it is notified', !!note);
  eq('...addressed to them by id', note && note.staffId, 'T1');
  eq('...carrying the reason, so they know what to fix', /เวลาไม่ตรง/.test((note || {}).text || ''), true);
  eq('...and deep-linking to the report itself', (note || {}).ref, 'injury|' + id);
  // and the way back in
  const res = H.editInjury({ staffId: 'T1', injuryId: id, data: { Time: '10:20' } });
  eq('correcting it re-enters the queue at step 1', res.status, 'PENDING_LEADER');
  ok_('...with the moment of resubmission recorded', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(String(M.injuryReports[0].ResubmittedAt || '')));
  eq('...and it is genuinely actionable again', H.approveInjury({ staffId: 'L1', injuryId: id, decision: 'approve' }).status, 'PENDING_ADMIN');
}
{
  ok_('the sheet has somewhere to keep all three', /'RejectBy',\s*'RejectAt',\s*'ResubmittedAt'/.test(R('src/Config.gs')));
  ok_('live routes approveInjury through the notifying wrapper', /approveInjury:\s*function[^\n]*handleApproveInjury/.test(code));
  const h = /function handleApproveInjury\(p\)\{?[\s\S]{0,900}/.exec(notify.replace(/\r/g, ''));
  ok_('...which only speaks up when the answer was "sent back"', !!h && /REJECTED/.test(h[0]));
  ok_('...to the teacher who filed it', !!h && /r\.TeacherID/.test(h[0]));
  ok_('...via the inbox-first helper, so an exhausted LINE quota still reaches them',
    /function notifyStaffMember_/.test(notify) && /inboxAdd_/.test(notify.slice(notify.indexOf('function notifyStaffMember_'), notify.indexOf('function notifyStaffMember_') + 600)));
  ok_('the teacher screen leads with what was sent back to them', /function injRejectedHTML/.test(app));
  ok_('...filtered to their own reports', /injRejectedHTML[\s\S]{0,500}TeacherID[\s\S]{0,80}USER\.staffId/.test(app));
  ok_('...and says that correcting it is the resubmission', /แก้ไขและส่งใหม่/.test(app));
}

console.log('\n3) time requests — who approved what, and when');
{
  const { H, M } = boot();
  H.submitTimeRequest({ staffId: 'T1', type: 'IN', date: '2026-09-02', time: '08:05', reason: 'ลืมกด' });
  H.submitTimeRequest({ staffId: 'T1', type: 'OUT', date: '2026-09-03', time: '17:30', reason: 'มือถือแบตหมด' });
  const ids = M.attendanceReq.map(r => r.ReqID);
  H.approveTimeRequest({ staffId: 'L1', reqId: ids[0], decision: 'approve' });
  H.confirmTimeRequest({ staffId: 'A1', reqId: ids[0], decision: 'approve' });
  H.approveTimeRequest({ staffId: 'L1', reqId: ids[1], decision: 'reject', reason: 'ไม่มีหลักฐาน' });

  const hist = H.timeRequestHistory({ staffId: 'A1', month: '2026-09' });
  eq('the month shows decided requests, not only what is still waiting', hist.length, 2);
  const approved = hist.find(r => r.Status === 'APPROVED'), rejected = hist.find(r => r.Status === 'REJECTED');
  eq('an approved one names both signatures', [approved.Step1By, approved.Step2By], ['หัวหน้าแนน', 'แอดมิน']);
  ok_('...and the time of each', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(approved.Step1At) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(approved.Step2At));
  eq('a refused one says who refused it', rejected.Step1By, 'หัวหน้าแนน');
  eq('...and why', rejected.DecisionNote, 'ไม่มีหลักฐาน');
  eq('...and whose request it was', rejected.name, 'ครูเอ');
  eq('the list carries a single decided-at for sorting', !!approved.decidedAt, true);

  eq('a head teacher may read it — they take step 1', H.timeRequestHistory({ staffId: 'L1' }).length, 2);
  let e = null; try { H.timeRequestHistory({ staffId: 'T1' }); } catch (x) { e = x.message; }
  eq('an ordinary teacher may not', e, 'เฉพาะหัวหน้าครูหรือแอดมิน');
}
{
  // an admin settling a request the head teacher never saw must not leave step 1 stamped with a
  // time and no name, nor a name and no time
  const { H, M } = boot();
  H.submitTimeRequest({ staffId: 'T1', type: 'IN', date: '2026-09-02', time: '08:05' });
  const id = M.attendanceReq[0].ReqID;
  H.confirmTimeRequest({ staffId: 'A1', reqId: id, decision: 'approve' });
  const r = H.timeRequestHistory({ staffId: 'A1' })[0];
  ok_('step 1 says the admin stood in', /แอดมินอนุมัติแทน/.test(r.Step1By));
  eq('...and is stamped at the same moment', r.Step1At, r.Step2At);
}
{
  ok_('the sheet has columns for the two timestamps and the note',
    /'Step1At'/.test(attreq) && /'Step2At'/.test(attreq) && /'DecisionNote'/.test(attreq));
  ok_('both GAS decisions stamp the time', (attreq.match(/Step1At: nowStr_\(\)|Step2At: nowStr_\(\)/g) || []).length >= 2);
  ok_('a refusal at step 1 now reaches the person who asked', /notifyStaffMember_\(r\.StaffID/.test(attreq));
  ok_('...and the final answer lands in their inbox as well as LINE',
    /inboxAdd_\('approval', msg/.test(attreq));
  ok_('the admin screen offers the history', /A_timeReqHistory\(\)/.test(app));
  ok_('...and so does the head teacher screen', (app.match(/A_timeReqHistory\(\)/g) || []).length >= 2);
  ok_('refusing asks for a reason', /ไม่อนุมัติเพราะอะไร/.test(app));
  ok_('...and cancelling that box cancels the refusal', /if\(a===null\) return;/.test(app));
}

console.log(fail ? `\nFAILED ${pass} passed, ${fail} failed` : `\nPASSED ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
