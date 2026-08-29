/**
 * tools/test_insurance_form.js — the insurance form the family actually has to use.
 *   node tools/test_insurance_form.js
 *
 * Five things the school asked for on 2026-08-29, and one bug found while doing them.
 *
 *   1. The heading said "เด็กที่บาดเจ็บ" — the injury form's wording, on the insurance form. A
 *      parent opening it was told their child was hurt.
 *   2. Every dropdown was English on a Thai screen: Father / Mother / Single / Male. The TRAP here
 *      is that the insurer's own workbook only accepts the English words, so the Thai must be a
 *      LABEL and the stored value must not move. Translating the value would have looked identical
 *      on screen and silently broken the export — which is the case this file exists to hold shut.
 *   3. The form did not pre-fill. It read MOCK.students, which on GAS is deliberately EMPTY (the
 *      live roster is never shipped to the browser), so `s` was always {} and every parent retyped
 *      a name, a national ID and a date of birth the school already had — into a form where a typo
 *      is a rejected claim. insuranceStatus was already returning the student; nothing was reading it.
 *   4. Fill-once. A mistyped bank account number — the number a claim is paid INTO — was permanent.
 *   5. The read-back screen showed 9 of 21 fields, so "please check your details" could not be done.
 *
 * And the money-shaped edge of #4: แผนประกัน and วันมีผลบังคับ belong to the school, not the family.
 * Now that a parent can re-submit, their patch must not be able to blank them.
 */
