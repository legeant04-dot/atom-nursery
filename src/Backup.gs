/**
 * Backup.gs — Day 7: daily backup of both workbooks + E2E health check
 * ------------------------------------------------------------------
 * dailyBackup() is scheduled by installTriggers() (Triggers.gs) to run
 * once a day. It copies AtomNursery_Main + AtomNursery_HR into the Drive
 * folder named by SCHOOL_CONFIG.BackupFolderName, logs each copy to the
 * BACKUP_LOG sheet, and prunes copies older than BackupRetentionDays.
 *
 * Run runBackupNow() once from the editor to test, and verifyDay7() to
 * confirm the end-to-end setup before go-live.
 * ------------------------------------------------------------------
 */

/** Get (or create) the backup Drive folder. */
function backupFolder_() {
  var name = getConfig_('BackupFolderName', 'AtomNursery_Backups');
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

/** Copy one workbook (by Script-Property id) into the backup folder + log it. */
function backupOne_(propKey, label, folder, stamp) {
  var id = PropertiesService.getScriptProperties().getProperty(propKey);
  if (!id) throw new Error('Missing workbook id for ' + propKey + ' — run setupAll() first.');
  var file = DriveApp.getFileById(id);
  var copyName = label + '_' + stamp;
  var copy = file.makeCopy(copyName, folder);
  appendObject_(sheet_(getMainSpreadsheet_(), 'BACKUP_LOG'), {
    BackupDate: new Date(), WorkbookName: copyName, DriveFileID: copy.getId(), Status: 'OK'
  });
  return copy.getId();
}

/** Daily backup of both workbooks (scheduled). Returns the new copy ids. */
function dailyBackup() {
  var folder = backupFolder_();
  var stamp = Utilities.formatDate(new Date(), getConfig_('Timezone', 'Asia/Bangkok'), 'yyyyMMdd_HHmm');
  var ids = {
    main: backupOne_(PROP.MAIN_ID, WB.MAIN, folder, stamp),
    hr:   backupOne_(PROP.HR_ID,   WB.HR,   folder, stamp)
  };
  pruneOldBackups_(folder);
  Logger.log('Backup done @ ' + stamp + ' -> ' + JSON.stringify(ids));
  return ids;
}

/** Manual wrapper so you can Run it from the editor to test. */
function runBackupNow() { return dailyBackup(); }

/** Delete backup copies older than BackupRetentionDays (default 14). */
function pruneOldBackups_(folder) {
  var keepDays = Number(getConfig_('BackupRetentionDays', 14));
  var cutoff = new Date().getTime() - keepDays * 24 * 60 * 60 * 1000;
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (f.getDateCreated().getTime() < cutoff) folder.removeFile(f);
  }
}

/**
 * verifyDay7() — end-to-end readiness check. Run from the editor after
 * setupAll(), bootstrapAdmin(), installTriggers() and config fill-in.
 * Logs PASS/FAIL per item; returns the summary object.
 */
function verifyDay7() {
  var r = { checks: [], pass: true };
  function check(name, ok, detail) { r.checks.push({ name: name, ok: !!ok, detail: detail || '' }); if (!ok) r.pass = false; }

  // 1. both workbook ids present
  var sp = PropertiesService.getScriptProperties();
  check('Workbook ids set', !!sp.getProperty(PROP.MAIN_ID) && !!sp.getProperty(PROP.HR_ID));

  // 2. all schema sheets exist
  try {
    var main = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
    var missing = [];
    Object.keys(SCHEMA[WB.MAIN]).forEach(function (s) { if (!main.getSheetByName(s)) missing.push('MAIN/' + s); });
    Object.keys(SCHEMA[WB.HR]).forEach(function (s) { if (!hr.getSheetByName(s)) missing.push('HR/' + s); });
    check('All sheets present', missing.length === 0, missing.join(', '));
  } catch (e) { check('All sheets present', false, String(e)); }

  // 3. critical config filled (not still <FILL ...>)
  ['LineChannelAccessToken', 'LiffID', 'AdminLineUID', 'QRCode_Monthly'].forEach(function (k) {
    var v = String(getConfig_(k, ''));
    check('Config ' + k, v && v.indexOf('<FILL') !== 0, v ? '' : 'empty');
  });

  // 4. at least one Admin user exists
  try {
    var admin = findObject_(sheet_(getHrSpreadsheet_(), 'STAFF'), function (s) { return String(s.Role) === 'Admin'; });
    check('Admin account exists', !!admin, admin ? admin.StaffID : 'run bootstrapAdmin()');
  } catch (e) { check('Admin account exists', false, String(e)); }

  // 5. triggers installed (forgot check-in/out + dailyBackup)
  check('Triggers installed', ScriptApp.getProjectTriggers().length >= 1);

  // 6. router responds
  try { check('Router ping', JSON.parse(dispatch_('ping', {}).getContent()).ok === true); }
  catch (e) { check('Router ping', false, String(e)); }

  // 7. backup runs + writes BACKUP_LOG
  try { dailyBackup(); check('Backup runs', true); }
  catch (e) { check('Backup runs', false, String(e)); }

  Logger.log('verifyDay7 -> ' + (r.pass ? 'PASS ✅' : 'FAIL ❌'));
  r.checks.forEach(function (c) { Logger.log((c.ok ? '  ✓ ' : '  ✗ ') + c.name + (c.detail ? ' — ' + c.detail : '')); });
  return r;
}
