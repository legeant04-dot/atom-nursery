/**
 * Journal.gs — Day 5: Daily Journal (Atom Nursery Journal Form)
 * ------------------------------------------------------------------
 * Teacher fills the daily report; parent is notified via LINE and can
 * view it. One entry per student per day (re-submitting updates it).
 *
 * DAILY_JOURNAL columns: Date, StudentID, TeacherID, Mood, Health,
 * Milk, Meals, Sleep, Toilet, Activity, Skills, Highlight.
 * Structured fields (Milk/Meals/Sleep/Activity/Skills) may be passed as
 * objects/arrays — they are stored as JSON text in the cell.
 * ------------------------------------------------------------------
 */
var JOURNAL_FIELDS = ['Mood', 'Health', 'Milk', 'MilkTimes', 'Meals', 'MealItems', 'Sleep', 'Toilet', 'Activity', 'Skills', 'Highlight',
  'HealthDetail', 'MilkTotal', 'Water', 'Theme', 'MilkUnit',
  // the day's pictures. appendObject_/updateRow_ hand Photo1..3 to Drive on the way in (IMAGE_COLS_),
  // so what lands in the cell is a URL, never the base64 the phone sent.
  'Photo1', 'Photo2', 'Photo3'];
var JOURNAL_REQUIRED = ['Mood']; // minimum to submit (spec: block submit if required missing)

/**
 * ONE JOURNAL ROW, WITHOUT READING THE WHOLE SHEET.
 *
 * Reported 2026-09-22 from the staff group: "เวลาบันทึกรายวันโหลดช้ามากค่ะ บางช่วงก็กดบันทึกไม่ได้
 * เป็นทุกวันเลยค่ะ", with a screenshot of the spinner sitting on the form.
 *
 * Every one of the five journal handlers below located its row with
 *     findObject_(sheet, r => r.StudentID === … && dateStr_(new Date(r.Date)) === date)
 * and findObject_ calls readObjects_, which reads the ENTIRE sheet: 26 columns × every row ever
 * written, 1.1MB of it, to find one row the teacher is about to overwrite. That is the same cost the
 * READS were paying before v396 — the write path simply never got looked at, because it does not go
 * through readCollection_ and so was never cached either. It is paid on every ✏️ บันทึกร่าง, every
 * 📤 ส่งให้ผู้ปกครอง, every parent comment and every teacher reply.
 *
 * This reads the two INDEX COLUMNS only (Date and StudentID — two columns, not twenty-six) to find
 * the row number, then reads that ONE row in full. Same object back, `_row` and all, so every caller
 * is unchanged and updateRow_ still writes exactly where it did.
 *
 * FIRST MATCH, SCANNING FORWARD — deliberately identical to findObject_. If two rows ever existed
 * for one student and one day, the same one must win as before; this is a speed change and nothing
 * else. Anything unexpected about the sheet (no headers, missing columns) falls back to the original
 * scan, because being unable to take the fast path must never mean failing to find the row.
 */
function findJournalRow_(sheet, studentId, date) {
  var last = sheet.getLastRow(), hdr = headers_(sheet);
  var dc = hdr.indexOf('Date') + 1, sc = hdr.indexOf('StudentID') + 1;
  if (last < 2 || !hdr.length || !dc || !sc) {
    return findObject_(sheet, function (r) {
      return String(r.StudentID) === String(studentId) && dateStr_(new Date(r.Date)) === date;
    });
  }
  // one range covering both index columns, whatever order they sit in
  var lo = Math.min(dc, sc), hi = Math.max(dc, sc);
  var idx = sheet.getRange(2, lo, last - 1, hi - lo + 1).getValues();
  var di = dc - lo, si = sc - lo, sid = String(studentId);
  for (var i = 0; i < idx.length; i++) {
    if (String(idx[i][si]) !== sid) continue;
    var dv = idx[i][di];
    if (dv === '' || dv == null) continue;              // a blank date cannot be the day we want
    var ds; try { ds = dateStr_(new Date(dv)); } catch (e) { continue; }
    if (ds !== date) continue;
    var rowNum = i + 2;
    var vals = sheet.getRange(rowNum, 1, 1, hdr.length).getValues()[0];
    var o = {};
    hdr.forEach(function (h, c) { o[h] = vals[c]; });
    // non-enumerable, exactly as readObjects_ builds it — callers pass o._row to updateRow_
    Object.defineProperty(o, '_row', { value: rowNum, enumerable: false });
    return o;
  }
  return null;
}

