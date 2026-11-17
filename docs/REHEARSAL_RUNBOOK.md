# 🎭 ซ้อมย้าย 18–19 พ.ย. 2569 — P7 ซ้อมย้ายข้อมูลจริง · P8 ซ้อมถอย · ซ้อมกู้

*เขียน 17 พ.ย. · ซ้อม**ตามบทเดียวกับคืนย้าย** (`MOVE_NIGHT_RUNBOOK.md` ขั้น 3–5a, 9) แล้ว**จดเวลาจริงทุกขั้น**ลงช่อง ⏱ — เวลานี้คือตัวเลขที่ใช้วางคืน D*

**กฎ**
1. 🔴 **ระบบจริงไม่ถูกแตะ** — ไม่ `freezeWrites()` บนสคริปต์จริง ไม่ deploy สคริปต์จริง · การ export อ่านอย่างเดียว · ทุกอย่างที่เขียน = atom-prod (สำเนา UAT) และโปรเจ็กต์ UAT เท่านั้น
2. 🔴 ไฟล์ export และรายงานเงิน**มีชื่อ+ยอดรายคน** → `secrets/export/` เท่านั้น · ห้ามอยู่ใน `docs/` · ห้าม commit · ห้ามส่งในแชต
3. 🔴 ค่าลับไม่ผ่านแชต/ภาพหน้าจอ · คำสั่งที่ชี้ atom-prod ใช้ `ATOM_PG_ENV=atom-prod.env` (ไฟล์ใน `secrets/`)
4. ไม่ผ่านข้อไหน = หยุดที่ข้อนั้น จด สาเหตุ แก้ แล้วซ้อมข้อนั้นใหม่ — **ไม่ข้าม**

---

## วันที่ 1 — พ. 18 พ.ย. (ผม)

| | ขั้น | ทำ | ผ่านเมื่อ | ⏱ |
|---|---|---|---|---|
| ☐ | **R0 เช็กก่อนเริ่ม** | ระบบจริงไม่มี error ค้าง · สำรองทุกคืนรอบล่าสุด `ok=True tables=60` (`docs/BACKUP.md`) · `node tools/run_dbpg_parity.js` เขียวแล้ว (17 พ.ย. 95/95) · atom-prod มี 60 ตาราง **และว่าง** (ไม่มี tenant `atom`) | ครบ | |
| ☐ | **R1 Export** | editor ของ**สคริปต์จริง** › `exportAllForMigration` › Run (อ่านอย่างเดียว) → ดาวน์โหลด JSON → `secrets/export/atom_export_R_<วันที่>.json` | ไฟล์ครบทุกชีต (R2 จะบอกถ้าขาด) · ไม่มี error | |
| ☐ | **R2 Dry run** | `node tools/pg_migrate.js --file <ไฟล์> --dry --report secrets/export/money_R.md` | ไม่มีคอลัมน์หาย · ไม่มีค่าเกิน numeric(12,2) · รายงานเงินออก | |
| ☐ | **R3 ย้ายจริงลง atom-prod** | `ATOM_PG_ENV=atom-prod.env node tools/pg_migrate.js --file <ไฟล์> --tenant atom --report secrets/export/money_R.md` · **จด tenant id** ที่พิมพ์ออกมา (ใช้ R7) | จบไม่มี error | |
| ☐ | **R4 ตรวจว่าตรง** | `ATOM_PG_ENV=atom-prod.env node tools/pg_diff_check.js --file <ไฟล์>` | **diff ว่าง** | |
| ☐ | **R5 ทดสอบ route บนข้อมูลจริง** | `ATOM_PG_ENV=atom-prod.env node tools/route_sweep_real.js --file <ไฟล์> --tenant atom` — ทุก route อ่านของแอป (33 ตัวจาก `FAST_ACTIONS`) × แอดมิน · ครู · หัวหน้าครู · ผู้ปกครอง (คนจริงจากข้อมูล เลือกตามกฎ) · ฝั่ง A = Apps Script บนข้อมูลใน export (ในเครื่อง) · ฝั่ง B = เซิร์ฟเวอร์ใหม่บน atom-prod · พิมพ์แค่ชื่อ route + ตำแหน่งที่ต่าง (ไม่พิมพ์ข้อมูล) · ผลละเอียด → `secrets/export/route_sweep_<วันที่>.json` | **ไม่ตรง 0** · `🔒 ฐานข้อมูลไม่ถูกเปลี่ยน` · ครบ 4 บทบาท (ถ้าขาดบทบาทไหน จดไว้) | |
| ☐ | **R6 สำรอง + ซ้อมกู้** | `gcloud run jobs execute atom-backup --region asia-southeast1 --wait` แล้ว**ทันที** `gcloud run jobs execute atom-restore-drill --region asia-southeast1 --wait` · อ่านผลตาม `docs/BACKUP.md` "ซ้อมกู้" | `✅ RESTORE DRILL PASSED` · 60 ตาราง · **ตรงกับ atom-prod ทุกตาราง** · จดเวลากู้ | |

| ☐ | **R6b ซ้อมกู้จริงลง atom-prod** | ต่อจาก R6 ทันที (ยังไม่มีใครใช้): `gcloud run jobs execute atom-restore-drill --region asia-southeast1 --wait --update-env-vars MODE=target,CONFIRM=restore-into-atom-prod-2026-11-18` → แล้ว `ATOM_PG_ENV=atom-prod.env node tools/pg_sync_schema.js` + `pg_diff_check` (R4) ซ้ำ | `✅ RESTORE INTO atom-prod PASSED` · sync 0 ทุกข้อ · diff ว่าง · **จดเวลากู้ = RTO จริง** | |

