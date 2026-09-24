# Hosting and domains — answering the ผอ.'s question

Written 2026-09-24. The ผอ. asked: *the code sits on GitHub and we use a GitHub domain — do we have
to change the domain, and can we move to something private of our own?*

**Those are two separate questions that have been travelling as one.** They have different answers,
different costs, and different risks, so they are separated here.

---

## 1. Where we actually are today

| | |
|---|---|
| **What parents open** | `https://legeant04-dot.github.io/atom-nursery/` — GitHub Pages. **There is no `CNAME` file in the repo**, so we are on the default GitHub address |
| **How it gets there** | `.github/workflows/pages.yml` → `tools/build_web.js` minifies `webapp/` into `dist_pages/` → published on every push to `main` |
| **Where the data lives** | **Not on GitHub.** `CONFIG.GAS_URL` points at `script.google.com/macros/s/…/exec`, and the sheets are in Google Drive |
| **Who can read the source** | **Everyone.** The repo is public |

**The most important line above is the third.** GitHub hosts the *screen*. It has never held a single
child's record. Changing where the screen is served from does not move any data.

---

## 2. Question one — must the domain change?

**No. And it can, easily, whenever we want.**

GitHub Pages supports a custom domain **free, on the free plan**: add a `CNAME` file and point DNS.
No code changes, no rebuild, no migration.

### And the ผอ. should have one, for a reason that is not technical

Under the ingredient-brand model each school keeps its own identity. Shopify's model exactly:

| | |
|---|---|
| **`<school>.ac.th` or `<school>.com`** | What parents type. **Belongs to the school** |
| **`<platform>.com`** | The company underneath. Belongs to us |

**The school's domain is the school's asset.** It makes the app theirs, it survives if they ever
change providers, and it is the single clearest answer to *"is our data locked in?"* — no.

---

## 3. Question two — can the repo be private?

Yes. Three routes, different prices.

| | Route | Cost | Pages still works? |
|---|---|---|---|
| **A** | Stay public, add a custom domain | **~400 ฿/yr** (domain only) | Yes |
| **B** | **GitHub Pro** → private repo + Pages | **~$4/user/mo** | Yes |
| **C** | **Move hosting to Cloudflare Pages or Vercel**, repo goes private on the free plan | **Free** | N/A — they serve it |

🔴 **What does NOT work: making the repo private on the free plan.** GitHub Pages is disabled for
private repos on Free, so the site goes dark and **the whole school loses access**. This has been a
standing constraint on this project and it is the reason the repo is still public.

### Recommended: C

- Both the hosting and the private repo are **free**
- **Cloudflare has points of presence in Thailand.** GitHub Pages does not — we are currently served
  from outside the country, and the transport floor we measured (≈3.5s round trip for 28ms of server
  work) is partly this
- It is on the Phase 4 path anyway, so it is work we do once rather than twice
- And it permanently closes the `Backup codes.pdf` exposure, because the history stops being public

---

## 4. 🔴 Three things that break if the domain changes carelessly

These are the real risks, and none of them is obvious.

### ① LINE login stops working for everyone

`CONFIG.LIFF_ID = '2010457597-hcIeTe2L'`. A LIFF app has an **Endpoint URL registered in the LINE
Developers Console**, and LINE will only open the URL registered there.

> **Change the domain without changing the LIFF endpoint and every parent and teacher is locked
> out.** Not degraded — locked out. LINE is the only way in.

### ② Phones that already have the app installed keep the old address

The PWA is added to home screens. That shortcut stores the **old URL**, and a service worker is
caching under the **old origin**. They will not follow us.

Required: a **permanent redirect** from the old address, kept up for months, plus telling families
to remove and re-add the icon.

### ③ Anything else holding the URL

Any LINE message, QR code, printed handout or bookmark with the old link in it.

---

## 5. Timing — do it once

The brand name is not chosen yet (`docs/BRAND_NAMING.md`). The domain follows the name.

**Moving the domain now and again after the name is decided means doing the LIFF reconfiguration
twice and asking every family to reinstall twice.** The second ask is the one they ignore.

| | |
|---|---|
| ✅ **Today, zero risk** | **Register the domain** once the name is chosen. Do not point it anywhere yet |
| ⏳ **After the name is locked** | Custom domain + Cloudflare Pages + private repo, in one change, on a **weekday morning** — never a Friday |
| 🔜 **Phase 2** | The backend URL changes anyway when Supabase replaces Apps Script. Same rule: one change, not two |

---

## 6. The short answer for the ผอ.

> **ไม่ต้องเปลี่ยนตอนนี้ครับ และเปลี่ยนได้แน่นอน**
>
> 1. **โดเมนของโรงเรียน** — ทำได้ ฟรี ไม่ต้องแก้โค้ด และ **โรงเรียนควรมีโดเมนของตัวเอง** เพราะมันคือทรัพย์สินของโรงเรียน ไม่ใช่ของผู้ให้บริการ
> 2. **โค้ดเป็น private** — ทำได้ แต่ต้องย้ายที่โฮสต์ไปด้วย (ฟรีทั้งคู่ และเร็วขึ้นในไทย)
> 3. **ข้อมูลนักเรียนไม่เคยอยู่บน GitHub** — GitHub เก็บแค่หน้าจอ ข้อมูลอยู่ที่ Google ของโรงเรียนเอง
> 4. **ขอทำครั้งเดียวหลังได้ชื่อแบรนด์** — เพราะการย้ายโดเมนต้องตั้งค่า LINE login ใหม่ และต้องให้ผู้ปกครองลบแอปแล้วติดตั้งใหม่ ซึ่งขอแค่ครั้งเดียว
