# ใบงาน: รวบ / ตัด / เพิ่ม / จัดใหม่ — ฟังก์ชันทั้งระบบ

> สร้างด้วย `node tools/audit_functions.js --md docs/FUNCTION_REVIEW.md` — อ่านจากโค้ดจริง
> **เอกสารนี้หาหลักฐานให้ ไม่ได้ตัดสินแทน** — ทุกบรรทัดในหมวด ① ต้องตรวจมือก่อนตัด

```
  route ทั้งหมด            372   (engine 328 · server 175)
  ถูกเรียกตรงๆ จากหน้าจอ    324
  มีชื่ออยู่ในโค้ดหน้าบ้าน      338
  🔒 ปิดทางเข้าไปแล้ว         21   (CLOSED_ROUTES_ ใน src/Code.gs · มีเหตุผลกำกับทุกตัว)
  🔴 ยังไม่พบชื่อในหน้าบ้าน    13   ← ตัวเลขที่ต้องตรวจมือทุกตัวก่อนตัด

──── ① ไม่มีหน้าจอไหนเรียกถึง (13) ────
  🔴 "ไม่มีใครเรียก" ไม่ได้แปลว่า "ไม่มีใครใช้" — ตรวจมือทุกตัวก่อนเสมอ
  ตัวอย่างที่ตรวจแล้วในรอบแรก:
    · adminInbox      ใช้อยู่จริง — handleNotifications() เรียกเองฝั่งเซิร์ฟเวอร์ สำหรับ Role แอดมิน
    · staffAuth/restoreSheet/listBackups  เครื่องมือฉุกเฉินและงานเบื้องหลัง
    · saveParentSelf  ไม่มีหน้าจอไหนใช้จริง (ยืนยันแล้วตอนตรวจระบบ v466)
  👉 สิ่งที่ "ตัด" ได้คือ **การเปิดเป็น route** ไม่ใช่ตัวฟังก์ชัน — route ที่ไม่มีใครเรียก
     คือพื้นที่โจมตีที่ต้องตอบคำถามเรื่องสิทธิ์ และเป็นภาระของ Operation System ต่อไป
    · checkDuplicateIds
    · demoReset
    · endedStaff
    · lineDiag
    · listBackups
    · orphanLinks
    · parentDue
    · parentHomeCore
    · permissions
    · reindexParents
    · restoreSheet
    · staffingByNursery
    · startingStudents

──── ② มีชื่ออยู่ แต่ไม่ได้ถูกเรียกแบบปกติ (14) ────
  ส่วนใหญ่คือของที่เรียกผ่านตัวช่วย เช่น punchWithRetry หรืออยู่ในรายการ batch
    · batch   (พบชื่อ 3 ที่)
    · calendar   (พบชื่อ 1 ที่)
    · changePassword   (พบชื่อ 1 ที่)
    · dspmCriteria   (พบชื่อ 3 ที่)
    · markInboxRead   (พบชื่อ 1 ที่)
    · moveStudent   (พบชื่อ 1 ที่)
    · pendingLeaves   (พบชื่อ 1 ที่)
    · perfLog   (พบชื่อ 4 ที่)
    · ping   (พบชื่อ 1 ที่)
    · registerNew   (พบชื่อ 1 ที่)
    · reindexAnnouncements   (พบชื่อ 1 ที่)
    · staffCheckin   (พบชื่อ 2 ที่)
    · staffCheckout   (พบชื่อ 2 ที่)
    · studentLeaves   (พบชื่อ 4 ที่)

──── ③ ตระกูลชื่อที่อาจรวบเป็นชุดเดียวได้ ────
    save*  ×24  →  saveAttendanceSince, saveCertAsset, saveCertText, saveDspmCriteria, saveFamilyParent, saveFoodItem, saveFoodMenu, saveInsuranceAdmin, saveLineRecipients, saveOtWaiveDays, saveParent, saveParentComment, saveParentSelf, savePlans, savePrepayTiers, saveQRCodes, saveSlipOk, saveStaff, saveStaffSelf, saveStudent, saveStudentSelf, saveSurvey, saveTeacherReply, saveVaccines
    set*  ×16  →  setAbsenceFollowup, setConfigVal, setLeaveQuota, setPayrollConfig, setPerm, setRequireCheckin, setSchoolConfig, setStaffEnd, setStaffGroupHours, setStaffPause, setStudentEnd, setStudentPause, setStudentTerm, setSurveyStatus, setTimezone, setVaccine
    delete*  ×15  →  deleteAnnouncement, deleteBill, deleteDspmCriteria, deleteFoodItem, deleteGrowth, deleteInjury, deleteParent, deletePayrollRow, deletePerfLog, deleteSlip, deleteStaff, deleteStaffGroup, deleteStudentLeave, deleteStudentLeaves, deleteSurvey
    student*  ×15  →  studentAbsence, studentAlerts, studentAllBands, studentAssessment, studentBillBase, studentCharges, studentCheckinHistory, studentLeaves, studentLinkedParents, studentMonthReport, studentOtList, studentProfile, studentReportCard, studentTerms, studentVaccines
    staff*  ×12  →  staffAttendanceMonth, staffAuth, staffCheckin, staffCheckinLog, staffCheckout, staffLeaveSummary, staffMissingCheckout, staffMonthlyOT, staffPerformance, staffPerformanceAll, staffSelf, staffStudentCheckin
    admin*  ×11  →  adminAddHolidayOT, adminAddOT, adminCancelOT, adminDeleteOT, adminEditOT, adminInbox, adminOTList, adminResetPassword, adminRestoreOT, adminTodo, adminUpdateOT
    parent*  ×11  →  parentCancelLeave, parentCheckin, parentChildren, parentDue, parentEditLeave, parentHome, parentHomeCore, parentKidsMap, parentLinkCounts, parentLinkDetail, parentLinkedStudents
    add*  ×9  →  addAnnouncement, addBigCleaning, addChildNew, addComment, addDepartment, addHoliday, addStaffGroup, addStudentByAdmin, addStudentCharge
    edit*  ×9  →  editAnnouncement, editGrowth, editHoliday, editInjury, editLeave, editPrepay, editStaffAttendance, editStudentAttendance, editStudentLeave
    list*  ×9  →  listBackups, listClasses, listDepartments, listExportedStudents, listParents, listStaff, listStaffGroups, listStudents, listWithdrawals
    submit*  ×9  →  submitAssessment, submitClassChange, submitInjury, submitInsurance, submitJournal, submitJournalsMany, submitLeave, submitSurvey, submitTimeRequest
    get*  ×8  →  getConfig, getConfigVal, getJournal, getLeaveQuota, getPayslip, getPlans, getQRCodes, getStaffPassword
    pay*  ×6  →  payAdjustHistory, payCharge, payCombined, payCombinedCash, payOT, payPrepay
    pending*  ×6  →  pendingAdminOT, pendingAdminTimeRequests, pendingClassChanges, pendingInjuries, pendingLeaves, pendingPayments
    remove*  ×6  →  removeBigCleaning, removeDepartment, removeHoliday, removeStudent, removeStudentCharge, removeVaccine
    approve*  ×5  →  approveInjury, approveLeave, approveOT, approvePayslip, approveTimeRequest
    class*  ×5  →  classAssessment, classCoverAdd, classCoverList, classCoverRemove, classList
    holiday*  ×5  →  holidayAttendAdd, holidayAttendList, holidayAttendRemove, holidayAttendSet, holidayDateCheck
    line*  ×5  →  lineDiag, lineExchange, lineLoginReady, lineRecipients, lineUsage
    confirm*  ×4  →  confirmOT, confirmPayment, confirmSlip, confirmTimeRequest
    dspm*  ×4  →  dspmAllCriteria, dspmCriteria, dspmManual, dspmStatus
    injury*  ×4  →  injuryAlerts, injuryReport, injuryReports, injurySummary
    insurance*  ×4  →  insuranceExport, insuranceList, insuranceOptions, insuranceStatus
    mark*  ×4  →  markCertIssued, markInboxRead, markNotifsRead, markSalaryPaid
    teacher*  ×4  →  teacherClassAttendance, teacherPayOT, teacherStudentLeave, teacherStudentOtList
    team*  ×4  →  teamLeaveHistory, teamPendingLeaves, teamPendingOT, teamPendingTimeRequests

──── ④ หน้าจอที่หนักที่สุด (ปุ่ม + กล่อง) ────
    Admin.manage        ปุ่ม 243 · กล่อง 149 · ข้อมูล 160
    Admin.finance       ปุ่ม  36 · กล่อง  16 · ข้อมูล 33
    Admin.home          ปุ่ม  29 · กล่อง  17 · ข้อมูล 34
    Teacher.home        ปุ่ม  31 · กล่อง  14 · ข้อมูล 33
    Parent.home         ปุ่ม  23 · กล่อง   9 · ข้อมูล 15
    Teacher.class       ปุ่ม  21 · กล่อง   6 · ข้อมูล 12
    Admin.leaves        ปุ่ม  18 · กล่อง   8 · ข้อมูล 23
    Admin.payroll       ปุ่ม  18 · กล่อง   7 · ข้อมูล 15

──── ⑤ หน้าจอบาง — อาจยุบรวมกับหน้าอื่น ────
    Parent.checkin      ข้อมูล 0
    Parent.journal      ข้อมูล 6
    Parent.growth       ข้อมูล 4
    Parent.dspm         ข้อมูล 3
    Parent.chat         ข้อมูล 0
    Teacher.journal     ข้อมูล 3
    Admin.injuries      ข้อมูล 2
    Teacher.dspm        ข้อมูล 3
    Admin.dspm          ข้อมูล 3
    Admin.verify        ข้อมูล 1
    Teacher.absence     ข้อมูล 0
    Admin.absence       ข้อมูล 0
    Admin.chat          ข้อมูล 0

──── ⑥ route ที่มีที่เรียกเพียงแห่งเดียว (143) ────
  ไม่ใช่ปัญหาในตัวเอง — แต่เป็นรายการที่ย้ายไปอยู่กับหน้าที่ใช้มันได้ ถ้าจะแตกเป็นโมดูล
    absenceFollowupLog, absenceReport, absenceWatchCount, activeAnnouncements, activityLog, addChildNew, addComment, addStaffGroup, addStudentByAdmin, adjustStaffPay, adminTodo, approvePayslip, attendanceAudit, attendanceSince, authDiag, billRunLast, cancelStudentTerm, certAssets, certStudents, changeStaffPassword, checkStaffPassword, claimParent, classAssessment, classCoverAdd, classCoverRemove, confirmPayment, dailyReport, deleteFoodItem, deleteGrowth, deleteParent, deletePayrollRow, deletePerfLog, deleteStaff, deleteStaffGroup, deleteSurvey, demoLogin, demoStatus, diagDay, dspmAllCriteria, editGrowth, editPrepay, editStaffAttendance, exportManifest, exportStudent, exportTable, familyProfile, financeTrend, foodMenu, foodPhotos, geoCheck, getStaffPassword, googleExchange, googleLoginReady, growthDue, holidayAttendAdd, injuryAlerts, injurySummary, insuranceExport, insuranceList, leaderParents, leaveQuota, leaveResetReminder, lineExchange, lineRecipients, lineUsage, linkExisting, linkParentAdmin, listClasses, listWithdrawals, markCertIssued, mealSlots, myAttendanceToday, myClassChanges, myClassCover, myHolidayOTNext, myPayslipMonths, myTimeRequests, onboardingCheck, openSurveys, otVerification, parentCancelLeave, parentEditLeave, pausedStudents, payAdjustHistory, payrollDuplicates, payrollReminderDue, pendingAdminTimeRequests, pendingClassChanges, perfSummary, prepayAudit, recallJournalsMany, recomputeAttendance, registerParent, reinstallTriggers, rejectPayment, removeStudent, requestPasswordReset, requestWithdrawal, saveAttendanceSince, saveCertText, saveFoodMenu, saveInsuranceAdmin, saveLineRecipients, saveParent, saveParentComment, saveStaffSelf, saveStudentSelf, saveSurvey, saveTeacherReply, saveVaccines, seedFoodItems, setAbsenceFollowup, setConfigVal, setPerm, setStaffGroupHours, setStudentTerm, setSurveyStatus, setTimezone, slipDiag, staffCheckinLog, staffLeaveSummary, staffMissingCheckout, staffPerformance, staffPerformanceAll, studentLinkedParents, studentMonthReport, studentOtList, studentProfile, studentReportCard, studentTerms, submitInsurance, submitJournalsMany, submitSurvey, surveyResults, surveySummary, teacherClassAttendance, teacherPayOT, teacherStudentOtList, teamLeaveHistory, teamPendingOT, tzDiag, undoBillRun, verifySlip

```
