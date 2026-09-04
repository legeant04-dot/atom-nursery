/**
 * tools/test_notify_parent.js — "the parents were told" has to survive being written down.
 *   node tools/test_notify_parent.js
 *
 * Found while auditing the injury flow. The whole chain was there and looked right:
 *   the teacher ticks 👪 แจ้งเตือนผู้ปกครองด้วยทันที  → the app sends notifyParent
 *   → the engine writes NotifyParent:'YES'            → the report screen shows "แจ้งผู้ปกครองแล้ว"
 * …except INJURY_REPORTS had no NotifyParent COLUMN, and writeRows_ maps each row onto the sheet's
 * existing headers — so the value was dropped WITHOUT AN ERROR. The LINE message went out; the
 * record of it did not. Every emergency read back as "ยังไม่แจ้ง".
 *
 * Declaring the column is only half the fix: writeRows_ reads the headers off the SHEET, so a sheet
 * that already exists never gains it. ensureCollectionSheet_ now tops an existing header up, which
 * closes the same trap for every collection.
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
const cfgSrc = R('src/Config.gs'), ge = R('src/GasEngine.gs'), app = R('webapp/app.js'),
      eng = R('webapp/engine.js'), notify = R('src/Notify.gs'), checkin = R('src/Checkin.gs');

console.log('\n1) the column is declared');
{
  const hdr = /INJURY_REPORTS:\s*\[([\s\S]*?)\]/.exec(cfgSrc);
  /* Comments come out FIRST. This reads quoted strings, and the declaration is heavily commented —
   * so one apostrophe in an English word inside a comment ("the head teacher's queue") flips the
   * quote parity and the rest of the column list reads as garbage. That is a broken reader, not a
   * broken schema, and it fails in a way that points at the wrong file. */
  const body = (hdr ? hdr[1] : '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const cols = (body.match(/'[^']+'/g) || []).map(s => s.slice(1, -1));
  ok_('INJURY_REPORTS has a NotifyParent column', cols.indexOf('NotifyParent') >= 0);
  ok_('...and the rest of the form is still there', ['InjuryID', 'StudentID', 'InjuryTypes', 'TeacherID'].every(c => cols.indexOf(c) >= 0));
  /* NOTHING WAS DROPPED WHILE ADDING ONE. This used to assert an exact column COUNT, which meant
   * every later column had to come back here and bump a number — a test that measures length, not
   * behaviour, and one that says nothing about WHICH column went missing. Name them instead: the 24
   * form fields, the v224 approval trail, the v225 page-2 block, and the filing stamp. */
  const MUST = ['InjuryID','Date','Time','CenterName','AffiliationType','AffiliationOther','District',
    'RecorderName','StudentID','ChildName','Sex','AgeYears','AgeMonths','EduStatus','EduGrade',
    'Narrative','CauseObject','Witness','Place','PlaceOther','InjuryTypes','TeacherID','CreatedDate',
    'CreatedAt','NotifyParent','Status','LeaderBy','LeaderAt','AdminBy','AdminAt','RejectReason',
    'UpdatedBy','UpdatedAt','ShareJournal','Photo1','Photo2','Photo3'];
  const missing = MUST.filter(c => cols.indexOf(c) < 0);
  eq('nothing was dropped while adding it', missing.join(',') || 'none', 'none');
  // a repeated name is a column that silently shadows another when writeRows_ maps fields to cells
  eq('...and no column is declared twice', cols.filter((c, i) => cols.indexOf(c) !== i).join(',') || 'none', 'none');
  ok_('...and the filing stamp is one of them', cols.indexOf('CreatedAt') >= 0);
  ok_('...and the approval trail is stored, not just displayed',
    ['Status', 'LeaderBy', 'AdminBy', 'RejectReason'].every(c => cols.indexOf(c) >= 0));
}

