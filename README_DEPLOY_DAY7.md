# 🚀 คู่มือ Push & Deploy — Day 7 (Atom Nursery)

คู่มือนี้สำหรับนำระบบขึ้นจริงบนบัญชี **`atomnursery.system@gmail.com`** ครบทุกขั้น:
push โค้ด GAS → สร้างฐานข้อมูล → กรอก config → Deploy Web App → เปิด Backup รายวัน → ตรวจ E2E

> ดูภาพรวมสถาปัตยกรรม/การย้ายระบบเพิ่มเติมได้ที่ [`DEPLOYMENT.md`](DEPLOYMENT.md) (ส่วนที่ 1–7) ·
> รายการฟังก์ชัน Web App ทั้งหมดอยู่ใน [`README.md`](README.md)

---

## 0) ภาพรวม Day 7
Day 7 = ทำให้ระบบ “ขึ้นจริง” ครบ: push โค้ด → สร้างฐานข้อมูล → กรอก config → Deploy Web App →
เปิด backup รายวัน → ตรวจ E2E. ฝั่ง backend ทั้งหมดอยู่ใน `src/*.gs` (19 ไฟล์) ข้อมูลอยู่ใน
Google Sheets 2 เล่มของ Gmail เดียว — ไม่มีเซิร์ฟเวอร์อื่น ไม่มีค่ารายเดือนฝั่ง Platform

---

## 1) สิ่งที่ต้องเตรียมก่อน (Checklist)

**บัญชี/สิทธิ์**
- [ ] เข้า `atomnursery.system@gmail.com` ได้ + เปิด **2FA** + ตั้ง Recovery email
- [ ] เปิด **Apps Script API**: https://script.google.com/home/usersettings → เปิด “Google Apps Script API” (จำเป็นถ้าใช้ clasp)

**เครื่องมือ (ถ้าใช้ clasp — แนะนำ)**
- [ ] ติดตั้ง Node.js แล้ว
- [ ] `npm install -g @google/clasp`

**ข้อมูลตั้งต้นที่ต้องมีในมือ** (ไว้กรอกใน Sheet ภายหลัง)
- [ ] รายชื่อ **STAFF** (ครู/พนักงาน + Role) และ **WORK_SCHEDULE**
- [ ] **STUDENTS / CLASSES / PARENTS** เริ่มต้น
- [ ] **LINE**: Channel Access Token, Channel Secret, **LIFF ID**, **Admin LINE userId**
- [ ] **QR**: รูป QR PromptPay รายเดือน (SCB) + OT (KTB) → อัปขึ้น Drive เอา image URL
- [ ] **พิกัด GPS** โรงเรียน (จาก Google Maps)
- [ ] **Day 6**: เลขกรมธรรม์ประกัน `InsurancePolicyNo` (SlipOK/Links มี default ให้แล้ว)
- [ ] รายการ **วันหยุด**, อัตราเบี้ยขยัน/ประกันสังคม (มี default ให้แล้ว ปรับได้)

---

## 2) ไฟล์ทั้งหมดที่จะ push (`src/`)
`appsscript.json` · `Config.gs` · `Setup.gs` · `Dspm_Seed.gs` · `Db.gs` · `Audit.gs` · `Line.gs` ·
`Auth.gs` · `Code.gs` · `Checkin.gs` · `Triggers.gs` · `Leave.gs` · `Parent.gs` · `Dspm.gs` ·
`Journal.gs` · `Payroll.gs` · `Slips.gs` · **`Day6.gs`** (ประกัน + SlipOK) · **`Backup.gs`** (Day 7)

> `appsscript.json` มี scopes ครบแล้ว: `spreadsheets`, **`drive`** (backup + โฟลเดอร์สลิป/ประกัน),
> `script.external_request` (SlipOK/LINE), `script.scriptapp` (triggers), `userinfo.email`

---

## 3) วิธี Push

