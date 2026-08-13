/**
 * tools/test_injury_extras.js — the rest of what the injury report was asked to do:
 *   node tools/test_injury_extras.js
 *
 *   · correct / unlock / delete reachable from the report itself
 *   · photographs of the injury
 *   · a tick that decides who sees it — the system only, or the parents' สมุดรายวัน too
 *   · page 2 of the official form (the wounds and การช่วยเหลือ) collected instead of left blank
 *   · the PDF fixes: given name and surname in their own boxes, a class name that fits, and the
 *     17 injury types printed in full INSIDE their frame
 *
 * THE RULES THAT MUST NOT BEND:
 *   - a correction never erases a photograph the editor did not touch;
 *   - a report kept "in the system only" NEVER reaches a parent;
 *   - a shared report does NOT wait for two signatures — the tick means "tell the family";
 *   - the wound list is stored as JSON, not as a raw array (a sheet cell turns that into
 *     "[object Object]" and the record becomes unreadable).
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
const app = R('webapp/app.js'), eng = R('webapp/engine.js'), cfg = R('src/Config.gs'),
      db = R('src/Db.gs'), card = R('webapp/report_card.js');

function boot() {
  const M = {
    config: { Plans: [], LeaveQuota: {}, SchoolName: 'Atom Nursery' },
    students: [{ StudentID: 'STD-1', NameTH: 'ปพิชญา โอสถานนท์', NameEN: 'Papitchaya', Nickname: 'พรีมี่', Class: 'Nursery 2', Status: 'ACTIVE', DOB: '2023-01-01', Gender: 'F' }],
    staff: [
      { StaffID: 'T1', NameTH: 'สมหญิง ใจดี', Nickname: 'ฟิล์ม', Role: 'Teacher', PositionLevel: 'Officer' },
      { StaffID: 'T2', NameTH: 'ครูบี', Role: 'Teacher', PositionLevel: 'Officer' },
      { StaffID: 'L1', NameTH: 'หัวหน้าแนน', Role: 'Teacher', PositionLevel: 'Leader' },
      { StaffID: 'A1', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin' }
    ],
    parents: [], userLinks: [], leaves: [], payments: [], otDaily: [],
    studentCharges: [], prepayments: [], paymentSlips: [], checkinStudent: [], journals: [], comments: [],
    holidays: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    payroll: [], payrollConfig: {}, studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [],
    announcements: [], notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [],
    classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [],
    surveyResponses: [], injuries: [], injuryReports: [], insurance: [], bigCleaning: [], departments: [],
    permissions: {}, feed: [], calendar: [], classes: [], studentAttendanceToday: [], studentCheckins: []
  };
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(R('webapp/engine.js'), ctx);
  const H = ctx.createAtomAPI(M, {}).H;
  // an older build must FAIL these checks cleanly rather than die on the first call
  ['editInjury', 'approveInjury'].forEach(function (k) {
    if (typeof H[k] !== 'function') H[k] = function () { return { missing: k }; };
  });
  if (typeof H.journalInjuries !== 'function') H.journalInjuries = function () { return []; };
  return { H: H, M: M };
}
const DAY = '2026-08-12';
const FILE = {
  studentId: 'STD-1', date: DAY, time: '10:35', narrative: 'วิ่งชนขอบโต๊ะ', injuryTypes: [1],
  photos: ['data:image/jpeg;base64,AAA', 'data:image/jpeg;base64,BBB', ''],
  wounds: [{ no: 1, pos: 'แขนซ้ายท่อนล่าง', char: '4' }, { no: 2, pos: 'เข่าขวา', char: '1' }],
  treatmentType: 'treated', treatmentBy: 'ครูพยาบาลของโรงเรียน', treatmentPlaces: ['nurse'], treatmentPlaceOther: ''
};
function file(H, extra) { return H.submitInjury(Object.assign({ staffId: 'T1' }, FILE, extra || {})); }
function grab(fn) { let e = null; try { fn(); } catch (x) { e = x.message || String(x); } return e; }
// a build without any of this must FAIL cleanly, not crash the run on the first missing column
function jp(v) { try { return JSON.parse(v); } catch (e) { return []; } }

console.log('\n=== 1. the schema actually has somewhere to put all of this ===');
[['ShareJournal', 'the who-sees-it tick'], ['Photo1', 'photo 1'], ['Photo2', 'photo 2'], ['Photo3', 'photo 3'],
 ['Wounds', 'page 2 wound list'], ['TreatmentType', 'treated / not treated'], ['TreatmentPlaces', 'where'],
 ['TreatmentPlaceOther', 'where — other'], ['TreatmentBy', 'treated at']].forEach(function (c) {
  const block = (cfg.match(/INJURY_REPORTS:[\s\S]*?\],/) || [''])[0];
  ok_('INJURY_REPORTS has ' + c[0] + ' (' + c[1] + ')', block.indexOf("'" + c[0] + "'") >= 0);
});
ok_('a photo column is offloaded to Drive, not written into a 50k-char cell',
  /IMAGE_COLS_[\s\S]{0,260}Photo1: 1[\s\S]{0,60}Photo2: 1[\s\S]{0,60}Photo3: 1/.test(db));

console.log('\n=== 2. filing: photos, the tick and page 2 are stored ===');
{
  const { H, M } = boot();
  const res = file(H);
  const r = M.injuryReports[0];
  ok_('the report was filed', !!res.injuryId && !!r);
  eq('photo 1 stored', r.Photo1, 'data:image/jpeg;base64,AAA');
  eq('photo 2 stored', r.Photo2, 'data:image/jpeg;base64,BBB');
  eq('the empty third slot is blank, not undefined', r.Photo3, '');
  ok_('the wound list is a JSON STRING, never a raw array', typeof r.Wounds === 'string');
  eq('…and it round-trips', jp(r.Wounds).length, 2);
  ok_('the treatment places are a JSON string too', typeof r.TreatmentPlaces === 'string');
  eq('treated / not treated', r.TreatmentType, 'treated');
  eq('treated at', r.TreatmentBy, 'ครูพยาบาลของโรงเรียน');
  eq('not shared unless asked', r.ShareJournal, '');
  eq('sharing is recorded when asked', file(H, { shareJournal: true }) && M.injuryReports[1].ShareJournal, 'YES');
}

console.log('\n=== 3. a report kept in the system NEVER reaches a parent ===');
{
  const { H, M } = boot();
  file(H);                                            // not shared
  eq('the journal shows nothing', H.journalInjuries({ studentId: 'STD-1', date: DAY }).length, 0);
  file(H, { shareJournal: true, narrative: 'โดนเพื่อนกัดที่แขน' });
  const seen = H.journalInjuries({ studentId: 'STD-1', date: DAY }), first = seen[0] || {};
  eq('only the shared one appears', seen.length, 1);
  eq('…and it is the shared one', first.narrative, 'โดนเพื่อนกัดที่แขน');
  eq('the photos travel with it', (first.photos || []).length, 2);
  eq('another day shows nothing', H.journalInjuries({ studentId: 'STD-1', date: '2026-08-13' }).length, 0);
  eq('another child shows nothing', H.journalInjuries({ studentId: 'STD-9', date: DAY }).length, 0);
  ok_('the official-form scaffolding is NOT pushed at the family',
    first.CenterName === undefined && first.AffiliationType === undefined && first.Status === undefined);
}

console.log('\n=== 4. sharing does not wait for two signatures ===');
{
  const { H, M } = boot();
  file(H, { shareJournal: true });
  eq('the report is still waiting for the head teacher', M.injuryReports[0].Status, 'PENDING_LEADER');
  eq('the family can already read it', H.journalInjuries({ studentId: 'STD-1', date: DAY }).length, 1);
}

console.log('\n=== 5. correcting a report keeps what it did not touch ===');
{
  const { H, M } = boot();
  const id = file(H).injuryId;
  H.editInjury({ staffId: 'T1', injuryId: id, data: { Narrative: 'แก้ไขเหตุการณ์' },
    photos: ['data:image/jpeg;base64,AAA', 'data:image/jpeg;base64,BBB', ''] });
  const r = M.injuryReports[0];
  eq('the narrative changed', r.Narrative, 'แก้ไขเหตุการณ์');
  eq('photo 1 survived', r.Photo1, 'data:image/jpeg;base64,AAA');
  eq('photo 2 survived', r.Photo2, 'data:image/jpeg;base64,BBB');
  eq('the wound list survived a correction that did not mention it', jp(r.Wounds).length, 2);
  H.editInjury({ staffId: 'T1', injuryId: id, shareJournal: true });
  eq('the tick can be changed later', M.injuryReports[0].ShareJournal, 'YES');
  H.editInjury({ staffId: 'T1', injuryId: id, shareJournal: false });
  eq('…and taken back', M.injuryReports[0].ShareJournal, '');
  eq('taking it back removes it from the journal', H.journalInjuries({ studentId: 'STD-1', date: DAY }).length, 0);
  H.editInjury({ staffId: 'T1', injuryId: id, wounds: [{ no: 1, pos: 'หน้าผาก', char: '4' }] });
  ok_('a corrected wound list is still a JSON string', typeof M.injuryReports[0].Wounds === 'string');
  eq('…with the new value', (jp(M.injuryReports[0].Wounds)[0] || {}).pos, 'หน้าผาก');
}

console.log('\n=== 6. who may correct it (the server decides, not the button) ===');
{
  const { H, M } = boot();
  const id = file(H).injuryId;
  ok_('another teacher may not', /NO_PERMISSION|เฉพาะ|แก้ไขได้/.test(grab(() => H.editInjury({ staffId: 'T2', injuryId: id, data: { Narrative: 'x' } })) || ''));
  ok_('the head teacher may', !grab(() => H.editInjury({ staffId: 'L1', injuryId: id, data: { Narrative: 'ok' } })));
  H.approveInjury({ staffId: 'L1', injuryId: id, decision: 'approve' });
  H.approveInjury({ staffId: 'A1', injuryId: id, decision: 'approve' });
  eq('it is final', M.injuryReports[0].Status, 'APPROVED');
  ok_('the teacher who filed it may no longer', /LOCKED|ปลดล็อก/.test(grab(() => H.editInjury({ staffId: 'T1', injuryId: id, data: { Narrative: 'y' } })) || ''));
  ok_('the admin still may', !grab(() => H.editInjury({ staffId: 'A1', injuryId: id, data: { Narrative: 'แก้โดยแอดมิน' } })));
  eq('and it is signed by them', M.injuryReports[0].UpdatedBy, 'แอดมิน');
}

console.log('\n=== 7. the client offers all of it ===');
ok_('one form builder for filing AND correcting', /function injFormHTML\(pfx, o\)/.test(app));
ok_('…and one reader for it', /function injFormVals\(pfx\)/.test(app));
ok_('the ids are prefixed so a modal over the screen cannot pick the wrong field',
  /const id=s=>pfx\+s/.test(app) && /injFormHTML\('e'/.test(app));
ok_('three photo pickers', /injPh'\+\(i\+1\)/.test(app));
ok_('a picked photo wins, otherwise the stored one is kept',
  /photoVal\(box,pfx\+'injPh'\+\(i\+1\)\) \|\| \(box\.dataset\?box\.dataset\['ph'\+\(i\+1\)\]:''\)/.test(app));
ok_('the who-sees-it choice is offered', /injShare/.test(app) && /แนบไปกับสมุดรายวัน/.test(app));
ok_('page 2 is asked for: 8 wounds', /injW'\+i\+'p'/.test(app) && /injW'\+i\+'c'/.test(app));
ok_('page 2 is asked for: การช่วยเหลือ', /injTreat/.test(app) && /INJ_TREAT_PLACES/.test(app));
ok_('the 14 ลักษณะการบาดเจ็บ are offered', /const INJ_CHARS=\[/.test(app) && /บาดแผลถลอก/.test(app));
ok_('a ✏️ correct button appears on the report', /A_injEdit\(/.test(app) && /injCanEdit\(r\)/.test(app));
ok_('🔓 unlock and 🗑️ delete are still there', /A_injUnlock\(/.test(app) && /A_injDelete\(/.test(app));
ok_('the photos are shown on the report', /function injPhotosHTML\(r\)/.test(app));
ok_('the wounds and treatment are shown on the report', /function injPage2HTML\(r\)/.test(app));
ok_('an approved report is not editable by a teacher in the UI either',
  /if\(s==='APPROVED'\) return false;/.test(app));
ok_('the parent journal asks for the shared reports', /api\('journalInjuries'/.test(app));
ok_('…in the SAME batch as the journal itself (no extra round trip)',
  /Promise\.all\(\[api\('parentChildren'[\s\S]{0,220}journalInjuries/.test(app));
ok_('the yesterday view shows them too', /P_showJ=async\(sid,date\)=>\{ const \[j,inj\]/.test(app));
ok_('the stale "page 2 prints blank" note is gone', app.indexOf('ระบบยังไม่ได้เก็บข้อมูลส่วนนี้') < 0);

console.log('\n=== 8. the official form ===');
ok_('given name and surname are split', /function splitName\(s\)/.test(card));
ok_('…and both are printed', /fill\(ctx, nm2\[0\]/.test(card) && /fill\(ctx, nm2\[1\]/.test(card));
ok_('a nickname in the recorder box falls back to the roster name', /function recorderFull\(d\)/.test(card));
ok_('the sex cell was narrowed to leave room for the class', /s2 = L \+ 270, s3 = L \+ 560/.test(card));
ok_('the injury types are sized to their frame, not to a fixed 14.5pt', /size6 -= 0\.5;/.test(card));
ok_('…and no longer capped at 3 lines', card.indexOf("wrap(ctx, INJ_TYPES_TH[k]") < 0);
ok_('Thai without spaces can still be broken', /function wrapLines\(ctx, s, maxW, size\)/.test(card));
ok_('page 2 prints the recorded wounds', /injWoundList\(d\)/.test(card));
ok_('page 2 ticks the treatment that was given', /tType === 'none'/.test(card) && /tType === 'treated'/.test(card));
ok_('…and where', /tPlaces\.indexOf\(p\[0\]\) >= 0/.test(card));
ok_('the ลักษณะ typo on the legend is fixed', card.indexOf('บาดแผลที่มแทง') < 0 && card.indexOf('บาดแผลถูกแทง') >= 0);

console.log('\n=== 9. line breaking really fits the box ===');
{
  // a stand-in for canvas: every character is 10 wide, which is all wrapLines needs to decide
  const ctx2 = { font: '', measureText: s => ({ width: String(s).length * 10 }), fillText: () => {}, fillStyle: '' };
  const sandbox = { window: {}, document: { fonts: null }, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, setTimeout, Promise };
  sandbox.window = sandbox;
  sandbox.document.createElement = () => ({ getContext: () => ctx2, width: 0, height: 0, toDataURL: () => 'data:,' });
  vm.createContext(sandbox);
  let loaded = true;
  try { vm.runInContext(card, sandbox); } catch (e) { loaded = false; console.log('  (report_card.js did not load in the sandbox: ' + e.message + ')'); }
  const W = sandbox.__wrapLinesForTest || null;
  if (!loaded || !W) {
    // wrapLines is module-private; check it through the source instead
    ok_('a run with no spaces is broken by character', /break the run/.test(card) && /word\.slice\(0, cut\)/.test(card));
  } else {
    const lines = W(ctx2, 'ถูกน้ำร้อนลวกหรือวัตถุร้อน', 100, 15);
    ok_('a Thai run with no spaces is broken', lines.length > 1);
    ok_('every line fits', lines.every(l => l.length * 10 <= 100));
  }
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
