/**
 * Dspm.gs — Day 5: DSPM Assessment (pass/fail by age) + analytics
 * ------------------------------------------------------------------
 * Teachers record ผ่าน/ไม่ผ่าน for each criteria item matching the
 * child's age band (Teacher track). Results go to DSPM_ASSESSMENT and
 * are summarised per student / per class for Admin analysis.
 *
 * Assessment DETAILS (วิธีประเมิน/เกณฑ์ผ่าน) are NOT stored here — the
 * teacher downloads the full ministry manual PDF (see dspmManual).
 * ------------------------------------------------------------------
 */
var DOMAINS = ['GM', 'FM', 'RL', 'EL', 'PS'];
var DOMAIN_TH = { GM: 'การเคลื่อนไหว', FM: 'กล้ามเนื้อมัดเล็กและสติปัญญา', RL: 'การเข้าใจภาษา', EL: 'การใช้ภาษา', PS: 'การช่วยเหลือตัวเองและสังคม' };

/** Whole months between dob and asOf (default now). */
function ageMonths_(dob, asOf) {
  var d = new Date(dob), now = asOf ? new Date(asOf) : new Date();
  if (isNaN(d)) return null;
  var m = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) m--;        // not yet reached the day-of-month
  return Math.max(0, m);
}

function getStudent_(studentId) {
  var s = findObject_(sheet_(getMainSpreadsheet_(), 'STUDENTS'),
    function (r) { return String(r.StudentID) === String(studentId); });
  if (!s) throw apiError_('STUDENT_NOT_FOUND', 'ไม่พบข้อมูลนักเรียน');
  return s;
}

/** Drive download URL for the DSPM manual PDF (or '' if not configured). */
function getDspmManualLink_() {
  var id = getConfig_('DspmManualFileId', '');
  if (!id || String(id).indexOf('<FILL') === 0) return '';
  return 'https://drive.google.com/uc?export=download&id=' + id;
}

/** doGet/doPost action: manual download link. */
function handleDspmManual() {
  var url = getDspmManualLink_();
  if (!url) throw apiError_('NO_MANUAL', 'ยังไม่ได้ตั้งค่าไฟล์คู่มือ DSPM (DspmManualFileId)');
  return { url: url };
}

/**
 * Criteria for a child's current age band.
 * payload: { studentId } or { ageMonth }, optional { track } (default Teacher)
 */
function handleDspmCriteria(payload) {
  payload = payload || {};
  var track = payload.track || 'Teacher';
  var age = (payload.ageMonth != null) ? parseInt(payload.ageMonth, 10) : null;
  var student = null;
  if (age == null && payload.studentId) {
    student = getStudent_(payload.studentId);
    age = ageMonths_(student.DOB);
  }
  if (age == null) throw apiError_('NO_AGE', 'ต้องระบุ studentId (ที่มี DOB) หรือ ageMonth');

  var rows = readObjects_(sheet_(getMainSpreadsheet_(), 'DSPM_CRITERIA')).filter(function (r) {
    return String(r.Track) === track &&
           Number(r.AgeFrom) <= age && age <= Number(r.AgeTo);
  });
  if (!rows.length) {
    throw apiError_('NO_CRITERIA', 'ยังไม่มีเกณฑ์ DSPM สำหรับอายุ ' + age + ' เดือน (ตรวจว่านำเข้า DSPM_CRITERIA แล้ว)');
  }
  rows.sort(function (a, b) { return Number(a.ItemNo) - Number(b.ItemNo); });
  return {
    studentId: student ? student.StudentID : null,
    ageMonth: age,
    ageLabel: rows[0].AgeLabelTH,
    manualUrl: getDspmManualLink_(),
    items: rows.map(function (r) {
      return { itemNo: Number(r.ItemNo), skill: r.Skill, skillTH: DOMAIN_TH[r.Skill] || r.Skill, description: r.Description };
    })
  };
}

/**
 * Record assessment results.
 * payload: { studentId, staffId|lineUid, date?, results: [{itemNo, result}] }
 *   result accepts: 'pass'|'fail'|'ผ่าน'|'ไม่ผ่าน'
 */
