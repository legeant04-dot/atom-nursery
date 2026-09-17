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
const app = R('webapp/app.js'), eng = R('webapp/engine.js'), css = R('webapp/styles.css');

console.log('\n1) The history is reachable from the screen that prompts the question');
{
  /* It was only ever on ดำเนินการ. Both entry points now exist — an admin thinking about OT money is
   * in การเงิน; an admin correcting a pick-up time is in ดำเนินการ. Neither is wrong. */
  /* Moved into the tab strip on 2026-09-17 at the school's request — same pill, same row, after
   * รอบบิล. It shipped for one version as a bare ⏰ to save a row on a 375px phone, and the school
   * asked the only question that matters about that: "ทำไมมีแต่ Icon ไม่มีชื่อเมนูว่าเมนูนี้คือเมนู
   * อะไร". The four pills beside it all say what they are; one that does not reads as decoration or
   * a bug. A control nobody can name is not a saving. */
  ok_('การเงิน has an OT-history button', /<button class="seg-open" onclick="A_studentOT\(\)">/.test(app));
  ok_('...and ดำเนินการ keeps the one it had', /OT รับช้า \(นักเรียน\)','A_studentOT\(\)/.test(app));
  ok_('...inside the tab strip, after รอบบิล',
    /tab\('cycle','📅',EN\(\)\?'Bill day':'รอบบิล'\)\}<button class="seg-open"/.test(app));
  ok_('...CARRYING ITS NAME, not an icon on its own',
    /⏰ \$\{EN\(\)\?'OT history':'ประวัติ OT'\}<\/button>/.test(app));
  /* IT SITS AMONG THE TABS BUT IS NOT ONE. The four real tabs switch what is drawn below and one is
   * always `active`; this opens a panel over the screen and leaves the active tab active. Now that
   * it is worded like them, the dashed edge is the only thing left carrying that difference. */
  ok_('...marked as an opener rather than a destination', /\.seg button\.seg-open\{border-style:dashed;/.test(css));
  ok_('...and never takes the active state', !/seg-open[^`]{0,80}active/.test(app));
  ok_('...without becoming a real tab, which would break "where am I"',
    !/A_finTab\('ot'/.test(app));

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

console.log('\n5) The month in one look, above the rows');
{
  // "รวมยอด OT ทั้งหมดที่ได้รับ จำนวนรายการทั้งหมด/อนุมัติ/ยกเลิก ไว้ด้านบนของข้อมูล" (2026-09-17)
  ok_('there is a summary, and it is above the list', /\$\{otSummary\}/.test(app) &&
    app.indexOf('${otSummary}') < app.indexOf('${rows.length?rows.map(row).join(\'\')'));
  ok_('money: charged, collected, still owed',
    /เรียกเก็บทั้งหมด', baht\(charged\)/.test(app) && /เก็บได้แล้ว', baht\(collected\)/.test(app) &&
    /ยังค้างชำระ', baht\(owed\)/.test(app));
  ok_('counts: all, paid, unpaid, cancelled',
    /รายการทั้งหมด', rows\.length/.test(app) && /ชำระแล้ว', nPaid/.test(app) &&
    /ค้างชำระ', nUnpaid\+nWait/.test(app) && /ยกเลิก', nCancel/.test(app));

  /* THE THREE MONEY RULES, each one a way a finance summary could lie.
   * A cancelled row was never billed, so it must not appear in the charge total. */
  ok_('cancelled rows are excluded from the charge total',
    /const live = rows\.filter\(o=>o\.status!=='CANCELLED'\);/.test(app) &&
    /charged=sum\(live,o=>o\.amount\)/.test(app));
  /* Only a PAID row is money in the bank. studentOtList carries no confirmed-amount field, so a
   * PARTIAL row cannot be valued — counting it as collected would overstate what came in, which is
   * the one direction this card must never be wrong in. */
  ok_('only fully-paid rows count as collected',
    /collected=sum\(byStatus\('PAID'\),o=>o\.amount\)/.test(app));
  ok_('...and part-paid rows are counted as owed, and said so out loud',
    /nPartial\?`<div[\s\S]{0,240}ชำระบางส่วน/.test(app));
  ok_('the confirmed amount really is absent from the row, so that caution is warranted',
    !/studentOtList: p =>[\s\S]{0,2000}confirmedPaid/.test(eng));
  // the school gives real discounts; the total goodwill is worth seeing, but only when there is some
  ok_('discounts given are totalled when there are any', /discount>0\?`<div[\s\S]{0,120}ส่วนลดที่ให้ไป/.test(app));
  ok_('an empty month draws no summary at all', /const otSummary = rows\.length \? /.test(app));
}

console.log('\n6) Tapping a number shows the rows behind it');
{
  // "กดรายการชำระแล้ว ให้ขึ้นมาว่ามีรายการไหนบ้าง / ค้างชำระมีรายการไหน / ยกเลิกมีรายการไหน" (2026-09-17)
  ok_('the four counts are buttons', /const fcell=\(k,lbl,val,col\)=>/.test(app) &&
    /fcell\('all'/.test(app) && /fcell\('paid'/.test(app) && /fcell\('unpaid'/.test(app) && /fcell\('cancelled'/.test(app));
  ok_('...and the list is filtered by the same predicate the number counts',
    /const shown=rows\.filter\(OT_FILTERS\[OT_FILT\]\|\|OT_FILTERS\.all\);/.test(app));
  /* THE NUMBER AND ITS LIST MUST NEVER DISAGREE. "ค้างชำระ" in the money row means everything not
   * fully paid — unpaid, awaiting check, AND part-paid — so the filter behind that number has to
   * mean the same three, or tapping 4 would show 3 rows and the screen would be lying. */
  ok_('unpaid means the same three states in the count and in the filter',
    /unpaid:\s+o => o\.status==='UNPAID' \|\| o\.status==='PENDING_VERIFY' \|\| o\.status==='PARTIAL',/.test(app) &&
    /fcell\('unpaid', EN\(\)\?'Unpaid':'ค้างชำระ', nUnpaid\+nWait\+nPartial/.test(app));
  ok_('the active filter is visible on the number itself', /aria-pressed="\$\{on\}"/.test(app));
  ok_('...and the list says how many of how many it is showing', /แสดง \$\{shown\.length\} จาก \$\{rows\.length\} รายการ/.test(app));
  /* A blank panel under a number that said 4 is how somebody decides the app is broken — which is
   * precisely how this screen came to attention two days ago. */
  ok_('an empty filter says so and offers the way back',
    /ไม่มีรายการในตัวกรองนี้/.test(app) && /onclick="A_otFilter\('all'\)"/.test(app));
  /* THE BATCH BUTTON CANCELS OT, SO IT IS MONEY. A_socToggleAll ticks `.sotoc` in the document, so
   * under a filter "select all" means the filtered set — right behaviour, wrong words. */
  ok_('"select all" says "shown" while a filter is on',
    /OT_FILT==='all'\?\(EN\(\)\?'Select all':'เลือกทั้งหมด'\):\(EN\(\)\?'Select all shown':'เลือกทั้งหมดที่แสดงอยู่'\)/.test(app));
  ok_('...and it really does only reach rendered rows',
    /document\.querySelectorAll\('\.sotoc:not\(\[disabled\]\)'\)/.test(app));
}

console.log(fail ? `\nFAILED ${pass} passed, ${fail} failed` : `\nALL PASS ${pass} checks`);
process.exit(fail ? 1 : 0);
