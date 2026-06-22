# คู่มือย้ายระบบ + เชื่อมต่อ LINE/LIFF (Atom Nursery)

คู่มือนี้สำหรับ **ย้ายระบบไปไว้ในบัญชี Google ของโรงเรียน (ลูกค้า)** และเชื่อมต่อ LINE OA/LIFF
ให้ลูกค้าทำต่อเองได้ พร้อมแนวทางพัฒนา/แก้ไขในอนาคต

> ภาพรวมสถาปัตยกรรม: **Front-end (เว็บ/PWA หรือ LIFF) → Google Apps Script (GAS) → Google Sheets (2 Workbooks)**
> ข้อมูลทั้งหมดอยู่ใน Google Sheets ของบัญชี Gmail เดียว — ไม่มีเซิร์ฟเวอร์อื่น ไม่มีค่ารายเดือนฝั่ง Platform

---

## ส่วนที่ 1 — ต้องเตรียม/ย้ายอะไรบ้าง

| สิ่งที่ต้องมี | รายละเอียด | ใครเตรียม |
|---|---|---|
| Gmail ของโรงเรียน | เช่น `atomnursery.system@gmail.com` (ควบคุมทุกอย่าง) ตั้ง Recovery email/2FA | โรงเรียน |
| Google Sheets 2 ไฟล์ | `AtomNursery_Main` (15 sheets) + `AtomNursery_HR` (8 sheets) | สร้างอัตโนมัติด้วย `setupAll()` |
| โค้ด GAS | ไฟล์ใน `src/*.gs` + `appsscript.json` | ผู้พัฒนา push/วาง |
| LINE OA + LIFF | Channel ID/Secret + LIFF ID (โรงเรียนมี OA อยู่แล้ว = Case A) | โรงเรียน + ผู้พัฒนา |
| ข้อมูลตั้งต้น | รายชื่อครู/พนักงาน, นักเรียน, ผู้ปกครอง, เวลาเข้า-ออกงาน, QR PromptPay, พิกัด GPS | โรงเรียน |
| DSPM_CRITERIA | นำเข้าจาก `dspm_ocr/DSPM_CRITERIA_draft.csv` (proofread แล้ว) | โรงเรียน/ผู้พัฒนา |

**ข้อมูล (Data) ที่ต้องย้ายเข้า Google Sheets:** STAFF, WORK_SCHEDULE, STUDENTS, CLASSES, PARENTS, DSPM_CRITERIA, SCHOOL_CONFIG (คีย์สำคัญ: GPS, Radius, QR, LINE tokens, LIFF ID, อัตราเบี้ยขยัน/ประกันสังคม ฯลฯ)

---

## ส่วนที่ 2 — ขั้นตอนย้ายระบบ (ทำครั้งเดียว)

### 2.1 ติดตั้งฐานข้อมูล + Backend
1. ล็อกอิน Gmail ของโรงเรียน → เปิด https://script.google.com → **New project**
2. วางไฟล์จาก `src/`: `Config.gs, Setup.gs, Dspm_Seed.gs, Db.gs, Audit.gs, Line.gs, Auth.gs, Code.gs, Checkin.gs, Triggers.gs, Leave.gs, Parent.gs, Dspm.gs, Journal.gs, Payroll.gs, Slips.gs`
   - Project Settings → ติ๊ก "Show appsscript.json" → วางเนื้อหา `src/appsscript.json`
   - *(หรือใช้ `clasp`: `clasp login` → `clasp create --type standalone --rootDir ./src` → `clasp push`)*
3. รันฟังก์ชัน **`setupAll`** ครั้งเดียว → อนุมัติสิทธิ์ (OAuth) → ระบบสร้าง 2 Workbooks + ทุก sheet + headers + seed config
4. รัน **`verifyDay1`** → ดู Log ต้องขึ้น `RESULT: PASS ✅`

