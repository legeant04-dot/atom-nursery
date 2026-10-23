# UI audit — what the app looks like today, measured

**Phase 3, step 1.** Written 2026-10-23 against **v466**. Everything here is counted from
`webapp/app.js` (16,934 lines) and `webapp/styles.css` (778 lines) — no opinions where a number
will do, and every number here is reproducible with the commands in §8.

> ผอ. 2026-10-23: *"แอปของเราตอนนี้ไม่ได้ถูกจัด UX/UI ที่เหมาะสมเท่าไหร่ ตอนนี้อาจจะดู AI มากกว่า Design
> จุดประสงค์การออกแบบใหม่ทั้งหมดคือ การขายแอป และเรื่องความรู้สึกการใช้งานที่ตอบโจทย์มากขึ้น เป็นมิตรมากขึ้น"*

**The finding in one line:** the app does not lack a design system — it has one and does not use it.
48 CSS variables and a working dark mode exist; the screens then set 2,530 inline styles beside them.

---

## 1. What is already there (and is worth keeping)

| | |
|---|---|
| CSS design tokens | **48** — `--ink` `--ink-2` `--ink-3` `--surface` `--surface-2/3` `--line` `--radius` `--sh-sm/md/lg` `--ok` `--warn` `--bad` `--blue` `--pink` `--teal` `--amber` … |
| Dark mode | **working** — `prefers-color-scheme` plus a `[data-theme]` override |
| Semantic colour pairs | `--ok` / `--ok-bg` / `--ok-line` and the same triple for `warn` / `bad` / `blue` / `pink` / `teal` |
| Button component | `.btn` with 9 variants |
| Written design rule | `docs/FRONTEND_DESIGN.md` — *"อ่านออกจากระยะแขน กลางแดด มือเดียว ขณะอุ้มเด็กอยู่"* |

Phase 3 is not starting from zero. It is starting from **a foundation that the screens bypass**.

---

## 2. The five measurements that explain "ดู AI มากกว่า Design"

### 2.1 🔴 2,530 inline `style=` attributes

A design system that can be overridden 2,530 times is a suggestion, not a system. This is the
single largest cause of the look: every screen was styled where it was written, so nothing is
decided in one place.

The most-repeated inline declarations:

| times | declaration | what it should have been |
|---:|---|---|
| 461 | `font-size:13px` | one `.small` / token |
| 180 | `margin-top:8px` | a stack/spacing utility |
| 175 | `margin-top:6px` | ⚠️ **the same intent as the 180 above, 2px apart** |
| 157 | `padding:8px` | a card/padding token |
| 107 | `text-align:center` | a utility |
| 84 | `color:var(--warn)` | a `.warn` text class |

> `margin-top:8px` **180 times** and `margin-top:6px` **175 times** is the whole problem in two
> rows: two values, no rule, chosen by whoever was typing. Nobody can see 2px — but across 27
> screens it is why nothing feels aligned.

### 2.2 🔴 27 distinct font sizes, for a 7-size job

`13px` (464×) · `11px` (82×) · `12px` (57×) · `14px` (51×) · **`12.5px` (30×)** · `18px` (17×) ·
`15px` (12×) · `22px` (10×) · **`11.5px` (10×)** · `19px` (7×) · `17px` · `16px` · **`13.5px`** ·
**`10.5px`** · `44px` · `9px` · `40px` · `20px` · **`8.5px`** · `48px` · `21px` · `46px` · `42px` ·
`34px` · `26px` · `24px` · `10px`

**27 sizes, five of them fractional.** A fractional font size is the signature of a value nudged
until it looked right on one screen, on one phone, once.

### 2.3 🔴 92 pieces of text below 12px on screen — against our own written rule

> 🔴 **CORRECTED 2026-10-23, same day.** This section first said **103**, and counted the A4/A5
> payslip and receipt renderers as screens. **11 of the 103 were on paper**, including every one of
> the alarming ones: all the 8.5px and 9px text is printed, where it is read at 30cm on a document
> designed to fit a page. The screen figure is **92** — 81×11px, 10×11.5px, 1×10.5px.
>
> I wrote §2.6 of this file about an audit that cries wolf, and then did it in §2.3 and §2.4. Both
> are corrected in place rather than quietly adjusted.

