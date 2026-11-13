/**
 * Freeze.gs — P6b of docs/ROLLOUT_PLAN.md: "ยังดูได้ แต่บันทึกไม่ได้" for the minutes a copy is taken
 * ================================================================================================
 *
 * The data move (sheets → Postgres) and the rollback (Postgres → sheets, src/Rollback.gs) each copy
 * the school's data at one moment. A record written after that moment exists only on the side being
 * left — a payment confirmed at 20:12 while the copy started at 20:10 is simply gone afterwards. So
 * for those minutes, writing stops everywhere and reading carries on.
 *
 * ONE SWITCH, TWO PLACES, SET BY ONE FUNCTION
 *   · Script Property WRITE_FREEZE = on — what Apps Script checks. Read fresh on every request that
 *     writes (PropertiesService has no per-execution cache), so it cannot be stale behind a cached
 *     SCHOOL_CONFIG, and nobody can change it through the app.
 *   · SCHOOL_CONFIG WriteFreeze = on — what the Cloud Run host checks (it cannot see Script
 *     Properties). On move night it is written to the sheet and travels to Postgres with the data,
 *     so the host is frozen from its first request until unfreezeWrites().
 *   freezeWrites() / unfreezeWrites() set both, inside the school's write lock (shared with the host
 *   while Postgres is the backend): any write already running finishes first, and any write that
 *   takes the lock afterwards sees the switch. Run them from the Apps Script editor — there is no
 *   route and no button, on purpose.
 *
 * WHAT IS REFUSED (code WRITE_FROZEN, a deliberate refusal — PERF_EXPECTED_)
 *   · every action isMutatingAction_ calls a write; inside a batch call by call, so the reads in the
 *     same batch still answer (the Observer/BUSY shape), and nothing is persisted
 *   · sign-in (auth · lineExchange · googleExchange · demoLogin): they write USERS/PARENTS rows
 *     without the lock. Someone already signed in keeps reading; a new sign-in waits for the unfreeze.
 *   · the six time triggers return without doing anything (reminders and digests would describe
 *     half-moved data; the backup writes BACKUP_LOG)
 * Known and accepted: perfLog (telemetry into PERF_LOG) is not refused — losing a few timing rows
 * from a freeze window costs nothing.
 */

var FREEZE_PROP_ = 'WRITE_FREEZE';
var FREEZE_CFG_  = 'WriteFreeze';
var WRITE_FROZEN_MSG_ = 'ระบบกำลังปรับปรุงชั่วคราว — ดูข้อมูลได้ตามปกติ แต่ยังบันทึกไม่ได้ กรุณาลองใหม่ภายหลัง';
/** public actions that write (no lock) — refused while frozen */
var FREEZE_SIGNIN_ = { auth: 1, lineExchange: 1, googleExchange: 1, demoLogin: 1 };

/** Is writing stopped? Fresh read; a property that cannot be read is NOT a freeze. */
function writeFrozen_() {
  try { return String(PropertiesService.getScriptProperties().getProperty(FREEZE_PROP_) || '') === 'on'; }
  catch (e) { return false; }
}

/** For the triggers: true = skip this run (and say so in the log). */
function freezeSkip_(name) {
  if (!writeFrozen_()) return false;
  try { Logger.log('WRITE_FREEZE: ' + name + ' ข้ามรอบนี้'); } catch (e) {}
  return true;
}

function freezeSet_(on) {
  var apply = function () {
    var p = PropertiesService.getScriptProperties();
    if (on) p.setProperty(FREEZE_PROP_, 'on'); else p.deleteProperty(FREEZE_PROP_);
    setConfigValue_(FREEZE_CFG_, on ? 'on' : '');
    try { logAudit('system', on ? 'WRITE_FREEZE_ON' : 'WRITE_FREEZE_OFF', 'SCHOOL_CONFIG', FREEZE_CFG_); } catch (e) {}
  };
  if (typeof withWriteLock_ === 'function') withWriteLock_(true, apply); else apply();
  return { ok: true, frozen: on, at: new Date().toISOString() };
}

/** Editor: stop all writing (Apps Script and Cloud Run). */
function freezeWrites() { var r = freezeSet_(true); Logger.log(JSON.stringify(r)); return r; }
/** Editor: writing allowed again. */
function unfreezeWrites() { var r = freezeSet_(false); Logger.log(JSON.stringify(r)); return r; }
