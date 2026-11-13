/**
 * HolidayCare.gs — 💵 ค่าดูแลวันหยุด: the children on a closed day, their prices, and telling the families.
 *
 * Asked by the ผอ. 2026-11-13: on ดำเนินการ › คุณครู › OT วันหยุด, once the teachers and the children
 * are ticked, the admin sets what each teacher earns that day AND what the school charges each child —
 * different prices for different children if the admin says so — and the bills issue themselves.
 *
 * THE MONEY IS DECIDED IN ONE PLACE: holidayAttendSet in Engine.gs (the same handler mock mode and the
 * fast host run). It writes HOLIDAY_ATTEND and STUDENT_CHARGES together and refuses, before changing
 * anything, to touch a charge a family has already paid or sent a slip for. This route only adds what
 * the engine cannot do: the 🔔/LINE message to each family whose bill appeared, changed or went away.
 *
 * Decisions taken with the ผอ. (2026-11-13):
 *   · the bill issues the moment the admin saves — not after the child is checked in
 *   · a paid / slip-sent bill is LOCKED: no repricing, no removing the child (refund outside first)
 *   · families are told in the app always, and on LINE only when the parent.bill topic is on
 *   · the price is pre-filled from SCHOOL_CONFIG.HolidayCareFee and editable per child
 *   · a child a teacher adds on the day gets NO bill until the admin prices it (FeeStatus PENDING)
 *
 * The same pattern as Apply.gs: engineDispatch_ does the work and persists, the notify is best-effort
 * afterwards — a LINE failure must never undo a bill that was correctly written.
 */
function handleHolidayAttendSet(p) {
  var res = engineDispatch_('holidayAttendSet', p || {});
  var told = 0;
  try {
    var notes = (res && res.notify) || [];
    if (notes.length) {
      var stSheet = sheet_(getMainSpreadsheet_(), 'STUDENTS');
      notes.forEach(function (n) {
        var st = findObject_(stSheet, function (s) { return String(s.StudentID) === String(n.studentId); });
        if (!st) return;
        try { if (notifyStudentParents_(st, holidayCareMsg_(n, st, res), 'parent.bill') > 0) told++; } catch (e) {}
      });
    }
  } catch (e) { try { Logger.log('handleHolidayAttendSet notify ' + e.message); } catch (x) {} }
  if (res) { res.parentNotified = told; delete res.notify; }   // the screen needs the count, not the queue
  return res;
}

/** What the family reads. Says the day, the child and the amount — a bill with no reason reads like an error. */
function holidayCareMsg_(n, st, res) {
  var who = st.Nickname || st.Name || st.NameTH || '';
  var label = (res && res.label) || 'ค่าดูแลวันหยุด';
  var baht = function (v) { return Number(v || 0).toLocaleString('en-US') + ' บาท'; };
  if (n.kind === 'cancel') return '🧾 ยกเลิกบิล' + label + ' ของ ' + who + ' (' + baht(n.amount) + ') แล้ว — ไม่ต้องชำระรายการนี้';
  if (n.kind === 'change') return '🧾 แก้ไขบิล' + label + ' ของ ' + who + ' เป็น ' + baht(n.amount) + ' (เดิม ' + baht(n.from) + ') — เปิดแอปเพื่อดู/ชำระเงิน';
  return '🧾 ออกบิล' + label + ' ของ ' + who + ' ' + baht(n.amount) + ' — เปิดแอปเพื่อดู/ชำระเงิน';
}
