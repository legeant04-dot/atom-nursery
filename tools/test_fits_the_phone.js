/**
 * tools/test_fits_the_phone.js — three things that only go wrong on a real phone.
 *   node tools/test_fits_the_phone.js
 *
 * All three were reported from an actual handset on 2026-08-26, and none of them would have shown up
 * in any amount of reading: they are layout, and layout is only true at a width.
 *
 *  1. THE DOWNLOAD LINK WAS NOT A BUTTON. `.btn` was written for <button>, which is inline-block and
 *     centres its text by default. An <a class="btn block"> is inline, so `width:100%` does nothing
 *     at all — the link came out shrunk to its own text against the left edge, beside a full-width
 *     Close button. Measured on a 375px viewport: 339px vs 339px now, same left edge.
 *
 *  2. THE ADMIN SECTION HEADER FELL APART. "👶 นักเรียน" carries two full-width Thai buttons plus the
 *     collapse caret, and they wrapped INSIDE the flex row — pushing the title into a narrow column
 *     with its count dropping to a second line. The caret is now a sibling of the actions so a phone
 *     can keep title+caret on line one and give the buttons the whole of line two.
 *
 *  3. THE PARENT'S BOTTOM BAR RAN OFF THE SCREEN. Seven destinations × `min-width:62px` = 434px of
 *     content on a 360px phone, and `overflow-x:auto` meant the last items were simply not there
 *     unless you thought to swipe a navigation bar. Nobody swipes a navigation bar.
 *
 * WHAT THIS FILE CANNOT DO is measure. The numbers above came from the browser; what is asserted here
 * is that the RULES which produced them are still present, and — for the one that has a trap in it —
 * that a later rule has not quietly taken over again.
 */
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const css = R('webapp/styles.css'), app = R('webapp/app.js');

console.log('\n1) a link wearing .btn behaves like a button');
{
  ok_('an <a class="btn"> is given a box at all', /a\.btn\{[^}]*display:inline-block/.test(css));
  ok_('...and centres its label', /a\.btn\{[^}]*text-align:center/.test(css));
  ok_('...and .block actually fills the width', /a\.btn\.block\{display:block;\}/.test(css));
  ok_('...and border-box, so padding cannot push it wider than its row', /a\.btn\{[^}]*box-sizing:border-box/.test(css));
  ok_('the underline is gone, since it is a button now', /a\.btn\{[^}]*text-decoration:none/.test(css));
  // the thing that made this necessary
  ok_('the APK download really is an <a>, not a button', /<a class="btn block" href="\$\{APK_URL\}"/.test(app));
}

console.log('\n2) the admin section header wraps as a header, not as a pile');
{
  ok_('the header is marked', /class="spread sechd"/.test(app));
  /* THE CARET MUST BE A SIBLING OF THE ACTIONS, not inside them: that is what lets the narrow layout
   * keep it up on the title's line while the buttons drop to their own. */
  const head = /const secHead = [\s\S]*?`;/.exec(app)[0];
  ok_('the caret sits outside the action group', head.indexOf('sectog') < head.indexOf('secacts'));
  ok_('...and the actions are wrapped so they can be moved as one', /<span class="row secacts"/.test(head));
  /* AND IT NEEDS ITS OWN stopPropagation NOW. It used to inherit one from the wrapper it was inside;
   * without it the container's toggle fires as well — toggling twice, i.e. doing nothing at all. */
  ok_('the caret stops the container toggle firing too', /class="btn sm outline sectog" onclick="event\.stopPropagation\(\);A_toggleSec\(this\)"/.test(head));
  ok_('...and so do the action buttons', /class="row secacts" onclick="event\.stopPropagation\(\)"/.test(head));
  ok_('an empty action group is not rendered at all', /\$\{addBtn\?`<span class="row secacts"/.test(head));
  // wide stays exactly as it was: title · actions · caret
  ok_('order keeps the wide layout unchanged', /\.sechd \.secacts\{order:2;\}/.test(css) && /\.sechd \.sectog\{order:3/.test(css));
  ok_('...and narrow sends the actions to their own full-width line',
    /@media\(max-width:560px\)\{[\s\S]*?\.sechd \.secacts\{order:4;flex:1 1 100%/.test(css));
  ok_('...where they share it evenly', /\.sechd \.secacts \.btn\{flex:1 1 0;min-width:0;\}/.test(css));
  ok_('the title may shrink rather than shove the row wider', /\.sechd h3\{flex:1 1 auto;min-width:0;\}/.test(css));
}

console.log('\n3) the bottom bar fits the phone instead of scrolling');
{
  ok_('it no longer scrolls sideways', /\.bottomnav\{overflow-x:hidden;\}/.test(css));
  ok_('...and no minimum width forces it wider than the screen', !/\.bottomnav button\{min-width:62px/.test(css));
  ok_('every destination shares the width equally', /\.bottomnav button\{min-width:0;flex:1 1 0/.test(css));
  ok_('the label can ellipsise instead of widening the bar', /\.bottomnav button \.lb\{[^}]*text-overflow:ellipsis/.test(css));
  ok_('...and the renderer gives it something to ellipsise', /<span class="lb">\$\{esc\(t\(l\)\)\}<\/span>/.test(app));
  /* THE TRAP. The obvious fix is to shrink the type on a narrow screen, and it does not work: there
   * is a deliberate readability floor LATER in this file, at the same specificity, and later wins.
   * Anything set here is silently ignored — so the room is taken from the padding instead, and the
   * floor is left alone because it was a decision somebody made on purpose. */
  // comments stripped first: the note explaining this trap necessarily quotes the very rule it is
  // warning about, and matching that would fail the check it exists to make
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const floorAt = code.indexOf('.bottomnav button{font-size:12px;}');
  ok_('the readability floor still exists', floorAt > 0);
  const navBlock = code.slice(code.indexOf('.bottomnav{overflow-x:hidden;}'), floorAt);
  eq('...and nothing before it tries to set a font-size it cannot win',
    (navBlock.match(/\.bottomnav button\{[^}]*font-size/g) || []), []);
  ok_('the space comes from padding on a narrow screen instead',
    /@media\(max-width:400px\)\{ \.bottomnav button\{padding:8px 0;\} \}/.test(css));
  ok_('...and the reason is written where the next person will look', /readability floor/.test(css));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