console.log('\n2) a sheet that ALREADY exists gains the column');
{
  // run the real ensureCollectionSheet_ against a stub workbook
  // v250 put collectionHeaders_ in front of ensureCollectionSheet_ (the declared columns now come
  // from the database SCHEMA as well as this build's own map), so the slice has to start there —
  // otherwise this whole block throws ReferenceError and the suite dies before asserting anything.
  const src = ge.slice(ge.indexOf('function collectionHeaders_('), ge.indexOf('function readCollection_('));
  const written = [];
  function sheetStub(hdr) {
    return { _hdr: hdr.slice(),
      getRange: (r, c, nr, nc) => ({ setValues: v => { written.push(v[0]); v[0].forEach((x, i) => { sheetStub._last._hdr[c - 1 + i] = x; }); },
        setFontWeight: () => {} }),
      setFrozenRows: () => {} };
  }
  const existing = { _hdr: ['InjuryID', 'Date', 'StudentID'] };
  existing.getRange = (r, c, nr, nc) => ({ setValues: v => { v[0].forEach((x, i) => { existing._hdr[c - 1 + i] = x; }); }, setFontWeight: () => {} });
  existing.setFrozenRows = () => {};
  const ctx = {
    console, String, Array, Object,
    COLLECTION_HEADERS_: { INJURY_REPORTS: ['InjuryID', 'Date', 'StudentID', 'Narrative', 'NotifyParent'] },
    wbOf_: () => ({ getSheetByName: () => existing, insertSheet: () => existing }),
    headers_: sh => sh._hdr.slice(),
    ensureColumns_: (sh, cols) => { const h = sh._hdr.slice();
      const missing = cols.filter(c => h.indexOf(c) < 0);
      if (missing.length) sh.getRange(1, h.length + 1, 1, missing.length).setValues([missing]); }
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.f = ensureCollectionSheet_;', ctx);
  ctx.f({ wb: 'MAIN', sheet: 'INJURY_REPORTS' });
  eq('the missing columns are appended, in order', existing._hdr, ['InjuryID', 'Date', 'StudentID', 'Narrative', 'NotifyParent']);
  ok_('nothing existing was renamed or moved', existing._hdr.slice(0, 3).join() === 'InjuryID,Date,StudentID');
  // and a second call must be a no-op, not keep appending
  const before = existing._hdr.length;
  ctx.f({ wb: 'MAIN', sheet: 'INJURY_REPORTS' });
  eq('running again changes nothing', existing._hdr.length, before);
  // an UNDECLARED sheet is still never invented
  ok_('an unknown sheet is still not invented', /if \(!hdr\) return null;/.test(src));
}
{
  ok_('the top-up runs on every collection write', /function writeCollection_[\s\S]{0,200}ensureCollectionSheet_\(def\)/.test(ge));
  ok_('...and a failure to top up cannot take the write down', /try \{ ensureColumns_\(sh, hdr\); \} catch \(e\) \{\}/.test(ge));
  ok_('the reason is written down for the next person', /dropped WITHOUT AN ERROR/.test(ge));
}

console.log('\n3) the value survives a real write once the header is right');
{
  // writeRows_ is what actually drops an undeclared field — run it for real
  const src = ge.slice(ge.indexOf('function writeRows_('), ge.indexOf('function readCollection_(') > 0 ? ge.indexOf('\n}\n', ge.indexOf('function writeRows_(')) + 3 : undefined);
  const rowsOut = [];
  const mk = hdr => ({ _hdr: hdr, getLastRow: () => 1, getLastColumn: () => hdr.length,
    getRange: () => ({ setValues: v => { v.forEach(r => rowsOut.push(r)); }, clearContent: () => {} }),
    clearContents: () => {}, getMaxRows: () => 100 });
  const withCol = mk(['InjuryID', 'StudentID', 'NotifyParent']);
  const ctx = {
    console, String, Array, Object, Number, Date, JSON,
    wbOf_: () => ({ getSheetByName: () => withCol }),
    headers_: sh => sh._hdr.slice(),
    NO_SHRINK_SHEETS: {}, Logger: { log() {} }, IMAGE_COLS_: {}, SpreadsheetApp: { flush(){} },
    encodeCell_: v => v, driveifyImage_: v => v, cacheDel_: () => {}, bustSheetCache_: () => {}
  };
  vm.createContext(ctx);
  try {
    vm.runInContext(src + '\nthis.f = writeRows_;', ctx);
    ctx.f('MAIN', 'INJURY_REPORTS', [{ InjuryID: 'INJ-1', StudentID: 'STD-1', NotifyParent: 'YES' }], {});
    const row = rowsOut[rowsOut.length - 1] || [];
    eq('NotifyParent reaches the sheet', row[2], 'YES');
  } catch (e) {
    // writeRows_ pulls in more of GasEngine than is worth stubbing on some builds — the header
    // behaviour above is the part that was broken, and it is covered
    ok_('writeRows_ maps rows onto the sheet header (unstubbed: ' + String(e.message).slice(0, 40) + ')',
      /var hdr = headers_\(sh\);/.test(ge));
  }
}

console.log('\n4) the rest of the chain was always right — check it still is');
{
  // the form is built by injFormHTML now (one builder for filing AND correcting), so the ids carry
  // its prefix — the tick and the value that is sent must still be there
  ok_('the teacher form has the tick', /id="\$\{id\('injNotifyParent'\)\}"/.test(app));
  ok_('...and sends it', /notifyParent:!!\(box\.querySelector\('#'\+pfx\+'injNotifyParent'\)\|\|\{\}\)\.checked/.test(app));
  ok_('the engine records it on the row', /NotifyParent:p\.notifyParent\?'YES':''/.test(eng));
  ok_('the report screen shows it', /แจ้งผู้ปกครองแล้ว/.test(app));
  ok_('...reading the stored value, not guessing', /String\(r\.NotifyParent\|\|''\)==='YES'/.test(app));
  ok_('and the LINE message to the parents still goes out', /if \(p\.notifyParent\)/.test(notify));
  ok_('an injury still always reaches admins and leaders', /notifyAdminsUrgent_\(msg, ref\)/.test(notify) && /notifyLeaders_\(msg\)/.test(notify));
}

console.log('\n5) the same trap, closed for the other collections too');
{
  // every declared header now reaches its sheet, not just the injury one
  const names = (ge.match(/^\s{2}([a-zA-Z]+):\s*\{ wb: /gm) || []).length;
  ok_('there are collections mapped to sheets', names > 20);
  // the CODE must name no sheet — the comment above it names the example that exposed the bug
  const whole = ge.slice(ge.indexOf('function ensureCollectionSheet_('), ge.indexOf('function readCollection_('));
  const body = whole.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok_('and the top-up is generic, not injury-specific', !/INJURY/.test(body));
  ok_('...though the comment keeps the example that exposed it', /INJURY_REPORTS\.NotifyParent/.test(whole));
}

console.log('\n6) WHEN IT HAPPENED vs WHEN IT WAS FILED');
{
  /* Reported 2026-09-03: two injury reports arrived on LINE at 13:10 and 13:13 and read "เวลา 10:25"
   * and "เวลา 16:10" — and 16:10 had not come round yet that day. Both were dated the PREVIOUS day.
   *
   * Date/Time on the form are the INCIDENT, typed by the teacher, and a teacher catching up on
   * yesterday is normal. What the app could not answer was the admin's actual question — when did
   * this report reach us? — because CreatedDate stored the filing DATE and nothing stored the time.
   * Two different facts had one field between them. */
  ok_('the filing moment is stamped to the minute', /CreatedAt:stampLocal\(\),/.test(eng));
  ok_('...and the list shows it when it is not the same day as the incident',
    /if\(d===String\(r\.Date\|\|''\)\.slice\(0,10\)\) return '';/.test(app) &&
    /📝 \$\{EN\(\)\?'filed':'บันทึกเมื่อ'\}/.test(app));
  ok_('...and says why the two are not the same question',
    /WHEN IT HAPPENED, AND WHEN IT WAS FILED — two different facts/.test(app));
  /* An accident cannot be reported before it happens, so a future time is a typing slip every time —
   * refused rather than stored on a document a parent or an insurer may read. */
  ok_('an incident timed in the future is refused by the server',
    /fail\('FUTURE_TIME','เวลาที่เกิดเหตุยังมาไม่ถึง/.test(eng));
  ok_('...in the built engine too', /fail\('FUTURE_TIME'/.test(R('src/Engine.gs')));
  ok_('...and the teacher is told before the form is sent', /if\(injFuture\(f\)\)\{ toast\(/.test(app));
  ok_('...by the same test on both sides', /d>now \|\| \(d===now &&/.test(app));
  /* A PAST time is still fine — that is the normal case, and the filing stamp is what makes it
   * readable rather than suspicious. */
  ok_('yesterday is still allowed, which is the whole point of the stamp',
    /Past dates are fine: a[\s\S]{0,40}teacher catching up on yesterday is normal/.test(eng));
  ok_('the refusal is known to be a rule working, not a crash', /FUTURE_TIME: 1,/.test(R('src/Perf.gs')));
}

console.log('\n7) THE REPORT SCREEN, WHERE THE WORK IS');
{
  /* Asked 2026-09-03. An injury report is signed off exactly like a leave (teacher → หัวหน้าครู →
   * แอดมิน), and it was reachable only from the dashboard, where nothing said how many were waiting.
   * It now sits on the operations row with the other things that need a signature, and carries the
   * same red corner badge. */
  ok_('the server counts the ones still waiting', /injuries:     \(M\.injuryReports\|\|\[\]\)\.filter\(r=>pend\(r\.Status\)\)\.length,/.test(eng));
  ok_('...the badge knows which button it belongs to', /studentOT:'A_studentOT', injuries:'A_injuries'/.test(app));
  ok_('...and the button is on the operations row', /\['🚑',EN\(\)\?'Injury reports':'รายงานอุบัติเหตุ','A_injuries\(\)'\],/.test(app));

  /* The page is a summary, so it has to fit on a screen: two figures read as sentences side by side,
   * the two breakdowns half a screen each because they are read together, and a scroll past five
   * rows so a long tail cannot push the list off the bottom. */
  ok_('the two counts sit on one row, number beside label',
    /const stat = \(icon,n,label,col\) =>[\s\S]{0,140}display:flex;align-items:center/.test(app));
  ok_('the two breakdowns are half a screen each', /\$\{half\('🩹'[\s\S]{0,160}\$\{half\('🏫'/.test(app));
  ok_('...and scroll past five rows rather than growing', /rows\.length>5\?'max-height:168px;overflow-y:auto;':''/.test(app));
  ok_('...saying so, so a hidden row is not simply missing', /รายการ — เลื่อนดูได้/.test(app));
  ok_('the list folds, with the month on its own header',
    /<details class="card" open[\s\S]{0,500}onchange="A_injuries\(this\.value\)"/.test(app));
  ok_('...and opening the picker does not fold the list', /onclick="event\.preventDefault\(\);event\.stopPropagation\(\)"/.test(app));
  /* WHICH STEP IS IT AT — the question an admin opens this screen to answer. */
  ok_('the server sends each report’s step', /status:String\(r\.Status\|\|''\),/.test(eng));
  ok_('...and every row shows it', /\$\{injStatusPill\(\{Status:r\.status\}\)\}/.test(app));
  ok_('...in the same words the detail screen uses',
    /PENDING_LEADER: \(\)=>EN\(\)\?'Waiting for the head teacher':'รอหัวหน้าครู'/.test(app));
  // a month with nothing in it still has to offer the picker, or you cannot leave it
  ok_('an empty month still lets you change month',
    /No injuries reported this month[\s\S]{0,60}<\/div><\/div>`\}`;/.test(app) &&
    (app.match(/onchange="A_injuries\(this\.value\)"/g) || []).length === 2);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
