/* mockdata.js — sample rows for mock/demo mode ONLY. Loaded on demand by api.js (never in gas
   mode), alongside engine.js. Shapes mirror Google Sheets columns. MOCK.config lives in
   mockconfig.js, which always ships. */
Object.assign(window.MOCK, {

  // Staff groups — different (editable) work hours per group (Admin-managed)
  staffGroups: [
    { GroupName:'หัวหน้าครู',   GroupNameEN:'Head Teacher',     CheckInTime:'07:30', CheckOutTime:'17:00' },
    { GroupName:'ครูประจำ',     GroupNameEN:'Class Teacher',    CheckInTime:'08:00', CheckOutTime:'17:00' },
    { GroupName:'ครูฝึกสอน',    GroupNameEN:'Trainee Teacher',  CheckInTime:'08:30', CheckOutTime:'16:30' },
    { GroupName:'แม่บ้าน',      GroupNameEN:'Housekeeper',      CheckInTime:'07:00', CheckOutTime:'16:00' },
  ],

  staff: [
    { StaffID:'STF-ADM', NameTH:'อารยา ผ่องใส', NameEN:'Araya P.', NationalID:'1101700100011', Position:'ผู้อำนวยการ', Role:'Admin', Department:'', PositionLevel:'Admin', StaffGroup:'หัวหน้าครู', ReportsTo:'', LineUID:'U_adm', StartDate:'2019-05-01', BaseSalary:40000, Password:'1234', MustChangePassword:false, Status:'ACTIVE' },
    { StaffID:'STF-L1', NameTH:'แนน ใจดี', NameEN:'Nan J.', NationalID:'1101700100012', Position:'หัวหน้าชั้น', Role:'Teacher', Department:'Nursery 1', PositionLevel:'Leader', StaffGroup:'หัวหน้าครู', ReportsTo:'STF-ADM', LineUID:'U_l1', StartDate:'2021-08-15', BaseSalary:22000, Password:'1234', MustChangePassword:true, Status:'ACTIVE' },
    { StaffID:'STF-T1', NameTH:'เอ มานะ', NameEN:'A Mana', NationalID:'1101700100013', Position:'ครูประจำชั้น', Role:'Teacher', Department:'Nursery 1', PositionLevel:'Officer', StaffGroup:'ครูประจำ', ReportsTo:'STF-L1', LineUID:'U_t1', StartDate:'2023-06-01', BaseSalary:16000, Password:'1234', MustChangePassword:true, Status:'ACTIVE' },
    { StaffID:'STF-T2', NameTH:'บี สดใส', NameEN:'B Sodsai', NationalID:'1101700100014', Position:'ครูผู้ช่วย', Role:'Teacher', Department:'Nursery 2', PositionLevel:'Assistant', StaffGroup:'ครูฝึกสอน', ReportsTo:'STF-ADM', LineUID:'U_t2', StartDate:'2025-11-01', BaseSalary:14000, Password:'1234', MustChangePassword:true, Status:'ACTIVE' },
    { StaffID:'STF-H1', NameTH:'นิด ขยัน', NameEN:'Nid K.', NationalID:'1101700100015', Position:'แม่บ้าน', Role:'Teacher', Department:'Nursery 1', PositionLevel:'Staff', StaffGroup:'แม่บ้าน', ReportsTo:'STF-L1', LineUID:'U_h1', StartDate:'2022-01-10', BaseSalary:11000, Password:'1234', MustChangePassword:true, Status:'ACTIVE' },
  ],
  // Per-staff payroll config (Admin-editable): SS deduction, child-rate threshold & multiplier
  // ChildThreshold = the child NUMBER from which the rate starts counting (e.g. 11 = children #11 onward).
  // DiligenceAttendanceAmount / DiligenceFacebookAmount = per-staff bonus amounts (override global config).
  payrollConfig: {
    'STF-T1': { PayType:'monthly', DailyRate:0,   SocialSecurityDeduct:true,  ChildThreshold:21, ChildMultiplier:200, DiligenceAttendanceAmount:500, DiligenceFacebookAmount:500, TaxDeduct:false },
    'STF-L1': { PayType:'monthly', DailyRate:0,   SocialSecurityDeduct:true,  ChildThreshold:11, ChildMultiplier:300, DiligenceAttendanceAmount:700, DiligenceFacebookAmount:500, TaxDeduct:false },
    'STF-T2': { PayType:'daily',   DailyRate:550, SocialSecurityDeduct:false, ChildThreshold:31, ChildMultiplier:300, DiligenceAttendanceAmount:500, DiligenceFacebookAmount:300, TaxDeduct:false },
    'STF-H1': { PayType:'monthly', DailyRate:0,   SocialSecurityDeduct:true,  ChildThreshold:31, ChildMultiplier:300, DiligenceAttendanceAmount:500, DiligenceFacebookAmount:500, TaxDeduct:false },
    'STF-ADM':{ PayType:'monthly', DailyRate:0,   SocialSecurityDeduct:false, ChildThreshold:31, ChildMultiplier:300, DiligenceAttendanceAmount:500, DiligenceFacebookAmount:500, TaxDeduct:false },
  },
  // leave usage per staff per type (this year)
  leaveUsed: { 'STF-T1':{'ลาป่วย':2,'ลากิจ':1,'ลาพักร้อน':0}, 'STF-L1':{'ลาป่วย':0,'ลากิจ':2,'ลาพักร้อน':1}, 'STF-T2':{'ลาป่วย':3,'ลากิจ':0,'ลาพักร้อน':2}, 'STF-H1':{'ลาป่วย':1,'ลากิจ':0,'ลาพักร้อน':0} },
  workSchedule: [ // simple weekly default
    { StaffID:'STF-T1', Days:'จันทร์-ศุกร์', CheckInTime:'08:00', CheckOutTime:'17:00' },
    { StaffID:'STF-L1', Days:'จันทร์-ศุกร์', CheckInTime:'07:30', CheckOutTime:'17:00' },
    { StaffID:'STF-T2', Days:'จันทร์-ศุกร์', CheckInTime:'08:00', CheckOutTime:'17:00' },
    { StaffID:'STF-H1', Days:'จันทร์-เสาร์', CheckInTime:'07:00', CheckOutTime:'16:00' },
  ],
  staffAttendanceToday: [ // who's in/out/leave today
    { StaffID:'STF-L1', CheckIn:'07:28', CheckOut:'', Status:'IN', Late:0 },
    { StaffID:'STF-T2', CheckIn:'08:15', CheckOut:'', Status:'IN', Late:15 },
    { StaffID:'STF-H1', CheckIn:'', CheckOut:'', Status:'LEAVE', Reason:'ลาป่วย' },
    // STF-T1 (the demo teacher) not yet checked in -> shows --:--
  ],

  classes: [
    { ClassID:'CL1', ClassName:'Nursery 1', TeacherID:'STF-T1', AgeRange:'1-2 ปี', Capacity:15 },
    { ClassID:'CL2', ClassName:'Nursery 2', TeacherID:'STF-T2', AgeRange:'2-3 ปี', Capacity:15 },
  ],
  parents: [
    { ParentID:'PAR-1', NameTH:'กานต์ ดีงาม', NameEN:'Ms.Karn', Nickname:'กานต์', NicknameEN:'Karn', NationalID:'1100100100101', Relationship:'มารดา', Phone:'081-111-1111', Occupation:'พนักงานบริษัท', Workplace:'บจก. ดีงาม', OfficePhone:'02-111-1111', LineUID:'U_p1', StudentID:'STD-1', Address:'กทม.', LinePictureUrl:'assets/logo-icon.png' },
    { ParentID:'PAR-2', NameTH:'วิทย์ เก่งกล้า', NameEN:'Mr.Wit', Nickname:'วิทย์', NicknameEN:'Wit', NationalID:'1100200200202', Relationship:'บิดา', Phone:'082-222-2222', Occupation:'วิศวกร', Workplace:'บจก. เก่งกล้า', OfficePhone:'02-222-2222', LineUID:'U_p2', StudentID:'STD-2', Address:'กทม.' },
  ],
  // pickup persons authorized other than parents (PDPA form §3)
  pickupPersons: [
    { StudentID:'STD-1', Name:'สมศรี ดีงาม', Phone:'089-000-0001', Relation:'ยาย' },
  ],
  // user → student links (data isolation). A user sees only linked students.
  // Demo Parent (PAR-1 / Ms.Karn) is linked to STD-1.
  userLinks: [
    { UserUID:'U_p1', StudentID:'STD-1', VerifiedBy:'register', Date:'2025-06-01' },
    { UserUID:'U_p2', StudentID:'STD-2', VerifiedBy:'register', Date:'2024-12-01' },
    { UserUID:'U_p2', StudentID:'STD-3', VerifiedBy:'register', Date:'2023-09-01' },
  ],
  students: [
    { StudentID:'STD-1', NationalID:'1234567890121', NameTH:'บีม สุขใจ', NameEN:'Beam', Nickname:'บีม', NicknameEN:'Beam', Gender:'M', DOB:'2025-05-01', EnrollDate:'2025-06-01', Class:'Nursery 1', ParentID:'PAR-1', Plan:'p_0717', Weight:8.5, Height:70, Photo:'', BloodType:'O', RH:'+', Allergy:'นมวัว', MedicalHistory:'-', Status:'ACTIVE', LastGrowthUpdate:'2026-04-02',
      InsuranceHas:true, InsurancePolicyNo:'POL-2026-001', InsuranceCompany:'กรุงเทพประกันภัย', InsuranceExpiry:'2026-12-31', InsuranceCardImage:'' },
    { StudentID:'STD-2', NationalID:'1234567890122', NameTH:'เอม ใจดี', NameEN:'Aim', Nickname:'เอม', NicknameEN:'Aim', Gender:'F', DOB:'2024-10-10', EnrollDate:'2024-12-01', Class:'Nursery 1', ParentID:'PAR-2', Plan:'p_0718', Weight:10.2, Height:78, Photo:'', BloodType:'A', RH:'+', Allergy:'-', MedicalHistory:'-', Status:'ACTIVE', LastGrowthUpdate:'2026-04-05',
      InsuranceHas:false, InsurancePolicyNo:'', InsuranceCompany:'', InsuranceExpiry:'', InsuranceCardImage:'' },
    { StudentID:'STD-3', NationalID:'1234567890123', NameTH:'ปอ รักเรียน', NameEN:'Por', Nickname:'ปอ', NicknameEN:'Por', Gender:'M', DOB:'2023-06-01', EnrollDate:'2023-09-01', Class:'Nursery 2', ParentID:'PAR-2', Plan:'p_inter', Weight:13.5, Height:92, Photo:'', BloodType:'B', RH:'+', Allergy:'-', MedicalHistory:'-', Status:'ACTIVE', LastGrowthUpdate:'2026-02-01',
      InsuranceHas:false, InsurancePolicyNo:'', InsuranceCompany:'', InsuranceExpiry:'', InsuranceCardImage:'' },
  ],
  studentAttendanceToday: [
    { StudentID:'STD-2', Status:'IN', Time:'08:10' },
    { StudentID:'STD-3', Status:'LEAVE', Reason:'ลากิจ' },
    // STD-1 not arrived yet
  ],
  checkinStudent: [],

  journals: [
    { Date:'2026-06-08', StudentID:'STD-1', TeacherID:'STF-T1', Mood:'Happy', Health:'Well', HealthDetail:'ปกติดี',
      Milk:[6,4], MilkTotal:10, Water:'Good',
      Meals:{Breakfast:'Most',Lunch:'All',Dinner:'Some'},
      Sleep:[{from:'12:30',to:'14:00'}], SleepTotal:'1 ชม. 30 น.',
      Toilet:{Urination:'Normal',Bowel:'1',Stool:'Normal',Training:'No'},
      Activity:['Circle Time','Art & Craft'], Theme:'สีและรูปทรง',
      Skills:['Fine Motor Skills','Social Skills'],
      Highlight:'วันนี้บีมแบ่งของเล่นให้เพื่อนเก่งมากค่ะ', ParentNotes:'' },
  ],

  // DSPM Teacher-track criteria (bands needed for demo + analytics)
  dspmCriteria: [
    b(0,1,'แรกเกิด - 1 เดือน',[[1,'GM','ท่านอนคว่ำ ยกศีรษะและหันไปข้างใดข้างหนึ่งได้'],[2,'FM','มองตามถึงกึ่งกลางลำตัว'],[3,'RL','สะดุ้งหรือเคลื่อนไหวร่างกายเมื่อได้ยินเสียงพูดระดับปกติ'],[4,'EL','ส่งเสียงอ้อแอ้'],[5,'PS','มองจ้องหน้าได้นาน 1-2 วินาที']]),
    b(1,2,'1 - 2 เดือน',[[6,'GM','ท่านอนคว่ำ ยกศีรษะตั้งขึ้นได้ 45 องศา นาน 3 วินาที'],[7,'FM','มองตามผ่านกึ่งกลางลำตัว'],[8,'RL','มองหน้าผู้พูดคุยได้นาน 5 วินาที'],[9,'EL','ทำเสียงในลำคอ (อู/อา/อือ) อย่างชัดเจน'],[10,'PS','ยิ้มตอบหรือส่งเสียงตอบได้']]),
    b(3,4,'3 - 4 เดือน',[[11,'GM','ท่านอนคว่ำยกศีรษะและอกพ้นพื้น'],[12,'FM','มองตามสิ่งของที่เคลื่อนที่ได้'],[13,'RL','หันตามเสียงได้'],[14,'EL','ทำเสียงสูง ๆ ต่ำ ๆ เพื่อแสดงความรู้สึก'],[15,'PS','ยิ้มทักคนที่คุ้นเคย']]),
    b(5,6,'5 - 6 เดือน',[[16,'GM','ยันตัวขึ้นจากท่านอนคว่ำ โดยเหยียดแขนตรงทั้งสองข้าง'],[17,'FM','เอื้อมมือหยิบและถือวัตถุไว้ขณะนอนหงาย'],[18,'RL','หันตามเสียงเรียก'],[19,'EL','เลียนแบบการเล่นทำเสียงได้'],[20,'PS','สนใจฟังคนพูดและมองของเล่นที่ผู้ทดสอบเล่นด้วย']]),
    b(7,8,'7 - 8 เดือน',[[21,'GM','นั่งได้มั่นคง เอี้ยวตัวใช้มือเล่นได้อิสระ'],[22,'GM','ยืนเกาะเครื่องเรือนสูงระดับอกได้'],[23,'FM','จ้องมองหนังสือพร้อมผู้ใหญ่ 2-3 วินาที'],[24,'RL','หันตามเสียงเรียกชื่อ'],[25,'EL','เลียนเสียงพูดคุย'],[26,'PS','เล่นจ๊ะเอ๋และมองหาหน้าผู้เล่นได้ถูกทิศ']]),
    b(10,12,'10 - 12 เดือน',[[35,'GM','ยืนนาน 2 วินาที'],[36,'FM','จีบนิ้วมือเพื่อหยิบของชิ้นเล็ก'],[37,'RL','โบกมือหรือตบมือตามคำสั่ง'],[38,'EL','แสดงความต้องการโดยทำท่าทางหรือเปล่งเสียง'],[39,'PS','เล่นสิ่งของตามประโยชน์ของสิ่งของได้']]),
    b(13,15,'13 - 15 เดือน (1 ปี 1 เดือน - 1 ปี 3 เดือน)',[[40,'GM','ยืนอยู่ตามลำพังได้นานอย่างน้อย 10 วินาที'],[41,'FM','ขีดเขียน (เป็นเส้น) บนกระดาษได้'],[42,'RL','เลือกวัตถุตามคำสั่งได้ถูกต้อง 2 ชนิด'],[43,'EL','พูดคำพยางค์เดียว (คำโดด) ได้ 2 คำ'],[44,'PS','เลียนแบบท่าทางการทำงานบ้าน']]),
    b(16,17,'16 - 17 เดือน',[[45,'GM','เดินลากของเล่นหรือสิ่งของได้'],[46,'FM','ขีดเขียนได้เอง'],[47,'RL','ทำตามคำสั่งง่าย ๆ โดยไม่มีท่าทางประกอบ'],[48,'EL','ตอบชื่อวัตถุได้ถูกต้อง'],[49,'PS','เล่นใช้สิ่งของตามหน้าที่ด้วยความสัมพันธ์ 2 สิ่งขึ้นไป']]),
    b(19,24,'19 - 24 เดือน (1 ปี 7 เดือน - 2 ปี)',[[60,'GM','เหวี่ยงขาเตะลูกบอลได้'],[61,'FM','ต่อก้อนไม้ 4 ชั้น'],[62,'RL','เลือกวัตถุตามคำสั่ง (ตัวเลือก 4 ชนิด)'],[63,'EL','เลียนคำพูดที่เป็นวลี 2 คำขึ้นไป'],[64,'PS','ใช้ช้อนตักอาหารกินเองได้']]),
    b(25,29,'25 - 29 เดือน (2 ปี 1 เดือน - 2 ปี 5 เดือน)',[[65,'GM','กระโดดเท้าพ้นพื้นทั้ง 2 ข้าง'],[66,'FM','แก้ปัญหาง่าย ๆ โดยใช้เครื่องมือด้วยตัวเอง'],[67,'RL','ชี้อวัยวะ 7 ส่วน'],[68,'EL','พูดตอบรับและปฏิเสธได้'],[69,'PS','ล้างและเช็ดมือได้เอง']]),
    b(31,36,'31 - 36 เดือน (2 ปี 7 เดือน - 3 ปี)',[[79,'GM','ยืนขาเดียว 1 วินาที'],[80,'FM','เลียนแบบลากเส้นเป็นวงต่อเนื่องกัน'],[81,'RL','นำวัตถุ 2 ชนิดในห้องมาให้ตามคำสั่ง'],[82,'EL','พูดติดต่อกัน 3-4 คำ ได้อย่างน้อย 4 ความหมาย'],[83,'PS','ใส่กางเกงได้เอง']]),
  ].flat(),
  // English descriptions keyed by ItemNo (real DSPM_CRITERIA sheet would add a DescriptionEN column)
  dspmEN: {
    1:'Prone: lifts head and turns it to one side', 2:'Follows an object to the midline', 3:'Startles or moves when hearing a normal voice', 4:'Coos / makes vowel sounds', 5:'Fixes gaze on a face for 1-2 seconds',
    6:'Prone: lifts head to 45° for 3 seconds', 7:'Follows an object past the midline', 8:"Looks at the speaker's face for 5 seconds", 9:'Makes clear throaty sounds (oo/ah/uh)', 10:'Smiles back or vocalizes in response',
    11:'Prone: lifts head and chest off the floor', 12:'Follows a moving object', 13:'Turns toward a sound', 14:'Vocalizes with high/low pitch to express feelings', 15:'Smiles at familiar people',
    16:'Props up from prone on both extended arms', 17:'Reaches for and holds an object while supine', 18:'Turns when called', 19:'Imitates playful sounds', 20:'Attends to speech and looks at the toy being played with',
    21:'Sits steadily and twists to play freely', 22:'Pulls to stand holding chest-high furniture', 23:'Looks at a book with an adult for 2-3 seconds', 24:'Turns to own name', 25:'Imitates speech sounds', 26:'Plays peekaboo and looks toward the player',
    35:'Stands alone for 2 seconds', 36:'Uses pincer grasp to pick up small objects', 37:'Waves or claps on request', 38:'Shows needs with gestures or sounds', 39:'Uses objects appropriately for their purpose',
    40:'Stands alone for at least 10 seconds', 41:'Scribbles lines on paper', 42:'Selects 2 objects correctly on request', 43:'Says 2 single-syllable words', 44:'Imitates household chores',
    45:'Walks while pulling a toy or object', 46:'Scribbles spontaneously', 47:'Follows a simple command without gestures', 48:'Names objects correctly', 49:'Plays relating 2+ objects by function',
    60:'Kicks a ball', 61:'Stacks 4 blocks', 62:'Selects objects on request (4 choices)', 63:'Repeats phrases of 2+ words', 64:'Eats with a spoon by self',
    65:'Jumps with both feet off the ground', 66:'Solves simple problems using a tool', 67:'Points to 7 body parts', 68:'Says yes and no appropriately', 69:'Washes and dries hands by self',
    79:'Stands on one foot for 1 second', 80:'Imitates drawing continuous circular lines', 81:'Brings 2 named objects from the room on request', 82:'Speaks 3-4 words together (≥4 meanings)', 83:'Puts on pants by self'
  },

  assessments: [ // bream: partial 13-15 ; aim: multiple bands (since 3 mo)
    a('DA-001','STD-1',13,40,'GM','ผ่าน','2026-06-01'), a('DA-001','STD-1',13,41,'FM','ผ่าน','2026-06-01'), a('DA-001','STD-1',13,42,'RL','ไม่ผ่าน','2026-06-01'),
    // aim assessed across bands as she grew
    a('DA-010','STD-2',4,11,'GM','ผ่าน','2024-12-15'),a('DA-010','STD-2',4,12,'FM','ผ่าน','2024-12-15'),a('DA-010','STD-2',4,13,'RL','ผ่าน','2024-12-15'),a('DA-010','STD-2',4,14,'EL','ไม่ผ่าน','2024-12-15'),a('DA-010','STD-2',4,15,'PS','ผ่าน','2024-12-15'),
    a('DA-011','STD-2',12,35,'GM','ผ่าน','2025-08-20'),a('DA-011','STD-2',12,36,'FM','ผ่าน','2025-08-20'),a('DA-011','STD-2',12,37,'RL','ผ่าน','2025-08-20'),a('DA-011','STD-2',12,38,'EL','ผ่าน','2025-08-20'),a('DA-011','STD-2',12,39,'PS','ไม่ผ่าน','2025-08-20'),
    a('DA-012','STD-2',20,60,'GM','ผ่าน','2026-05-10'),a('DA-012','STD-2',20,61,'FM','ผ่าน','2026-05-10'),a('DA-012','STD-2',20,62,'RL','ผ่าน','2026-05-10'),
  ],

  leaves: [
    { LeaveID:'LV2026-001', StaffID:'STF-T1', Department:'Nursery 1', Type:'ลาป่วย', StartDate:'2026-06-10', EndDate:'2026-06-11', Days:2, Reason:'เป็นไข้', Status:'PENDING_LEADER', Step1ApproverName:'', Step1Status:'Pending', Step1CrossDept:'', Step2ApproverName:'', Step2Status:'Pending', CreatedDate:'2026-06-07' },
    { LeaveID:'LV2026-002', StaffID:'STF-T2', Department:'Nursery 2', Type:'ลากิจ', StartDate:'2026-06-05', EndDate:'2026-06-05', Days:1, Reason:'ธุระครอบครัว', Status:'APPROVED', Step1ApproverName:'แนน ใจดี', Step1Status:'Approved', Step1CrossDept:'YES', Step2ApproverName:'อารยา ผ่องใส', Step2Status:'Approved', CreatedDate:'2026-06-02' },
    { LeaveID:'LV2026-003', StaffID:'STF-H1', Department:'Nursery 1', Type:'ลาป่วย', StartDate:'2026-06-09', EndDate:'2026-06-09', Days:1, Reason:'ปวดหัว', Status:'PENDING_LEADER', Step1ApproverName:'', Step1Status:'Pending', Step1CrossDept:'', Step2ApproverName:'', Step2Status:'Pending', CreatedDate:'2026-06-08' },
  ],
  studentLeaves: [
    { LeaveID:'LVS-001', StudentID:'STD-3', Date:'2026-06-09', Reason:'ลากิจ', Status:'Notified' },
  ],
  // Withdrawal / cancel-enrolment requests (parent self-service or Admin direct). Reason ∈ WithdrawReasons.
  withdrawals: [],
  // Individual injury reports filed by teachers/leaders (แบบบันทึกการบาดเจ็บรายบุคคล)
  injuryReports: [],
  // PCHI insurance member records — ONE per student (keyed by student NationalID). Parent fills once; Admin may edit.
  insurancePCHI: [],
  // Full who-did-what activity log (newest pushed last; api sorts desc for display)
  activityLog: [
    { LogID:'LOG-1', Timestamp:'2026-06-09 08:05', UserRole:'Teacher', UserID:'STF-T1', UserName:'เอ มานะ', Action:'submitJournal', Target:'STD-1', Detail:'บันทึกประจำวัน' },
    { LogID:'LOG-2', Timestamp:'2026-05-03 09:10', UserRole:'Admin', UserID:'STF-ADM', UserName:'อารยา ผ่องใส', Action:'confirmPayment', Target:'BL-2026-05-1', Detail:'ยืนยันการชำระ (โอน) 10,000' },
  ],
  payroll: [],
  // staff evening OT with the 2-step approval lifecycle (teacher → Leader → Admin)
  otRecords: [
    { OTRecordID:'OTR-1', StaffID:'STF-T1', Date:'2026-07-02', Hours:1, Rate:137.5, Amount:138, ApprovedBy:'', Status:'PENDING_LEADER', Minutes:53, PlanOut:'18:00', ActualOut:'18:53', Month:'2026-07', Step1By:'', Step1Status:'Pending', Step2By:'', Step2Status:'Pending', Note:'' },
    { OTRecordID:'OTR-2', StaffID:'STF-T1', Date:'2026-07-03', Hours:2, Rate:137.5, Amount:275, ApprovedBy:'', Status:'PENDING_ADMIN', Minutes:112, PlanOut:'18:00', ActualOut:'19:52', Month:'2026-07', Step1By:'หัวหน้าครู', Step1Status:'Approved', Step2By:'', Step2Status:'Pending', Note:'' }
  ],
  payments: [ // monthly billing for parents
    { BillingID:'BL-2026-05-1', StudentID:'STD-1', Month:'2026-05', Items:[['ค่าเทอม',8000],['ค่าอาหาร',1500],['ค่ากิจกรรม',500]], Amount:10000, OTRollover:0, DueDate:'2026-05-05', Status:'PAID', PaidDate:'2026-05-03', SlipUrl:'', SlipAmount:10000 },
    { BillingID:'BL-2026-06-1', StudentID:'STD-1', Month:'2026-06', Items:[['ค่าเทอม',8000],['ค่าอาหาร',1500],['ค่ากิจกรรม',500]], Amount:10000, OTRollover:0, DueDate:'2026-06-05', Status:'UNPAID', PaidDate:'', SlipUrl:'', SlipAmount:0 },
  ],
  // Per-student extra charges — auto-merged into that student's monthly bill
  studentCharges: [
    { ChargeID:'CH-1', StudentID:'STD-1', Month:'2026-06', Label:'ค่าเรียนพิเศษภาษาไทย', Amount:600 },
  ],
  // Daily OT charges (per child per day) — created on late pickup, settled via KTB QR
  otDaily: [
    { OTID:'OT-2026-06-03-STD1', Date:'2026-06-03', StudentID:'STD-1', PickupTime:'18:10', PlanEnd:'17:00', LateMinutes:70, Hours:2, Amount:200, Status:'UNPAID', SlipRef:'', SlipAmount:0 },
  ],
  // Growth measurement history (weight/height) for the development line charts
  growthRecords: [
    { Date:'2025-06-01', StudentID:'STD-1', AgeMonth:1,  Weight:4.2, Height:54 },
    { Date:'2025-12-01', StudentID:'STD-1', AgeMonth:7,  Weight:7.6, Height:67 },
    { Date:'2026-04-02', StudentID:'STD-1', AgeMonth:11, Weight:8.5, Height:70 },
    { Date:'2024-12-01', StudentID:'STD-2', AgeMonth:1,  Weight:3.9, Height:53 },
    { Date:'2025-08-01', StudentID:'STD-2', AgeMonth:9,  Weight:8.1, Height:70 },
    { Date:'2026-04-05', StudentID:'STD-2', AgeMonth:17, Weight:10.2, Height:78 },
    { Date:'2025-06-01', StudentID:'STD-3', AgeMonth:24, Weight:11.0, Height:84 },
    { Date:'2026-02-01', StudentID:'STD-3', AgeMonth:32, Weight:13.5, Height:92 },
  ],
  // Absence log (leave + no-show) per student per day — drives the follow-up reports
  absenceLog: [
    { StudentID:'STD-1', Date:'2026-06-02', Type:'absent', Reason:'' },
    { StudentID:'STD-1', Date:'2026-06-03', Type:'absent', Reason:'' },
    { StudentID:'STD-2', Date:'2026-06-01', Type:'leave', Reason:'ไม่สบาย' },
    { StudentID:'STD-2', Date:'2026-06-02', Type:'leave', Reason:'ไม่สบาย' },
    { StudentID:'STD-2', Date:'2026-06-03', Type:'absent', Reason:'' },
    { StudentID:'STD-2', Date:'2026-06-04', Type:'absent', Reason:'' },
    { StudentID:'STD-2', Date:'2026-06-05', Type:'absent', Reason:'' },
    { StudentID:'STD-2', Date:'2026-06-08', Type:'absent', Reason:'' },
    { StudentID:'STD-3', Date:'2026-06-09', Type:'leave', Reason:'ลากิจ' },
  ],
  // teacher follow-up on long absences (note + status), keyed per student
  absenceFollowups: [
    { StudentID:'STD-1', Note:'โทรหาผู้ปกครองแล้ว เด็กเป็นหวัด', Status:'ติดตามแล้ว', Date:'2026-06-04' },
  ],
  // Standard child vaccine schedule (อายุ 1 เดือน – 6 ปี) — reference for record-keeping
  vaccineSchedule: [
    { ageTH:'1 เดือน', ageEN:'1 month', items:[
      { key:'HB2', th:'ตับอักเสบบี (HB) เข็มที่ 2', en:'Hepatitis B (HB) dose 2', m:1 } ]},
    { ageTH:'2-6 เดือน', ageEN:'2-6 months', items:[
      { key:'DTPHBHib1', th:'รวม คอตีบ-บาดทะยัก-ไอกรน-ตับอักเสบบี-ฮิบ (DTP-HB-Hib) เข็มที่ 1', en:'DTP-HB-Hib dose 1', m:2 },
      { key:'DTPHBHib2', th:'DTP-HB-Hib เข็มที่ 2', en:'DTP-HB-Hib dose 2', m:4 },
      { key:'DTPHBHib3', th:'DTP-HB-Hib เข็มที่ 3', en:'DTP-HB-Hib dose 3', m:6 },
      { key:'Polio1', th:'โปลิโอ (IPV/OPV) เข็มที่ 1', en:'Polio (IPV/OPV) dose 1', m:2 },
      { key:'Polio2', th:'โปลิโอ เข็มที่ 2', en:'Polio dose 2', m:4 },
      { key:'Polio3', th:'โปลิโอ เข็มที่ 3', en:'Polio dose 3', m:6 },
      { key:'Rota', th:'โรต้า (Rota) ป้องกันท้องเสียรุนแรง', en:'Rotavirus (Rota)', m:2 } ]},
    { ageTH:'9-12 เดือน', ageEN:'9-12 months', items:[
      { key:'MMR1', th:'หัด-คางทูม-หัดเยอรมัน (MMR) เข็มที่ 1', en:'MMR dose 1', m:9 },
      { key:'JE1', th:'ไข้สมองอักเสบเจอี (JE) เข็มที่ 1', en:'Japanese Encephalitis (JE) dose 1', m:9 } ]},
    { ageTH:'1 ปี 6 เดือน (18 เดือน)', ageEN:'18 months', items:[
      { key:'DTPb1', th:'DTP เข็มกระตุ้นที่ 1', en:'DTP booster 1', m:18 },
      { key:'Poliob1', th:'โปลิโอ (OPV/IPV) เข็มกระตุ้น', en:'Polio booster', m:18 },
      { key:'JE2', th:'JE เข็มที่ 2', en:'JE dose 2', m:18 } ]},
    { ageTH:'2 ปี 6 เดือน (30 เดือน)', ageEN:'30 months', items:[
      { key:'MMR2', th:'MMR เข็มที่ 2', en:'MMR dose 2', m:30 } ]},
    { ageTH:'4-6 ปี', ageEN:'4-6 years', items:[
      { key:'DTPb2', th:'DTP เข็มกระตุ้นที่ 2', en:'DTP booster 2', m:48 },
      { key:'Poliob2', th:'โปลิโอ (OPV) เข็มกระตุ้น', en:'Polio booster 2', m:48 } ]},
  ],
  // per-student vaccine records (which doses given + date)
  vaccineRecords: [
    { StudentID:'STD-1', Key:'HB2', Date:'2025-06-15' },
    { StudentID:'STD-1', Key:'DTPHBHib1', Date:'2025-07-10' },
    { StudentID:'STD-1', Key:'Polio1', Date:'2025-07-10' },
  ],
  // payment slips (multiple per bill/OT/prepay; supports partial payments + history)
  paymentSlips: [],
  // Holiday database (editable per year) — merged into the shared calendar
  holidays: [
    { Date:'2026-01-01', NameTH:'วันขึ้นปีใหม่', NameEN:"New Year's Day", Recurring:true },
    { Date:'2026-04-13', NameTH:'วันสงกรานต์', NameEN:'Songkran Festival', Recurring:true },
    { Date:'2026-12-05', NameTH:'วันพ่อแห่งชาติ', NameEN:"National Father's Day", Recurring:true },
    { Date:'2026-12-10', NameTH:'วันรัฐธรรมนูญ', NameEN:'Constitution Day', Recurring:true },
  ],
  announcements: [
    { AnnID:'ANN-1', Title:'เช้านี้จะมีการตรวจสอบเช็คอาการบ่งชี้โรคมือเท้าปากในเด็กช่วงเช้านะคะ', TitleEN:'Morning HFMD symptom check today', Content:'ได้รับแจ้งจากผู้ปกครองเมื่อวานว่ามีเด็กป่วยจากเนอสเซอรี่ 1 เป็นมือเท้าปาก จำนวน 4 ท่าน กรุณาสังเกตอาการบุตรหลานของท่าน หากมีไข้ ผื่น หรือแผลในปาก โปรดพาไปพบแพทย์', ContentEN:'We were informed of 4 HFMD cases. Please watch for fever, rash, or mouth sores.', Date:'2026-06-05', Type:'holiday', TargetGroup:'all', Image:'', Popup:true, StartDate:'2026-06-05', EndDate:'2026-12-31', Priority:2 },
    { AnnID:'ANN-2', Title:'ปิดเรียนวันหยุดนักขัตฤกษ์', TitleEN:'School closed — public holiday', Content:'โรงเรียนปิดวันหยุดนักขัตฤกษ์', ContentEN:'School closed for the public holiday', Date:'2026-06-05', Type:'holiday', TargetGroup:'all', Image:'', Popup:true, StartDate:'2026-06-05', EndDate:'2026-12-31', Priority:0 },
  ],
  // prepayments: months paid in advance with the applicable discount
  prepayments: [],
  calendar: [
    { date:'2026-06-12', title:'ปิด: วันหยุดนักขัตฤกษ์', type:'holiday' },
    { date:'2026-06-18', title:'กิจกรรมวันไหว้ครู', type:'event' },
    { date:'2026-06-25', title:'ตรวจสุขภาพประจำเดือน', type:'event' },
  ],
  // role-based activity feed (audience = roles who should see it)
  feed: [
    { id:'N1', text:'ครูบี เข้างานสาย 15 นาที', textEN:'B Sodsai checked in 15 min late', time:'08:15', roles:['Admin','Leader'], read:false },
    { id:'N2', text:'พี่นิด แจ้งลาป่วยวันนี้', textEN:'Nid K. is on sick leave today', time:'07:40', roles:['Admin','Leader'], read:false },
    { id:'N3', text:'คำขอลาใหม่จาก พี่นิด รออนุมัติ', textEN:'New leave request from Nid K. — pending', time:'07:41', roles:['Admin','Leader'], read:false },
    { id:'N4', text:'น้องเอม เช็คอินเข้าเรียนแล้ว 08:10', textEN:'Aim checked in at 08:10', time:'08:10', roles:['Teacher','Leader','Admin'], read:false, studentId:'STD-2' },
    { id:'N5', text:'น้องบีม ได้รับการประเมิน DSPM (3 ข้อ)', textEN:'Beam received a DSPM assessment (3 items)', time:'09:30', roles:['Parent'], parentId:'PAR-1', read:false },
    { id:'N6', text:'บันทึกประจำวันของน้องบีมพร้อมแล้ว', textEN:"Beam's daily journal is ready", time:'15:00', roles:['Parent'], parentId:'PAR-1', read:false },
    { id:'N7', text:'ครูเอ ส่งคำขอลาป่วย รออนุมัติ', textEN:'A Mana submitted a sick-leave request — pending', time:'08:00', roles:['Leader'], read:false },
  ],
  // staff attendance history (for teacher schedule calendar)
  // staff attendance history (with Out times to verify OT: schedule out 17:00, ≥50 min → +1 hr)
  staffAttendanceHistory: [
    { Date:'2026-06-02', StaffID:'STF-L1', In:'07:28', Out:'17:05' }, { Date:'2026-06-02', StaffID:'STF-T1', In:'07:55', Out:'17:55' }, { Date:'2026-06-02', StaffID:'STF-T2', In:'08:05', Out:'17:00' },
    { Date:'2026-06-03', StaffID:'STF-L1', In:'07:30', Out:'18:50' }, { Date:'2026-06-03', StaffID:'STF-T2', In:'08:00', Out:'17:49' }, { Date:'2026-06-03', StaffID:'STF-H1', In:'07:02', Out:'16:00' },
    { Date:'2026-06-04', StaffID:'STF-L1', In:'07:25', Out:'17:50' }, { Date:'2026-06-04', StaffID:'STF-T1', In:'08:12', Out:'19:00' }, { Date:'2026-06-04', StaffID:'STF-T2', In:'08:12', Out:'17:30' }, { Date:'2026-06-04', StaffID:'STF-H1', In:'06:58', Out:'16:10' },
    { Date:'2026-06-05', StaffID:'STF-T1', In:'07:48', Out:'18:40' }, { Date:'2026-06-05', StaffID:'STF-T2', In:'08:03', Out:'17:00' },
  ],
  // manual attendance-time requests (ขอลงเวลา) + class-management change requests (ย้ายครูประจำชั้น/แผนก)
  attendanceReq: [],
  classChangeReq: [],
  // student daily check-in / out (for parent calendar + OT cross-check)
  studentCheckins: [
    { Date:'2026-06-02', StudentID:'STD-1', InTime:'07:55', OutTime:'17:20' },
    { Date:'2026-06-03', StudentID:'STD-1', InTime:'08:05', OutTime:'18:10' },
    { Date:'2026-06-04', StudentID:'STD-1', InTime:'07:48', OutTime:'16:50' },
    { Date:'2026-06-05', StudentID:'STD-1', InTime:'08:00', OutTime:'17:35' },
    { Date:'2026-06-02', StudentID:'STD-2', InTime:'08:12', OutTime:'17:00' },
  ],
  // universal chat threads: keyed by studentId, fallback when parent not on LINE OA
  comments: [
    { CommentID:'CM-1', StudentID:'STD-1', ParentID:'PAR-1', SenderRole:'Parent', SenderName:'Ms.Karn', Message:'วันนี้บีมงอแงนิดหน่อยค่ะ ฝากครูดูแลด้วยนะคะ', Timestamp:'2026-06-09 07:50', ReadStatus:'read' },
    { CommentID:'CM-2', StudentID:'STD-1', ParentID:'PAR-1', SenderRole:'Teacher', SenderName:'ครูเอ', Message:'รับทราบค่ะ เดี๋ยวครูดูแลเป็นพิเศษนะคะ 😊', Timestamp:'2026-06-09 08:05', ReadStatus:'read' },
  ],
  // editable PDPA capability matrix — what each role may see/do (Admin-toggleable)
  permMatrix: {
    Admin:   { students:true,  staff:true,  payroll:true,  parentPII:true,  edit:true,  approve:true },
    Leader:  { students:true,  staff:true,  payroll:false, parentPII:true,  edit:false, approve:true },
    Teacher: { students:true,  staff:false, payroll:false, parentPII:false, edit:false, approve:false },
    Parent:  { students:true,  staff:false, payroll:false, parentPII:false, edit:false, approve:false },
  },
  // user permissions matrix (PDPA) — what each role can see
  permissions: [
    { Role:'Admin',   scope:'ทุกข้อมูล', students:'ทั้งหมด', staff:'ทั้งหมด', payroll:'ดู/แก้ไข', parentPII:'ดู/แก้ไข' },
    { Role:'Leader',  scope:'แผนกที่ดูแล + ลูกน้อง', students:'ในแผนก', staff:'ลูกน้อง', payroll:'ของตนเอง', parentPII:'ในแผนก (จำกัด)' },
    { Role:'Teacher', scope:'ชั้นเรียนที่รับผิดชอบ', students:'ในชั้น', staff:'-', payroll:'ของตนเอง', parentPII:'ติดต่อฉุกเฉินเท่านั้น' },
    { Role:'Parent',  scope:'บุตรหลานของตนเอง', students:'บุตรหลาน', staff:'-', payroll:'-', parentPII:'ของตนเอง' },
  ],
});


function b(from,to,label,items){ return items.map(it=>({AgeFrom:from,AgeTo:to,AgeLabelTH:label,ItemNo:it[0],Skill:it[1],Description:it[2]})); }
function a(aid,sid,age,item,skill,res,date){ return {AssessmentID:aid,StudentID:sid,AgeMonth:age,ItemNo:item,Skill:skill,Result:res,Date:date,TeacherID:'STF-T1'}; }
