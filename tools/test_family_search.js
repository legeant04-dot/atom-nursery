/**
 * tools/test_family_search.js — finding a family by the child's name.
 *   node tools/test_family_search.js
 *
 * Asked 2026-10-07: "ช่องค้นหาเวลาพิมพ์ชื่อนักเรียนเช่น โมน่า Filter ต้องจับข้อมูลคุณพ่อ คุณแม่ของ
 * น้องโมน่าแสดงด้วย".
 *
 * Typing a child's nickname found the child and stopped. An admin who needed to ring the family then
 * had to already know the mother's name — which is the thing they opened the search to find out. The
 * school thinks in families; the search thought in rows.
 *
 * WHAT THIS SUITE IS REALLY ABOUT is the LINK, not the matching. A child belongs to a family three
 * different ways in this data — USER_LINKS, STUDENTS.ParentID, and the legacy PARENTS.StudentID —
 * and a search built on the student row alone would silently miss exactly the second parent who is
 * hardest to find by name. parentKidsMap is the one place that knows all three, which is why the
 * index is built from it and not from the roster. §2 is that, one linkage at a time.
 */
const path = require('path'), fs = require('fs');
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js');
const appCode = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* THE HELPER ITSELF, lifted out of app.js and run — not grepped. A regex can say the line exists; it
 * cannot say that typing "โมน่า" finds her mother. The two things it reads from the page are passed
 * in, so this is the real function over real engine output. */