### 2.2 นำเข้าข้อมูลตั้งต้น
- เปิด Google Sheets ทั้ง 2 ไฟล์ → กรอก/วาง STAFF, WORK_SCHEDULE, STUDENTS, CLASSES, PARENTS
- วาง DSPM_CRITERIA (จาก CSV ที่ proofread แล้ว — คอลัมน์ AgeFrom..Track)
- กรอก SCHOOL_CONFIG: `GPS_Lat, GPS_Lng, Radius(=30), QRCode/PromptPayID, HolidayList`

### 2.3 Deploy เป็น Web App
- Apps Script → **Deploy → New deployment → Web app**
  - Execute as: **Me** · Who has access: **Anyone** → **Deploy** → คัดลอก **URL `/exec`**
- รัน **`bootstrapAdmin("<LINE userId ของผู้ดูแล>")`** เพื่อสร้าง Admin คนแรก
- รัน **`installTriggers()`** เปิด trigger เตือนลืม check-in/out + backup รายวัน

---

## ส่วนที่ 3 — เชื่อม LINE OA / LIFF (Case A: มี LINE OA แล้ว) — โรงเรียนทำเองได้

> ต้องใช้ 2 เว็บ: **LINE Developers Console** (developers.line.me) และ **LINE OA Manager** (manager.line.biz)

1. **เอา Channel ID & Secret**
   - LINE Developers → เลือก Provider → เปิด **Messaging API channel** ของโรงเรียน
   - คัดลอก **Channel ID**, **Channel Secret**, และสร้าง/คัดลอก **Channel Access Token (long-lived)**
2. **สร้าง LIFF App** (ในช่องทาง Login channel หรือ Messaging API channel ที่รองรับ LIFF)
   - LIFF → **Add** → Size: **Full** → Scope: **profile, openid** → Endpoint URL = **ใส่ URL `/exec` ของ GAS**
   - คัดลอก **LIFF ID**
3. **กรอกค่าลงใน Google Sheets → SCHOOL_CONFIG**
   - `LineChannelAccessToken` = Channel Access Token
   - `LineChannelSecret` = Channel Secret
   - `LiffID` = LIFF ID
   - `AdminLineUID` = userId ของผู้ดูแล (ดูได้จากหน้าโปรไฟล์/ตอนทดสอบ)
4. **ตั้ง Webhook** (สำหรับรับ event จาก LINE)
   - LINE Developers → Messaging API → **Webhook URL** = URL `/exec` ของ GAS → **Verify** → เปิด **Use webhook**
   - ปิด Auto-reply/Greeting ใน LINE OA Manager ถ้าต้องการให้ระบบตอบเอง
5. **ตั้ง Rich Menu** (LINE OA Manager) แยกปุ่มตามบทบาท (Admin / Teacher / Parent) ชี้ไป LIFF
6. **ทดสอบ**: เปิด LIFF ผ่าน LINE → Login → ต้องเห็นพอร์ทัลตามบทบาท → ลองรับ-ส่ง/บันทึก/แจ้งเตือน

### เชื่อม Front-end เข้ากับ GAS
- ในโค้ดเว็บ `webapp/api.js` เปลี่ยน `CONFIG.MODE` จาก `'mock'` → **`'gas'`** และใส่ `CONFIG.GAS_URL = '<URL /exec>'`
- UI ทั้งหมดไม่ต้องแก้ — เรียกผ่าน `api(action, payload)` เหมือนเดิม
- โฮสต์หน้าเว็บ: ใช้เป็น **PWA** (เปิดลิงก์ → Add to Home Screen) หรือฝังเป็น **LIFF endpoint**

---

## ส่วนที่ 3.5 — ตารางสรุป "ค่าเชื่อมต่อ ใส่ตรงไหน" (Connection cheat-sheet)

ทุกค่าการเชื่อมต่อกรอกที่ **Google Sheets → ไฟล์ `AtomNursery_Main` → ชีต `SCHOOL_CONFIG`** (คอลัมน์ Key/Value) ที่เดียว

