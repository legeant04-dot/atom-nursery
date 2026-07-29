/* i18n_tr.js — runtime TH->EN translator for any Thai literals still in the rendered DOM.
   Used together with i18n.js (window.LANG/t). When LANG=en, translateTree() rewrites
   text nodes + placeholders using TR_DICT; a MutationObserver re-runs it on async updates. */
(function () {
  var TR_DICT = {
    // generic
    'หน้านี้กำลังพัฒนา':'Under development','เปิดเมนูเบราว์เซอร์ → Add to Home Screen':'Open the browser menu → Add to Home Screen',
    'เข้าสู่ระบบผ่าน':'Signed in via','ไม่มีรายการ':'No items','ยังไม่มีรายการ':'No items yet','ยังไม่มีประวัติ':'No history yet',
    'ไม่มีคำขอรออนุมัติ':'No pending requests','ยังไม่มี':'None yet','เบอร์โทร (OTP)':'Phone (OTP)',
    '/คน':'/person',' คน':' people','ราย นร.':'/student','แก้สิทธิรายบุคคลจะเปิดเมื่อเชื่อม GAS':'Per-user permissions open after GAS is connected',
    // parent journal/home
    'รายละเอียด:':'Details:','รวม:':'Total:','แจ้งลาบุตรหลาน':'Report child absence','+ แจ้งลา':'+ Report',
    'บันทึกของ':'Record of','วันนี้':'today','ประกาศจากโรงเรียน':'School announcements','บุตรหลาน':'Child',
    'รับ-ส่ง':'Pickup','พัฒนาการ':'Development','ลาป่วย':'Sick Leave','ลากิจ':'Leave of absence','ลาพักร้อน':'Holiday Leave',
    'วันที่ลา':'Leave date','เหตุผล':'Reason','เช่น ลากิจ / ไม่สบาย':'e.g. personal / sick','ส่งแจ้งลา':'Submit absence',
    'แจ้งลาแล้ว — ครูได้รับทราบ':'Absence reported — teacher notified','เลือกบุตรหลาน':'Select child',
    'ส่งเข้าเรียน (IN)':'Drop off (IN)','รับกลับ (OUT)':'Pick up (OUT)','ยืนยันที่โรงเรียน (จำลองในรัศมี)':'Confirm at school (within radius)',
    'ทดสอบนอกรัศมี':'Test outside radius','รัศมี':'Radius','ประวัติการรับ-ส่ง':'Pickup history','ดูในปฏิทิน →':'See calendar →',
    'ส่งเข้าเรียน':'Drop off','รับกลับ':'Pick up','แจ้งครูแล้ว':'teacher notified','ระยะ':'distance','ย้อนหลัง':'History',
    'รอคุณครูส่งข้อมูลของวันที่':'Waiting for teacher to submit for',
    // payment / slip
    'สแกนเพื่อชำระ':'Scan to pay','ใส่รูป QR จริงใน config':'Add the real QR image in config','ยอด':'Amount','บาท':'THB',
    'แนบสลิปการโอน (จำเป็น)':'Attach transfer slip (required)',
    'ยืนยันการชำระโดยแนบสลิปเท่านั้น · ไฟล์จะถูกเก็บไว้ในเครื่อง (Local) เพื่อให้เจ้าหน้าที่นำไปบันทึก':'Confirm payment by attaching a slip only · the file is stored on the device (Local) for staff to record',
    'เลือกไฟล์สลิป':'Choose slip file','อัปโหลดสลิป':'Upload slip','กรุณาเลือกไฟล์สลิป':'Please choose a slip file',
    'แนบสลิปแล้ว — เก็บไว้ในเครื่อง (Local) รอเจ้าหน้าที่ตรวจสอบ':'Slip attached — stored locally, awaiting staff verification',
    'เงินเดือนของฉัน':'My payslip','ข้อมูลเงินเดือนเป็นความลับ — กรุณาใส่รหัสผ่านของคุณ':'Payroll is confidential — please enter your password',
    'รหัสผ่าน':'Password','ทดลอง:':'demo:','เข้าดูสลิป':'View payslip','รหัสผ่านไม่ถูกต้อง (ทดลองใช้ 1234)':'Wrong password (demo: 1234)',
    'งวด:':'Period:','ดาวน์โหลด / พิมพ์สลิปของฉัน':'Download / print my payslip','ดาวน์โหลด':'Downloaded',
    'สลิป ':'Payslip ','เงินเดือน':'Base salary','เบี้ยขยัน (มาครบ':'Diligence (attendance','รายได้อื่นๆ':'Other income',
    'ค่าสวงเวลาตอนเย็น':'Evening OT','เงินพิเศษวันพักผ่อนปี 68':'2025 holiday bonus','เงินพิเศษวันพักผ่อน':'Holiday bonus','รวมรายได้':'Gross income',
    'หัก ประกันสังคม':'Less: Social security','หัก เงินสมทบ/อื่นๆ':'Less: Contribution/Other','โอนเข้า':'Transfer to','สุทธิ':'net',
    // slip print doc
    'รายได้':'Income','รายการหัก':'Deductions','ประกันสังคม':'Social security','เงินสมทบ':'Contribution',
    'รวมหัก':'Total deductions','เบี้ยขยัน':'Diligence','ชื่อ:':'Name:','รหัส:':'ID:','พิมพ์:':'Printed:','งวด ':'Period ',
    'มาครบ ไม่ลา ไม่สาย':'full attendance','โพสต์ FB':'FB post','เด็กคนที่ 31+':'children #31+','ใบประกาศ':'certificate','สูงสุด 2':'max 2',
    'พิมพ์ (3 สลิป/แผ่น A4 แนวนอน)':'Print (3 slips per A4 landscape)','พิมพ์สลิป 3/แผ่น A4':'Print slips (3/A4)',
    // teacher
    'เวลาทำงานวันนี้':"Today's work time",'เข้างาน':'Check in','ออกงาน':'Check out','สาย':'Late','นาที':'min','ตรงเวลา':'on time',
    'การลาของฉัน · สิทธิคงเหลือ':'My leave · remaining','สิทธิคงเหลือ':'Remaining leave','+ ยื่น/ดูใบลา':'+ Submit / view leave',
    'คำขอลาของลูกน้อง (รออนุมัติ)':'Team leave requests (pending)','รออนุมัติ — คำขอของลูกน้อง':'Pending — team requests',
    'นอกรัศมี':'outside radius','กรอกบันทึก —':'Journal —','ประเมิน DSPM —':'Assess DSPM —','ประเมิน DSPM':'Assess DSPM',
    'รายละเอียดสุขภาพ/ยา':'Health / medication details','ปริมาณนม oz คั่นด้วย , เช่น 6,4':'Milk oz, comma-separated e.g. 6,4',
    'เช่น 12:30-14:00 (คั่นหลายช่วงด้วย ,)':'e.g. 12:30-14:00 (separate with comma)','เหตุการณ์น่าประทับใจ... (กดไมค์เพื่อพูด)':'A memorable moment... (tap mic to speak)',
    'บันทึก & แจ้งผู้ปกครอง':'Save & notify parent','เบราว์เซอร์นี้ไม่รองรับ Voice — ใช้ Chrome บนมือถือ/คอม':"This browser doesn't support voice — use Chrome",
    'ฟัง...':'listening...','ฟังไม่สำเร็จ ลองใหม่':'Could not hear, try again','อัปเดตบันทึกแล้ว — แจ้งผู้ปกครอง':'Journal updated — parent notified',
    'บันทึกแล้ว — แจ้งผู้ปกครอง':'Saved — parent notified','ช่วงอายุ:':'Age band:',
    'เลือก "ยังไม่ได้ประเมิน" ได้ เพื่อให้ผู้ปกครองทราบว่ายังมีหัวข้อที่ต้องประเมิน · เทียบกับคู่มือที่ดาวน์โหลด':'You can pick "Not assessed" so parents know which items remain · compare with the downloaded manual',
    'ดาวน์โหลดคู่มือ DSPM':'Download DSPM manual','เดิม:':'prev:','บันทึกผลประเมิน':'Save assessment','บันทึกผลประเมินแล้ว — แจ้งผู้ปกครอง':'Assessment saved — parent notified',
    'กรุณาเลือกผลอย่างน้อย 1 ข้อ':'Please select at least 1 item','ยื่นใบลา':'Submit leave','ประเภท':'Type','วันที่เริ่ม':'From','ถึงวันที่':'To',
    'ส่งคำขอ':'Submit request','คำขอของฉัน':'My requests','อนุมัติ(ส่งต่อ Admin)':'Approved (forwarded to Admin)',
    'ขั้น1:':'Step 1:','ขั้น2:':'Step 2:','ข้ามแผนก':'cross-dept','เวลาทำงาน & การลา':'Work schedule & leave',
    'เวรส่งนักเรียน':'Student drop-off duty','สรุปรายวัน':'Daily summary','การลาที่อนุมัติแล้ว (วางแผนสับเปลี่ยน)':'Approved leave (for coverage)',
    'อักษรย่อ = พนักงานที่มาทำงานวันนั้น':'Initials = staff who worked that day','ปฏิทิน':'Calendar','ล็อก':'Lock',
    // admin
    'นักเรียนแต่ละชั้นวันนี้':'Students by class today','+ ประกาศ':'+ Announce','(ลา)':'(Leave)','(ยังไม่มา)':'(Not arrived)',
    'พนักงานวันนี้':'Staff today','เพิ่มประกาศ':'Add announcement','หัวข้อ':'Title','แนบรูป (ไม่บังคับ)':'Attach image (optional)',
    'บันทึกประกาศ':'Save announcement','ใส่หัวข้อ':'Enter a title','เพิ่มประกาศแล้ว':'Announcement added',
    'อนุมัติการลา (ขั้นสุดท้าย)':'Leave approval (final)','ผ่านหัวหน้างาน:':'Approved by leader:','อนุมัติ':'Approve','ปฏิเสธ':'Reject',
    'เงินเดือน & สลิป':'Payroll & slips','พนักงาน':'Staff','งวด (เดือน)':'Period (month)','โพสต์ Facebook (+500)':'Facebook post (+500)',
    'มาครบ ไม่ลา ไม่สาย (+500)':'Full attendance, no leave/late (+500)','เด็กคนที่ 31+ (×300)':'Children #31+ (×300)','ใบประกาศ (สูงสุด 2 ×100)':'Certificates (max 2 ×100)',
    'OT เย็น':'Evening OT','เงินสมทบ (หัก)':'Contribution (deduct)','หักอื่นๆ':'Other deductions','คำนวณ & บันทึกแล้ว':'Calculated & saved','คำนวณ':'Calculate',
    'ยังไม่มีสลิป':'No slips yet','ผ่านเฉลี่ย':'avg pass','ดูราย นร.':'View student','กลับหน้าวิเคราะห์':'Back to analytics',
    'อายุปัจจุบัน':'Current age','เข้าเรียน':'enrolled','แสดงทุกช่วงวัยที่เด็กผ่านมา (ตั้งแต่เข้าเรียน) เพื่อดูพัฒนาการต่อเนื่อง':'Shows every age band reached (since enrollment) for continuous development',
    'จัดการข้อมูล & สิทธิ':'Manage data & permissions','สิทธิการเข้าถึงข้อมูล (PDPA)':'Data access permissions (PDPA)',
    'กำหนดว่าผู้ใช้แต่ละบทบาทเห็นข้อมูลอะไรได้ (รวมข้อมูลส่วนบุคคลของผู้ปกครอง)':"Define what each role can see (including parents' personal data)",
    'บทบาท':'Role','ขอบเขต':'Scope','นักเรียน':'Students','ข้อมูลผู้ปกครอง':'Parent data','แก้ไขสิทธิ':'Edit permissions',
    'การบังคับลงเวลา (Check-in/out)':'Check-in/out requirement','ปิดสำหรับตำแหน่งที่ไม่ต้องลงเวลา (เช่น หัวหน้างาน)':"Turn off for roles that don't clock in (e.g. leaders)",
    'เปิดการบังคับลงเวลา':'Check-in required ON','ปิดการบังคับลงเวลา':'Check-in required OFF','* เพิ่ม/แก้ไข/ลบ จะเปิดเมื่อเชื่อม GAS':'* Add/edit/delete enabled after GAS is connected',
    'เดือน':'mo','ข้อ ':'Item ','แพ้:':'Allergy:','แพ้ ':'Allergy ','ตำแหน่งนี้ไม่มีสิทธิ์อนุมัติ':'This role cannot approve',
    'มา ':'In ','กลับ ':'Out ','ขาด ':'Absent ',
    // staff positions
    'ผู้อำนวยการ':'Director','หัวหน้าชั้น':'Head teacher','ครูประจำชั้น':'Class teacher','ครูผู้ช่วย':'Assistant teacher','แม่บ้าน':'Housekeeper','ครู':'Teacher','พี่เลี้ยง':'Nanny',
    // PDPA permission details
    'ทุกข้อมูล':'All data','แผนกที่ดูแล + ลูกน้อง':'Own dept + team','ในแผนก (จำกัด)':'In dept (limited)','ในแผนก':'In dept','ลูกน้อง':'Team','ของตนเอง':'Own',
    'ชั้นเรียนที่รับผิดชอบ':'Assigned class','ในชั้น':'In class','ติดต่อฉุกเฉินเท่านั้น':'Emergency contact only','บุตรหลานของตนเอง':'Own children','บุตรหลาน':'Own child','ดู/แก้ไข':'View/Edit','ทั้งหมด':'All',
    // allergies / leave reasons (mock free-text)
    'นมวัว':'Cow milk','เป็นไข้':'Fever','ธุระครอบครัว':'Family matter','ปวดหัว':'Headache','พาไปหาหมอ':'Doctor visit','ธุระ':'Errand','ไข้':'Fever',
    // relationships / pickup / misc data labels (2026 expansion)
    'มารดา':'Mother','บิดา':'Father','ผู้ปกครอง':'Guardian','ยาย':'Grandmother','ย่า':'Grandmother','ปู่':'Grandfather','ตา':'Grandfather',
    'พนักงานบริษัท':'Company employee','วิศวกร':'Engineer','กรุงเทพประกันภัย':'Bangkok Insurance',
    // absence follow-up statuses + reasons
    'กำลังติดตาม':'Following up','ติดตามแล้ว':'Followed up','ลายาว':'Long leave','ออกกลางคัน':'Withdrew','ไม่สบาย':'Sick','ค่าเรียนพิเศษภาษาไทย':'Thai special class','โทรหาผู้ปกครองแล้ว เด็กเป็นหวัด':'Called parent — child has a cold',
    // misc
    'แรกเกิด':'New Born','ประกาศ':'Announcements','สีและรูปทรง':'Colors & shapes',
    // phrases containing 'บันทึก' — without these the longest-first substring pass yields "แก้ไขRecord"
    'แก้ไขบันทึก':'Edit Report','ดูบันทึก':'View Report','บันทึกร่าง':'Save draft','ส่งให้ผู้ปกครอง':'Submit to parent',
    // short whole-node labels (exact match only)
    'ดู':'View','ปิด':'Close','ลา':'Leave','คน':'people','เปิด':'ON','บันทึก':'Record','ประเมิน':'Assess'
  };
  var _keys = null;
  window.trPhrase = function (s) {
    if (window.LANG && window.LANG() !== 'en') return s;
    if (s == null) return s; s = String(s);
    if (!_keys) _keys = Object.keys(TR_DICT).sort(function (a, b) { return b.length - a.length; });
    var trimmed = s.trim();
    if (trimmed && TR_DICT[trimmed]) return s.replace(trimmed, TR_DICT[trimmed]);
    var out = s;
    for (var i = 0; i < _keys.length; i++) { var k = _keys[i]; if (k.length >= 3 && out.indexOf(k) >= 0) out = out.split(k).join(TR_DICT[k]); }
    return out;
  };
  // This dictionary substitutes word-by-word, which is fine for UI copy but mangles DATA — a staff
  // group called "ครูประจำ" came out as "Teacherประจำ". Anything inside translate="no" (the standard
  // HTML attribute) or [data-notr] is therefore left exactly as stored: names, group names,
  // addresses, and anything else the school typed in.
  var SKIP = '[translate="no"],[data-notr]';
  var skipped = function (node) { var el = node.parentElement; return !!(el && el.closest && el.closest(SKIP)); };
  window.translateTree = function (root) {
    if (!window.LANG || window.LANG() !== 'en' || !root) return;
    var wk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), arr = [];
    while (wk.nextNode()) arr.push(wk.currentNode);
    arr.forEach(function (n) { var v = n.nodeValue; if (!v || !v.trim() || skipped(n)) return; var nv = window.trPhrase(v); if (nv !== v) n.nodeValue = nv; });
    if (root.querySelectorAll) root.querySelectorAll('[placeholder]').forEach(function (el) {
      if (el.closest && el.closest(SKIP)) return;
      var nv = window.trPhrase(el.getAttribute('placeholder')); if (nv) el.setAttribute('placeholder', nv); });
  };
})();
