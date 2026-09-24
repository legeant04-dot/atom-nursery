# KALONTA — the brand

**Chosen 2026-09-24.** `docs/BRAND_NAMING.md` is the journey: six rounds, thirty-eight names
checked, twenty-nine eliminated with the reason recorded. **This document is the decision.** It is
the one to read before writing anything the public will see.

---

## 1. The name

| | |
|---|---|
| **Written** | **KALONTA** |
| **Thai** | **คา-ลอน-ตา** — stress on **ลอน** |
| **English** | *kah-LON-tah* |
| **Letters / syllables** | 7 / 3 |
| **Never** | `Kalonta Co.` in the logo, `KALONTA School Management`, or any descriptive suffix. See §7 |

### Why it survived when thirty-seven others did not

- No company, no school, no software, no app, anywhere — checked in the education class as well as
  the software one, which is the check that killed TONKLA and FILIZA
- **All twelve domains free** — `.com .co .io .app .ai .net .org .asia .co.th .in.th .tech .school`
- Contains no loaded substring. Its predecessor KLANOTA was legally clear and read **KLAN** in
  capitals; one swap removed that for nothing
- Thai reads it correctly on the first attempt, with no unfortunate homophone — unlike KLATON
  (**ตัน**, clogged), KLONTA (**คลอน**, wobbly) or LATONK (**ลา**, to leave)

---

## 2. Layer one — the six letters are six people

**This is the true origin and it belongs to nobody else.**

| | |
|---|---|
| **K** | **Kwan** |
| **A** | **Atom** — the nursery that took the first risk |
| **L** | **Leia** |
| **O** | **Organize** — the system itself |
| **N** | **Nursery** |
| **T** | **Tam** |

*(The closing A belongs to Atom as well.)*

The letters arrived first, as **TONKLA** — which turned out to be `tonkla.ac.th`, a Thai school.
Same six letters, rearranged. **The order was never the meaning; the completeness was.**

> Tell this to a director once, at the end, not the beginning. It is the part they repeat to somebody
> else.

---

## 3. Layer two — what the world already says the word means

Both of these were found in the availability check, not invented afterwards, and both happen to
point at the business:

| Source | Meaning |
|---|---|
| **Minahasa** (North Sulawesi, Indonesia) — a family name | **perisai kayu — a wooden shield** |
| **Greek** κάλαντα, as in *paidika kalonta* | **the carols children sing** |

**A shield, and the sound of children singing.** For a platform whose two jobs are protecting a
child's record and carrying what happened today home to a parent, that is a better-evidenced story
than any metaphor we could have written.

And because it reads as a local family name in Indonesia — our first expansion market — it arrives
there as familiar rather than foreign.

### ⚠️ What is NOT the story any more

The **ต้นกล้า / seedling** narrative belonged to TONKLA and KLATARA, which carried **กล้า** in their
letters. **KALONTA does not.** Do not staple that metaphor back on. The shield and the carol are
true of this name; the seedling is not, and a story the name cannot carry is the kind that falls
apart in the second interview.

---

## 4. Layer three — the letters as a charter

§15 of `BRAND_NAMING.md` proved letter-acronyms are invisible to anyone hearing a name, so **these
are not marketing.** They are seven commitments, each already enforced somewhere in this repo, and
the name is how we remember them.

| | Commitment | Enforced by |
|---|---|---|
| **K** — Kin | Family is inside the system, not a recipient of reports | Parent role · LINE · journal comments |
| **A** — Accuracy | Every figure traces back to who entered it and when | `ByStaffID` / `ByAt` on every check-in |
| **L** — Ledger | Money is exact to the satang | `numeric(12,2)` on all 39 money columns; no float anywhere |
| **O** — Open | The data belongs to the school and can leave | `docs/DATA_OWNERSHIP.md` |
| **N** — Nurture | What happened to a child today is written down today | Daily journal · DSPM |
| **T** — Trust | A child's record never crosses to another school | `tenant_id` + RLS on all 52 tables |
| **A** — Always | It works at 07:00, when everybody checks in at once | p50 < 1.5s in the Phase Plan's done-criteria |

