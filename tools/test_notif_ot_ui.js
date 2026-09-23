/**
 * tools/test_notif_ot_ui.js — the bell that clears itself, and the OT screen's honest buttons.
 *   node tools/test_notif_ot_ui.js
 *
 * Both asked 2026-09-23, both with screenshots.
 *
 * 1. THE BELL. A count of 100 had sat on it for days, and the tray held the SAME injury alert twice
 *    — identical child, time and narrative, one minute apart. A badge that never goes down stops
 *    meaning "something new happened", and a duplicate pushes a different notification off the
 *    visible part of a tray that shows four.
 *
 * 2. THE OT SCREEN. It opened on all 27 rows when the 4 that need action are the unpaid ones; the
 *    batch button said "ยกเลิกทั้งหมด" while acting only on what was TICKED; and both buttons plus
 *    ปิด sat above a list long enough that acting on a row meant scrolling back up to find them.
 *
 * The OT half is money — ยกเลิก writes an OT charge off — so the wording assertions here are not
 * cosmetic. A button that overstates what it does is the worst kind to leave alone.
 */
const path = require('path'), fs = require('fs');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), css = R('webapp/styles.css'), notifyGs = R('src/Notify.gs');
const appCode = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ============================================================================================
console.log('1) the same alert twice is not two alerts');
// ============================================================================================
{
  const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                      'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                      'Journal', 'GasEngine', 'Engine']);
  const res = JSON.parse(run(function () {
    _configCache = null; setupAll(); _configCache = null;
    var count = function () {
      return readObjects_(inboxSheet_()).filter(function (r) { return String(r.Category || '') === 'emergency'; }).length;
    };
    var msg = '🚨 อุบัติเหตุ/เหตุฉุกเฉิน: วัชชิรวิณณ์ · Nursery 2\nเวลา 17:30';
    inboxAdd_('emergency', msg, 'injury|INJ-1');
    var afterFirst = count();
    inboxAdd_('emergency', msg, 'injury|INJ-1');     // the 20:23 copy of the 20:22 line
    var afterDupe = count();
    /* A DIFFERENT EVENT MUST STILL GET THROUGH — this is the case that must not be swallowed. The
     * same child can be hurt twice in an afternoon, and the words differ when it is a real second
     * event (a different time, a different narrative). */
    inboxAdd_('emergency', msg + '\nเหตุการณ์: ล้มอีกครั้ง', 'injury|INJ-2');
    var afterReal = count();
    // ...and a different CATEGORY with the same words is a different thing too
    inboxAdd_('approval', msg, '');
    var afterOtherCat = count();
    return JSON.stringify({ afterFirst: afterFirst, afterDupe: afterDupe, afterReal: afterReal,
                            afterOtherCat: afterOtherCat,
                            approvals: readObjects_(inboxSheet_()).filter(function (r) { return String(r.Category || '') === 'approval'; }).length });
  }));

  eq('the first alert is written', res.afterFirst, 1);
  eq('an identical one a moment later is not', res.afterDupe, 1);
  eq('...but a genuinely different alert IS', res.afterReal, 2);
  eq('...and the same words in another category are their own row', res.approvals, 1);
  ok_('the window is a named constant, not a number in a condition', /INBOX_DEDUP_MIN_ = 10/.test(notifyGs));
  /* BEST-EFFORT BY CONTRACT. Losing an emergency alert is far worse than showing it twice, so if the
   * duplicate check itself fails for any reason the row is written anyway. */
  ok_('...and a failure in the check still writes the row',
    /try \{[\s\S]{0,700}if \(dupe\) return;\s*\n\s*\} catch \(e\) \{\}/.test(notifyGs));
}

