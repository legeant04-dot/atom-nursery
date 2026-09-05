/**
 * tools/test_journal_photos.js — three things asked on 2026-09-05.
 *   node tools/test_journal_photos.js
 *
 * 1) The injury screen's "อุบัติเหตุที่บันทึกล่าสุด" folds. The official form above it is already
 *    two pages of fields; ten old reports underneath made the screen a teacher opens to REPORT an
 *    accident open onto a scroll of past ones.
 *
 * 2) A red count on the 🚑 nav icon when a report has been sent back to this teacher. Something
 *    waiting for you is only useful if you can see it from wherever you are — and nobody opens the
 *    injury screen on an ordinary day.
 *
 * 3) Up to three optional pictures on the daily journal's highlight: the activity, or what the child
 *    made. Circles the size of the food thumbnails, zoomed by the same viewer, offloaded to Drive by
 *    the same Photo1/2/3 rule the injury photos use.
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
const app = R('webapp/app.js'), eng = R('webapp/engine.js'), css = R('webapp/styles.css'),
      cfg = R('src/Config.gs'), jr = R('src/Journal.gs'), db = R('src/Db.gs');

console.log('1) the recent-injury list folds');
{
  const scr = app.slice(app.indexOf('SCREENS.Teacher.injury'), app.indexOf('SCREENS.Teacher.injury') + 1600);
  ok_('it is a <details>, shut until asked for', /<details class="card"[^>]*>\s*<summary[\s\S]{0,200}inj\.recent/.test(scr));
  ok_('...with the count on the summary, which is the part read at a glance', /inj\.recent[\s\S]{0,160}recent\|\|\[\]\)\.length/.test(scr));
  ok_('...and no `open`, or folding it would change nothing', !/inj\.recent[\s\S]{0,200}<details[^>]*open/.test(scr));
  /* What was sent back to THIS teacher is NOT inside the fold. It is the one thing on the screen
   * waiting on them, and hiding it behind a summary is how it got missed in the first place. */
  ok_('what was sent back to them stays outside the fold', app.indexOf('injRejectedHTML(recent)') < app.indexOf('<details class="card" style="margin-top:12px">'));
}

