/**
 * tools/test_phase7.js — food menu per class, and the satisfaction survey.
 *   node tools/test_phase7.js
 *
 * The two things that matter most here are not the happy paths:
 *   - a parent must see THEIR child's menu, never another class's
 *   - "anonymous" must actually mean anonymous, including to an admin looking at the results
 */
const path = require('path'), fs = require('fs');
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function throws_(label, fn, code) {
  try { fn(); console.log('  FAIL ' + label + '  (did not throw)'); fail++; }
  catch (e) { const c = e && (e.code || e.apiCode); const ok = !code || c === code;
    console.log((ok ? '  ok   ' : '  FAIL ') + label + '  code=' + c); ok ? pass++ : fail++; }
}
const TODAY = (() => { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })();  // LOCAL date, like the engine's todayLocal(). A UTC date here silently disagrees with the
// engine for the 7 hours after 17:00 Bangkok time, and the suite fails for reasons nobody changed.
const MONTH = TODAY.slice(0, 7);
const D = n => MONTH + '-' + String(n).padStart(2, '0');

function fresh() {
  const M = {
    config: { Plans: [], Departments: 'Nursery 1\nNursery 2', SchoolName: 'Atom Nursery', LeaveQuota: {} },
    students: [
      { StudentID: 'STD-01', NameTH: 'เด็กหนึ่ง', Nickname: 'หนึ่ง', Class: 'Nursery 1', Status: 'ACTIVE', DOB: '2023-01-01', ParentID: 'PAR-01' },
      { StudentID: 'STD-02', NameTH: 'เด็กสอง', Nickname: 'สอง', Class: 'Nursery 2', Status: 'ACTIVE', DOB: '2023-01-01', ParentID: 'PAR-02' }],
    staff: [
      { StaffID: 'STF-A', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Department: 'Nursery 1' },
      { StaffID: 'STF-T', NameTH: 'ครู', Role: 'Teacher', PositionLevel: 'Staff', Department: 'Nursery 1' }],
    parents: [{ ParentID: 'PAR-01', NameTH: 'พ่อหนึ่ง', StudentID: 'STD-01', LineUID: 'U1' },
              { ParentID: 'PAR-02', NameTH: 'พ่อสอง', StudentID: 'STD-02', LineUID: 'U2' }],
    classes: [{ ClassID: 'C1', ClassName: 'Nursery 1', TeacherID: 'STF-T' },
              { ClassID: 'C2', ClassName: 'Nursery 2', TeacherID: 'STF-X' }],
    foodMenus: [], surveys: [], surveyResponses: [],
    userLinks: [{ UserUID: 'U1', StudentID: 'STD-01' }, { UserUID: 'U2', StudentID: 'STD-02' }],
    growthRecords: [], assessments: [], dspmCriteria: [],
    payments: [], prepayments: [], studentCharges: [], paymentSlips: [], otDaily: [],
    otRecords: [], payroll: [], feed: [], injuryReports: [],
    checkinStudent: [], studentCheckins: [], studentAttendanceToday: [], staffAttendanceToday: [],
    activityLog: [], studentLeaves: [], comments: [], leaves: [], leaveUsed: {}, announcements: [],
    withdrawals: [], attendanceReq: [], classChangeReq: [], absenceLog: []
  };
  return { M, H: createAtomAPI(M).H };
}
const P1 = { uid: 'U1', parentId: 'PAR-01', role: 'Parent' };
const P2 = { uid: 'U2', parentId: 'PAR-02', role: 'Parent' };