> R6 ทำก่อนเปิด UAT (R7) เพราะต้องเทียบตอนไม่มีใครเขียน · **กู้ไม่ผ่าน = ไม่ย้าย** (ผอ. 16/11)

## วันที่ 2 — พฤ. 19 พ.ย.

| | ขั้น | ทำ | ใคร | ผ่านเมื่อ | ⏱ |
|---|---|---|---|---|---|
| ☐ | **R7 ต่อ UAT กับข้อมูล** | ① `atom-fast-uat`: `TENANT_ID` = tenant id จาก R3 · `LINE_ALLOW` = LINE ID ผู้ทดสอบ (**รอรายชื่อจาก ผอ.**) · `min-instances 1` ② Apps Script UAT › Script Properties: `PG_TENANT_ID` · `PG_TARGET=production` · `PDPA_SIGNED=yes` · `LINE_SEND=allow` + `LINE_ALLOW` · แล้ว `DB_BACKEND=pg` **เป็นข้อสุดท้าย** ③ build + deploy เว็บ UAT ตาม `UAT_CHECKLIST.md` ⓪ | ผม · ผอ. (Script Properties ที่เป็นค่าลับ) | `ping` ตอบ · ตรวจ LINE แสดง "ส่งเฉพาะผู้ทดสอบ N คน" | |
| ☐ | **R8 ล็อกอินทดสอบ 1 ครั้ง** | มือถือผู้ทดสอบ 1 เครื่อง → เว็บ UAT → LINE → หน้าแรกเห็นข้อมูลจริงของตัวเอง · ป้ายแดง "UAT" | ผม + ผู้ทดสอบ 1 คน | เห็นข้อมูลถูกคน | |
| ☐ | **R9 ซ้อมถอย (P8)** | บนโปรเจ็กต์ **UAT** เท่านั้น: ① Drive › ทำสำเนาชีตหลัก + HR ของจริง ตั้งชื่อ `REHEARSE-R-` · ตั้ง `WB_MAIN_ID`/`WB_HR_ID` ของ**สคริปต์ UAT** ไปที่สำเนา ② เขียนรายการทดสอบ 3 อย่างผ่านแอป UAT (เช็คอิน · ใบลา · OT) ③ `freezeWrites()` → `rollbackToSheets()` (รันซ้ำจนจบ) → อ่านรายงาน → `rollbackActivate()` → `unfreezeWrites()` ④ ตรวจว่า 3 รายการอยู่ในชีตสำเนา ⑤ `rollbackUndoActivate()` กลับ Postgres · **จับเวลา ① freeze → ③ unfreeze** | ผม | รายงาน 0 ไม่ตรง · 3 รายการครบ · **≤ 10 นาที** | |
| ☐ | **R10 ผอ. อ่านรายงานเงิน** (เย็น) | `secrets/export/money_R.md` — ส่งทางที่ปลอดภัย (ไม่ใช่ LINE/แชต) หรือเปิดให้ดูบนเครื่อง · ทุกบรรทัดที่ยอดเปลี่ยนจากการปัดทศนิยม ผอ. ต้องยอมรับ | **ผอ.** | ผอ. ยอมรับทุกบรรทัด | |
| ☐ | **R11 สรุป** | เวลาจริงทุกขั้น → `MOVE_NIGHT_RUNBOOK.md` (ปรับเวลาคืน D) · ผลลง `docs/WORKLOG.md` (ไม่มีชื่อ/ยอดรายคน) · ROLLOUT_PLAN P7/P8 ✅ | ผม | | |

> หลัง R9 ข้อมูลทดสอบ 3 รายการค้างใน atom-prod — ไม่เป็นไร atom-prod ถูก**ล้างให้ว่างก่อนคืน D** (`MOVE_NIGHT_RUNBOOK` ก่อนคืน D)

---

## ต้องได้จาก ผอ. ก่อน R7 (พฤ. 19 พ.ย.)

- **LINE ID ผู้ทดสอบ** (ครูทุกท่าน + คุณแม่เลอา) — ไม่มี = เปิด UAT ได้แต่ LINE ไม่ส่งหาใครเลย
- ว่างอ่านรายงานเงิน (R10) เย็นวันพฤหัส
- สลิปเงินเดือน ต.ค. + ยอดบิล ธ.ค. คำนวณมือ (ใช้ใน UAT ④-ข ④-ค)

## หมายเหตุ R5 — ทดสอบ route บนข้อมูลจริง (ช่องว่างที่พบ 17 พ.ย. · ปิดแล้ว)

ROLLOUT_PLAN เขียนว่า "รันชุดทดสอบทุก route บนสำเนานั้น" แต่ชุดทดสอบที่มีทั้งหมดใช้ข้อมูลที่เขียนขึ้นในตัวทดสอบเอง — ยังไม่เคยมีอะไรรัน route ด้วยข้อมูลจริง 4 ปีของโรงเรียน
→ `tools/route_sweep_real.js` (17 พ.ย.) · ฐานถูกตรวจลายนิ้วมือทุกตารางก่อน/หลัง — เปลี่ยน = ไม่ผ่าน
· self-test บน staging (`--from-db --tenant <code>`): แอดมิน + ครู **66/66 ตรง** · ฐานไม่เปลี่ยน · ข้อมูล staging ไม่มีผู้ปกครองที่ผูก LINE และไม่มีหัวหน้าครู — สองบทบาทนี้ได้ทดสอบครั้งแรกบนข้อมูลจริงใน R5
· ฝั่ง Apps Script บังคับ session เหมือนระบบจริง (`RequireSessionToken`) — ไม่บังคับ = ไม่ผ่าน applyIdentity_ และสองฝั่งจะตอบคนละคำถาม (พบตอน self-test รอบแรก)