| ต้องการเชื่อม | เอาค่ามาจากไหน | ใส่ที่ Key (SCHOOL_CONFIG) | ระบบเอาไปใช้ตรงไหน |
|---|---|---|---|
| **LINE — ส่งข้อความ/แจ้งเตือน** | LINE Developers → Messaging API → **Channel access token (long-lived)** | `LineChannelAccessToken` | ทุก Notification (เช็คอิน, อนุมัติลา, บันทึกพร้อม) |
| **LINE — ยืนยันตัวตน** | LINE Developers → **Channel secret** | `LineChannelSecret` | ตรวจ webhook / ความปลอดภัย |
| **LIFF (เปิดแอปใน LINE)** | LINE Developers → LIFF → **LIFF ID** | `LiffID` | ลิงก์ลึกในแจ้งเตือน (เปิดหน้าบันทึก ฯลฯ) |
| **Admin รับแจ้งเตือน** | userId ของแอดมิน (ดูตอนทดสอบ LIFF) | `AdminLineUID` | ปลายทาง Notification ของ Admin |
| **ลิงก์แชท LINE OA** (ปุ่ม "เปิดแชท LINE OA") | URL ห้องแชท OA เช่น `https://line.me/R/ti/p/@xxxxxxx` (หรือ `https://lin.ee/xxxx`) | `Links_LINE` *(เว็บ: `config.Links.line`)* | ปุ่มแชทของผู้ปกครอง + Admin + ไอคอน LINE มุมล่าง |
| **Facebook / Website** | URL เพจ/เว็บโรงเรียน | `Links_Facebook`, `Links_Website` | ไอคอนมุมล่างหน้าหลักผู้ปกครอง |
| **QR Code พร้อมเพย์ (รับชำระเงิน)** | รูป QR PromptPay ของโรงเรียน → อัปโหลดขึ้น Drive/โฮสติ้ง แล้วเอา **ลิงก์รูปตรง (image URL)** | `QRCode` *(เว็บ: `config.PromptPayQR`)* | หน้า **ชำระเงิน → ปุ่ม QR พร้อมเพย์** (ผู้ปกครองสแกนจ่าย) |
| **เลขพร้อมเพย์ (สำรอง/แสดงผล)** | เบอร์/เลขประจำตัวผู้เสียภาษีพร้อมเพย์ | `PromptPayID` | แสดงคู่กับ QR |
| **พิกัด GPS โรงเรียน** | Google Maps | `GPS_Lat`, `GPS_Lng` | ตรวจรัศมีเช็คอิน |
| **รัศมีเช็คอิน** | (แนะนำ 30) | `Radius` | geofence เช็คอิน |
| **วันหยุด** | รายการวันที่ | `HolidayList` | ปฏิทิน/แจ้งเตือนวันหยุด |

> **สรุปสั้นๆ ตามที่ถาม:**
> - **LINE OA "ใส่ Link ไหน"** → ลิงก์ห้องแชท OA (`https://line.me/R/ti/p/@<OA-id>` หรือ `https://lin.ee/<code>`) ใส่ที่ `Links_LINE` · ส่วน **Token/Secret/LIFF ID** สำหรับส่งข้อความ/ล็อกอิน ใส่ที่ `LineChannelAccessToken` / `LineChannelSecret` / `LiffID`
> - **QR Code "ใส่ตรงไหน"** → อัปโหลดรูป QR แล้วเอาลิงก์รูปใส่ที่ `QRCode` → จะไปโผล่ที่ปุ่ม "QR พร้อมเพย์" หน้าชำระเงินของผู้ปกครองอัตโนมัติ
> - ฝั่งเว็บ (prototype) ค่าเดียวกันอยู่ใน `webapp/mockdata.js → config` (`Links.line/facebook/website`, `PromptPayQR`) — พอเชื่อม GAS จริงให้ดึงจาก `SCHOOL_CONFIG` แทน

