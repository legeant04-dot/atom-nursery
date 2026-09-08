/**
 * tools/test_journal_toggle.js — tapping the chosen answer again clears it.
 *   node tools/test_journal_toggle.js
 *
 * Asked 2026-09-08: "แก้ไขให้สามารถกดซ้ำ = ยกเลิกการเลือก … เหมือนหัวข้อการเรียนรู้".
 *
 * The multi-choice rows (การเรียนรู้, ทักษะ) have always toggled. The single-choice rows — อารมณ์,
 * สุขภาพ, น้ำ, ปริมาณอาหารต่อมื้อ, การขับถ่าย — did not: the handler only ever ASSIGNED. A teacher
 * who tapped the wrong one had no way to take it back, because there is no "none of these" button
 * either. The row was write-once for the rest of the entry and the only escape was to leave without
 * saving.
 *
 * The real handlers are run here against a stub row of buttons, so this tests the behaviour rather
 * than the shape of the source.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const src = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'app.js'), 'utf8').replace(/\r\n/g, '\n');

/** a row of choice buttons that behave like the DOM's, so the handlers can be run for real */
function row(n) {
  const parent = { children: [] };
  for (let i = 0; i < n; i++) {
    const cls = new Set();
    parent.children.push({
      parentElement: parent,
      classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c),
        toggle: c => (cls.has(c) ? cls.delete(c) : cls.add(c)) },
      on: () => cls.has('pass')
    });
  }
  return parent.children;
}
const lit = btns => btns.map(b => b.on());

function boot() {
  const code = src.slice(src.indexOf('  const jClearRow ='), src.indexOf('  window.J_mic='));
  const ctx = { console, JSON, Object, Array, String, Number, Math, Set, Map, RegExp, Error, document: { getElementById: () => null },
    JSEL: { Mood: '', Health: '', Water: '', Meals: {}, Toilet: {}, Activity: new Set(), Skills: new Set() },
    EN: () => false, esc: s => s, sortBy: a => a, window: {} };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(code, ctx);
  return ctx;
}

console.log('1) a single-choice row (อารมณ์ / สุขภาพ / น้ำ)');
{
  const c = boot(), b = row(3);
  c.J_pick('Mood', 'happy', b[0], false);
  eq('picking marks it', [c.JSEL.Mood, lit(b)], ['happy', [true, false, false]]);
  c.J_pick('Mood', 'sad', b[1], false);
  eq('picking another moves the mark, one at a time', [c.JSEL.Mood, lit(b)], ['sad', [false, true, false]]);
  /* THE POINT OF THE CHANGE. */
  c.J_pick('Mood', 'sad', b[1], false);
  eq('tapping the chosen one again clears it', c.JSEL.Mood, '');
  eq('...and nothing is left lit', lit(b), [false, false, false]);
  // ...and the row still works afterwards; an undo must not leave it stuck
  c.J_pick('Mood', 'happy', b[0], false);
  eq('the row still works after an undo', [c.JSEL.Mood, lit(b)], ['happy', [true, false, false]]);
}
{
  // the multi rows are untouched — this is the behaviour the single rows were asked to copy
  const c = boot(), b = row(3);
  c.J_pick('Skills', 'ภาษา', b[0], true);
  c.J_pick('Skills', 'สังคม', b[1], true);
  eq('a multi row keeps both', [[...c.JSEL.Skills], lit(b)], [['ภาษา', 'สังคม'], [true, true, false]]);
  c.J_pick('Skills', 'ภาษา', b[0], true);
  eq('...and drops only the one tapped again', [[...c.JSEL.Skills], lit(b)], [['สังคม'], [false, true, false]]);
}

console.log('\n2) how much of the meal was eaten');
{
  const c = boot(), b = row(3);
  c.J_meal('Lunch', 'หมด', b[0]);
  eq('picking records the amount', [c.JSEL.Meals, lit(b)], [{ Lunch: 'หมด' }, [true, false, false]]);
  c.J_meal('Lunch', 'หมด', b[0]);
  /* The KEY goes, not just its value: the entry replaces the whole Meals cell on save, so a meal
   * that was cleared has to read back exactly like one nobody ever touched. */
  eq('tapping it again removes the meal entirely', c.JSEL.Meals, {});
  eq('...and unlights the row', lit(b), [false, false, false]);
  ok_('...not left as an empty string', !('Lunch' in c.JSEL.Meals));
  // one meal clearing must not disturb another
  c.J_meal('Lunch', 'ครึ่ง', b[1]); c.J_meal('Breakfast', 'หมด', row(2)[0]);
  c.J_meal('Lunch', 'ครึ่ง', b[1]);
  eq('clearing lunch leaves breakfast alone', c.JSEL.Meals, { Breakfast: 'หมด' });
}

console.log('\n3) การขับถ่าย');
{
  const c = boot(), b = row(3);
  c.J_tl('Bowel', 'ปกติ', b[1]);
  eq('picking records it', [c.JSEL.Toilet, lit(b)], [{ Bowel: 'ปกติ' }, [false, true, false]]);
  c.J_tl('Bowel', 'ปกติ', b[1]);
  eq('tapping it again removes the key', c.JSEL.Toilet, {});
  eq('...and unlights the row', lit(b), [false, false, false]);
  const b2 = row(2);
  c.J_tl('Urination', 'ปกติ', b2[0]); c.J_tl('Bowel', 'เหลว', b[2]);
  c.J_tl('Bowel', 'เหลว', b[2]);
  eq('clearing one line leaves the others', c.JSEL.Toilet, { Urination: 'ปกติ' });
}

console.log('\n4) one helper, not four copies of the same three lines');
{
  eq('the row is cleared in one place', (src.match(/const jClearRow = /g) || []).length, 1);
  eq('...and every handler uses it', (src.match(/jClearRow\(el\)/g) || []).length, 3);
  ok_('the reason is written down where the handlers are', /กดซ้ำ|tapping the chosen answer again/i.test(src.slice(src.indexOf('TAPPING THE CHOSEN ANSWER'), src.indexOf('TAPPING THE CHOSEN ANSWER') + 900)) || src.indexOf('TAPPING THE CHOSEN ANSWER AGAIN CLEARS IT') > 0);
}

console.log('\n5) the parent home has no duplicate shortcuts in the header');
{
  /* บันทึก and พัฒนาการ were two more buttons in the top bar for two screens that are already tabs
   * in the bottom navigation — the same destination twice, on the row that also holds the language
   * toggle, the theme toggle, the bell and the profile. */
  const home = src.slice(src.indexOf('setTopActions(\'\');') - 700, src.indexOf('setTopActions(\'\');') + 60);
  ok_('the header is cleared, not filled', /setTopActions\(''\);/.test(home));
  ok_('...and the two shortcuts are gone', !/setTopActions\(`<button[^`]*P_journal/.test(src));
  // the destinations themselves must still exist — this removed a shortcut, not a screen
  ok_('บันทึก is still a bottom tab', /\['journal','book','nav\.journal'\]/.test(src));
  ok_('DSPM is still a bottom tab', /\['dspm','clipboard','nav\.dspm'\]/.test(src));
  ok_('...and both screens are still reachable in code', /window\.P_journal\s*=/.test(src) && /window\.P_dspm\s*=/.test(src));
}

console.log(fail ? `\nFAILED ${pass} passed, ${fail} failed` : `\nPASSED ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