// ============================================================================
console.log('\n1) Food menu: the kitchen plans per class');
{
  const { M, H } = fresh();
  H.saveFoodMenu({ staffId: 'STF-A', className: 'Nursery 1', month: MONTH, days: [
    { date: D(1), breakfast: 'โจ๊กหมู', snackAM: 'กล้วย', lunch: 'ข้าวผัด', snackPM: 'นม', note: 'วันเกิดน้องหนึ่ง' },
    { date: D(2), lunch: 'ต้มจืด' }] });
  const r = H.foodMenu({ className: 'Nursery 1', month: MONTH });
  eq('two days saved', r.days.length, 2);
  eq('every meal kept', [r.days[0].breakfast, r.days[0].snackAM, r.days[0].lunch, r.days[0].snackPM],
    ['โจ๊กหมู', 'กล้วย', 'ข้าวผัด', 'นม']);
  eq('the note is kept', r.days[0].note, 'วันเกิดน้องหนึ่ง');
  eq('a day with only lunch is fine', r.days[1].lunch, 'ต้มจืด');
  ok_('who changed it and when is recorded', !!M.foodMenus[0].UpdatedBy && !!M.foodMenus[0].UpdatedAt);
}
{
  const { H } = fresh();
  H.saveFoodMenu({ staffId: 'STF-A', className: 'Nursery 1', month: MONTH, days: [{ date: D(1), lunch: 'ข้าวผัด' }] });
  H.saveFoodMenu({ staffId: 'STF-A', className: 'Nursery 1', month: MONTH, days: [{ date: D(1), lunch: 'ก๋วยเตี๋ยว' }] });
  eq('saving again edits the day, it does not duplicate it',
    H.foodMenu({ className: 'Nursery 1', month: MONTH }).days.map(d => d.lunch), ['ก๋วยเตี๋ยว']);
  H.saveFoodMenu({ staffId: 'STF-A', className: 'Nursery 1', month: MONTH, days: [{ date: D(1) }] });
  eq('clearing a day removes it', H.foodMenu({ className: 'Nursery 1', month: MONTH }).days.length, 0);
}
{
  const { H } = fresh();
  H.saveFoodMenu({ staffId: 'STF-A', className: 'Nursery 1', month: MONTH,
    days: [{ date: D(1), lunch: 'ในเดือน' }, { date: '2020-01-05', lunch: 'นอกเดือน' }] });
  eq('a date outside the month being edited is refused, not written',
    H.foodMenu({ className: 'Nursery 1', month: MONTH }).days.map(d => d.lunch), ['ในเดือน']);
}
{
  const { H } = fresh();
  throws_('a teacher cannot rewrite the menu', () =>
    H.saveFoodMenu({ staffId: 'STF-T', className: 'Nursery 1', month: MONTH, days: [] }), 'NO_PERMISSION');
  throws_('nor can a parent', () =>
    H.saveFoodMenu({ className: 'Nursery 1', month: MONTH, days: [] }), 'NO_PERMISSION');
  // v220: the kitchen cooks once a day for everyone, so there is no class to name any more
  H.saveFoodMenu({ staffId: 'STF-A', month: MONTH, days: [{ date: D(1), lunch: 'ของทั้งโรงเรียน' }] });
  eq('no class is needed to save a menu', H.foodMenu({ month: MONTH }).days.map(d => d.lunch), ['ของทั้งโรงเรียน']);
}