**A charter that can be failed is worth more than a slogan that cannot.**

---

## 5. How to say it — three registers

### The line under a school's logo

> **ขับเคลื่อนโดย KALONTA**
> *Powered by KALONTA*

Nothing else. No tagline, no descriptor, no "school management system".

### The one sentence

> **เราไม่ได้สอนเด็ก — เราค้ำโรงเรียนไว้ตอนที่โรงเรียนสอน**
> *We don't teach the children. We hold the school up while it does.*

This is the ingredient-brand position stated honestly, and it is what stops a director asking
whether we compete with them.

### Thirty seconds, for a director

> KALONTA เป็นระบบหลังบ้านของโรงเรียนอนุบาลครับ — ลงเวลาเด็กและครู บันทึกพัฒนาการรายวันถึงผู้ปกครอง
> ใบแจ้งหนี้ เงินเดือน และแจ้งเหตุฉุกเฉินถึงพ่อแม่ทันที
>
> **แอปขึ้นชื่อโรงเรียนของท่าน ไม่ใช่ชื่อเรา** ชื่อเราอยู่บรรทัดเล็กๆ ข้างล่างเท่านั้น
>
> ส่วนชื่อ KALONTA — มันคือตัวอักษรของคนหกคนที่ทำให้ระบบนี้เกิดขึ้นครับ และบังเอิญว่าในภาษาหนึ่ง
> ของอินโดนีเซีย มันแปลว่า **โล่ไม้**

---

## 6. Naming architecture

Amity's structure, not Shopify's — a parent brand holding products, each school keeping its own face.

| Layer | Name | Example |
|---|---|---|
| **The company** | KALONTA | contracts, invoices, the Play Store developer name |
| **What a parent opens** | **the school's own name** | *Atom Nursery*, on the school's own domain |
| **The attribution** | ขับเคลื่อนโดย KALONTA | one small line |
| **Products, later** | `KALONTA <noun>` | `KALONTA Console` — never `KALONTA-ify`, never an acronym |

---

## 7. Two rules taken from `docs/NAMING_BENCHMARK.md`

### Never add a descriptive suffix

17 of the 20 winning global names say nothing about the product. Every descriptive one is carrying a
ceiling: Salesforce bought Slack and Tableau and is still the CRM company; Gusto had to stop being
*ZenPayroll*; Miro had to stop being *RealtimeBoard*.

**The moment we are "KALONTA School Management", we can never sell to a clinic, a daycare, a
tutoring centre or an after-school programme without a rebrand.**

### Never rename

**Omise → Opn (May 2022) → Omise (March 2025).** Two years, two rebrands, back to the start. The
newer name was shorter, more global and more abstract — and it lost to the name people already
trusted. `api.omise.co` was never changed through either.

> **Brand equity lives in the old name. A rename spends it rather than transferring it.** This choice
> was made at the only cheap moment there will ever be — one school live, no equity to lose. It does
> not get made again.

---

## 8. Still open

| | Who | Note |
|---|---|---|
| 🔴 **Register the domains** | **Owner, today** | `.com` first, then `.co.th` once the company exists. A name free today is free to everybody |
| 🔴 **DIP classes 41 + 42** | Owner, via an IP agent | `tmsearch.ipthailand.go.th` is the official register; **41 matters most — that is where the schools are.** Initial examination 4–8 months, total 10–18 |
| **LINE OA id** | Owner | |
| **Play Store developer name** | Owner | Organisation verification needs a D-U-N-S number and takes weeks — start early |
| **Company registration** | Owner | `.co.th` requires a matching registered Thai company |

Near-misses found and judged non-blocking, all in unrelated classes: **Kalontar** (handcrafted
jewellery app; organic catering, Canada), **Kalanta** (a UK Ltd; a Guangzhou leather-goods maker;
and the generic Greek word for carols — which limits distinctiveness in the EU but not in Thailand),
**Calonta** (a personal Instagram account).
