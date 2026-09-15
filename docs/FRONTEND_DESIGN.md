# Frontend design — the rules this app is built to

This file exists so the look of Atom Nursery stops being decided one screen at a time. It is not a
style guide copied from somewhere; every rule below is here because of something that actually
happened to a parent, a teacher or an admin using this app on a real phone.

Read it before adding a screen. If a rule gets in the way of something genuinely better, change the
rule here first — and say why.

---

## 1. Who this is for, and where they are standing

Three people, three postures. The design serves the posture, not the org chart.

| | Where they are | What they have free | What they need in 3 seconds |
|---|---|---|---|
| **ผู้ปกครอง** | At the school gate, outdoors, in sun, car engine running | **One thumb.** The other arm holds a child or a bag | The drop-off / pick-up button, and what they owe |
| **คุณครู** | In the room, standing, a child on the hip | One hand, often wet | Who is here, who is missing, what to write |
| **แอดมิน** | At a desk, laptop, both hands | Everything | Money that is wrong, and approvals that are waiting |

**The design thesis, in one line:**

> **Legible at arm's length, in sunlight, one-handed, while holding a child.**

Everything below follows from that sentence. When a choice is ambiguous, ask which option survives
being read at arm's length outdoors by somebody who is not looking at the screen very hard.

This is *not* a dashboard product. Density is a cost, not a feature. The only screen allowed to be
dense is the admin's, because the admin is sitting down.

---

## 2. Mobile first, and what that actually means here

"Mobile first" in this repo is not a viewport rule. It is these five, in order:

1. **Design the 375px screen first and finish it.** The desktop layout is the 375px layout with room
   added — never the other way round.
2. **Thumb zone.** Any control a parent uses at the gate lives in the bottom two-thirds. The top of
   the screen is for reading, not tapping.
3. **44×44px minimum touch target**, with 8px between targets. A mis-tap on 🔴 รับกลับ is a false
   pick-up record.
4. **No horizontal scroll, ever.** Tables become cards. `document.documentElement.scrollWidth >
   innerWidth` is a bug, not a layout.
5. **Labels drop before layouts break.** An icon-only button that still fits beats a two-line row of
   full labels. (See `.dash-refresh .lbl` — that rule is this principle.)

A screen is not finished until it has been looked at at 375px. Not resized — looked at.

---

## 3. Colour

### The anchor stays blue

`--blue:#1565c0` is not a fashion choice we are free to revisit. Parents have been taught for months
that blue is this school's app; the logo, the APK icon and the LINE OA all carry it. Changing it
would cost recognition and buy nothing.

**What is free to change is everything around it.** The rule:

> **Chrome is grey. Colour means state.**

Blue for the institution and for the primary action. Every other colour in the palette must be
earned by a *status*, never spent on decoration:

| Token | Means | Never used for |
|---|---|---|
| `--ok` | Done, paid, present, approved | "Positive" decoration, headings |
| `--warn` | Waiting, due soon, needs a person | Anything routine |
| `--bad` | Overdue, absent, rejected, injured | Emphasis, "important" |
| `--blue` | The institution, and the one primary action per screen | Secondary buttons |
| `--pink` `--teal` | Category only (leave, schedule) | Status |

A screen with six colours on it has five too many. If a card is not telling you about a state, it is
`--surface` on `--surface-2` with `--line`, and nothing else.

### Sunlight

Test the gate screens outdoors, or at least at 50% brightness. `--ink-3` on `--surface-2` is the
lightest combination allowed for anything a parent must read. Money and times are `--ink`, always.

### Dark mode is a reading mode, not a second brand

Dark mode exists because parents open this at 22:00 in a dark bedroom. It must not restate the
palette; it re-points the same tokens. No new colours may be introduced in dark mode.

---

## 4. Type

### Sarabun stays for body

Thai text is the product. Sarabun is a genuinely good Thai face with a real Latin companion and it
is already loaded. Keep it.

### Numbers are a separate job

This app is full of money, times and counts, and they are currently set in the same proportional
figures as prose. That is why a column of amounts looks ragged and why `10,800.00` and `9,600.00`
do not line up.

> **Every number that is money, a time, or a count is set in tabular figures.**

```css
.num, .kn, .money, .time { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }
```

Money additionally never wraps and never abbreviates. `฿10,800.00`, not `฿10.8k`. A parent
reconciling a bill needs the satang.

### The scale

Four sizes and three weights. That is the whole system.

| Role | Size | Weight | Used for |
|---|---|---|---|
| Display | 22–26px | 800 | One per screen: the screen's name |
| Section | 15–16px | 700 | Card headings |
| Body | 14–15px | 400/600 | Everything |
| Meta | 12.5–13px | 400 | Timestamps, helper text, the muted line |

Nothing smaller than 12.5px ships. Thai diacritics collapse below that and the audience includes
grandparents.

---