/**
 * WAS THIS CHILD CHECKED IN ON THIS DAY — the other full-sheet read on the same save.
 *
 * handleSubmitJournal asked it with readObjects_(CHECKIN_STUDENT).some(...), which builds an object
 * for every check-in and check-out the school has ever recorded — 443KB measured on 2026-09-22 — to
 * answer one yes/no. Together with the journal scan above, saving one daily report was reading about
 * 1.5MB of spreadsheet before it wrote a single cell.
 *
 * Same treatment: the three columns that decide it (Date, StudentID, Type), never the whole row.
 * Falls back to the original scan if the sheet is not the shape we expect — a lookup that cannot
 * take the fast path must still give the right answer, because the wrong one here blocks a teacher
 * from writing a journal for a child who IS at school.
 */
function studentCheckedInOn_(studentId, date) {
  var sheet = sheet_(getMainSpreadsheet_(), 'CHECKIN_STUDENT');
  var last = sheet.getLastRow(), hdr = headers_(sheet);
  var dc = hdr.indexOf('Date') + 1, sc = hdr.indexOf('StudentID') + 1, tc = hdr.indexOf('Type') + 1;
  if (last < 2 || !hdr.length || !dc || !sc || !tc) {
    return readObjects_(sheet).some(function (r) {
      return String(r.StudentID) === String(studentId) && dateStr_(new Date(r.Date)) === date &&
             String(r.Type).toUpperCase() === 'IN';
    });
  }
  var lo = Math.min(dc, sc, tc), hi = Math.max(dc, sc, tc);
  var idx = sheet.getRange(2, lo, last - 1, hi - lo + 1).getValues();
  var di = dc - lo, si = sc - lo, ti = tc - lo, sid = String(studentId);
  for (var i = 0; i < idx.length; i++) {
    if (String(idx[i][si]) !== sid) continue;
    if (String(idx[i][ti]).toUpperCase() !== 'IN') continue;
    var dv = idx[i][di];
    if (dv === '' || dv == null) continue;
    var ds; try { ds = dateStr_(new Date(dv)); } catch (e) { continue; }
    if (ds === date) return true;
  }
  return false;
}

function jsonCell_(v) {
  if (v === undefined || v === null) return '';
  return (typeof v === 'object') ? JSON.stringify(v) : v;
}
function parseCell_(v) {
  if (typeof v !== 'string' || !v) return v;
  var t = v.charAt(0);
  if (t === '{' || t === '[') { try { return JSON.parse(v); } catch (e) { return v; } }
  return v;
}

/** A blank Status is a legacy row written before the draft flow existed — it was already sent. */
function journalStatusOf_(row) {
  return String((row && row.Status) || '').toUpperCase() === 'DRAFT' ? 'DRAFT' : 'SUBMITTED';
}

/**
 * payload: { studentId, staffId|lineUid, date?, submit?, Mood, Health, Milk, Meals, Sleep, Toilet, ... }
 * submit=false (default) saves a DRAFT the teacher can keep editing; the parent is NOT notified.
 * submit=true sends it: the parent gets the LINE push and the entry is locked against further edits.
 */