---

## ส่วนที่ 3.6 — เข้าสู่ระบบด้วย LINE + ติดตั้งแอปลงมือถือ (QR / Rich Menu / Add to Home Screen)

**Log in:** ระบบให้ผู้ใช้ทุกคน (ผู้ปกครอง/ครู/Admin) เข้าสู่ระบบ **ด้วย LINE เท่านั้น** ผ่าน LINE OA ของโรงเรียน — หน้าเว็บมีปุ่มเดียว "เข้าสู่ระบบด้วย LINE". ตอน deploy ใช้ **LIFF**: เปิดแอปในกรอบ LINE → `liff.init({liffId})` → `liff.getProfile()` ได้ `userId` → ส่งให้ GAS แมปกับ USERS/บทบาท. การลงทะเบียนใหม่กรอกเฉพาะข้อมูล**ผู้ปกครอง**ก่อน แล้วค่อย "เพิ่มบุตรหลาน" (ใหม่) หรือ "เชื่อมบุตรหลาน" ด้วยเลขบัตร ปชช.นักเรียน — ผู้ปกครองคนที่ 2 จึงเชื่อมได้โดยไม่ติดลงทะเบียนซ้ำ.

**ทำให้ผู้ปกครองมี "ไอคอนแอป" บนมือถือ — 3 วิธี (ทำได้ทั้งหมด):**
1. **QR Code ประชาสัมพันธ์** — สร้าง QR จาก URL `/exec` ของ GAS (หรือ LIFF URL `https://liff.line.me/<LIFF-ID>`) ด้วยตัวสร้าง QR ใดก็ได้ → ติดที่โรงเรียน/ใบปลิว/กลุ่มผู้ปกครอง. สแกนแล้วเปิดเว็บแอป → กด **"เพิ่มลงหน้าจอโฮม / Add to Home Screen"** (แอปเป็น **PWA** อยู่แล้ว: `manifest.json` + `sw.js` + ปุ่ม "📲 ติดตั้งลงมือถือ" ในหน้า login) → ได้ไอคอนเหมือนแอปจริง.
   - iPhone (Safari): ปุ่มแชร์ → "Add to Home Screen". Android (Chrome): เมนู ⋮ → "Add to Home screen / Install app" (Chrome เด้ง prompt อัตโนมัติให้ปุ่มในแอปทำงาน).
2. **Rich Menu ใน LINE OA** (manager.line.biz → Home → Rich menu) — สร้างเมนูล่างในห้องแชท OA, ปุ่มชนิด **"Link"** ชี้ไป LIFF URL (แยกปุ่มตามบทบาท: ผู้ปกครอง/คุณครู/Admin ได้). ผู้ปกครองกดจากแชท OA เปิดแอปในกรอบ LINE ทันที — ไม่ต้องจำ URL.
3. **ลิงก์/ปุ่มในข้อความ OA** — ส่งข้อความต้อนรับ (Greeting) พร้อมปุ่มเปิด LIFF + คำแนะนำ "เพิ่มลงหน้าจอโฮม".

> ไม่ต้องจด Domain และไม่ต้องขึ้น App Store — PWA + LIFF เพียงพอ. (ถ้าต้องการขึ้นสโตร์จริงค่อยห่อด้วย TWA/Capacitor ภายหลัง: Google $25 ครั้งเดียว / Apple $99/ปี)

---

## ส่วนที่ 4 — Backup & ความปลอดภัย
- `installTriggers()` ตั้ง Backup รายวันไป Google Drive (โฟลเดอร์ตาม `BackupFolderName`)
- ข้อมูล HR แยก Workbook 2 (PDPA) · ทุก action บันทึกใน AUDIT_LOG · รหัสผ่าน hash (SHA-256+salt)
- สิทธิ์การเข้าถึงคุมด้วย Role ใน GAS (Admin/Leader/Teacher/Parent)

---

