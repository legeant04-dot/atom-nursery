/**
 * Repair.gs — one-time data repairs for id collisions. Admin-only (ADMIN_ONLY in Code.gs).
 *
 * Why this exists: the engine used to mint ids as `list.length + 1`. On a non-contiguous list (an
 * import, or after a delete) that REUSES an existing id — two parents ended up on PAR-056. Because
 * every lookup is find-FIRST-by-id, the admin edit form, saveParent, saveFamilyParent and
 * deleteParent would all act on the wrong person. Generation is now max+1 (nextSeqId_); this fixes
 * the rows that already collided.
 */

/**
 * READ-ONLY audit: are any ids duplicated? Scans the RAW sheets (so withdrawn/inactive rows are
 * included — a list endpoint filters those out and would hide a collision).
 */
function handleCheckDuplicateIds() {
  var targets = [
    { key: 'STUDENTS', wb: 'MAIN', id: 'StudentID', name: 'Name' },
    { key: 'PARENTS',  wb: 'MAIN', id: 'ParentID',  name: 'Name' },
    { key: 'STAFF',    wb: 'HR',   id: 'StaffID',   name: 'Name' }
  ];
  var out = {};
  targets.forEach(function (t) {
    var ss = (t.wb === 'HR') ? getHrSpreadsheet_() : getMainSpreadsheet_();
    var rows = readObjects_(sheet_(ss, t.key));
    var by = {};
    rows.forEach(function (r) { var id = String(r[t.id] || ''); (by[id] = by[id] || []).push(r); });
    var dups = [];
    Object.keys(by).forEach(function (id) {
      if (!id || by[id].length < 2) return;
      dups.push({ id: id, count: by[id].length, rows: by[id].map(function (r) { return { name: r[t.name] || r.NameEN || '', row: r._row, status: r.Status || '', line: r.LineUID ? 'yes' : '' }; }) });
    });
    var blank = rows.filter(function (r) { return !String(r[t.id] || ''); }).length;
    out[t.key] = { rows: rows.length, distinct: Object.keys(by).length, blankIds: blank, duplicates: dups };
  });
  return out;
}

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

/**
 * ---- Content-duplicate cleansing (same PERSON registered several times, each with a UNIQUE id) ----
 * The registration self-submit re-fired on a slow network, so PARENTS grew to ~98 and several
 * students appear 3–4×. These are NOT id collisions (checkDuplicateIds is clean) — the rows share an
 * identity but not an id. dedupData groups by identity and keeps ONE row per person:
 *   Parents  — keep the row that has a LINE login (LineUID); else the lowest id. Repoint STUDENTS.ParentID.
 *   Students — keep the row a parent/USER_LINK points to (ผูกกับผู้ปกครองแล้ว); else lowest id.
 *              Repoint PARENTS.StudentID + USER_LINKS.StudentID onto the keeper, then de-dup USER_LINKS.
 * dedupData({preview:true}) is READ-ONLY and returns the exact keep/delete plan; without preview it
 * applies it (admin-only; a daily backup + restoreSheet is the safety net).
 */