function handleSubmitJournal(payload) {
  payload = payload || {};
  var teacher = resolveStaff_(payload);
  var student = getStudent_(payload.studentId);
  var submit = payload.submit === true || String(payload.submit) === 'true';

  var date = payload.date || dateStr_(new Date());
  // the daily journal can only be filled once the child has been checked IN that day (teacher must
  // confirm attendance first). Only enforced for today — back-filling a past day stays allowed.
  if (date === dateStr_(new Date())) {
    if (!studentCheckedInOn_(student.StudentID, date)) {
      throw apiError_('NOT_CHECKED_IN', 'ยังไม่ได้เช็คอินนักเรียนวันนี้ — กรุณาเช็คอินก่อนจึงจะบันทึกสมุดรายวันได้');
    }
  }
  var sheet = sheet_(getMainSpreadsheet_(), 'DAILY_JOURNAL');
  ensureColumns_(sheet, ['HealthDetail', 'MilkTotal', 'Water', 'Theme', 'SubmittedAt', 'Status', 'UpdatedAt', 'MilkUnit', 'ParentComment', 'TeacherReply', 'MealItems', 'MilkTimes', 'Photo1', 'Photo2', 'Photo3']);

  var existing = findJournalRow_(sheet, student.StudentID, date);
  // once sent to the parent the entry is final — the client hides the form, this is the real gate
  if (existing && journalStatusOf_(existing) === 'SUBMITTED') {
    throw apiError_('JOURNAL_LOCKED', 'บันทึกของวันที่ ' + date + ' ส่งให้ผู้ปกครองแล้ว แก้ไขไม่ได้');
  }
  // a draft may be incomplete; the required fields are only enforced when it is actually sent
  if (submit) {
    var missing = JOURNAL_REQUIRED.filter(function (f) {
      var v = payload[f];
      return v === undefined || v === null || String(v).trim() === '';
    });
    if (missing.length) throw apiError_('MISSING_FIELDS', 'กรุณากรอกข้อมูลที่จำเป็น: ' + missing.join(', '));
  }

  var now = dateStr_(new Date()) + ' ' + timeStr_(new Date());
  // keep the original author when someone else (an admin after unlocking) edits the entry
  var rec = { Date: date, StudentID: student.StudentID, TeacherID: (existing && existing.TeacherID) || teacher.StaffID,
    Status: submit ? 'SUBMITTED' : 'DRAFT', UpdatedAt: now, SubmittedAt: submit ? now : '' };
  JOURNAL_FIELDS.forEach(function (f) { rec[f] = jsonCell_(payload[f]); });

  if (existing) updateRow_(sheet, existing._row, rec);
  else appendObject_(sheet, rec);
  // in-place writes bypass writeRows_, which is what normally invalidates the sheet cache — flush it
  // here or the engine's journalStatus/getJournal serve a stale read for up to CacheTTL seconds.
  /* ...AND THE PER-DAY KEY (v396). Journals are now hydrated one day at a time (jrn:<date>), so
   * dropping only the whole-collection key would leave a teacher looking at a cached day that no
   * longer matches the sheet she just wrote to — the one place a stale cache is actually visible. */
  if (typeof cacheDel_ === 'function') { cacheDel_('col:DAILY_JOURNAL'); cacheDel_('rows:DAILY_JOURNAL'); cacheDel_('jrn:' + String(date).slice(0, 10)); }
  logAudit(teacher.StaffID, submit ? 'JOURNAL_SUBMIT' : 'JOURNAL_DRAFT', 'DAILY_JOURNAL', student.StudentID + '@' + date);

  // the parent hears about it only when the teacher submits — drafts stay internal
  if (submit && student.ParentID) {
    var parent = findObject_(sheet_(getMainSpreadsheet_(), 'PARENTS'),
      function (p) { return String(p.ParentID) === String(student.ParentID); });
    // one per child per school day — behind ParentLineNotify (see parentLineOn_ in Line.gs)
    if (parent && parent.LineUID && parentLineOn_()) {
      var liff = getConfig_('LiffID', '');
      var link = (liff && String(liff).indexOf('<FILL') !== 0)
        ? '\nดูรายละเอียด: https://liff.line.me/' + liff + '?view=journal&student=' + student.StudentID + '&date=' + date : '';
      linePushText_(parent.LineUID, '📒 บันทึกประจำวันของ ' + student.Name + ' พร้อมแล้ว (' + date + ')' + link);
    }
  }
  return { studentId: student.StudentID, date: date, updated: !!existing, submitted: submit,
    status: rec.Status, submittedAt: rec.SubmittedAt, updatedAt: rec.UpdatedAt };
}

/**
 * Admin-only: reopen a submitted entry so it can be corrected. It goes back to DRAFT, which means
 * it also disappears from the parent's view until it is submitted again. payload: { studentId, date? }
 * Admin-gated by ADMIN_ONLY in Code.gs applyIdentity_ — never call it from a teacher screen.
 */
function handleUnlockJournal(payload) {
  payload = payload || {};
  var student = getStudent_(payload.studentId);
  var date = payload.date || dateStr_(new Date());
  var sheet = sheet_(getMainSpreadsheet_(), 'DAILY_JOURNAL');
  ensureColumns_(sheet, ['HealthDetail', 'MilkTotal', 'Water', 'Theme', 'SubmittedAt', 'Status', 'UpdatedAt', 'MilkUnit', 'ParentComment', 'TeacherReply', 'MealItems', 'MilkTimes', 'Photo1', 'Photo2', 'Photo3']);
  var row = findJournalRow_(sheet, student.StudentID, date);
  if (!row) throw apiError_('NOT_FOUND', 'ยังไม่มีบันทึกของวันที่ ' + date);
  updateRow_(sheet, row._row, { Status: 'DRAFT', SubmittedAt: '' });
  /* ...AND THE PER-DAY KEY (v396). Journals are now hydrated one day at a time (jrn:<date>), so
   * dropping only the whole-collection key would leave a teacher looking at a cached day that no
   * longer matches the sheet she just wrote to — the one place a stale cache is actually visible. */
  if (typeof cacheDel_ === 'function') { cacheDel_('col:DAILY_JOURNAL'); cacheDel_('rows:DAILY_JOURNAL'); cacheDel_('jrn:' + String(date).slice(0, 10)); }
  logAudit(payload.staffId || payload.uid || 'ADMIN', 'JOURNAL_UNLOCK', 'DAILY_JOURNAL', student.StudentID + '@' + date);
  return { studentId: student.StudentID, date: date, status: 'DRAFT' };
}

