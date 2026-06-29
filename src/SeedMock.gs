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
    { StaffID:'STF-ADM', Name:'อารยา ผ่องใส', NameEN:'Araya P.', NationalID:'1101700100011', Position:'ผู้อำนวยการ', Role:'Admin', Department:'', PositionLevel:'Admin', StaffGroup:'หัวหน้าครู', LineUID:'U_adm', StartDate:'2019-05-01', BaseSalary:40000, Status:'ACTIVE' },
    { StaffID:'STF-L1', Name:'แนน ใจดี', NameEN:'Nan J.', NationalID:'1101700100012', Position:'หัวหน้าชั้น', Role:'Teacher', Department:'Nursery 1', PositionLevel:'Leader', StaffGroup:'หัวหน้าครู', ReportsTo:'STF-ADM', LineUID:'U_l1', StartDate:'2021-08-15', BaseSalary:22000, Status:'ACTIVE' },
    { StaffID:'STF-T1', Name:'เอ มานะ', NameEN:'A Mana', NationalID:'1101700100013', Position:'ครูประจำชั้น', Role:'Teacher', Department:'Nursery 1', PositionLevel:'Officer', StaffGroup:'ครูประจำ', ReportsTo:'STF-L1', LineUID:'U_t1', StartDate:'2023-06-01', BaseSalary:16000, Status:'ACTIVE' },
    { StaffID:'STF-T2', Name:'บี สดใส', NameEN:'B Sodsai', NationalID:'1101700100014', Position:'ครูผู้ช่วย', Role:'Teacher', Department:'Nursery 2', PositionLevel:'Assistant', StaffGroup:'ครูฝึกสอน', ReportsTo:'STF-ADM', LineUID:'U_t2', StartDate:'2025-11-01', BaseSalary:14000, Status:'ACTIVE' }
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
  // full prototype DSPM_CRITERIA (ported from webapp/mockdata.js) — continuous bands 0-36 mo, bilingual.
  // DEMO/sample criteria; replace with the proofread official DSPM manual set before clinical go-live.
  band(0, 1, 'แรกเกิด - 1 เดือน', [[1,'GM','ท่านอนคว่ำ ยกศีรษะและหันไปข้างใดข้างหนึ่งได้','Prone: lifts head and turns it to one side'],[2,'FM','มองตามถึงกึ่งกลางลำตัว','Follows an object to the midline'],[3,'RL','สะดุ้งหรือเคลื่อนไหวร่างกายเมื่อได้ยินเสียงพูดระดับปกติ','Startles or moves when hearing a normal voice'],[4,'EL','ส่งเสียงอ้อแอ้','Coos / makes vowel sounds'],[5,'PS','มองจ้องหน้าได้นาน 1-2 วินาที','Fixes gaze on a face for 1-2 seconds']]);
  band(1, 2, '1 - 2 เดือน', [[6,'GM','ท่านอนคว่ำ ยกศีรษะตั้งขึ้นได้ 45 องศา นาน 3 วินาที','Prone: lifts head to 45° for 3 seconds'],[7,'FM','มองตามผ่านกึ่งกลางลำตัว','Follows an object past the midline'],[8,'RL','มองหน้าผู้พูดคุยได้นาน 5 วินาที',"Looks at the speaker's face for 5 seconds"],[9,'EL','ทำเสียงในลำคอ (อู/อา/อือ) อย่างชัดเจน','Makes clear throaty sounds (oo/ah/uh)'],[10,'PS','ยิ้มตอบหรือส่งเสียงตอบได้','Smiles back or vocalizes in response']]);
  band(3, 4, '3 - 4 เดือน', [[11,'GM','ท่านอนคว่ำยกศีรษะและอกพ้นพื้น','Prone: lifts head and chest off the floor'],[12,'FM','มองตามสิ่งของที่เคลื่อนที่ได้','Follows a moving object'],[13,'RL','หันตามเสียงได้','Turns toward a sound'],[14,'EL','ทำเสียงสูง ๆ ต่ำ ๆ เพื่อแสดงความรู้สึก','Vocalizes with high/low pitch to express feelings'],[15,'PS','ยิ้มทักคนที่คุ้นเคย','Smiles at familiar people']]);
  band(5, 6, '5 - 6 เดือน', [[16,'GM','ยันตัวขึ้นจากท่านอนคว่ำ โดยเหยียดแขนตรงทั้งสองข้าง','Props up from prone on both extended arms'],[17,'FM','เอื้อมมือหยิบและถือวัตถุไว้ขณะนอนหงาย','Reaches for and holds an object while supine'],[18,'RL','หันตามเสียงเรียก','Turns when called'],[19,'EL','เลียนแบบการเล่นทำเสียงได้','Imitates playful sounds'],[20,'PS','สนใจฟังคนพูดและมองของเล่นที่ผู้ทดสอบเล่นด้วย','Attends to speech and looks at the toy being played with']]);
  band(7, 8, '7 - 8 เดือน', [[21,'GM','นั่งได้มั่นคง เอี้ยวตัวใช้มือเล่นได้อิสระ','Sits steadily and twists to play freely'],[22,'GM','ยืนเกาะเครื่องเรือนสูงระดับอกได้','Pulls to stand holding chest-high furniture'],[23,'FM','จ้องมองหนังสือพร้อมผู้ใหญ่ 2-3 วินาที','Looks at a book with an adult for 2-3 seconds'],[24,'RL','หันตามเสียงเรียกชื่อ','Turns to own name'],[25,'EL','เลียนเสียงพูดคุย','Imitates speech sounds'],[26,'PS','เล่นจ๊ะเอ๋และมองหาหน้าผู้เล่นได้ถูกทิศ','Plays peekaboo and looks toward the player']]);
  band(10, 12, '10 - 12 เดือน', [[35,'GM','ยืนนาน 2 วินาที','Stands alone for 2 seconds'],[36,'FM','จีบนิ้วมือเพื่อหยิบของชิ้นเล็ก','Uses pincer grasp to pick up small objects'],[37,'RL','โบกมือหรือตบมือตามคำสั่ง','Waves or claps on request'],[38,'EL','แสดงความต้องการโดยทำท่าทางหรือเปล่งเสียง','Shows needs with gestures or sounds'],[39,'PS','เล่นสิ่งของตามประโยชน์ของสิ่งของได้','Uses objects appropriately for their purpose']]);
  band(13, 15, '13 - 15 เดือน (1 ปี 1 เดือน - 1 ปี 3 เดือน)', [[40,'GM','ยืนอยู่ตามลำพังได้นานอย่างน้อย 10 วินาที','Stands alone for at least 10 seconds'],[41,'FM','ขีดเขียน (เป็นเส้น) บนกระดาษได้','Scribbles lines on paper'],[42,'RL','เลือกวัตถุตามคำสั่งได้ถูกต้อง 2 ชนิด','Selects 2 objects correctly on request'],[43,'EL','พูดคำพยางค์เดียว (คำโดด) ได้ 2 คำ','Says 2 single-syllable words'],[44,'PS','เลียนแบบท่าทางการทำงานบ้าน','Imitates household chores']]);
  band(16, 17, '16 - 17 เดือน', [[45,'GM','เดินลากของเล่นหรือสิ่งของได้','Walks while pulling a toy or object'],[46,'FM','ขีดเขียนได้เอง','Scribbles spontaneously'],[47,'RL','ทำตามคำสั่งง่าย ๆ โดยไม่มีท่าทางประกอบ','Follows a simple command without gestures'],[48,'EL','ตอบชื่อวัตถุได้ถูกต้อง','Names objects correctly'],[49,'PS','เล่นใช้สิ่งของตามหน้าที่ด้วยความสัมพันธ์ 2 สิ่งขึ้นไป','Plays relating 2+ objects by function']]);
  band(19, 24, '19 - 24 เดือน (1 ปี 7 เดือน - 2 ปี)', [[60,'GM','เหวี่ยงขาเตะลูกบอลได้','Kicks a ball'],[61,'FM','ต่อก้อนไม้ 4 ชั้น','Stacks 4 blocks'],[62,'RL','เลือกวัตถุตามคำสั่ง (ตัวเลือก 4 ชนิด)','Selects objects on request (4 choices)'],[63,'EL','เลียนคำพูดที่เป็นวลี 2 คำขึ้นไป','Repeats phrases of 2+ words'],[64,'PS','ใช้ช้อนตักอาหารกินเองได้','Eats with a spoon by self']]);
  band(25, 29, '25 - 29 เดือน (2 ปี 1 เดือน - 2 ปี 5 เดือน)', [[65,'GM','กระโดดเท้าพ้นพื้นทั้ง 2 ข้าง','Jumps with both feet off the ground'],[66,'FM','แก้ปัญหาง่าย ๆ โดยใช้เครื่องมือด้วยตัวเอง','Solves simple problems using a tool'],[67,'RL','ชี้อวัยวะ 7 ส่วน','Points to 7 body parts'],[68,'EL','พูดตอบรับและปฏิเสธได้','Says yes and no appropriately'],[69,'PS','ล้างและเช็ดมือได้เอง','Washes and dries hands by self']]);
  band(31, 36, '31 - 36 เดือน (2 ปี 7 เดือน - 3 ปี)', [[79,'GM','ยืนขาเดียว 1 วินาที','Stands on one foot for 1 second'],[80,'FM','เลียนแบบลากเส้นเป็นวงต่อเนื่องกัน','Imitates drawing continuous circular lines'],[81,'RL','นำวัตถุ 2 ชนิดในห้องมาให้ตามคำสั่ง','Brings 2 named objects from the room on request'],[82,'EL','พูดติดต่อกัน 3-4 คำ ได้อย่างน้อย 4 ความหมาย','Speaks 3-4 words together (≥4 meanings)'],[83,'PS','ใส่กางเกงได้เอง','Puts on pants by self']]);
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