function dcpNormName_(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
function dcpDigits_(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }
function dcpYmd_(s) { return String(s == null ? '' : s).slice(0, 10); }
function dcpIdNum_(v, prefix) { var m = new RegExp('^' + prefix + '-?(\d+)$').exec(String(v || '')); return m ? parseInt(m[1], 10) : 1e9; }
function dcpParentKey_(r) { var nid = dcpDigits_(r.NationalID); return (nid ? 'nid:' + nid : 'np:' + dcpNormName_(r.Name || r.NameEN) + '|' + dcpDigits_(r.Phone)); }
function dcpStudentKey_(r) { return 'nd:' + dcpNormName_(r.Name || r.NameEN) + '|' + dcpYmd_(r.DOB); }

function dedupPlan_() {
  var main = getMainSpreadsheet_();
  var parents = readObjects_(sheet_(main, 'PARENTS'));
  var students = readObjects_(sheet_(main, 'STUDENTS'));
  var links = readObjects_(sheet_(main, 'USER_LINKS'));

  // a student is "linked" if any parent row or USER_LINK points at it
  var linkedSid = {};
  parents.forEach(function (p) { if (p.StudentID) linkedSid[String(p.StudentID)] = true; });
  links.forEach(function (l) { if (l.StudentID) linkedSid[String(l.StudentID)] = true; });

  // group parents
  var pg = {}; parents.forEach(function (r) { (pg[dcpParentKey_(r)] = pg[dcpParentKey_(r)] || []).push(r); });
  var parentPlan = [];
  Object.keys(pg).forEach(function (k) {
    var g = pg[k]; if (g.length < 2) return;
    var keep = g.filter(function (x) { return x.LineUID; }).sort(function (a, b) { return dcpIdNum_(a.ParentID, 'PAR') - dcpIdNum_(b.ParentID, 'PAR'); })[0]
            || g.slice().sort(function (a, b) { return dcpIdNum_(a.ParentID, 'PAR') - dcpIdNum_(b.ParentID, 'PAR'); })[0];
    parentPlan.push({ name: keep.Name || keep.NameEN, keepId: keep.ParentID, keepHasLine: !!keep.LineUID,
      dels: g.filter(function (x) { return x !== keep; }).map(function (d) { return { id: d.ParentID, row: d._row, hasLine: !!d.LineUID, studentId: d.StudentID }; }) });
  });

  // group students
  var sg = {}; students.forEach(function (r) { (sg[dcpStudentKey_(r)] = sg[dcpStudentKey_(r)] || []).push(r); });
  var studentPlan = [];
  Object.keys(sg).forEach(function (k) {
    var g = sg[k]; if (g.length < 2) return;
    var keep = g.filter(function (x) { return linkedSid[String(x.StudentID)]; }).sort(function (a, b) { return dcpIdNum_(a.StudentID, 'STD') - dcpIdNum_(b.StudentID, 'STD'); })[0]
            || g.slice().sort(function (a, b) { return dcpIdNum_(a.StudentID, 'STD') - dcpIdNum_(b.StudentID, 'STD'); })[0];
    studentPlan.push({ name: keep.Name || keep.NameEN, keepId: keep.StudentID, keepLinked: !!linkedSid[String(keep.StudentID)],
      dels: g.filter(function (x) { return x !== keep; }).map(function (d) { return { id: d.StudentID, row: d._row, linked: !!linkedSid[String(d.StudentID)] }; }) });
  });

  return {
    counts: { parents: parents.length, students: students.length },
    parentGroups: parentPlan, studentGroups: studentPlan,
    willDelete: { parents: parentPlan.reduce(function (n, g) { return n + g.dels.length; }, 0), students: studentPlan.reduce(function (n, g) { return n + g.dels.length; }, 0) }
  };
}

/** payload: { preview?:true } — admin-only (ADMIN_ONLY). */
function handleDedupData(p) {
  p = p || {};
  var plan = dedupPlan_();
  if (p.preview) return plan;

  var main = getMainSpreadsheet_();
  var pSh = sheet_(main, 'PARENTS'), stSh = sheet_(main, 'STUDENTS'), ulSh = sheet_(main, 'USER_LINKS');

  // ---- STUDENTS: repoint parent/link FKs onto the keeper, then delete duplicate student rows ----
  var studentDelRows = [];
  plan.studentGroups.forEach(function (g) {
    g.dels.forEach(function (d) {
      // PARENTS.StudentID: del -> keep
      readObjects_(pSh).forEach(function (pr) { if (String(pr.StudentID) === String(d.id)) updateRow_(pSh, pr._row, { StudentID: g.keepId }); });
      // USER_LINKS.StudentID: del -> keep
      readObjects_(ulSh).forEach(function (l) { if (String(l.StudentID) === String(d.id)) updateRow_(ulSh, l._row, { StudentID: g.keepId }); });
      studentDelRows.push(d.row);
    });
  });

  // ---- PARENTS: repoint STUDENTS.ParentID onto the keeper, then delete duplicate parent rows ----
  var parentDelRows = [];
  plan.parentGroups.forEach(function (g) {
    g.dels.forEach(function (d) {
      readObjects_(stSh).forEach(function (s) { if (String(s.ParentID) === String(d.id)) updateRow_(stSh, s._row, { ParentID: g.keepId }); });
      parentDelRows.push(d.row);
    });
  });

  // delete bottom-up so earlier deletions don't shift the rows still to remove
  studentDelRows.sort(function (a, b) { return b - a; }).forEach(function (r) { stSh.deleteRow(r); });
  parentDelRows.sort(function (a, b) { return b - a; }).forEach(function (r) { pSh.deleteRow(r); });

  // ---- de-dup USER_LINKS (repointing above can leave two identical UID+StudentID rows) ----
  var seen = {}, ulDel = [];
  readObjects_(ulSh).forEach(function (l) { var k = String(l.UserUID) + '|' + String(l.StudentID); if (seen[k]) ulDel.push(l._row); else seen[k] = 1; });
  ulDel.sort(function (a, b) { return b - a; }).forEach(function (r) { ulSh.deleteRow(r); });

  if (typeof cacheDel_ === 'function') { ['PARENTS', 'STUDENTS', 'USER_LINKS'].forEach(function (n) { cacheDel_('col:' + n); cacheDel_('rows:' + n); }); }
  try { CacheService.getScriptCache().removeAll(['rows:PARENTS', 'col:PARENTS', 'rows:STUDENTS', 'col:STUDENTS', 'rows:USER_LINKS', 'col:USER_LINKS']); } catch (e) {}
  return { ok: true, deleted: { parents: parentDelRows.length, students: studentDelRows.length, userLinks: ulDel.length } };
}
