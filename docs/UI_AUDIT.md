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

### 2.3 🔴 103 pieces of text below 12px — against our own written rule

Sizes 8.5, 9, 10, 10.5, 11 and 11.5px appear **103 times**. `docs/FRONTEND_DESIGN.md` says the app
must be readable *at arm's length, in sunlight, one-handed, while holding a child*.

> **8.5px is not small text. It is text that is not there** for a parent over 40 in daylight. This
> is the one item on this list that is an accessibility defect rather than a tidiness one.

### 2.4 ⚠️ 63 hardcoded hex colours — 11 of which reach the screen

`#1565C0` appears **12 times**: a blue that is almost `--blue`, hand-typed instead of referenced.
Also `#fff` ×5, `#c00` ×5, `#222` ×5, `#666`, `#555`, `#999`, `#bbb`, `#eee`.

> 🔴 **A hardcoded colour is a dark-mode bug by construction.** `--ink` flips when the theme flips;
> `#222` does not. Every one of these is a patch of light-mode styling that survives into dark mode.
>
> *(`#06C755` is LINE's brand green and is correct as a literal — LINE's green is LINE's green in
> both themes. It is the exception that proves the rule: a literal colour is right only when it
> belongs to somebody else's brand.)*

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

### Before — mechanical, no design decisions needed

| | work | why first |
|---|---|---|
| 1 | The 4 `.btn ghost` buttons | a live visual bug, one line |
| 2 | 63 hex → tokens | otherwise dark mode and theming are both unfixable |
| 3 | Collapse 27 font sizes → a scale | the scale is a design decision; **finding all 27 is not** |
| 4 | Raise everything under 12px | our own written rule, and 103 instances of breaking it |

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
grep -oE 'style="[^"]*"' webapp/app.js | wc -l                      # 2530 inline styles
grep -oE 'font-size:[0-9.]+px' webapp/app.js | sort -u | wc -l      # 27 font sizes
grep -oE 'font-size:(8\.5|9|10|10\.5|11|11\.5)px' webapp/app.js | wc -l   # 103 under 12px
grep -oE '#[0-9a-fA-F]{3,8}\b' webapp/app.js | wc -l                # 63 hex colours
grep -oE 'class="btn[^"]*"' webapp/app.js | wc -l                   # 628 buttons
grep -c 'modal(' webapp/app.js                                      # 148 modals
grep -oE -- '--[a-zA-Z0-9-]*\s*:' webapp/styles.css | sort -u | wc -l     # 48 tokens
```

🔴 **Re-run these after Phase 3, not before.** The four numbers that must go DOWN are the inline
styles, the font sizes, the sub-12px text and the hex colours. If a redesign ships and 2,530 inline
styles are still there, the app was repainted rather than designed — and it will drift back within
two months, because nothing will have changed about where a style gets decided.
