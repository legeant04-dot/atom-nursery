/**
 * tools/test_design_tokens.js — the four numbers Phase 3 must move, and the two bug classes behind them.
 *   node tools/test_design_tokens.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * ผอ. 2026-10-23: *"ตอนนี้อาจจะดู AI มากกว่า Design"* → docs/UI_AUDIT.md measured why, and the answer
 * was not "there is no design system". There are 48 CSS tokens and a working dark mode, and the
 * screens set 2,530 inline styles beside them.
 *
 * 🔴 THE BUG CLASS THIS SUITE EXISTS FOR: A NAME THAT READS AS IF IT WORKS AND HAS NOTHING BEHIND IT.
 *
 * Found twice in one pass, and neither had a symptom anybody could search for, because CSS has no
 * concept of an unknown class or an unknown custom property — no error, no console warning:
 *
 *   ① `class="btn sm ghost block"` ×4 — the file defines `.btn-ghost`, never `.ghost`. Four modal
 *      CLOSE buttons were therefore rendering as solid primary: the loudest thing on their screen
 *      was "ปิด". The other 84 Close buttons in the app use `btn outline block`.
 *
 *   ② `var(--brand)` ×8, `var(--brand-soft)` ×4, `var(--brand-line)` ×3, `var(--accent)`,
 *      `var(--info-bg)` — none of them defined. MEASURED in a real browser, not reasoned about:
 *        background:var(--brand)        → rgba(0,0,0,0)  🔴 progress-bar fills were INVISIBLE
 *        color:var(--brand)             → inherits --ink  🔴 the birthday highlight looked ordinary
 *        border-color:var(--brand-line) → currentColor    🔴 "highlighted" cards were not highlighted
 *        …and the selected rating button in the survey form did not look selected.
 *
 * So the assertions below are about CLAIMS, never about a line's shape: "every custom property the
 * app asks for is defined", not "line 4712 looks like this". A guard written as a shape is how the
 * type-size pass broke two unrelated suites that were pinning `font-size:11px` and
 * `class="btn block outline"` while testing something else entirely.
 *
 * 🔴 AND PRINT DOCUMENTS ARE NOT SCREENS. 39 of the 63 hex literals and 11 of the 103 sub-12px
 * sizes live in the A4/A5 payslip and receipt renderers, which set `html{color-scheme:light}` on
 * purpose — a receipt is paper, and it is white wherever it is opened. Counting those as theming
 * bugs is how an audit starts crying wolf; §2 below therefore asks the screen-only question.
 */
const path = require('path'), fs = require('fs');
let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), css = R('webapp/styles.css');
const APP_LINES = app.split('\n');

/* The print renderers, found by their own deliberate marker rather than by a line number that rots
 * the moment anybody inserts a function above them. */
const printLines = new Set();
{
  let inPrint = false, depth = 0;
  APP_LINES.forEach((l, i) => {
    if (/color-scheme:light/.test(l)) { inPrint = true; depth = 0; }
    if (inPrint) {
      printLines.add(i + 1);
      // the print CSS is one template literal; it ends at the closing </style>
      if (/<\/style>/.test(l) && depth++ > -1) inPrint = false;
    }
  });
}
const screenLines = APP_LINES.map((l, i) => printLines.has(i + 1) ? '' : l);
const screen = screenLines.join('\n');