console.log('\n2) the red count on the nav icon');
{
  ok_('a nav button knows which tab it is', /data-nav="\$\{k\}"/.test(app));
  ok_('the badge is drawn inside the ICON, not next to the label', /<span class="ic">\$\{svgIcon\(ic\)\}\$\{NAV_BADGE\[k\]>0\?navBadgeHTML/.test(app));
  ok_('...and one screen can set it without redrawing the whole bar', /window\.NAV_setBadge=/.test(app));
  ok_('...updating in place', /NAV_setBadge[\s\S]{0,400}insertAdjacentHTML/.test(app));
  ok_('a zero removes it rather than printing "0"', /NAV_setBadge[\s\S]{0,400}if\(v>0\)/.test(app));
  // the badge must never eat the tap that opens the tab
  ok_('the badge cannot swallow the tap', /\.navbadge\{[\s\S]{0,300}pointer-events:none/.test(css));
  ok_('the teacher home fetches the count in the same tick as everything else',
    /const p_injAlert= api\('injuryAlerts'/.test(app) && !/await[\s\S]{0,200}const p_injAlert/.test(app));
  ok_('...and hangs it on the tab', /p_injAlert\.then\(a=>NAV_setBadge\('injury'/.test(app));
  ok_('the injury screen recomputes it from data it already has, with no second call',
    /SCREENS\.Teacher\.injury[\s\S]{0,1800}NAV_setBadge\('injury', \(recent\|\|\[\]\)\.filter/.test(app));
}

console.log('\n3) injuryAlerts counts the right thing');
{
  const M = {
    config: { Plans: [], LeaveQuota: {} },
    students: [{ StudentID: 'STD-1', NameTH: 'บีม', Nickname: 'บีม', Class: 'N1', Status: 'ACTIVE' }],
    staff: [{ StaffID: 'T1', NameTH: 'ครูเอ', Role: 'Teacher', PositionLevel: 'Officer' },
            { StaffID: 'T2', NameTH: 'ครูบี', Role: 'Teacher', PositionLevel: 'Officer' }],
    injuryReports: [
      { InjuryID: 'I1', TeacherID: 'T1', Status: 'REJECTED', StudentID: 'STD-1', Date: '2026-09-01' },
      { InjuryID: 'I2', TeacherID: 'T1', Status: 'PENDING_LEADER', StudentID: 'STD-1', Date: '2026-09-02' },
      { InjuryID: 'I3', TeacherID: 'T1', Status: 'APPROVED', StudentID: 'STD-1', Date: '2026-09-03' },
      { InjuryID: 'I4', TeacherID: 'T2', Status: 'REJECTED', StudentID: 'STD-1', Date: '2026-09-04' }],
    parents: [], userLinks: [], leaves: [], payments: [], otDaily: [], otRecords: [], studentCharges: [],
    prepayments: [], paymentSlips: [], checkinStudent: [], journals: [], comments: [], holidays: [],
    staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [], payroll: [],
    payrollConfig: {}, studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [], announcements: [],
    notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [], classChanges: [],
    classChangeReq: [], attendanceReq: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [],
    surveyResponses: [], injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {},
    feed: [], calendar: [], classes: [], studentAttendanceToday: [], studentCheckins: []
  };
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(R('webapp/engine.js'), ctx);
  const H = ctx.createAtomAPI(M, {}).H;
  eq('only what was sent back to ME', H.injuryAlerts({ staffId: 'T1' }).rejected, 1);
  eq('...not another teacher\'s', H.injuryAlerts({ staffId: 'T2' }).rejected, 1);
  eq('...and nothing for a stranger', H.injuryAlerts({ staffId: 'ZZZ' }).rejected, 0);
  // a report merely moving through the queue is not waiting on the teacher who filed it
  eq('a pending or approved report is not an alert', H.injuryAlerts({ staffId: 'T1' }).rejected < 3, true);
}

console.log('\n4) the journal\'s pictures');
{
  ok_('the teacher can attach three, on the highlight', /function jPhotoFields[\s\S]{0,500}\[0,1,2\]\.map\(i=>photoField\('jPh'\+\(i\+1\)/.test(app));
  ok_('...and they sit under the highlight box', /id="jHi"[\s\S]{0,400}jPhotoFields\(jv\)/.test(app));
  ok_('...clearly optional', /ไม่บังคับ/.test(app.slice(app.indexOf('function jPhotoFields'), app.indexOf('function jPhotoFields') + 900)));
  ok_('they are sent with the entry', /Photo1:ph\[0\],Photo2:ph\[1\],Photo3:ph\[2\]/.test(app));
  /* A TEACHER WHO EDITS A DRAFT WITHOUT TOUCHING THE PICKER MUST NOT LOSE THE MORNING'S PHOTO.
   * photoVal is '' for an untouched slot, and sending that would erase the picture — exactly the
   * trap the injury form hit and fixed. */
  ok_('an untouched slot keeps what is already on the entry', /photoVal\(document,'jPh'\+\(i\+1\)\) \|\| J_PHOTOS_CUR\[i\]/.test(app));
  ok_('...which is captured when the form opens', /J_PHOTOS_CUR = jv\.photos\.slice\(\)/.test(app));
  ok_('the parent sees them as circles', /function jPhotosHTML[\s\S]{0,500}border-radius:50%/.test(app));
  ok_('...the same size as the food thumbnails, by construction', /const JR_PIC_PX = 28/.test(app) && /foodPic = \(name, size\)=>[\s\S]{0,120}size\|\|28/.test(app));
  ok_('...zoomed by the same viewer', /function jPhotosHTML[\s\S]{0,500}IMG_zoom/.test(app));
  /* The highlight block used to be drawn only when there was TEXT. A teacher who attached a photo
   * and typed nothing would have had the picture silently dropped from the parent's page. */
  ok_('a picture alone still draws the highlight block', /\(j\.Highlight\|\|j\.Photo1\|\|j\.Photo2\|\|j\.Photo3\)\?/.test(app));
  ok_('an entry with neither draws nothing', !/j\.Highlight\?`<div class="jr-hl"/.test(app));
}

console.log('\n5) where the pictures are stored');
{
  ok_('DAILY_JOURNAL has the three columns', /DAILY_JOURNAL:[^\]]*'Photo1', 'Photo2', 'Photo3'/.test(cfg));
  ok_('...they are journal fields, or the write would ignore them', /JOURNAL_FIELDS = \[[\s\S]{0,400}'Photo1', 'Photo2', 'Photo3'\]/.test(jr));
  ok_('...and created on write for a sheet that predates them', /ensureColumns_\(sheet, \[[^\]]*'Photo1', 'Photo2', 'Photo3'\]/.test(jr));
  /* NAMED Photo1/2/3 ON PURPOSE. Db.gs offloads exactly those keys to Drive; a base64 photo does
   * not fit a 50,000-character cell, and a new name would have needed a change there too. */
  ok_('Db.gs already sends those keys to Drive', /IMAGE_COLS_ = \{[\s\S]{0,300}Photo1: 1, Photo2: 1, Photo3: 1/.test(db));
  ok_('...on both write paths', /function appendObject_[\s\S]{0,120}driveifyImages_/.test(db) && /function updateRow_[\s\S]{0,120}driveifyImages_/.test(db));
}

console.log(fail ? `\nFAILED ${pass} passed, ${fail} failed` : `\nPASSED ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
