# 🏛️ Architecture — Atom Nursery (Mobile PWA + GAS data connector)

เป้าหมาย: แอปมือถือ (PWA) ที่ **เสถียร ยั่งยืน ดูแลง่าย** — โฮสต์เป็นเว็บไซต์ static บน GitHub Pages
(มี URL ทันที) แล้วค่อยจด Domain ภายหลัง โดยให้ **Google Apps Script (GAS) เป็นตัวเชื่อมข้อมูลเท่านั้น**
และใช้ **SlipOK** ตรวจสอบความถูกต้องของสลิป

---

## 1) ภาพรวมสถาปัตยกรรม

```
  [ Mobile PWA ]                 [ API layer ]                 [ Data + Verify ]
  webapp/ (static)               Google Apps Script            Google Sheets (2 WB)
  HTML/CSS/JS  ──fetch JSON──►   Web App /exec  ──read/write──► AtomNursery_Main / _HR
  ติดตั้งลงมือถือได้ (PWA)         doPost {action,payload}        SlipOK API ◄── ตรวจสลิป
  โฮสต์: GitHub Pages            = "data connector" เท่านั้น
```

- **Front-end** = โฟลเดอร์ `webapp/` ล้วน (vanilla JS, ไม่มี build step) → เสิร์ฟเป็น static site
- **API** = GAS Web App รับ `POST {action, payload}` → คืน `{ok, data|error}` (ไฟล์ `src/*.gs`)
- **Database** = Google Sheets 2 เล่ม ของ `atomnursery.system@gmail.com`
- **SlipOK** = บริการตรวจสลิป/QR — เรียกจากฝั่ง GAS (`handleVerifySlip`) ไม่เก็บ key ไว้ฝั่ง client

> **หลักการ: GAS เป็น data connector อย่างเดียว** — ตรรกะ/หน้าจอทั้งหมดอยู่ใน PWA, GAS แค่
> อ่าน/เขียน Sheets + เรียก SlipOK/LINE. ไม่มี HTML ฝั่ง GAS (ยกเว้นหน้าพิมพ์สลิป `?view=slips`)

---

## 2) ทำไมถึงเลือกแบบนี้ (เสถียร & ยั่งยืน)
- **ไม่มีเซิร์ฟเวอร์/ค่ารายเดือนฝั่ง platform** — GitHub Pages (ฟรี) + GAS (ฟรีในโควต้า) + Google Sheets
- **แยกชั้นชัดเจน** — เปลี่ยน UI ไม่กระทบข้อมูล, เปลี่ยน backend ไม่ต้องแก้ UI (เรียกผ่าน `api(action,payload)`)
- **เป็น PWA** — ติดตั้งลงมือถือเหมือนแอป, ทำงาน offline shell ได้, อัปเดตเองผ่าน service worker
- **ขึ้น Store ภายหลังได้** โดยห่อ PWA ด้วย TWA/Capacitor (ไม่ต้องเขียนใหม่)

---

## 3) เฟสการย้าย (Migration)

### เฟส 1 — ขึ้น GitHub Pages (ได้ URL ทันที) ✅ เตรียมไว้แล้ว
1. สร้าง GitHub repo แล้ว push โปรเจกต์ทั้งหมด (มี workflow `.github/workflows/pages.yml` ให้แล้ว)
2. GitHub → **Settings → Pages → Build and deployment → Source = GitHub Actions**
3. push เข้า `main` → workflow เผยแพร่ `webapp/` อัตโนมัติ → ได้ URL
   **`https://<user>.github.io/<repo>/`**
4. ทดสอบเปิดบนมือถือ → **Add to Home Screen** = ได้แอป

> ตอนนี้ยังเป็น `MODE='mock'` (ข้อมูลตัวอย่างในเครื่อง) — เปิดให้ลูกค้าลองใช้ได้ทันทีโดยไม่ต้องต่อ backend

### เฟส 2 — ต่อข้อมูลจริงผ่าน GAS (ดู [`README_DEPLOY_DAY7.md`](README_DEPLOY_DAY7.md))
1. push `src/` ขึ้น GAS ของ `atomnursery.system@gmail.com` → `setupAll()` → Deploy Web App → ได้ `/exec`
2. `webapp/api.js` → `CONFIG.MODE='gas'` + `CONFIG.GAS_URL='<.../exec>'` แล้ว push ใหม่ (UI ไม่ต้องแก้)
3. กรอก SCHOOL_CONFIG: LINE/LIFF, QR, **SlipOK_Url/SlipOK_ApiKey**, ประกัน, Links

> **CORS:** `api.js` ส่ง POST แบบ body เป็น string (Content-Type `text/plain`) ซึ่งเป็น *simple request*
> จึง **ไม่ติด preflight** เวลาเรียกข้าม origin (github.io → script.google.com). GAS `doPost` อ่าน
> `e.postData.contents` แล้ว `JSON.parse` — ใช้งานได้เลย ไม่ต้องตั้ง CORS header เพิ่ม

### เฟส 3 — จด Domain (ภายหลัง)
1. ซื้อโดเมน (เช่น `app.atomnursery.com`)
2. GitHub → Settings → Pages → **Custom domain** → ใส่โดเมน (สร้างไฟล์ `CNAME` อัตโนมัติ)
3. ตั้ง DNS: `CNAME app → <user>.github.io` → GitHub ออก HTTPS ให้
4. (ทางเลือก) ขึ้น App Store/Play ด้วย TWA (Play, $25 ครั้งเดียว) / Capacitor (iOS, $99/ปี)

---

