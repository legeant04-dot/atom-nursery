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
var JOURNAL_FIELDS = ['Mood', 'Health', 'Milk', 'Meals', 'Sleep', 'Toilet', 'Activity', 'Skills', 'Highlight'];
var JOURNAL_REQUIRED = ['Mood']; // minimum to submit (spec: block submit if required missing)

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

/** payload: { studentId, staffId|lineUid, date?, Mood, Health, Milk, Meals, Sleep, Toilet, Activity, Skills, Highlight } */
function handleSubmitJournal(payload) {
  payload = payload || {};
  var teacher = resolveStaff_(payload);
  var student = getStudent_(payload.studentId);

  var missing = JOURNAL_REQUIRED.filter(function (f) {
    var v = payload[f];
    return v === undefined || v === null || String(v).trim() === '';
  });
  if (missing.length) throw apiError_('MISSING_FIELDS', 'กรุณากรอกข้อมูลที่จำเป็น: ' + missing.join(', '));

  var date = payload.date || dateStr_(new Date());
  var sheet = sheet_(getMainSpreadsheet_(), 'DAILY_JOURNAL');
  var rec = { Date: date, StudentID: student.StudentID, TeacherID: teacher.StaffID };
  JOURNAL_FIELDS.forEach(function (f) { rec[f] = jsonCell_(payload[f]); });

  var existing = findObject_(sheet, function (r) {
    return String(r.StudentID) === String(student.StudentID) && dateStr_(new Date(r.Date)) === date;
  });
  if (existing) updateRow_(sheet, existing._row, rec);
  else appendObject_(sheet, rec);
  logAudit(teacher.StaffID, existing ? 'JOURNAL_UPDATE' : 'JOURNAL_CREATE', 'DAILY_JOURNAL', student.StudentID + '@' + date);

  // notify parent with a deep link if LIFF is configured
  if (student.ParentID) {
    var parent = findObject_(sheet_(getMainSpreadsheet_(), 'PARENTS'),
      function (p) { return String(p.ParentID) === String(student.ParentID); });
    if (parent && parent.LineUID) {
      var liff = getConfig_('LiffID', '');
      var link = (liff && String(liff).indexOf('<FILL') !== 0)
        ? '\nดูรายละเอียด: https://liff.line.me/' + liff + '?view=journal&student=' + student.StudentID + '&date=' + date : '';
      linePushText_(parent.LineUID, '📒 บันทึกประจำวันของ ' + student.Name + ' พร้อมแล้ว (' + date + ')' + link);
    }
  }
  return { studentId: student.StudentID, date: date, updated: !!existing };
}

/** payload: { studentId, date } */
function handleGetJournal(payload) {
  payload = payload || {};
  var student = getStudent_(payload.studentId);
  var date = payload.date || dateStr_(new Date());
  var row = findObject_(sheet_(getMainSpreadsheet_(), 'DAILY_JOURNAL'), function (r) {
    return String(r.StudentID) === String(student.StudentID) && dateStr_(new Date(r.Date)) === date;
  });
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
