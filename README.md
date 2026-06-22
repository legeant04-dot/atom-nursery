# Atom Nursery — Web Application (GAS + Google Sheets + LINE LIFF)

ระบบบริหารจัดการโรงเรียนอนุบาลแบบครบวงจร ตาม Proposal v2.1.
ควบคุมผ่าน Gmail บัญชีเดียว `atomnursery.system@gmail.com` —
Backend = Google Apps Script, Database = Google Sheets (2 Workbooks), Frontend = LINE LIFF.

## ▶️ ลองใช้งาน Web App ได้เลย (ยังไม่ต้องต่อ LINE)

prototype รันด้วย **mock data** ในเบราว์เซอร์ — ลองทั้ง 3 portal ได้จริง:
```bash
node tools/serve.js          # แล้วเปิด http://localhost:8080
```
- เลือกบทบาท: **ผู้ปกครอง / คุณครู / หัวหน้าชั้น(Leader) / Admin** (เมื่อต่อ LINE จะรู้บทบาทอัตโนมัติ)
- โลโก้ (PNG โปร่งใส) มุมบนซ้าย · สถานะผู้ใช้ (อักษรอังกฤษ K/B) มุมบนขวา · เมนูล่างเลื่อนได้
- **ผู้ปกครอง:** หน้าหลักโชว์บันทึกวันนี้ (ฟอร์มเปล่าถ้ายังไม่มี ตามต้นแบบ Atom Journal) + แจ้งลา + ปฏิทิน + ไอคอน LINE/FB/Website · รับ-ส่ง GPS · **ชำระเงิน (QR + แนบสลิป)** · พัฒนาการ DSPM (โชว์ทุกข้อ + "ยังไม่ได้รับการทดสอบ") · แชท (เวลาท้องถิ่น)
- **คุณครู:** หน้าหลักโชว์เวลาเข้า-ออก+สาย, สิทธิลาคงเหลือ · บันทึก (checklist เต็ม + **ปุ่มไมค์พิมพ์ด้วยเสียง**) · ประเมิน (มี "ยังไม่ได้ประเมิน") · ลางาน (Leader เห็นคำขอลูกน้องแยก) · **ตารางการทำงาน** · **สลิปเงินเดือน**
- **Admin:** แดชบอร์ดสรุปการมา/ลา/ขาด รายชั้น+รายพนักงาน · 🔔 แจ้งเตือน · อนุมัติลา · เงินเดือน+พิมพ์สลิป 3/A4 · วิเคราะห์ DSPM (ปุ่ม Back + ทุกช่วงวัยของเด็ก) · จัดการ+**สิทธิ PDPA** · **แชทกำกับดูแล** (เห็นแชทผู้ปกครอง↔ครู)
- **PWA ติดตั้งลงมือถือได้** (manifest + service worker) → เปิดในมือถือแล้ว "เพิ่มลงหน้าจอโฮม" ใช้งานเหมือนแอป (ปุ่ม "📲 ติดตั้งลงมือถือ" ที่หน้าเลือกบทบาท)
- **ปุ่มสลับภาษา EN/TH** มุมขวาบน · **กระดิ่งแจ้งเตือน 🔔 ทุกบทบาท** (ฟีดตามบทบาท)
- รหัสผ่านดูสลิป (ทดลอง) = **1234** · สลิปการชำระเงินเก็บใน `localStorage` (Data Local)
- โค้ดอยู่ใน `webapp/` — `api.js` เป็นตัวกลาง: ตอนนี้ `MODE='mock'`; พอ deploy GAS เสร็จเปลี่ยนเป็น `MODE='gas'` + ใส่ `GAS_URL` ที่เดียว UI ไม่ต้องแก้
- เปลี่ยนโลโก้จริง: วางไฟล์ทับ `webapp/assets/logo.png` (โปร่งใส) — ตอนนี้ใช้ `tools/make_logo_png.js` แปลงจาก 25840 logo.jpg
- ระหว่างพัฒนา service worker เป็น **network-first** (โหลดโค้ดใหม่เสมอ, ใช้ cache เฉพาะตอนออฟไลน์)

