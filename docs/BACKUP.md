# สำรองฐานข้อมูลทุกคืน (atom-prod)

ผอ. ตัดสินใจ 16 พ.ย. 2026: ใช้ Supabase แบบฟรี + ระบบสำรองของเราเอง แบบฟรีไม่มีสำรองให้ **ไฟล์ในนี้จึงเป็นสำเนาเดียวที่มี**

## ทำงานยังไง

| ส่วน | ชื่อ | หน้าที่ |
|---|---|---|
| ตัวตั้งเวลา | Cloud Scheduler `atom-backup-nightly` (asia-southeast1) | **02:00 และ 14:00 น.** เวลาไทยทุกวัน · ล้มเหลวลองใหม่ 2 ครั้ง ห่าง 5 นาที (14:00 เพิ่ม 16 พ.ย. — ดู "แจ้งเตือน") |
| แจ้งเตือน | Cloud Monitoring → อีเมล `legeant04@gmail.com` | ① รอบไหนล้ม (บรรทัด `BACKUP FAILED`) แจ้งทันที พร้อมเหตุผล · ② ไม่มีรอบที่สำเร็จเกิน 23.5 ชม. (เช่น ตัวตั้งเวลาหยุดเงียบ ๆ) |
| งาน | Cloud Run Job `atom-backup` (โค้ด `backup/`) | `pg_dump` (v17) เฉพาะ schema `public` → **ตรวจว่าเปิดอ่านได้และมีครบ 60 ตาราง** → อัปโหลด → เทียบ MD5 · ตรวจไม่ผ่าน = งานล้ม ไม่มีไฟล์เสียขึ้นไป |
| ที่เก็บ | `gs://atom-nursery-db-backup/atom-prod/YYYY-MM-DD_HHMMSS_<รหัสรอบ>.dump` (Singapore) | ปิดสาธารณะถาวร · **ลบเองเมื่อครบ 14 วัน** (กฎของ bucket ไม่ใช่โค้ด — บั๊กในโค้ดจึงลบสำรองเก่าไม่ได้) |
| บัญชี | `atom-backup@atom-nursery.iam.gserviceaccount.com` | อ่านรหัสลับ `uat-supabase-db-url` ได้ตัวเดียว · **สร้าง**ไฟล์ใน bucket ได้อย่างเดียว (อ่าน/ลบไม่ได้) · สั่งงาน `atom-backup` ได้ |

รหัสลับ `uat-supabase-db-url` = ที่อยู่ฐาน **atom-prod** (ชื่อมาจากช่วง UAT — ฐานเดียวกับที่จะใช้จริง) ไม่เคยอยู่ในโค้ด/ใน image · `backup.js` แยกเป็นช่อง ส่งรหัสผ่านทาง `PGPASSWORD` เท่านั้น และกรองทุกข้อความก่อนพิมพ์

## ดูว่าคืนที่แล้วสำรองได้ไหม

```bash
gcloud storage ls -l gs://atom-nursery-db-backup/atom-prod/ --project=atom-nursery --account=atomnursery.system@gmail.com
```

ผลแต่ละรอบ (บรรทัด `ok=True … tables=60`):

```bash
gcloud logging read 'resource.labels.job_name="atom-backup"' --limit 20 --freshness=2d --format="value(timestamp,severity,textPayload,jsonPayload)" --project=atom-nursery --account=atomnursery.system@gmail.com
```

## สำรองทันที (เช่น หลังคืนย้าย — MOVE_NIGHT_RUNBOOK ขั้น 9)

```bash
gcloud run jobs execute atom-backup --region asia-southeast1 --wait --project=atom-nursery --account=atomnursery.system@gmail.com
```

## กู้คืน

ซ้อมกู้ 1 ครั้งก่อนคืนย้าย (ภายใน 24 พ.ย.) — **กู้ไม่ได้ = ไม่ย้าย**

### ซ้อมกู้ — Cloud Run Job `atom-restore-drill` (โค้ด `restore_drill/`)

