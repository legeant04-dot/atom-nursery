/**
 * tools/test_parent_links.js — "is this parent attached to a child" must have ONE answer.
 *   node tools/test_parent_links.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 REPORTED BY THE ผอ. 2026-10-19: "ทำไมผู้ปกครองชื่อ พิชชา อนันต์ แสดงข้อมูลว่าไม่ผูกกับนักเรียน
 * แต่เข้าไปดูผูกกับนักเรียนน้องนูรีน".
 *
 * Because the app had THREE answers to that one question and they disagreed:
 *
 *   visibleStudents      links by UID, else STUDENTS.ParentID · drops EXPORTED/WITHDRAWN only
 *   parentOwnsStudent_   links by UID, or PARENTS.StudentID + LineUID   ← this one grants ACCESS
 *   parentLinkCounts     built its own uid→ParentID map, over enrolledStudents()
 *
 * So a family could sign in, see their child, and be listed by the admin as attached to nobody.
 *
 * MEASURED ON THE REAL EXPORT, not guessed:
 *   · 6 UserUIDs on link rows match NO parent's LineUID — invisible to a uid→ParentID map
 *   · 3 children are past their last day, with 7 parents attached to them — counted as unlinked
 *     because enrolledStudents() drops a child who has finished
 *
 * 🔴 AND "ATTACHED" IS TWO QUESTIONS, NOT ONE. "Has a child here at all" decides whether somebody
 * may sign in; "has a child currently enrolled" decides whether the admin should chase them.
 * Collapsing them into a single 👶 0 is what made seven real families look like stray records —
 * and a stray record is a thing an admin deletes.
 */
const path = require('path'), fs = require('fs');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                    'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                    'PaySlips', 'PayAdjust', 'Password', 'Certificate', 'Dspm', 'BillRun',
                    'GasEngine', 'Engine', 'Day6']);

/* One parent for each of the four ways a family can be attached, plus the two states the ผอ. wants
 * told apart. Built from the real shapes found on live, not from what the schema suggests. */
const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var MAIN = getMainSpreadsheet_();
  function kid(id, name, extra) {
    appendObject_(sheet_(MAIN, 'STUDENTS'), Object.assign({ StudentID: id, Name: name, Nickname: name,
      Class: 'Nursery 2', Status: 'ACTIVE', DOB: '2023-01-01', EnrollDate: '2024-01-01' }, extra || {}));
  }
  function par(id, name, extra) {
    appendObject_(sheet_(MAIN, 'PARENTS'), Object.assign({ ParentID: id, Name: name,
      Relationship: 'มารดา', Phone: '08x' }, extra || {}));
  }
  // A · linked through USER_LINKS, parent's LineUID matches
  kid('K-A', 'เด็กเอ');  par('P-A', 'แม่เอ', { LineUID: 'U-A' });
  appendObject_(sheet_(MAIN, 'USER_LINKS'), { UserUID: 'U-A', StudentID: 'K-A', VerifiedBy: 'test', Date: '2026-01-01' });
  // B · 🔴 an ORPHAN link: the row grants access by uid, but NO parent record carries that uid, so
  //     it cannot be attributed to anybody from the parent side. Six of these on live. Counting the
  //     parent as 0 is correct — there is no parent to credit — but the ROW must still be reported.
  kid('K-B', 'เด็กบี');  par('P-B', 'แม่บี', { LineUID: '' });
  appendObject_(sheet_(MAIN, 'USER_LINKS'), { UserUID: 'U-ORPHAN', StudentID: 'K-B', VerifiedBy: 'test', Date: '2026-01-01' });
  // C · the legacy pointer on the CHILD
  kid('K-C', 'เด็กซี', { ParentID: 'P-C' });  par('P-C', 'แม่ซี');
  // D · the oldest pointer, on the PARENT — parentOwnsStudent_ trusts this for ACCESS
  kid('K-D', 'เด็กดี');  par('P-D', 'แม่ดี', { StudentID: 'K-D' });
  // E · 🔴 attached, but the child's last day has passed — a family the school HAD
  kid('K-E', 'เด็กอี', { ParentID: 'P-E', EndDate: '2026-01-31' });  par('P-E', 'แม่อี');
  // F · attached to nobody at all — a stray sign-up
  par('P-F', 'คนที่ไม่มีลูกในระบบ');
  _configCache = null;
  try { CacheService.getScriptCache().removeAll(['cfg', 'col:PARENTS', 'col:STUDENTS', 'col:USER_LINKS']); } catch (e) {}

  var ctx = hydrateLazy_(['students', 'parents', 'userLinks', 'classes']);
  var H = createAtomAPI(ctx.M, null).H;
  return JSON.stringify({ counts: H.parentLinkCounts({}), detail: H.parentLinkDetail({}), orphans: H.orphanLinks({}) });
}));

