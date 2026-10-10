/**
 * Export.gs — Phase 2.2. Every sheet, as JSON, for the move to Postgres.
 * ------------------------------------------------------------------
 * 🔴 THERE IS NO ROUTE TO THIS FILE, AND THERE MUST NOT BE ONE.
 *
 * This dumps the entire school: every child, every parent's phone number and national ID, every
 * salary. It is run BY HAND from the Apps Script editor by the owner, and the file it writes lands
 * in the owner's own Drive. A web route — even an admin-only one — would put the whole database one
 * stolen session token away, to save one person one click, once.
 *
 * `Import.gs` set the precedent for temporary migration tooling and its route was removed after the
 * go-live import; this is the other direction and does not get a route in the first place.
 *
 *   HOW TO RUN (owner, atomnursery.system@gmail.com):
 *     1. Apps Script editor → select `exportAllForMigration` → Run
 *     2. the log prints the Drive file name and the row counts
 *     3. download it, put it in  secrets/export/  (gitignored), and run
 *          node tools/pg_migrate.js --file secrets/export/<name>.json --dry
 *
 * 🔴 AND IT DOES NOT GO TO SUPABASE YET. The school's standing rule: no real student data leaves
 * for Postgres until the PDPA processing agreement exists and the ผอ. has approved it (Phase 1.5).
 * `--dry` reads and reports and writes nothing; that is the only mode to use before then.
 * ------------------------------------------------------------------
 */

/** Every sheet in one workbook, as { SHEETNAME: [ {col:value}, … ] }. */
function exportWorkbook_(ss, label) {
  var out = {}, counts = {};
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    try {
      /* readObjects_ decodes exactly as the app reads it (decodeCell_): dates as 'YYYY-MM-DD',
       * blanks as '', JSON cells parsed. That is deliberate — the migration must move the values
       * the APP sees, not the values the spreadsheet happens to store, or every date and every
       * empty cell changes meaning on the way across. */
      var rows = readObjects_(sh).map(function (r) {
        var o = {};
        for (var k in r) { if (r.hasOwnProperty(k) && k !== '_row') o[k] = r[k]; }
        return o;
      });
      out[name] = rows;
      counts[name] = rows.length;
    } catch (e) {
      out[name] = [];
      counts[name] = 'ERROR: ' + e.message;
    }
  });
  Logger.log(label + ': ' + JSON.stringify(counts));
  return out;
}

/**
 * Write one JSON file holding both workbooks. Returns the Drive file id.
 *
 * The two workbooks are kept APART in the file — `{ MAIN: {...}, HR: {...} }` — because they are an
 * access boundary and because AUDIT_LOG exists in both and they are different logs (see
 * tableName/HR_PREFIXED in tools/schema_inventory.js). Flattening them here would re-create, in the
 * export, exactly the collision the schema was just fixed to avoid.
 */
function exportAllForMigration() {
  var stamp = Utilities.formatDate(new Date(), getConfig_('Timezone', 'Asia/Bangkok'), 'yyyyMMdd_HHmm');
  var payload = {
    exportedAt: new Date().toISOString(),
    stamp: stamp,
    schema: 1,
    MAIN: exportWorkbook_(getMainSpreadsheet_(), 'MAIN'),
    HR: exportWorkbook_(getHrSpreadsheet_(), 'HR')
  };
  var name = 'atom_export_' + stamp + '.json';
  var folder = backupFolder_();               // the same Drive folder the daily backup uses
  var file = folder.createFile(name, JSON.stringify(payload), 'application/json');
  var total = 0;
  ['MAIN', 'HR'].forEach(function (wb) {
    for (var s in payload[wb]) { if (payload[wb].hasOwnProperty(s)) total += payload[wb][s].length; }
  });
  Logger.log('✅ ' + name + '  (' + total + ' rows)  id=' + file.getId());
  Logger.log('   Drive folder: ' + folder.getName());
  Logger.log('   🔴 this file is the whole school — download it, do not share the link.');
  return { file: name, id: file.getId(), rows: total };
}

/** Counts only — run this first to see what an export would contain, without writing a file. */
function exportDryRun() {
  var n = 0, per = {};
  [[getMainSpreadsheet_(), 'MAIN'], [getHrSpreadsheet_(), 'HR']].forEach(function (p) {
    p[0].getSheets().forEach(function (sh) {
      var c = Math.max(0, sh.getLastRow() - 1);
      per[p[1] + '.' + sh.getName()] = c; n += c;
    });
  });
  Logger.log(JSON.stringify(per, null, 1));
  Logger.log('total rows: ' + n);
  return { total: n, per: per };
}