console.log("\n2) Every family sees the SAME food — but only the meals their own child is served");
{
  // v220. The school cooks one menu a day for everyone; what differs by class is which MEALS they
  // get: Nursery Baby records none, Nursery 1 stays for dinner, Nursery 2 / 3 / Premium go home
  // before it. So the dish must be identical for both families, and the dinner must not be.
  const { H } = fresh();
  H.saveFoodMenu({ staffId: 'STF-A', month: MONTH,
    days: [{ date: D(1), lunch: 'ข้าวมันไก่', dinner: 'ข้าวต้ม' }] });
  const a = H.myFoodMenu(Object.assign({}, P1, { month: MONTH }));   // Nursery 1
  const b = H.myFoodMenu(Object.assign({}, P2, { month: MONTH }));   // Nursery 2
  eq('both families are served the same lunch', [a.days[0].lunch, b.days[0].lunch], ['ข้าวมันไก่', 'ข้าวมันไก่']);
  eq('Nursery 1 is offered dinner', a.slots.map(s => s.key).indexOf('Dinner') >= 0, true);
  eq('Nursery 2 is NOT', b.slots.map(s => s.key).indexOf('Dinner') >= 0, false);
  eq('the child\'s class is still resolved for them', [a.className, b.className], ['Nursery 1', 'Nursery 2']);
  ok_('...and never asked for', !('className' in P1));
}
{
  const { M, H } = fresh();
  M.userLinks.push({ UserUID: 'U1', StudentID: 'STD-02' });      // a family with children in two classes
  H.saveFoodMenu({ staffId: 'STF-A', month: MONTH, days: [{ date: D(1), lunch: 'ก๋วยเตี๋ยว' }] });
  const r = H.myFoodMenu(Object.assign({}, P1, { studentId: 'STD-02', month: MONTH }));
  eq('a second child can be picked', [r.className, r.days[0].lunch], ['Nursery 2', 'ก๋วยเตี๋ยว']);
  eq('and both children are offered', r.kids.length, 2);
}
{
  // menus typed per class BEFORE this change must not vanish — they are the fallback for any day
  // with no shared menu, and the fullest one wins so the least is lost
  const { M, H } = fresh();
  M.foodMenus.push({ MenuID: 'FM-N1', Class: 'Nursery 1', Date: D(1), Lunch: 'เมนูเก่า 1', Dinner: 'เย็นเก่า' },
                   { MenuID: 'FM-N2', Class: 'Nursery 2', Date: D(1), Lunch: 'เมนูเก่า 2' });
  eq('an old per-class menu still shows', H.foodMenu({ month: MONTH }).days[0].lunch, 'เมนูเก่า 1');
  eq('...and is flagged as coming from one', H.foodMenu({ month: MONTH }).days[0].legacyClass, 'Nursery 1');
  H.saveFoodMenu({ staffId: 'STF-A', month: MONTH, days: [{ date: D(1), lunch: 'เมนูใหม่' }] });
  eq('a shared menu replaces it', H.foodMenu({ month: MONTH }).days[0].lunch, 'เมนูใหม่');
  eq('...and stops being flagged', H.foodMenu({ month: MONTH }).days[0].legacyClass, '');
  H.saveFoodMenu({ staffId: 'STF-A', month: MONTH, days: [{ date: D(1) }] });
  eq('clearing a day clears it for good — the old class menus go too', H.foodMenu({ month: MONTH }).days.length, 0);
}

console.log('\n3) Survey: three shapes, and who gets asked');
{
  const { H } = fresh();
  const s = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'พอใจอาหารไหม', type: 'rating' } });
  ok_('created with an id', !!s.surveyId);
  eq('open by default', s.status, 'OPEN');
  eq('asked of everyone by default', s.scope, 'all');
  eq('parent 1 is asked', H.openSurveys(P1).length, 1);
  eq('parent 2 is asked too', H.openSurveys(P2).length, 1);
}
{
  const { H } = fresh();
  H.saveSurvey({ staffId: 'STF-A', survey: { title: 'เฉพาะชั้น 1', type: 'rating', scope: 'class', target: 'Nursery 1' } });
  eq('a class survey reaches that class', H.openSurveys(P1).length, 1);
  eq('...and nobody else', H.openSurveys(P2).length, 0);
}
{
  const { H } = fresh();
  H.saveSurvey({ staffId: 'STF-A', survey: { title: 'เฉพาะน้องสอง', type: 'comment', scope: 'student', target: 'STD-02' } });
  eq('a one-child survey reaches only that family', [H.openSurveys(P1).length, H.openSurveys(P2).length], [0, 1]);
}
{
  const { H } = fresh();
  throws_('a vote with no options is refused', () =>
    H.saveSurvey({ staffId: 'STF-A', survey: { title: 'x', type: 'vote', options: [] } }), 'BAD_INPUT');
  throws_('an untitled survey is refused', () =>
    H.saveSurvey({ staffId: 'STF-A', survey: { title: '  ', type: 'rating' } }), 'BAD_INPUT');
  throws_('a teacher cannot create one', () =>
    H.saveSurvey({ staffId: 'STF-T', survey: { title: 'x' } }), 'NO_PERMISSION');
  throws_('a parent cannot read the list', () => H.surveys(P1), 'NO_PERMISSION');
}
{
  const { H } = fresh();
  const s = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'x', type: 'rating', startDate: '2099-01-01' } });
  eq('a survey that has not started yet is not shown', H.openSurveys(P1).length, 0);
  H.saveSurvey({ staffId: 'STF-A', survey: { surveyId: s.surveyId, title: 'x', type: 'rating', endDate: '2000-01-01' } });
  eq('nor one that has finished', H.openSurveys(P1).length, 0);
}

