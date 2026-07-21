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
  if (typeof digestMorning_ === 'function') ScriptApp.newTrigger('digestMorning_').timeBased().atHour(10).nearMinute(0).everyDays(1).create();
  if (typeof digestEvening_ === 'function') ScriptApp.newTrigger('digestEvening_').timeBased().atHour(20).nearMinute(0).everyDays(1).create();
  // Daily backup (implemented Day 7) — registered here so the schedule exists.
  if (typeof dailyBackup === 'function') {
    ScriptApp.newTrigger('dailyBackup').timeBased().atHour(1).everyDays(1).create();
  }
  Logger.log('Triggers installed: ' + ScriptApp.getProjectTriggers().length);
}
