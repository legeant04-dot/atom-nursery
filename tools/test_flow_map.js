/**
 * tools/test_flow_map.js — the flow map must describe the app, not its own parser.
 *   node tools/test_flow_map.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 WHY THIS SUITE EXISTS, WRITTEN THE DAY THE TOOL WAS.
 *
 * tools/map_flows.js reported **14 faults** on its first run. Every one was checked by hand and
 * every one was the parser, not the app:
 *
 *   ① two screens declared on ONE line — only the first was read, so four Admin screens looked
 *      like they navigated to screens Admin does not have, on the same line that gives Admin them
 *   ② a screen's span ran to the NEXT screen, so ~300 lines of shared helpers parked in between
 *      were attributed to whatever screen happened to sit above them
 *   ③ counting parens as well as braces ended every screen on its own first line
 *      (`async (pre) =>` closes before the body opens) — 52 edges collapsed to 4
 *   ④ a one-line screen with no braces adopted the NEXT function's body
 *   ⑤ shared handlers were followed across roles, so `A_viewInjury`'s GO('injuries') was blamed
 *      on the teacher's screen
 *   ⑥ reachability was asked per-screen, which called the slip queue unreachable while a bell
 *      notification opens it daily
 *   ⑦ only buttons were followed, never plain delegation — so every screen that hands off to a
 *      render function (`P_journal(...)`) reported no data and no buttons at all
 *
 * A map that cries wolf is a map nobody opens. So this suite does not check "findings == 0" — that
 * would just pin today's answer. It checks that the parser still understands the SHAPES above, by
 * asserting facts about the app that are independently true.
 */
const path = require('path'), fs = require('fs'), cp = require('child_process');
let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const ROOT = path.join(__dirname, '..');
const out = cp.execSync('node ' + JSON.stringify(path.join(__dirname, 'map_flows.js')) + ' --json',
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });
const M = JSON.parse(out);
const S = (role, name) => M.screens.find(s => s.role === role && s.name === name);

console.log('\n1) 🔴 อ่านหน้าจอครบ — รวมสองหน้าที่ประกาศอยู่บรรทัดเดียวกัน');
{
  ok_('เจอหน้าจอมากกว่า 20 หน้า', M.summary.screens > 20);
  /* ① `SCREENS.Teacher.absence = absenceScreen; SCREENS.Admin.absence = absenceScreen;` */
  ok_('🔴 absence มีทั้งฝั่งครูและฝั่งแอดมิน (ประกาศอยู่บรรทัดเดียวกัน)',
    !!S('Teacher', 'absence') && !!S('Admin', 'absence'));
  eq('Role ที่มีแถบล่าง', Object.keys(M.navs).sort(), ['Admin', 'Observer', 'Parent', 'Teacher']);
  eq('Observer มี 4 ปุ่ม (ไม่มี "จัดการ" เพราะทุกเครื่องมือในนั้นมีไว้แก้ของ)', M.navs.Observer.length, 4);
}

console.log('\n2) 🔴 ขอบเขตของหน้าจอ — ไม่กินโค้ดของเพื่อนบ้าน และไม่จบก่อนเริ่ม');
{
  /* ③ if parens were counted again, every screen would be ~1 line and this collapses */
  ok_('มีเส้นทางเดินระหว่างหน้ามากกว่า 20 เส้น (ถ้านับวงเล็บด้วย ตัวเลขนี้จะเหลือหลักหน่วย)',
    M.summary.navigationEdges > 20);
  /* ② the chat screen is small; if it swallowed the helpers after it, it would claim many edges */
  const chat = S('Admin', 'chat');
  ok_('🔴 หน้าแชทของแอดมินไม่ได้กลืนฟังก์ชันที่อยู่ถัดไป', chat && chat.go.length <= 2);
  /* ④ a one-line screen keeps to its one line */
  const inj = S('Admin', 'injuries');
  ok_('🔴 หน้าที่เขียนบรรทัดเดียว ไม่ไปยืมร่างฟังก์ชันถัดไป', inj && inj.lines === 1);
}

console.log('\n3) 🔴 ตามการมอบงานต่อ — ทั้งปุ่มและการเรียกตรง');
{
  /* ⑦ Parent.journal is one line that calls P_journal; the routes belong to the screen */
  const j = S('Parent', 'journal');
  ok_('🔴 หน้าบันทึกของผู้ปกครองรู้ว่าตัวเองขอข้อมูลอะไรบ้าง แม้ตัวมันเองยาวบรรทัดเดียว',
    j && j.api.includes('getJournal') && j.api.includes('journalHistory'));
  const home = S('Parent', 'home');
  ok_('หน้าแรกของผู้ปกครองขอ parentHome และ parentChildren',
    home && home.api.includes('parentHome') && home.api.includes('parentChildren'));
  ok_('ตามฟังก์ชันไปแล้วมากกว่า 100 ตัว', M.summary.handlersFollowed > 100);
}

console.log('\n4) 🔴 ไม่ข้าม Role — ตัวช่วยที่ใช้ร่วมกันไม่ลากปลายทางของอีก Role มาด้วย');
{
  /* ⑤ A_viewInjury ends with GO('injuries'); following it from the teacher's screen was the bug */
  const ti = S('Teacher', 'injury');
  ok_('🔴 หน้าอุบัติเหตุของครู ไม่ได้ถูกกล่าวหาว่าพาไปหน้าของแอดมิน',
    ti && !ti.go.includes('injuries'));
  const cross = M.findings.filter(f => f.kind === 'GO_TO_SCREEN_THIS_ROLE_DOES_NOT_HAVE');
  eq('ไม่มีเส้นทางข้าม Role เหลืออยู่', cross.map(f => f.role + ':' + f.from + '→' + f.to), []);
}

console.log('\n5) 🔴 "เข้าไม่ได้" ต้องแปลว่าเข้าไม่ได้จริง');
{
  /* ⑥ the notification router opens the slip queue; it lives in no screen's body */
  const orphan = M.findings.filter(f => f.kind === 'NO_WAY_IN_AT_ALL');
  eq('ไม่มีหน้าจอที่เข้าไม่ถึงเลย', orphan.map(f => f.role + ':' + f.screen), []);
  /* and the deliberate redirect is DECLARED, not quietly matched away */
  const src = fs.readFileSync(path.join(__dirname, 'map_flows.js'), 'utf8');
  ok_('ทางเปลี่ยนเส้นทาง (redirect) ถูกประกาศเป็นข้อยกเว้นพร้อมเหตุผล',
    /A REDIRECT IS NOT AN ORPHAN/.test(src) && /back button/.test(src));
}

console.log('\n6) 📋 ฝั่งเซิร์ฟเวอร์ — รากฐานของ Operation System');
{
  ok_('อ่าน route ฝั่งเซิร์ฟเวอร์ได้มากกว่า 100 ตัว', M.summary.routesOnServer > 100);
  ok_('อ่าน route ใน engine ได้มากกว่า 200 ตัว', M.summary.routesInEngine > 200);
  ok_('รู้ว่า route ไหนแอดมินเท่านั้น', M.summary.adminOnlyRoutes > 50);
  const unknown = M.findings.filter(f => f.kind === 'CLIENT_CALLS_UNKNOWN_ROUTE');
  eq('🔴 ไม่มีหน้าจอไหนเรียก route ที่ไม่มีอยู่จริง', unknown.map(f => f.route), []);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
