# ☁️ Google Cloud Run — โฮสต์ของเส้นเร็ว (สัปดาห์ 1 ส่วนที่เหลือ)

> **ผอ. เลือก 04/11/2569:** Google Cloud Run · ภูมิภาค `asia-southeast1` (สิงคโปร์ ที่เดียวกับ Supabase)
> ไฟล์ที่เตรียมไว้แล้ว: `Dockerfile` · `.gcloudignore` · `server/package.json` · ตรวจโดย `tools/test_cloud_run.js`

---

## 🔴 กติกาที่ไม่เปลี่ยน

| | |
|---|---|
| ข้อมูล | โฮสต์นี้ต่อกับ **Supabase staging ที่มีแต่ข้อมูลจำลอง** จนกว่า PDPA จะลงนาม |
| ผู้ใช้จริง | `FAST_URL` ใน `webapp/api.js` **ยังว่าง** → ไม่มีผู้ปกครองหรือครูคนไหนวิ่งเส้นนี้ จนกว่าจะตั้งใจเปิด |
| เครื่องทดสอบ | ตั้ง localStorage `atom_fast_pilot` = URL ของบริการ `atom-fast-120486339414` → **เครื่องนั้นเครื่องเดียว** ใช้เส้นเร็ว · URL อื่นถูกเมิน (token ส่งไปที่อื่นไม่ได้) · คำตอบ `NOT_ON_FAST_HOST` / `READ_ONLY_HOST` ถูกส่งต่อไป Apps Script อัตโนมัติ · โฮสต์ล่ม = การอ่านไป GAS และพักเส้นเร็ว 5 นาที · การเขียนไม่ถูกส่งซ้ำ |
| รหัสผ่านฐานข้อมูล | อยู่ใน **Secret Manager** เท่านั้น ไม่อยู่ใน image ไม่อยู่ใน repo ไม่อยู่ในแชท |
| SESSION_SECRET | ช่วงทดสอบใช้ **ค่าใหม่ที่สุ่มขึ้นมาเอง** ไม่ใช่ค่าจริงของ Apps Script — token จริงจึงใช้กับโฮสต์นี้ไม่ได้เลย จะเปลี่ยนเป็นค่าจริงในวันย้าย |
| อัปโหลด | `.gcloudignore` เป็น whitelist — `secrets/` ลายเซ็น ภาพใบประกาศ ฟอนต์ ไม่มีทางขึ้นไป |

---

## 👤 ส่วนที่ ผอ. ต้องทำเอง (ผมสร้างบัญชีหรือใส่บัตรแทนไม่ได้)

1. เข้า **https://console.cloud.google.com** ด้วยบัญชี Google ของโรงเรียน
   *(แนะนำ `atomnursery.system@gmail.com` — บัญชีเดียวกับ Apps Script)*
2. สร้างโปรเจ็กต์ใหม่ ชื่อ **`atom-fast-host`**
3. **Billing** → ผูกบัตร → แล้วตั้ง **Budget alert 300 บาท/เดือน** (ให้อีเมลเตือนถ้าเกิน)
   *ประมาณการ: ปริมาณใช้งานของเรา ~150,000 คำขอ/เดือน อยู่ในโควตาฟรีของ Cloud Run (2 ล้าน/เดือน)*
4. ติดตั้ง **Google Cloud CLI** บนเครื่องนี้ — https://cloud.google.com/sdk/docs/install (ตัวติดตั้ง Windows)
5. เปิด PowerShell แล้วล็อกอิน (เบราว์เซอร์จะเด้งให้เลือกบัญชี):

```bash
gcloud auth login
```

6. บอกผมว่า **"ล็อกอิน gcloud แล้ว"** — ที่เหลือผมทำต่อ

---

## 🤖 ส่วนที่ผมทำต่อ (บันทึกไว้ให้ตรวจย้อนได้)

```bash
gcloud config set project atom-fast-host
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
```

รหัสฐานข้อมูล — อ่านจาก `secrets/supabase.env` ส่งเข้า Secret Manager ตรง ๆ **ไม่พิมพ์ออกหน้าจอ**
SESSION_SECRET ช่วงทดสอบ — สุ่มใหม่ 48 ไบต์ ไม่ใช่ค่าจริง

```bash
gcloud run deploy atom-fast --source . --region asia-southeast1 --allow-unauthenticated \
  --set-secrets SUPABASE_DB_URL=supabase-db-url:latest,SESSION_SECRET=session-secret-staging:latest \
  --min-instances 0 --max-instances 3 --memory 512Mi
```

แล้ววัดจริงจากเครื่องนี้ไปที่ URL ของ Cloud Run ด้วย `tools/measure_fast_host.js` — **ประตูชั้นที่ 1 ต้องผ่านซ้ำบนโฮสต์จริง** (p50 < 1.5s) ไม่ใช่แค่บนเครื่องนี้

---

## ⚖️ เรื่องที่ต้องตัดสินใจทีหลัง (ไม่ต้องตอบตอนนี้)

| | |
|---|---|
| `--min-instances 0` | ฟรี แต่คำขอแรกหลังเงียบไปนาน ๆ ต้องรอเครื่องตื่น (~1–3 วินาที) |
| `--min-instances 1` | ไม่มีรอเครื่องตื่น · มีค่าใช้จ่ายเล็กน้อยต่อเดือน — **จะวัดทั้งสองแบบแล้วรายงานตัวเลขก่อนเลือก** |

---

## 🔙 ถอย

โฮสต์นี้ยังไม่มีผู้ใช้จริง — ลบได้ทั้งโปรเจ็กต์ไม่กระทบใคร · `gcloud run services delete atom-fast --region asia-southeast1`
