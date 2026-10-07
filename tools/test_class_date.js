/**
 * tools/test_class_date.js — the day the daily reports belong to.
 *   node tools/test_class_date.js
 *
 * Asked 2026-10-07: "ด้านบนทำเป็นฟังก์ชัน Calendar เลือกวัน/เดือน/ปี ของบันทึก เพื่อที่คุณครูจะสามารถ
 * ไปดูข้อมูลบันทึกย้อนหลังของนักเรียนได้" — and "กรอบของวันเกิดนักเรียนเดือนนั้นให้แยกลงมา".
 *
 * Looking back already existed: one child at a time, two taps inside the ⋯ menu. The question a
 * teacher actually has is "what did we send home on Friday" — a DAY, for the whole class.
 *
 * 🔴 THE DANGER IS NOT THE PICKER, IT IS EVERYTHING ELSE ON THE SCREEN.
 *
 * classList answers for TODAY whatever date the journals were asked for, so a row still carries
 * today's `inToday`, today's check-in time and today's DSPM reminder. Printed under last Friday's
 * heading, every one of those is a true fact stated as if it were about the wrong day — and the
 * check-in button would offer a back-dated punch the server then refuses. So most of this suite is
 * about what DISAPPEARS when a past day is on screen, not about what appears.
 */
const path = require('path'), fs = require('fs'), vm = require('vm');

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
const CLASS = app.slice(app.indexOf('SCREENS.Teacher.class = async () => {'),
                        app.indexOf('// Teacher files a leave for a student'));

const p2 = n => String(n).padStart(2, '0');
const DS = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const TODAY = DS(new Date());
const shift = n => { const d = new Date(); d.setDate(d.getDate() + n); return DS(d); };

// ============================================================================
console.log('\n1) 🔴 the picker itself, run rather than grepped');
{
  /* T_classDate decides what a typed or pasted value means. A <input max> stops the picker offering
   * tomorrow; it does not stop a value arriving any other way, and a future date would show a class
   * of empty reports with nothing saying why. Lifted out and run. */
  const src = appCode.slice(appCode.indexOf('window.T_classDate = (v) => {'),
                            appCode.indexOf('window.T_classDay = (step) => {') +
                            appCode.slice(appCode.indexOf('window.T_classDay = (step) => {')).indexOf('\n  window.') );
  const ctx = { window: {}, GO: () => {}, todayStr: () => TODAY,
                ymd: v => String(v == null ? '' : v).slice(0, 10), Date, String, Number };
  ctx.T_CDATE = '';
  vm.createContext(ctx);
  vm.runInContext('let T_CDATE="";' + src.replace(/window\./g, '') + '\nfunction peek(){return T_CDATE;}', ctx);

  const set = v => { ctx.T_classDate(v); return ctx.peek(); };
  eq('a past date is kept', set(shift(-3)), shift(-3));
  eq('🔴 today is stored as "" — the ordinary case carries no state', set(TODAY), '');
  eq('🔴 tomorrow is refused — there is no report for it', set(shift(1)), '');
  eq('🔴 ...and so is any later date', set(shift(90)), '');
  eq('rubbish is refused rather than shown as an empty day', set('not-a-date'), '');
  eq('an empty value means today', set(''), '');
  eq('last year still works — the picker is day/month/YEAR', set(shift(-400)), shift(-400));

  // ◀ / ▶ step one day, and ▶ cannot walk past today
  ctx.T_classDate(shift(-2)); ctx.T_classDay(1);
  eq('▶ steps one day forward', ctx.peek(), shift(-1));
  ctx.T_classDay(1);
  eq('🔴 ...and stepping onto today lands back on "today"', ctx.peek(), '');
  ctx.T_classDay(-1);
  eq('◀ from today goes to yesterday', ctx.peek(), shift(-1));
}

