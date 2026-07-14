/**
 * Announce.gs — school announcements (admin CRUD), IN-PLACE so a save never rewrites the whole
 * ANNOUNCEMENTS collection, and AnnID is always UNIQUE (max existing +1, not length+1 which
 * collided after a delete → two rows shared an id → dismissing one hid the other's popup).
 * Priority (higher = more important) orders the parent popup. Reads defer to the engine.
 * Admin-only via ADMIN_ONLY in Code.gs. Image data: URLs are offloaded to Drive by appendObject_/updateRow_.
 */
function annStaffById_(id) {
  return findObject_(sheet_(getHrSpreadsheet_(), 'STAFF'), function (s) { return String(s.StaffID) === String(id); }) || {};
}
function annSheet_() {
  var sh = sheet_(getMainSpreadsheet_(), 'ANNOUNCEMENTS');
  ensureColumns_(sh, ['Popup', 'StartDate', 'EndDate', 'Priority']);
  return sh;
}
function annBust_() { if (typeof cacheDel_ === 'function') { cacheDel_('col:ANNOUNCEMENTS'); cacheDel_('rows:ANNOUNCEMENTS'); } }

/** payload: { title, titleEN?, content?, contentEN?, image?, popup?, startDate?, endDate?, priority?, type?, target? } */
function handleAddAnnouncement(p) {
  p = p || {};
  var sh = annSheet_();
  var id = nextId_(sh, 'AnnID', 'ANN', 1);
  var today = dateStr_(new Date());
  appendObject_(sh, {
    AnnID: id, Title: p.title || '', TitleEN: p.titleEN || '', Content: p.content || '', ContentEN: p.contentEN || '',
    Image: p.image || '', Date: today, Type: p.type || 'news', TargetGroup: p.target || 'all',
    Popup: !!p.popup, StartDate: p.startDate || today, EndDate: p.endDate || '', Priority: Number(p.priority) || 0
  });
  annBust_();
  return { AnnID: id };
}

/** payload: { annId, ...fields } — updates only the provided fields in place. */
function handleEditAnnouncement(p) {
  p = p || {};
  var sh = annSheet_();
  var r = findObject_(sh, function (x) { return String(x.AnnID) === String(p.annId); });
  if (!r) throw apiError_('NOT_FOUND', 'ไม่พบประกาศ');
  var patch = {};
  if (p.title != null) patch.Title = p.title;
  if (p.titleEN != null) patch.TitleEN = p.titleEN;
  if (p.content != null) patch.Content = p.content;
  if (p.contentEN != null) patch.ContentEN = p.contentEN;
  if (p.popup != null) patch.Popup = !!p.popup;
  if (p.startDate != null) patch.StartDate = p.startDate;
  if (p.endDate != null) patch.EndDate = p.endDate;
  if (p.priority != null) patch.Priority = Number(p.priority) || 0;
  if (p.image != null && p.image !== '') patch.Image = p.image;   // keep the existing image when blank
  updateRow_(sh, r._row, patch); annBust_();
  return { AnnID: r.AnnID };
}

/** payload: { annId } */
function handleDeleteAnnouncement(p) {
  p = p || {};
  var sh = annSheet_();
  var r = findObject_(sh, function (x) { return String(x.AnnID) === String(p.annId); });
  if (!r) throw apiError_('NOT_FOUND', 'ไม่พบประกาศ');
  sh.deleteRow(r._row); annBust_();
  return { ok: true };
}

/**
 * One-time repair: give EVERY announcement row a UNIQUE AnnID. Rows are renumbered from (current max
 * numeric id + 1) upward, so the new ids collide neither with each other nor with any id a user may
 * have previously dismissed (dismissing the old duplicate id was suppressing the popup). Admin-only.
 */
function handleReindexAnnouncements(p) {
  var sh = annSheet_();
  var rows = readObjects_(sh);
  var max = 0;
  rows.forEach(function (r) { var m = /^ANN-?(\d+)$/.exec(String(r.AnnID || '')); if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; } });
  var seen = {}, next = max + 1, fixed = [];
  rows.forEach(function (r) {
    var id = String(r.AnnID || '');
    if (!id || seen[id]) { var nid = 'ANN-' + (next++); updateRow_(sh, r._row, { AnnID: nid }); seen[nid] = 1; fixed.push({ was: id, now: nid }); }
    else { seen[id] = 1; }
  });
  annBust_();
  return { ok: true, fixed: fixed };
}
