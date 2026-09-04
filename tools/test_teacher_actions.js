/**
 * tools/test_teacher_actions.js — the teacher's ✅ ดำเนินการ screen (was "ลางาน").
 *   node tools/test_teacher_actions.js
 *
 * Asked 2026-09-05. It was one long scroll carrying four unrelated things: the entitlement, the
 * leave form, the time-correction form, and — for a head teacher — two approval queues at the
 * BOTTOM, under three forms. On a phone that is why they sat unanswered.
 *
 * Now: [การลางาน | ขอลงเวลา] for the teacher's own business, plus [รออนุมัติ] for a head teacher
 * carrying a red count and holding all three queues (leave, time, injury), each with the month's
 * decided history folded underneath.
 *
 * TWO RULES THIS FILE EXISTS TO HOLD:
 *   1. the screen costs ONE Apps Script execution — every call in the same tick, no `if (isLeader)`
 *      gate in front of a fetch (an await ends the tick, and isLeader is only known after one)
 *   2. switching tabs does NOT refetch — it re-renders data already on the device
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), i18n = R('webapp/i18n.js');

// the screen body, from its comment banner to the end of the approve tab
const scr = app.slice(app.indexOf('SCREENS.Teacher.leave'), app.indexOf('function myLeaveRow'));

console.log('1) one screen, one execution');
{
  const load = app.slice(app.indexOf('SCREENS.Teacher.leave'), app.indexOf('window.TLV_tab'));
  eq('everything is fetched in a single Promise.all', (load.match(/Promise\.all/g) || []).length, 1);
  // one await, and it is that batch — anything awaited before it starts a second execution
  eq('...and nothing is awaited before it', (load.match(/=\s*await /g) || []).length, 1);
  ['leaveQuota', 'staffSelf', 'myLeaves', 'myTimeRequests', 'teamPendingLeaves', 'teamPendingTimeRequests', 'pendingInjuries']
    .forEach(a => ok_('  ' + a + ' rides in that one batch', load.indexOf("'" + a + "'") > 0));
  /* THE THREE TEAM QUEUES ARE NOT BEHIND `if (isLeader)`. isLeader comes from staffSelf, and an
   * await ends the tick — gating them would cost every head teacher a second round trip. The server
   * already answers [] for a plain teacher, which is where that decision belongs anyway. */
  ok_('the team queues are not gated on a value only an await can give us', !/if\s*\(\s*isLeader\s*\)[\s\S]{0,200}api\(/.test(load));
  ok_('...and one failing queue cannot empty the others', (load.match(/\.catch\(\(\)=>\[\]\)/g) || []).length >= 5);
}

