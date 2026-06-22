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

  ScriptApp.newTrigger('forgotCheckinReminder').timeBased().atHour(8).everyDays(1).create();
  ScriptApp.newTrigger('forgotCheckoutReminder').timeBased().atHour(18).nearMinute(30).everyDays(1).create();
  // Daily backup (implemented Day 7) — registered here so the schedule exists.
  if (typeof dailyBackup === 'function') {
    ScriptApp.newTrigger('dailyBackup').timeBased().atHour(1).everyDays(1).create();
  }
  Logger.log('Triggers installed: ' + ScriptApp.getProjectTriggers().length);
}