เปิด PostgreSQL 17 **ว่าง ๆ ในคอนเทนเนอร์ของงานเอง** → ดาวน์โหลดไฟล์สำรองล่าสุด (ตรวจ MD5) → `pg_restore --exit-on-error` (ผิดแม้ข้อเดียว = ไม่ผ่าน) → ทุกตาราง: นับแถว + ลายนิ้วมือ MD5 ของทุกแถว **เทียบกับ atom-prod** (อ่านอย่างเดียวใน transaction read only)
ข้อมูลที่กู้อยู่แค่ใน `/tmp` ของงานนั้นและหายไปเมื่องานจบ — ไม่ลงเครื่องใคร ไม่แตะ staging · log มีแค่ชื่อตาราง + ตัวเลข

```bash
gcloud run jobs execute atom-backup --region asia-southeast1 --wait --project=atom-nursery --account=atomnursery.system@gmail.com
gcloud run jobs execute atom-restore-drill --region asia-southeast1 --wait --project=atom-nursery --account=atomnursery.system@gmail.com
gcloud logging read 'resource.labels.job_name="atom-restore-drill"' --limit 10 --freshness=30m --order=asc --format="value(textPayload)" --project=atom-nursery --account=atomnursery.system@gmail.com
```

- **รันทันทีหลังสำรอง ตอนไม่มีใครเขียน** (ซ้อมย้าย · คืนย้าย) — แถวที่เขียนหลังสำรองจะขึ้นเป็น "ต่าง" และรายงานบอกว่าเป็นเพราะอะไร
- ไฟล์เฉพาะ: `--update-env-vars OBJECT=atom-prod/<ชื่อไฟล์>.dump` · กู้อย่างเดียวไม่เทียบ: `COMPARE=0`
- บัญชี `atom-restore-drill@` — **อ่าน**ไฟล์ใน bucket ได้ (ลบ/เขียนไม่ได้) + อ่านรหัสลับ `uat-supabase-db-url`
- ผ่าน = บรรทัด `✅ RESTORE DRILL PASSED: 60 ตาราง · N แถว · ตรงกับ atom-prod ทุกตาราง`

### กู้จริง (ฐานเสีย/ข้อมูลหาย) — งานเดียวกัน `MODE=target`

ทำทุกขั้นของการซ้อมก่อน (ไฟล์ต้องกู้ลงฐานว่างได้ก่อนจะได้แตะฐานจริง) แล้วกู้ลงฐานใน `SUPABASE_DB_URL` **ใน transaction เดียว**: ทุกอย่างที่อยู่ในไฟล์ถูกลบแล้วสร้างใหม่จากไฟล์ (`pg_restore --clean --if-exists --single-transaction`) · ผิดแม้ข้อเดียว = ย้อนทั้งหมด ฐานเหมือนเดิมทุกอย่าง · schema `public` ไม่ถูกลบ (สิทธิ์ของ Supabase อยู่บนนั้น) · จบแล้วเทียบทุกตารางกับไฟล์อีกรอบ

🔴 **แทนที่ข้อมูลทั้งฐาน** — ก่อนกด: `freezeWrites()` (ห้ามมีคนเขียนระหว่างกู้) · บอก ผอ. · รู้ว่ากำลังกู้ไฟล์ของเวลาไหน (ข้อมูลหลังเวลานั้นหาย)
ต้องใส่รหัสยืนยันที่มี**วันที่ของวันนี้** (เวลาไทย) — คำสั่งที่คัดลอกจากบันทึกวันอื่นจะถูกปฏิเสธ:

```bash
gcloud run jobs execute atom-restore-drill --region asia-southeast1 --wait --project=atom-nursery --account=atomnursery.system@gmail.com --update-env-vars MODE=target,CONFIRM=restore-into-atom-prod-YYYY-MM-DD
```

