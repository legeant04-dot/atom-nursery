# Where Atom Nursery goes next — a direction, not yet a plan

Drafted 2026-09-15 in answer to: move to Vercel + Supabase + R2 + Clerk, keep SlipOK, add n8n, use
Figma, ship to Play Store and App Store, and build a way to sell this to other schools.

This document says what I think we should do, what I think we should *not* do, what it costs, and
what I need decided before any of it starts. Nothing here has been built.

---

## 1. What we actually have

Measured, not remembered:

| | |
|---|---|
| Frontend | **20,272 lines** — `app.js` 12,927 · `engine.js` 5,548 · `api.js` 1,040 · `styles.css` 757 |
| Backend | **16,404 lines** of Apps Script across 30 `.gs` files |
| API surface | **151 explicit routes** + **300 engine handlers** (115 exist in both — the shadow-route problem) |
| Screens | **27** across 4 roles (Admin 11 · Teacher 9 · Parent 7) |
| Data | **48 sheets** across two Google Sheets workbooks |
| Tests | **137 suites**, all green |
| Live users | ~34 students · ~61 parents · ~10 staff · 1 school |
| Android | Signed TWA APK, CI-built, distributed by direct download — **not on Play Store** |
| iOS | PWA install only |

And the number that matters most, from the 10–14/09 report:

> **p50 = 6.8s. p95 = 28.8s.**

---

## 2. The honest diagnosis

**The pain is the database, and only the database.**

Apps Script runs **one execution at a time per user** and Google Sheets is not a database. Every
screen in this app is fast in the browser and then waits ~7 seconds for a spreadsheet. That is where
the 6.8s lives. It is also where `absence 3.8 > 3` and `finance p95 125.9s` live, and why the whole
client-side cache, the micro-batching, the stale-while-revalidate and the round-trip budgets exist
at all — every one of those is a workaround for the same thing.

Against that:

- The **business logic is sound and heavily tested.** 137 suites encode rules that took months and
  real incidents to get right (prepay tiers, OT on holidays, child rate, the four reasons a child is
  not expected, the two-step leave chain).
- The **UI works.** People use it every day. It is not pretty, but nothing is blocked by how it
  looks.

**So: moving to Postgres is a performance fix worth doing on its own merits and would pay for itself
immediately. Rewriting the frontend is a product decision — it buys a sellable SaaS and a better
UX, not speed.** They should not be the same project, and the database one should go first.

---

## 3. Verdict on each piece of the proposed stack

| Piece | Verdict | Why |
|---|---|---|
| **Supabase** | ✅ **Yes — do this first** | 6.8s → sub-200ms. Real transactions for money. RLS replaces `applyIdentity_`. Point-in-time recovery replaces our own backup sheets. This single change is most of the value in the whole plan. |
| **Vercel** | ✅ Yes | Next.js + edge, previews per PR, and it removes the "GitHub Pages serves a minified `dist_pages`" awkwardness. Low risk. |
| **Cloudflare R2** | ✅ Yes | Images currently go to Drive through `IMAGE_COLS_` because a sheet cell dies at 50,000 characters. R2 is S3-compatible with **zero egress cost** — for an app full of photos of children that matters. |
| **SlipOK** | ✅ Keep, untouched | It works, it is the money path, and there is no reason to put it at risk. |
| **n8n** | ✅ Yes, but small | Replaces four GAS triggers (06:50 reminder, daily backup, 10:00/20:00 digests) and becomes where billing runs and absence nudges live. Do **not** put money *calculation* in n8n — only scheduling and notification. |
| **Clerk** | ⚠️ **Yes, but not the way it sounds** | See below. This is the biggest risk in the plan. |
| **Figma API** | ⚠️ **Useful, but not for what was asked** | See below. |
| **Play Store** | ✅ Achievable — weeks | TWA is already built and signed. |
| **App Store** | ⚠️ **The expensive one** | See below. |

---

### 3.1 Clerk — the risk nobody would see coming

**Every parent signs in with LINE, inside LINE.** Not "LINE OAuth" — LIFF, the SDK that runs in
LINE's in-app browser, where the parent is *already* signed in and taps nothing. Our whole identity
model hangs off the LINE user id: `USERS.LineUID`, `PARENTS.LineUID`, `STAFF.LineUID`,
`USER_LINKS`, `parentOwnsStudent_`, every session token.

If we replace that with Clerk's hosted sign-in, we take the one door that works with zero taps and
put a login page in front of it — for the exact users who were struggling to get in last week.

**What I would do instead:** keep LIFF as the front door and use Clerk *behind* it.

```
LINE app  →  LIFF token  →  our server verifies it with LINE  →  mints a Clerk session
                                                                  ↑
                                       Clerk is the session + org + role layer,
                                       never the thing the parent interacts with
```