function handleSubmitAssessment(payload) {
  payload = payload || {};
  var teacher = resolveStaff_(payload);
  var student = getStudent_(payload.studentId);
  if (!Array.isArray(payload.results) || !payload.results.length) {
    throw apiError_('BAD_INPUT', 'ต้องระบุผลการประเมิน (results)');
  }
  var age = ageMonths_(student.DOB);
  var date = payload.date || dateStr_(new Date());
  var sheet = sheet_(getMainSpreadsheet_(), 'DSPM_ASSESSMENT');

  // skill lookup by ItemNo from DSPM_CRITERIA
  var skillByItem = {};
  readObjects_(sheet_(getMainSpreadsheet_(), 'DSPM_CRITERIA')).forEach(function (r) { skillByItem[String(r.ItemNo)] = r.Skill; });

  var assessmentId = nextId_(sheet, 'AssessmentID', 'DA'); // one id per submission session
  var saved = 0;
  payload.results.forEach(function (res) {
    var norm = (String(res.result) === 'pass' || String(res.result) === 'ผ่าน') ? 'ผ่าน'
             : (String(res.result) === 'fail' || String(res.result) === 'ไม่ผ่าน') ? 'ไม่ผ่าน'
             : (String(res.result) === 'notenrolled' || String(res.result) === 'ยังไม่เข้าโรงเรียน') ? 'ยังไม่เข้าโรงเรียน' : null;
    if (norm == null) return; // skip unanswered
    appendObject_(sheet, {
      AssessmentID: assessmentId, StudentID: student.StudentID, AgeMonth: age,
      ItemNo: res.itemNo, Skill: skillByItem[String(res.itemNo)] || '', Result: norm,
      Date: date, TeacherID: teacher.StaffID
    });
    saved++;
  });
  logAudit(teacher.StaffID, 'DSPM_ASSESS', 'DSPM_ASSESSMENT', assessmentId);

  // notify parent
  if (student.ParentID) {
    var parent = findObject_(sheet_(getMainSpreadsheet_(), 'PARENTS'),
      function (p) { return String(p.ParentID) === String(student.ParentID); });
    if (parent && parent.LineUID && parentLineOn_()) {   // routine — see parentLineOn_ in Line.gs
      linePushText_(parent.LineUID, '📝 บันทึกผลประเมินพัฒนาการ (DSPM) ของ ' + student.Name + ' เรียบร้อยแล้ว (' + saved + ' ข้อ)');
    }
  }
  return { assessmentId: assessmentId, studentId: student.StudentID, ageMonth: age, saved: saved };
}

/** Per-student summary: latest result per item + pass/fail counts by domain. */
function handleStudentAssessment(payload) {
  payload = payload || {};
  var student = getStudent_(payload.studentId);
  var rows = readObjects_(sheet_(getMainSpreadsheet_(), 'DSPM_ASSESSMENT'))
    .filter(function (r) { return String(r.StudentID) === String(student.StudentID); });

  // latest record per ItemNo (by Date)
  var latest = {};
  rows.forEach(function (r) {
    var k = String(r.ItemNo);
    if (!latest[k] || new Date(r.Date) >= new Date(latest[k].Date)) latest[k] = r;
  });

  var byDomain = {};
  DOMAINS.forEach(function (d) { byDomain[d] = { pass: 0, fail: 0 }; });
  Object.keys(latest).forEach(function (k) {
    var r = latest[k], d = r.Skill;
    if (r.Result !== 'ผ่าน' && r.Result !== 'ไม่ผ่าน') return;   // 'ยังไม่เข้าโรงเรียน' etc. not counted
    if (byDomain[d]) byDomain[d][r.Result === 'ผ่าน' ? 'pass' : 'fail']++;
  });
  var totalPass = 0, totalFail = 0;
  DOMAINS.forEach(function (d) { totalPass += byDomain[d].pass; totalFail += byDomain[d].fail; });

  return {
    studentId: student.StudentID, name: student.Name, ageMonth: ageMonths_(student.DOB),
    byDomain: byDomain, totalPass: totalPass, totalFail: totalFail,
    items: Object.keys(latest).map(function (k) {
      return { itemNo: Number(k), skill: latest[k].Skill, result: latest[k].Result, date: latest[k].Date };
    }).sort(function (a, b) { return a.itemNo - b.itemNo; })
  };
}

/** Per-class analytics for Admin: pass rate by domain + per-student totals. */
/**
 * DEAD — no longer routed. This shadowed the shared engine's classAssessment and returned a
 * different shape: only s.Name (so the nickname never reached the screen), no per-child "assessed"
 * flag, no coverage figure, and no filtering of withdrawn / paused / not-yet-started children. Every
 * improvement made in the engine was therefore invisible on live. Kept only for reference; the
 * engine version in Engine.gs is the one that runs. Do not re-route this without porting it.
 */
function handleClassAssessment(payload) {
  payload = payload || {};
  var students = readObjects_(sheet_(getMainSpreadsheet_(), 'STUDENTS')).filter(function (s) {
    return String(s.Class) === String(payload.classId) || String(s.Class) === String(payload.className);
  });
  if (!students.length) throw apiError_('NO_STUDENTS', 'ไม่พบนักเรียนในชั้นเรียนนี้');

  var classTotal = { pass: 0, fail: 0 };
  var byDomain = {};
  DOMAINS.forEach(function (d) { byDomain[d] = { pass: 0, fail: 0 }; });
  var perStudent = students.map(function (s) {
    var sum = handleStudentAssessment({ studentId: s.StudentID });
    classTotal.pass += sum.totalPass; classTotal.fail += sum.totalFail;
    DOMAINS.forEach(function (d) { byDomain[d].pass += sum.byDomain[d].pass; byDomain[d].fail += sum.byDomain[d].fail; });
    return { studentId: s.StudentID, name: s.Name, ageMonth: sum.ageMonth, pass: sum.totalPass, fail: sum.totalFail };
  });
  var denom = classTotal.pass + classTotal.fail;
  return {
    class: payload.className || payload.classId,
    studentCount: students.length,
    passRate: denom ? Math.round(classTotal.pass / denom * 100) : 0,
    byDomain: byDomain, perStudent: perStudent
  };
}
