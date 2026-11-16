# สำรองฐานข้อมูลทุกคืน (atom-prod)

ผอ. ตัดสินใจ 16 พ.ย. 2026: ใช้ Supabase แบบฟรี + ระบบสำรองของเราเอง แบบฟรีไม่มีสำรองให้ **ไฟล์ในนี้จึงเป็นสำเนาเดียวที่มี**

## ทำงานยังไง

| ส่วน | ชื่อ | หน้าที่ |
|---|---|---|
| ตัวตั้งเวลา | Cloud Scheduler `atom-backup-nightly` (asia-southeast1) | 02:00 น. เวลาไทยทุกคืน · ล้มเหลวลองใหม่ 2 ครั้ง ห่าง 5 นาที |
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

ซ้อมกู้ 1 ครั้งก่อนคืนย้าย (ภายใน 24 พ.ย.) — **กู้ไม่ได้ = ไม่ย้าย** · ขั้นตอนจะเขียนเพิ่มที่นี่หลังซ้อมจริง

## ค่าใช้จ่าย

ไฟล์ละไม่กี่ MB × 14 ไฟล์ + งานวันละ ~10 วินาที + ตัวตั้งเวลา 1 ตัว (ฟรี 3 ตัวแรก) = ต่ำกว่า ฿5/เดือน

## บันทึก

- 16 พ.ย. 2026 — สร้างครั้งแรก · ทดสอบสั่งเอง 1 รอบ + สั่งผ่านตัวตั้งเวลา: 60/60 ตาราง · MD5 ตรง · ฐานยังว่าง (ไฟล์ ~260 KB) · พบว่า 2 รอบในนาทีเดียวชื่อไฟล์ชนกัน (รอบหลังถูกปฏิเสธเพราะห้ามเขียนทับ แต่นับเป็นล้ม) → เพิ่มวินาที + รหัสรอบในชื่อไฟล์
