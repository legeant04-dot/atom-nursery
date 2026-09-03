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
  const cols = (hdr ? hdr[1].match(/'[^']+'/g) || [] : []).map(s => s.slice(1, -1));
  ok_('INJURY_REPORTS has a NotifyParent column', cols.indexOf('NotifyParent') >= 0);
  ok_('...and the rest of the form is still there', ['InjuryID', 'StudentID', 'InjuryTypes', 'TeacherID'].every(c => cols.indexOf(c) >= 0));
  // 24 form fields + the 8 approval columns added in v224 (Status, LeaderBy/At, AdminBy/At,
  // RejectReason, UpdatedBy/At) + the 9 added in v225 (ShareJournal, Photo1-3, Wounds and the
  // four Treatment* fields of page 2) + CreatedAt, added 2026-09-03 so "when it was FILED" can be
  // told apart from "when it HAPPENED"
  eq('nothing was dropped while adding it', cols.length, 42);
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

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