Then Clerk earns its place for the thing it is genuinely excellent at and we have nothing for:
**Organizations.** One org per school, memberships, roles, invitations, and an org id to hang
row-level security off. That is the multi-tenant foundation, and building it ourselves is months.

**Needs a spike before committing** (2–3 days): confirm Clerk can mint a session from a
server-verified external identity on their current plan, and that org membership can be resolved
inside Supabase RLS.

**If the spike fails:** keep our own HMAC sessions (they work, they are 12h/14d/30d tiered, and they
are now revocable) and build tenancy as plain Postgres tables. We lose convenience, not capability.

### 3.2 Figma — what it can and cannot do

The request was "API เชื่อมกับ Figma เพื่อออกแบบโครงสร้าง Application ใหม่". To be straight about it:

- ❌ **The Figma API cannot design anything.** Its REST API is read-only for file content. There is
  no endpoint that takes "design a nursery app" and returns a design.
- ✅ **What it genuinely gives us** is a single source of truth for the visual system: build the
  palette, type scale and components in Figma, pull them through the API, and generate
  `tokens.css`. Design and code stop drifting. That is real and worth doing.
- ✅ Dev Mode / the Figma MCP lets me read a frame's exact spacing and colours while building a
  screen, instead of guessing from a screenshot.

**So Figma is where the redesign is decided and recorded — the designing is still design work.**
`docs/FRONTEND_DESIGN.md` (written alongside this) is the half of that which does not need Figma:
the principles, the constraints, and the one aesthetic risk worth taking.

### 3.3 The two stores

**Google Play — achievable.** The TWA exists, is signed, and CI verifies its fingerprint against the
site. What is still needed: a Play Console account (**$25 once**), the Data Safety form, and a
privacy policy (we have `privacy.html`). ⚠️ One trap: a **personal** Play account opened now must
run a 14-day closed test with 12 testers before it can publish. An **organisation** account skips
that but needs a D-U-N-S number for the school. **Register as the organisation.**

**Apple App Store — the expensive one, and it is worth saying no to for now.** Apple rejects thin
web wrappers under Guideline 4.2 ("minimum functionality"). To pass we would need a Capacitor shell
with genuine native behaviour — push notifications through APNs, native camera, background location
for the gate — plus **$99/year**, and App Store review is a human who can say no twice.

Realistically **4–8 weeks on its own**, after everything else is stable. And the honest question:
our parents are on LINE. LINE *is* the notification channel. What does an App Store listing buy that
the PWA and the APK do not? I would defer it to after the first paying school, and revisit.

---

## 4. The plan: two tracks, deliberately separate

The instruction was that the current app must keep working and the new one must be complete before
anything moves. That rules out a big-bang rewrite, and it points at the **strangler** pattern: the
new system grows beside the old one and takes over a piece at a time, with both running on the same
truth until the last piece is done.

```
TRACK A — make it fast                     TRACK B — make it a product
(the school feels this next month)         (this is what gets sold)

 A0  Spec extraction ────────────────────► shared foundation for both tracks
 A1  Supabase schema + RLS
 A2  Two-way sync: Sheets ⇄ Postgres
 A3  Reads move to Postgres
 A4  Writes move to Postgres                B1  Design system + Figma tokens
 A5  Sheets become a read-only mirror       B2  Next.js shell on Vercel
 A6  Retire Apps Script                     B3  Screens ported, role by role
                                            B4  R2 for images
                                            B5  Clerk orgs + tenancy
                                            B6  n8n automations
                                            B7  DevOps console
                                            B8  Play Store
                                            B9  (later) App Store
```

**Why A2 is the whole trick.** For a period, both systems read and write the same data. The Sheets
stay authoritative until every number has been proven identical in Postgres — which means the school
can keep using today's app, unchanged, while the new one is built and checked against it. Nothing is
cut over on faith.

### A0 — Spec extraction comes before any code

This is the deliverable that was asked for — complete role manuals matching current behaviour
exactly — and it is also the migration's specification. It cannot be skipped and it cannot be done
afterwards.

The good news: **the 137 test suites are already 60% of it.** They encode the rules in English,
with the incident that caused each one. The work is turning that into documents a person can read.

