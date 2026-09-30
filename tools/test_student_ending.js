/**
 * tools/test_student_ending.js — who still needs next month's bill.
 *   node tools/test_student_ending.js
 *
 * Asked 2026-09-30: "เคสนี้คือ ผอ. ไม่ทราบเลยว่าต้องออกบิลเดือนใหม่ให้ใคร และไม่ต้องออกให้ใคร เลยต้อง
 * แสดงข้อมูลนี้ด้วย ลาชั่วคราวด้วยเช่นกัน".
 *
 * Three records decide it — a prepayment, a last day and a temporary leave — and only the first of
 * them said anything on the screen where bills are issued. The other two were in the sheet, on the
 * row, already fetched, and never printed. So the answer was being worked out from memory once a
 * month, which is a way of being wrong about money on a schedule.
 *
 * THE WHOLE SUITE IS ABOUT A BOUNDARY. "Leaves on the 1st" and "left on the 30th" are one day apart
 * and opposite answers, so §1 spends its time there rather than in the middle of a month. The
 * school's rule: a child leaving DURING a month still owes that month.
 *
 * And one thing this must NOT do — the school was asked directly (2026-09-30) and chose
 * "แสดงป้ายอย่างเดียว ยังติ๊กได้": unlike a prepaid month, which the server refuses outright, a final
 * bill after the last day is sometimes exactly what the ผอ. means to issue. §3 is the control that
 * keeps the badge from quietly becoming a lock.
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
const app = R('webapp/app.js'), engine = R('webapp/engine.js');
const appCode = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ============================================================================================
console.log('1) the badge on the bill screen — measured against the month in the picker');
// ============================================================================================
{
  /* icRows lifted out of app.js and run for real: this is the function that decides what the ผอ.
   * reads next to a checkbox, and re-typing it here would test a copy that cannot go stale. */
  const src = /function icRows\(students, by, month\)\{[\s\S]*?\n  \}/.exec(app);
  ok_('icRows is defined and takes the month', !!src);
  const rows = new Function('EN', 'esc', 'nm', 'dispNick', 'monthStr', 'fullDate',
    src[0] + '\n return icRows;')(
    () => true, s => String(s), s => s.NameTH || '', s => s.Nickname || '', () => '2026-10',
    d => String(d));

  const stu = (id, extra) => Object.assign({ StudentID: id, NameTH: 'ด.ช. ' + id, Nickname: id, Class: 'Nursery 1' }, extra || {});
  const html = (list, by, month) => rows(list, by || {}, month);
  const rowFor = (s, month, by) => {
    const h = html([s], by, month);
    const m = /<label[\s\S]*?<\/label>/.exec(h);
    return m ? m[0] : '';
  };

  // โตเกียว's real case from the screenshot: last day 2026-10-01
  const tokyo = stu('tokyo', { endDate: '2026-10-01', endScheduled: true });

  eq('SEPTEMBER — still here all month, so it is an ordinary bill',
    /leaving/.test(rowFor(tokyo, '2026-09')) && !/last month|already left/.test(rowFor(tokyo, '2026-09')), true);
  /* 🔴 THE BOUNDARY. The last day is the 1st, so October is the month they leave DURING — and the
   * school's rule is that the month they leave in is still owed. "already left" here would tell the
   * ผอ. not to issue a bill the family is due to receive. */
  eq('🔴 OCTOBER — they leave on the 1st, so it is the LAST month to bill',
    /last month/.test(rowFor(tokyo, '2026-10')), true);
  eq('...and October is not reported as already gone',
    /already left/.test(rowFor(tokyo, '2026-10')), false);
  eq('NOVEMBER — after the last day, so do not bill',
    /already left/.test(rowFor(tokyo, '2026-11')), true);

  // ...and the other side of the same boundary: a last day on the 31st
  const latey = stu('latey', { endDate: '2026-10-31', endScheduled: true });
  eq('a last day on the 31st is still that month’s bill',
    /last month/.test(rowFor(latey, '2026-10')), true);
  eq('...and November is after it', /already left/.test(rowFor(latey, '2026-11')), true);

  // a pause covering the whole month is what issueBill refuses; a part-month pause is billed in full
  const away = stu('away', { paused: true, pauseFrom: '2026-10-01', pauseTo: '2026-10-31' });
  eq('🔴 a pause covering the whole month says do not bill',
    /on leave all month/.test(rowFor(away, '2026-10')), true);
  const half = stu('half', { paused: true, pauseFrom: '2026-10-10', pauseTo: '2026-10-20' });
  eq('🔴 ...and a part-month pause says the opposite, because the school still charges it',
    /away part of the month/.test(rowFor(half, '2026-10')), true);
  eq('a pause in another month says nothing at all',
    /leave|away/.test(rowFor(half, '2026-12')), false);
  const openEnded = stu('openEnded', { paused: true, pauseFrom: '2026-09-01', pauseTo: '' });
  eq('a pause with no return date covers the month too',
    /on leave all month/.test(rowFor(openEnded, '2026-10')), true);

  // the prepay badge is unchanged and still wins — it is the one the server actually enforces
  const pre = stu('pre', { endDate: '2026-12-31', endScheduled: true });
  const h = rowFor(pre, '2026-10', { pre: { index: 2, months: 6, left: 5 } });
  eq('a prepaid child still shows the prepay badge', /prepaid/.test(h), true);
  eq('...and is still the disabled one', /disabled/.test(h), true);
  eq('an ordinary child has no badge and no lock',
    /prepaid|leaving|leave|disabled/.test(rowFor(stu('plain'), '2026-10')), false);
}

