# Packages, metering and what a tenant is

Decided 2026-09-15. Supersedes the "20 schools × flat fee" arithmetic in `MIGRATION_DIRECTION.md`
§6, which was a placeholder.

**The model: charge per child, per month.** A school with more children pays more, which is the
right shape — our cost grows with children too (rows, photos, notifications), and it is a number the
school already thinks in, because it is exactly how they charge parents.

---

## 1. The ladder

| | | ฿/child/month | Gets |
|---|---|---:|---|
| **A** | เริ่มต้น | **199** | The school day |
| **B** | มาตรฐาน | **299** | A + money and staff |
| **C** | Pro | **399** | B + payroll and the specialist records |
| **D** | Enterprise | quote | C + anything that is not a flag |

### What is in each

Everything below already exists and is already tested. Nothing here is a promise of new work.

**Core — in every package, never a flag**

Parent app on LINE · student records · check-in / check-out with the GPS gate · daily journal ·
announcements · in-app notification inbox · attendance reports · admin dashboard · audit log ·
daily backup.

**A — เริ่มต้น ฿199**

Core, plus the billing a nursery cannot run without:
bills (issue, track, chase) · cash payment recording · the parent's own payment screen ·
billing-day groups.

**B — มาตรฐาน ฿299**

A, plus money that runs itself and the staff side:
**SlipOK automatic slip verification** · ชำระล่วงหน้า (prepay with the discount tiers) ·
staff attendance · leave with the two-step approval chain · absence follow-up with medical
certificates · growth records · injury reports.

**C — Pro ฿399**

B, plus everything the bigger school needs and the specialist records:
**payroll and salary slips** · OT and holiday OT · DSPM assessment · insurance records · surveys ·
food menu · class organisation (จัดชั้นเรียน) · Excel export · Observer role ·
LINE push from the school's own OA¹.

**D — Enterprise — quote**

C, plus the things that are deliberately *not* feature flags:
custom fields and content slots · a non-LINE login for staff · API access · dedicated onboarding and
training · a named support contact and a response-time commitment.

> ¹ LINE push is metered by LINE, not by us. A school on C either uses their own LINE OA plan or we
> pass the cost through. This must be written into the contract, or the first school that sends
> 40,000 messages in a month becomes our problem.

---

## 2. The two rules that make the arithmetic work

### 2.1 A floor of 20 children

฿199 × 8 children = ฿1,592/month, which does not cover what one tenant costs us to run. So:

> **Every school is billed for a minimum of 20 children, whatever its roll.**

Package A therefore starts at **฿3,980/month**. Say it out loud in the price list — a floor
discovered at the first invoice is a bad conversation.

### 2.2 Above 30 children it stops being a price list

Per-child pricing is linear, and linear pricing breaks:

| Children | A ฿199 | C ฿399 |
|---:|---:|---:|
| 20 | ฿3,980 | ฿7,980 |
| 30 | ฿5,970 | ฿11,970 |
| 60 | ฿11,940 | **฿23,940** |
| 100 | ฿19,900 | **฿39,900** |

A 100-child school on Pro would be quoted ฿39,900/month for software. It will not sign, and it
should not — our cost for that school is nowhere near it.

> **Over 30 children, or any request that is not a flag, goes to Enterprise and gets a quote.**

That is exactly the rule already chosen, and the table above is why it is the right one: 30 is
roughly where a fixed price stops being defensible.

For the quote itself, a defensible shape is banding — full price for the first 30, **−20%** for
31–60, **−35%** for 61+ — which puts that 100-child school near ฿28,000 instead of ฿39,900. Rough,
and it stays a conversation rather than a published number.

### 2.3 A sanity check against what a school actually earns

Atom Nursery: **31 active children, ฿6,900 tuition** ⇒ roughly **฿214,000/month**.

| Package | ฿/month | % of the school's revenue |
|---|---:|---:|
| A | 6,169 | **2.9%** |
| B | 9,269 | **4.3%** |
| C | 12,369 | **5.8%** |

School management software normally lands at 1–3% of revenue. **A is priced right. C is at the top
of what is defensible** — it is only defensible because it contains payroll, which replaces an
accountant's time rather than adding a cost.

Worth watching: if C is a hard sell, the answer is to move payroll into its own add-on rather than
to discount the whole package.

---

## 3. What counts as a billable child

This is a billing rule, and this app already knows that billing rules have to be written down before
they are implemented. Ours:

| State in the system | Billed? | Why |
|---|:---:|---|
| **ACTIVE** | ✅ | Using the app |
| **PAUSED** (`setStudentPause`) | ❌ | The school has already stopped charging the family |
| **WITHDRAWN** | ❌ | Gone. The record stays for history, which costs us nothing |
| **Pre-enrolled** (deposit paid, not started) | ❌ | Not attending yet |
| Sibling on a second parent's login | ✅ once | Billed per **child**, never per login |

**Metering:** a snapshot of ACTIVE children **on the tenant's billing date**, once a month. Not a
daily average — a school that enrols a child on the 28th should not pay a fraction of a fraction,
and a number the school can verify by looking at their own roster is worth more than a precise one
they cannot.

**The count is shown in the school's own admin screen**, next to the invoice, with the list of
children it is based on. A bill whose number cannot be checked is a bill that generates a phone
call.

---

## 4. What this means for revenue

Assuming an average of 25 children and a mix of A/B/C:

| Schools | Monthly revenue (mixed) | Our infrastructure cost | Gross margin |
|---:|---:|---:|---:|
| 1 | ฿5,000–10,000 | ฿1,625 | 67–84% |
| 5 | ฿30,000–45,000 | ฿2,200 | ~94% |
| 20 | ฿120,000–180,000 | ฿4,200 | **~97%** |

The first school is the expensive one. Everything after it is nearly pure margin, which is the
normal shape of this business and the reason the tenancy work has to be done properly once rather
than repeatedly.

---

## 5. What a tenant is, precisely

```sql
tenants
  id · slug · name · status(trial|active|suspended|closed)
  plan_id · channel(stable|beta) · timezone · locale
  billing_day · min_children(default 20) · price_override_json
  trial_ends_at · created_at

tenant_children_snapshots        -- what we billed, and the evidence
  tenant_id · period · counted_at · active_count · child_ids[] · plan_id · amount

tenant_features                  -- the per-customer override
  tenant_id · feature_key · state(on|off|inherit) · config_json
```

Three states worth designing for up front, because retrofitting them is what hurts:

- **trial** — full Package C for 30 days, no invoice, a banner that counts down. A nursery cannot
  evaluate this in a demo; it has to run a real week of check-ins.
- **suspended** — unpaid. **Reads stay open, writes close.** Never delete a school's data over an
  invoice; a parent must still be able to see their child's journal while two adults argue about
  money.
- **closed** — export everything, keep it 90 days, then remove it. Written into the contract.

---

## 6. Tenancy is part of the schema, not a phase

The single most important consequence of "multi-tenant must be finished before we sell":

> **`tenant_id` goes on every table from the first migration.**

Adding it on day one costs almost nothing. Retrofitting it across 48 tables and every RLS policy
after the data is live is weeks of work and the kind of change that loses rows. So the tenancy model
is a property of **A1 (schema)**, not a later phase of Track B — even though the console that drives
it is built later.

The same goes for the feature-flag call: `can(tenant, user, feature)` exists from the first screen,
answering `true` for everything while there is one school. Screens written against it are
multi-tenant already; screens written without it have to be revisited.