// ============================================================================
console.log('\n2) 🔴 what the screen stops showing on an earlier day');
{
  ok_('the screen knows which day it is on', /const onDay = \(T_CDATE && T_CDATE!==todayStr\(\)\)/.test(CLASS));
  ok_('🔴 journalStatus is asked for THAT day', /api\('journalStatus',onDay\?\{date:onDay\}:\{\}\)/.test(CLASS));

  /* 🔴 ...AND THE ATTENDANCE CHIP IS NOT. This is the one that would have shipped quietly: the chip
   * says "มา 08:02" from today's classList, and under Friday's heading that is a true sentence about
   * the wrong day. */
  ok_('🔴 today’s check-in chip is hidden', /\$\{onDay\?'':attTag\}/.test(CLASS));
  ok_('🔴 ...and so is the DSPM reminder', /\$\{\(!onDay&&due\)\?dspmDueBadge\(due\):''\}/.test(CLASS));
  ok_('🔴 ...and "not in today, by arrangement", which is also about today', /\$\{onDay\?'':offCard\}/.test(CLASS));

  // the row builder is told, and answers with a read-only pair
  ok_('the row builder is told which day it is drawing', /studentRowButtons\(s,jdone,onDay\)/.test(CLASS));
  const RB = appCode.slice(appCode.indexOf('function studentRowButtons(s, jdone, onDay){'),
                           appCode.indexOf('function studentRowButtons(s, jdone, onDay){') + 2000);
  ok_('🔴 a past day offers reading the report', /A_viewJournal\('\$\{s\.StudentID\}','\$\{esc\(onDay\)\}'\)/.test(RB));
  ok_('🔴 ...and says plainly when there is no report at all', /No report|ไม่มีบันทึก/.test(RB));
  ok_('🔴 ...and offers NO check-in — the server refuses a back-dated punch anyway',
    !/T_studentCheckin/.test(RB.slice(0, RB.indexOf('const jBtn'))));
  ok_('🔴 ...and no DSPM assessment, which is not about a date',
    !/T_assess/.test(RB.slice(0, RB.indexOf('const jBtn'))));
  /* ⋯ STAYS. Filing a leave, correcting a time and one child's own history are the things a teacher
   * wants precisely BECAUSE they are looking at an earlier day. */
  ok_('...but ⋯ stays, because that is why they came here', /T_stuMore/.test(RB.slice(0, RB.indexOf('const jBtn'))));

  /* CONTROL — TODAY IS UNTOUCHED. Every assertion above is about the past branch; a change that
   * broke the ordinary screen would pass all of them. */
  ok_('CONTROL · today still offers the journal button', /const jBtn = canJ/.test(RB));
  ok_('CONTROL · today still offers check-in and assessment',
    /T_studentCheckin/.test(appCode) && /T_assess\('\$\{s\.StudentID\}'\)/.test(appCode));
  ok_('CONTROL · today still shows the attendance chip at all', /attTag/.test(CLASS));
}

// ============================================================================
console.log('\n3) the bar reads as a date, and says when it is not today');
{
  ok_('🔴 it is a native day/month/year picker, not three selects', /<input type="date" id="tcDate"/.test(appCode));
  ok_('🔴 ...capped at today', /max="\$\{esc\(today\)\}"/.test(appCode));
  ok_('▶ is disabled while already on today', /\$\{onDay\?`onclick="T_classDay\(1\)"`:'disabled/.test(appCode));
  ok_('there is a one-tap way back', /Back to today|กลับมาวันนี้/.test(appCode));
  ok_('an earlier day is coloured, so the screen cannot be mistaken for today',
    /background:var\(--warn-bg\);border-color:var\(--warn-line\)/.test(appCode.slice(appCode.indexOf('function T_classDateBar'))));
  ok_('...and says in words that it is read-only', /กำลังดูบันทึกย้อนหลัง|Reading an earlier day/.test(app));
  /* IT DOES NOT REMEMBER. A date kept across navigations would have a teacher opening the app in the
   * morning onto last Tuesday and wondering why no button works. */
  ok_('🔴 the date starts empty on every load', /let T_CDATE='';/.test(appCode));
}

// ============================================================================
console.log('\n4) the birthday strip moved out from under the class tabs');
{
  const tabs = CLASS.indexOf('classSwitcher(cl)');
  const bar  = CLASS.indexOf('T_classDateBar(onDay)');
  const bday = CLASS.indexOf("+ bdayHtml");
  ok_('the date bar is what sits under the class tabs now', tabs < bar);
  ok_('🔴 ...and the birthday strip is below the children', bar < bday);
  /* WHY IT HAD TO MOVE: it carries its OWN ◀ ▶ month arrows. Two sets of arrows stacked one above
   * the other read as one control, and they do different things — one moves the DAY of the reports,
   * the other the MONTH of a birthday list. */
  ok_('...it still has its month arrows, which is the reason it could not stay', /T_bdayNav\(-1\)/.test(app));
  ok_('...and the strip still re-renders into its own box', /setHTML\('#tbday'/.test(app) && /id="tbday"/.test(CLASS));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