// ============================================================================================
console.log('2) the summary screen — three groups, one question');
// ============================================================================================
{
  ok_('it is on ดำเนินการ › นักเรียน, beside the other student tools',
    /A_studentReport\(\)'\],[\s\S]{0,400}'A_studentStatus\(\)'\]/.test(appCode));
  ok_('A_studentStatus is defined', /window\.A_studentStatus = async/.test(appCode));
  ok_('it asks for both facts in one tick, not one after the other',
    /Promise\.all\(\[\s*\n?\s*api\('endingStudents'\)[^\n]*api\('pausedStudents'\)/.test(appCode));
  ok_('neither is allowed to take the screen down',
    /api\('endingStudents'\)\.catch\(\(\)=>\[\]\), api\('pausedStudents'\)\.catch\(\(\)=>\[\]\)/.test(appCode));

  const r = /function A_sstRender\(keep\)\{[\s\S]*?\n  \}/.exec(app);
  ok_('A_sstRender is defined', !!r);
  const render = r ? r[0] : '';
  ok_('🎓 the ones still to come are their own group', /const soon = SST\.ending\.filter\(r=>!r\.ended\)/.test(render));
  ok_('🏁 ...and the ones already finished are another', /const gone = SST\.ending\.filter\(r=>r\.ended\)/.test(render));
  ok_('🏖️ ...and temporary leave is the third, on the same screen', /const away = SST\.paused/.test(render));
  /* THE POINT OF THE SCREEN. A date leaves the arithmetic to be done at the desk, which is what
   * went wrong — every row says what it means for the month being billed, in words. */
  ok_('🔴 every ending row says what to do about the bill', /\$\{billVerdict\(r\.endDate\)\}/.test(render));
  ok_('🔴 every pause row does too', /\$\{pauseVerdict\(p\)\}/.test(render));
  ok_('...and the verdicts follow the MONTH PICKER, not today',
    /A_sstMonth\(this\.value\)/.test(render) && /const mStart = M \+ '-01'/.test(render));
  ok_('the same "leaves during the month" rule as the badge', /if\(end <= mEnd\)/.test(render));
  ok_('a pause covering the whole month is the only one told not to bill',
    /const whole = from && from <= mStart && \(!to \? true : to >= mEnd\)/.test(render));
  ok_('a return date that has passed is surfaced, not left to rot', /p\.due\?/.test(render));
  ok_('...and a pause recorded but not started says the child is here today', /p\.scheduled/.test(render));
  /* 🔴 CAUGHT BY READING THE CACHE, NOT THE SCREEN: A_studentForm reads A_CACHE.students, which this
   * screen never fills and which EXCLUDES children who have already finished — so the group most
   * likely to be tapped from here would have opened a blank new-student form. */
  ok_('🔴 tapping a row opens the profile by id, which works for a child who has left',
    /A_sstOpen = \(sid\) =>[\s\S]{0,120}STU_profile\(sid\)/.test(appCode));
  ok_('...and not the roster-cached form', !/A_sstOpen[\s\S]{0,120}A_studentForm/.test(appCode));
  // reopening would collapse the sections and jump back to the top — same shape as A_otWaiveRender
  ok_('changing the month redraws in place instead of reopening the modal',
    /document\.querySelector\('\.modal \.sheet'\)/.test(render) && /if\(keep && open\)\{ open\.innerHTML=html;/.test(render));
}

// ============================================================================================
console.log('3) 🔴 CONTROL — the badge must not become a lock');
// ============================================================================================
{
  /* Put to the school on 2026-09-30 and answered "แสดงป้ายอย่างเดียว ยังติ๊กได้". A prepaid month is
   * refused by issueBill (PREPAID_MONTH), so a tickable box there would be a lie and the checkbox is
   * disabled. A last day is different: issuing a final bill after it is a thing the ผอ. does on
   * purpose. If someone later "tidies" this by disabling the row, the school loses the ability to
   * bill a leaver at all — silently, because the box simply stops responding. */
  const src = /function icRows\(students, by, month\)\{[\s\S]*?\n  \}/.exec(app)[0];
  const dis = src.match(/disabled/g) || [];
  eq('there is exactly one disabling condition in the row', dis.length, 1);
  ok_('...and it is the prepay one', /\$\{pi\?' disabled':''\}/.test(src));
  ok_('the end date and the pause only ever produce a tag', !/end[\s\S]{0,200}disabled/.test(src));

  /* ...and the server side of the same decision: issueBill must NOT have grown an EndDate refusal,
   * or the tickable box would fail on submit and the badge would be a lock after all. */
  const ib = /issueBill: p => \{[\s\S]*?return b; \},/.exec(engine)[0];
  ok_('issueBill still refuses a prepaid month', /PREPAID_MONTH/.test(ib));
  ok_('...and a pause covering the whole month', /STUDENT_PAUSED/.test(ib));
  ok_('🔴 ...and does NOT refuse a child past their last day', !/ENDED|endedBeforeMonth_|studentEnded_/.test(ib));

  // measured, not just read: a bill for the month after the last day still goes through
  const M = {
    students: [{ StudentID: 'S1', NameTH: 'โตเกียว', Nickname: 'โตเกียว', Class: 'Nursery 2', Status: 'ACTIVE',
                 Plan: 'full', StartDate: '2024-01-01', EndDate: '2026-10-01' }],
    payments: [], studentCharges: [], prepayments: [], paymentSlips: [], otDaily: [],
    parents: [], staff: [], activityLog: [], userLinks: [],
    config: { Plans: [{ id: 'full', labelTH: 'เต็มเดือน', price: 6900, start: '07:00', end: '17:00' }] }
  };
  const H = createAtomAPI(M).H;
  const b = H.issueBill({ studentId: 'S1', month: '2026-11' });
  ok_('🔴 CONTROL — a final bill after the last day is still issued when asked', !!b && Number(b.Amount) > 0);
}

// ============================================================================================
console.log('4) the two facts the screens read were already there');
// ============================================================================================
{
  const M = {
    students: [
      { StudentID: 'A', NameTH: 'ก', Nickname: 'ก', Status: 'ACTIVE', Class: 'N1', EndDate: '2030-01-31' },
      { StudentID: 'B', NameTH: 'ข', Nickname: 'ข', Status: 'ACTIVE', Class: 'N1', EndDate: '2020-01-31' },
      { StudentID: 'C', NameTH: 'ค', Nickname: 'ค', Status: 'PAUSED', Class: 'N2', PauseFrom: '2020-01-01', PauseTo: '2030-01-01' },
      { StudentID: 'D', NameTH: 'ง', Nickname: 'ง', Status: 'ACTIVE', Class: 'N2' }
    ],
    payments: [], studentCharges: [], prepayments: [], paymentSlips: [], otDaily: [],
    parents: [], staff: [], activityLog: [], userLinks: [], plans: [], config: {}
  };
  const H = createAtomAPI(M).H;
  const ending = H.endingStudents();
  eq('endingStudents carries both the coming and the gone', ending.map(x => x.studentId).sort(), ['A', 'B']);
  eq('...and says which is which', ending.filter(x => x.ended).map(x => x.studentId), ['B']);
  eq('pausedStudents carries the third group', H.pausedStudents().map(x => x.studentId), ['C']);
  /* THE REASON THE BADGE COSTS NO REQUEST: the bill modal's own list already carries these. */
  const ls = H.listStudents();
  const a = ls.find(x => x.StudentID === 'A');
  eq('listStudents already returns the last day, so the badge needs no extra call', a.endDate, '2030-01-31');
  eq('...and says it has not arrived yet', a.endScheduled, true);
  eq('...and a child with no date has none of it', !!ls.find(x => x.StudentID === 'D').endDate, false);
  /* ...and the one that makes the "already left" badge rare rather than common: a child who has
   * finished is off this roster entirely, so the bill screen never offers them in the first place.
   * The badge is for the month picker being moved FORWARD past a date still in the future. */
  eq('a child who has already finished is not on the bill screen’s roster at all',
    !!ls.find(x => x.StudentID === 'B'), false);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
