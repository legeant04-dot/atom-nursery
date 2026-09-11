/**
 * Triggers.gs — time-based automation (Proposal §9 Day 3 & Day 7)
 * ------------------------------------------------------------------
 * Run installTriggers() once after deploy. Idempotent: it clears the
 * project's existing triggers first so re-running won't duplicate them.
 *
 * Reminder times come from SCHOOL_CONFIG (ForgotCheckInNotify /
 * ForgotCheckOutNotify) but Apps Script time triggers fire on the hour
 * granularity given here — adjust nearHour to match your config.
 * ------------------------------------------------------------------
 */
function installTriggers() {
  // Remove existing triggers owned by this project to avoid duplicates.
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });

  // 06:50 morning check-in reminder (teachers clock in at 07:00). Timezone = project TZ (Asia/Bangkok).
  ScriptApp.newTrigger('forgotCheckinReminder').timeBased().atHour(6).nearMinute(50).everyDays(1).create();
  ScriptApp.newTrigger('forgotCheckoutReminder').timeBased().atHour(18).nearMinute(30).everyDays(1).create();
  // Daily digests (batched summary → one message instead of many per-event pushes). Skip weekends/holidays.
  // 10:00 morning (Big Cleaning + pending approvals) · 20:00 evening (full daily report).
  /* 11:15, moved off 10:00 on 2026-09-11 with the hourly data in hand.
   *
   * 10:00 was the worst hour in the school by a distance — p95 71.2s against a 25.3s average, 10%
   * failures — and the heaviest single moments of the whole window were an admin's screens at 10:08,
   * 10:15 and 10:23 taking 153–205 seconds each. This digest reads dailyReport, staffMissingCheckout
   * and two OT sheets, and every request in the school runs as the same Google account, so it is not
   * free. 11:00 carries a seventh of 10:00's traffic. (The evening was never the problem: 21:00 is
   * one of the BEST hours — that complaint was a sign-in hanging, fixed by the request timeout.) */
  if (typeof digestMorning_ === 'function') ScriptApp.newTrigger('digestMorning_').timeBased().atHour(11).nearMinute(15).everyDays(1).create();
  if (typeof digestEvening_ === 'function') ScriptApp.newTrigger('digestEvening_').timeBased().atHour(20).nearMinute(0).everyDays(1).create();
  // Daily backup (implemented Day 7) — registered here so the schedule exists.
  if (typeof dailyBackup === 'function') {
    ScriptApp.newTrigger('dailyBackup').timeBased().atHour(1).everyDays(1).create();
  }
  Logger.log('Triggers installed: ' + ScriptApp.getProjectTriggers().length);
}
