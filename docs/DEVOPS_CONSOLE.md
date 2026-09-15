# The DevOps Console — support channel, tickets, and AI agents

Drafted 2026-09-15. Design only; nothing here is built, and **nothing starts until the ผอ. approves
the plan**. This is the back office for running Atom Nursery as a product sold to several schools.

Read `MIGRATION_DIRECTION.md` §5 first — that covers tenancy, feature flags and release channels.
This file covers the three things that were not in it: how schools reach us, how their requests are
tracked, and whether AI agents should run any of it.

---

## 1. A separate LINE OA — yes, and it is not a close call

> **School OA** = the school talking to its parents.
> **Product OA** = us talking to the schools.

Five reasons they cannot be the same account:

| | |
|---|---|
| **Different audience** | One speaks to 60 families about their children. The other speaks to 1–2 admins about software. Mixing them means every parent can see our release notes |
| **Different voice** | The school's OA is the school's brand. Support messages from "Atom Nursery" would read as the school talking about itself in the third person |
| **Quota is real money** | LINE charges per message beyond the free tier. Support traffic competing with parent notifications is how a school runs out of quota in the middle of a billing round — which has already happened once on the school's own OA |
| **Identity** | We need to know *which school* is asking. A dedicated OA with a one-time linking step gives us `tenant_id` on every message; sharing the school's OA gives us nothing |
| **Each school brings its own** | School B will have its own OA for its own parents. Ours has to be ours, or the model does not scale past one |

**Linking, once per admin:** the admin opens 👤 ข้อมูลของฉัน in the app → "เชื่อมบัญชี LINE สำหรับแจ้ง
ปัญหา" → a one-time code → they send it to the product OA → we now know that LINE id is
`tenant_id=X, role=Admin`. Same shape as the Google link that already exists, and it reuses the
linking flow we have.

---

## 2. The bot is a front door, not a filing cabinet

A LINE bot is an excellent place to **receive** and **notify**. It is a bad place to **store**.
Tickets need state, an owner, a history, an SLA and a searchable archive; a chat thread has none of
those and cannot be reported on.

```
LINE OA (product)                 DevOps Console (Postgres)
─────────────────                 ─────────────────────────
admin types a problem   ──────▶   ticket created, tenant_id attached,
                                  severity set, context auto-gathered
                        ◀──────   "รับเรื่องแล้ว #1043 · ระดับ: ด่วน"

                        ◀──────   every status change pushed back
                                  ("กำลังแก้ไข" → "แก้แล้ว v391" → "ปิดงาน")
```

### Ticket types — taken from what actually happens with this school

| ชนิด | ตัวอย่างจริง | ระดับเริ่มต้น | ไปที่ |
|---|---|---|---|
| 🔴 **ข้อมูลเงินผิด** | "ยอดในสลิปไม่ตรง" · "บิลออกซ้ำ" | **ด่วนที่สุด** | คนเสมอ — ไม่มี agent ตัวไหนแตะ |
| 🟠 **ระบบล่ม / เข้าไม่ได้** | "ผู้ปกครองเข้าไม่ได้หลายคน" | ด่วน | Incident → คน |
| 🟡 **ทำงานไม่ถูกต้อง** | "บันทึกรายวันยังขึ้นทั้งที่เด็กลาชั่วคราว" | ปกติ | Dev |
| 🔵 **ขอฟีเจอร์** | "อยากได้เมนูวันตัดรอบบิล" | ต่ำ | Product backlog |
| ⚪ **ถามวิธีใช้** | "ปลดล็อกสมุดรายวันยังไง" | ต่ำ | **ตอบอัตโนมัติจากคู่มือ** |
| 🟣 **ขอเปิด/ปิดฟีเจอร์** | "อยากเปิด DSPM" | ปกติ | Provisioning (สลับ flag) |
| 💰 **เรื่องบิลของเรา** | "จำนวนเด็กในใบแจ้งหนี้ไม่ตรง" | ปกติ | Finance → คนอนุมัติ |

**Auto-attached context on every ticket** — because the first four questions we would ask are
already answerable: plan and channel, app version, the tenant's p50/p95 for the last 24h, their last
20 errors from the telemetry we already collect, and which feature flags are on. A ticket that
arrives already carrying its own evidence is the difference between a day of back-and-forth and one
reply.

---

## 3. AI agents — the honest version

The question was which positions we should have to cover the whole business. Here is the full roster
**and** the order to build it in, because those are different answers and the second one matters
more.