`docs/FRONTEND_DESIGN.md` says the app must be readable *at arm's length, in sunlight, one-handed,
while holding a child*. 92 places on screen were under 12px, plus 7 label rules in `styles.css` and
one inline size in `index.html` — three files set type, which is why the only check that settled it
was a real browser at 375px, not a grep.

**Fixed 2026-10-23: the screen floor is now 12px, with two declared exceptions** (written beside
the rules in `styles.css`, not only in a test):

| exception | why it cannot simply be raised |
|---|---|
| **Count badges** — `.bell .badge`, `.opbtn .opbadge` | a numeral inside a **16–18px circle**, glanced at not read. 12px overflows it; growing the circle moves the header |
| **Calendar cell annotations** — `.cal .dot` / `.calio` / `.calhol` / `.callv` | a 7-column month grid gives each day **~50px** on a 375px phone |

> ⚠️ **The calendar is therefore an open design problem for Phase 3, not a font-size one.** No type
> size is both legible at arm's length and able to fit "ลาป่วย" into 50px. The honest answer is
> probably that a month grid carries *marks*, and the words belong in a day sheet underneath it.
> Raising the number without changing the layout would truncate instead of shrink — which is worse,
> because unreadable is at least visibly unreadable.

### 2.4 ⚠️ 63 hardcoded hex colours — of which exactly **one line** was a real bug

> 🔴 **CORRECTED 2026-10-23.** The claim "each a dark-mode bug by construction" was wrong for 59 of
> the 63. Acting on it as written would have **introduced** bugs into printed payslips.

| | count | verdict |
|---|---:|---|
| Inside the **print documents** (`html{color-scheme:light}`) | **39** | ✅ **deliberate, and already documented in the code**: *"A receipt is paper — it is white wherever it is opened."* Theming these is the bug |
| `var(--token, #fallback)` | 12 | ✅ a fallback is a seatbelt, not a hardcoded colour |
| LINE green / Facebook blue | 3 | ✅ somebody else's brand is their colour in both themes |
| Canvas export + the browser `theme-color` meta | 3 | ✅ not themed by CSS at all |
| Inside code comments | 2 | ✅ |
| White text drawn **on** LINE's green | 2 | ✅ correct in both themes |
| 🔴 **`.pill` with `#eef2ff` / `#3449a8`** | **1 line** | the only badge in the app that stayed light-blue-on-navy in dark mode — and `.pill.info` already existed, as exactly those two tokens |

**Fixed:** that one line now uses `.pill info`.

### 2.4b 🔴 What the hex hunt actually found: **17 CSS variables that were never defined**

This is the real version of §2.4, and it is worse than a colour that does not follow the theme.

`var(--brand)` ×8 · `var(--brand-soft)` ×4 · `var(--brand-line)` ×3 · `var(--accent)` ·
`var(--info-bg)` — **none of them declared anywhere.** CSS has no concept of an unknown custom
property: no error, no console warning, nothing to search for.

**Measured in a real browser, not reasoned about:**

| written | actually rendered | consequence |
|---|---|---|
| `background:var(--brand)` | `rgba(0,0,0,0)` | 🔴 **the progress-bar fills were invisible** — the bars rendered as empty tracks |
| `color:var(--brand)` | inherits `--ink` | 🔴 the birthday highlight looked like ordinary text |
| `border-color:var(--brand-line)` | `currentColor` | 🔴 "highlighted" cards were not highlighted |
| the survey rating buttons | — | 🔴 **the selected rating did not look selected** |

**Fixed** by defining them as aliases of existing tokens, so light mode is unchanged for everything
that already worked and dark mode follows for free. 🏫 **And `--brand` is exactly the hook per-school
theming needs** — §5 is now one re-pointed variable rather than a project.

> 🔴 **The pattern behind §2.4b and §2.5 is the same, and it is the one to remember:**
> **a name that reads as if it works, with nothing behind it.** `.ghost` and `--brand` both look
> correct in review, both pass every test, and neither produces a single symptom a developer can
> search for. Found twice in one afternoon; `tools/test_design_tokens.js` §1 now asks the only
> question that catches them — *is everything this code names actually defined?*

### 2.5 ⚠️ 628 buttons, 9 variants, and three real inconsistencies

