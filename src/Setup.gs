/**
 * Setup.gs — Atom Nursery — Day 1 Database Builder
 * ------------------------------------------------------------------
 * Run setupAll() ONCE from the Apps Script editor (or clasp run) to:
 *   1. Create both Google Sheets workbooks in the controlling Gmail's
 *      Drive (atomnursery.system@gmail.com).
 *   2. Create every sheet (tab) with its column headers per SCHEMA.
 *   3. Seed SCHOOL_CONFIG and the DSPM_CRITERIA starter rows.
 *
 * It is IDEMPOTENT: running again reuses the same workbooks (IDs are
 * stored in Script Properties), adds any missing sheets/headers, and
 * never deletes existing data. Safe to re-run after editing SCHEMA.
 * ------------------------------------------------------------------
 */

/** Main entry point — run this on Day 1. */
function setupAll() {
  var log = [];
  var main = ensureWorkbook_(WB.MAIN, PROP.MAIN_ID, log);
  var hr   = ensureWorkbook_(WB.HR,   PROP.HR_ID,   log);

  ensureSheets_(main, SCHEMA[WB.MAIN], log);
  ensureSheets_(hr,   SCHEMA[WB.HR],   log);

  seedSchoolConfig_(main, log);
  seedDspmCriteria_(main, log);

  var summary = log.join('\n');
  Logger.log(summary);
  Logger.log('\nMAIN url: ' + main.getUrl());
  Logger.log('HR   url: ' + hr.getUrl());
  return summary;
}

/**
 * Open the workbook whose ID is in Script Properties, or create it.
 * Renames the default "Sheet1" out of the way so headers stay clean.
 */
function ensureWorkbook_(name, propKey, log) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(propKey);
  if (id) {
    try {
      var existing = SpreadsheetApp.openById(id);
      log.push('= Workbook reused: ' + name + ' (' + id + ')');
      return existing;
    } catch (e) {
      log.push('! Stored ' + propKey + ' invalid, creating fresh: ' + e.message);
    }
  }
  var ss = SpreadsheetApp.create(name);
  props.setProperty(propKey, ss.getId());
  // The id just changed; anything memoised for this execution points at a workbook that is gone.
  try { resetWorkbookCache_(); } catch (e) {}
  log.push('+ Workbook created: ' + name + ' (' + ss.getId() + ')');
  return ss;
}

/** Create each sheet in the map if missing, then write/repair headers. */
function ensureSheets_(ss, sheetMap, log) {
  var names = Object.keys(sheetMap);
  for (var i = 0; i < names.length; i++) {
    var sheetName = names[i];
    var headers = sheetMap[sheetName];
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      log.push('  + sheet ' + ss.getName() + ' > ' + sheetName);
    }
    writeHeaders_(sheet, headers);
  }
  removeDefaultSheet_(ss, log);
}

/** Write the header row (row 1), format it, and freeze it. */
function writeHeaders_(sheet, headers) {
  var range = sheet.getRange(1, 1, 1, headers.length);
  range.setValues([headers]);
  range.setFontWeight('bold')
       .setBackground('#1565C0')
       .setFontColor('#FFFFFF')
       .setVerticalAlignment('middle');
  sheet.setFrozenRows(1);
  // Trim any stale extra header cells beyond our schema width.
  var lastCol = sheet.getMaxColumns();
  if (lastCol > headers.length) {
    sheet.deleteColumns(headers.length + 1, lastCol - headers.length);
  }
}

/** Remove the auto-created "Sheet1" if it is empty and not part of schema. */
function removeDefaultSheet_(ss, log) {
  var def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) {
    var hasData = def.getLastRow() > 0 || def.getLastColumn() > 0;
    if (!hasData) {
      ss.deleteSheet(def);
      log.push('  - removed default Sheet1 in ' + ss.getName());
    }
  }
}

/** Seed SCHOOL_CONFIG Key/Value rows without overwriting edited values. */
function seedSchoolConfig_(main, log) {
  var sheet = main.getSheetByName('SCHOOL_CONFIG');
  var existingKeys = {};
  var last = sheet.getLastRow();
  if (last > 1) {
    var keys = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) existingKeys[String(keys[i][0])] = true;
  }
  var toAdd = SCHOOL_CONFIG_DEFAULTS.filter(function (row) { return !existingKeys[row[0]]; });
  if (toAdd.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAdd.length, 2).setValues(toAdd);
    log.push('  ~ SCHOOL_CONFIG: added ' + toAdd.length + ' key(s)');
  } else {
    log.push('  = SCHOOL_CONFIG: all keys present');
  }
}

/** Seed DSPM_CRITERIA starter rows once (skipped if any data exists). */
function seedDspmCriteria_(main, log) {
  var sheet = main.getSheetByName('DSPM_CRITERIA');
  if (sheet.getLastRow() > 1) {
    log.push('  = DSPM_CRITERIA: already has data, skipped');
    return;
  }
  if (typeof DSPM_CRITERIA_SEED === 'undefined' || !DSPM_CRITERIA_SEED.length) {
    log.push('  ! DSPM_CRITERIA: no seed defined (see Dspm_Seed.gs)');
    return;
  }
  sheet.getRange(2, 1, DSPM_CRITERIA_SEED.length, DSPM_CRITERIA_SEED[0].length)
       .setValues(DSPM_CRITERIA_SEED);
  log.push('  ~ DSPM_CRITERIA: seeded ' + DSPM_CRITERIA_SEED.length + ' starter row(s)');
}

/**
 * Verification helper — implements the Day-1 test checklist:
 *   - every sheet exists with exact headers
 *   - SCHOOL_CONFIG has every required key
 * Returns a report string and logs it. Run after setupAll().
 */
function verifyDay1() {
  var report = [];
  var ok = true;

  [[WB.MAIN, getMainSpreadsheet_()], [WB.HR, getHrSpreadsheet_()]].forEach(function (pair) {
    var wbName = pair[0], ss = pair[1];
    var map = SCHEMA[wbName];
    var names = Object.keys(map);
    report.push('# ' + wbName + ' — expected ' + names.length + ' sheets');
    names.forEach(function (sheetName) {
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet) { ok = false; report.push('  [MISSING SHEET] ' + sheetName); return; }
      var want = map[sheetName];
      var got = sheet.getRange(1, 1, 1, want.length).getValues()[0];
      var mismatch = want.filter(function (h, i) { return got[i] !== h; });
      if (mismatch.length) { ok = false; report.push('  [HEADER DIFF] ' + sheetName + ' -> ' + mismatch.join(', ')); }
      else report.push('  [OK] ' + sheetName + ' (' + want.length + ' cols)');
    });
  });

  // SCHOOL_CONFIG keys
  var cfg = getMainSpreadsheet_().getSheetByName('SCHOOL_CONFIG');
  var present = {};
  if (cfg.getLastRow() > 1) {
    cfg.getRange(2, 1, cfg.getLastRow() - 1, 1).getValues().forEach(function (r) { present[String(r[0])] = true; });
  }
  var missingKeys = SCHOOL_CONFIG_DEFAULTS.map(function (r) { return r[0]; })
    .filter(function (k) { return !present[k]; });
  if (missingKeys.length) { ok = false; report.push('# SCHOOL_CONFIG missing keys: ' + missingKeys.join(', ')); }
  else report.push('# SCHOOL_CONFIG: all required keys present');

  report.unshift(ok ? 'RESULT: PASS ✅' : 'RESULT: FAIL ❌');
  var out = report.join('\n');
  Logger.log(out);
  return out;
}