console.log('\n4) Answering: once per family, and editable');
{
  const { M, H } = fresh();
  const s = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'อาหาร', type: 'rating' } });
  H.submitSurvey(Object.assign({}, P1, { surveyId: s.surveyId, rating: 5, comment: 'อร่อยมาก' }));
  eq('one answer stored', M.surveyResponses.length, 1);
  const again = H.submitSurvey(Object.assign({}, P1, { surveyId: s.surveyId, rating: 3 }));
  eq('answering again UPDATES, it does not stuff the ballot', [M.surveyResponses.length, again.updated], [1, true]);
  eq('and the new value is what counts', Number(M.surveyResponses[0].Rating), 3);
  const mine = H.openSurveys(P1)[0];
  eq('the parent sees they already answered', mine.answered, true);
  eq('and what they said', mine.myAnswer.rating, 3);
}
{
  const { H } = fresh();
  const s = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'อาหาร', type: 'rating' } });
  throws_('a rating survey needs a rating', () =>
    H.submitSurvey(Object.assign({}, P1, { surveyId: s.surveyId, comment: 'ดี' })), 'BAD_INPUT');
  H.setSurveyStatus({ staffId: 'STF-A', surveyId: s.surveyId });
  throws_('a closed survey takes no more answers', () =>
    H.submitSurvey(Object.assign({}, P1, { surveyId: s.surveyId, rating: 5 })), 'CLOSED');
  eq('and it disappears from the parent\'s list', H.openSurveys(P1).length, 0);
  H.setSurveyStatus({ staffId: 'STF-A', surveyId: s.surveyId, reopen: true });
  eq('reopening brings it back', H.openSurveys(P1).length, 1);
}
{
  const { H } = fresh();
  const s = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'เลือก', type: 'vote', options: ['ก', 'ข'] } });
  throws_('a vote needs a choice', () =>
    H.submitSurvey(Object.assign({}, P1, { surveyId: s.surveyId })), 'BAD_INPUT');
  const c = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'บอกหน่อย', type: 'comment' } });
  throws_('a comment survey needs words', () =>
    H.submitSurvey(Object.assign({}, P1, { surveyId: c.surveyId, comment: '   ' })), 'BAD_INPUT');
}
{
  const { H } = fresh();
  const s = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'x', type: 'rating' } });
  throws_('a parent cannot answer for another family\'s child', () =>
    H.submitSurvey(Object.assign({}, P1, { surveyId: s.surveyId, studentId: 'STD-02', rating: 5 })), 'NO_ACCESS');
}