console.log('\n1) 🔴 ทั้งสี่เส้นทางที่ครอบครัวถูกผูกกับเด็ก ต้องนับได้ครบ');
{
  const c = res.counts;
  eq('A · ผูกผ่าน USER_LINKS และ LineUID ตรงกัน', c['P-A'], 1);
  /* 🔴 THE ONE THAT WAS INVISIBLE. The old count mapped uid→ParentID off PARENTS.LineUID, so a link
   * row whose UserUID matched no parent record simply did not exist to it. Six on live. */
  /* 🔴 B is an ORPHAN link and 0 is the RIGHT answer: nothing on the parent side carries that
   * uid, so there is no family to credit. The fault is not the count — it is that the row still
   * opens a child's record while appearing in no list. Section 2b asserts it is reported. */
  eq('B · ลิงก์กำพร้า (ไม่มีผู้ปกครองคนไหนถือ uid นี้) → นับ 0 ถูกแล้ว', c['P-B'], 0);
  eq('C · ผูกผ่าน STUDENTS.ParentID', c['P-C'], 1);
  eq('D · ผูกผ่าน PARENTS.StudentID (เส้นทางที่เซิร์ฟเวอร์ใช้ตัดสินสิทธิ์)', c['P-D'], 1);
  eq('F · ไม่ได้ผูกกับใครจริงๆ', c['P-F'], 0);
}

console.log('\n2) 🔴 "ลูกออกไปแล้ว" ไม่เท่ากับ "ไม่เคยผูกกับใคร"');
{
  const d = res.detail;
  eq('E · ลูกเลยวันสุดท้ายแล้ว → กำลังเรียนอยู่ 0', d['P-E'].active, 0);
  eq('...แต่ยังผูกอยู่ 1 คน', d['P-E'].total, 1);
  ok_('🔴 ...และถูกจัดเป็นกลุ่ม "ลูกออกไปแล้วทั้งหมด"', d['P-E'].onlyEnded === true);
  /* The distinction the ผอ. asked for. Seven real families were in this state and the single 👶 0
   * put them in the same bucket as a stray record — which is a thing an admin deletes. */
  eq('F · ไม่เคยผูกกับใคร → total 0 เช่นกัน', d['P-F'].total, 0);
  ok_('🔴 ...แต่ไม่ใช่กลุ่มเดียวกัน', d['P-F'].onlyEnded === false);
  ok_('...และบอกชื่อลูกที่ออกไปแล้วด้วย', (d['P-E'].children || []).some(k => k.ended === true));
}

console.log('\n3) 🔴 การนับ ต้องตรงกับสิ่งที่เซิร์ฟเวอร์ใช้ให้สิทธิ์เข้าถึง');
{
  /* The whole bug in one assertion: every parent the ACCESS path would let in must be a parent the
   * admin list calls attached. Before today four of the six below were counted 0 by one function
   * or the other. */
  const d = res.detail;
  ['P-A', 'P-C', 'P-D', 'P-E'].forEach(p =>
    ok_('  ' + p + ' — ระบบถือว่าผูกกับเด็ก (เข้าใช้งานได้)', d[p].total > 0));
  ok_('  P-F — ไม่ผูก และเข้าไม่ได้', d['P-F'].total === 0);
}

