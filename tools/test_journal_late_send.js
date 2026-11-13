/**
 * tools/test_journal_late_send.js — the admin's report calendar, the late send, and the two exports
 *   node tools/test_journal_late_send.js
 *
 * Asked 2026-11-06, with the school's decisions taken the same day:
 *   · สมุดรายงานประจำวัน as a month calendar — a 60% circle on each day: GREEN when every child who came
 *     has a SENT report, RED when not; the chosen day underneath, one collapsible section per class.
 *   · a draft the teacher forgot to send can go out LATE — as written, within 7 days, the family told
 *     as usual, kept as the report of the day it was written for.
 *   · 📤 ดึงข้อมูลรายชื่อ: staff (everything but salary/bank) and parents+students AS FAMILIES, children
 *     still enrolled only.
 *
 *   1  journalMonth: green/red by the children who CAME; a draft is not sent; no dot on a day nobody came
 *   2  exportFamilies: two parents sharing a child + a sibling are ONE family; father → mother → child;
 *      a withdrawn child and a parent whose only child left are not in the file; an unlinked parent is
 *   3  the late-send window, in the engine: yesterday yes, 8 days back TOO_LATE, tomorrow BAD_INPUT
 *   4  🔴 through the REAL dispatch_ with REAL sessions: both new reads are admin-only; the live
 *      Journal.gs route sends yesterday's draft unchanged and refuses one 8 days old
 *   5  the screens: the calendar, the late send on the class screen, the export menu
 */
'use strict';
const path = require('path'), fs = require('fs');
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  console.log((okk ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (okk ? '' : ' want=' + JSON.stringify(want)));
  okk ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function code_(fn) { try { fn(); return 'NO_THROW'; } catch (e) { return e.apiCode || e.code || String(e); } }

const p2 = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const dayOff = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return ymd(d); };
const TODAY = dayOff(0), Y1 = dayOff(-1), Y2 = dayOff(-2), Y8 = dayOff(-8);

// ============================================================================
console.log('\n1) journalMonth — green means every child who came has a SENT report');
{
  const M = {
    config: {}, classes: [{ ClassName: 'N1' }], staff: [],
    students: [{ StudentID: 'A', Class: 'N1', Status: 'ACTIVE' }, { StudentID: 'B', Class: 'N1', Status: 'ACTIVE' }, { StudentID: 'C', Class: 'N1', Status: 'ACTIVE' }],
    studentCheckins: [
      { Date: Y1, StudentID: 'A', InTime: '08:00' }, { Date: Y1, StudentID: 'B', InTime: '08:10' },
      { Date: Y2, StudentID: 'A', InTime: '08:00' }, { Date: Y2, StudentID: 'B', InTime: '08:05' },
      { Date: Y2, StudentID: 'C', InTime: '' }                                    // a row with no IN = did not come
    ],
    journals: [
      { Date: Y1, StudentID: 'A', Status: 'SUBMITTED' }, { Date: Y1, StudentID: 'B', Status: '' },   // blank = legacy sent
      { Date: Y2, StudentID: 'A', Status: 'SUBMITTED' }, { Date: Y2, StudentID: 'B', Status: 'DRAFT' }
    ],
    parents: [], userLinks: [], holidays: [], activityLog: []
  };
  const H = createAtomAPI(M).H;
  const months = [...new Set([Y1.slice(0, 7), Y2.slice(0, 7)])];
  const days = Object.assign({}, ...months.map(m => H.journalMonth({ month: m }).days));
  eq(Y1 + ': both who came were sent → green', days[Y1] && days[Y1].complete, true);
  eq(Y2 + ': B only has a DRAFT → red', days[Y2] && days[Y2].complete, false);
  eq(Y2 + ': C had a row with no check-in time — not counted as came', days[Y2] && days[Y2].came.sort(), ['A', 'B']);
  ok_('a day nobody came carries no entry (no dot)', !days[dayOff(-3)] || dayOff(-3).slice(0, 7) !== Y1.slice(0, 7) || !days[dayOff(-3)]);
  eq('a bad month is refused', code_(() => H.journalMonth({ month: '2026-13x' })), 'BAD_INPUT');
}

