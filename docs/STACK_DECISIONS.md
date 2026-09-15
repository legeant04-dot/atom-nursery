# Stack decisions — auth, hosting, database

Written 2026-09-15 after the four questions in `MIGRATION_DIRECTION.md` §8 were answered. This file
records what we chose, what we rejected, and what would make us change our mind. Nothing here is
built yet; two items need a spike before they are final.

---

## 1. Auth — we are not buying one

### The recommendation: keep our own sessions, sign them so Postgres trusts them

Last week (v383) we built a session layer that does exactly what this product needs: role-tiered
lifetimes (parent 30 days, teacher 14, admin 12h), rolling idle expiry, revocation by epoch, a
"sign out of every device" button on both sides, and a LIFF resume that opens the app without
touching LINE. It is tested and it is live.

**The only thing an auth vendor would add is a token Postgres will accept.** Supabase validates any
JWT signed with the project's signing key — so we mint that ourselves, from the session we already
have, and keep everything we built.

```
LINE app  →  LIFF token
                │
                ▼
      our server verifies it with LINE          ← unchanged, this is today's handleAuth
                │
                ├─→  our session token (30d/14d/12h, revocable)   ← unchanged, stays the app's session
                │
                └─→  a short-lived Postgres JWT (~10 min)
                         claims: sub, tenant_id, role, linked_id
                                    │
                                    ▼
                        RLS: tenant_id = current_tenant()
```

**Why this is right here and not just cheaper:**

- The parent's door does not change. That is the door that was failing last week and the one we just
  fixed; putting a vendor's sign-in page in front of it would undo the work.
- `tenant_id` arrives as a **signed claim Postgres checks itself**. One bug in 151 route handlers
  can no longer leak another school's data, because the database refuses regardless of the handler.
- It costs ฿0 at any number of schools.

**What we take on by doing this:** we own JWT signing and key rotation. Mitigated by keeping the
Postgres JWT short-lived (~10 minutes, minted on demand from the long session) so a leaked one dies
quickly, and by never putting anything in it that is not already in our session.

⚠️ **Spike required (2 days):** confirm which signing model the current Supabase generation uses
(the legacy shared HS256 secret vs. the newer asymmetric signing keys) and that a JWT we mint is
accepted by RLS and by the client libraries. If it is not, fall back to **Supabase Auth** below —
same architecture, their signing.

### What we compared

| | Cost at 20 schools | Verdict |
|---|---:|---|
| **Our sessions + minted JWT** | **฿0** | ✅ **Chosen.** Keeps working code, native RLS, no vendor |
| **Supabase Auth** | ฿0 | ✅ **The fallback.** Same shape, their signing. LINE is not a native provider but LINE Login is OIDC, so `signInWithIdToken` should take it — needs the same spike |
| **Clerk** | ~฿1,600/mo | ❌ Organizations is genuinely good, but we onboard schools by hand through our own console. We would be paying monthly for a sign-up UI we never show |
| **Auth.js / NextAuth** | ฿0 | ❌ Has a LINE provider, but we would still hand-build the session rules we already have. No gain |
| **WorkOS** | $$$ | ❌ Built for enterprise SSO. Wrong customer |

> **Clerk is not rejected for ever.** The day a school asks for staff login by Google Workspace or
> Microsoft with SCIM user provisioning — an Enterprise-package request — Clerk or WorkOS becomes
> the right answer for *that tenant's staff*. Parents stay on LINE regardless.

---

## 2. Hosting — Vercel, with the exit written down

**Chosen: Vercel Pro, functions pinned to Singapore (`sin1`).**

The region matters more than the vendor. Thailand → Singapore is ~40ms; Thailand → US is ~250ms. A
serverless function running in Washington talking to a database in Singapore would undo most of what
this migration is for.

> **Rule: the Next.js server region and the Supabase region are the same region, and it is
> Singapore.** Written here because it is one dropdown and it is the difference between 200ms and
> 700ms.

**Why Vercel for phase 1:** a preview deployment per pull request is worth real money while 27
screens are being ported — every change can be looked at on a phone before it merges. That is how we
have been catching layout bugs and it should not get harder.

**The exit, if bandwidth cost grows:** Cloudflare Pages/Workers. It is ~฿175/month instead of ฿700,
bandwidth is free, and Cloudflare has a **Bangkok** edge — genuinely closer to our users than
Singapore. The cost is that Next.js on Workers (via OpenNext) is less mature than on Vercel. We keep
the app free of Vercel-only APIs so this stays a migration and not a rewrite.

| | ฿/month | Notes |
|---|---:|---|
| **Vercel Pro** | 700 | ✅ Chosen. Best previews, 1 TB included |
| Cloudflare Pages/Workers | ~175 | The documented exit. Bangkok PoP |
| Netlify | ~665 | No advantage over Vercel for us |
| Railway / Render / Fly.io | 175–700 | More control, more to operate |
| Own VPS | 200–400 | Cheapest, and we become the ops team |

