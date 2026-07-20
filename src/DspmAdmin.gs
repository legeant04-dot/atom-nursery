/**
 * DspmAdmin.gs — admin CRUD for the DSPM assessment criteria (DSPM_CRITERIA), so the school can
 * add / edit / remove / re-categorize milestone items as the ministry manual changes, without a
 * re-import. Writes are IN-PLACE (updateRow_/appendObject_/deleteRow). The list read defers to the
 * engine (dspmAllCriteria). Admin-only via ADMIN_ONLY in Code.gs.
 *
 * A row is identified by (ItemNo, Track) — ItemNo is unique within a track. New rows get
 * ItemNo = max existing + 1 (never count+1). Fields:
 *   AgeFrom, AgeTo, AgeLabelTH, ItemNo, Skill(GM/FM/RL/EL/PS), Description, DescriptionEN, Method,
 *   PassCriteria, Track(Teacher/…).
 */
function dcSheet_() { return sheet_(getMainSpreadsheet_(), 'DSPM_CRITERIA'); }
function dcBust_() { if (typeof cacheDel_ === 'function') { cacheDel_('col:DSPM_CRITERIA'); cacheDel_('rows:DSPM_CRITERIA'); } }
var DC_FIELDS = ['AgeFrom', 'AgeTo', 'AgeLabelTH', 'Skill', 'Description', 'DescriptionEN', 'Method', 'PassCriteria', 'Track'];

function dcFind_(sh, itemNo, track) {
  return findObject_(sh, function (r) { return Number(r.ItemNo) === Number(itemNo) && String(r.Track || 'Teacher') === String(track || 'Teacher'); });
}
function dcNextItemNo_(sh) {
  var max = 0;
  readObjects_(sh).forEach(function (r) { var n = Number(r.ItemNo) || 0; if (n > max) max = n; });
  return max + 1;
}

/** Add or update a criterion. payload: { itemNo?, track?, data:{...} } */
function handleSaveDspmCriteria(p) {
  p = p || {};
  var d = p.data || {};
  var track = d.Track || p.track || 'Teacher';
  var sh = dcSheet_();
  var patch = {};
  DC_FIELDS.forEach(function (k) { if (d[k] !== undefined) patch[k] = d[k]; });
  if (patch.AgeFrom !== undefined) patch.AgeFrom = Number(patch.AgeFrom) || 0;
  if (patch.AgeTo !== undefined) patch.AgeTo = Number(patch.AgeTo) || 0;
  patch.Track = track;

  var key = (p.itemNo != null) ? p.itemNo : d.ItemNo;
  var row = (key != null) ? dcFind_(sh, key, track) : null;
  if (row) { updateRow_(sh, row._row, patch); dcBust_(); return { ok: true, itemNo: Number(row.ItemNo), updated: true }; }

  var itemNo = dcNextItemNo_(sh);
  appendObject_(sh, Object.assign({ ItemNo: itemNo }, patch));
  dcBust_();
  return { ok: true, itemNo: itemNo, updated: false };
}

/** Delete a criterion. payload: { itemNo, track? } */
function handleDeleteDspmCriteria(p) {
  p = p || {};
  var sh = dcSheet_();
  var row = dcFind_(sh, p.itemNo, p.track || 'Teacher');
  if (!row) throw apiError_('NOT_FOUND', 'ไม่พบเกณฑ์');
  sh.deleteRow(row._row); dcBust_();
  return { ok: true };
}