function loadFamSearchIndex(PKIDS, parents) {
  const src = app.slice(app.indexOf('function famSearchIndex(){'),
                        app.indexOf('window.A_globalSearch = async ()=>{'));
  if (!/function famSearchIndex\(\)\{/.test(src)) throw new Error('famSearchIndex not found in app.js');
  // phoneFmt is the app's own; a stub is enough here because no assertion below turns on its format
  const make = new Function('A_CACHE', 'window', 'phoneFmt',
    src + '\nreturn famSearchIndex;');
  return make({ parents: parents }, { _PKIDS: PKIDS }, p => String(p || ''))();
}

function school() {
  const M = {
    config: { Departments: ['Nursery 1'] },
    students: [
      { StudentID: 'S-MONA', NameTH: 'ด.ญ. โมนิกา ใจดี', Nickname: 'โมน่า', Class: 'Nursery 1', Status: 'ACTIVE', ParentID: 'P-DAD' },
      { StudentID: 'S-OTHER', NameTH: 'ด.ช. สมชาย รักเรียน', Nickname: 'ชาย', Class: 'Nursery 1', Status: 'ACTIVE', ParentID: 'P-OTHER' }
    ],
    parents: [
      // the father is on the student row
      { ParentID: 'P-DAD',   NameTH: 'สมศักดิ์ ใจดี',  Nickname: 'ศักดิ์', Phone: '0811111111', StudentID: '' },
      // the mother is linked ONLY through USER_LINKS — the case a roster-based search would lose
      { ParentID: 'P-MUM',   NameTH: 'สมหญิง ใจดี',   Nickname: 'หญิง',  Phone: '0822222222', LineUID: 'U-MUM', StudentID: '' },
      // ...and the grandmother through the oldest linkage of the three
      { ParentID: 'P-GRAN',  NameTH: 'บุญมี ใจดี',    Nickname: 'ยาย',   Phone: '0833333333', StudentID: 'S-MONA' },
      { ParentID: 'P-OTHER', NameTH: 'วิชัย รักเรียน', Nickname: 'ชัย',   Phone: '0844444444', StudentID: '' }
    ],
    userLinks: [{ UserUID: 'U-MUM', StudentID: 'S-MONA' }],
    classes: [], holidays: [], staff: [], activityLog: [], payments: []
  };
  return { M, H: createAtomAPI(M).H };
}

// ============================================================================
console.log('\n1) 🔴 typing the child’s name finds the family');
{
  const s = school();
  const pk = s.H.parentKidsMap({});
  const fam = loadFamSearchIndex(pk, s.M.parents);

  const hits = k => Object.keys(fam.kidsOf).filter(pid => String(fam.kidsOf[pid] || '').indexOf(k) >= 0);
  eq('🔴 "โมน่า" reaches all three of her people', hits('โมน่า').sort(), ['P-DAD', 'P-GRAN', 'P-MUM']);
  /* CONTROL — AND NOBODY ELSE'S. A search that widened until everything matched would "pass" every
   * assertion above and be useless on a roster of sixty. */
  ok_('CONTROL · ...and not the other family', hits('โมน่า').indexOf('P-OTHER') < 0);
  eq('CONTROL · the other child still reaches their own parent', hits('ชาย'), ['P-OTHER']);

  // the full name as well as the nickname — the office uses both
  ok_('the registered name works too, not only the nickname', hits('โมนิกา').length === 3);
}

// ============================================================================
console.log('\n2) 🔴 all three ways a child is linked to a family');
{
  /* THE POINT OF BUILDING THIS FROM parentKidsMap. Each parent below is attached to โมน่า by a
   * DIFFERENT mechanism, and a search reading STUDENTS.ParentID alone would find only the first. */
  const s = school();
  const fam = loadFamSearchIndex(s.H.parentKidsMap({}), s.M.parents);
  ok_('🔴 the father — STUDENTS.ParentID', /โมน่า/.test(fam.kidsOf['P-DAD'] || ''));
  ok_('🔴 the mother — USER_LINKS only', /โมน่า/.test(fam.kidsOf['P-MUM'] || ''));
  ok_('🔴 the grandmother — the legacy PARENTS.StudentID', /โมน่า/.test(fam.kidsOf['P-GRAN'] || ''));
}

// ============================================================================
console.log('\n3) and the other way round — an unknown number rings the office');
{
  const s = school();
  const fam = loadFamSearchIndex(s.H.parentKidsMap({}), s.M.parents);
  const w = String(fam.parentsOf['S-MONA'] || '');
  ok_('🔴 the child is found by her mother’s name', w.indexOf('สมหญิง') >= 0);
  ok_('🔴 ...and by a phone number', w.indexOf('0822222222') >= 0);
  ok_('...and the grandmother counts too', w.indexOf('บุญมี') >= 0);
  eq('CONTROL · the other family’s parent does not reach this child',
    w.indexOf('วิชัย') >= 0, false);
}

// ============================================================================
console.log('\n4) both search boxes use it, and the rows carry it');
{
  /* ONE HELPER FOR TWO BOXES. จัดการ filters already-rendered rows by a data-k attribute; the header
   * search builds its own list. Two copies of "what counts as a match" is how one of them quietly
   * stops finding families. */
  ok_('🔴 the header search asks for the children', /fam\.kidsOf\[p\.ParentID\]/.test(appCode));
  ok_('🔴 ...and for the parents', /fam\.parentsOf\[s\.StudentID\]/.test(appCode));
  ok_('🔴 the จัดการ parent rows carry the children in data-k', /_fam\.kidsOf\[p\.ParentID\]/.test(appCode));
  ok_('🔴 ...and the student rows carry the parents', /_fam\.parentsOf\[s\.StudentID\]/.test(appCode));
  ok_('there is only ONE index builder', (appCode.match(/function famSearchIndex\(\)/g) || []).length === 1);

  /* 🔴 BUILT AFTER THE ROSTER IS IN HAND. famSearchIndex reads A_CACHE.parents for the parents' own
   * names; one line earlier that still held the PREVIOUS render's roster, or nothing at all on the
   * first load — which is every load that matters. Caught before it shipped, pinned so it stays. */
  ok_('🔴 the index is built AFTER A_CACHE.parents is filled',
    appCode.indexOf('A_CACHE.parents=parents') < appCode.indexOf('const _fam=famSearchIndex()'));

  /* AND IT COSTS NO ROUND TRIP, which after the v421 measurement is the only cost worth counting:
   * parentKidsMap is already in the batch the manage screen was making anyway. */
  ok_('parentKidsMap still rides in the manage screen’s existing batch',
    /api\('parentKidsMap'\)\.catch\(\(\)=>\(\{\}\)\)/.test(appCode) &&
    appCode.indexOf("api('parentKidsMap')") < appCode.indexOf('const _fam=famSearchIndex()'));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