```
docs/spec/
  00-overview.md              the product in two pages
  roles/
    parent.md   teacher.md   head-teacher.md   admin.md   observer.md
        → for each: what they see, what they may do, what they may never do,
          and every screen they can reach
  screens/
    parent/    home · checkin · payment · journal · growth · dspm · chat
    teacher/   home · class · journal · absence · injury · leave · schedule · slip · dspm
    admin/     home · daily · finance · verify · payroll · leaves · manage ·
               absence · injuries · dspm · chat
        → for each: purpose · fields · every button and what it writes ·
          every refusal and its message · what it costs in round trips
  rules/
    money.md        plans, prepay tiers, mid-month, the child rate, OT rates,
                    provident fund — the numbers, with their source
    billing.md      billing days, issuing, slips, SlipOK, cash, prepay credit
    attendance.md   the four reasons a child is not expected; the GPS gate
    leave-ot.md     the two-step approval chain; holiday OT; quotas per person
    payroll.md      the slip formula and the three renderers
    permissions.md  the full 151-route × 5-role matrix
  data/
    schema.md       all 48 tables, every column, and what writes it
  integrations/
    line.md   slipok.md   drive-to-r2.md
```

**This is the single most valuable artifact in the whole project** — and it is valuable even if the
migration never happens, because right now this knowledge exists in one repository's comments and
one person's head.

---

## 5. Multi-tenant and the DevOps console

The ask: manage other schools, turn every function on and off, customise some functions for some
customers only, and ship updates as patches.

### 5.1 Tenancy model — shared database, row-level isolation

```
tenants          id · name · slug · plan_id · status · timezone · created_at
tenant_settings  tenant_id · key · value            (school name, logo, GPS radius, billing day…)
features         key · name · description · default_on · tier      (the catalogue)
plans            id · name · price · feature_keys[]                (Starter / Standard / Full)
tenant_features  tenant_id · feature_key · state · config   ← the per-customer override
memberships      user_id · tenant_id · role · status
```

Every business table gets `tenant_id`, and every RLS policy starts with
`tenant_id = current_tenant()`. One database, one deployment, one migration path.

**Not database-per-tenant.** It sounds safer and it is operationally miserable: 20 schools means 20
sets of migrations to run and 20 things that can be half-upgraded.

### 5.2 Feature flags — resolved in one place, three layers deep

```
     plan default          "Standard includes payroll"
  ← tenant override        "…but this school also bought DSPM"
  ← role/user override     "…and only the head teacher may open it"
  = the answer
```

One function, `can(tenant, user, feature)`, answers on the server. The UI asks the same function, so
a hidden button and a refused request can never disagree — which is the rule this codebase already
follows for Observer and admin-only routes.

**What becomes a flag** (from what already exists): payroll & slips · OT · holiday OT · DSPM
assessment · growth records · insurance · injury reports · surveys · food menu · announcements ·
prepay · SlipOK · LINE push · Google login · class organisation · absence follow-up.

That is 16 sellable switches from the app we already have.

### 5.3 Per-customer customisation without forking

The dangerous version of "customise for one customer" is a branch. The safe version is three
mechanisms and no fourth:

1. **Flags** — on/off. Covers most of it.
2. **Config** — a JSON blob per feature per tenant. Billing day, GPS radius, leave quotas, OT rate,
   grade names, term dates. Anything that is a *number or a name* is config, never code.
3. **Slots** — a small number of named places a tenant can put its own content: the home banner, the
   receipt footer, the consent text, extra fields on the student record.

If a request fits none of the three, it is a **product decision**, not a customisation: either it
becomes a flagged feature everyone can buy, or we say no. Writing that rule down now is what stops
this becoming twenty codebases in two years.

### 5.4 Updates as patches

A web app deploys to everyone at once, so "patch" here cannot mean a version people install. It
means **controlled rollout**:

- **Release channels per tenant** — `stable` (default) / `beta`. Our own school goes on `beta` and
  finds the problems first, exactly as it does today.
- **Schema migrations** are forward-only, versioned, and run once for all tenants. Every migration
  ships with its rollback.
- **A patch note per release**, per tenant, shown in the admin's own app — because a school that
  sees a button move deserves to be told why.
- **Kill switch**: any feature can be turned off for one tenant without a deploy. That is the real
  reason flags are worth the work.

### 5.5 What the console actually is

An internal Next.js app on a separate route, for us, not for schools:

| Screen | Does |
|---|---|
| Tenants | List, create, suspend, plan, channel |
| Features | The flag matrix — tenant × feature, with the config editor |
| Health | Per-tenant p50/p95/error rate — the PERF report we already collect, per school |
| Billing | What each school is on, what they owe us |
| Support | Impersonate a user **with a loud banner and a full audit row** |
| Releases | Patch notes, rollout state, kill switches |

---

## 6. What it costs

Thai baht, at ~฿35/USD. Infrastructure only — no labour.

### Today

| | ฿/month |
|---|---|
| Google Workspace / Apps Script / Sheets / Drive | **0** |
| GitHub Pages | **0** |
| LINE Messaging API (free tier exhausted — currently absorbed by using the in-app inbox instead) | 0, or **1,200** on the Light plan |
| SlipOK | existing |