---

## 3. Database — Supabase, and it is not a close call

**Chosen: Supabase (managed Postgres), Singapore region, Pro plan.**

Four reasons, in the order they matter:

### 3.1 Row-level security is the multi-tenant security model

This is the one that decides it. With RLS, "a school can only see its own data" is enforced **by
Postgres**, under every query, forever. Without it, that rule lives in 151 route handlers and is one
missed check away from showing School A the children of School B — the single worst thing this
product could do.

### 3.2 Money stops being a float

⚠️ **This is a real defect we have today and nobody has noticed.** Google Sheets stores every number
as a 64-bit float. `6900 × 0.15` is not exactly `1035` in binary floating point, and we compute
prepay discounts, OT rates, provident fund and payroll that way. It has not bitten yet because the
amounts are round — but "เรื่องเงินเป็นเรื่องละเอียดและสำคัญมากต่อความน่าเชื่อถือ" is exactly the
kind of thing a rounding error destroys quietly.

Postgres `numeric(12,2)` is exact decimal arithmetic. **Every money column becomes `numeric`, and
that alone justifies the move.**

### 3.3 Real transactions

Today, issuing bills for a class writes rows one at a time and a failure halfway leaves half a
billing round done — which is why `withWriteLock_` exists and why `restoreSheet` exists. Postgres
gives `BEGIN … COMMIT`: it all lands or none of it does.

### 3.4 Storage and Realtime come with it

Storage is a credible alternative to R2 (we still prefer R2 for zero egress on a product full of
children's photos, but having a fallback is worth something). **Realtime** is a genuine feature we
cannot build today: the teacher's roll updating the moment a parent taps ส่งเข้าเรียน, with no
refresh button needed.

### What we compared

| | Verdict |
|---|---|
| **Supabase** | ✅ **Chosen.** RLS + numeric + transactions + storage + realtime + auth, one vendor, Singapore |
| **Neon** | Excellent Postgres with database branching per PR. But no RLS tooling, no auth, no storage — we would assemble three vendors to land where Supabase starts |
| **Railway / Render Postgres** | Plain managed Postgres, cheaper. Same "assemble it yourself" cost |
| **PlanetScale (MySQL)** | ❌ No row-level security. Disqualifying for multi-tenant |
| **Firebase / Firestore** | ❌ **Wrong for money.** No decimal type, no SQL, cross-collection transactions are a minefield, and reporting over it is painful. This is a system of record for a school's finances |
| **Self-hosted Postgres** | Cheapest and we become the DBA. The day a school's payroll is in it, "we forgot to test the restore" is not survivable |

---

## 4. About the 0.2 seconds — the honest number

The estimate of "6.8s → 0.2s" is the right order of magnitude but slightly optimistic. Where the
time actually goes, from a phone in Bangkok:

| | Warm | Cold |
|---|---:|---:|
| 4G round trip, Thailand → Singapore | 40–60 ms | 40–60 ms |
| Function start | ~0 | 200–400 ms |
| Function → Supabase (same region) | 1–5 ms | 1–5 ms |
| The query itself | 1–20 ms | 1–20 ms |
| Response transfer | 20–50 ms | 20–50 ms |
| **Total** | **~120–200 ms** | **~350–550 ms** |

> **Realistic target: p50 under 0.4s, p95 under 1.5s.** Against today's **p50 6.8s / p95 28.8s**
> that is a **15–20× improvement**, and the p95 change is the one people will feel — 28 seconds is
> where a parent decides the app is broken.

**Two things will not get faster**, and it is better to say so now than to explain it later:

- **SlipOK** takes what it takes. It is somebody else's server reading a photograph of a bank slip.
- **LINE push** likewise.

Both should move off the request path entirely — n8n fires them, the screen does not wait.

---

## 5. Revised monthly cost

Dropping Clerk changes the arithmetic:

| | 1 school | 20 schools |
|---|---:|---:|
| Vercel Pro | 700 | 700 |
| Supabase Pro (+ compute at scale) | 875 | ~3,000 |
| Cloudflare R2 | ~10 | ~105 |
| Auth | **0** | **0** |
| n8n (self-hosted VPS) | 200 | 400 |
| Domain | 40 | 40 |
| **Total** | **≈ ฿1,825** | **≈ ฿4,245** |

Against per-child revenue (`PRICING_AND_TENANCY.md`): **~฿1,825 of cost against ฿5,000–10,000 from
one school, and ~฿4,245 against ฿120,000–180,000 from twenty.**

---

## 6. Open spikes before any of this is final

| | Days | Answers |
|---|---:|---|
| **Supabase JWT** | 2 | Can we mint a token RLS accepts, and which signing model is current? Decides §1 |
| **LIFF → session bridge** | 1 | End-to-end: LINE → our verify → JWT → an RLS-protected read |
| **Schema on paper** | 3 | 48 sheets → tables with real types. Reveals every place a sheet has been lying about a data type — worth having whatever we decide |