### ตัวเลือก A — clasp (CLI, แนะนำ)
รันจากโฟลเดอร์โปรเจกต์ (`...\Downloads\Atom`):
```bash
clasp login          # เปิดเบราว์เซอร์ → ล็อกอินด้วย atomnursery.system@gmail.com
clasp create --type standalone --title "Atom Nursery Backend" --rootDir ./src
clasp push           # อัปโหลด appsscript.json + .gs ทั้ง 19 ไฟล์
clasp open           # เปิด editor บนเว็บ
```
> ถ้า `clasp push` เตือนว่าจะเขียนทับ `appsscript.json` → ตอบ **yes** (ของเรามี scopes ถูกแล้ว)

### ตัวเลือก B — วางมือ (ไม่ใช้ clasp)
1. https://script.google.com → **New project**
2. สร้างไฟล์ตามชื่อในข้อ 2 แล้ววางเนื้อหาจาก `src/` ทีละไฟล์
3. **Project Settings → ติ๊ก “Show appsscript.json”** → วางเนื้อหา `src/appsscript.json` ทับ

---

## 4) สร้างฐานข้อมูล + ตรวจ Day 1
ใน editor (เลือกฟังก์ชันจากเมนูด้านบนแล้วกด **Run**):
1. รัน **`setupAll`** → ครั้งแรกจะขออนุมัติ OAuth (กด **Allow** ด้วย `atomnursery.system@gmail.com`)
   - สร้าง 2 Workbooks (`AtomNursery_Main` + `AtomNursery_HR`) + ทุกชีต + headers + seed config
   - สร้างชีตใหม่ให้อัตโนมัติ: **INSURANCE_PCHI, INJURY_REPORTS, WITHDRAWALS, ACTIVITY_LOG**
   - **idempotent** — รันซ้ำได้ เติมชีต/คอลัมน์ที่ขาด ไม่ลบข้อมูลเดิม
2. รัน **`verifyDay1`** → **View → Logs** ต้องขึ้น `RESULT: PASS ✅`

---

## 5) กรอก SCHOOL_CONFIG + นำเข้าข้อมูล
เปิด `AtomNursery_Main` → ชีต **SCHOOL_CONFIG** กรอกคีย์ที่ยังเป็น `<FILL ...>`:
- `LineChannelAccessToken`, `LineChannelSecret`, `LiffID`, `AdminLineUID`
- `QRCode_Monthly`, `QRCode_OT`, `PromptPayID`, `GPS_Lat`, `GPS_Lng`
- **Day 6 (ใส่ค่าให้แล้ว — ตรวจ/แก้):** `SlipOK_Url`, `SlipOK_ApiKey`,
  `Links_LINE` (`https://line.me/R/ti/p/@atomnursery`), `Links_Facebook`
  (`https://www.facebook.com/AtomNursery1`), `InsurancePolicyNo`

**นำเข้าข้อมูลตั้งต้น:** STAFF, WORK_SCHEDULE, STUDENTS, CLASSES, PARENTS,
(DSPM_CRITERIA จาก `dspm_ocr/DSPM_CRITERIA_draft.csv` ที่ proofread แล้ว)

---

## 6) Deploy เป็น Web App
Editor → **Deploy → New deployment → เลือก Web app**
- Execute as: **Me** (`atomnursery.system@gmail.com`)
- Who has access: **Anyone**
- กด **Deploy** → คัดลอก **URL `/exec`** เก็บไว้

> แก้โค้ดภายหลัง: **Manage deployments → Edit → New version** (URL เดิมใช้ต่อได้)

---

## 7) เปิด Admin + Triggers + Day 7 Backup
รันทีละฟังก์ชันใน editor:
```text
bootstrapAdmin("Uxxxxxxxx...")   // ใส่ LINE userId ผู้ดูแล → สร้าง Admin คนแรก
installTriggers()                // เตือนลืมเช็คอิน/เอาท์ + dailyBackup (Day 7) อัตโนมัติ
runBackupNow()                   // ★ ทดสอบ backup ทันที 1 ครั้ง
verifyDay7()                     // ★ ตรวจ E2E ทั้งระบบ
```
- **`runBackupNow()`** → เปิด Drive โฟลเดอร์ **`AtomNursery_Backups`** ต้องมีไฟล์ก็อปปี้ 2 เล่ม +
  ชีต `BACKUP_LOG` มีแถวใหม่ (เก็บย้อนหลัง **14 วัน** แล้วลบอัตโนมัติ — ปรับที่ `BackupRetentionDays`)