// ============================================================================
console.log('\n2) exportFamilies — everyone joined by a link is one family, father → mother → children');
{
  const M = {
    config: {}, classes: [], staff: [], journals: [], holidays: [], activityLog: [],
    students: [
      { StudentID: 'S1', NameTH: 'ด.ญ. เลอา', Nickname: 'เลอา', Class: 'N2', Status: 'ACTIVE', DOB: '2022-05-01' },
      { StudentID: 'S2', NameTH: 'ด.ช. ลีโอ', Nickname: 'ลีโอ', Class: 'N1', Status: 'ACTIVE', DOB: '2023-08-01', ParentID: 'P-DAD' },
      { StudentID: 'S3', NameTH: 'ด.ช. กาย', Nickname: 'กาย', Class: 'N1', Status: 'ACTIVE', DOB: '2023-01-01' },
      { StudentID: 'S9', NameTH: 'ด.ช. ลาออก', Nickname: 'ออก', Class: 'N1', Status: 'WITHDRAWN', DOB: '2022-01-01' }
    ],
    parents: [
      { ParentID: 'P-MOM', NameTH: 'แม่เลอา', Relationship: 'มารดา', LineUID: 'U-MOM', Phone: '0811111111' },
      { ParentID: 'P-DAD', NameTH: 'พ่อเลอา', Relationship: 'บิดา', LineUID: 'U-DAD', NationalID: '1100000000001' },
      { ParentID: 'P-GUY', NameTH: 'แม่กาย', Relationship: 'แม่', StudentID: 'S3' },
      { ParentID: 'P-GONE', NameTH: 'แม่ลาออก', Relationship: 'แม่', StudentID: 'S9' },
      { ParentID: 'P-LOOSE', NameTH: 'ไม่มีลูก', Relationship: 'ป้า' }
    ],
    // mother linked to both children by LINE, father to S1 by LINE and to S2 by the legacy pointer
    userLinks: [{ UserUID: 'U-MOM', StudentID: 'S1' }, { UserUID: 'U-MOM', StudentID: 'S2' }, { UserUID: 'U-DAD', StudentID: 'S1' }]
  };
  const r = createAtomAPI(M).H.exportFamilies();
  const fam = r.families.map(f => ({ p: f.parents.map(x => x.parentId), c: f.children.map(x => x.studentId) }));
  eq('two families: the siblings with both parents, and กาย with his mother', fam,
     [{ p: ['P-GUY'], c: ['S3'] }, { p: ['P-DAD', 'P-MOM'], c: ['S1', 'S2'] }]);
  ok_('father before mother, children oldest first', fam[1] && fam[1].p[0] === 'P-DAD' && fam[1].c[0] === 'S1');
  ok_('🔴 a withdrawn child and the parent whose only child left are not in the file',
    !JSON.stringify(r.families).includes('S9') && !JSON.stringify(r.families).includes('P-GONE'));
  eq('a parent linked to nobody is listed separately', r.unlinkedParents.map(x => x.parentId), ['P-LOOSE']);
  ok_('the fields the sheet prints are there', r.families[1].parents[0].nationalId === '1100000000001' && r.families[1].parents[1].line === true
    && r.families[1].children[0].class === 'N2' && r.families[1].children[0].dob === '2022-05-01');
}