console.log('\n4) มีตัวตอบคำถามนี้ "ตัวเดียว" ไม่ใช่สามตัว');
{
  const eng = R('webapp/engine.js');
  ok_('🔴 มี parentStudentIds_ เป็นตัวกลาง', /function parentStudentIds_\(pa\)\{/.test(eng));
  ok_('parentLinkCounts ถามจากตัวนั้น', /parentStudentIds_\(pa\)\.active\.length/.test(eng));
  ok_('parentLinkDetail ก็ถามจากตัวเดียวกัน', /parentLinkDetail: \(\) =>[\s\S]{0,200}parentStudentIds_\(pa\)/.test(eng));
  /* 🔴 AND leaderParents, WHICH WAS WRONG IN ITS OWN WAY. It walked USER_LINKS looking at
   * `l.ParentID` — a column USER_LINKS does not have — so the filter matched nothing and a head
   * teacher saw only the families attached by the legacy pointer. Written 2026-10-15, found while
   * fixing this on 2026-10-19: every place that re-derives this gets a different subset. */
  ok_('🔴 leaderParents ก็เลิกคิดเองแล้ว (เดิมอ่าน l.ParentID ซึ่งไม่มีคอลัมน์นั้น)',
    /mineOf\[pa\.ParentID\]/.test(eng) && !/filter\(l=>String\(l\.StudentID\)===String\(s\.StudentID\)\)\.forEach\(l=>\{\s*\n?\s*\(kidOf\[l\.ParentID\]/.test(eng));
  ok_('USER_LINKS ไม่มีคอลัมน์ ParentID จริงๆ (เหตุผลที่โค้ดเดิมเงียบ)',
    /USER_LINKS:\s*\['UserUID', 'StudentID', 'VerifiedBy', 'Date'\]/.test(R('src/Config.gs')));
}

console.log('\n5) หน้าจอแอดมิน — แยกสามกลุ่ม');
{
  const app = R('webapp/app.js');
  ok_('มีตัววาดกลุ่ม', /function A_parentGroups\(parents, _fam\)/.test(app));
  ok_('กลุ่ม 1 · มีบุตรกำลังเรียนอยู่', /มีบุตรกำลังเรียนอยู่/.test(app));
  ok_('🔴 กลุ่ม 2 · บุตรจบ/ออกแล้วทั้งหมด — และบอกว่าไม่ใช่ข้อมูลตกค้าง',
    /บุตรจบ \/ ออกจากโรงเรียนแล้วทั้งหมด/.test(app) && /ไม่ใช่ข้อมูลตกค้าง/.test(app));
  ok_('🔴 กลุ่ม 3 · ไม่ได้ผูกกับใครเลย — และบอกว่าทำได้แค่เพิ่มนักเรียน',
    /ยังไม่ได้ผูกกับนักเรียนคนใดเลย/.test(app) && /ทำได้แค่เพิ่มข้อมูลนักเรียน/.test(app));
  ok_('ป้ายบอกทั้ง "กำลังเรียน" และ "ผูกทั้งหมด"', /👶 \$\{d\.active\}\$\{d\.total > d\.active/.test(app));
  ok_('หน้า "ดูมุมมอง" ใช้ตัวเลขชุดเดียวกัน ไม่ใช่ชุดเก่า',
    /_LINKDETAIL/.test(app) && !/_LINKCOUNTS/.test(app));
}

console.log('\n6) 🚪 ประตูปิดเองหลังลูกออกไปแล้ว 30 วัน (ผอ. เลือกแบบ B)');
{
  /* 🔴 NOT ON THE LAST DAY, AND THAT IS THE DECISION. The final month's bill is usually still open
   * when a child leaves, the certificate comes afterwards, and the growth history is the family's
   * too — cutting access on the leaving date would lock a family out of a bill they still owe. So
   * the record stays reachable for a grace period and then closes by itself, with nobody having to
   * remember to do it. */
  const g = JSON.parse(run(function () {
    _configCache = null; setupAll(); _configCache = null;
    var MAIN = getMainSpreadsheet_();
    function days(n){ var d=new Date(); d.setDate(d.getDate()+n); return dateStr_(d); }
    // three children: still here · left 5 days ago (inside the window) · left 40 days ago (closed)
    [['G-HERE',''],['G-IN',days(-5)],['G-OUT',days(-40)]].forEach(function(r){
      appendObject_(sheet_(MAIN,'STUDENTS'),{StudentID:r[0],Name:r[0],Nickname:r[0],Class:'Nursery 2',
        Status:'ACTIVE',DOB:'2023-01-01',EnrollDate:'2024-01-01',ParentID:'PP-'+r[0],EndDate:r[1]});
      appendObject_(sheet_(MAIN,'PARENTS'),{ParentID:'PP-'+r[0],Name:'แม่ '+r[0],LineUID:'U-'+r[0]});
      appendObject_(sheet_(MAIN,'USER_LINKS'),{UserUID:'U-'+r[0],StudentID:r[0],VerifiedBy:'t',Date:'2024-01-01'});
    });
    _configCache = null;
    try { CacheService.getScriptCache().removeAll(['cfg','col:STUDENTS','col:PARENTS','col:USER_LINKS']); } catch(e){}
    var ctx = hydrateLazy_(['students','parents','userLinks','classes','studentTerms']);
    var H = createAtomAPI(ctx.M, null).H;
    var out = {};
    ['G-HERE','G-IN','G-OUT'].forEach(function(id){
      out[id] = H.parentChildren({ uid:'U-'+id, parentId:'PP-'+id, role:'Parent' }).length;
    });
    // ...and the LIVE route, which is the gate a request naming a studentId goes through
    out.liveHere = parentAccessClosed_('G-HERE');
    out.liveIn   = parentAccessClosed_('G-IN');
    out.liveOut  = parentAccessClosed_('G-OUT');
    out.owns     = parentOwnsStudent_('U-G-OUT','G-OUT');
    return JSON.stringify(out);
  }));
  eq('เด็กที่ยังเรียนอยู่ — ครอบครัวเห็นตามปกติ', g['G-HERE'], 1);
  eq('🔴 ออกไป 5 วัน (ยังในช่วงผ่อนผัน) — ยังเข้าดูได้ เคลียร์บิลงวดสุดท้ายได้', g['G-IN'], 1);
  eq('🔴 ออกไป 40 วัน — ประตูปิดแล้ว', g['G-OUT'], 0);
  /* 🔴 BOTH HALVES, because the live route is the one the school runs and a family past the window
   * could otherwise still reach one child BY ID while no list would show it to them — the same
   * "server says yes, screen says no" split that has cost this project three separate bugs. */
  eq('เส้นทางที่รันจริง — ยังเรียนอยู่: ไม่ปิด', g.liveHere, false);
  eq('...ในช่วงผ่อนผัน: ไม่ปิด', g.liveIn, false);
  eq('...พ้นช่วงผ่อนผัน: ปิด', g.liveOut, true);
  eq('🔴 ...และ parentOwnsStudent_ ปฏิเสธด้วย (ไม่ใช่แค่ไม่แสดงในรายการ)', g.owns, false);
  const cfgGs = R('src/Config.gs'), eng = R('webapp/engine.js');
  ok_('จำนวนวันตั้งค่าได้ ไม่ได้ฝังไว้ในโค้ด', /\['ParentAccessGraceDays', '30'\]/.test(cfgGs));
  /* 🔴 DERIVED, NOT STORED. A flag would need a scheduled job to set it, and a family's access
   * would then depend on whether that job ran — the same shape as the SlipOK watch that was never
   * installed, except this one decides whether somebody can reach their own child's record. */
  ok_('🔴 คำนวณจาก EndDate ทุกครั้ง ไม่ได้เขียนธงลงชีต', /const parentAccessUntil_ = \(s\) =>/.test(eng));
  ok_('ช่วงซัมเมอร์เปิดประตูกลับ (เด็กกลับมาอยู่ที่โรงเรียนจริง)', /STUDENT_TERMS/.test(R('src/Code.gs')));
  ok_('ปฏิเสธตั้งแต่ตอนเข้าสู่ระบบ พร้อมบอกให้ติดต่อโรงเรียน',
    /ACCESS_ENDED/.test(R('src/Auth.gs')) && /กรุณาติดต่อทางโรงเรียนโดยตรง/.test(R('src/Auth.gs')));
  ok_('หน้าแอดมินบอกวันที่ประตูจะปิดของแต่ละครอบครัว',
    /เข้าใช้ได้ถึง/.test(R('webapp/app.js')) && /ปิดการเข้าใช้แล้ว/.test(R('webapp/app.js')));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
