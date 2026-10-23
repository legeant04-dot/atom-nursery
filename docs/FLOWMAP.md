# แผนผังหน้าจอและข้อมูล (Flow map)

> สร้างด้วย `node tools/map_flows.js --md docs/FLOWMAP.md` — **อ่านจากโค้ดจริง ไม่ได้เขียนมือ**
> รันใหม่ได้ทุกครั้งที่แก้โค้ด แผนผังจึงไม่มีวันเก่ากว่าแอป

| | |
|---|---:|
| screens | 27 |
| roles | 3 |
| tabsPerRole | Parent 6 · Teacher 6 · Admin 6 · Observer 4 |
| navigationEdges | 37 |
| routesCalledByClient | 323 |
| routesOnServer | 175 |
| routesInEngine | 328 |
| adminOnlyRoutes | 133 |
| handlersFollowed | 445 |
| findings | 0 |

## Parent

แถบล่าง: `home` · `payment` · `journal` · `growth` · `dspm` · `chat`

| หน้า | บนแถบล่าง | ปุ่ม | กล่อง | ไปต่อได้ที่ไหน | ข้อมูลที่ขอ |
|---|:---:|---:|---:|---|---|
| **home** | 📌 | 23 | 9 | home, journal, payment | familyProfile, geoCheck, insuranceOptions, insuranceStatus, linkExisting, openSurveys, parentCancelLeave, parentChildren, parentEditLeave, parentHome, requestWithdrawal, saveFamilyParent, saveStudentSelf, studentAbsence, submitInsurance |
| **checkin** |  | 0 | 0 | journal | — |
| **payment** | 📌 | 3 | 0 | home | getPlans, getQRCodes, otDaily, parentChildren, paymentSlips, payments, prepayments, schoolConfig, studentCharges |
| **journal** | 📌 | 1 | 0 | home | getJournal, journalHistory, journalInjuries, parentChildren, schoolDay, studentCheckinHistory |
| **growth** | 📌 | 1 | 0 | home | growthHistory, parentChildren, studentVaccines, vaccineSchedule |
| **dspm** | 📌 | 1 | 0 | home | dspmStatus, parentChildren, studentAllBands |
| **chat** | 📌 | 0 | 0 | — | — |

## Teacher

แถบล่าง: `home` · `class` · `injury` · `leave` · `schedule` · `slip`

| หน้า | บนแถบล่าง | ปุ่ม | กล่อง | ไปต่อได้ที่ไหน | ข้อมูลที่ขอ |
|---|:---:|---:|---:|---|---|
| **home** | 📌 | 31 | 14 | absence, class, home, leave, schedule | absenceWatchCount, approveOT, classCoverList, classList, dspmStatus, foodItems, geoCheck, getJournal, growthDue, holidayAttendList, injuryAlerts, journalStatus, leaderParents, listDepartments, listStaff, listStudents, myAttendanceToday, myClassChanges, myClassCover, myHolidayOTNext, myOT, pendingInjuries, schoolDay, staffMissingCheckout, staffSelf, studentAlerts, studentProfile, submitLeave, teacherClassAttendance, teacherStudentOtList, teamPendingLeaves, teamPendingOT, teamPendingTimeRequests |
| **class** | 📌 | 21 | 6 | class, home | classList, holidayAttendAdd, holidayAttendList, journalStatus, listStudents, myOT, recallJournalsMany, schoolDay, staffStudentCheckin, studentAlerts, submitJournalsMany, teacherStudentLeave |
| **journal** |  | 1 | 0 | — | classList, foodItems, getJournal |
| **injury** | 📌 | 3 | 0 | injury | injuryReports, myStudents, submitInjury |
| **dspm** |  | 1 | 0 | class | classList, dspmStatus, growthDue |
| **leave** | 📌 | 6 | 0 | leave | approveLeave, approveTimeRequest, injuryReports, leaveQuota, myLeaves, myTimeRequests, pendingInjuries, staffSelf, submitLeave, submitTimeRequest, teamLeaveHistory, teamPendingLeaves, teamPendingTimeRequests, timeRequestHistory |
| **schedule** | 📌 | 3 | 0 | — | myAttendanceMonth, myLeaves, myOT, myPayslipMonths, otCarryOver, schedule |
| **slip** | 📌 | 16 | 0 | home, slip | changeStaffPassword, checkStaffPassword, computePayroll, getPayslip, myOT, myPayslipMonths, otCarryOver, requestPasswordReset, saveStaffSelf, staffSelf |
| **absence** |  | 0 | 0 | — | — |

## Admin

แถบล่าง: `home` · `leaves` · `finance` · `dspm` · `manage` · `chat`

