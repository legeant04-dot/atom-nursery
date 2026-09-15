/**
 * tools/test_refresh_button.js — 🔄 on every role's home screen, not just the admin's.
 *   node tools/test_refresh_button.js
 *
 * WHY THIS FILE EXISTS. Asked 2026-09-15: "เพิ่มปุ่ม Refresh ในทุก Role ไว้ที่หน้าหลักเหมือน Admin
 * ในกรณีที่เปิดเข้าแอพมาแล้วแอพยังค้างข้อมูลล่าสุด".
 *
 * The button had been on the Admin dashboard since 2026-08-27, and the reason it was wanted there
 * was never an admin reason. Reads are cached for 30 seconds and revalidated in the background,
 * which is right for a screen somebody walks past — but anyone who opens the app ALREADY KNOWING
 * something changed (a parent told their child was collected, a teacher told a class was moved) is
 * looking at an answer from before they were told, with no way to say "now". What they did instead
 * was close and reopen the app: the whole boot, and until v383 the LINE hand-off with it.
 *
 * Nothing but the markup was missing — REFRESH_NOW already clears the read cache and re-runs
 * whatever screen is open, for whoever is looking at it. So what is worth pinning here is not that
 * the button works; it is the two things that made adding it more than a copy-paste:
 *
 *   · a refresh must not re-pop the parent's announcement modal. A redraw is still a draw, and on
 *     the admin dashboard — the only place the button lived — there was no modal to throw.
 *   · one helper, not three copies of the markup. The copy is what drifts.
 */
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '\n         got=' + JSON.stringify(got) + '\n        want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), css = R('webapp/styles.css');

console.log('\n1) One button, defined once');
{
  ok_('there is a single helper', /const refreshBtn = \(\) => `<button class="btn sm outline dash-refresh" onclick="REFRESH_NOW\(this\)"/.test(app));
  /* Three copies of a string is three chances for one of them to be edited. The admin's inline
   * markup was replaced by the helper rather than left beside it. */
  eq('and the raw markup appears nowhere else',
    (app.match(/onclick="REFRESH_NOW\(this\)"/g) || []).length, 1);
  eq('...while the helper is used on every home screen that needs it',
    (app.match(/\$\{refreshBtn\(\)\}/g) || []).length, 4);
  ok_('it is labelled for a screen reader, not just an emoji', /aria-label="\$\{EN\(\)\?'Reload the latest data':'โหลดข้อมูลล่าสุด'\}"/.test(app));
}

console.log('\n2) Every role reaches it');
{
  const homeOf = role => {
    const i = app.indexOf('SCREENS.' + role + '.home = async');
    if (i < 0) return '';
    const j = app.indexOf('\n  SCREENS.', i + 10);
    return app.slice(i, j < 0 ? app.length : j);
  };
  const admin = homeOf('Admin'), teacher = homeOf('Teacher'), parent = homeOf('Parent');
  ok_('Admin home has it', /\$\{refreshBtn\(\)\}/.test(admin));
  ok_('Teacher home has it', /\$\{refreshBtn\(\)\}/.test(teacher));
  ok_('Parent home has it', /\$\{refreshBtn\(\)\}/.test(parent));
  /* A parent with no child linked yet gets a DIFFERENT, earlier branch that returns before the main
   * render — and it is the one most likely to be stale, because it is what somebody stares at while
   * waiting for the admin to link their child. */
  eq('...on BOTH parent branches, including the no-children one',
    (parent.match(/\$\{refreshBtn\(\)\}/g) || []).length, 2);
  /* A หัวหน้าครู is a Teacher whose PositionLevel is 'Leader' — USER.role stays 'Teacher', so the
   * teacher screen is theirs. Observer is an explicit alias of the admin screens. Neither needs its
   * own button, and asserting that here is what stops somebody adding a third copy for them. */
  ok_('Observer inherits the admin screens rather than needing a copy',
    /\['home','leaves','finance','dspm'\]\.forEach\(k => \{ SCREENS\.Observer\[k\] = \(\.\.\.a\) => SCREENS\.Admin\[k\]\(\.\.\.a\); \}\);/.test(app));
  ok_('a head teacher is a Teacher, so the teacher screen is theirs',
    /USER\.role==='Leader'/.test(app) && !/SCREENS\.Leader/.test(app));
}

console.log('\n3) What a refresh must NOT do');
{
  /* THE ONE REAL TRAP. The parent's home pops the school's announcements when it is drawn, and a
   * redraw is a draw. showAnnPopups only remembers what was dismissed with "ไม่ต้องแสดงอีก" ticked,
   * which most people never tick — so without this, every 🔄 tap would throw the modal over the
   * screen the parent was trying to look at. */
  ok_('a manual refresh is flagged', /_REFRESHING = true;/.test(app));
  ok_('...and cleared even if the screen throws', /finally \{ _REFRESHING = false; \}/.test(app));
  ok_('...and the announcement popup respects it', /if \(!pre && !_REFRESHING\) showAnnPopups\(\);/.test(app));

  /* NOT location.reload(). That repeats the whole boot for data that is one request away, which is
   * exactly the expensive workaround this button exists to replace. */
  ok_('it re-runs the screen rather than reloading the page',
    /await GO\(CURRENT, \{ silent: true \}\)/.test(app) && !/REFRESH_NOW[\s\S]{0,400}location\.reload/.test(app));
  ok_('...silently, so the placeholder does not flash over a screen that is already drawn',
    /GO\(CURRENT, \{ silent: true \}\)/.test(app));
  /* The honest failure mode of a refresh button is somebody tapping it four times and queueing four
   * identical round trips on a platform that runs them one after another. */
  ok_('the button is disabled while it works', /if \(btn\) \{ btn\.disabled = true; btn\.style\.opacity = '\.55'; \}/.test(app));
  ok_('...and enabled again afterwards', /if \(btn\) \{ btn\.disabled = false; btn\.style\.opacity = ''; \}/.test(app));
  ok_('it says it worked, because nothing visibly changes when the data was already current',
    /toast\(EN\(\) \? 'Updated' : 'อัปเดตข้อมูลล่าสุดแล้ว'\)/.test(app));
  // no writes, no settings: a mis-tap costs one round trip and nothing else
  ok_('it only clears the read cache', /window\.__atomCacheClear && __atomCacheClear\(\);/.test(app));
}

console.log('\n4) It fits on a phone');
{
  /* Mobile first, and this is where it bites: the parent's row carries "ข้อมูลของฉัน" and
   * "เพิ่มบุตรหลาน" as well, so three full labels wrap onto three lines. The rules used to be
   * scoped to .dash-h, which is the admin's title row and nowhere else. */
  ok_('the label is dropped on a narrow screen', /@media\(max-width:480px\)\{ \.dash-refresh \.lbl\{display:none;\} \}/.test(css));
  ok_('...for every home screen, not only the admin title row', !/\.dash-h \.dash-refresh \.lbl/.test(css));
  ok_('the button is never squashed by what shares its row', /\.dash-refresh\{flex:0 0 auto;align-self:center;\}/.test(css));
  ok_('...and still sits at the far right of the admin title row', /\.dash-h \.dash-refresh\{margin-left:auto;\}/.test(css));
}

console.log(fail ? `\nFAILED ${pass} passed, ${fail} failed` : `\nALL PASS ${pass} checks`);
process.exit(fail ? 1 : 0);
