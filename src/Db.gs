/**
 * Db.gs — generic Google Sheets data-access layer
 * ------------------------------------------------------------------
 * Thin, header-driven helpers used by the whole backend. Every sheet
 * has its column names in row 1 (created by Setup.gs), so records are
 * passed around as plain objects keyed by header name.
 * ------------------------------------------------------------------
 */

/** Return a sheet, throwing a clear error if it is missing. */
function sheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Sheet not found: ' + name + ' in ' + ss.getName());
  return sh;
}

/** Header names (row 1) of a sheet. */
function headers_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0];
}

/**
 * All data rows as objects keyed by header. Each object also carries a
 * non-enumerable _row (1-based sheet row index) for in-place updates.
 */
function readObjects_(sheet) {
  var lastRow = sheet.getLastRow();
  var hdr = headers_(sheet);
  if (lastRow < 2 || !hdr.length) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, hdr.length).getValues();
  return values.map(function (row, i) {
    var obj = {};
    hdr.forEach(function (h, c) { obj[h] = row[c]; });
    Object.defineProperty(obj, '_row', { value: i + 2, enumerable: false });
    return obj;
  });
}

/** First record matching predicate(obj) -> boolean, or null. */
function findObject_(sheet, predicate) {
  var rows = readObjects_(sheet);
  for (var i = 0; i < rows.length; i++) if (predicate(rows[i])) return rows[i];
  return null;
}

// ---- inline-image offload -----------------------------------------
// A Google Sheets cell caps at 50,000 chars, so a real photo's base64 (>50KB → >65k chars) makes
// setValues THROW — that was the silent "attach a photo, press Save, nothing happens" bug. Any cell
// holding a `data:image/...` URL is written to Drive instead and only the (short) thumbnail URL is
// stored. A value that is already a URL (or not an image) passes straight through.
var IMAGE_COLS_ = { Photo: 1, InsuranceCardImage: 1, Image: 1, RegisterPhotoUrl: 1 };
function driveifyImage_(value, name) {
  if (typeof value !== 'string' || value.indexOf('data:image/') !== 0) return value;
  try {
    var comma = value.indexOf(','); var b64 = comma >= 0 ? value.slice(comma + 1) : value;
    if (!b64) return '';
    var folderName = getConfig_('PhotosFolderName', 'AtomNursery_Photos');
    var it = DriveApp.getFoldersByName(folderName);
    var folder = it.hasNext() ? it.next() : DriveApp.createFolder(folderName);
    var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', name || ('img-' + Date.now() + '.jpg'));
    var file = folder.createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
    return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1000';
  } catch (e) { return value; }   // Drive failed → keep the base64 (setValues may throw loudly, never silent)
}
/** Offload any image-bearing fields of a record to Drive in place; returns the same object. */
function driveifyImages_(obj) {
  if (!obj) return obj;
  for (var k in obj) { if (obj.hasOwnProperty(k) && IMAGE_COLS_[k]) obj[k] = driveifyImage_(obj[k], k + '-' + Date.now() + '.jpg'); }
  return obj;
}

/** Append a record. Missing fields are written blank; extras ignored. */
function appendObject_(sheet, obj) {
  driveifyImages_(obj);
  var hdr = headers_(sheet);
  var row = hdr.map(function (h) { return (obj[h] === undefined || obj[h] === null) ? '' : obj[h]; });
  sheet.appendRow(row);
  return sheet.getLastRow();
}

/** Patch specific fields of an existing row (1-based rowIndex). */
function updateRow_(sheet, rowIndex, patch) {
  driveifyImages_(patch);
  var hdr = headers_(sheet);
  var current = sheet.getRange(rowIndex, 1, 1, hdr.length).getValues()[0];
  hdr.forEach(function (h, c) { if (patch.hasOwnProperty(h)) current[c] = patch[h]; });
  sheet.getRange(rowIndex, 1, 1, hdr.length).setValues([current]);
}

/**
 * Sequential ID generator, e.g. nextId_(sheet, 'StudentID', 'STD', 4)
 * -> 'STD-0001'. Scans existing IDs with the same prefix for the max.
 */
function nextId_(sheet, idColumn, prefix, pad) {
  pad = pad || 4;
  var rows = readObjects_(sheet);
  var max = 0;
  var re = new RegExp('^' + prefix + '-?(\\d+)$');
  rows.forEach(function (r) {
    var m = re.exec(String(r[idColumn] || ''));
    if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
  });
  var num = String(max + 1);
  while (num.length < pad) num = '0' + num;
  return prefix + '-' + num;
}

// ---- SCHOOL_CONFIG accessors --------------------------------------
var _configCache = null;

/** Read all SCHOOL_CONFIG into a {Key: Value} map (cached per execution). */
function getAllConfig_() {
  if (_configCache) return _configCache;
  var sheet = sheet_(getMainSpreadsheet_(), 'SCHOOL_CONFIG');
  var map = {};
  readObjects_(sheet).forEach(function (r) { map[String(r.Key)] = r.Value; });
  _configCache = map;
  return map;
}

/** Single config value with optional default. */
function getConfig_(key, dflt) {
  var v = getAllConfig_()[key];
  return (v === undefined || v === '') ? dflt : v;
}

/** Write one SCHOOL_CONFIG value in place (creates the row if missing); busts the config cache. */
function setConfigValue_(key, value) {
  var cfg = sheet_(getMainSpreadsheet_(), 'SCHOOL_CONFIG');
  var r = findObject_(cfg, function (x) { return String(x.Key) === String(key); });
  if (r) updateRow_(cfg, r._row, { Value: value });
  else appendObject_(cfg, { Key: key, Value: value });
  try { _configCache = null; } catch (e) {}
  try { CacheService.getScriptCache().remove('cfg'); } catch (e) {}
  return value;
}
