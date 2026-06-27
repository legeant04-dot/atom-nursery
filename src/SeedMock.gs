/**
 * SeedMock.gs — fill the sheets with realistic FAKE test data (no real PII).
 * ------------------------------------------------------------------
 * Idempotent: each seeded sheet is cleared then rewritten, so re-running is safe.
 * Trigger via the web app:  POST {action:'seedMock', payload:{key:'<SeedMockKey>'}}
 *   - gated by SCHOOL_CONFIG key `SeedMockKey` (default 'atom-seed-2026') to avoid accidental wipes.
 * IDs match the app's demo logins (PAR-1/STD-1/STF-T1/STF-L1/STF-ADM) so demo accounts show data.
 * ⚠️ Remove this file (and the ROUTES.seedMock entry) before go-live with real data.
 * ------------------------------------------------------------------
 */
function handleSeedMock(p) {
  var key = getConfig_('SeedMockKey', 'atom-seed-2026');
  if (!p || String(p.key) !== String(key)) throw apiError_('FORBIDDEN', 'seedMock: bad or missing key');
  return seedMockData();
}

function seedMockData() {
  var MAIN = getMainSpreadsheet_(), HR = getHrSpreadsheet_();
  var today = Utilities.formatDate(new Date(), getConfig_('Timezone', 'Asia/Bangkok'), 'yyyy-MM-dd');
  var month = today.slice(0, 7);
  function reset(ss, name, objs) {
    var sh = sheet_(ss, name);
    var lr = sh.getLastRow();
    if (lr > 1) sh.getRange(2, 1, lr - 1, sh.getLastColumn()).clearContent();
    objs.forEach(function (o) { appendObject_(sh, o); });
    return name + ':' + objs.length;
  }
  var log = [];

  log.push(reset(HR, 'STAFF', [
    { StaffID:'STF-ADM', Name:'อารยา ผ่องใส', NameEN:'Araya P.', NationalID:'1101700100011', Position:'ผู้อำนวยการ', Role:'Admin', Department:'', PositionLevel:'Admin', StaffGroup:'หัวหน้าครู', StartDate:'2019-05-01', BaseSalary:40000, Status:'ACTIVE' },
    { StaffID:'STF-L1', Name:'แนน ใจดี', NameEN:'Nan J.', NationalID:'1101700100012', Position:'หัวหน้าชั้น', Role:'Teacher', Department:'Nursery 1', PositionLevel:'Leader', StaffGroup:'หัวหน้าครู', ReportsTo:'STF-ADM', StartDate:'2021-08-15', BaseSalary:22000, Status:'ACTIVE' },
    { StaffID:'STF-T1', Name:'เอ มานะ', NameEN:'A Mana', NationalID:'1101700100013', Position:'ครูประจำชั้น', Role:'Teacher', Department:'Nursery 1', PositionLevel:'Officer', StaffGroup:'ครูประจำ', ReportsTo:'STF-L1', StartDate:'2023-06-01', BaseSalary:16000, Status:'ACTIVE' },
    { StaffID:'STF-T2', Name:'บี สดใส', NameEN:'B Sodsai', NationalID:'1101700100014', Position:'ครูผู้ช่วย', Role:'Teacher', Department:'Nursery 2', PositionLevel:'Assistant', StaffGroup:'ครูฝึกสอน', ReportsTo:'STF-ADM', StartDate:'2025-11-01', BaseSalary:14000, Status:'ACTIVE' }
  ]));
  log.push(reset(HR, 'WORK_SCHEDULE', [
    { StaffID:'STF-T1', DayOfWeek:'Mon-Fri', CheckInTime:'08:00', CheckOutTime:'17:00', EffectiveDate:'2025-01-01' },
    { StaffID:'STF-L1', DayOfWeek:'Mon-Fri', CheckInTime:'07:30', CheckOutTime:'17:00', EffectiveDate:'2025-01-01' },
    { StaffID:'STF-T2', DayOfWeek:'Mon-Fri', CheckInTime:'08:00', CheckOutTime:'17:00', EffectiveDate:'2025-01-01' }
  ]));
  log.push(reset(MAIN, 'CLASSES', [
    { ClassID:'CL1', ClassName:'Nursery 1', TeacherID:'STF-T1', AgeRange:'1-2 ปี', Capacity:15 },
    { ClassID:'CL2', ClassName:'Nursery 2', TeacherID:'STF-T2', AgeRange:'2-3 ปี', Capacity:15 }
  ]));
  log.push(reset(MAIN, 'PARENTS', [
    { ParentID:'PAR-1', NationalID:'1100100100101', Name:'กานต์ ดีงาม', NameEN:'Ms.Karn', Relationship:'มารดา', Phone:'081-111-1111', Occupation:'พนักงานบริษัท', LineUID:'U_p1', StudentID:'STD-1', Address:'กรุงเทพฯ' },
    { ParentID:'PAR-2', NationalID:'1100200200202', Name:'วิทย์ เก่งกล้า', NameEN:'Mr.Wit', Relationship:'บิดา', Phone:'082-222-2222', Occupation:'วิศวกร', LineUID:'U_p2', StudentID:'STD-2', Address:'กรุงเทพฯ' }
  ]));
  log.push(reset(MAIN, 'STUDENTS', [
    { StudentID:'STD-1', NationalID:'1234567890121', Name:'บีม สุขใจ', NameEN:'Beam', Nickname:'บีม', NicknameEN:'Beam', Gender:'M', DOB:'2025-05-01', Class:'Nursery 1', ParentID:'PAR-1', Plan:'p_0717', Weight:8.5, Height:70, Allergy:'นมวัว', EnrollDate:'2025-06-01', Status:'ACTIVE' },
    { StudentID:'STD-2', NationalID:'1234567890122', Name:'เอม ใจดี', NameEN:'Aim', Nickname:'เอม', NicknameEN:'Aim', Gender:'F', DOB:'2024-10-10', Class:'Nursery 1', ParentID:'PAR-2', Plan:'p_0718', Weight:10.2, Height:78, EnrollDate:'2024-12-01', Status:'ACTIVE' },
    { StudentID:'STD-3', NationalID:'1234567890123', Name:'ปอ รักเรียน', NameEN:'Por', Nickname:'ปอ', NicknameEN:'Por', Gender:'M', DOB:'2023-06-01', Class:'Nursery 2', ParentID:'PAR-2', Plan:'p_inter', Weight:13.5, Height:92, EnrollDate:'2023-09-01', Status:'ACTIVE' }
  ]));
  log.push(reset(MAIN, 'USER_LINKS', [
    { UserUID:'U_p1', StudentID:'STD-1', VerifiedBy:'register', Date:'2025-06-01' },
    { UserUID:'U_p2', StudentID:'STD-2', VerifiedBy:'register', Date:'2024-12-01' },
    { UserUID:'U_p2', StudentID:'STD-3', VerifiedBy:'register', Date:'2023-09-01' }
  ]));
  log.push(reset(MAIN, 'ANNOUNCEMENTS', [
    { AnnID:'ANN-1', Title:'ยินดีต้อนรับเปิดเทอม', TitleEN:'Welcome back', Content:'เปิดเรียนวันที่ 1 ของเดือนนี้', ContentEN:'School opens on the 1st', Date:today, Type:'news', TargetGroup:'all', Popup:false, StartDate:today, EndDate:'' }
  ]));
  log.push(reset(MAIN, 'BILLING', [
    { BillingID:'BL-' + month + '-STD-1', StudentID:'STD-1', Month:month, Amount:6500, OTRollover:0, DueDate:month + '-05', Status:'UNPAID', SlipAmount:0 }
  ]));
  log.push(reset(HR, 'CHECKIN_STAFF', [
    { Date:today, StaffID:'STF-L1', CheckIn:'07:28', CheckOut:'', LateMinutes:0, OTHours:0, Status:'IN' },
    { Date:today, StaffID:'STF-T1', CheckIn:'08:05', CheckOut:'', LateMinutes:0, OTHours:0, Status:'IN' }
  ]));
  log.push(reset(MAIN, 'GROWTH_RECORDS', [
    { Date:'2025-12-01', StudentID:'STD-1', AgeMonth:7, Weight:7.6, Height:67 },
    { Date:today, StudentID:'STD-1', AgeMonth:13, Weight:8.5, Height:70 }
  ]));
  log.push(reset(MAIN, 'DAILY_JOURNAL', [
    { Date:today, StudentID:'STD-1', TeacherID:'STF-T1', Mood:'Happy', Health:'Well',
      Milk:JSON.stringify([6, 4]), Meals:JSON.stringify({ Breakfast:'All', Lunch:'Most', Dinner:'Some' }),
      Sleep:JSON.stringify([{ from:'12:30', to:'14:00' }]), Toilet:JSON.stringify({ Urination:'Normal', Bowel:'1' }),
      Activity:JSON.stringify(['Circle Time', 'Art & Craft']), Skills:JSON.stringify(['Social Skills']),
      Highlight:'วันนี้บีมแบ่งของเล่นให้เพื่อนเก่งมากค่ะ' }
  ]));
  // a few DSPM_CRITERIA rows covering the demo students' ages so the Development tab works
  var dspm = [];
  function band(from, to, label, items) { items.forEach(function (it) { dspm.push({ AgeFrom:from, AgeTo:to, AgeLabelTH:label, ItemNo:it[0], Skill:it[1], Description:it[2], DescriptionEN:it[3], Track:'Teacher' }); }); }
  band(13, 15, '13 - 15 เดือน', [[40,'GM','ยืนตามลำพังได้นาน 10 วินาที','Stands alone for 10 seconds'],[41,'FM','ขีดเขียนเป็นเส้นบนกระดาษได้','Scribbles lines on paper'],[42,'RL','เลือกวัตถุตามคำสั่งได้ 2 ชนิด','Selects 2 objects on request'],[43,'EL','พูดคำโดดได้ 2 คำ','Says 2 single words'],[44,'PS','เลียนแบบงานบ้าน','Imitates household chores']]);
  band(19, 24, '19 - 24 เดือน', [[60,'GM','เตะลูกบอลได้','Kicks a ball'],[61,'FM','ต่อก้อนไม้ 4 ชั้น','Stacks 4 blocks'],[62,'RL','เลือกวัตถุตามคำสั่ง 4 ชนิด','Selects from 4 objects'],[63,'EL','พูดวลี 2 คำ','Repeats 2-word phrases'],[64,'PS','ใช้ช้อนตักอาหารเองได้','Eats with a spoon']]);
  band(31, 36, '31 - 36 เดือน', [[79,'GM','ยืนขาเดียว 1 วินาที','Stands on one foot 1s'],[80,'FM','เลียนแบบลากเส้นวงต่อเนื่อง','Imitates circular lines'],[81,'RL','นำวัตถุ 2 ชนิดมาให้ตามคำสั่ง','Brings 2 named objects'],[82,'EL','พูดติดต่อกัน 3-4 คำ','Speaks 3-4 words together'],[83,'PS','ใส่กางเกงเองได้','Puts on pants by self']]);
  log.push(reset(MAIN, 'DSPM_CRITERIA', dspm));

  // flush the sheet cache so freshly-seeded data is read immediately (seed writes bypass writeRows_)
  try {
    var keys = ['cfg'];
    ['STAFF','WORK_SCHEDULE','CLASSES','PARENTS','STUDENTS','USER_LINKS','ANNOUNCEMENTS','BILLING','CHECKIN_STAFF','GROWTH_RECORDS','DAILY_JOURNAL','DSPM_CRITERIA']
      .forEach(function (s) { keys.push('col:' + s, 'rows:' + s); });
    CacheService.getScriptCache().removeAll(keys);
  } catch (e) {}
  Logger.log('SEED DONE: ' + log.join(' | '));
  return { ok:true, seeded:log, date:today };
}
