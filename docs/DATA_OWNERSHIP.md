# Whose account holds the database, and why that is not the same question as whose data it is

Written 2026-09-21, answering: should the Supabase account be ours or the school's, and what can we
start on now.

---

## 1. The short answer

**Our account. One Supabase organisation, one production project, every school inside it, separated
by `tenant_id` and row-level security.**

Your instinct about ownership is right, and for stronger reasons than convenience. Your instinct
about a project per school is not — it would cost about **three times as much per school** and would
defeat the very thing you want it for (§4).

---

## 2. The thing that dissolves the worry

The worry behind the question is: *if the account is ours, does the school still own its data?*

**Yes, and that is not a matter of goodwill — it is what the law already says.** Under Thailand's
PDPA the two roles are separate, and the account holder is not the one that matters:

| | Who | What it means |
|---|---|---|
| **ผู้ควบคุมข้อมูลส่วนบุคคล** (Controller) | **The school** | Decides *why* and *how* children's data is processed. Owns it. Answers to the parents |
| **ผู้ประมวลผลข้อมูลส่วนบุคคล** (Processor) | **Us** | Processes it **only on the school's instructions**. Holds the infrastructure. Owns none of it |

So "whose email is on the Supabase account" is an **operations** question, not an **ownership**
question. Every SaaS in the world works this way: your school's Google Workspace data sits on
Google's account, and it is still the school's data, because a contract says so.

> **Trust is built by the agreement and the export button, not by putting the database in the
> school's name.** A school whose data sits in its own Supabase project but who has no contract,
> no export and no deletion promise is *less* protected, not more.

⚠️ **Our privacy page mentions PDPA but does not yet name these two roles.** It was written when
there was one school and we were both. The moment there is a second school, it needs the
controller/processor split spelled out, and each school needs a signed processing agreement
(§6, item 3).

---

## 3. Why the account is ours — five reasons, in order of how badly each one bites

1. **Continuity.** A school's account belongs to a person — the ผอ., or an admin. People leave,
   change passwords, lose phones. The day that happens we lose access to a live database holding
   children's records and payroll, and so does the school.
2. **Support.** "ยอดในสลิปไม่ตรง" arrives at 08:00 on a Tuesday. We cannot answer it if we first
   need someone at the school to be awake and approve an MFA prompt.
3. **Migrations.** A schema change has to run everywhere. Twenty schools granting access on their own
   schedule is not an operation; it is a hope. This is precisely the "อัพเดทต่างๆได้พร้อมกัน" you
   want, and it needs our account to happen at all.
4. **Billing stays ours.** We charge ฿199/child. A school should never see a Supabase invoice in
   dollars — our cost structure is not our customer's problem, and showing it invites a negotiation
   about the wrong number.
5. **Security, and this one is counter-intuitive.** A Supabase dashboard login **bypasses row-level
   security entirely** — RLS protects the app, not the SQL editor. So a school with dashboard access
   to a shared project could read every other school's children. **The school must not have database
   access. Not because we do not trust them, but because the isolation we sell depends on nobody
   having it.**

---

## 4. One project, not one per school

This was already decided (`MIGRATION_DIRECTION.md` §5.1) and it is worth restating with the number,
because a project per school is the intuitive choice and the expensive one.

| | One shared project | One project per school |
|---|---|---|
| **Cost at 20 schools** | Pro + compute ≈ **฿3,000/mo** | 20 × Pro ≈ **฿17,500/mo** |
| **A schema change** | one migration, one run | twenty runs, any of which can half-fail |
| **Our console's "all schools" view** | one query | twenty queries, merged by us |
| **Turning a feature on for one school** | one row | a deploy |
| **Isolation** | RLS — Postgres refuses, on every query | physical |
| **Noisy neighbour** | possible | impossible |
| **A school leaves** | delete their rows, export first | delete the project |

Carried through the whole cost model, per-project takes the total at twenty schools from **฿6,985 to
about ฿21,500/month — ฿349 to ฿1,074 per school**, and the gross margin on Package A from ~93% to
~78%. That is roughly ฿14,500 a month spent on an isolation that RLS already provides.

**And it defeats the stated goal.** Twenty projects is twenty things to keep in step. One project is
one.