## 5. The one risk we are taking: retiring emoji as the icon set

The app currently uses emoji as its icon language — 🔄 👶 💳 📵 ⏱️ — and it should stop.

**Why this is a real bug and not a taste argument.** These users are on *every* Android brand there
is plus every iOS version back to 18.3 (see any PERF report's VERSIONS block). An emoji is rendered
by the phone's own font: Samsung, Google, Apple and Huawei each draw 🔄 differently, several draw it
at a different optical weight than the text beside it, and some draw it in a colour that collides
with our status palette. We have a status language built on colour, and then we let the phone choose
the colours of our icons.

**What replaces it:** one drawn SVG set, stroke `1.7`, `currentColor`, 20×20 — the style already in
`index.html` for the bell, the search and the theme toggle. Those three are the correct ones. The
rest of the app should look like them.

**What keeps its emoji, deliberately:**

- 🟢 ส่งเข้าเรียน and 🔴 รับกลับ. These two are the most-tapped controls in the product and parents
  recognise them as shapes before they read them. They become *drawn* dots in the same colours —
  the meaning survives, the rendering becomes ours.
- Anything inside a LINE push message, where we do not control the renderer anyway.

This is the one place to spend boldness. Everything else stays quiet.

---

## 6. Structure

- **One primary action per screen.** If two things are equally primary, the screen is two screens.
- **Cards group by *decision*, not by table.** "ยอดค้างชำระ" is a card because it is one decision
  (pay or not), even though it reads from three tables.
- **Dividers and numbering must encode something true.** Numbered steps only where the order is
  real (the leave approval chain is genuinely 1→2; the finance tabs are not).
- **An empty state is an instruction.** "ยังไม่มีรายการ" alone is a dead end. Say what will put
  something here, and give the button that does it.
- **Errors say what happened and what to do.** Never "เกิดข้อผิดพลาด". The app already does this
  well in places (`ต้องเข้าสู่ระบบใหม่ (เซสชันหมดอายุ)`); make it everywhere.

---

## 7. Motion

One rule: **motion explains a change of state, or it does not exist.**

Allowed: the toast sliding up, the undo bar, a card collapsing, the refresh button's disabled dim.
Not allowed: entrance animations, scroll reveals, hover flourishes, anything on a list of children.

`@media (prefers-reduced-motion: reduce)` disables all of it. `--dur:.18s` is the only duration.

---

## 8. Writing

The interface is in Thai first and English second, and both must sound like the school, not like
software.

- **Name things the way a parent says them.** "รับกลับ", not "บันทึกการรับกลับ". "ยอดค้างชำระ", not
  "ยอดคงเหลือสุทธิ".
- **A button's word survives the whole flow.** The button says บันทึก, the toast says บันทึกแล้ว.
  Never บันทึก → สำเร็จ.
- **Say what happened, not that something happened.** "อัปเดตข้อมูลล่าสุดแล้ว" beats "สำเร็จ",
  because after a refresh nothing on screen visibly changes and the user needs to be told it worked.
- **Refusals explain the rule.** "ลงเวลาออกงานวันนี้ไปแล้ว (17:02)" — the rule *and* the fact.
- **No apologies, no exclamation marks, no emoji in body copy.**

---

## 9. The quality floor — every screen, no exceptions

Not negotiable, and not announced to the user:

- [ ] Renders correctly at 375px with no horizontal scroll
- [ ] Every interactive element reachable by keyboard, with a visible `--ring` focus state
- [ ] Every icon-only button has `aria-label`
- [ ] Colour is never the only carrier of meaning (status has a word or a shape too)
- [ ] `prefers-reduced-motion` respected
- [ ] Light and dark both checked
- [ ] Loading, empty, error and success states all drawn — not just the happy one
- [ ] Pinch-zoom still works (no `maximum-scale`) — older parents zoom to read amounts

---

## 10. Design tokens are the contract

There is **one** place a colour, radius, shadow or duration is defined: the `:root` block in
`styles.css`. There are currently ~740 inline `style=""` attributes left over from before that rule;
every screen that gets touched should leave with fewer.

When the design system moves to Figma, the direction of truth is **Figma → tokens.json →
`tokens.css`**, generated, never hand-edited. A colour that exists in code but not in Figma is a
colour that will drift.

---

## 11. What this app must never look like

For calibration, because these are what "designed" defaults look like right now and none of them
belong here:

- A SaaS dashboard: sidebar, KPI tiles with sparklines, charts nobody reads. The admin has eleven
  screens and one of them is money; that is not a dashboard product.
- A consumer social feed: full-bleed photos, rounded everything, floating action buttons.
- A "modern startup" landing aesthetic: cream background, high-contrast serif, terracotta accent,
  huge letter-spaced eyebrows. This is a tool used at a gate in the rain.

It should look like **a well-made school form that happens to be alive** — quiet, legible, and
completely unambiguous about money and about where a child is.
