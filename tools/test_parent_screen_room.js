/**
 * tools/test_parent_screen_room.js — the parent's screens, and what is worth the room they take.
 *   node tools/test_parent_screen_room.js
 *
 * ASKED 2026-08-25, four things, all about a phone screen being finite:
 *
 *  · 📒 บันทึก — the history was every journal the child has ever had, in one list. A family a year
 *    in scrolls past three hundred rows to reach last Tuesday. A month at a time now, defaulting to
 *    THIS month, with only the months that actually have entries in the dropdown.
 *
 *  · 💉 บันทึกวัคซีน and 📜 ผลย้อนหลัง — both opened at full height. Thirty vaccine rows and every
 *    age band the child has ever been assessed in, between a parent and the thing they came to see.
 *    They are REFERENCES, read a few times a year. Folded, with a count on the summary line so it is
 *    worth opening or it is not.
 *
 *  · The check-in buttons say WHERE they work from. Drop-off is allowed from anywhere — a parent who
 *    forgot at the gate can tap it from the car, and many did not know. Pick-up is fenced, because it
 *    is a safety record and it starts the late-pickup charge. Both halves in one line, or the half
 *    people remember is the wrong one.
 */
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), par = R('src/Parent.gs');

console.log('\n1) the journal history is a month at a time');
{
  ok_('there is a month dropdown', /<select id="pjMonth" onchange="P_jHistFilter\(\)"/.test(app));
  ok_('...defaulting to this month', /m===monthStr\(\)\?' selected':''/.test(app));
  ok_('...offering only months that have entries', /\[\.\.\.new Set\(\(hist\|\|\[\]\)\.map\(h=>ym\(h\.Date\)\)\)\]/.test(app));
  ok_('...newest first, because that is what is being looked for', /\.sort\(\)\.reverse\(\)/.test(app));
  ok_('the list is filtered, not re-fetched', /window\._PJ_HIST=hist\|\|\[\];/.test(app));
  /* A CHILD WHOSE ENTRIES ARE ALL IN PAST MONTHS would otherwise land on an empty screen and look
   * broken — a family who joined in July, opening this in September. Fall back to the newest month
   * that HAS something rather than showing nothing. */
  ok_('a child with nothing this month falls back to their newest month',
    /if\(m && !all\.some\(h=>ym\(h\.Date\)===m\)\)\{ m=\[\.\.\.new Set\(all\.map\(h=>ym\(h\.Date\)\)\)\]\.sort\(\)\.pop\(\)\|\|''/.test(app));
  ok_('...and an empty month says so rather than going blank', /เดือนนี้ยังไม่มีบันทึก/.test(app));
  ok_('dates are printed the way the rest of the app prints them', /esc\(ddmmyyyy\(h\.Date\)\)/.test(app));
}

console.log('\n2) the two reference lists are folded away');
{
  const vac = app.slice(app.indexOf('function vaccineCard(sched, recs, sid, editable){'),
    app.indexOf('// inline SVG line chart'));
  ok_('the vaccine card is a <details> for a parent', /<details class="card" id="vaccard"/.test(vac));
  ok_('...with how many doses are recorded on the line', /<span class="pill \$\{done\?'ok':'wait'\}"[^>]*>\$\{done\}\/\$\{all\}/.test(vac));
  ok_('...while the ADMIN form stays open, because filling it in is the whole point of that screen',
    /if\(!editable\)\{/.test(vac) && /<div class="card" id="vaccard"/.test(vac));
  ok_('earlier DSPM bands are folded too', /<details class="card"><summary style="cursor:pointer;font-weight:700">📜/.test(app));
  ok_('...with the number of bands on the line', /\$\{past\.length\} \$\{EN\(\)\?'band\(s\)':'ช่วงวัย'\}/.test(app));
  ok_('nothing is folded when there is nothing to fold', /\$\{past\.length\?`<details/.test(app));
}

console.log('\n3) the buttons say where they work from — and it matches the server');
{
  ok_('drop-off: from anywhere', /กดได้จากทุกที่ ทุกเวลา ไม่ต้องอยู่ที่โรงเรียน/.test(app));
  ok_('pick-up: at the school', /กดตอนที่มาถึงโรงเรียนแล้ว/.test(app));
  ok_('...in English too', /tap from anywhere, any time\./.test(app) && /tap when you are at the school\./.test(app));
  ok_('it sits with the buttons, where the thumb already is',
    app.indexOf("P_punch('${k.StudentID}','OUT',this)") < app.indexOf('กดได้จากทุกที่ ทุกเวลา'));
  /* AND IT IS TRUE. Parent.gs fences OUT and lets IN through from anywhere; a note that promised the
   * wrong one would be worse than no note, because somebody would rely on it at 7am in a car park. */
  ok_('the server really does fence only the pick-up', /if \(type === 'OUT'\) \{\s*\n\s*try \{\s*\n\s*dist = assertWithinGeofence_/.test(par));
  ok_('...and really does take a drop-off from anywhere', /\} else \{\s*\n\s*dist = geoDistanceSafe_\(payload\.lat, payload\.lng\);/.test(par));
  ok_('...which is what the client does as well', /if\(type==='OUT'\)\{ \(\{lat,lng,acc\}=await getPosition\(\)\); \}/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
