const harness = require('./gas_test_harness');
const { run } = harness(['Config','Db','Audit','Line','Auth','Code','Setup','Dspm_Seed','Checkin','Triggers','Leave','Parent']);

// run inside the vm context so all functions/vars (incl. PUSH) are visible
const result = run(function () {
  _configCache = null; setupAll(); _configCache = null;
  const cfg = sheet_(getMainSpreadsheet_(), 'SCHOOL_CONFIG');
  updateRow_(cfg, findObject_(cfg, r => r.Key === 'LineChannelAccessToken')._row, { Value: 'REALTOKEN' });
  _configCache = null;

  let pass = true;
  const ok = (c, m) => { if (!c) { pass = false; console.log('FAIL:', m); } else console.log('ok  -', m); };
  const HR = getHrSpreadsheet_(), MAIN = getMainSpreadsheet_();
  const staff = sheet_(HR, 'STAFF');
  const addStaff = (id, name, dept, level, uid) => appendObject_(staff, {
    StaffID: id, Name: name, Position: level, Role: level === 'Admin' ? 'Admin' : 'Teacher',
    Department: dept, PositionLevel: level, ReportsTo: '', Phone: '', LineUID: uid,
    StartDate: new Date(), BaseSalary: 15000, Status: 'ACTIVE'
  });
  addStaff('STF-ADM', 'แอดมิน', '', 'Admin', 'Uadmin');
  addStaff('STF-L1', 'ลีดเดอร์1', 'Nursery 1', 'Leader', 'Uleader1');
  addStaff('STF-L2', 'ลีดเดอร์2', 'Nursery 2', 'Leader', 'Uleader2');
  addStaff('STF-O1', 'ครูเอ', 'Nursery 1', 'Officer', 'Uofficer1');
  appendObject_(sheet_(MAIN, 'USERS'), { UserID: 'U-0001', LineUID: 'Uadmin', Role: 'Admin', LinkedID: 'STF-ADM', PasswordHash: 'x:y', CreatedDate: new Date(), Status: 'ACTIVE' });

  // 1. Officer submits
  PUSH.length = 0;
  const sub = handleSubmitLeave({ staffId: 'STF-O1', type: 'ลาป่วย', startDate: '2026-06-10', endDate: '2026-06-12', reason: 'ไข้' });
  ok(sub.status === 'PENDING_LEADER' && sub.days === 3, 'officer submit -> PENDING_LEADER, 3 days');
  ok(/^LV2026-\d{3}$/.test(sub.leaveId), 'leaveId format ' + sub.leaveId);
  ok(PUSH.some(p => p.to === 'Uleader1') && PUSH.some(p => p.to === 'Uleader2'), 'all leaders notified on submit');

  // 2. Officer cannot approve
  try { handleApproveLeave({ leaveId: sub.leaveId, staffId: 'STF-O1', decision: 'approve' }); ok(false, 'officer approve should throw'); }
  catch (e) { ok(e.apiCode === 'NO_PERMISSION', 'officer cannot approve'); }

  // 3. Cross-dept leader approves
  PUSH.length = 0;
  const a1 = handleApproveLeave({ leaveId: sub.leaveId, staffId: 'STF-L2', decision: 'approve' });
  ok(a1.status === 'PENDING_ADMIN' && a1.crossDept === true, 'L2 cross-dept approve -> PENDING_ADMIN + crossDept');
  ok(PUSH.some(p => p.to === 'Uleader1' && /ข้ามแผนก/.test(p.text)), 'owning dept leader notified of cross-dept');
  ok(PUSH.some(p => p.to === 'Uadmin'), 'admin notified for final approval');

  // 4. Admin final approve
  PUSH.length = 0;
  const a2 = handleApproveLeave({ leaveId: sub.leaveId, lineUid: 'Uadmin', decision: 'approve' });
  ok(a2.status === 'APPROVED', 'admin final -> APPROVED');
  ok(PUSH.some(p => p.to === 'Uofficer1' && /อนุมัติ/.test(p.text)), 'requester notified of approval');

  // 5. Leader self-submit skips to admin
  const subL = handleSubmitLeave({ staffId: 'STF-L1', type: 'ลากิจ', startDate: '2026-07-01', endDate: '2026-07-01', reason: 'ธุระ' });
  ok(subL.status === 'PENDING_ADMIN', 'leader self-submit -> skip to PENDING_ADMIN');
  ok(findObject_(sheet_(HR, 'LEAVE_REQUEST'), r => r.LeaveID === subL.leaveId).Step1Status === 'Skipped', 'leader self leave Step1=Skipped');

  // 6. reject path
  const subR = handleSubmitLeave({ staffId: 'STF-O1', type: 'ลากิจ', startDate: '2026-08-01', endDate: '2026-08-01', reason: 'x' });
  ok(handleApproveLeave({ leaveId: subR.leaveId, staffId: 'STF-L1', decision: 'reject', note: 'คนไม่พอ' }).status === 'REJECTED', 'leader reject -> REJECTED');

  // 7. queries
  ok(handleMyLeaves({ staffId: 'STF-O1' }).leaves.length === 2, 'myLeaves returns officer 2 requests');
  // pendingLeaves now returns a raw-row ARRAY (matches the client + engine), not {level,pending:[]}
  ok(handlePendingLeaves({ staffId: 'STF-ADM' }).some(l => l.LeaveID === subL.leaveId), 'admin sees PENDING_ADMIN');
  ok(Array.isArray(handlePendingLeaves({ staffId: 'STF-L1' })), 'leader pendingLeaves returns an array');

  // 8. parent check-in + absence
  appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: 'STD-001', Name: 'น้องมายด์', DOB: '2022-01-01', Class: 'Nursery 1', ParentID: 'PAR-001', Status: 'ACTIVE' });
  appendObject_(sheet_(MAIN, 'CLASSES'), { ClassID: 'CL1', ClassName: 'Nursery 1', TeacherID: 'STF-O1', AgeRange: '2-3', Capacity: 20 });
  appendObject_(sheet_(MAIN, 'PARENTS'), { ParentID: 'PAR-001', Name: 'คุณแม่', Phone: '08x', LineUID: 'Uparent1', StudentID: 'STD-001', Address: '' });
  PUSH.length = 0;
  const pc = handleParentCheckin({ parentId: 'PAR-001', studentId: 'STD-001', type: 'IN', lat: 13.792472, lng: 100.646389 });
  ok(pc.type === 'IN' && pc.distance === 0, 'parent check-in IN ok');
  ok(PUSH.some(p => p.to === 'Uofficer1' && /มาถึง/.test(p.text)), 'class teacher notified of arrival');
  ok(sheet_(MAIN, 'CHECKIN_STUDENT').getLastRow() === 2, 'CHECKIN_STUDENT row written');
  const ab = handleStudentAbsence({ parentId: 'PAR-001', studentId: 'STD-001', date: '2026-06-15', reason: 'พาไปหาหมอ' });
  ok(ab.teacherNotified === true && /^LVS-\d{4}$/.test(ab.leaveId), 'student absence recorded + teacher notified ' + ab.leaveId);

  // 9. router wiring
  const env = JSON.parse(dispatch_('submitLeave', { staffId: 'STF-O1', startDate: '2026-09-01', endDate: '2026-09-02', type: 'ลากิจ', reason: 'y' }).getContent());
  ok(env.ok && env.data.status === 'PENDING_LEADER', 'router submitLeave ok');

  console.log('\n' + (pass ? 'DAY4 TESTS PASS' : 'TESTS FAILED'));
  return pass;
});
process.exit(result ? 0 : 1);