// ============================================================================
console.log('\n3) the late-send window, in the engine');
{
  const mk = () => ({
    config: {}, classes: [{ ClassName: 'N1' }],
    staff: [{ StaffID: 'T1', Role: 'Teacher', PositionLevel: 'Staff', Department: 'N1', Classes: 'N1', Status: 'ACTIVE', StartDate: '2024-01-01' }],
    students: [{ StudentID: 'A', Class: 'N1', Status: 'ACTIVE' }],
    journals: [{ Date: Y1, StudentID: 'A', TeacherID: 'T1', Status: 'DRAFT', Mood: 'ยิ้ม', Theme: 'ผีเสื้อ' },
               { Date: Y8, StudentID: 'A', TeacherID: 'T1', Status: 'DRAFT', Mood: 'ยิ้ม' }],
    parents: [], userLinks: [], holidays: [], activityLog: [], studentCheckins: [], studentAttendanceToday: []
  });
  const M = mk(), H = createAtomAPI(M).H;
  const r = H.submitJournalsMany({ staffId: 'T1', studentIds: ['A'], date: Y1 });
  eq('yesterday\'s draft is sent', r.sent.map(x => x.studentId), ['A']);
  const j = M.journals.find(x => x.Date === Y1);
  ok_('...kept as yesterday\'s report, content untouched', j.Status === 'SUBMITTED' && j.Theme === 'ผีเสื้อ' && j.Date === Y1);
  eq('8 days back is too late', code_(() => H.submitJournalsMany({ staffId: 'T1', studentIds: ['A'], date: Y8 })), 'TOO_LATE');
  eq('...and that draft is still a draft', M.journals.find(x => x.Date === Y8).Status, 'DRAFT');
  eq('tomorrow is refused', code_(() => H.submitJournalsMany({ staffId: 'T1', studentIds: ['A'], date: dayOff(1) })), 'BAD_INPUT');
}

// ============================================================================
console.log('\n4) 🔴 through the real dispatch_ — who may read, and the live late send');
{
  const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin', 'Triggers', 'Leave',
    'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup', 'PaySlips', 'PayAdjust', 'Password', 'Certificate', 'Dspm',
    'BillRun', 'GasEngine', 'Engine', 'Day6', 'Journal', 'Perf']);
  // the harness runs fn.toString() inside the sandbox, so the two dates are written into the source
  const res = JSON.parse(run(eval(`(function () { var Y1 = '${Y1}', Y8 = '${Y8}';
    _configCache = null; setupAll(); _configCache = null;
    setConfigValue_('RequireSessionToken', 'true'); _configCache = null;
    var main = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
    appendObject_(sheet_(main, 'CLASSES'), { ClassID: 'C1', ClassName: 'Nursery 1', TeacherID: 'STF-T1' });
    appendObject_(sheet_(main, 'STUDENTS'), { StudentID: 'STD-1', Name: 'เด็กหนึ่ง', Nickname: 'หนึ่ง', Class: 'Nursery 1', Status: 'ACTIVE' });
    appendObject_(sheet_(main, 'PARENTS'), { ParentID: 'PAR-1', Name: 'แม่หนึ่ง', Relationship: 'มารดา', StudentID: 'STD-1', LineUID: 'U-PAR-1' });
    appendObject_(sheet_(main, 'DAILY_JOURNAL'), { Date: Y1, StudentID: 'STD-1', TeacherID: 'STF-T1', Status: 'DRAFT', Mood: 'ยิ้ม', Theme: 'ผีเสื้อ' });
    appendObject_(sheet_(main, 'DAILY_JOURNAL'), { Date: Y8, StudentID: 'STD-1', TeacherID: 'STF-T1', Status: 'DRAFT', Mood: 'ยิ้ม' });
    appendObject_(sheet_(hr, 'STAFF'), { StaffID: 'STF-T1', Name: 'ครูหนึ่ง', Role: 'Teacher', PositionLevel: 'Teacher', Department: 'Nursery 1', Status: 'ACTIVE', StartDate: '2025-01-01', LineUID: 'U-STF-T1' });
    appendObject_(sheet_(hr, 'STAFF'), { StaffID: 'STF-A', Name: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', StartDate: '2025-01-01', LineUID: 'U-STF-A' });
    try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}
    var tok = { T: issueSession_('U-STF-T1', 'Teacher', 'STF-T1'), A: issueSession_('U-STF-A', 'Admin', 'STF-A'),
                P: issueSession_('U-PAR-1', 'Parent', 'PAR-1') };
    function call(a, p, t) { var j = JSON.parse(dispatch_(a, p || {}, t).getContent()); return j.ok ? j.data : { ERR: j.error.code }; }
    var out = {};
    ['T', 'P', 'A'].forEach(function (k) { out[k] = { month: call('journalMonth', { month: Y1.slice(0, 7) }, tok[k]), fam: call('exportFamilies', {}, tok[k]) }; });
    out.lateOld = call('submitJournalsMany', { studentIds: ['STD-1'], date: Y8 }, tok.T);
    out.late = call('submitJournalsMany', { studentIds: ['STD-1'], date: Y1 }, tok.T);
    var rows = readObjects_(sheet_(main, 'DAILY_JOURNAL'));
    out.rowY1 = rows.filter(function (r) { return ymdCell_(r.Date) === Y1; }).map(function (r) { return { s: r.Status, th: r.Theme }; });
    out.rowY8 = rows.filter(function (r) { return ymdCell_(r.Date) === Y8; }).map(function (r) { return r.Status; });
    return JSON.stringify(out);
  })`)));
  eq('a teacher cannot read the school\'s calendar', res.T.month, { ERR: 'NO_PERMISSION' });
  eq('...nor export the families', res.T.fam, { ERR: 'NO_PERMISSION' });
  eq('a parent cannot read the calendar', res.P.month, { ERR: 'NO_PERMISSION' });
  eq('...nor export the families', res.P.fam, { ERR: 'NO_PERMISSION' });
  ok_('the admin gets the month', !!(res.A.month && res.A.month.days));
  ok_('the admin gets the families', !!(res.A.fam && Array.isArray(res.A.fam.families)) && res.A.fam.families.length === 1);
  eq('live: a draft 8 days old is TOO_LATE', res.lateOld, { ERR: 'TOO_LATE' });
  eq('live: yesterday\'s draft is sent', res.late && res.late.sent && res.late.sent.map(x => x.studentId), ['STD-1']);
  eq('...as yesterday\'s report, content untouched', res.rowY1, [{ s: 'SUBMITTED', th: 'ผีเสื้อ' }]);
  eq('...and the old one is still a draft', res.rowY8, ['DRAFT']);
}