## โครงสร้างโปรเจกต์ (ปัจจุบัน — ถึง Day 3)

```
Atom/
├─ src/
│  ├─ appsscript.json   # GAS manifest (timezone Asia/Bangkok, scopes, web app)
│  ├─ Config.gs         # SCHEMA ของทุก Sheet + ค่า SCHOOL_CONFIG เริ่มต้น (single source of truth)
│  ├─ Setup.gs          # setupAll() สร้าง 2 Workbooks + Headers + seed / verifyDay1()
│  ├─ Dspm_Seed.gs      # DSPM_CRITERIA starter data (รอ OCR คู่มือจริงมาแทน)
│  ├─ Db.gs             # data-access layer (อ่าน/เขียน Sheet แบบ object, nextId_, getConfig_)
│  ├─ Audit.gs          # logAudit / logAuditHr (PDPA §11)
│  ├─ Line.gs           # verifyLineAccessToken_ / linePush_ (LINE Messaging API)
│  ├─ Auth.gs           # Day 2: login, role, สร้าง account, hash password, เปลี่ยนรหัส
│  ├─ Code.gs           # Day 2: doGet/doPost router + ROUTES + bootstrapAdmin()
│  ├─ Checkin.gs        # Day 3: GPS check-in/out, Haversine, สาย/OT, แจ้งเตือน, reminder
│  └─ Triggers.gs       # Day 3/7: installTriggers() (forgot check-in/out, daily backup)
├─ tools/
│  └─ ocr_dspm.js       # OCR คู่มือ DSPM → dspm_ocr/ (draft, ต้อง proofread)
└─ README.md
```

### Backend modules ที่ทำแล้ว
- **Day 2 (Auth/Role):** `doPost` รับ `{action, payload}` → ROUTES → ตอบ `{ok, data|error}`
  actions: `ping`, `auth`, `changePassword`, `staffCheckin`, `staffCheckout`
  - `auth`: verify LINE token → ค้น USERS → คืน Role; unknown = `NOT_REGISTERED`
  - account ใหม่ = สถานะ `MUST_CHANGE_PASSWORD` (บังคับเปลี่ยนรหัสครั้งแรก), hash SHA-256+salt
- **Day 3 (GPS Attendance):** `staffCheckin` / `staffCheckout`
  - geofence รัศมีจาก SCHOOL_CONFIG, คำนวณสาย (เทียบ WORK_SCHEDULE/ค่า default) + OT เย็น
  - แจ้ง LINE หา Admin ทุกครั้ง, trigger เตือนลืม check-in (08:00)/out (18:30)
- **Day 4 (Leave + Parent):** `submitLeave` / `approveLeave` / `myLeaves` / `pendingLeaves` / `parentCheckin` / `studentAbsence`
  - Leave 2-step: Staff→Leader→Admin; Leader/Admin ที่ลาเองข้ามไป Admin; cross-dept แจ้ง Leader เจ้าของแผนก+Admin พร้อม tag ผู้อนุมัติ
  - Parent GPS check-in/out (CHECKIN_STUDENT) + แจ้งลานักเรียน (LEAVE_REQUEST_STD) → แจ้งครูประจำชั้นผ่าน LINE
- **Day 5 (Journal + DSPM):** `submitJournal`/`getJournal`/`journalHistory` · `dspmCriteria`/`submitAssessment`/`studentAssessment`/`classAssessment`/`dspmManual`
  - Daily Journal ครบทุก field (Mood/Health/Milk/Meals/Sleep/Toilet/Activity/Skills/Highlight), เก็บ field ซับซ้อนเป็น JSON, บังคับ field จำเป็น, แจ้งผู้ปกครอง
  - DSPM: ดึงเกณฑ์ตามอายุเด็ก (Track=Teacher) → บันทึก ผ่าน/ไม่ผ่าน → สรุปราย นร./ราย ชั้นเรียนให้ Admin; ดาวน์โหลดคู่มือ PDF จาก Drive (`DspmManualFileId`)