- ไฟล์เฉพาะ (ไม่ใช่ล่าสุด): เพิ่ม `OBJECT=atom-prod/<ชื่อไฟล์>.dump`
- ฐานใหม่ (โปรเจกต์ Supabase ใหม่ เพราะตัวเดิมใช้ไม่ได้): สร้าง secret ใหม่ของฐานนั้น แล้วเพิ่ม `--update-secrets SUPABASE_DB_URL=<secret ใหม่>:latest` + `TARGET_LABEL=<ชื่อ>` (รหัสยืนยันเปลี่ยนตาม) · ฐานใหม่ต้องมี `auth.jwt()` (Supabase มีให้) — แล้วชี้ Apps Script/Cloud Run ไปฐานใหม่
- ผ่าน = `✅ RESTORE INTO atom-prod PASSED: 60 ตาราง · N แถว · ตรงกับไฟล์สำรองทุกตาราง` · ตรวจโครงสร้างต่อ: `ATOM_PG_ENV=atom-prod.env node tools/pg_sync_schema.js` ต้อง 0 ทุกข้อ
- หลังกู้: `unfreezeWrites()` · รันสำรองด้วยมือ 1 รอบ

## แจ้งเตือน — เปลี่ยนอีเมล

Google Cloud Console (บัญชี atomnursery.system) → Monitoring → Alerting → **Edit notification channels** → Email → แก้ "Atom backup alerts" หรือเพิ่มอีเมลใหม่ แล้วผูกกับ 2 นโยบาย `🔴 Atom backup FAILED` และ `🔴 Atom backup: no successful backup in 23.5h`

ทำไมต้องมีรอบ 14:00: เงื่อนไข "ไม่มีข้อมูล" ของ Google ตั้งได้ไม่เกิน 23 ชม. 30 นาที — ถ้าสำรองวันละครั้ง ช่องว่างปกติคือ 24 ชม. พอดี จะเตือนผิดทุกคืน · รอบที่สองยังทำให้ข้อมูลเสี่ยงหายสูงสุดเหลือ 12 ชม. แทน 24

## ค่าใช้จ่าย

ไฟล์ละไม่กี่ MB × 14 ไฟล์ + งานวันละ ~10 วินาที + ตัวตั้งเวลา 1 ตัว (ฟรี 3 ตัวแรก) + แจ้งเตือน (ฟรี) = ต่ำกว่า ฿5/เดือน

## บันทึก

- 16 พ.ย. 2026 — สร้างครั้งแรก · ทดสอบสั่งเอง 1 รอบ + สั่งผ่านตัวตั้งเวลา: 60/60 ตาราง · MD5 ตรง · ฐานยังว่าง (ไฟล์ ~260 KB) · พบว่า 2 รอบในนาทีเดียวชื่อไฟล์ชนกัน (รอบหลังถูกปฏิเสธเพราะห้ามเขียนทับ แต่นับเป็นล้ม) → เพิ่มวินาที + รหัสรอบในชื่อไฟล์
- 17 พ.ย. 2026 — เพิ่ม `MODE=target` (กู้ลงฐานจริง) · ทดสอบรหัสยืนยันวันที่ผิด → ถูกปฏิเสธ · รอบแรกล้มเพราะลืมส่งชื่อไฟล์ให้ pg_restore (transaction เดียว — ฐานไม่เปลี่ยน) · รอบสอง **ผ่าน**: กู้ลง atom-prod 5.5 วินาที · 60 ตาราง ตรงกับไฟล์ · `pg_sync_schema` 0 ทุกข้อ · RLS 60/60 · นโยบาย 60 · ดัชนี 216 (staging มี 215 — staging ขาด `cache_version_pkey` เป็นความคลาดเคลื่อนเก่าของ staging)
- 17 พ.ย. 2026 — สร้างงานซ้อมกู้ `atom-restore-drill` · รอบแรกล้มที่ขั้นเตรียมของงานเอง (ติดตั้ง pgcrypto หลังลบ schema public) แก้แล้ว · รอบสอง **ผ่าน**: 60 ตาราง · กู้ 0.7 วินาที · ตรงกับ atom-prod ทุกตาราง (ฐานยังว่าง — รอบที่วัดผลจริงคือหลังย้ายข้อมูลวันซ้อม)
- 16 พ.ย. 2026 — เพิ่มแจ้งเตือนอีเมล 2 แบบ + รอบ 14:00 · ทดสอบแจ้งเตือน ①: สั่งรอบที่ตั้งใจให้ล้ม (`MIN_TABLES=999`) → `BACKUP FAILED: dump has 60 tables, expected at least 999`