// ============================================================================
console.log('\n5) the screens, and the wording the family receives');
{
  const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
  const app = R('webapp/app.js'), jgs = R('src/Journal.gs'), css = R('webapp/styles.css'), perf = R('src/Perf.gs');
  const aj = app.slice(app.indexOf('window.A_journals = async'), app.indexOf('// Read-only view of a submitted report'));
  ok_('the calendar asks journalMonth and draws one modal, redrawn in place', /api\('journalMonth'/.test(aj) && /getElementById\('ajSheet'\)/.test(aj));
  ok_('each class is a collapsible <details>, incomplete ones open', /<details class="card jcls" \$\{full\?'':'open'\}/.test(aj));
  ok_('the circle is 60% opacity, green and red', /\.jcal \.jd::before\{[^}]*opacity:\.6/.test(css) && /\.jd\.ok::before\{background:var\(--ok\)/.test(css) && /\.jd\.bad::before\{background:var\(--bad\)/.test(css));
  ok_('a late report is marked for the admin', /ส่งย้อนหลัง/.test(aj));
  const send = app.slice(app.indexOf('window.T_sendMany = async'), app.indexOf('window.T_recallMany'));
  ok_('the class screen sends a past day WITH its date', /date:late/.test(send));
  ok_('...and draws the boxes on a past day only inside the window', /T_lateOK\(onDay\) \? T_pickBox\(s, jdone\[s\.StudentID\], true\)/.test(app));
  ok_('...with no recall button on a past day', /\(isHeadRole\(\)&&!lateDay\)/.test(app));
  ok_('the family\'s message says it was sent late', /\(late \? ' · ส่งย้อนหลัง' : ''\)/.test(jgs));
  ok_('TOO_LATE is an expected refusal, not a fault', /TOO_LATE: 1/.test(perf));
  ok_('the export menu has both items', /'A_exportStaffFull\(this\)'/.test(app) && /'A_exportFamilies\(this\)'/.test(app));
  const ex = app.slice(app.indexOf('window.A_exportStaffFull'), app.indexOf('window.A_exportFamilies'));
  ok_('🔴 the staff file carries no salary or bank', !/BaseSalary|BankAccount|BankName/.test(ex));
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
