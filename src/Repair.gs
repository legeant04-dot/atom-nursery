/**
 * Repair.gs — one-time data repairs for id collisions. Admin-only (ADMIN_ONLY in Code.gs).
 *
 * Why this exists: the engine used to mint ids as `list.length + 1`. On a non-contiguous list (an
 * import, or after a delete) that REUSES an existing id — two parents ended up on PAR-056. Because
 * every lookup is find-FIRST-by-id, the admin edit form, saveParent, saveFamilyParent and
 * deleteParent would all act on the wrong person. Generation is now max+1 (nextSeqId_); this fixes
 * the rows that already collided.
 */

/** Renumber duplicate ParentIDs. payload: { preview?:true } */
function handleReindexParents(p) {
  p = p || {};
  var sh = sheet_(getMainSpreadsheet_(), 'PARENTS');
  var rows = readObjects_(sh);

  var byId = {};
  rows.forEach(function (r) { var id = String(r.ParentID || ''); (byId[id] = byId[id] || []).push(r); });

  var max = 0;
  rows.forEach(function (r) { var m = /^PAR-?(\d+)$/.exec(String(r.ParentID || '')); if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; } });

  var next = max + 1, planned = [];
  Object.keys(byId).forEach(function (id) {
    var group = byId[id];
    if (!id || group.length < 2) return;
    // Keep the row that owns a LINE login — its session/linkedId already points at this id, and
    // handleAuth resolves by LineUID. Renumber the others (nothing authenticates as them).
    var keepIdx = 0;
    for (var i = 0; i < group.length; i++) { if (group[i].LineUID) { keepIdx = i; break; } }
    group.forEach(function (r, i) {
      if (i === keepIdx) return;
      var nid = 'PAR-' + ('00' + (next++)).slice(-3);
      planned.push({ row: r._row, was: id, now: nid, name: r.Name || r.NameEN || '', studentId: r.StudentID || '' });
    });
    planned.push({ row: group[keepIdx]._row, was: id, now: id, name: group[keepIdx].Name || '', studentId: group[keepIdx].StudentID || '', kept: true, reason: group[keepIdx].LineUID ? 'has LINE login' : 'first row' });
  });

  if (p.preview) return { preview: true, duplicates: planned.length, planned: planned };

  var fixed = [];
  planned.forEach(function (c) {
    if (c.kept) return;
    updateRow_(sh, c.row, { ParentID: c.now });
    fixed.push({ was: c.was, now: c.now, name: c.name, studentId: c.studentId });
  });
  if (typeof cacheDel_ === 'function') { cacheDel_('col:PARENTS'); cacheDel_('rows:PARENTS'); }
  return { ok: true, fixed: fixed };
}