## ส่วนที่ 5 — รองรับการพัฒนา/แก้ไขในอนาคต

ออกแบบให้ต่อยอดง่าย:
- **เพิ่มฟิลด์/ชีตใหม่:** แก้ `SCHEMA` ใน `Config.gs` → รัน `setupAll()` ซ้ำ (idempotent: เพิ่มของที่ขาด ไม่ลบข้อมูลเดิม)
- **เพิ่มฟังก์ชัน/หน้าใหม่:** เขียน handler ใหม่ → ลงทะเบียนใน `ROUTES` (Code.gs) เป็น action ใหม่ → Front-end เรียก `api('actionใหม่', ...)`
- **เปลี่ยนค่าทางธุรกิจ** (อัตราเบี้ยขยัน, ค่า OT, รัศมี GPS, วันหยุด): แก้ที่ **SCHOOL_CONFIG** ในชีต ไม่ต้องแก้โค้ด
- **เวอร์ชันการ deploy:** ทุกครั้งที่แก้โค้ด → Deploy → **Manage deployments → Edit → New version** (URL เดิมใช้ได้ต่อ)
- **เทสก่อนขึ้นจริง:** ใช้ `tools/gas_test_harness.js` รันทดสอบ logic ด้วย Node โดยไม่ต้องมีบัญชี Google (`node tools/test_day4.js`, `test_day5.js`)
- **i18n:** ข้อความ UI อยู่ใน `webapp/i18n.js` (EN/TH) เพิ่มภาษาอื่นได้

---

## ส่วนที่ 6 — ส่วนขยายปี 2026 (Registration, OT, Payroll, Absence ฯลฯ)

ฟีเจอร์รอบขยาย (ทำใน prototype + sync schema แล้ว — รายละเอียดฟังก์ชันครบใน `README.md`):

**ชีตใหม่ใน `Config.gs` (รัน `setupAll()` ซ้ำเพื่อสร้าง — idempotent):**
- WB1: `PICKUP_PERSONS, USER_LINKS, OT_DAILY, GROWTH_RECORDS, HOLIDAYS, STUDENT_CHARGES, PREPAYMENTS, ABSENCE_LOG, ABSENCE_FOLLOWUP`
- WB2: `STAFF_GROUPS, PAYROLL_CONFIG`
- คอลัมน์เพิ่ม: `STUDENTS` (+NationalID/Plan/Weight/Height/Photo/ประกัน…), `PARENTS` (+NationalID/อาชีพ…), `STAFF` (+NationalID/StaffGroup/PasswordHash/MustChangePassword/Photo), `ANNOUNCEMENTS` (+Popup/StartDate/EndDate), `BILLING` (+OTRollover/SlipAmount/VerifiedStatus)

**SCHOOL_CONFIG keys ใหม่:** `Plans` (JSON อัตราค่าบริการ), `OTRatePerHour=100`, `OTGraceMinutes=21`, `LateGraceMinutes=10`, `OTRoundUpMinutes=50`, `AbsenceRateExcludeDays=6`, `GrowthUpdateMonths=2,4,6,8,10,12`, `QRCode_Monthly` (SCB), `QRCode_OT` (KTB)

**รูป/ไฟล์ที่ต้องวาง (prototype):** `webapp/assets/qr_scb.png` (QR รายเดือน), `webapp/assets/qr_ktb.png` (QR OT), `webapp/assets/logo-corner.jpg` (โลโก้มุมขวาสลิป), `webapp/assets/logo.png` (โลโก้หลัก โปร่งใส — ใช้ในใบเสร็จ/สลิป auto-embed)