console.log('\n5) Results, and the anonymity promise');
{
  const { H } = fresh();
  const s = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'อาหาร', type: 'rating' } });
  H.submitSurvey(Object.assign({}, P1, { surveyId: s.surveyId, rating: 5, comment: 'อร่อย' }));
  H.submitSurvey(Object.assign({}, P2, { surveyId: s.surveyId, rating: 3 }));
  const r = H.surveyResults({ staffId: 'STF-A', surveyId: s.surveyId });
  eq('two answers', r.responses, 2);
  eq('average of 5 and 3', r.average, 4);
  eq('distribution across 1..5', r.dist, [0, 0, 1, 0, 1]);
  eq('one written comment', r.comments.length, 1);
  eq('and it is attributed, because this survey is not anonymous', r.comments[0].who, 'หนึ่ง');
}
{
  const { H } = fresh();
  const s = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'ลับ', type: 'rating', anonymous: true } });
  H.submitSurvey(Object.assign({}, P1, { surveyId: s.surveyId, rating: 1, comment: 'ไม่พอใจเรื่องนี้' }));
  const r = H.surveyResults({ staffId: 'STF-A', surveyId: s.surveyId });
  eq('the comment is still counted', r.comments.length, 1);
  eq('but NO name comes back, even to an admin', r.comments[0].who, '');
  ok_('and no student id leaks in the payload either', JSON.stringify(r).indexOf('STD-01') < 0);
}
{
  const { H } = fresh();
  const s = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'เลือก', type: 'vote', options: ['ก', 'ข', 'ค'] } });
  H.submitSurvey(Object.assign({}, P1, { surveyId: s.surveyId, choice: 'ก' }));
  H.submitSurvey(Object.assign({}, P2, { surveyId: s.surveyId, choice: 'ก' }));
  const r = H.surveyResults({ staffId: 'STF-A', surveyId: s.surveyId });
  eq('votes are tallied, including the ones nobody picked', r.tally, { 'ก': 2, 'ข': 0, 'ค': 0 });
  eq('no rating average is invented for a vote', r.average, null);
}
{
  const { H } = fresh();
  const s = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'x', type: 'rating' } });
  throws_('a parent cannot read the results', () =>
    H.surveyResults(Object.assign({}, P1, { surveyId: s.surveyId })), 'NO_PERMISSION');
  throws_('nor a teacher', () =>
    H.surveyResults({ staffId: 'STF-T', surveyId: s.surveyId }), 'NO_PERMISSION');
}

console.log('\n6) Monthly summary, and deleting');
{
  const { H } = fresh();
  const a = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'อาหาร', type: 'rating' } });
  const b = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'ครู', type: 'rating' } });
  H.submitSurvey(Object.assign({}, P1, { surveyId: a.surveyId, rating: 4 }));
  H.submitSurvey(Object.assign({}, P2, { surveyId: a.surveyId, rating: 2 }));
  H.submitSurvey(Object.assign({}, P1, { surveyId: b.surveyId, rating: 5 }));
  const m = H.surveySummary({ staffId: 'STF-A', month: MONTH });
  eq('three answers this month', m.responses, 3);
  eq('overall average', m.average, 3.7);
  eq('ranked by how many answered', m.surveys.map(x => x.title), ['อาหาร', 'ครู']);
  eq('per-survey average', m.surveys[0].average, 3);
  eq('a month with nothing in it reports zero, not an error', H.surveySummary({ staffId: 'STF-A', month: '2019-01' }).responses, 0);
}
{
  const { M, H } = fresh();
  const s = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'x', type: 'rating' } });
  H.submitSurvey(Object.assign({}, P1, { surveyId: s.surveyId, rating: 5 }));
  const r = H.deleteSurvey({ staffId: 'STF-A', surveyId: s.surveyId });
  eq('deleting says how many answers went with it', r.removedResponses, 1);
  eq('the survey is gone', M.surveys.length, 0);
  eq('and so are its answers — no orphans left behind', M.surveyResponses.length, 0);
  throws_('a parent cannot delete a survey', () =>
    H.deleteSurvey(Object.assign({}, P1, { surveyId: 'SV-001' })), 'NO_PERMISSION');
}
{
  const { M, H } = fresh();
  const a = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'เก็บไว้', type: 'rating' } });
  const b = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'ลบทิ้ง', type: 'rating' } });
  H.submitSurvey(Object.assign({}, P1, { surveyId: a.surveyId, rating: 5 }));
  H.submitSurvey(Object.assign({}, P1, { surveyId: b.surveyId, rating: 1 }));
  H.deleteSurvey({ staffId: 'STF-A', surveyId: b.surveyId });
  eq('another survey\'s answers are untouched', M.surveyResponses.map(r => r.SurveyID), [a.surveyId]);
}

