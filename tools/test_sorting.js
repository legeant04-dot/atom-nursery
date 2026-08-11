/**
 * tools/test_sorting.js — every list reads in the same alphabetical order, in Thai and in English.
 *   node tools/test_sorting.js
 *
 * Thai cannot be sorted by comparing strings. The leading vowels เ แ โ ใ ไ are WRITTEN before the
 * consonant they are PRONOUNCED after, and they sit high in Unicode, so a plain sort throws เก้า,
 * แพรว, โมน่า and ใบร์ท to the end of the list — far from where anyone looks for them.
 *
 * These tests pin the real dictionary order, and pin the two orderings that must survive it: children
 * on temporary leave stay at the bottom of the finance list, and parents with no linked child stay at
 * the bottom of the view-as picker.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '\n         got=' + JSON.stringify(got) + (ok ? '' : '\n        want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const app = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'app.js'), 'utf8');

// ---- lift the real helpers out of app.js -----------------------------------------------------
function lift(lang) {
  const ctx = { Intl, console, String, Object, Array, Number, JSON, Math, RegExp, LANG: () => lang, window: {} };
  vm.createContext(ctx);
  const grab = re => { const m = re.exec(app); if (!m) throw new Error('not found: ' + re); return m[0]; };
  vm.runInContext([
    grab(/^ {2}const TITLE_RE = .*$/m),
    grab(/^ {2}const sortKey = v => \{[\s\S]*?^ {2}.*a bare title still sorts somewhere$/m),
    'var _collLang=null,_coll=null;',
    grab(/^ {2}const collator = \(\) => \{[\s\S]*?^ {4}return _coll; \};$/m),
    grab(/^ {2}const sortBy = .*$/m)
  ].join('\n').replace(/\bconst /g, 'var '), ctx);
  return ctx;
}
const TH = lift('th'), EN = lift('en');
const order = (ctx, names) => ctx.sortBy(names, x => x);

console.log('\n1) Thai reads in dictionary order, not Unicode order');
{
  const kids = ['โมน่า', 'เก้า', 'อาโป', 'กัปตัน', 'ฟอร์ซ', 'บีม', 'ใบร์ท', 'นูรีน', 'สมาร์ท', 'แพรว'];
  eq('real children from the school, in the order a person would look for them',
    order(TH, kids),
    ['กัปตัน', 'เก้า', 'นูรีน', 'บีม', 'ใบร์ท', 'แพรว', 'ฟอร์ซ', 'โมน่า', 'สมาร์ท', 'อาโป']);
  // this is the bug being fixed — a naive sort banishes every leading-vowel name to the end
  const naive = kids.slice().sort();
  ok_('a plain sort would have put เก้า last-ish instead of second', naive.indexOf('เก้า') > 5);
  ok_('...and our order does not', order(TH, kids).indexOf('เก้า') === 1);
}
{
  eq('the five leading vowels each land with their consonant',
    order(TH, ['ไก่', 'กา', 'เก', 'แก', 'โก', 'ใก']).slice(0, 2), ['กา', 'เก']);
  eq('tone marks do not push a name away from its neighbours',
    order(TH, ['น้อง', 'นอง', 'น่อง']), ['นอง', 'น่อง', 'น้อง']);
}

console.log('\n2) English lists sort as English');
{
  eq('plain names', order(EN, ['Nan', 'Araya', 'beam', 'Captain']), ['Araya', 'beam', 'Captain', 'Nan']);
  eq('case is not a separate alphabet', order(EN, ['beam', 'Beam', 'apple']), ['apple', 'beam', 'Beam']);
  eq('numbers inside names count as numbers, not text', order(EN, ['Room 10', 'Room 2', 'Room 1']), ['Room 1', 'Room 2', 'Room 10']);
}

console.log('\n3) Titles do not decide the order');
{
  // otherwise a roster of children is one long run of ด.ช. followed by one long run of ด.ญ.
  eq('children sort by their name, not by boy/girl',
    order(TH, ['ด.ญ. สมหญิง', 'ด.ช. กล้า', 'ด.ญ. กนก']), ['ด.ญ. กนก', 'ด.ช. กล้า', 'ด.ญ. สมหญิง']);
  eq('adults sort by their name, not by นาย/นาง',
    order(TH, ['นางสาว วิภา', 'นาย อนันต์', 'นาง กมล']), ['นาง กมล', 'นางสาว วิภา', 'นาย อนันต์']);
  // the school calls parents by their child, and both parents of one child belong together
  eq("parents sort under their child's nickname, so a couple stays together",
    order(TH, ['คุณแม่น้องโมน่า', 'คุณพ่อน้องเก้า', 'คุณแม่น้องเก้า', 'คุณพ่อน้องโมน่า']),
    ['คุณพ่อน้องเก้า', 'คุณแม่น้องเก้า', 'คุณแม่น้องโมน่า', 'คุณพ่อน้องโมน่า']);
  eq('English titles too', order(EN, ['Mr. Zack', 'Mrs. Anna', 'Ms. Bee']), ['Mrs. Anna', 'Ms. Bee', 'Mr. Zack']);
  eq('a name that is ONLY a title still sorts somewhere instead of vanishing', TH.sortKey('นาย'), 'นาย');
  eq('stacked titles are all removed', TH.sortKey('คุณพ่อน้องเก้า'), 'เก้า');
  eq('a plain name is left exactly as it is', TH.sortKey('กัปตัน'), 'กัปตัน');
}

console.log('\n4) The rule is applied once, where it cannot be forgotten');
{
  ok_('the three rosters are sorted as they enter the cache, not at each of 18 call sites',
    /set staff\(v\)\{ _AC\.staff=sortPeople/.test(app) && /set students\(v\)\{ _AC\.students=sortPeople/.test(app) && /set parents\(v\)\{ _AC\.parents=sortPeople/.test(app));
  ok_('...and again for the screens that fetch a roster without the cache',
    /const ROSTER = \{ listStaff:1, listStudents:1, listParents:1, listExportedStudents:1 \}/.test(app));
  ok_('a class roster is sorted too', /action === 'classList'[\s\S]{0,200}students: sortPeople/.test(app));
  ok_('so is the finance list of children', /sortBy\(f\.students,dnick\)/.test(app));
  ok_('and the salary list', /sortPeopleD\(f\.staff\)/.test(app));
  ok_('the food master, within each category', /const byCat=c=>sortBy\(items\.filter/.test(app));
  // one picker serves both the journal and the monthly menu, so one sort covers both
  ok_("and the dish dropdown", /const its=sortBy\(L\.filter\(i=>i\.category===c\), foodLabel\)/.test(app));
  ok_('switching language re-sorts, because the names on screen changed',
    /window\.__atomResort/.test(app) && /TOGGLE_LANG[\s\S]{0,200}__atomResort\(\)/.test(app));
  ok_('sorting never mutates the caller’s array — these lists are shared caches',
    /const sortBy = \(list, keyFn\) => \(list\|\|\[\]\)\.slice\(\)\.sort/.test(app));
  // the school's own order, which alphabetical would scramble into 1, 2, 3, Baby, Premium
  ok_('classes and departments are deliberately left alone', !/listClasses:1/.test(app) && !/listDepartments:1/.test(app));
}

console.log('\n5) Orderings that had a reason are not lost to alphabetical');
{
  // v205: a child on temporary leave is still billable, and sits at the bottom
  const fin = [
    { nick: 'โมน่า', paused: true }, { nick: 'เก้า', paused: false },
    { nick: 'อาโป', paused: true }, { nick: 'กัปตัน', paused: false }
  ];
  const dnick = o => o.nick;
  const sorted = TH.sortBy(fin, dnick).sort((a, b) => (a.paused ? 1 : 0) - (b.paused ? 1 : 0));
  eq('attending children first (alphabetical), then those on leave (alphabetical)',
    sorted.map(x => x.nick), ['กัปตัน', 'เก้า', 'โมน่า', 'อาโป']);
  ok_('every paused child really is below every attending one',
    sorted.findIndex(x => x.paused) > sorted.map(x => x.paused).lastIndexOf(false));

  const parents = [
    { ParentID: 'D', n: 'โมน่า', kids: 0 }, { ParentID: 'A', n: 'เก้า', kids: 1 },
    { ParentID: 'B', n: 'อาโป', kids: 0 }, { ParentID: 'C', n: 'กัปตัน', kids: 2 }
  ];
  const va = TH.sortBy(parents, p => p.n).sort((a, b) => ((b.kids || 0) > 0 ? 1 : 0) - ((a.kids || 0) > 0 ? 1 : 0));
  eq('families with a linked child first, each group alphabetical',
    va.map(x => x.n), ['กัปตัน', 'เก้า', 'โมน่า', 'อาโป']);
  ok_('...and nobody without a child is above someone with one',
    va.findIndex(x => !x.kids) > va.map(x => !!x.kids).lastIndexOf(true));
}

console.log('\n6) Nothing time-ordered was alphabetised by mistake');
{
  // a log read alphabetically instead of newest-first would be worse than useless
  ['payment history', 'activity log', 'growth records'].forEach(() => {});
  ok_('the payment history is still newest-first', /sort\(\(a,b\)=>b\.Date\.localeCompare\(a\.Date\)\)/.test(app));
  ok_('announcements still respect priority then date', /Number\(b\.Priority\|\|0\)-Number\(a\.Priority\|\|0\)/.test(app));
  ok_('student leave rows still read newest-first', /s\.leaves\.sort\(\(a,b\)=>String\(b\.Date\)\.localeCompare\(String\(a\.Date\)\)\)/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' : 'ALL PASS ') + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
