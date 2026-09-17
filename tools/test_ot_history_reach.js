/**
 * tools/test_ot_history_reach.js — the OT history existed; nothing in การเงิน pointed at it.
 *   node tools/test_ot_history_reach.js
 *
 * WHY THIS FILE EXISTS. Asked 2026-09-17, with a screenshot of the การเงิน → รออนุมัติ tab:
 * "ประวัติ OT ที่ผู้ปกครองชำระมา สามารถตรวจสอบย้อนหลังได้ไหมว่าวันไหนมี OT เท่าไหร่ อนุมัติไปแล้ว
 * ยังไม่อนุมัติ · ในช่องเลือกวัน กดไปแล้วก็ไม่มีข้อมูลอะไรแสดงเพิ่มเติม".
 *
 * Both halves of that were already working, which is the interesting part:
 *
 *   · The history is complete. studentOtList returns every OT row for a month with its date,
 *     minutes late, hours, rate, full charge, discount and STATUS — unpaid / pending / partial /
 *     paid / cancelled — and A_studentOT draws it with a month picker.
 *   · The date field was doing its job. It records the day the money actually arrived, and it was
 *     the only control on the card that looked like it might open.
 *
 * The fault was that the history lived on ดำเนินการ while the person asking was standing in
 * การเงิน looking at an OT payment. Not finding it, they tapped the nearest thing that looked like
 * a disclosure control and concluded the screen was broken. A feature nothing points at is, from
 * where the user stands, a missing feature — so what this file protects is the POINTING.
 */
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), eng = R('webapp/engine.js');

console.log('\n1) The history is reachable from the screen that prompts the question');
{
  /* It was only ever on ดำเนินการ. Both entry points now exist — an admin thinking about OT money is
   * in การเงิน; an admin correcting a pick-up time is in ดำเนินการ. Neither is wrong. */
  ok_('การเงิน has an OT-history button', /ประวัติ OT นักเรียน','A_studentOT\(\)/.test(app));
  ok_('...and ดำเนินการ keeps the one it had', /OT รับช้า \(นักเรียน\)','A_studentOT\(\)/.test(app));
  /* A fifth tab would wrap on a 375px phone, and these open over the screen rather than replacing
   * it — so a tool row, the same component ดำเนินการ already uses. */
  ok_('...as a tool row, not a fifth tab',
    /\$\{opTools\(\[\['⏰',EN\(\)\?'Student OT history'/.test(app));

  /* THE TRAP THAT WAS NOT SHIPPED. "ประวัติการชำระเงิน" was the obvious button to put beside it —
   * and A_payLog() with no arguments takes its scope from parentScope(), which on an Admin session
   * carries neither uid nor parentId, so visibleStudents filters on `ParentID === undefined` and
   * returns nothing. It would have been an empty screen behind a promising label: the exact fault
   * being reported, in a new place. */
  ok_('no argument-less payment-log button was added beside it',
    !/'A_payLog\(\)'/.test(app));
  ok_('...and the reason is written down where the next person will look',
    /It needs a student picker first/.test(app));
  ok_('the shape that makes it empty is still true, so the note stays honest',
    /list = ids \? M\.students\.filter\(s=>ids\.indexOf\(s\.StudentID\)>=0\)\s*\n\s*: M\.students\.filter\(s=>s\.ParentID===p\.parentId\)/.test(eng));
}

console.log('\n2) From the OT being approved, straight to that month');
{
  ok_('a pending OT card carries a link to the history', /ดูประวัติ OT ทั้งเดือนนี้/.test(app));
  /* On the OT's OWN month, not today's. The payment is approved days after the pick-up — the report
   * that prompted this was an OT on the 16th being approved on the 17th, and in the last days of a
   * month that difference lands on the wrong page entirely. */
  ok_('...opening on the OT\'s month, taken from its own label',
    /const m=String\(x\.label\|\|''\)\.match\(\/\^\(\\d\{4\}-\\d\{2\}\)\/\);/.test(app) &&
    /A_otMonth\('\$\{m\?m\[1\]:monthStr\(\)\}'\)/.test(app));
  ok_('...and only on an OT card', /if\(x\.kind!=='ot'\) return '';/.test(app));
  // the label it parses is built server-side as `<date> OT` — if that changes, the month is wrong
  ok_('the label really starts with the date', /add\('ot', o, o\.OTID, Number\(o\.Amount\|\|0\), o\.Date\+' OT'\)/.test(eng));
}

console.log('\n3) The date field says what it is for');
{
  /* Chrome on Android draws an <input type=date> with a chevron that reads as "expand", and this one
   * sat directly above the slip. It was tapped for history and gave a calendar. */
  ok_('it explains that it records the day the money arrived',
    /วันที่เงินเข้าจริง — จะถูกบันทึกในใบเสร็จและรายงานประจำเดือน/.test(app));
  ok_('...and says when the date came from the slip', /\(อ่านจากสลิป\)/.test(app));
  /* The case in the report: SlipOK returned ตรวจไม่ผ่าน, so no transaction date was extracted and
   * the field silently fell back to today. That is exactly when the admin is the one deciding the
   * date and most needs to be told — the old markup showed a hint only in the OTHER case. */
  ok_('...and says so when it could not be', /\(อ่านจากสลิปไม่ได้ — ตรวจสอบเอง\)/.test(app));
  ok_('it still defaults to the slip\'s date when there is one',
    /value="\$\{\(x\.slips&&x\.slips\[0\]&&\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\/\.test\(x\.slips\[0\]\.transDate\|\|''\)\)\?esc\(x\.slips\[0\]\.transDate\.slice\(0,10\)\):todayStr\(\)\}"/.test(app));
  /* A_confirmSlip reads the date back out of the card by querySelector — if the field stops being an
   * input[type=date], or moves out of that container, the confirm silently records today instead. */
  ok_('...and the confirm still reads it back from the same container',
    /const d=card&&card\.parentElement\?card\.parentElement\.querySelector\('input\[type=date\]'\):null;/.test(app));
}

console.log('\n4) The history answers the question that was actually asked');
{
  // "วันไหนมี OT เท่าไหร่ อนุมัติไปแล้ว ยังไม่อนุมัติ"
  ok_('every row carries its date', /return \{ otId:o\.OTID, date:o\.Date,/.test(eng));
  ok_('...its amount', /amount:Number\(o\.Amount\|\|0\),/.test(eng));
  ok_('...and its status', /status:o\.Status\|\|'UNPAID',/.test(eng));
  ok_('the screen turns that status into words an admin reads',
    /UNPAID:EN\(\)\?'unpaid':'ค้างชำระ'/.test(app) && /PAID:EN\(\)\?'paid':'ชำระแล้ว'/.test(app) &&
    /PENDING_VERIFY:EN\(\)\?'pending':'รอตรวจ'/.test(app));
  ok_('...and the month is selectable, so "ย้อนหลัง" means any month',
    /<input type="month" value="\$\{month\}" onchange="A_otMonth\(this\.value\)"\/>/.test(app));
  ok_('...with the rows newest first', /\.sort\(\(a,b\)=>String\(b\.Date\)\.localeCompare\(String\(a\.Date\)\)\)/.test(eng));
}

console.log(fail ? `\nFAILED ${pass} passed, ${fail} failed` : `\nALL PASS ${pass} checks`);
process.exit(fail ? 1 : 0);