> 💡 **The honest exception.** A school that *contractually requires* physical isolation — a
> government-linked school, or one with its own audit rules — is a real case and we should not
> pretend otherwise. That is what **Package D Enterprise** is for: a dedicated project, priced to
> cover a dedicated project. Shared by default; isolated when somebody pays for isolation.

*(Supabase pricing moves — confirm the Pro per-project figure at signup rather than trusting this
table a year from now.)*

---

## 5. How the account should actually be set up

Not a personal Gmail with a shared password. That is how a single leaver or a single leaked file
takes the whole business down — and we have already had the second one.

```
Supabase Organization  ──  owned by an operational identity, never a person's personal account
   │                       MFA on · recovery codes in a password manager, NOT in a repo
   ├── atom-prod          Singapore · every school, separated by tenant_id + RLS
   ├── atom-staging       same schema, fake data — where migrations are rehearsed
   └── (atom-ent-<school>) only if an Enterprise customer buys isolation
```

- **Team members are invited individually**, each with their own login and role. Nobody shares a
  password; removing somebody is removing one membership.
- **Service-role keys never leave the server.** They bypass RLS by design. The app uses the anon key
  plus a signed JWT (`STACK_DECISIONS.md` §1).
- **Two people must be able to get in.** A single account with a single phone is one lost handset
  away from losing a school's payroll.

> 🔴 **Outstanding and relevant:** `Backup codes.pdf` is still in this PUBLIC repository's git
> history (commit `87b97f4`). Those codes should be rotated at Google before any of this is set up —
> the whole point of §5 is that account recovery is the weakest link, and ours is currently
> published. This has been flagged before and is still not done.

---

## 6. What we can start now — none of it wasted, none of it costing money

Ordered so that each one makes the next easier.

| # | Do | Why now | Cost |
|---|---|---|---|
| **1** | **Rotate the leaked Google backup codes** | Everything below hangs off an account whose recovery codes are published | ฿0 |
| **2** | **Create the Supabase org + a FREE project** | The free tier is enough to write and run the schema, prove RLS, and run the JWT spike. No commitment, no card | ฿0 |
| **3** | **Draft the PDPA processing agreement** (ข้อตกลงการประมวลผลฯ) and add the controller/processor split to the privacy page | This is what makes "our account" trustworthy, and it is the answer to the hardest sales objection. It is a writing job, not an engineering one | ฿0 |
| **4** | **Write the 48-table schema as real migration files** in the repo | It is the A1 work, it is needed whatever else is decided, and writing it reveals every place the sheets have been lying about a data type | ฿0 |
| **5** | **Build the export** — every table a school owns, as .xlsx | It is the school's way out, which is the strongest trust signal we have; and it is useful to the school today, before any migration | ฿0 |
| **6** | **Run the Supabase JWT + RLS spike** (2 days) | Largest unknown in the plan. Needs #2 | ฿0 |

⚠️ **One rule while doing all of it:** **no real student data goes into Supabase until #3 exists and
the ผอ. has approved it.** Use the mock fixtures — we have three roster sets already. Moving real
children's records to a new processor before there is a lawful basis and an agreement is exactly the
thing the agreement exists to prevent, and doing it "just to test" is how a good product acquires a
bad first chapter.

---

## 7. What a school is told, in one paragraph

Worth having ready, because it will be asked in the first sales conversation:

> ข้อมูลทั้งหมดเป็นของโรงเรียน · โรงเรียนเป็น **ผู้ควบคุมข้อมูล** ตาม PDPA ส่วนเราเป็น **ผู้ประมวลผล**
> ที่ดำเนินการตามคำสั่งของโรงเรียนเท่านั้น · ระบบฐานข้อมูลอยู่ในความดูแลของเรา เพื่อให้แก้ปัญหาและอัปเดต
> ให้ได้ทันทีโดยไม่ต้องรบกวนโรงเรียน · ข้อมูลของแต่ละโรงเรียนถูกกั้นที่ระดับฐานข้อมูล ไม่ใช่ที่โปรแกรม ·
> โรงเรียน **ขอส่งออกข้อมูลทั้งหมดได้ทุกเมื่อ** และหากเลิกใช้บริการ เราส่งข้อมูลคืนครบถ้วนแล้วลบภายใน 90 วัน
> · ทั้งหมดนี้อยู่ในข้อตกลงเป็นลายลักษณ์อักษร ไม่ใช่คำสัญญาปากเปล่า