### 3.1 The rules that come before the roster

These are not negotiable, and they are the same principle this codebase has followed all year.

1. **No agent moves money. Ever.** Not our invoices, not a school's bills, not a payroll run. Agents
   may *draft* and a human sends. "เรื่องเงินเป็นเรื่องละเอียดและสำคัญมากต่อความน่าเชื่อถือ" applies
   to our own billing exactly as much as to a school's.
2. **No agent writes to a school's production data** without a human approving that specific action.
   Reading, scoped to one tenant, is fine.
3. **Every agent gets an identity and appears in the audit log** exactly as a person does. A school
   must be able to see that a change was made by us, and by which agent.
4. **Impersonating a user is a human-only action**, with the banner and the audit row already
   specified in `MIGRATION_DIRECTION.md` §5.5.
5. **An agent that is not sure says so and escalates.** It never guesses at a school about money,
   attendance, or a child.
6. **Agents read the manuals, not the database, to answer "how does this work".** Which is the fourth
   reason `docs/spec/` has to exist — it is the corpus.

### 3.2 The roster

| # | ตำแหน่ง | หน้าที่ | ทำเองได้ | ต้องให้คนอนุมัติ |
|---|---|---|---|---|
| 1 | **เจ้าหน้าที่รับเรื่อง**<br/>Triage | อ่านทุกข้อความเข้า จัดชนิด ตั้งระดับความด่วน แนบหลักฐานอัตโนมัติ ส่งต่อ | จัดชนิด · ตั้งระดับ · แนบบริบท · ตอบรับ | เปลี่ยนระดับของ 🔴 เรื่องเงิน |
| 2 | **ผู้ช่วยตอบลูกค้า**<br/>Support | ตอบคำถามวิธีใช้จากคู่มือทั้ง 5 เล่ม อ้างอิงหน้าที่ตอบมาจาก | ตอบ ⚪ ถามวิธีใช้ | ทุกคำตอบ ในช่วง 3 เดือนแรก |
| 3 | **เฝ้าระบบ**<br/>Incident | ดู p50/p95/error rate รายโรงเรียนจาก telemetry ที่เก็บอยู่แล้ว · เปิด ticket ก่อนลูกค้าทัก | เปิด ticket · แจ้งเตือนเรา | — (อ่านอย่างเดียว) |
| 4 | **นักพัฒนา**<br/>Dev | อ่าน ticket → หาสาเหตุ → **เขียน test ที่ fail ก่อน** → เสนอ patch เป็น PR | เปิด PR · เขียน test | **merge ทุกครั้ง** |
| 5 | **ตรวจและปล่อย**<br/>QA / Release | รันชุดทดสอบ · ตรวจ diff · เขียน patch note รายโรงเรียน · คุม stable/beta | **บล็อก** การปล่อยได้ | **ปล่อย** ทุกครั้ง |
| 6 | **ตรวจงานออกแบบ**<br/>UX | ตรวจหน้าจอใหม่กับ `FRONTEND_DESIGN.md` — 375px · focus · คอนทราสต์ · empty state | ให้ความเห็น · บล็อก PR | — (ให้คำแนะนำ) |
| 7 | **การเงิน**<br/>Finance | นับเด็ก ACTIVE ณ วันตัดบิล · ร่างใบแจ้งหนี้ · กระทบยอด · เตือนเมื่อจำนวนเด็กกระโดด | **ร่าง**ใบแจ้งหนี้ · รายงานส่วนต่าง | **ส่ง**ใบแจ้งหนี้ · ทุกการรับเงิน |
| 8 | **รับลูกค้าใหม่**<br/>Onboarding | พาโรงเรียนใหม่ตั้งค่าตาม checklist: นำเข้ารายชื่อ · GPS · วันตัดบิล · flags · อบรม | เตรียมข้อมูล · ติดตาม checklist | เขียนข้อมูลจริงทุกครั้ง |
| 9 | **การตลาด**<br/>Marketing | ดูว่าโรงเรียนใช้ฟีเจอร์ไหนจริง (เรามี telemetry) · ร่างเนื้อหา · เสนอว่าควรสร้าง/ขายอะไรต่อ | ร่าง · วิเคราะห์ | เผยแพร่ทุกชิ้น |
| 10 | **หัวหน้างาน**<br/>Dispatcher | จ่ายงานระหว่าง agent · ตาม SLA · ยกระดับให้คนเมื่อเกินกำหนดหรือเกินความสามารถ | จ่ายงาน · ยกระดับ | — |