| หน้า | บนแถบล่าง | ปุ่ม | กล่อง | ไปต่อได้ที่ไหน | ข้อมูลที่ขอ |
|---|:---:|---:|---:|---|---|
| **injuries** |  | 1 | 0 | — | injurySummary, pendingInjuries |
| **home** | 📌 | 29 | 17 | absence, daily, finance, home, injuries, leaves, manage, payroll | addAnnouncement, adminOTList, adminTodo, allLeaves, allStudentLeaves, announcements, approveLeave, bigCleaningDays, cancelLeave, dashboard, deleteAnnouncement, editAnnouncement, editStaffAttendance, financeSummary, financeTrend, getLeaveQuota, holidayAttendList, holidays, injurySummary, journalStatus, leaveResetReminder, listParents, listStaff, listStudents, opsPending, parentKidsMap, parentLinkDetail, payrollReminderDue, pendingInjuries, pendingPayments, ratedChildCount, staffAttendanceMonth, studentAlerts, studentMonthReport |
| **leaves** | 📌 | 18 | 8 | leaves | adminOTList, allLeaves, allStudentLeaves, approveLeave, attendanceAudit, bigCleaningDays, cancelLeave, editLeave, endingStudents, holidayAttendList, holidays, injurySummary, listStaff, listStudents, opsPending, otWaiveDays, pausedStudents, pendingAdminTimeRequests, pendingClassChanges, pendingInjuries, staffPerformanceAll, studentAlerts, studentOtList |
| **payroll** |  | 18 | 7 | finance | approvePayslip, computePayroll, getPayslip, listDepartments, listStaff, listStudents, otCarryOver, payrollConfig, ratedChildCount, saveStaff, setPayrollConfig, staffAttendanceMonth, staffLeaveSummary, staffMonthlyOT, staffPerformance |
| **dspm** | 📌 | 1 | 0 | — | classAssessment, listDepartments, listStudents |
| **manage** | 📌 | 243 | 149 | finance, home, manage | activityLog, addBigCleaning, addDepartment, addHoliday, addStaffGroup, addStudentByAdmin, addStudentCharge, adminAddHolidayOT, adminAddOT, adminCancelOT, adminDeleteOT, adminEditOT, adminOTList, adminResetPassword, adminRestoreOT, adminUpdateOT, allStudentLeaves, authDiag, backfillConfig, bigCleaningDays, billRunLast, billingGroups, cancelStudentTerm, certStudents, certText, classCoverAdd, classCoverList, classCoverRemove, confirmOT, confirmTimeRequest, contributionReset, decideClassChange, dedupData, deleteBill, deleteFoodItem, deleteParent, deletePayrollRow, deletePerfLog, deleteStaff, deleteStaffGroup, deleteSurvey, diagDay, dspmAllCriteria, editHoliday, endingStudents, exportManifest, exportStudent, exportTable, foodItems, foodMenu, foodPhotos, generateMonthlyBills, getJournal, getLeaveQuota, getPlans, getQRCodes, getStaffPassword, holidayAttendList, holidayAttendSet, holidayDateCheck, holidays, importStudent, insuranceExport, insuranceList, insuranceOptions, insuranceStatus, issueBill, issueBillsFor, journalHistory, journalStatus, lineLoginReady, lineRecipients, lineUsage, linkParentAdmin, listClasses, listDepartments, listExportedStudents, listParents, listStaff, listStaffGroups, listStudents, listWithdrawals, notifyBills, onboardingCheck, orgMoveStudent, orgMoveTeacher, otDaily, otVerification, parentKidsMap, parentLinkDetail, parentLinkedStudents, paymentLog, paymentSlips, payments, payrollConfig, payrollDuplicates, pendingAdminTimeRequests, pendingClassChanges, perfSummary, permMatrix, prepayAudit, prepayTiers, prepayments, recomputeAttendance, recomputeContributions, reinstallTriggers, removeBigCleaning, removeDepartment, removeHoliday, removeStudent, removeStudentCharge, renameDepartment, saveFoodItem, saveFoodMenu, saveInsuranceAdmin, saveLineRecipients, saveParent, savePlans, savePrepayTiers, saveQRCodes, saveSlipOk, saveStaff, saveStudent, saveSurvey, saveVaccines, schoolConfig, seedFoodItems, setConfigVal, setLeaveQuota, setPayrollConfig, setSchoolConfig, setStaffEnd, setStaffGroupHours, setStaffPause, setStudentEnd, setStudentPause, setStudentTerm, setSurveyStatus, setTimezone, signOutEverywhere, slipDiag, staffCheckinLog, staffPerformance, studentBillBase, studentCharges, studentLinkedParents, studentOtList, studentProfile, studentTerms, studentVaccines, submitClassChange, surveyResults, surveySummary, surveys, timeRequestHistory, tzDiag, undoBillRun, unlinkStudent, unlockJournal, vaccineSchedule |
| **finance** | 📌 | 36 | 16 | absence, finance, payroll | addStudentCharge, attendanceAudit, billingGroups, cancelPrepay, computePayroll, dailyReport, deleteBill, editPrepay, editStudentAttendance, financeSummary, getPayslip, getPlans, issueBill, issueBillsFor, listStaff, listStudents, markSalaryPaid, notifyBills, otDaily, paymentLog, paymentSlips, payments, pendingPayments, prepayAudit, prepayments, recordCashPayment, removeStudentCharge, saveStaff, schoolDay, staffMonthlyOT, studentCharges, studentCheckinHistory, studentOtList |
| **daily** |  | 7 | 0 | absence | absenceReport, confirmPayment, confirmSlip, dailyReport, ratedChildCount, rejectPayment, rejectSlip, schoolDay |
| **verify** |  | 0 | 0 | — | pendingPayments |
| **absence** |  | 0 | 0 | — | — |
| **chat** | 📌 | 0 | 0 | — | — |