console.log('\n2) the tabs');
{
  ok_('there is a leave tab, a time tab and an approvals tab',
    /tab\('leave',/.test(app) && /tab\('time',/.test(app) && /tab\('approve',/.test(app));
  ok_('...and each one is a button that calls TLV_tab', /onclick="TLV_tab\('\$\{k\}'\)"/.test(app));
  ok_('switching tabs re-renders, it does not refetch', /window\.TLV_tab=\(k\)=>\{\s*TLV_TAB=k;\s*TLV_render\(\);\s*\}/.test(app));
  ok_('the approvals tab is offered to head teachers only', /isLeader\?tab\('approve'/.test(app));
  ok_('...and carries the count as a red badge', /tab\('approve'[\s\S]{0,160}pill bad[\s\S]{0,40}\$\{pend\}/.test(app));
  ok_('the count is all three queues together', /const pend=d\.tpL\.length\+d\.tpT\.length\+d\.tpI\.length/.test(app));
  // a plain teacher who somehow lands on the approve tab must not be shown an empty leader screen
  ok_('a non-leader is put back on the leave tab', /TLV_TAB==='approve'\s*&&\s*!isLeader/.test(app));
  ok_('the screen is titled ดำเนินการ', /'title\.leave':\['✅ ดำเนินการ'/.test(i18n));
  ok_('...and so is the bottom-nav item', /'nav\.leave':\['ดำเนินการ'/.test(i18n));
}

console.log('\n3) the histories fold, and pick a month');
{
  ok_('there is one fold builder, not five', (app.match(/function TLV_fold\(/g) || []).length === 1);
  ok_('a fold carries a month picker', /function TLV_fold\([\s\S]{0,600}type="month"/.test(app));
  ok_('...and remembers whether it was open', /TLV_OPEN\[el\.id\]=el\.open/.test(app));
  /* WITHOUT THAT, every re-render snaps the fold shut — and a re-render is what a month change and
   * an approval both are. The teacher would open the history, pick a month, and watch it close. */
  ok_('the fold is rendered open when it was left open', /TLV_OPEN\[id\]\?' open':''/.test(app));
  ok_('the teacher\'s own two histories filter the month on the device', /function TLV_leaveTab[\s\S]{0,400}inMonth_/.test(app) && /function TLV_timeTab[\s\S]{0,400}inMonth_/.test(app));
  // they were already fetched with the screen; re-asking the server for a month of your own rows is
  // a round trip for data that is already here
  ok_('...without another round trip', !/function TLV_leaveTab[\s\S]{0,600}api\(/.test(app));
  ok_('a team history is fetched only when its fold is open', /if\(TLV_OPEN\.tlvTeamLv\) api\('teamLeaveHistory'/.test(app));
  ok_('...and opening one is what fetches it', /el\.open && el\.id\.indexOf\('tlvTeam'\)===0\) TLV_teamLoad/.test(app));
}

console.log('\n4) a row a person can read');
{
  ok_('a leave row spells the month out', /function myLeaveRow[\s\S]{0,700}longDate\(l\.StartDate\)/.test(app));
  ok_('...says how many days', /function myLeaveRow[\s\S]{0,700}lvDays\(l\.Days\)/.test(app));
  ok_('...names the document', /function myLeaveRow[\s\S]{0,700}l\.LeaveID/.test(app));
  ok_('...and shows the status as a pill', /function myLeaveRow[\s\S]{0,900}leaveStatusPill\(l\.Status\)/.test(app));
  ok_('a time row does the same', /function myTimeRow[\s\S]{0,500}longDate\(r\.Date\)/.test(app) && /function myTimeRow[\s\S]{0,700}timeReqStatusPill/.test(app));
  ok_('...and shows why it was refused, when it was', /function myTimeRow[\s\S]{0,700}r\.DecisionNote/.test(app));
  /* "ปฏิเสธ" is what you do to a person; "ไม่อนุมัติ" is what happens to a request. Asked for
   * 2026-09-05 ("สถานะให้ชัดเจน รออนุมัติ/ไม่อนุมัติ/อนุมัติ") — and the BUTTON now says the same
   * words as the status it produces, so nobody has to learn that one means the other.
   * verify.* is left alone: rejecting a payment slip is a different act with its own vocabulary. */
  ['s.rejected', 'att.st.REJECTED', 'ot.st.REJECTED', 'duty.rejected', 'c.reject', 'ot.reject']
    .forEach(k => ok_('  ' + k + ' reads ไม่อนุมัติ', new RegExp("'" + k.replace('.', '\\.') + "':\\['ไม่อนุมัติ'").test(i18n)));
}

console.log('\n5) the head teacher gets all three queues, each with its history');
{
  const ap = app.slice(app.indexOf('function TLV_approveTab'), app.indexOf('window.TLV_teamMonth'));
  ok_('leave is one section', /'tlvTeamLv'/.test(ap));
  ok_('time requests are another', /'tlvTeamTm'/.test(ap));
  ok_('injury reports are the third', /'tlvTeamInj'/.test(ap));
  ok_('an empty queue says so rather than showing nothing', /rows\.length\?html:none/.test(ap));
  ok_('a queue with work in it is counted in red', /rows\.length\?`<span class="pill bad">\$\{rows\.length\}/.test(ap));
}

console.log('\n6) the date format');
{
  const at = app.indexOf('function longDate(v)');
  const fn = at < 0 ? '' : app.slice(at, at + 400);
  ok_('there is one long-date formatter', at > 0 && (app.match(/function longDate\(/g) || []).length === 1);
  ok_('...the month is a word, so it cannot be read the wrong way round', /TH_MONTHS\[mo\]/.test(fn));
  ok_('...the day is padded, so a column of dates lines up', /p2\(d\.getDate\(\)\)/.test(fn));
  /* Buddhist year in Thai, Gregorian in English — the rule ddmmyyyy, fullDate and the payslip
   * period already follow. A second convention on one screen is worse than either. */
  ok_('...and the year follows the rest of the app', /y\+543/.test(fn));
}

console.log('\n7) the engine backs the head teacher history');
{
  const eng = R('webapp/engine.js');
  ok_('teamLeaveHistory exists', /teamLeaveHistory:\s*p\s*=>/.test(eng));
  ok_('...is refused to an ordinary teacher', /teamLeaveHistory[\s\S]{0,400}เฉพาะหัวหน้าครูหรือแอดมิน/.test(eng));
  ok_('...and catches a leave filed in one month and taken in another', /teamLeaveHistory[\s\S]{0,600}ym\(l\.StartDate\)===month\|\|ym\(l\.CreatedDate\)===month/.test(eng));
  // the GAS route has always stamped these; the engine never did, so anything decided in mock/test
  // showed a signature with no date
  ok_('the engine now stamps a leave decision like the live route does',
    /Step1Date=stampLocal\(\)/.test(eng) && /Step2Date=stampLocal\(\)/.test(eng));
}

console.log(fail ? `\nFAILED ${pass} passed, ${fail} failed` : `\nPASSED ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