// ============================================================================================
console.log('\n2) opening the tray IS reading it');
// ============================================================================================
{
  ok_('opening marks everything read', /if\(hadUnread\) api\('markNotifsRead',notifParams\(\)\)/.test(appCode));
  /* NOT AWAITED, and after the tray is on screen: this route runs at p50 ~10s, and making somebody
   * wait for it before seeing what they tapped for would trade one annoyance for a worse one. */
  /* Scoped to BELL, because the tray is the thing that must not block. The separate
   * "ทำเครื่องหมายว่าอ่านแล้ว" button (MARKREAD) still awaits, and should: it is an explicit tap with
   * a button to disable, and it stays as the way back if the automatic call above ever fails. */
  const bell = appCode.slice(appCode.indexOf('window.BELL = async'), appCode.indexOf('function notifTarget'));
  ok_('the bell was found', bell.length > 400);
  ok_('...and opening does not make the person wait for it',
    !/await api\('markNotifsRead'/.test(bell) && /api\('markNotifsRead',notifParams\(\)\)\.catch/.test(bell));
  ok_('the badge is zeroed locally first, because that is what they just did',
    /_bellN = \(_bellOps && _bellOps\.total\) \|\| 0;/.test(appCode));
  /* IF IT FAILS, THE TRUTH COMES BACK. _bellAt=0 forces the next refreshBell to re-ask rather than
   * serve the zero from cache for a minute. */
  ok_('...and a failed call restores the real count on the next refresh',
    /\.catch\(\(\)=>\{ _bellAt=0; \}\)/.test(appCode));
  /* "รอคุณดำเนินการ" IS NOT A NOTIFICATION and must survive. It stops being true when the work is
   * done, not when somebody glances at the tray — two unanswered time requests cannot be cleared by
   * opening a menu. */
  ok_('pending work is NOT cleared with the notifications',
    /OPS_TAP/.test(appCode) && /_bellN = \(_bellOps && _bellOps\.total\) \|\| 0/.test(appCode));
  ok_('...and the ops rows keep their unread marker', /\/OPS_TAP\/\.test\(el\.getAttribute\('onclick'\)\)/.test(appCode));
}

// ============================================================================================
console.log('\n3) the OT screen opens where the work is');
// ============================================================================================
{
  eq('it opens on ค้างชำระ, not on all 27 rows',
     (/let OT_FILT='(\w+)';/.exec(appCode) || [])[1], 'unpaid');
  /* AND AN EMPTY ONE IS GOOD NEWS. Now that this is the filter the screen OPENS on, "ไม่มีรายการใน
   * ตัวกรองนี้" would be the most common thing an admin sees — and under a screen they did not
   * choose to filter, that reads as a fault rather than as "everything is paid". */
  ok_('...and an empty result says so as good news', /ไม่มีรายการค้างชำระ — OT เดือนนี้เก็บครบแล้ว/.test(app));
  ok_('all rows are still one tap away', /A_otFilter\('all'\)/.test(appCode));
}

// ============================================================================================
console.log('\n4) buttons that say what they do, where the thumb is');
// ============================================================================================
{
  /* THE WORDS. "ยกเลิกทั้งหมด" beside a tick-box list reads as "cancel everything" and never did
   * that — it acts on what is ticked. This writes off money. */
  ok_('the batch buttons name the SELECTION, not "all"',
    /ยกเลิกรายการที่เลือก/.test(app) && /คืนค่ารายการที่เลือก/.test(app));
  ok_('...and the old wording is gone', !/>🚫 \$\{EN\(\)\?'Cancel all selected':'ยกเลิกทั้งหมด'\}/.test(app));
  /* AND WHAT THEY MEAN. ยกเลิก and คืนค่า are not obvious verbs for "stop billing this family" and
   * "put it back", and the consequence is money either way. */
  ok_('each button has its meaning written under it',
    /ไม่เรียกเก็บ OT รายการนั้นจากผู้ปกครอง/.test(app) && /นำรายการที่ยกเลิกไว้กลับมาเรียกเก็บตามเดิม/.test(app));
  ok_('...including that it only touches the ticked rows',
    /มีผลเฉพาะรายการที่ติ๊กไว้เท่านั้น/.test(app));

  // pinned to the bottom of the sheet, which is its own scroll container
  ok_('the actions sit in a pinned footer', /<div class="ot-foot">/.test(appCode));
  ok_('...and ปิด is in it, so it is always reachable',
    /class="ot-foot"[\s\S]{0,1600}t\('c\.close'\)/.test(appCode));
  ok_('...which the stylesheet actually pins', /\.ot-foot\{position:sticky;bottom:0/.test(css));
  ok_('the summary folds away so the rows get the screen',
    /<details class="card"[^>]*ontoggle="A_otSumToggle\(this\)"/.test(appCode));
  /* REMEMBERED ACROSS THE RE-RENDER a filter tap causes — otherwise it springs back open under
   * somebody who just closed it, every time they change filter. */
  ok_('...and stays closed when a filter re-renders the modal',
    /let OT_SUM_OPEN=true;/.test(appCode) && /OT_SUM_OPEN\?' open':''/.test(appCode));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