- **Payroll + Slip:** `computePayroll`/`getPayslip` + พิมพ์สลิป `GET <exec-url>?view=slips&month=YYYY-MM[&staffId=..]`
  - คำนวณครบ: เบี้ยขยัน (มาครบ auto + FB), รายได้อื่นๆ (เด็ก#31+ / ใบประกาศ cap 2), OT เย็น, เงินพิเศษ, ประกันสังคม (cap), เงินสมทบ, อื่นๆ → NetPay เข้า SCB
  - สลิป HTML: **3 สลิป/แผ่น A4 แนวนอน + เส้นประตัด ✂** (ปุ่มพิมพ์ในตัว) — ตัวอย่าง: `samples/salary_slips_sample.html`
- หลัง deploy: รัน `bootstrapAdmin("<LINE userId>")` ครั้งเดียวเพื่อสร้าง Admin คนแรก, และ `installTriggers()`

### การทดสอบ (ไม่ต้องมี Google account)
รันด้วย Node ผ่าน in-memory mock ของ GAS:
```bash
cd tools
node test_day4.js     # 20/20 — leave workflow + parent check-in
node test_day5.js     # 35/35 — DSPM assessment + journal + payroll + slip
node preview_slips.js # สร้าง samples/salary_slips_sample.html (เปิดในเบราว์เซอร์ → Ctrl+P)
```
harness: `tools/gas_test_harness.js` (จำลอง SpreadsheetApp/Utilities/UrlFetchApp/ScriptApp/HtmlService + ดัก LINE push)

### DSPM — ตารางเกณฑ์ประเมิน (draft — รอ proofread)
- `tools/ocr_dspm.js` → OCR ทั้งเล่ม → `dspm_ocr/dspm_ocr_raw.txt` + ภาพทุกหน้า `dspm_ocr/pages/page-NNN.png`
- `tools/build_dspm_csv.js` → **`dspm_ocr/DSPM_CRITERIA_draft.csv`** = ตารางสรุป (หน้า 79-83) ครบ **139 ข้อ** (1-139)
  - Track `Teacher` (93 ข้อ, หน้า 79-81) = ที่ครูใช้ประเมินตามอายุนักเรียน; Track `HealthPersonnel` (46 ข้อ, หน้า 82-83) = คัดกรอง 9/18/30/42/60 เดือน
  - คอลัมน์ 1-9 ตรงกับ sheet `DSPM_CRITERIA` พอดี → proofread แล้ว **วางทับได้เลย**
- **ขั้นตอน proofread → ใช้งาน:**
  1. เปิด `DSPM_CRITERIA_draft.csv` เทียบกับภาพหน้า `dspm_ocr/pages/page-079..083.png`
  2. แก้แถวที่ `NeedsReview=Y` ก่อน (ข้อ 11,14,22,67,119,121,122,123,127,128) + เติม Method/PassCriteria จากหน้า 13-78 ถ้าต้องการ
  3. วางคอลัมน์ AgeFrom..Track ลงในชีต `DSPM_CRITERIA`
- ⚠️ **ยังไม่โหลดอัตโนมัติ** — `setupAll()` เว้นชีตนี้ว่างไว้จนกว่าคนจะตรวจ (clinical, ห้ามผิดตามที่ย้ำ)
- การประเมินของครู: คำนวณอายุเด็ก (เดือน) → เลือกแถวที่ AgeFrom ≤ อายุ ≤ AgeTo, Track=Teacher → แสดงครบ 5 ด้าน (ตามตัวอย่าง: เด็ก 13 เดือน → แถว 13-15)

### หมายเหตุ schema เพิ่มจากแชท (Salary Slip / Leave Form)
- `STAFF` เพิ่ม **Department / PositionLevel / ReportsTo** (org: Nursery 0–3 × Admin/Leader/Officer/Assistant/Staff)
- `LEAVE_REQUEST` เป็น **2-step** (Leader → Admin) + cross-dept flag
- `PAYROLL` แตกราย: เบี้ยขยัน (attendance+FB), รายได้อื่นๆ (เด็ก #31+, ใบประกาศ), OT เย็น, เงินพิเศษ, ประกันสังคม, เงินสมทบ → NetPay เข้า SCB
- SCHOOL_CONFIG เพิ่ม key อัตราต่างๆ (DiligenceAttendanceAmount, ExtraChildRate, ...)

## ฐานข้อมูล — 2 Workbooks

**Workbook 1 — `AtomNursery_Main` (ข้อมูลโรงเรียน) — 15 Sheets**
STUDENTS · CLASSES · PARENTS · CHECKIN_STUDENT · DAILY_JOURNAL · DSPM_ASSESSMENT ·
BILLING · ANNOUNCEMENTS · LEAVE_REQUEST_STD · USERS · DSPM_CRITERIA · SCHOOL_CONFIG ·
AUDIT_LOG · BACKUP_LOG · **COMMENTS**

**Workbook 2 — `AtomNursery_HR` (ข้อมูล HR — ลับ) — 8 Sheets**
STAFF · CHECKIN_STAFF · LEAVE_REQUEST · OT_RECORDS · PAYROLL · TRAINING ·
WORK_SCHEDULE · **AUDIT_LOG**

> **หมายเหตุ (ต้องยืนยัน):** Proposal §7 ระบุชื่อ Sheet ไว้ 14 (WB1) + 7 (WB2)
> แต่แผนงาน Day 1 ระบุ **15 + 8**. จึงเพิ่ม 2 Sheet ที่อนุมานจากฟีเจอร์:
> - `COMMENTS` (WB1) — แชทผู้ปกครอง↔โรงเรียน (§4 "Comments — สื่อสารกับโรงเรียน / ประวัติการสนทนา")
> - `AUDIT_LOG` (WB2) — Log การเข้าถึงข้อมูล HR ที่เป็นความลับ (ข้อกำหนด PDPA §11)
>
> หากโรงเรียนตั้งใจให้เป็น Sheet อื่น แก้ที่ `SCHEMA` ใน `Config.gs` แล้วรัน `setupAll()` ซ้ำได้เลย

## วิธี Deploy & รัน Day 1

### ตัวเลือก A — clasp (CLI, แนะนำ)
```bash
npm install -g @google/clasp
clasp login                       # ล็อกอินด้วย atomnursery.system@gmail.com
clasp create --type standalone --title "Atom Nursery Backend" --rootDir ./src
clasp push                        # อัปโหลด appsscript.json + ไฟล์ .gs ทั้งหมด
clasp open                        # เปิด editor เพื่อรันฟังก์ชัน
```

### ตัวเลือก B — วางโค้ดเอง
1. เปิด https://script.google.com (ล็อกอินด้วย `atomnursery.system@gmail.com`) → New project
2. สร้างไฟล์ตามนี้แล้ววางเนื้อหาจาก `src/`: `Config.gs`, `Setup.gs`, `Dspm_Seed.gs`
3. Project Settings → "Show appsscript.json" → วางเนื้อหา `appsscript.json`

### รัน
1. ในเมนูฟังก์ชัน เลือก **`setupAll`** → Run → อนุมัติ OAuth scopes ครั้งแรก
   - สร้าง 2 Workbooks ใน Drive อัตโนมัติ + เก็บ Spreadsheet ID ไว้ใน Script Properties
   - สร้างทุก Sheet + Headers + seed `SCHOOL_CONFIG` + `DSPM_CRITERIA` (starter)
   - ดู URL ของทั้ง 2 ไฟล์ได้ใน View → Logs
2. รัน **`verifyDay1`** → ดู Logs ต้องขึ้น `RESULT: PASS ✅`

> รัน `setupAll()` ซ้ำได้ปลอดภัย (idempotent): ใช้ Workbook เดิม, เติม Sheet/Header/Key ที่ขาด, ไม่ลบข้อมูลเดิม

## ✅ Day 1 Verification Checklist (ตาม Proposal §9)

`verifyDay1()` ตรวจให้อัตโนมัติ:
- [ ] เปิด Sheet ทุกแผ่น — Column Headers ครบถ้วนตามเอกสาร (15 + 8 sheets)
- [ ] `SCHOOL_CONFIG` มีทุก Key ที่ระบบต้องการ (GPS_Lat, GPS_Lng, Radius, QRCode, HolidayList, LINE/LIFF ...)

ตรวจด้วยมือ (ต้องกรอกข้อมูลจริง):
- [ ] กรอก `SCHOOL_CONFIG`: `QRCode` (PromptPay), `LineChannelAccessToken`, `LineChannelSecret`, `LiffID`, `AdminLineUID`, `HolidayList`
- [ ] กรอก `DSPM_CRITERIA` ให้ครบทุกช่วงอายุตามคู่มือกระทรวงสาธารณสุข (ตอนนี้เป็น starter เท่านั้น)
- [ ] กรอก `STAFF` + `WORK_SCHEDULE` (พนักงานทุกคน, Role ถูกต้อง)
- [ ] กรอก `STUDENTS` + `CLASSES` + `PARENTS` (นักเรียนเริ่มต้น)

## สิ่งที่ต้องเติม/ตัดสินใจก่อนไป Day 2
- **Radius**: Day-1 ตั้งไว้ `20` m แต่ §12 แนะนำ `30` m เพื่อชดเชย GPS drift — โปรดยืนยัน
- **DSPM_CRITERIA**: ข้อมูลปัจจุบันเป็นตัวอย่าง 5 ช่วงอายุ × 5 ด้าน — ต้องใส่ตารางจริงทั้งหมด
- ค่า LINE/LIFF tokens (ได้จากขั้นตอน §10) และ PromptPay QR

## ถัดไป — Day 2 (GAS Backend)
`doGet`/`doPost` → LINE Auth → ค้นใน `USERS` → คืน Role → สร้าง Account อัตโนมัติ → `AUDIT_LOG`
(ดู Task list — เริ่มหลัง Day 1 ผ่านการยืนยัน)

---

# 🧩 Web App — รายการฟังก์ชันทั้งหมด (Prototype 2026, mock data)

> ทุกฟีเจอร์ทำงานจริงใน `webapp/` (vanilla JS บน mock API) · รองรับ **ไทย/อังกฤษ** ทุกหน้า ·
> `api.js` เป็น gateway เดียว (`MODE='mock'` → สลับเป็น `'gas'` หลัง deploy, UI ไม่ต้องแก้) ·
> schema ทั้งหมด sync ไว้ใน `src/Config.gs` แล้ว (รัน `setupAll()` เพิ่มชีต/คอลัมน์ที่ขาดแบบ idempotent)
> รันลอง: `node tools/serve.js` → http://localhost:8081 (หรือ 8080)

## เข้าสู่ระบบ & ลงทะเบียน
- Login 4 ช่องทาง (LINE / Google / เบอร์ OTP / Apple — เดโม) → **ผู้ใช้ใหม่ / เคยลงทะเบียน** → กดกลับได้ทุกขั้น · ปุ่มสลับภาษาคงหน้าเดิม
- **ลงทะเบียนใหม่:** ฟอร์มตามใบสมัคร PDPA (นักเรียน+ผู้ปกครอง) — เลขบัตร ปชช. นักเรียน(เป็นรหัสนักเรียน)/ผู้ปกครอง, อายุ "X ปี Y เดือน" สด, รูปถ่ายนักเรียน+ผู้ปกครอง, ผู้รับแทนสูงสุด 4, ยินยอม PDPA · **Plan กำหนดโดย Admin ภายหลัง**
- **เชื่อมข้อมูลนักเรียนเดิม:** ยืนยันด้วยเลขบัตร ปชช. นักเรียน (พ่อ login เพิ่มหลังแม่ลงทะเบียน) · รองรับหลายคน · **เห็นเฉพาะนักเรียนที่ผูกกับบัญชี** (data isolation ผ่าน `userLinks`)
- **คุณครู login:** ใช้เลขบัตร ปชช. เป็น username, รหัสตั้งต้น `1234`, **บังคับเปลี่ยนครั้งแรก** (8-15 ตัว มีพิมพ์เล็ก/ใหญ่/ตัวเลข) — ใช้ปลดล็อกสลิป

## ผู้ปกครอง (Parent)
- หน้าหลัก: การ์ดบุตรหลาน (รูปวงกลม, อายุ, Plan), บันทึกวันนี้, แจ้งลา, ประกาศ, **ปฏิทิน** (เวลารับ-ส่ง; **เวลารับสายเกินเกณฑ์ขึ้นสีแดง** เช็ค OT ง่าย), ไอคอน LINE/FB/Web · ปุ่ม **+ เพิ่มบุตรหลาน**
- รับ-ส่ง GPS: รับกลับเกิน Plan +21 นาที → **คิด OT 100฿/ชม. (ปัดขึ้น)** → เด้ง **QR KTB** (กดขยาย/เซฟ) + ปุ่มแนบสลิป
- **ชำระเงิน:** บิลรายเดือน (+OT ค้างยกมา + ค่าใช้จ่ายเพิ่มเติมรายคน) · **QR SCB** (กดขยาย/เซฟ) · แนบสลิป+ระบุยอด → **ตรวจยอดตรง=ชำระแล้ว / ไม่ครบ=ค้าง** · พยายามอ่าน QR ในรูปสลิป (EMVCo tag54) เติมยอดอัตโนมัติเมื่อทำได้ · **ใบเสร็จ** (พิมพ์/ดาวน์โหลด, โลโก้ 2 มุม) · **จ่ายล่วงหน้า** 2/3/6/12 เดือน ลด 5/10/20/30% (ระบบจำ+แสดงชำระล่วงหน้า)
- **ประกาศ Pop-up บังคับ:** ต้องกดปิดก่อนเช็คอิน/เอาท์ · Admin ตั้งช่วงวันแสดง · ติ๊ก "ไม่แสดงอีก"
- พัฒนาการ DSPM: ทุกข้อตามช่วงวัย + ย้อนหลัง · **กราฟน้ำหนัก/ส่วนสูง** เทียบเกณฑ์ปกติ (แสดงเลขบนจุด, กดดูค่า) + รายการบันทึกย้อนหลังพร้อมอายุ ณ ตอนวัด · แชท (LINE OA)

## คุณครู / หัวหน้าชั้น (Teacher / Leader)
- หน้าหลัก: เวลาเข้า-ออกวันนี้ + **ย้อนหลัง 3 วัน** (สถานะสาย/นาที) — **สายไม่เกิน 10 นาที = ไม่สาย** · "ออกงาน" = **เลิกงาน** · สิทธิลาคงเหลือ · นักเรียนในชั้น (รูปวงกลม)
- บันทึกประจำวัน (checklist + ไมค์พิมพ์เสียง) · **ประเมิน DSPM** + ช่อง **น้ำหนัก/ส่วนสูง/รูป ใต้แบบประเมิน** (บังคับอัปเดตเดือนคู่ 2,4,6,8,10,12 บันทึกเป็น record พร้อมอายุ)
- ลางาน (2 ขั้น Leader→Admin; **ลาข้ามปีไม่ได้**) · ตาราง+เวร+**สรุปจำนวนพนักงานต่อ Nursery (2/2)** · สลิปเงินเดือน (รหัส + **ปุ่มดาวน์โหลด**) · เปลี่ยนรหัสผ่าน
- **ติดตามการขาดเรียน:** เด็กลา/ขาด ≥2 และ ≥5 วัน + บันทึกผลติดตาม/สถานะ

## Admin
- แดชบอร์ด: มา/ลา/ขาด รายชั้น+พนักงาน · 🔔 แจ้งเตือนสรุปเงินเดือน (สิ้นเดือน-1) · 🗓️ รีเซ็ตวันลา (ทุกมกราคม)
- ปุ่มลัด: **💰 สรุปการเงิน** (ค่าเทอม/เงินเดือน/รายได้/รายจ่าย/คงเหลือ) · **📋 Daily Report** (สรุปทุกชั้น + พนักงานสาย + เตือนเด็กขาด 2/5 วัน + ส่ง LINE OA) · **🔎 ติดตามขาดเรียน** · + ประกาศ
- เงินเดือน: รายเดือน**หรือรายวัน** (ครูใหม่/พิเศษ) · checkbox ประกันสังคม · เรท×ตัวคูณต่อเด็ก + ปุ่ม "ใช้จำนวนที่นับได้" (Active − ขาด ≥6 วัน, เด็กคนที่ 31+ ถึงคิด) · **+ รายการคำนวน** (เช่น มาสาย -200) · ดาวน์โหลด/พิมพ์สลิป (โลโก้มุมขวา)
- จัดการ: **CRUD พนักงาน/ผู้ปกครอง** (รูป, วันเข้าทำงาน+อายุงาน) · CRUD นักเรียน (Plan, ประกัน, รูป) · **แผนก (Nursery) เพิ่ม/แก้/ลบ** · **กลุ่มพนักงาน+เวลา เพิ่ม/ลบ** · ย้าย Nursery (drag/dropdown) · วันหยุด DB · **Import/Export นักเรียน .xlsx** (ครบทุกฟิลด์ รวมรูป) · **ตั้งค่าเบี้ย/วันลา** · **ตรวจสอบ OT** · **สิทธิ PDPA = checkbox แก้ได้** · **แก้ไขผลประเมินนักเรียนได้ทุกข้อ**

## รายการ API actions (gateway `api(action, payload)`)
auth/scope: `getPlans, registerNew, linkExisting, findStudentByNationalID, staffAuth, changeStaffPassword` ·
parent: `parentChildren, parentCheckin, payments, uploadSlip, otDaily, payOT, prepay, prepayments, prepayDiscount, getJournal, journalHistory, studentAbsence, studentLeaves, dspmStatus, studentAllBands, growthHistory, calendar, announcements, activeAnnouncements, addComment` ·
teacher: `myAttendanceToday, recentAttendance, staffCheckin, staffCheckout, classList, submitJournal, submitAssessment, growthDue, updateGrowth, leaveQuota, submitLeave, approveLeave, myLeaves, teamPendingLeaves, schedule, staffingByNursery, getPayslip, computePayroll` ·
admin: `dashboard, financeSummary, dailyReport, payrollReminderDue, leaveResetReminder, listStaff/Students/Parents, saveStaff/Parent/Student, deleteStaff/Parent, listStaffGroups/addStaffGroup/deleteStaffGroup/setStaffGroupHours, listDepartments/addDepartment/renameDepartment/removeDepartment, payrollConfig/setPayrollConfig, ratedChildCount, otVerification, permMatrix/setPerm, holidays/addHoliday/removeHoliday, moveStudent/moveTeacher, exportStudent/importStudent/listExportedStudents, studentCharges/addStudentCharge/removeStudentCharge, absenceReport/setAbsenceFollowup, addAnnouncement, setLeaveQuota/getLeaveQuota, getConfigVal/setConfigVal`

## ไฟล์ใหม่ใน webapp/
- `growth_standard.js` — เกณฑ์น้ำหนัก/ส่วนสูง WHO/Amarin (ชาย/หญิง แรกเกิด–6 ปี) สำหรับกราฟ
- `xlsx_min.js` — เขียน/อ่าน .xlsx แบบออฟไลน์ (store-only zip + OOXML) สำหรับ Import/Export นักเรียน
- assets: `qr_scb.png` (รายเดือน), `qr_ktb.png` (OT), `logo-corner.jpg` (มุมขวาสลิป)

## ✅ สถานะการทดสอบ (Prototype)
- ตรวจผ่าน Claude Preview (DOM assertions) ทุก flow ของ 3 บทบาท — **ไม่มี console error**
- ตรวจกฎสำคัญแล้ว: OT 55 นาที→1 ชม., สาย ≤10 นาที=ไม่สาย, รายวัน 6500×3, จ่ายล่วงหน้า 3 เดือน-10%=17,550, ลาข้ามปีถูกปฏิเสธ, นับเด็กเรท (Active−ขาด≥6), Export→ลบ→Import ครบ 25/25 ฟิลด์ (รวมรูป), ตรวจสลิป 9000=ชำระ/8000=ค้าง
- regression backend เดิมยังผ่าน: `node tools/test_day4.js` (20/20), `node tools/test_day5.js` (35/35)
- ⚠️ การอ่านยอดจาก QR ในสลิปใช้ `BarcodeDetector` (Chrome/Edge); เบราว์เซอร์ที่ไม่รองรับให้กรอกยอดเอง
