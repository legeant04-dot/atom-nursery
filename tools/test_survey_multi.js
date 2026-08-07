/**
 * tools/test_survey_multi.js — a survey may now ask up to five questions.
 *   node tools/test_survey_multi.js
 *
 * The risk in this change is not the new path, it is the OLD one: surveys already created (and
 * already answered) must keep working exactly as before, without anything being rewritten in the
 * sheet. Half of what follows is about that.
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
const MONTH = new Date().toISOString().slice(0, 7);

function fresh() {
  const M = {
    config: { Plans: [], Departments: 'Nursery 1', SchoolName: 'Atom Nursery', LeaveQuota: {} },
    students: [{ StudentID: 'STD-01', NameTH: 'เด็กหนึ่ง', Nickname: 'หนึ่ง', Class: 'Nursery 1', Status: 'ACTIVE', DOB: '2023-01-01', ParentID: 'PAR-01' },
               { StudentID: 'STD-02', NameTH: 'เด็กสอง', Nickname: 'สอง', Class: 'Nursery 1', Status: 'ACTIVE', DOB: '2023-01-01', ParentID: 'PAR-02' }],
    staff: [{ StaffID: 'STF-A', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Department: 'Nursery 1' }],
    parents: [{ ParentID: 'PAR-01', NameTH: 'พ่อ', StudentID: 'STD-01', LineUID: 'U1' },
              { ParentID: 'PAR-02', NameTH: 'แม่', StudentID: 'STD-02', LineUID: 'U2' }],
    classes: [{ ClassID: 'C1', ClassName: 'Nursery 1', TeacherID: 'STF-A' }],
    surveys: [], surveyResponses: [], foodItems: [], foodMenus: [],
    userLinks: [{ UserUID: 'U1', StudentID: 'STD-01' }, { UserUID: 'U2', StudentID: 'STD-02' }],
    growthRecords: [], assessments: [], dspmCriteria: [], journals: [],
    payments: [], prepayments: [], studentCharges: [], paymentSlips: [], otDaily: [],
    otRecords: [], payroll: [], feed: [], injuryReports: [],
    checkinStudent: [], studentCheckins: [], studentAttendanceToday: [], staffAttendanceToday: [],
    activityLog: [], studentLeaves: [], comments: [], leaves: [], leaveUsed: {}, announcements: [],
    withdrawals: [], attendanceReq: [], classChangeReq: [], absenceLog: [], workSchedule: [], holidays: []
  };
  return { M, H: createAtomAPI(M).H };
}
const A = { staffId: 'STF-A' };
const P1 = { uid: 'U1', parentId: 'PAR-01', role: 'Parent' };
const P2 = { uid: 'U2', parentId: 'PAR-02', role: 'Parent' };
const Q = (text, type, options) => ({ text, type: type || 'rating', options: options || [] });

// ============================================================================
console.log('\n1) Up to five questions, of mixed kinds');
{
  const { H } = fresh();
  const s = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'ความพึงพอใจประจำเดือน', questions: [
    Q('พอใจอาหารกลางวันไหม', 'rating'),
    Q('พอใจการดูแลของครูไหม', 'rating'),
    Q('อยากให้เพิ่มกิจกรรมอะไร', 'vote', ['ว่ายน้ำ', 'ดนตรี', 'ศิลปะ']),
    Q('มีอะไรอยากบอกโรงเรียนไหม', 'comment') ] } });
  eq('four questions kept, in order', s.questions.map(q => q.text.slice(0, 6)),
    ['พอใจอาหา', 'พอใจการ', 'อยากให้เ', 'มีอะไรอ'].map(x => x.slice(0, 6)));
  eq('each keeps its own kind', s.questions.map(q => q.type), ['rating', 'rating', 'vote', 'comment']);
  eq('and the vote keeps its options', s.questions[2].options, ['ว่ายน้ำ', 'ดนตรี', 'ศิลปะ']);
  eq('the count is reported', s.questionCount, 4);
}
{
  const { H } = fresh();
  const five = [1, 2, 3, 4, 5].map(n => Q('ข้อ ' + n, 'rating'));
  eq('five is allowed', H.saveSurvey({ staffId: 'STF-A', survey: { title: 'x', questions: five } }).questionCount, 5);
  throws_('six is refused — the cap is the point', () =>
    H.saveSurvey({ staffId: 'STF-A', survey: { title: 'x', questions: five.concat([Q('ข้อ 6')]) } }), 'BAD_INPUT');
}
{
  const { H } = fresh();
  throws_('a survey with no question at all is refused', () =>
    H.saveSurvey({ staffId: 'STF-A', survey: { title: 'x', questions: [Q('   ')] } }), 'BAD_INPUT');
  throws_('a vote question with no options names WHICH question', () =>
    H.saveSurvey({ staffId: 'STF-A', survey: { title: 'x', questions: [Q('ก', 'rating'), Q('ข', 'vote', [])] } }), 'BAD_INPUT');
  try { H.saveSurvey({ staffId: 'STF-A', survey: { title: 'x', questions: [Q('ก', 'rating'), Q('ข', 'vote', [])] } }); }
  catch (e) { ok_('...by number, so it can be found', /ข้อ 2/.test(e.message)); }
}
{
  const { H } = fresh();
  const s = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'x', questions: [Q('ก'), Q('  '), Q('ค')] } });
  eq('a blank question is dropped, not saved as an empty one', s.questions.map(q => q.text), ['ก', 'ค']);
}

console.log('\n2) Answering all of them');
{
  const { M, H } = fresh();
  const s = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'x', questions: [
    Q('อาหาร', 'rating'), Q('เลือก', 'vote', ['ก', 'ข']), Q('บอกหน่อย', 'comment') ] } });
  H.submitSurvey(Object.assign({}, P1, { surveyId: s.surveyId, answers: [
    { rating: 5 }, { choice: 'ก' }, { comment: 'ดีมากค่ะ' } ] }));
  eq('one row per family, not one per question', M.surveyResponses.length, 1);
  const mine = H.openSurveys(P1)[0];
  eq('all three answers come back', mine.myAnswers.map(a => a.rating || a.choice || a.comment), [5, 'ก', 'ดีมากค่ะ']);
  eq('and they are marked as answered', mine.answered, true);
}
{
  const { H } = fresh();
  const s = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'x', questions: [Q('ก', 'rating'), Q('ข', 'rating')] } });
  throws_('missing an answer is refused', () =>
    H.submitSurvey(Object.assign({}, P1, { surveyId: s.surveyId, answers: [{ rating: 4 }] })), 'BAD_INPUT');
  try { H.submitSurvey(Object.assign({}, P1, { surveyId: s.surveyId, answers: [{ rating: 4 }] })); }
  catch (e) { ok_('and says which question is missing', /ข้อ 2/.test(e.message)); }
}
{
  const { M, H } = fresh();
  const s = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'x', questions: [Q('ก'), Q('ข')] } });
  H.submitSurvey(Object.assign({}, P1, { surveyId: s.surveyId, answers: [{ rating: 5 }, { rating: 5 }] }));
  H.submitSurvey(Object.assign({}, P1, { surveyId: s.surveyId, answers: [{ rating: 2 }, { rating: 3 }] }));
  eq('answering again edits, it does not add a row', M.surveyResponses.length, 1);
  eq('and every answer is updated', H.openSurveys(P1)[0].myAnswers.map(a => a.rating), [2, 3]);
}

console.log('\n3) Results, question by question');
{
  const { H } = fresh();
  const s = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'x', questions: [
    Q('อาหาร', 'rating'), Q('ครู', 'rating'), Q('กิจกรรม', 'vote', ['ก', 'ข']) ] } });
  H.submitSurvey(Object.assign({}, P1, { surveyId: s.surveyId, answers: [{ rating: 5 }, { rating: 3, comment: 'ครูใจดี' }, { choice: 'ก' }] }));
  H.submitSurvey(Object.assign({}, P2, { surveyId: s.surveyId, answers: [{ rating: 4 }, { rating: 3 }, { choice: 'ก' }] }));
  const r = H.surveyResults({ staffId: 'STF-A', surveyId: s.surveyId });
  eq('two families answered', r.responses, 2);
  eq('three question blocks', r.perQuestion.length, 3);
  eq('question 1 averages 5 and 4', r.perQuestion[0].average, 4.5);
  eq('question 2 averages 3', r.perQuestion[1].average, 3);
  eq('question 3 tallies the votes', r.perQuestion[2].tally, { 'ก': 2, 'ข': 0 });
  eq('no rating average is invented for a vote', r.perQuestion[2].average, null);
  eq('the comment sits with ITS question', [r.perQuestion[0].comments.length, r.perQuestion[1].comments.length], [0, 1]);
  eq('and the headline averages every rating given', r.average, 3.8);
}
{
  const { H } = fresh();
  const s = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'ลับ', anonymous: true, questions: [Q('ก'), Q('ข', 'comment')] } });
  H.submitSurvey(Object.assign({}, P1, { surveyId: s.surveyId, answers: [{ rating: 1 }, { comment: 'ไม่พอใจเรื่องนี้' }] }));
  const r = H.surveyResults({ staffId: 'STF-A', surveyId: s.surveyId });
  eq('the comment is counted', r.perQuestion[1].comments.length, 1);
  eq('but carries no name', r.perQuestion[1].comments[0].who, '');
  ok_('and no student id leaks anywhere in the payload', JSON.stringify(r).indexOf('STD-01') < 0);
}

console.log('\n4) The monthly number counts EVERY question, not just the first');
{
  const { H } = fresh();
  const s = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'x', questions: [Q('ก'), Q('ข'), Q('ค')] } });
  H.submitSurvey(Object.assign({}, P1, { surveyId: s.surveyId, answers: [{ rating: 5 }, { rating: 5 }, { rating: 2 }] }));
  const m = H.surveySummary({ staffId: 'STF-A', month: MONTH });
  eq('one family answered', m.responses, 1);
  eq('but three ratings were given', m.rated, 3);
  eq('so the average is of all three, not just question 1', m.average, 4);
  eq('and the survey line says how many questions it has', m.surveys[0].questionCount, 3);
}

console.log('\n5) Surveys made BEFORE this change still work, untouched');
{
  // exactly the shape the sheet already holds: Type/Options at survey level, no Questions column
  const { M, H } = fresh();
  M.surveys.push({ SurveyID: 'SV-001', Title: 'พอใจอาหารไหม', Description: '', Type: 'rating',
    Options: '[]', Scope: 'all', Target: '', StartDate: '', EndDate: '', Status: 'OPEN',
    Anonymous: '', CreatedBy: 'STF-A', CreatedAt: '2026-01-01 09:00' });
  const v = H.surveys(A)[0];
  eq('it reads back as a one-question survey', v.questionCount, 1);
  eq('using its title as the question', v.questions[0].text, 'พอใจอาหารไหม');
  eq('and keeps its kind', v.questions[0].type, 'rating');
  ok_('nothing was rewritten in the stored row', !M.surveys[0].Questions);
}
{
  const { M, H } = fresh();
  M.surveys.push({ SurveyID: 'SV-001', Title: 'พอใจอาหารไหม', Type: 'rating', Options: '[]',
    Scope: 'all', Status: 'OPEN', Anonymous: '', CreatedAt: '2026-01-01 09:00' });
  // an answer stored the old way, with no Answers column
  M.surveyResponses.push({ ResponseID: 'SR-0001', SurveyID: 'SV-001', StudentID: 'STD-01',
    ParentID: 'PAR-01', Rating: 4, Choice: '', Comment: 'อร่อย', SubmittedAt: MONTH + '-02 10:00' });
  const r = H.surveyResults({ staffId: 'STF-A', surveyId: 'SV-001' });
  eq('the old answer still counts', [r.responses, r.average], [1, 4]);
  eq('and its comment still shows', r.perQuestion[0].comments[0].comment, 'อร่อย');
  const mine = H.openSurveys(P1)[0];
  eq('the parent still sees what they said', mine.myAnswers[0].rating, 4);
  eq('the single-answer field is still there for older screens', mine.myAnswer.rating, 4);
}
{
  const { M, H } = fresh();
  M.surveys.push({ SurveyID: 'SV-001', Title: 'เลือกกิจกรรม', Type: 'vote', Options: '["ก","ข"]',
    Scope: 'all', Status: 'OPEN', Anonymous: '', CreatedAt: '2026-01-01 09:00' });
  // answered with the OLD single-field payload — a client that has not reloaded yet
  H.submitSurvey(Object.assign({}, P1, { surveyId: 'SV-001', choice: 'ก' }));
  eq('an old-style submission is accepted', H.surveyResults({ staffId: 'STF-A', surveyId: 'SV-001' }).perQuestion[0].tally, { 'ก': 1, 'ข': 0 });
}
{
  const { M, H } = fresh();
  const s = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'x', type: 'rating' } });   // no questions[]
  eq('a caller sending the OLD single-type shape gets one question', s.questionCount, 1);
  eq('taken from the title', s.questions[0].text, 'x');
  eq('and the legacy columns are still filled', [M.surveys[0].Type, M.surveys[0].Options], ['rating', '[]']);
}
{
  const { M, H } = fresh();
  const s = H.saveSurvey({ staffId: 'STF-A', survey: { title: 'x', questions: [Q('ก', 'vote', ['1', '2']), Q('ข')] } });
  eq('question 1 is mirrored into the old columns so the sheet stays readable', [M.surveys[0].Type, JSON.parse(M.surveys[0].Options)], ['vote', ['1', '2']]);
  H.submitSurvey(Object.assign({}, P1, { surveyId: s.surveyId, answers: [{ choice: '1' }, { rating: 5 }] }));
  eq('and answer 1 into the old answer columns', [M.surveyResponses[0].Choice, M.surveyResponses[0].Rating], ['1', 0]);
  ok_('with the full set stored alongside', !!M.surveyResponses[0].Answers);
}

console.log('\n6) Plumbing');
{
  const ge = fs.readFileSync(path.join(__dirname, '..', 'src', 'GasEngine.gs'), 'utf8');
  ok_('SURVEYS has a Questions column', /SURVEYS:[\s\S]{0,200}'Questions'/.test(ge));
  ok_('SURVEY_RESPONSES has an Answers column', /SURVEY_RESPONSES:[\s\S]{0,200}'Answers'/.test(ge));
  const app = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'app.js'), 'utf8');
  ok_('the admin can add a question', /A_svQAdd/.test(app));
  ok_('and remove one', /A_svQDel/.test(app));
  ok_('the cap is enforced in the UI too', /SV_MAX_Q=5/.test(app));
  ok_('the parent answers each question separately', /svv'\+i/.test(app) || /name="svv\$\{i\}"/.test(app));
  ok_('and results are shown per question', /perQuestion/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' : 'ALL PASS ') + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
