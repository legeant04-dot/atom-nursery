# What it costs us to run this, and how many schools make it sustainable

Written 2026-09-16, answering: what do the AI agents cost per month, what does the back office cost
that is *not* the school's app, and how many schools do we need before this pays for its own upkeep.

Companion to `PRICING_AND_TENANCY.md` (what schools pay us) and `STACK_DECISIONS.md` (what the
product infrastructure costs). This file is the other side of the ledger: **our** costs.

฿35 = $1 throughout.

---

## 1. The headline, before the detail

| | ฿/month |
|---|---:|
| Product infrastructure (the schools' app) | 1,825 → 4,245 |
| **Back office** (console, support channel, monitoring, tooling) | **≈ 400** |
| **AI agents** | **30 → 2,300** |
| **Total cash cost, 20 schools, everything switched on** | **≈ ฿6,950** |

> **The AI agents are not the expensive part, and one of them is 80% of their bill.** Nine of the ten
> agents together cost about ฿470/month at twenty schools. The tenth — the Dev agent — costs ฿1,830,
> because reading a codebase to find a bug is the only genuinely expensive thing on the list.

And the number that is not on it:

> ⚠️ **Human time is the real cost of sustainability, and it is not ฿0.** Everything above is tooling.
> At twenty schools somebody still answers the phone, onboards a school, and decides what to build.
> §6 prices that honestly, because a plan that pretends it is free is not a plan.

---

## 2. AI agents — the arithmetic, not a guess

Anthropic API list prices (checked 2026-09-16):

| Model | Input $/MTok | Output $/MTok | Use it for |
|---|---:|---:|---|
| Claude Haiku 4.5 | $1 | $5 | Classifying, routing, extracting |
| Claude Sonnet 5 | $2 | $10 | Answering from documents, reviewing, drafting |
| Claude Opus 5 | $5 | $25 | Reading code and writing patches |

Two levers applied throughout: **prompt caching** (a cached prefix is read at ~10% of the input
rate, and every agent has a large fixed instruction block) and the **Batch API** (−50%, fine for
anything not answering a person in real time).

**Volume assumption.** This school has produced roughly 10–15 support-worthy messages a month during
its heaviest development period. Twenty schools running a *stable* product should be quieter per
school, not busier — call it **250–300 tickets/month at 20 schools**, and ~30 of those turn out to
be real bugs.

| # | Agent | Model | Runs/mo | ฿/run | **฿/month** |
|---|---|---|---:|---:|---:|
| ① | Triage | Haiku 4.5 | 300 | 0.16 | **50** |
| ② | Support | Sonnet 5 | 180 | 0.77 | **140** |
| ③ | Incident | Sonnet 5 | 20 | 0.55 | **11** |
| ④ | **Dev** | **Opus 5** | **30** | **61** | **1,830** |
| ⑤ | QA / Release | Sonnet 5 | 20 | 2.80 | **56** |
| ⑥ | UX review | Sonnet 5 | 20 | 2.10 | **42** |
| ⑦ | Finance | Sonnet 5 | 20 | 0.90 | **18** |
| ⑧ | Onboarding | Sonnet 5 | 1 school | 30 | **30** |
| ⑨ | Marketing | Sonnet 5 | ~8 | 12 | **100** |
| ⑩ | Dispatcher | Haiku 4.5 | 300 | 0.13 | **40** |
| | | | | | **≈ ฿2,320** |

### Where the ฿61 per bug comes from

One Dev-agent session on a real bug: read the reported symptom, find the code, reproduce it, write a
failing test, propose a patch. Measured against what that work actually takes in this repository:

```
input   ~400,000 tok   of which ~280,000 are cache reads   $0.14
                          and ~120,000 are fresh           $0.60
output   ~40,000 tok                                       $1.00
                                                     ≈ $1.74  ≈ ฿61
```

Worth keeping in proportion: **฿61 to find and fix a bug** against ฿4,975/month from one school on
the entry package. Even at a hundred bugs a month it is 12% of one school's fee.

### Three things that would make this bill wrong

1. **Running the Incident agent on a timer.** Detecting "p95 went over 3 seconds" is arithmetic, not
   judgement — code does it for ฿0. The model should run only when a threshold has already tripped,
   to write the ticket and gather the evidence. A model polling hourly would cost more than the
   other nine agents combined and find nothing 719 times out of 720.
2. **Letting the Support agent retrieve the whole manual.** With naive retrieval that is ~40,000
   tokens a question instead of ~6,000, and ฿140/month becomes ฿900. Retrieve sections, not files.
3. **Using Opus where Sonnet is enough.** Classification and routing on Opus would multiply ① and ⑩
   by five for no measurable gain.

### What it actually costs by phase

The roster is not built at once (`DEVOPS_CONSOLE.md` §3.3), so the bill is not paid at once either:

| Phase | Schools | Agents running | **฿/month** |
|---|---:|---|---:|
| **Now** | 1 | none — build the ticket system first | **0** |
| **1** | 2–3 | ① Triage + ② Support | **≈ 30** |
| **2** | 4–10 | + ③ Incident, ⑦ Finance, ⑧ Onboarding | **≈ 180** |
| **3** | 10–20 | all ten | **≈ 2,320** |

> At the point we most need to be careful with money, the agents cost about ฿30 a month.

---

## 3. Back office — our costs that are not the schools' app

| | ฿/month | Note |
|---|---:|---|
| DevOps Console hosting | **0** | Same Vercel project, a different route. A second project would be ฿700 for nothing |
| DevOps Console database | **0** | Same Supabase, a separate schema. Tenancy is already row-level |
| Product LINE OA | **0** | Support volume sits inside the free tier. ฿1,200 (Light) only if it stops doing so |
| Uptime monitoring | **0** | The app already reports its own p50/p95/errors per tenant. A second vendor would tell us what we already collect |
| Off-platform backup to R2 | **20** | Supabase has point-in-time recovery; this is the copy that survives losing the Supabase account |
| Domain + product email | **100** | |
| Invoicing / bookkeeping | **300** | Manual at twenty schools; a tool past that |
| Google Play (one-off ฿875) | **—** | |
| Apple Developer ฿3,465/year | **(290)** | **only if we do iOS** — currently deferred |
| **Total** | **≈ ฿420** | **≈ ฿710 with iOS** |

**Why this is so small:** almost every back-office need is already met by something built for the
school. The console shares the app's deployment and database, monitoring shares the telemetry the app
already sends, and support shares an account we would have anyway. That is a direct payoff from
building tenancy into the schema from the first migration rather than bolting it on.

---

## 4. The full monthly picture

| | 1 school | 5 schools | 20 schools |
|---|---:|---:|---:|
| Product infrastructure | 1,825 | 2,200 | 4,245 |
| Back office | 420 | 420 | 420 |
| AI agents | 0 | 30 | 2,320 |
| **Total cost** | **฿2,245** | **฿2,650** | **฿6,985** |
| Revenue (25 children avg, mixed A–C) | 5,000–10,000 | 30,000–45,000 | 120,000–180,000 |
| **Gross margin** | **55–78%** | **91–94%** | **94–96%** |
| Cost per school | ฿2,245 | ฿530 | **฿349** |

---

## 5. Where it becomes sustainable

Three different bars, and they are worth separating because people usually mean the third one.

| Bar | Means | Schools needed |
|---|---|---:|
| **Cash break-even** | The tooling pays for itself | **1** |
| **Funds its own development** | ~฿30,000/mo to keep building — roughly a part-time developer | **7–8** |
| **Funds a person** | ~฿60,000/mo — somebody whose job this is | **13–15** |

At **Package A, 25 children — ฿4,975/school/month**:

```
 1 school   ฿4,975    − ฿2,245 cost  =  ฿2,730   tooling paid for
 5 schools  ฿24,875   − ฿2,650       =  ฿22,225
 8 schools  ฿39,800   − ฿3,200       =  ฿36,600  ← funds continued development
15 schools  ฿74,625   − ฿5,900       =  ฿68,725  ← funds a person
20 schools  ฿99,500   − ฿6,985       =  ฿92,515
```

> **Eight schools is the number that matters.** Below it this is a side project the school subsidises.
> At eight it pays for its own upkeep and improvement, which is what "ยั่งยืน" actually means.

And the honest reading of that: **eight schools in eighteen months is a modest, achievable target.**
It does not require a sales team; it requires eight conversations that go well.

---

## 6. The cost nobody puts in the spreadsheet

Everything above is tooling. At twenty schools there is still a person who:

- answers a school on a Tuesday morning when payroll looks wrong
- sits with a new school for a day importing their roster
- decides which of eleven feature requests gets built
- is responsible when something breaks

The agents reduce that load; they do not remove it. **Budget it as a real line — ฿30,000–60,000 a
month once past eight schools — and price it into the plan from the start**, or the first busy month
is paid for out of somebody's evenings and the product quietly stops being maintained. That is the
most common way small software like this dies, and it is entirely avoidable by writing the number
down early.

---

## 7. How we sell it

### 7.1 The pitch is not software

A nursery director does not want software. Lead with what the school gets, in their words:

| Say | Not |
|---|---|
| "ครูได้เวลาคืนวันละครึ่งชั่วโมง" | "ระบบจัดการโรงเรียนครบวงจร" |
| "ผู้ปกครองเห็นลูกถึงโรงเรียนทันที" | "ระบบเช็คอินด้วย GPS" |
| "เงินไม่ตกหล่น บิลออกตรงเวลาทุกเดือน" | "โมดูลการเงิน" |
| "ครูไม่ต้องนั่งคำนวณเงินเดือนเอง" | "ระบบ Payroll" |

### 7.2 Our reference customer is the strongest asset we have

Atom Nursery has been running this on **real children, real money and real payroll for months**. That
is worth more than any brochure — and the specifics are worth more than the claim:

- 31 children, 10 staff, live since 2026-07
- 137 automated tests protecting the rules
- Every rule written down: five role manuals, ready to hand over

**Ask the ผอ. for two things:** permission to name the school as a reference, and one afternoon with
a director from another school.

### 7.3 The sequence

| | What | Why |
|---|---|---|
| **1** | **Free 30-day trial, full Package C** | A nursery cannot evaluate this in a demo. It has to survive a real week of drop-offs. Already designed (`PRICING_AND_TENANCY.md` §5) |
| **2** | **We import their roster for them** | This is the real barrier, not price. A director will not retype 40 families. Do it as part of onboarding and say so |
| **3** | **Start on Package A** | Cheapest yes. B and C sell themselves later, from inside the product, once payroll day hurts |
| **4** | **Monthly, no lock-in, for the first year** | We are asking a school to trust a new vendor with their money. A contract makes that harder, not easier — and after a term of daily use nobody leaves |

### 7.4 Where the first eight come from

In the order they are likely to work:

1. **Word of mouth from parents** — this school's parents include teachers and owners at other
   nurseries. The app is in their hand every morning. **This is the cheapest channel and it costs
   nothing to start: ask.**
2. **The ผอ.'s own network** — directors' associations, district meetings, supplier introductions.
   A recommendation from a peer outweighs everything else in this market.
3. **Nurseries in the same district** — close enough to visit, similar size, similar rules.
4. **Thai Facebook and LINE groups for nursery owners** — where these decisions are actually
   discussed. Participate, do not advertise.
5. **Google Play listing** — not a channel on its own, but the thing a cautious director checks
   before believing we are real.

Paid advertising is not on the list. At ฿5,000/month per customer with a long sales cycle and a
market measured in hundreds, it will not pay back — the first eight come from people who already
trust somebody who uses it.

### 7.5 The three objections, and the honest answers

| They say | Answer |
|---|---|
| "ราคาแพงกว่าที่คิด" | It is 2.9% of the school's revenue, and it replaces work somebody is doing by hand. Show the arithmetic against **their** roll, not ours |
| "ข้อมูลเด็กจะปลอดภัยไหม" | Row-level isolation in the database, daily backups, a full audit log, and a written policy on what happens to their data if they leave. **Say the last part before they ask** |
| "ถ้าคุณเลิกทำ เราจะทำยังไง" | The fair answer, and the reason §5 exists: the price is set so the product funds its own upkeep, and every school can export everything it owns at any time. A vendor who has not thought about this question has not earned the answer |

---

## 8. What to do about this before the ผอ. answers

Nothing here needs money or approval:

1. **Ask the ผอ. for permission to use the school as a reference**, and for one introduction. That
   single conversation is worth more than the rest of this document.
2. **Write down the data-export promise** — what a school gets back and how fast, if they leave. It
   belongs in the contract and it answers the hardest objection before it is raised.
3. **Keep measuring.** Every ticket this school raises between now and the first sale is a data point
   for what the Triage and Support agents will see, and how many of them there will be.
