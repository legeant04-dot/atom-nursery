/**
 * tools/test_teacher_schedule_v243.js — the teacher's own screens: less on the home screen, and the
 * things they look up where they look them up.
 *   node tools/test_teacher_schedule_v243.js
 *
 * Three asked for together, all the same shape of decision — what belongs on a screen someone opens
 * every morning, and what belongs where they go when they have a question:
 *
 *   · OT วันหยุด is agreed by the Admin and announced once, in a notification that scrolls away.
 *     After that its only record was inside a payslip a teacher may not open for weeks. 📅 ตาราง is
 *     where they already check their own days, so it goes there — under the daily summary.
 *   · Approved leave (for coverage) was printed in full under that summary every single day. It is
 *     a "who am I covering for" reference, not a daily read: folded shut, with the count on the line
 *     so you can see whether it is worth opening.
 *   · The remaining-leave-days grid came off the home screen. It is a reference figure too, and it
 *     is still on the leave screen — where a teacher is actually deciding whether to file one.
 *
 * The rule none of them may break: what is REMOVED from a screen must still exist somewhere, and
 * the fetch that fed it must go with it (a call for a figure nobody displays is pure queue).
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
const app = R('webapp/app.js');
const home = app.slice(app.indexOf('SCREENS.Teacher.home = async () => {'), app.indexOf('SCREENS.Teacher.class'));
const sched = app.slice(app.indexOf('SCREENS.Teacher.schedule = async () => {'), app.indexOf('let MY_DAYS=[]'));
const leaveScr = app.slice(app.indexOf("SCREENS.Teacher.leave"), app.indexOf("SCREENS.Teacher.leave") + 3000);

console.log('\n1) my OT วันหยุด, under the daily summary in 📅 ตาราง');
{
  ok_('the schedule screen asks for my OT', /api\('myOT',\{staffId:USER\.staffId\}\)\.then\(rows=>\{/.test(sched));
  // v256: "a holiday OT that still counts" is one helper (isLiveHolOT) instead of the same pair of
  // string tests written out at four call sites
  ok_('...and keeps only the holiday ones that were not rejected', /\.filter\(isLiveHolOT\)/.test(sched));
  // the helper itself lives at the top of app.js, outside this screen's slice — which is the point
  ok_('...which is what isLiveHolOT means', /const isLiveHolOT = o => isHolOT\(o\) && String\(\(o && o\.Status\) \|\| ''\)\.toUpperCase\(\) !== 'REJECTED';/.test(app));
  /* v262: it MOVED OUT of the daily-summary card, and had to. A plain teacher does not get that card
   * any more (other people's working time is between them, the head teacher and the admin) — and
   * their own OT วันหยุด is theirs, so it must not disappear along with somebody else's day. */
  ok_('it is its own card, so it survives without the daily summary',
    /<div id="myHolOT"><\/div>/.test(sched) && !/<div id="myHolOT"><\/div><\/div>/.test(sched));
  ok_('...and is drawn as one', /setHTML\('#myHolOT', `<details class="card">/.test(app));
  ok_('...inside the same card as the summary', sched.indexOf('lbl.dailySummary') < sched.indexOf('id="myHolOT"'));
  ok_('each row shows the day, the reason and the amount', /<b>\$\{esc\(ddmmyyyy\(o\.Date\)\)\}<\/b>\$\{o\.Note\?/.test(sched) && /\$\{esc\(baht\(o\.Amount\)\)\}<\/b>/.test(sched));
  ok_('the summary line carries the count and the total', /🎉 \$\{EN\(\)\?'My holiday OT':'OT วันหยุดของฉัน'\} <span class="pill ok"[^>]*>\$\{hol\.length\}<\/span> <span class="muted"[^>]*>\$\{esc\(baht\(total\)\)\}/.test(sched));
  ok_('...and it says where the money turns up', /จ่ายเป็นบรรทัดแยกในสลิปเงินเดือน/.test(sched));
  // a teacher with none must not get an empty box in the way of the summary
  ok_('nothing is drawn at all when there is none', /if\(!hol\.length\) return;/.test(sched));
  // and it must never delay the screen
  ok_('it loads after the screen is drawn, not before', sched.indexOf('app.innerHTML=') < sched.indexOf("api('myOT'"));
  ok_('...and a failure to load it leaves the rest alone', /\}\)\.catch\(\(\)=>\{\}\);/.test(sched));
}

console.log('\n2) approved leave folds shut');
{
  ok_('it is a dropdown now', /<details style="margin-top:8px"><summary[^>]*>\$\{EN\(\)\?'Approved leave \(for coverage\)':'การลาที่อนุมัติแล้ว \(วางแผนสับเปลี่ยน\)'\}/.test(sched));
  ok_('...with the count on the line, so you can see if it is worth opening', /<span class="pill \$\{d\.leavesToday\.length\?'wait':'ok'\}"[^>]*>\$\{d\.leavesToday\.length\}<\/span>/.test(sched));
  ok_('the rows themselves are unchanged', /\$\{esc\(fullName\(l\.StaffID\)\)\} · \$\{esc\(tLeaveType\(l\.Type\)\)\}/.test(sched));
  ok_('...including the empty case', /\|\|`<small class="muted">\$\{esc\(t\('c\.noItems'\)\)\}<\/small>`\}<\/div><\/details>/.test(sched));
  ok_('it is NOT open by default', !/<details open style="margin-top:8px"><summary[^>]*>\$\{EN\(\)\?'Approved leave/.test(sched));
}

console.log('\n3) the home screen loses the remaining-days grid — and the call that fed it');
{
  ok_('the grid is gone', !/class="quota"/.test(home));
  ok_('...and so is the fetch', home.indexOf("api('leaveQuota'") < 0);
  eq('the batch is one call shorter', /const \[att,cl,me0raw,jstat,al\] = await Promise\.all\(/.test(home), true);
  ok_('the way IN to leave is still there', /onclick="GO\('leave'\)">📩/.test(home));
  ok_('...as a plain button, not a card of numbers', /<div class="card"><button class="btn sm outline block" onclick="GO\('leave'\)">/.test(home));
  ok_('the reason is written down where the code used to be', /it is on the leave screen itself where a teacher is actually\s+\n?\s*deciding whether to file one/.test(home) || /reference figure, not a morning job/.test(home));
}
{
  // the figure must still EXIST — removing it from home is a move, not a deletion
  ok_('the leave screen still shows the remaining days', /<h3>สิทธิคงเหลือ<\/h3><div class="quota">/.test(app));
  ok_('...and still fetches them there', /api\('leaveQuota',\{staffId:USER\.staffId\}\)/.test(leaveScr));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