const fs = require('fs'), path = require('path');
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js');
const i18n = R('webapp/i18n.js');
const day6 = R('src/Day6.gs');
const eng  = R('src/Engine.gs');       // the BUILT engine, which is what runs on GAS in mock parity
// comments quote the very strings being asserted on, so strip them before searching for code
const appCode = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function fresh() {
  const M = {
    config: { Plans: [{ id: 'p1', price: 6900, end: '17:00' }], Departments: 'Nursery 1',
      Insurance: { Titles: ['ด.ช.', 'ด.ญ.'], Genders: ['Male', 'Female'], MemberStatuses: ['Child'],
        Plans: ['1', '2'], MaritalStatuses: ['Single'], Relationships: ['Father', 'Mother'] } },
    students: [{ StudentID: 'STD-01', NameTH: 'ด.ญ. ปารมิตา เทียนชัย', NameEN: 'Paramita',
      Nickname: 'เลอา', Class: 'Nursery 1', Status: 'ACTIVE', DOB: '2023-12-02',
      NationalID: '1104500210510', Gender: 'F', ParentID: 'PAR-01' }],
    parents: [{ ParentID: 'PAR-01', NameTH: 'พ่อ', StudentID: 'STD-01', LineUID: 'U1' }],
    staff: [{ StaffID: 'STF-A', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin' }],
    insurancePCHI: [], feed: [], activityLog: [], userLinks: [{ UserUID: 'U1', StudentID: 'STD-01' }],
    classes: [], holidays: [], payments: []
  };
  return { M, H: createAtomAPI(M).H };
}

// ============================================================================
console.log('\n1) the heading names the right form');
{
  ok_('the injury form’s "เด็กที่บาดเจ็บ" is gone from the insurance form',
    !/ins2[\s\S]{0,400}inj\.child/.test(appCode) && /ins2\.subject/.test(appCode));
  ok_('...replaced by the student whose life is being insured',
    /'ins2\.subject':\['ข้อมูลนักเรียนที่เอาประกัน'/.test(i18n));
  // and the injury form keeps its own wording — this was a shared key, not a typo
  ok_('the injury form still says เด็กที่บาดเจ็บ', /'inj\.child':\['[^']*บาดเจ็บ/.test(i18n));
}

console.log('\n2) THAI ON SCREEN, the insurer’s own word in the file');
{
  ok_('a display map exists', /const INS_TH = \{/.test(app));
  ok_('...and it is applied as a LABEL', /<option value="\$\{esc\(o\)\}"[^]{0,80}\$\{esc\(insLbl\(o\)\)\}<\/option>/.test(appCode));
  // behaviour, run rather than read: pull the map out of the source and exercise it
  const body = /const INS_TH = \{([\s\S]*?)\n  \};/.exec(app);
  ok_('the map parses', !!body);
  const MAP = {}; (body ? body[1] : '').replace(/'?([A-Za-z\/ ]+)'?\s*:\s*'([^']+)'/g, (m, k, v) => { MAP[k.trim()] = v; return m; });
  eq('Father reads บิดา', MAP.Father, 'บิดา');
  eq('Mother reads มารดา', MAP.Mother, 'มารดา');
  eq('Male reads ชาย', MAP.Male, 'ชาย');
  eq('Single reads โสด', MAP.Single, 'โสด');
  eq('Child reads บุตร', MAP.Child, 'บุตร');
  /* THE POINT OF THE WHOLE MECHANISM. Every Thai label must map back to a word the insurer's own
   * Setting sheet lists, or the row is rejected on arrival. Checked against the option lists the
   * app actually offers, not against a list retyped here. */
  const cfg = R('webapp/mockconfig.js');
  const listOf = k => { const m = new RegExp(k + ":\\s*\\[([^\\]]*)\\]").exec(cfg); return m ? m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean) : []; };
  const offered = [].concat(listOf('Genders'), listOf('MemberStatuses'), listOf('MaritalStatuses'), listOf('Relationships'));
  ok_('every value the app offers is either mapped or left as-is (nothing invented)',
    Object.keys(MAP).every(k => offered.indexOf(k) >= 0));
  /* The label must never make it back into the payload. The <option> value is the raw word, and the
   * form is read straight off `.value` with no translation on the way out — so what is stored is
   * what the insurer's Setting sheet lists, whichever language the screen was in. */
  ok_('...and no Thai label is ever an option VALUE', !/value="\$\{esc\(insLbl/.test(app));
  ok_('...nor reaches the payload on the way out',
    /const d=\{\}; keys\.forEach\(k=>\{ const e=document\.getElementById\('ins_'\+k\); if\(e\)d\[k\]=e\.value\.trim\(\); \}\); return d;/.test(appCode)
    && !/readInsuranceForm[\s\S]{0,400}insLbl/.test(appCode));
  // the export still emits the insurer's English — the map must not have reached it
  ok_('the export is untouched by the translation', !/INS_TH|insLbl/.test(day6));
}

console.log('\n3) the school already knows the child’s name');
{
  ok_('the form no longer pre-fills from the empty client roster',
    !/P_insurance = async[\s\S]{0,400}MOCK\.students\.find/.test(appCode));
  ok_('...it reads the student insuranceStatus returns', /function insStudent_\(st, sid\)/.test(app));
  ok_('...on the admin screen too', /A_insuranceEdit = async[\s\S]{0,300}insStudent_\(st,sid\)/.test(appCode));
  // the server was always sending it; prove that has not quietly changed
  const { H } = fresh();
  const st = H.insuranceStatus({ studentId: 'STD-01' });
  eq('the status carries the child', [st.student.name, st.student.nationalId, st.student.dob],
    ['ด.ญ. ปารมิตา เทียนชัย', '1104500210510', '2023-12-02']);
  /* ONE roster name has to become three boxes on the insurer's form. Run the real splitter. */
  const src = /function insSplitName_\(full, titles\)\{([\s\S]*?)\n  \}/.exec(app);
  ok_('the name splitter exists', !!src);
  const insSplitName_ = new Function('full', 'titles', src[1]);
  eq('title, given name and surname come apart', insSplitName_('ด.ญ. ปารมิตา เทียนชัย', ['ด.ช.', 'ด.ญ.']),
    { title: 'ด.ญ.', first: 'ปารมิตา', last: 'เทียนชัย' });
  eq('a name with no title still splits', insSplitName_('ปารมิตา เทียนชัย', ['ด.ช.', 'ด.ญ.']),
    { title: '', first: 'ปารมิตา', last: 'เทียนชัย' });
  eq('a middle name stays with the surname rather than being dropped',
    insSplitName_('ด.ช. ก ข ค', ['ด.ช.']), { title: 'ด.ช.', first: 'ก', last: 'ข ค' });
  /* A ONE-WORD NAME HAS NO SURNAME. Filling the surname box with the given name would put a wrong
   * name on a real policy, which is worse than an empty box the parent completes. */
  eq('a single-word name leaves the surname empty', insSplitName_('เลอา', ['ด.ช.']),
    { title: '', first: 'เลอา', last: '' });
  eq('nothing in, nothing out', insSplitName_('', ['ด.ช.']), { title: '', first: '', last: '' });
}

console.log('\n4) a parent may correct what they sent');
{
  const { M, H } = fresh();
  H.submitInsurance({ studentId: 'STD-01', parentId: 'PAR-01', data: {
    Title: 'ด.ญ.', InsuredName: 'ปารมิตา', InsuredLastName: 'เทียนชัย',
    BankAccountNumber: '111-1-11111-1', Mobile: '0812345678' } });
  // the school settles these afterwards
  H.submitInsurance({ studentId: 'STD-01', adminEdit: true, staffId: 'STF-A',
    data: { Plan: '3', EffectiveDate: '2026-09-01' } });
  eq('the school’s plan is on the record', [M.insurancePCHI[0].Plan, M.insurancePCHI[0].EffectiveDate], ['3', '2026-09-01']);

  // ...and now the parent comes back to fix the account number they mistyped
  const r = H.submitInsurance({ studentId: 'STD-01', parentId: 'PAR-01',
    data: { Title: 'ด.ญ.', InsuredName: 'ปารมิตา', InsuredLastName: 'เทียนชัย',
            BankAccountNumber: '222-2-22222-2', Mobile: '0812345678' } });
  ok_('a second submission is accepted, not refused', r.ok && r.updated);
  eq('the correction is stored', M.insurancePCHI[0].BankAccountNumber, '222-2-22222-2');
  eq('and there is still exactly ONE record for the child', M.insurancePCHI.length, 1);
  /* THE MONEY-SHAPED EDGE. The parent's form does not render plan or effective date, so they arrive
   * absent — but a stale cached build that still had the boxes would send them EMPTY, and blanking a
   * live policy's plan is not something to leave to what the client happened to post. */
  eq('the school’s plan survives the parent’s edit', [M.insurancePCHI[0].Plan, M.insurancePCHI[0].EffectiveDate], ['3', '2026-09-01']);
  const r2 = H.submitInsurance({ studentId: 'STD-01', parentId: 'PAR-01', data: { Plan: '', EffectiveDate: '' } });
  eq('...even when the client explicitly sends them blank', [M.insurancePCHI[0].Plan, M.insurancePCHI[0].EffectiveDate], ['3', '2026-09-01']);
  ok_('...but an ADMIN can still change them', H.submitInsurance({ studentId: 'STD-01', adminEdit: true, staffId: 'STF-A', data: { Plan: '5' } }) && M.insurancePCHI[0].Plan === '5');
  ok_('the admin is told the family changed something', M.feed.some(f => /แก้ไขข้อมูลประกัน/.test(f.text)));
}
{
  // the same two rules on the GAS route, which SHADOWS the engine and is what actually runs live
  ok_('the route no longer refuses a second submission', !/ALREADY_FILLED/.test(day6));
  ok_('...and strips the school’s two fields from a parent patch',
    /if \(existing && !p\.adminEdit\) \{ delete d\.Plan; delete d\.EffectiveDate; \}/.test(day6));
  ok_('...and tells the admin', /if \(!p\.adminEdit\) notifyAdmin_\('🛡️ ผู้ปกครองแก้ไขข้อมูลประกัน/.test(day6));
  ok_('the built engine agrees with the route', /if\(existing && !p\.adminEdit\)\{ delete d\.Plan; delete d\.EffectiveDate; \}/.test(eng));
  /* d is COPIED before the delete. Deleting off p.data would mutate the caller's object, which in
   * mock mode is the very object the screen still holds. */
  ok_('the patch is a copy, so nothing upstream is mutated', /const d=Object\.assign\(\{\}, p\.data\|\|\{\}\);/.test(eng));
}

console.log('\n5) the read-back screen shows what was actually saved');
{
  const src = /function insReviewRows\(r\)\{ r=r\|\|\{\};\s*return \[([\s\S]*?)\];\s*\}/.exec(app);
  ok_('the review table is built in one place', !!src);
  const keys = (src ? src[1] : '').match(/'ins2\.[a-zA-Z]+'/g) || [];
  eq('every one of the 21 stored fields is on it', keys.length, 21);
  // named explicitly: these are the four a parent complained they could not check
  ['ins2.bankNo', 'ins2.mobile', 'ins2.occupation', 'ins2.mname'].forEach(k =>
    ok_('...including ' + k, keys.indexOf("'" + k + "'") >= 0));
  ok_('the coded values read in Thai there too', /\['ins2\.beneRel', insLbl\(r\.BeneficiaryRelationship\)\]/.test(app));
  ok_('and the parent can go straight from checking it to changing it',
    /P_insurance\('\$\{sid\}',1\)/.test(app) && /ins2\.edit/.test(app));
  /* Saving used to send the parent home, which hides the very thing they were asked to check. */
  ok_('a save lands back on the read-back screen, not on home',
    /confirmSaved\(t\('ins2\.saved'\)\); P_insurance\(sid\);/.test(app));
}

console.log('\n6) more than one child is tabs, like every other screen');
{
  ok_('the insurance screen uses the shared child switcher',
    /childSwitcher\(kids, sid, 'P_insurance'\)/.test(app));
  ok_('...and P_insurance takes the student id, so a tab can call it', /window\.P_insurance = async \(sid, edit\)/.test(app));
  /* THREE reads in one tick, so api.js batches them into ONE request. Awaited one at a time they
   * are three queued round trips on a backend that runs one execution per user at a time. */
  ok_('its three reads go out together', /Promise\.all\(\[\s*\n?\s*api\('parentChildren'/.test(app));
}

console.log('\n7) the plan is shown to a parent, not offered to them');
{
  ok_('the form knows who is filling it in', /function insuranceFormHTML\(o,s,rec,isAdmin\)/.test(app));
  ok_('admin gets real fields', /isAdmin\s*\n?\s*\? `<div class="grid2">\$\{insInp\('Occupation'[\s\S]{0,200}insSel\('Plan'/.test(app));
  ok_('a parent gets flat text instead', /class="insro"/.test(app));
  ok_('...styled to line up with the inputs beside it', /\.insro\{/.test(R('webapp/styles.css')));
  /* readInsuranceForm guards every getElementById, so a field that is not on the page is ABSENT from
   * the payload rather than present-and-empty. That is what makes the server-side delete a belt to
   * the client's braces rather than the only thing holding the plan up. */
  ok_('a missing field is simply not sent', /if\(e\)d\[k\]=e\.value\.trim\(\);/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