| | |
|---|---|
| `class="btn outline block"` | **92** |
| `class="btn block outline"` | **18** ← ⚠️ the same button, written the other way round |
| `class="btn sm ghost block"` | **4** ← 🔴 **`.ghost` is not a CSS rule.** The file defines `.btn-ghost`. These four render as solid primary buttons |

> 🔴 **Four buttons in the live app look like the most important thing on their screen by accident** —
> they were written as quiet buttons and the class name silently did not exist. No error, no warning;
> CSS has no such thing as an unknown class.

### 2.6 ⚠️ 173 distinct emoji as the icon system

**1,619 uses, 173 distinct glyphs, 31 of them used exactly once** *(code only — comments stripped)*.

Emoji are not a wrong choice here: they are free, instantly legible, need no load, and are already
how Thai parents read LINE. But **173 is not an icon set, it is an absence of one** — and they
render differently on every Android skin, which is a brand that changes by handset.

> **Keep the warmth, cut the vocabulary.** A chosen set of ~30 for the recurring meanings; the 31
> once-only glyphs are decoration that costs consistency.

---

## 3. The 27 screens, by weight

Screens are declared in `SCREENS[role][name]`. Observer has none of its own — **it reuses Admin's**.

| Role | screens | |
|---|---:|---|
| **Admin** | **11** | home · manage · finance · payroll · leaves · dspm · daily · verify · absence · injuries · chat |
| **Teacher** | **9** | home · class · journal · schedule · slip · leave · dspm · injury · absence |
| **Parent** | **7** | home · payment · journal · growth · dspm · checkin · chat |
| Observer | 0 | reuses Admin's |

Approximate size of each screen's region (helpers are interleaved, so read these as *weight*, not
exact line counts):

| screen | ~lines | |
|---|---:|---|
| **Admin.manage** | **5,012** | 🔴 **30% of the entire front end is one screen** |
| Admin.dspm | 1,485 | |
| Parent.home | 825 | the single most-opened screen in the school |
| Teacher.home | 784 | |
| Admin.home | 777 | |
| Admin.finance | 549 | |
| Admin.payroll | 533 | |
| Parent.payment | 471 | |
| Teacher.journal | 398 | |
| Teacher.class | 365 | |

> 🔴 **`Admin.manage` is not a screen, it is a filing cabinet.** 5,012 lines behind one nav item is
> the clearest structural finding in this audit, and no amount of restyling fixes it — it needs
> splitting, which is an information-architecture decision for Phase 3 and not a visual one.

**And there is a second layer nobody counted: 148 `modal()` calls.** Much of the real work happens
in dialogs, not screens. A redesign that covers 27 screens and skips 148 modals has covered half
the app.

---

## 4. So: 12 archetypes, not 27 screens

Designing 27 screens one at a time produces 27 apps. The repeated shapes:

| # | archetype | examples |
|---|---|---|
| 1 | **Home / today** | Parent.home · Teacher.home · Admin.home |
| 2 | **List of people** | class list · staff list · parents |
| 3 | **One person's record** | student record · staff profile |
| 4 | **Form** | registration · journal · injury |
| 5 | **🔴 Money** | bills · payment · payroll · slips — *its own archetype on purpose* |
| 6 | **Calendar / month** | schedule · staff month · holidays |
| 7 | **Report / table** | daily · absence · finance |
| 8 | **Approval queue** | leaves · verify · OT |
| 9 | **Empty state** | — |
| 10 | **Error / refusal** | — |
| 11 | **Loading** | — |
| 12 | **Modal / bottom sheet** | ×148 |

> **Money is its own archetype and must not inherit from "form".** Our own rule already says a
> button that moves money carries a line underneath saying what it does. Those screens also carry
> the ม.70 itemisation obligation on payslips. They are not forms with baht in them.

Archetypes **9–11** barely exist today, and they are where *"เป็นมิตรมากขึ้น"* is actually won or
lost: the app is at its least friendly exactly when something is missing, wrong, or slow.

---

## 5. Per-school theming — what §2 means for it

ผอ. 2026-10-23: the system must follow each school's colour, logo and font.