## 4) โครงสร้างไฟล์
```
Atom/
├─ webapp/                 # ★ static PWA (สิ่งที่ขึ้น GitHub Pages)
│  ├─ index.html           #   มี meta PWA/iOS standalone ครบ
│  ├─ manifest.json        #   start_url/scope/icons แบบ relative (รองรับ subpath ของ Pages)
│  ├─ sw.js                #   service worker (network-first) — bump CACHE ทุกครั้งที่แก้
│  ├─ api.js               #   gateway เดียว: MODE 'mock' | 'gas'
│  ├─ app.js · i18n*.js · mockdata.js · growth_standard.js · xlsx_min.js · styles.css · assets/
├─ src/                    # GAS backend (data connector) — push ด้วย clasp
│  └─ *.gs                 #   Config/Setup/Db/Auth/.../Day6(insurance+SlipOK)/Backup(Day7)
├─ .github/workflows/pages.yml   # ★ auto-deploy webapp/ → GitHub Pages
├─ ARCHITECTURE.md (ไฟล์นี้) · README.md · DEPLOYMENT.md · README_DEPLOY_DAY7.md
```

---

## 5) Generic Engine — logic ชุดเดียว รันได้ทั้ง web + GAS (ทำแล้ว v23)
- **`webapp/engine.js`** = แหล่งความจริงเดียวของ handler ทั้งหมด: `createAtomAPI(M, GROWTH_STD) -> { H, ageMonths }`
  (ไม่มี DOM/window — ทดสอบรัน headless ใน Node ผ่านแล้ว)
- **`webapp/api.js`** เหลือแค่ gateway บางๆ (CONFIG + seed + สลับ mock/gas)
- ฝั่ง GAS ใช้ logic เดียวกัน: **`src/Engine.gs`** (สร้างจาก engine.js ด้วย `node tools/build_engine.js` — ห้ามแก้มือ) +
  **`src/GasEngine.gs`** (adapter: `engineDispatch_` → hydrate M จาก Sheets → รัน `H[action]` → เขียน collection ที่เปลี่ยนกลับ)
- **`src/Code.gs`** ส่ง action ที่ไม่อยู่ใน ROUTES ไปที่ engine อัตโนมัติ → ครบ ~116 action โดยไม่ต้องเขียนซ้ำ
- ⚠️ ก่อนเปิด `MODE='gas'`: ต้อง `clasp push` (รวม Engine.gs+GasEngine.gs) แล้วเติม `hydrateConfig_`/`engineSeed_`/`FIELD_ALIAS`
  ใน GasEngine.gs ให้ตรงกับ Sheets จริง (ข้อมูลอ้างอิง: vaccineSchedule, payrollConfig, leaveUsed, attendance)

## 6) ขั้นตอนทำ Web Admin + Mobile Application (codebase เดียว)

> **codebase เดียว 3 portal** (Parent/Teacher/Admin) เลือกอัตโนมัติตาม role — "Web Admin" = เปิดบน laptop,
> "Mobile App" = ติดตั้ง PWA บนมือถือ. ไม่ต้องแยกโปรเจกต์

**A. Mobile Application (ผู้ปกครอง/คุณครู)**
1. เปิด URL GitHub Pages บนมือถือ → กด **Add to Home Screen** → ได้ไอคอนแอป (standalone, มี meta iOS/Android แล้ว)
2. เข้าสู่ระบบ **LINE** (เดโม: ผ่าน → เลือก role) · ตอน deploy จริงใช้ **LIFF** เปิดในกรอบ LINE → รู้ role อัตโนมัติ
3. ใช้งานครบ: รับ-ส่ง GPS · ชำระเงิน (QR/เงินสด/สลิป→SlipOK) · บันทึก · พัฒนาการ/วัคซีน · ประกัน · แจ้งลา/ลาออก
4. (ภายหลัง) ขึ้น Store: ห่อด้วย **TWA** (Android, Play $25 ครั้งเดียว) / **Capacitor** (iOS, $99/ปี) — ใช้ URL เดิม

**B. Web Admin (ผู้ดูแล)**
1. เปิด URL เดียวกันบน **laptop/desktop** → เข้าสู่ระบบเลือก role **Admin**
2. ใช้ฟีเจอร์ Admin: แดชบอร์ด · อนุมัติลา · เงินเดือน+พิมพ์สลิป 3/A4 · ออกบิล/เงินสด/ยืนยันสลิป · จัดการนักเรียน/พนักงาน/ผู้ปกครอง · ประกัน (ตรวจ/แก้) · Activity Log · Daily Report · นำนักเรียนออก
3. หน้าจอ responsive (เมนูล่าง + การ์ด) ใช้ได้ทั้งจอใหญ่/เล็ก

**C. ลำดับ deploy (รวม)**
1. **เฟส 1 (ตอนนี้):** push ขึ้น GitHub → เปิด Pages (Settings→Pages→Source=GitHub Actions) → ได้ URL → ใช้ mock เดโมได้เลย
2. **เฟส 2:** push `src/` ขึ้น GAS (`atomnursery.system@gmail.com`) → `setupAll()` → Deploy `/exec` → เติม GasEngine hydrate/alias →
   ตั้ง `api.js MODE='gas'`+`GAS_URL` → push → ข้อมูลจริงผ่าน GAS (SlipOK ตรวจสลิปฝั่ง server)
3. **เฟส 3:** จด Domain (Custom domain + CNAME → HTTPS) แล้วค่อยห่อขึ้น Store

## 7) สถานะปัจจุบัน (ตรวจแล้ว v23)
- Generic engine ใช้งานได้จริง (browser + headless Node) · ทุก api() resolve · ไม่มี console error
- regression: `test_day4` 20/20 · `test_day5` 35/35 ผ่าน · `MODE='mock'` (ข้อมูลแสดงครบทุกหน้า)
- PWA: manifest + sw + meta iOS/Android + `.github/workflows/pages.yml` พร้อมขึ้น Pages เฟส 1
