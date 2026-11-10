/**
 * server/write_proven.js — the writes the fast host may SAVE, and exactly what each may change
 *
 * 🔴 AN ALLOW-LIST, ON PURPOSE (2026-11-04). The host refuses any request that changes data unless
 * every writing call in it is listed here, and refuses it whole if anything changed outside the
 * collections listed for those calls. "Listed" means PROVEN, by tools/test_fast_host_writes_live.js
 * against the staging database, to leave Postgres in the state Apps Script would leave the sheets:
 *
 *   · it is an ENGINE action on live (not shadowed by a Code.gs route — the host refuses those)
 *   · what it changes is exactly the collections below (the test asserts the set, both ways)
 *   · read back from Postgres, the rows equal the engine's own M after the call
 *   · no image (GAS moves images to Drive; the host cannot)
 *   · no derived key (staffAttendanceToday / payrollConfig have no writer here yet)
 *
 * NOT HERE YET, AND DELIBERATELY: anything to do with money — bills, payments, prepay, charges,
 * payroll. Those wait for their own parity suite and the ผอ.'s review; "เรื่องเงินเป็นเรื่องละเอียด".
 * Adding a line here without adding its case to the live test makes that test fail.
 */
'use strict';
const WRITE_PROVEN = {
  addComment:         ['comments'],
  /* the student row carries the LATEST weight and height (and LastGrowthUpdate) — it is a write to
   * STUDENTS too, a sheet that may never shrink; it does not, the row is updated in place */
  updateGrowth:       ['growthRecords', 'students'],
  /* a correction is logged (logAct → ACTIVITY_LOG) — who changed a child's figures, and from what */
  editGrowth:         ['growthRecords', 'activityLog'],
  /* logged like a correction; deleting the LATEST record also moves the child's current figures back */
  deleteGrowth:       ['growthRecords', 'activityLog', 'students'],
  saveVaccines:       ['vaccineRecords'],
  setAbsenceFollowup: ['absenceFollowups', 'absenceFollowupLogs'],
  /* W3 (2026-11-10): a teacher adds a name on the list of children expected on a closed day — it decides
   * whether that child may be checked in (assertStudentDayOpen_). Logged (logAct). Staff only, in the engine.
   * holidayAttendSet (the admin's whole-list form) waits for W4 with the other admin writes. */
  holidayAttendAdd:    ['holidayAttend', 'activityLog']   // holidayAttendRemove is a CLOSED route (Code.gs: replaced by holidayAttendSet)
};
/* 🔴 MONEY — proven by tools/test_fast_host_money_live.js (every baht, every row, the double-issue and
 * re-confirm cases). Kept apart so the general suite does not have to know the money fixture. */
const MONEY_PROVEN = {
  /* every bill issued, every cash notice and every confirmation is logged (logAct → ACTIVITY_LOG):
   * who did it and for how much is part of the write, not decoration */
  issueBill: ['payments', 'activityLog'], issueBillsFor: ['payments', 'activityLog'], generateMonthlyBills: ['payments', 'activityLog'],
  addStudentCharge: ['studentCharges'], removeStudentCharge: ['studentCharges'],
  notifyCash: ['payments', 'activityLog'], confirmPayment: ['payments', 'activityLog'], rejectPayment: ['payments'],
  prepay: ['prepayments'], setPayrollConfig: ['payrollConfig']
};
Object.assign(WRITE_PROVEN, MONEY_PROVEN);
const MONEY = Object.keys(MONEY_PROVEN);
module.exports = { WRITE_PROVEN, MONEY };