/**
 * Parent adds/updates their comment on a daily report (in place — never touches the teacher's fields).
 * parentId/uid injected by applyIdentity_ + parentOwnsStudent_ gates access. payload: { studentId, date?, comment }
 */
function handleSaveParentComment(payload) {
  payload = payload || {};
  var student = getStudent_(payload.studentId);
  var date = payload.date || dateStr_(new Date());
  var sheet = sheet_(getMainSpreadsheet_(), 'DAILY_JOURNAL');
  ensureColumns_(sheet, ['MilkUnit', 'ParentComment', 'TeacherReply']);
  var row = findJournalRow_(sheet, student.StudentID, date);
  if (!row) throw apiError_('NOT_FOUND', 'ยังไม่มีบันทึกของวันที่ ' + date);
  updateRow_(sheet, row._row, { ParentComment: String(payload.comment || '') });
  /* ...AND THE PER-DAY KEY (v396). Journals are now hydrated one day at a time (jrn:<date>), so
   * dropping only the whole-collection key would leave a teacher looking at a cached day that no
   * longer matches the sheet she just wrote to — the one place a stale cache is actually visible. */
  if (typeof cacheDel_ === 'function') { cacheDel_('col:DAILY_JOURNAL'); cacheDel_('rows:DAILY_JOURNAL'); cacheDel_('jrn:' + String(date).slice(0, 10)); }
  // notify the class teacher(s) that a parent commented (falls back to the Admin inbox if no teacher LINE)
  try {
    notifyStudentTeacher_(student, '💬 ผู้ปกครองแสดงความคิดเห็นในบันทึกของ ' + (student.Nickname || student.Name) +
      ' (' + date + '):\n' + String(payload.comment || ''),
      { category: 'comment', ref: 'journal|' + student.StudentID + '|' + date });
  } catch (e) {}
  return { ok: true, studentId: student.StudentID, date: date };
}

/** Teacher replies to the parent's comment on a daily report → notify the parent(s). payload: { studentId, date, reply } */
function handleSaveTeacherReply(payload) {
  payload = payload || {};
  var student = getStudent_(payload.studentId);
  var date = payload.date || dateStr_(new Date());
  var sheet = sheet_(getMainSpreadsheet_(), 'DAILY_JOURNAL');
  ensureColumns_(sheet, ['ParentComment', 'TeacherReply']);
  var row = findJournalRow_(sheet, student.StudentID, date);
  if (!row) throw apiError_('NOT_FOUND', 'ยังไม่มีบันทึกของวันที่ ' + date);
  updateRow_(sheet, row._row, { TeacherReply: String(payload.reply || '') });
  /* ...AND THE PER-DAY KEY (v396). Journals are now hydrated one day at a time (jrn:<date>), so
   * dropping only the whole-collection key would leave a teacher looking at a cached day that no
   * longer matches the sheet she just wrote to — the one place a stale cache is actually visible. */
  if (typeof cacheDel_ === 'function') { cacheDel_('col:DAILY_JOURNAL'); cacheDel_('rows:DAILY_JOURNAL'); cacheDel_('jrn:' + String(date).slice(0, 10)); }
  try {
    notifyStudentParents_(student, '↩️ คุณครูตอบกลับความคิดเห็นในบันทึกของ ' + (student.Nickname || student.Name) +
      ' (' + date + '):\n' + String(payload.reply || ''));
  } catch (e) {}
  return { ok: true, studentId: student.StudentID, date: date };
}

/** payload: { studentId, date } */
function handleGetJournal(payload) {
  payload = payload || {};
  var student = getStudent_(payload.studentId);
  var date = payload.date || dateStr_(new Date());
  var row = findJournalRow_(sheet_(getMainSpreadsheet_(), 'DAILY_JOURNAL'), student.StudentID, date);
  if (!row) throw apiError_('NOT_FOUND', 'ยังไม่มีบันทึกของวันที่ ' + date);
  return journalView_(row, student);
}

/** payload: { studentId, limit? } — most recent entries first. */
function handleJournalHistory(payload) {
  payload = payload || {};
  var student = getStudent_(payload.studentId);
  var limit = payload.limit || 7;
  var rows = readObjects_(sheet_(getMainSpreadsheet_(), 'DAILY_JOURNAL'))
    .filter(function (r) { return String(r.StudentID) === String(student.StudentID); })
    .sort(function (a, b) { return new Date(b.Date) - new Date(a.Date); })
    .slice(0, limit);
  return { studentId: student.StudentID, name: student.Name, entries: rows.map(function (r) { return journalView_(r, student); }) };
}

function journalView_(row, student) {
  var out = { date: dateStr_(new Date(row.Date)), studentId: row.StudentID, teacherId: row.TeacherID };
  JOURNAL_FIELDS.forEach(function (f) { out[f.toLowerCase()] = parseCell_(row[f]); });
  return out;
}
