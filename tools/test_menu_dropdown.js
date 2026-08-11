/**
 * tools/test_menu_dropdown.js — the monthly food menu is picked from the master food list.
 *   node tools/test_menu_dropdown.js
 *
 * The menu used to be free text, so "ข้าวต้มไก่" typed into the menu and "ข้าวต้มไก่" picked in the
 * journal were two unrelated strings. They now come from ONE catalogue, which is what makes the
 * menu able to pre-fill the journal at all: the value a menu cell holds must be a value the
 * journal's own <select> can select.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
// normalise line endings: a CRLF checkout otherwise breaks every multi-line match below
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js');

/* The picker is a plain function of its inputs, so lift it out of app.js and run it for real
   rather than asserting on the source text. */
function loadPicker() {
  const at = app.indexOf('function jFoodOptions(');
  const stub = { jFoodOptions: () => '', JFOOD: [] };
  if (at < 0) { console.log('  FAIL jFoodOptions not found'); fail++; return stub; }
  const src = app.slice(at);
  const end = src.indexOf('\n  }\n');
  if (end < 0) { console.log('  FAIL jFoodOptions body not found'); fail++; return stub; }
  const ctx = {
    console, JSON, String, Object, Array,
    EN: () => false,
    esc: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    sortBy: (arr, key) => arr.slice().sort((a, b) => String(key(a)).localeCompare(String(key(b)), 'th')),
    FOOD_CAT: { savoury: () => 'ของคาว', dessert: () => 'ของหวาน', fruit: () => 'ผลไม้', other: () => 'อื่นๆ' },
    foodLabel: i => i.nameTH + (i.nameEN ? ' (' + i.nameEN + ')' : ''),
    JFOOD: []
  };
  vm.createContext(ctx);
  vm.runInContext(src.slice(0, end + 4) + '\nthis.jFoodOptions = jFoodOptions;', ctx);
  return ctx;
}

const MASTER = [
  { itemId: 'FI0001', nameTH: 'ข้าวต้มไก่', nameEN: 'Chicken rice porridge', category: 'savoury', active: true },
  { itemId: 'FI0002', nameTH: 'ข้าวผัดกุ้ง', nameEN: 'Shrimp fried rice', category: 'savoury', active: true },
  { itemId: 'FI0003', nameTH: 'กล้วยหอม', nameEN: 'Banana', category: 'fruit', active: true }
];

console.log('\n1) the menu editor offers the master list');
{
  const ctx = loadPicker();
  const html = ctx.jFoodOptions('', MASTER, '– ไม่มีเมนู –');
  ok_('every master dish is an option', MASTER.every(i => html.indexOf('value="' + i.nameTH + '"') >= 0));
  ok_('grouped by category', html.indexOf('<optgroup label="ของคาว">') >= 0 && html.indexOf('<optgroup label="ผลไม้">') >= 0);
  ok_('the menu\'s own blank label is used', html.indexOf('– ไม่มีเมนู –') >= 0);
  ok_('the journal\'s blank label is NOT forced on the menu', html.indexOf('ยังไม่ระบุ') < 0);
  ok_('a new dish can still be added', html.indexOf('value="__new"') >= 0);
}

console.log('\n2) the list passed in is the list shown — no falling back to the journal\'s copy');
{
  const ctx = loadPicker();
  ctx.JFOOD = [{ itemId: 'X', nameTH: 'ของครู', nameEN: '', category: 'other', active: true }];
  const html = ctx.jFoodOptions('', MASTER, '– ไม่มีเมนู –');
  ok_('the menu\'s list is used', html.indexOf('ข้าวต้มไก่') >= 0);
  ok_('the journal\'s list does not leak in', html.indexOf('ของครู') < 0);
  // and with no list at all the journal still works exactly as before
  eq('default list is JFOOD', ctx.jFoodOptions('').indexOf('ของครู') >= 0, true);
  ok_('default blank label unchanged', ctx.jFoodOptions('').indexOf('ยังไม่ระบุ') >= 0);
}

console.log('\n3) a dish already planned but no longer on the master list is KEPT');
{
  // menus were typed by hand for months; none of that text may disappear when the screen turns
  // into a dropdown, or a saved menu would be silently wiped on the next save
  const ctx = loadPicker();
  const html = ctx.jFoodOptions('ต้มจืดที่เลิกทำแล้ว', MASTER, '– ไม่มีเมนู –');
  ok_('the old dish is still an option', html.indexOf('>ต้มจืดที่เลิกทำแล้ว<') >= 0);
  ok_('and it is the selected one', /value="ต้มจืดที่เลิกทำแล้ว" selected/.test(html));
}

console.log('\n4) a dish that IS on the master list is selected, not duplicated');
{
  const ctx = loadPicker();
  const html = ctx.jFoodOptions('ข้าวผัดกุ้ง', MASTER, '– ไม่มีเมนู –');
  eq('appears once', (html.match(/value="ข้าวผัดกุ้ง"/g) || []).length, 1);
  ok_('and is selected', /value="ข้าวผัดกุ้ง" selected/.test(html));
}

console.log('\n5) the menu screen is wired to the master list');
{
  ok_('A_foodMenu loads foodItems', /const \[deps,cls,studs,food\]=await Promise\.all\(\[[\s\S]{0,400}api\('foodItems'/.test(app));
  ok_('meal cells are <select>, not free text', /<select id="fm_\$\{k\}_\$\{ds\}"/.test(app));
  ok_('no free-text meal input left behind', !/<input id="fm_\$\{k\}_\$\{ds\}"/.test(app));
  ok_('cells are built from the master list', /jFoodOptions\(v\[k\]\|\|'',FM_FOOD/.test(app));
  ok_('the note field stays free text', /<input id="fm_note_\$\{ds\}"/.test(app));
}

console.log('\n6) adding a dish from inside the editor keeps unsaved work');
{
  const fn = app.slice(app.indexOf('window.A_fmFoodPick='), app.indexOf('window.A_fmCollect='));
  ok_('"__new" is never left as the saved value', /el\.value=el\.dataset\.prev\|\|''/.test(fn));
  ok_('the dish is written to the master list', /api\('saveFoodItem'/.test(fn));
  ok_('every cell is refreshed in place', /querySelectorAll\('select\[id\^="fm_"\]'\)/.test(fn));
  ok_('each cell keeps what it had', /const cur=s\.value;[\s\S]{0,160}s\.value=cur/.test(fn));
  ok_('the modal is not rebuilt (that would lose unsaved edits)', !/A_foodMenu\(\)/.test(fn));
  ok_('a duplicate name is not re-sent to the server', /if\(!FM_FOOD\.some\(/.test(fn));
  // the class/month <select> is id="fmCls" — it must not be caught by the refresh sweep
  ok_('the class picker is not a "fm_" id', /id="fmCls"/.test(app) && !/id="fm_Cls"/.test(app));
}

console.log('\n7) what is collected still saves the same shape');
{
  const fn = app.slice(app.indexOf('window.A_fmCollect='), app.indexOf('window.A_fmSave='));
  ok_('reads by the same element ids', /getElementById\('fm_'\+k\+'_'\+ds\)/.test(fn));
  ok_('still sends all five meals + note', ['breakfast', 'snackAM', 'lunch', 'dinner', 'snackPM', 'note']
    .every(k => fn.indexOf("g('" + k + "')") >= 0));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