### After, one school

| | ฿/month |
|---|---|
| Vercel Pro | 700 |
| Supabase Pro (backups + PITR — not optional once money lives there) | 875 |
| Cloudflare R2 (~10 GB, egress free) | ~10 |
| Clerk (free under 10,000 MAU) | 0 |
| n8n, self-hosted on a small VPS | ~200 |
| Domain | ~40 |
| **Infrastructure total** | **≈ ฿1,825** |
| SlipOK + LINE | unchanged |

**One-time / annual:** Play Console ฿875 once · Apple Developer ฿3,465/year *(only if we do iOS)* ·
Figma Pro ฿525/editor/month *(optional)*.

> **Be clear-eyed about this: we are moving from ฿0 to about ฿1,800/month.** For one school that is
> a real cost with no revenue against it. It is only obviously worth it if (a) 6.8s → 0.2s is worth
> ฿1,800/month to this school — I think it plainly is — or (b) there is a second school coming.

### At 20 schools

| | ฿/month |
|---|---|
| Vercel Pro | 700 |
| Supabase Pro + a compute step up | ~3,000 |
| R2 (~200 GB) | ~105 |
| Clerk Pro + Organizations | ~1,600 |
| n8n VPS | ~400 |
| **Total** | **≈ ฿5,800** → **≈ ฿290 per school** |

At ฿1,500–3,000 per school per month, that is a **~90% gross margin** and ฿30,000–60,000/month of
revenue. This is the number that justifies the whole exercise — not the speed.

---

## 7. How long

Honest, assuming I am building continuously and the school keeps running on the current app
throughout. Weeks, not calendar months — there will be waiting on decisions.

| | Weeks | Notes |
|---|---:|---|
| **A0** Spec extraction — all roles, screens, rules | **3–4** | Half-mined from the 137 suites. Blocks everything. |
| **A1** Supabase schema + RLS for 48 tables | 3 | The permission matrix is the hard part, not the DDL |
| **A2** Two-way sync Sheets ⇄ Postgres | 2 | The safety net the whole plan rests on |
| **A3** Reads onto Postgres, behind a flag | 3 | **First user-visible win — p50 should fall here** |
| **A4** Writes onto Postgres, money last and parallel-run | 4–5 | Every amount diffed against Sheets before it counts |
| **A5–A6** Sheets to read-only mirror, retire GAS | 2 | |
| | **≈ 17–19** | **Track A — the school is fast** |
| **B1** Design system + Figma tokens | 2 | `FRONTEND_DESIGN.md` is written; Figma is next |
| **B2** Next.js shell, auth bridge, layout | 2 | Includes the Clerk spike |
| **B3** 27 screens × role, ported to spec | 8–10 | The bulk |
| **B4** R2 + image migration from Drive | 1.5 | |
| **B5** Clerk orgs + tenant_id everywhere | 3 | |
| **B6** n8n automations replacing GAS triggers | 1.5 | |
| **B7** DevOps console | 4 | |
| **B8** Play Store submission | 1.5 | |
| | **≈ 24–28** | **Track B — it is a product** |
| **UAT** Parallel run with real staff, both systems live | 4 | Overlaps |
| **B9** App Store via Capacitor | 4–8 | **Deferred — decide later** |

**≈ 9–11 months end to end**, with the school feeling the speed fix around **month 4–5**.

---

## 8. What I need decided before anything starts

1. **Is there a second school?** Everything about tenancy, Clerk Organizations and the DevOps
   console is justified by "yes" and hard to justify by "not yet". If the answer is "not yet", Track
   A alone is the right project and it is a third of the cost.
2. **Is ฿1,800/month acceptable for one school?** It buys 6.8s → 0.2s. There is no free version of
   that.
3. **iOS App Store — now or later?** My recommendation is later, and I would want a reason it beats
   the PWA and LINE.
4. **LINE stays the front door?** I am assuming yes and designing Clerk to sit behind it. If the
   school ever wants a non-LINE login for staff, say so now — it changes the auth design, not just
   the config.

---

## 9. What I would do in the first two weeks, whatever is decided above

None of this is wasted under any answer:

1. **`docs/spec/rules/money.md`** — every number the app knows about money, with where it comes from
   and which test protects it. This is the document I would least like to be missing.
2. **`docs/spec/roles/*.md`** — the five role manuals, mined from the permission matrix and the
   suites.
3. **The Clerk spike** — 2–3 days, answers the largest unknown in the plan.
4. **The Supabase schema, on paper** — 48 sheets translated to tables with real types and
   constraints. Doing this reveals every place the sheets have been lying to us about a data type,
   and that list is worth having regardless.