**สลิปการชำระเงิน → Google Drive:** ผู้ปกครองแนบสลิป → ระบบเก็บรูปไว้ที่โฟลเดอร์ Drive ตาม `SlipsFolderName` (ดีฟอลต์ `AtomNursery_Slips`) แล้วเก็บ URL ของไฟล์ไว้ใน `SlipUrl` ของ BILLING/OT_DAILY/PREPAYMENTS → Admin เปิดหน้า "ยืนยันการชำระเงิน" ดึงรูปจาก Drive มาแสดงเพื่อตรวจ (ทำงานข้ามอุปกรณ์). ใน prototype (mock) เก็บเป็น dataURL ในเรคคอร์ดแทน Drive. *GAS deploy:* `uploadSlip`/`payOT`/`payPrepay` รับ base64 รูป → `DriveApp.getFoldersByName(SlipsFolderName)` (สร้างถ้ายังไม่มี) → `createFile(blob)` → เก็บ `getUrl()` ลง SlipUrl. แนะนำตั้งสิทธิ์โฟลเดอร์เป็นส่วนตัว (เฉพาะ Gmail โรงเรียน) ตาม PDPA.

**การเรียกเก็บรายเดือน (Billing):** Admin มีปุ่ม "ออกบิลรายเดือน" (`generateMonthlyBills`) สร้างบิลให้นักเรียน Active ทุกคนตามราคา Plan (ข้ามคนที่มีบิลเดือนนั้นแล้ว) — *GAS deploy:* ตั้ง time-trigger รายเดือน (วันที่ 1) เรียกฟังก์ชันนี้อัตโนมัติ. กรณีนักเรียนเข้ากลางเดือน Admin กดปุ่ม "ออกบิลเรียกเก็บ" (`issueBill`) ที่นักเรียนรายคน กำหนดยอดเอง (คิดตามจริง) → ผู้ปกครองเห็นบิลนั้นและชำระ → เดือนถัดไปขึ้นบิลเต็มอัตโนมัติ. ทุกบิลผ่าน flow ตรวจสลิป (Admin กดยืนยันยอดโอน).

**กฎทางธุรกิจสำคัญ (แก้ได้ที่ SCHOOL_CONFIG / ไม่ต้องแก้โค้ด):** OT ผู้ปกครอง 100฿/ชม.เกิน 21 นาที · OT ครู ≥50 นาที=1 ชม. · เช็คอินสาย ≤10 นาที=ไม่สาย · จ่ายล่วงหน้า 2/3/6/12 เดือน = ลด 5/10/20/30% · ลาข้ามปีไม่ได้ · นับเด็กเรท = Active − ขาด ≥6 วัน · ครูเปลี่ยนรหัสผ่านครั้งแรกเอง (8-15 ตัว พิมพ์เล็ก/ใหญ่/ตัวเลข)

> **Web App ต้องจด Domain ไหม?** ไม่จำเป็น — QR ที่ประชาสัมพันธ์ชี้ไปที่ URL `/exec` ของ GAS (หรือ LIFF URL) ได้เลย ทุก role เปิดแล้ว Add-to-Home-Screen เป็น PWA · Admin ใช้บน Laptop ได้ · custom domain เป็นทางเลือกเพื่อความสวยงามของลิงก์เท่านั้น

---

## ส่วนที่ 7 — Day 6 (ประกัน PCHI · SlipOK · LINE OA @atomnursery)

ทำใน prototype + sync schema แล้ว (`src/Day6.gs` = GAS handler พร้อม deploy, ลงทะเบียนใน `Code.gs` ROUTES):

