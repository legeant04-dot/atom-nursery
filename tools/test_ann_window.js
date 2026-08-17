/**
 * tools/test_ann_window.js — an announcement runs from a moment to a moment, and the Admin can see
 * which ones are actually on show.
 *   node tools/test_ann_window.js
 *
 * Asked for: a start and end TIME as well as a date — "19/08/2026 06:00 until 19/08/2026 12:30" —
 * and an Admin list that can be filtered and is newest-first.
 *
 * The trap in both halves is the same one this project keeps meeting: a rule that ends up written
 * down twice. The parent's list decided for itself whether an announcement was in date, while the
 * popup asked the engine. Add times to only one of them and the school posts something that shows
 * on one screen and not the other. So the window is computed in ONE place (annPhase_) and sent with
 * every row; the screens read the answer instead of re-deriving it.
 *
 * And the compatibility rule that must hold on the live sheet: an announcement written before times
 * existed has neither, and must behave exactly as it did — the whole day, both ends.
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
const app = R('webapp/app.js'), eng = R('webapp/engine.js'), gs = R('src/Announce.gs'), cfg = R('src/Config.gs'), i18n = R('webapp/i18n.js');

// the engine, with "now" pinned so a window can be tested from both sides
function boot(anns, nowISO) {
  const M = {
    config: { Plans: [], LeaveQuota: {} },
    announcements: anns || [],
    students: [], parents: [], userLinks: [], staff: [], leaves: [], payments: [], otDaily: [],
    studentCharges: [], prepayments: [], paymentSlips: [], checkinStudent: [], journals: [], comments: [],
    holidays: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    payroll: [], payrollConfig: {}, studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [],
    notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [],
    classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [],
    surveyResponses: [], injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {},
    feed: [], calendar: [], classes: [], studentAttendanceToday: [], studentCheckins: [], otRecords: []
  };
  const at = new Date(nowISO || '2026-08-19T09:00:00');
  class FakeDate extends Date {
    constructor(...a) { if (!a.length) super(at.getTime()); else super(...a); }
    static now() { return at.getTime(); }
  }
  const ctx = { window: {}, console, Date: FakeDate, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(R('webapp/engine.js'), ctx);
  const H = ctx.createAtomAPI(M, {}).H;
  return { H, M };
}
// the example from the request, verbatim
const A = { AnnID: 'ANN-7', Title: 'ปิดเรียนซ่อมไฟ', Popup: true, Date: '2026-08-17',
  StartDate: '2026-08-19', StartTime: '06:00', EndDate: '2026-08-19', EndTime: '12:30' };
const phase = (a, when) => (boot([a], when).H.announcements()[0] || {}).Phase;

console.log('\n1) the window the school asked for: 19/08 06:00 → 19/08 12:30');
{
  eq('the night before — not yet', phase(A, '2026-08-18T23:59:00'), 'soon');
  eq('05:59 on the day — still not yet', phase(A, '2026-08-19T05:59:00'), 'soon');
  eq('06:00 exactly — it starts', phase(A, '2026-08-19T06:00:00'), 'live');
  eq('mid-morning — showing', phase(A, '2026-08-19T09:30:00'), 'live');
  eq('12:30 exactly — still showing', phase(A, '2026-08-19T12:30:00'), 'live');
  eq('12:31 — over', phase(A, '2026-08-19T12:31:00'), 'ended');
  eq('the next day — over', phase(A, '2026-08-20T06:00:00'), 'ended');
}

console.log('\n2) an announcement written before times existed behaves exactly as it did');
{
  const old = { AnnID: 'ANN-1', Popup: true, Date: '2026-08-01', StartDate: '2026-08-19', EndDate: '2026-08-19' };
  eq('the day before — not yet', phase(old, '2026-08-18T23:59:00'), 'soon');
  eq('one minute past midnight on the day — showing', phase(old, '2026-08-19T00:01:00'), 'live');
  eq('23:59 on the day — STILL showing, not ended at midday', phase(old, '2026-08-19T23:59:00'), 'live');
  eq('the next morning — over', phase(old, '2026-08-20T00:01:00'), 'ended');
  const noEnd = { AnnID: 'ANN-2', Popup: true, Date: '2026-08-01', StartDate: '2026-08-01', EndDate: '' };
  eq('no end date means it never ends', phase(noEnd, '2027-01-01T00:00:00'), 'live');
  const noStart = { AnnID: 'ANN-3', Popup: true, Date: '2026-08-01', StartDate: '', EndDate: '' };
  eq('no dates at all is showing, as before', phase(noStart, '2026-08-19T09:00:00'), 'live');
}
{
  // half a window: a start time with no end, and an end time with no start
  const startOnly = { AnnID: 'ANN-4', Popup: true, StartDate: '2026-08-19', StartTime: '13:00', EndDate: '' };
  eq('before its start time', phase(startOnly, '2026-08-19T12:59:00'), 'soon');
  eq('...and after it, with no end, it stays up', phase(startOnly, '2026-08-25T00:00:00'), 'live');
  const endOnly = { AnnID: 'ANN-5', Popup: true, StartDate: '2026-08-01', EndDate: '2026-08-19', EndTime: '12:30' };
  eq('an end time with no start time still ends on the minute', phase(endOnly, '2026-08-19T12:31:00'), 'ended');
}
{
  // a damaged time cell must not silently become midnight and end the thing a day early
  const junk = { AnnID: 'ANN-6', Popup: true, StartDate: '2026-08-19', StartTime: 'Sat Dec 30 1899', EndDate: '2026-08-19', EndTime: '' };
  eq('an unreadable start time falls back to the whole day', phase(junk, '2026-08-19T00:30:00'), 'live');
}

console.log('\n3) one rule — the popup and the parents\' list cannot disagree');
{
  ok_('the window is computed in one place', /const annPhase_ = \(a, nowD, nowT\) => \{/.test(eng));
  ok_('the popup asks it', /on\(a\.Popup\) && annPhase_\(a\)==='live'/.test(eng));
  ok_('every row carries the answer', /Phase: annPhase_\(a\), Active: annPhase_\(a\)==='live'/.test(eng));
  ok_('the parent screen reads the answer instead of re-deriving it', /const act=\(anns\|\|\[\]\)\.filter\(a=>a\.Active!==false\);/.test(app));
  ok_('...and the old client-side date filter is gone', !/\(!a\.StartDate\|\|ymd\(a\.StartDate\)<=td\)&&\(!a\.EndDate\|\|ymd\(a\.EndDate\)>=td\)/.test(app));
  const { H } = boot([A], '2026-08-19T05:00:00');
  eq('at 05:00 the popup shows nothing', H.activeAnnouncements().length, 0);
  const live = boot([A], '2026-08-19T07:00:00').H;
  eq('...at 07:00 it shows', live.activeAnnouncements().length, 1);
  const over = boot([A], '2026-08-19T18:00:00').H;
  eq('...and after 12:30 it is gone again', over.activeAnnouncements().length, 0);
}

console.log('\n4) the Admin list: newest created first, and filterable');
{
  const many = [
    { AnnID: 'ANN-1', Title: 'เก่าสุด', Date: '2026-08-01', StartDate: '2026-08-01', EndDate: '2026-08-02' },
    { AnnID: 'ANN-2', Title: 'วันเดียวกัน ก', Date: '2026-08-17', StartDate: '2026-08-17', EndDate: '' },
    { AnnID: 'ANN-3', Title: 'วันเดียวกัน ข', Date: '2026-08-17', StartDate: '2026-09-01', EndDate: '' },
    { AnnID: 'ANN-4', Title: 'ล่าสุด', Date: '2026-08-19', StartDate: '2026-08-19', StartTime: '06:00', EndDate: '2026-08-19', EndTime: '12:30' }
  ];
  const rows = boot(many, '2026-08-19T09:00:00').H.announcements();
  eq('newest created first', rows.map(r => r.AnnID), ['ANN-4', 'ANN-3', 'ANN-2', 'ANN-1']);
  eq('...two written the same day keep the order they were written in', [rows[1].AnnID, rows[2].AnnID], ['ANN-3', 'ANN-2']);
  eq('each row says which phase it is in', rows.map(r => r.Phase), ['live', 'soon', 'live', 'ended']);
  // the source list must not be reordered underneath anything else that reads it
  eq('the underlying collection is left alone', boot(many, '2026-08-19T09:00:00').M.announcements.map(r => r.AnnID), ['ANN-1', 'ANN-2', 'ANN-3', 'ANN-4']);
}
{
  ok_('the screen groups by that phase, not by a rule of its own', /const of=k=>all\.filter\(a=>String\(a\.Phase\|\|'live'\)===k\);/.test(app));
  ok_('four filters, each with a count', /\['live','▶️'[\s\S]{0,200}\['all','📋'/.test(app) && /\(\$\{groups\[k\]\.length\}\)/.test(app));
  ok_('it opens on what is actually showing', /let ANN_TAB='live';/.test(app));
  ok_('each row prints its window in words', /const when=a=>\{ const s=a\.StartDate\?ddmmyyyy\(a\.StartDate\)\+\(a\.StartTime\?' '\+a\.StartTime:''\):'';/.test(app));
  ok_('...and is badged with its phase', /const phasePill=a=>\(\{live:/.test(app));
  ok_('mobile-first: the list scrolls in its own box', /max-height:46vh;overflow:auto/.test(app));
  ok_('an empty "showing" tab says so rather than looking broken', /ตอนนี้ไม่มีประกาศที่กำลังแสดง/.test(app));
}

console.log('\n5) saving it — and the mistakes worth catching before they are saved');
{
  const { H, M } = boot([], '2026-08-17T10:00:00');
  H.addAnnouncement({ title: 'ทดสอบ', startDate: '2026-08-19', startTime: '06:00', endDate: '2026-08-19', endTime: '12:30', popup: true });
  eq('the times are stored', [M.announcements[0].StartTime, M.announcements[0].EndTime], ['06:00', '12:30']);
  H.addAnnouncement({ title: 'ทั้งวัน', startDate: '2026-08-20' });
  eq('...and blank stays blank, meaning the whole day', [M.announcements[0].StartTime, M.announcements[0].EndTime], ['', '']);
  H.editAnnouncement({ annId: 'ANN-1', startTime: '', endTime: '' });
  const one = M.announcements.find(a => a.AnnID === 'ANN-1');
  eq('a time can be CLEARED, not just changed', [one.StartTime, one.EndTime], ['', '']);
  H.editAnnouncement({ annId: 'ANN-1', title: 'แก้หัวข้อ' });
  eq('...and editing something else does not disturb them', [one.StartTime, one.EndTime, one.Title], ['', '', 'แก้หัวข้อ']);
}
{
  ok_('an end TIME with no end DATE is refused — it would never arrive', /if\(data\.endTime&&!data\.endDate\)\{ toast/.test(app));
  ok_('an end before the start is refused', /data\.endDate<data\.startDate/.test(app));
  ok_('...including on the same day, by time', /data\.endTime<data\.startTime/.test(app));
  ok_('the form has both time fields', /id="anStartT"/.test(app) && /id="anEndT"/.test(app));
  ok_('...and they are sent', /startTime:q\('#anStartT'\),endTime:q\('#anEndT'\)/.test(app));
  ok_('the form says what leaving them blank means', /'ann\.timeNote'/.test(app) && /เว้นเวลาว่างไว้ = แสดงทั้งวัน/.test(i18n));
}

console.log('\n6) the sheet, and the GAS routes that really run');
{
  ok_('the columns exist', /'Priority', 'StartTime', 'EndTime'\]/.test(cfg));
  ok_('...and are topped up on the LIVE sheet, which was created without them', /ensureColumns_\(sh, \['Popup', 'StartDate', 'EndDate', 'Priority', 'StartTime', 'EndTime'\]\);/.test(gs));
  ok_('a time is written as TEXT, not as a value Sheets turns into an 1899 date', /function annTime_\(v\)/.test(gs) && /\/\^\\d\{2\}:\\d\{2\}\$\/\.test\(s\) \? s : ''/.test(gs));
  ok_('add stores both', /StartTime: annTime_\(p\.startTime\), EndTime: annTime_\(p\.endTime\)/.test(gs));
  ok_('edit can clear them — undefined, not != null', /if \(p\.startTime !== undefined\) patch\.StartTime = annTime_\(p\.startTime\);/.test(gs));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