console.log('\n1) 🔴 ทุกชื่อที่โค้ดเรียกใช้ ต้องมีของจริงอยู่ข้างหลัง');
{
  /* ① CSS custom properties. The claim: nothing is asked for that is not defined. */
  const defined = new Set((css.match(/--[a-zA-Z0-9-]+\s*:/g) || []).map(s => s.replace(/\s*:$/, '').trim()));
  const asked = [...new Set((app.match(/var\(\s*(--[a-zA-Z0-9-]+)/g) || []).map(s => s.replace(/var\(\s*/, '')))];
  const missing = asked.filter(v => !defined.has(v));
  eq('🔴 ตัวแปรสีที่โค้ดเรียกแต่ไม่มีใครประกาศไว้', missing, []);
  ok_('...และของที่เพิ่งเพิ่ม ชี้ไปที่ token ที่มีอยู่แล้ว (โหมดมืดจึงตามมาเอง ไม่ต้องประกาศซ้ำ)',
    /--brand:var\(--blue\)/.test(css) && /--brand-soft:var\(--blue-bg\)/.test(css) &&
    /--brand-line:var\(--blue-line\)/.test(css));
  ok_('🏫 ...และ --brand คือจุดที่ "ปรับสีตามโรงเรียน" จะมาเปลี่ยนที่เดียว',
    /per-school|ต่อโรงเรียน|PER-SCHOOL/i.test(css.slice(Math.max(0, css.indexOf('--brand:') - 1600), css.indexOf('--brand:'))));

  /* ② Button variants. Every class on a .btn must have a rule, or the button silently becomes
   * whatever .btn alone is — which for a Close button means "the most important thing here". */
  const btnClasses = new Set();
  (app.match(/class="btn[^"]*"/g) || []).forEach(m => {
    m.replace(/class="|"$/g, '').split(/\s+/).forEach(c => {
      if (c && !/[${}'`]/.test(c)) btnClasses.add(c);   // skip template-interpolated classes
    });
  });
  const noRule = [...btnClasses].filter(c => !new RegExp('\\.' + c.replace(/[-]/g, '\\-') + '\\b').test(css));
  eq('🔴 คลาสปุ่มที่ใช้อยู่แต่ไม่มีกฎใน CSS', noRule, []);
  /* `ghost` AS ITS OWN CLASS, space-delimited. `\bghost\b` also matches inside `btn-ghost`, which is
   * the real, working component — the first draft of this guard failed on 14 correct buttons. */
  eq('...และ .ghost ที่ไม่มีอยู่จริง ไม่เหลืออยู่ในไฟล์แล้ว',
    (app.match(/class="btn(?:\s[^"]*)?\sghost(?=\s|")/g) || []).length, 0);
  /* 84 of 96 Close buttons already agreed on this; the four odd ones were the bug, not the rule. */
  const closes = (app.match(/class="(btn[^"]*)"[^>]*>\$\{esc\(t\('c\.close'\)\)\}/g) || [])
    .map(s => (s.match(/class="(btn[^"]*)"/) || [])[1]);
  ok_('ปุ่ม "ปิด" ส่วนใหญ่เป็นปุ่มเงียบเต็มความกว้าง ไม่ใช่ปุ่มหลัก',
    closes.filter(c => /\boutline\b/.test(c)).length >= closes.length - 6);
}

console.log('\n2) 📏 ขนาดตัวอักษร — ถามเฉพาะ "บนหน้าจอ" เอกสารพิมพ์ไม่ใช่หน้าจอ');
{
  /* 🔴 THE FLOOR. docs/FRONTEND_DESIGN.md: "อ่านออกจากระยะแขน กลางแดด มือเดียว ขณะอุ้มเด็กอยู่".
   * 92 places on screen broke our own written rule; the extremes (8.5px, 9px) were all on paper. */
  const tiny = screen.match(/font-size:(?:[0-9]|10|11)(?:\.\d+)?px/g) || [];
  eq('🔴 ข้อความบนหน้าจอที่เล็กกว่า 12px (app.js)', tiny, []);

  /* ...and the stylesheet, which sets type too and was missed by the first pass — two elements were
   * still rendering at 11px on a real page after app.js came back clean. Measured in the browser,
   * not inferred from the file.
   *
   * 🔴 TWO DECLARED EXCEPTIONS, listed here by name rather than matched by a pattern: the circular
   * count badges (a numeral in a 16-18px circle) and the calendar cell annotations (a 7-column
   * month grid gives each day ~50px on a 375px phone). The calendar one is an OPEN DESIGN PROBLEM
   * for Phase 3 — a month grid should carry marks and the words belong in a day sheet — and the
   * reason is written beside the rules in styles.css, not only here. */
  const CSS_LINES = css.split('\n');
  /* 🔴 THE SELECTOR, NOT THE LINE. A CSS rule may run over several lines, and the first draft of
   * this check read each line on its own — so `.cal .d .calio`, whose font-size sits on the
   * continuation line, looked like an undeclared offender while its selector was two lines up. */
  const ALLOWED = /\.bell \.badge|\.opbtn \.opbadge|\.cal\b|\.calio|\.calhol|\.callv|min-width:560px|background:var\(--bad,/;
  let selector = '';
  const cssTiny = [];
  CSS_LINES.forEach((l, i) => {
    if (/\{/.test(l)) selector = l.split('{')[0].trim() || selector;
    if (!/font-size:(?:[0-9]|10|11)(?:\.\d+)?px/.test(l)) return;
    if (/^\s*\*/.test(l)) return;                                  // inside a block comment
    if (ALLOWED.test(l) || ALLOWED.test(selector)) return;
    cssTiny.push((i + 1) + ': ' + (selector || l.trim()).slice(0, 60));
  });
  eq('🔴 ข้อความบนหน้าจอที่เล็กกว่า 12px (styles.css นอกข้อยกเว้นที่ประกาศไว้)', cssTiny, []);
  /* 🔴 AND index.html SETS TYPE TOO. app.js and styles.css both came back clean and a real page at
   * 375px still rendered 11px text — the version tag is written inline in the HTML. Three files can
   * set a font size, so all three are asked. This is why the check that mattered was the browser,
   * not the greps. */
  const html = R('webapp/index.html');
  eq('🔴 ข้อความบนหน้าจอที่เล็กกว่า 12px (index.html)',
    html.match(/font-size:(?:[0-9]|10|11)(?:\.\d+)?px/g) || [], []);
  ok_('...และข้อยกเว้นทั้งสองถูกเขียนเหตุผลไว้ข้างกฎ ไม่ใช่แค่ในเทสต์',
    /THE 12px FLOOR, AND THE TWO PLACES IT DOES NOT APPLY/.test(css) &&
    /OPEN DESIGN PROBLEM FOR PHASE 3/.test(css));
  ok_('...แต่เอกสารพิมพ์ยังเล็กได้ตามเดิม (กระดาษอ่านระยะใกล้ คนละคำถามกัน)',
    /font-size:(8\.5|9)px/.test(app));
  ok_('🔴 ...และเอกสารพิมพ์ยังไม่ตามธีมจอ — ใบเสร็จคือกระดาษ เปิดที่ไหนก็ขาว',
    (app.match(/color-scheme:light/g) || []).length >= 2);

  /* NO FRACTIONAL SIZES ON SCREEN. A fractional size is a value nudged until it looked right on one
   * screen, once — it is never a decision, which is why it is safe to remove without asking. */
  const frac = [...new Set(screen.match(/font-size:\d+\.\d+px/g) || [])];
  eq('ขนาดตัวอักษรแบบทศนิยมบนหน้าจอ', frac, []);

  /* NOT a pinned count: the direction. The remaining consolidation (15/17/19/20/21 and the display
   * sizes) is the SCALE, which is ผอ.'s decision in Figma — this only holds the floor that has
   * already been won, so it cannot quietly slide back while that decision is pending. */
  const sizes = [...new Set((screen.match(/font-size:(\d+)px/g) || []).map(s => +s.match(/\d+/)[0]))];
  ok_('จำนวนขนาดที่ใช้บนหน้าจอ ต้องไม่มากกว่าที่เป็นอยู่วันนี้ (' + sizes.length + ' ขนาด)', sizes.length <= 19);
  console.log('         ' + sizes.sort((a, b) => a - b).join(' '));
}

console.log('\n3) 🎨 สีที่พิมพ์เป็นรหัสตรงๆ — เฉพาะที่ถึงหน้าจอจริง');
{
  /* Everything that is LEGITIMATELY a literal, declared rather than pattern-matched:
   *   · LINE green / Facebook blue — somebody else's brand is their colour in both themes
   *   · a canvas export and the browser theme-color meta, which are not themed by CSS at all
   *   · var(--token, #fallback) — a fallback is not a hardcoded colour, it is a seatbelt
   * Anything else on a SCREEN is a patch of light-mode styling that survives into dark mode. */
  const BRAND = /#(06C755|1877F2)\b/i;
  const offenders = [];
  /* 🔴 COMMENTS ARE STRIPPED FIRST, PROPERLY. The first draft skipped only lines starting with `*`
   * or `//` and then flagged the note that EXPLAINS the one colour it had just fixed — the third
   * time in this project that a guard has punished somebody for writing down why. A rule that
   * fires on its own documentation teaches everyone to delete the documentation. */
  const commentLines = new Set();
  {
    let inBlock = false;
    screenLines.forEach((l, i) => {
      const t = l.trim();
      if (inBlock) { commentLines.add(i + 1); if (/\*\//.test(l)) inBlock = false; return; }
      if (/^\/\//.test(t)) { commentLines.add(i + 1); return; }
      if (/^\/\*/.test(t)) { commentLines.add(i + 1); if (!/\*\//.test(t.slice(2))) inBlock = true; }
    });
  }
  screenLines.forEach((l, i) => {
    const hex = l.match(/#[0-9a-fA-F]{3,8}\b/g);
    if (!hex) return;
    if (commentLines.has(i + 1)) return;                               // a comment, not a colour
    if (/fillStyle|toDataURL|theme-color/.test(l)) return;             // not CSS-themed
    hex.forEach(h => {
      if (BRAND.test(h)) return;
      if (new RegExp('var\\(--[a-z0-9-]+,\\s*' + h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\)', 'i').test(l)) return;
      if (/#(fff|ffffff)\b/i.test(h) && BRAND.test(l)) return;         // white ON a brand colour
      offenders.push((i + 1) + ':' + h);
    });
  });
  eq('🔴 สีที่พิมพ์ตรงๆ บนหน้าจอ (ทุกตัวคือบั๊กโหมดมืด)', offenders, []);
  ok_('สีของแบรนด์อื่นยังเป็นรหัสตรงๆ ได้ (เขียว LINE เป็นเขียว LINE ทั้งสองธีม)', /#06C755/i.test(app));
}

console.log('\n4) 📉 ตัวเลขที่ Phase 3 ต้องทำให้ลดลง — บันทึกไว้ ไม่ได้ตรึง');
{
  /* 🔴 DELIBERATELY NOT AN ASSERTION. 2,530 inline styles is the biggest finding in the audit and
   * also the one that cannot be fixed in a mechanical pass — it needs the 12 archetypes, which need
   * the design. Pinning a number here would fail every commit during the redesign for being
   * halfway through it. Printed so it is impossible to finish Phase 3 without having seen it. */
  const inline = (app.match(/style="[^"]*"/g) || []).length;
  console.log('         inline style="" ที่ยังเหลือ: ' + inline + '   (docs/UI_AUDIT.md §8 — ต้องลดลง)');
  console.log('         modal() ที่ยังไม่ได้ออกแบบ:  ' + (app.match(/modal\(/g) || []).length);
  ok_('มีเอกสารที่บอกว่าตัวเลขเหล่านี้คืออะไร และวัดซ้ำยังไง', fs.existsSync(path.join(__dirname, '..', 'docs', 'UI_AUDIT.md')));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