The 48 tokens make this nearly free — **but only once §2.1 and §2.4 are fixed.** A school's brand
colour applied today would miss every one of the 2,530 inline styles and all 63 hardcoded hex
values. **Theming is not a feature to add; it is what you get when the tokens are actually used.**

Three rules to settle during design:

1. 🔴 **Brand colours are themeable; semantic colours are not.** A school whose brand is red must
   not turn "ชำระแล้ว" red. `--ok` / `--warn` / `--bad` are **data**, not decoration.
2. 🔴 **`--on-accent` must be computed, not chosen.** A school picks a pale yellow and the text on
   its primary button disappears. Compute the contrast, and **refuse the colour at the moment the
   school picks it** rather than at the moment a parent cannot read it in sunlight.
3. ⚠️ **The home-screen app icon needs a per-school `manifest.json`.** The other four logo
   placements (login, header, receipt, certificate) are ordinary images.

---

## 6. What to fix before Figma, during, and after

### Before — mechanical, no design decisions needed ✅ **DONE 2026-10-23 (v468)**

| | work | result |
|---|---|---|
| 1 | The 4 `.btn ghost` buttons | ✅ now `btn outline block`, the pattern the other 84 Close buttons already used |
| 2 | Hardcoded colours → tokens | ✅ **1 real line fixed**; 59 of the 63 were correct as literals (§2.4) — and the hunt turned up **17 undefined variables** causing four visible bugs (§2.4b) |
| 3 | Collapse the font sizes | ✅ **27 → 19 on screen.** Fractional sizes gone; `12.5→13`, `13.5→13`, `11.5→12` |
| 4 | Raise everything under 12px | ✅ **0 left on screen** across all three files, with two exceptions declared in the CSS |

Also normalised `btn block outline` → `btn outline block` (18 occurrences, CSS-identical), and added
`tools/test_design_tokens.js` so none of it can quietly come back.

**What is left of items 3 and 4 is the part that is genuinely a decision:** the scale itself. 19
sizes is still more than a scale — `15/17/19/20/21` and the seven display sizes (`26…48`) want
collapsing, and that is ผอ.'s call in Figma, not a mechanical pass.

### During — the decisions only ผอ. makes

Type scale (7 sizes) · spacing scale (**6px or 8px — not both**) · radius · shadow · the ~30 icons ·
Atom's brand palette · motion ·🔴 **the empty / error / loading voice**, which is where "friendly"
lives.

### After — implementation, in this order

Tokens → 12 archetypes → the 148 modals → `Admin.manage` split → the 27 screens fall out.

---

## 7. What this audit does not cover

Stated plainly, so nobody assumes otherwise:

- **No user testing.** Every finding is from the code. Where real parents and teachers actually get
  stuck is step 6 of the plan and cannot be measured from here.
- **No performance measurement.** `docs/WORKLOG.md` owns that.
- **No judgement on the Thai copy.** Wording is its own pass, and the audit above would not notice
  a sentence that is correct and unkind.
- **Marketing surfaces are out of scope here** but inside Phase 3: store screenshots, the
  orvia.co.th page, the school-facing deck. **A buyer sees those before the app.**

---

## 8. Reproducing every number above

```bash
node tools/test_design_tokens.js      # the four numbers, and the two bug classes behind them
```

That suite is the reproduction now, because **three of the greps below ask the wrong question** —
they do not know that a printed payslip is not a screen, that a `var()` fallback is not a hardcoded
colour, and that `\bghost\b` also matches `btn-ghost`. Each of those cost a false alarm on the day
this was written. The raw counts, for the ones that are still just counts:

```bash
grep -oE 'style="[^"]*"' webapp/app.js | wc -l                      # 2530 inline styles
grep -c 'modal(' webapp/app.js                                      # 148 modals
grep -oE 'class="btn[^"]*"' webapp/app.js | wc -l                   # 628 buttons
grep -oE -- '--[a-zA-Z0-9-]*\s*:' webapp/styles.css | sort -u | wc -l     # 48+ tokens
```

🔴 **Re-run these after Phase 3, not before.** The four numbers that must go DOWN are the inline
styles, the font sizes, the sub-12px text and the hex colours. If a redesign ships and 2,530 inline
styles are still there, the app was repainted rather than designed — and it will drift back within
two months, because nothing will have changed about where a style gets decided.