console.log('\n7) The plumbing that would otherwise lose everything silently');
{
  const ge = fs.readFileSync(path.join(__dirname, '..', 'src', 'GasEngine.gs'), 'utf8');
  ['FOOD_MENU', 'SURVEYS', 'SURVEY_RESPONSES'].forEach(s =>
    ok_(s + ' has declared headers so the sheet can be created', new RegExp(s + ':\\s*\\[').test(ge)));
  ok_('a write creates the sheet first (writeRows_ silently drops a missing sheet)',
    /function writeCollection_[\s\S]{0,200}ensureCollectionSheet_/.test(ge));
  ok_('an UNKNOWN sheet is never invented — that would hide a typo',
    /if \(!hdr\) return null/.test(ge));
  ['foodMenus', 'surveys', 'surveyResponses'].forEach(k =>
    ok_(k + ' is mapped to a sheet so persist() writes it', new RegExp(k + ':\\s*\\{ wb:').test(ge)));

  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'Code.gs'), 'utf8');
  ['surveys', 'saveSurvey', 'setSurveyStatus', 'deleteSurvey', 'surveyResults', 'surveySummary']
    .forEach(a => ok_(a + ' is admin-gated at the router too', new RegExp('\\b' + a + ': 1').test(code)));
  // saveFoodMenu is the exception, and deliberately so: it is the one action an admin can DELEGATE
  // to a teacher (CanFoodMenu). ADMIN_ONLY cannot see that flag, so listing it here refused the very
  // teacher the admin had just put in charge. The engine's canFoodMenu_ is the gate — see
  // tools/test_food_perm.js, which proves an untick is still refused.
  ok_('saveFoodMenu is NOT router-gated, so a delegated teacher can save',
    !/\bsaveFoodMenu: 1/.test(code));
  ok_('no explicit route shadows the engine for Phase 7',
    !/\b(saveFoodMenu|saveSurvey|submitSurvey|deleteSurvey)\s*:\s*function/.test(code));

  // every mutating action must be recognised as one by BOTH regexes, or it skips the write lock
  const MUT = /^(submit|save|add|remove|delete|set|register|pay|upload|confirm|reject|issue|generate|move|import|compute|cancel|prepay|link|notify|request|mark|approve|edit|rename|update|change|seed|recompute|restore|bind|provision)/i;
  ['saveFoodMenu', 'saveSurvey', 'setSurveyStatus', 'deleteSurvey', 'submitSurvey']
    .forEach(a => ok_(a + ' is recognised as a write', MUT.test(a)));
  ['foodMenu', 'myFoodMenu', 'openSurveys', 'surveyResults', 'surveySummary']
    .forEach(a => ok_(a + ' is correctly NOT a write', !MUT.test(a)));
}

console.log('\n8) The printed A4 menu is built on the device like everything else');
{
  const rc = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'report_card.js'), 'utf8');
  ok_('there is a menu renderer', /function renderMenu/.test(rc));
  ok_('it reuses the same offline PDF writer', /saveMenu[\s\S]{0,400}buildPdf/.test(rc));
  ok_('still nothing is uploaded', !/\bfetch\s*\(|XMLHttpRequest|FormData/.test(rc));
  ok_('long months spill onto a second sheet', /PER = \d+/.test(rc));
  ok_('the sheet warns about allergies', /แพ้/.test(rc));
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' : 'ALL PASS ') + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