- **`verifyDay7()`** → ดู Logs ต้องขึ้น `PASS ✅` โดยเช็ค: workbook ids, ชีตครบ, config สำคัญถูกกรอก,
  มี Admin, triggers ติดตั้ง, router ตอบ ping, backup รันได้

---

## 8) สลับ Front-end ไป GAS + เชื่อม LINE
1. `webapp/api.js` → เปลี่ยน `CONFIG.MODE` จาก `'mock'` เป็น **`'gas'`** + ใส่ `CONFIG.GAS_URL = '<URL /exec>'`
   (UI ไม่ต้องแก้ — เรียกผ่าน `api(action, payload)` เหมือนเดิม)
2. **LIFF**: LINE Developers → LIFF → Endpoint = URL `/exec` → คัดลอก **LIFF ID** ใส่ SCHOOL_CONFIG
3. **Webhook**: Messaging API → Webhook URL = `/exec` → **Verify** → เปิด **Use webhook**
4. **Rich Menu** (LINE OA **@atomnursery**) ชี้ไป LIFF URL

---

## 9) เช็กลิสต์ Go-Live
- [ ] `clasp push` สำเร็จ (19 ไฟล์)
- [ ] `setupAll()` + `verifyDay1()` → PASS
- [ ] กรอก SCHOOL_CONFIG ครบ (LINE/LIFF/QR/GPS/SlipOK/Insurance/Links)
- [ ] นำเข้า STAFF/STUDENTS/PARENTS/CLASSES/WORK_SCHEDULE/DSPM_CRITERIA
- [ ] Deploy Web App + เก็บ `/exec` URL
- [ ] `bootstrapAdmin()` + `installTriggers()`
- [ ] **`runBackupNow()` มีไฟล์ใน Drive + `verifyDay7()` → PASS** ← Day 7
- [ ] `api.js` เป็น `MODE='gas'` + GAS_URL
- [ ] ทดสอบจริงครบ 3 บทบาทผ่าน LIFF

---

## 🔁 งานประจำหลัง Go-Live
- **Backup** ทำงานอัตโนมัติทุกวัน (ตี 1) → ตรวจ `BACKUP_LOG` เป็นระยะ
- **ออกบิลรายเดือน**: ตั้ง time-trigger เรียก `generateMonthlyBills` (วันที่ 1) หรือกดจากหน้า Admin
- **อัปเดตโค้ด**: แก้ `src/` → `clasp push` → **Manage deployments → New version**
- **เพิ่มชีต/ฟิลด์ใหม่**: แก้ `SCHEMA` ใน `Config.gs` → รัน `setupAll()` ซ้ำ (idempotent)

---

### ฟังก์ชันสำคัญใน editor (สรุป)
| ฟังก์ชัน | ทำอะไร | รันเมื่อไร |
|---|---|---|
| `setupAll()` | สร้าง/อัปเดต 2 Workbooks + ทุกชีต | ครั้งแรก + ทุกครั้งที่แก้ SCHEMA |
| `verifyDay1()` | ตรวจชีต/headers/config ครบ | หลัง setupAll |
| `bootstrapAdmin("U...")` | สร้าง Admin คนแรก | ครั้งเดียวหลัง deploy |
| `installTriggers()` | เตือนเช็คอิน/เอาท์ + backup รายวัน | ครั้งเดียวหลัง deploy |
| `runBackupNow()` | สำรองข้อมูลทันที (ทดสอบ) | ตอนตรวจ Day 7 |
| `verifyDay7()` | ตรวจความพร้อม E2E ทั้งระบบ | ก่อน go-live |