### 3.3 The order to build them — and it is not "all ten"

> **วันนี้เรามีลูกค้า 0 ราย และ ticket 0 ใบ** การสร้าง agent 10 ตัวตอนนี้คือการสร้างคำตอบให้กับคำถาม
> ที่ยังไม่มีใครถาม

| ระยะ | โรงเรียน | สร้าง agent ตัวไหน | ใครทำที่เหลือ |
|---|---:|---|---|
| **ตอนนี้** | 1 | **ไม่มีเลย** — สร้างแค่ระบบ ticket และช่องทาง LINE | คน |
| **ระยะ 1** | 2–3 | **① Triage + ② Support** | คน |
| **ระยะ 2** | 4–10 | + **③ Incident + ⑦ Finance (ร่าง) + ⑧ Onboarding** | คน |
| **ระยะ 3** | 10+ | + **④ Dev + ⑤ QA + ⑥ UX + ⑨ Marketing + ⑩ Dispatcher** | คนตรวจ |

**ทำไม Triage มาก่อน** — มันเป็นตัวเดียวที่ช่วยตั้งแต่ ticket ใบแรก ไม่ต้องรอปริมาณ และมันสร้างข้อมูลที่ agent
ตัวอื่นต้องใช้ (ชนิดงาน ระดับ ความถี่) · ถ้าไม่มี Triage มาก่อน agent ตัวอื่นจะไม่รู้ว่าตัวเองต้องทำอะไรบ้าง

**ทำไม Dev มาทีหลังทั้งที่ดูสำคัญ** — เพราะตอนนี้ผมทำงานนั้นอยู่ และ bottleneck ไม่ใช่การเขียนโค้ด
มันคือการรู้ว่าต้องเขียนอะไร ซึ่งคือหน้าที่ของ Triage

### 3.4 What an agent needs to exist

Each agent is one row, not a code branch:

```sql
agents
  id · name · role · model · enabled
  scope_json          -- ข้อมูลที่อ่านได้: tenant ไหน ตารางไหน
  can_json            -- สิ่งที่ทำเองได้
  needs_approval_json -- สิ่งที่ต้องให้คนกด
  corpus[]            -- docs/spec/** ที่ใช้ตอบ
agent_runs
  agent_id · ticket_id · input · output · decision · approved_by · at
```

`agent_runs` is the whole safety story: **every agent action is a row a human can read afterwards**,
with what it saw, what it decided, and who approved it. Same discipline as `AUDIT_LOG` — the reason
we can trust the app today is that nothing happens in it without a row.

---

## 4. The console screens, revised

| หน้าจอ | ทำอะไร | มีตั้งแต่ |
|---|---|---|
| Tenants | รายชื่อโรงเรียน · แผน · ช่อง stable/beta · ระงับ/คืนสิทธิ์ | ระยะ 1 |
| Features | ตาราง tenant × feature พร้อมตัวแก้ config | ระยะ 1 |
| **Tickets** | คิวงาน · SLA · ประวัติ · ผูกกับ LINE OA | **ระยะ 1** |
| Health | p50/p95/error rate รายโรงเรียน จาก telemetry ที่มีอยู่ | ระยะ 1 |
| Billing | ใบแจ้งหนี้ · จำนวนเด็กที่นับได้พร้อมรายชื่อ · สถานะชำระ | ระยะ 2 |
| Releases | patch note · สถานะการทยอยปล่อย · kill switch | ระยะ 2 |
| **Agents** | เปิด/ปิด agent · ดู `agent_runs` · อนุมัติงานที่รอ | ระยะ 2 |
| Support | เข้าดูในมุมมองผู้ใช้ (คนเท่านั้น · มีแบนเนอร์ · มี audit) | ระยะ 2 |

---

## 5. What I would push back on

Three things worth saying plainly before any of this is built:

1. **An AI agent answering a school about money is the fastest way to lose a school.** Agent ⑦ drafts
   and a human sends, permanently — not as a training-wheels phase.
2. **Ten agents is an org chart, not a plan.** Two agents that work beat ten that need watching. The
   phased table above is the recommendation, not the full roster.
3. **The manuals are the prerequisite.** Agents ①②⑥ answer from `docs/spec/`. Without those
   documents finished and confirmed by the school, a support agent is guessing — and guessing to a
   customer is worse than not replying.