**1) แบบฟอร์มข้อมูลประกัน (PCHI)** — สร้างจากไฟล์ `23022026 - PCHI Members In-Out Form.xlsx`
- ชีตใหม่ `INSURANCE_PCHI` (WB1) คอลัมน์ตรงกับชีต "Input Data" ของไฟล์ (Title/InsuredName/…/Beneficiary/Remarks) — `setupAll()` สร้างให้อัตโนมัติ. **ข้อมูลประกันถูกเขียนลงชีตนี้ที่เดียว**
- **ผู้ปกครองกรอกได้ครั้งเดียวต่อนักเรียน 1 คน** (unique ตาม StudentID/เลขบัตร ปชช.). ถ้ากรอกแล้ว ระบบขึ้นสถานะ "กรอกแล้ว" และบล็อกการกรอกซ้ำ (`ALREADY_FILLED`) — กรณีผู้ปกครองหลายคนผูกนักเรียนคนเดียว จึงกรอกได้คนเดียว
- **Admin ตรวจสอบ/แก้ไขได้** (จัดการ → 🛡️ ข้อมูลประกัน) ผ่าน `saveInsuranceAdmin` (ข้ามกฎครั้งเดียว)
- ตัวเลือก dropdown (คำนำหน้า/แผน/สถานะ/ความสัมพันธ์ ฯลฯ) อยู่ใน `mockdata.config.Insurance` (เว็บ) — ฝั่ง GAS ดึงจาก SCHOOL_CONFIG ได้
- *Deploy:* ค่า `InsuranceCompanyName`, `InsurancePolicyNo` ใน SCHOOL_CONFIG

**2) SlipOK — อ่าน/ตรวจสลิป QR** (`handleVerifySlip` ใน Day6.gs)
- SCHOOL_CONFIG: `SlipOK_Url` = `https://api.slipok.com/api/line/apikey/69307` · `SlipOK_ApiKey` = `SLIPOKKR8B249`
- GAS POST สลิป/QR ไปที่ SlipOK (header `x-authorization: <ApiKey>`) → คืนยอด/อ้างอิง. ฝั่งเว็บเรียก `api('verifySlip',…)` ก่อน ถ้าไม่พร้อม (mock) จะ fallback เป็น `BarcodeDetector` ในเบราว์เซอร์
- ⚠️ ปรับรูปแบบ request/response ให้ตรงเอกสาร SlipOK ปัจจุบัน (multipart `files` สำหรับรูป หรือ `data` สำหรับ payload QR)

**3) LINE OA @atomnursery + Facebook**
- `Links_LINE` = `https://line.me/R/ti/p/@atomnursery` · `LineOAId` = `@atomnursery` — ปุ่มแชท + ไอคอน LINE หน้าหลัก เด้งไป OA นี้
- `Links_Facebook` = `https://www.facebook.com/AtomNursery1`

**4) การเรียกเก็บเงินล่วงหน้า (Admin)** — `issueBill` รับ `paid:true` + `paidDate` → ออกบิลเดือนล่วงหน้าแล้ว**บันทึกว่าชำระแล้วทันที** (เช่น เดือน 6 เก็บ 2000 + เดือน 7 5000 → เดือน 7 แสดง "ชำระแล้ว")

**5) GAS / Database** — สร้างด้วย Gmail `atomnursery.system@gmail.com` ตามส่วนที่ 2 (`setupAll()` สร้างชีตใหม่ INSURANCE_PCHI/INJURY_REPORTS/WITHDRAWALS/ACTIVITY_LOG ให้อัตโนมัติแบบ idempotent)

---

## เช็กลิสต์ส่งมอบ (Handover)
- [ ] Day 6: กรอก `SlipOK_Url`/`SlipOK_ApiKey`, `InsurancePolicyNo`, ตรวจ `Links_LINE=@atomnursery`/`Links_Facebook`
- [ ] Gmail โรงเรียน + 2FA
- [ ] รัน `setupAll()` + `verifyDay1()` ผ่าน
- [ ] นำเข้า STAFF/STUDENTS/PARENTS/CLASSES/WORK_SCHEDULE/DSPM_CRITERIA
- [ ] กรอก SCHOOL_CONFIG ครบ (GPS, QR, LINE tokens, LIFF ID)
- [ ] Deploy Web App + `bootstrapAdmin()` + `installTriggers()`
- [ ] เชื่อม LIFF/Webhook/Rich Menu + ทดสอบครบ 3 บทบาท
- [ ] เปลี่ยน `api.js` เป็น `MODE='gas'` + GAS_URL
- [ ] ทดสอบ Backup ทำงาน
