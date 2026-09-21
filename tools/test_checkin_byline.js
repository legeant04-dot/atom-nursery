/**
 * tools/test_checkin_byline.js — who recorded this time, and when did they record it.
 *   node tools/test_checkin_byline.js
 *
 * Asked 2026-09-21: "Admin สามารถตรวจสอบได้รึยังนะว่า ครูคนไหน Check-in/out แทนเด็กคนไหนเวลาไหนบ้าง?
 * ... หากผู้ปกครองลงเองก็แสดงเหมือนเดิม / หากคุณครูเป็นคนดำเนินการให้ ให้แสดงข้อมูลชื่อคุณครู(ชื่อเล่น)
 * เวลาที่ลงเวลาให้นักเรียน".
 *
 * THE DATA WAS ALREADY THERE. CHECKIN_STUDENT has carried ByStaffID and Remark since the teacher's
 * on-behalf button was built, and handleStaffStudentCheckin has always written both. Nothing read
 * them: attendanceAudit never returned them, so the one screen an Admin opens to check a day showed
 * every time as if the family had entered it. The same shape of miss as the OT history — a complete
 * record with nothing pointing at it.
 *
 * TWO CLOCKS, AND THEY ARE NOT THE SAME ONE. This is the part worth protecting:
 *   Time / inTime / outTime — when the CHILD arrived or went home. OT is charged from this.
 *   ByAt                    — when the ADULT pressed save.
 * A teacher may enter a 12:57 pick-up at 17:30, and that override is deliberate (it stops a child
 * collected at lunchtime being billed OT against the wall clock). Which means the gap between the
 * two is exactly what somebody querying an OT charge needs to see. Collapsing them into one figure
 * would be worse than showing neither.
 */
const path = require('path'), fs = require('fs');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), engine = R('webapp/engine.js'),
      configGs = R('src/Config.gs'), checkinGs = R('src/Checkin.gs'), gasEngine = R('src/GasEngine.gs');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const appCode = strip(app);

const TODAY = new Date().toISOString().slice(0, 10);

// ============================================================================================
console.log('1) attribution is per PUNCH, not per day');
// ============================================================================================
{
  /* THE CASE THAT BREAKS A PER-DAY FIELD: the parent drops the child off and a teacher records the
   * pick-up because the grandmother came instead. One row on screen, two different people. A single
   * "recordedBy" on the day would credit whichever was written last — and on a pick-up that raised
   * an OT charge, that is the wrong name against the money. */
  const M = {
    students: [{ StudentID: 'S1', NameTH: 'เด็กหญิงเอ', Nickname: 'เอ', Class: 'Nursery 1', Status: 'ACTIVE' }],
    staff: [{ StaffID: 'STF-T', NameTH: 'ครูสมศรี', Nickname: 'ครูศรี', Role: 'Teacher',
              PositionLevel: 'Staff', Status: 'ACTIVE', Department: 'Nursery 1', Classes: 'Nursery 1' },
            { StaffID: 'ADM', NameTH: 'แอดมิน', Nickname: 'แอด', Role: 'Admin',
              PositionLevel: 'Admin', Status: 'ACTIVE' }],
    // the parent tapped the morning; the teacher recorded the afternoon
    studentCheckins: [{ Date: TODAY, StudentID: 'S1', InTime: '07:50', OutTime: '12:57',
                        InBy: '', InRemark: '', InAt: '',
                        OutBy: 'STF-T', OutRemark: 'คุณยายมารับ', OutAt: '2026-09-21 17:30' }],
    checkinStudent: [], studentLeaves: [], holidays: [], otDaily: [], classes: [],
    parents: [], activityLog: [], config: {}
  };
  const H = createAtomAPI(M).H;
  const d = H.attendanceAudit({ date: TODAY, staffId: 'ADM', role: 'Admin' });
  const r = (d.rows || []).find(x => x.studentId === 'S1') || {};

  eq('the morning shows nobody — the family did it themselves', r.inByStaff, null);
  eq('the afternoon names the teacher, by NICKNAME', r.outByStaff && r.outByStaff.by, 'ครูศรี');
  eq('...and carries the moment she pressed save', r.outByStaff && r.outByStaff.at, '2026-09-21 17:30');
  eq('...and who actually collected the child', r.outByStaff && r.outByStaff.remark, 'คุณยายมารับ');
  /* THE CHILD'S TIMES ARE UNTOUCHED BY ANY OF THIS. 12:57 is what OT is charged from; 17:30 is only
   * when it was typed. If these ever merge, a lunchtime collection starts being billed as a 17:30
   * pick-up, which is the exact bug the time override was built to prevent. */
  eq('the child’s own times are unchanged', [r.inTime, r.outTime], ['07:50', '12:57']);

  /* RESOLVED ON THE SERVER, not from the client's staff list. That list is an Admin cache — a head
   * teacher opening this screen has an empty one, and would see "STF-T" where an Admin sees a name. */
  ok_('the nickname is resolved server-side', /staffNickOf_\(id,id\)/.test(engine));
}

// ============================================================================================
console.log('\n2) a teacher recording on behalf, through the LIVE route');
// ============================================================================================
{
  const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                      'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                      'GasEngine', 'Engine']);
  const res = JSON.parse(run(function () {
    _configCache = null; setupAll(); _configCache = null;
    var MAIN = getMainSpreadsheet_(), HR = getHrSpreadsheet_();
    appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: 'S9', Name: 'เด็กหญิงซี', Nickname: 'ซี',
      Class: 'Nursery 1', Status: 'ACTIVE', EnrollDate: '2026-01-05', ParentID: 'P9' });
    appendObject_(sheet_(MAIN, 'PARENTS'), { ParentID: 'P9', Name: 'แม่ซี', StudentID: 'S9', LineUID: '' });
    appendObject_(sheet_(HR, 'STAFF'), { StaffID: 'STF-T', Name: 'ครูสมศรี', Nickname: 'ครูศรี',
      Role: 'Teacher', PositionLevel: 'Staff', Status: 'ACTIVE', Department: 'Nursery 1',
      Classes: 'Nursery 1', StartDate: '2025-01-01', RequireCheckin: true });
    _configCache = null;

    var out = { steps: [] };
    var grab = function (label, fn) {
      try { out.steps.push([label, 'ok', fn()]); }
      catch (e) { out.steps.push([label, e.apiCode || e.code || 'ERR', String(e.message || e)]); }
    };

    grab('punch', function () {
      /* The real shape of the complaint: a child collected at lunchtime, recorded when the teacher
       * finally sat down. `time` is the child's; the stamp is the teacher's. */
      handleStaffStudentCheckin({ staffId: 'STF-T', studentId: 'S9', type: 'OUT',
        time: '12:57', remark: 'คุณยายมารับ' });
      var r = findObject_(sheet_(getMainSpreadsheet_(), 'CHECKIN_STUDENT'),
        function (x) { return String(x.StudentID) === 'S9' && String(x.Type) === 'OUT'; });
      return { time: String(r.Time || '').slice(0, 5), by: String(r.ByStaffID || ''),
               remark: String(r.Remark || ''), byAtLooksLikeAClock: /^\d{1,2}:\d{2}/.test(String(r.ByAt || '')) };
    });
    grab('column', function () {
      var hdr = sheet_(getMainSpreadsheet_(), 'CHECKIN_STUDENT').getRange(1, 1, 1,
        sheet_(getMainSpreadsheet_(), 'CHECKIN_STUDENT').getLastColumn()).getValues()[0];
      return hdr.indexOf('ByAt') >= 0;
    });
    grab('audit', function () {
      return readObjects_(sheet_(getMainSpreadsheet_(), 'AUDIT_LOG'))
        .map(function (r) { return String(r.Action || ''); })
        .filter(function (a) { return a.indexOf('STUDENT_CHECK') === 0; });
    });
    return JSON.stringify(out);
  }));
  const S = {}; res.steps.forEach(([k, st, v]) => { S[k] = { st, v } });

  eq('the column really exists on the sheet', S.column.v, true);
  eq('the punch records the CHILD’s time, the teacher, and the reason', S.punch.v, {
    time: '12:57', by: 'STF-T', remark: 'คุณยายมารับ', byAtLooksLikeAClock: true });
  ok_('...and it is still on the audit log as well', (S.audit.v || []).some(a => /BY_STAFF$/.test(a)));
}

// ============================================================================================
console.log('\n3) the merge keeps both punches apart');
// ============================================================================================
{
  /* deriveStudentCheckins_ collapses the day's rows into one. It used to keep only the two times, so
   * everything else about WHO was thrown away before any handler could see it. */
  ok_('IN keeps its own recorder, remark and stamp',
    /byDay\[key\]\.InBy = e\.ByStaffID \|\| '';[\s\S]{0,120}byDay\[key\]\.InAt = e\.ByAt \|\| '';/.test(gasEngine));
  ok_('...and OUT keeps its own',
    /byDay\[key\]\.OutBy = e\.ByStaffID \|\| '';[\s\S]{0,120}byDay\[key\]\.OutAt = e\.ByAt \|\| '';/.test(gasEngine));
  ok_('the column is declared, or a write would be dropped with no error',
    /'Remark', 'ByStaffID', 'ByAt'\]/.test(configGs));
  ok_('...and ensured at write time too, for a sheet created before today',
    /ensureColumns_\(sh, \['Remark', 'ByStaffID', 'ByAt'\]\);/.test(checkinGs));
  // the correction screen writes through the engine, so it stamps there
  ok_('correcting a time records who corrected it, and when', /const byAt=stampLocal\(\);/.test(engine));
}

// ============================================================================================
console.log('\n4) the screen — and the format trap underneath it');
// ============================================================================================
{
  ok_('the row draws the attribution', /const by=\(w,icon\)=>!w\?'':/.test(appCode));
  ok_('...for both punches', /\$\{by\(r\.inByStaff,'🟢'\)\}\$\{by\(r\.outByStaff,'🔴'\)\}/.test(appCode));
  /* "หากผู้ปกครองลงเองก็แสดงเหมือนเดิม" — the line exists ONLY when somebody acted on the family's
   * behalf. `!w?''` is that rule, and it is why the lines that DO appear are worth reading. */
  ok_('a parent’s own tap adds nothing to the row', /!w\?''/.test(appCode));

  /* THE TWO WRITERS DISAGREE ON FORMAT and this nearly shipped wrong: GAS stores "HH:mm"
   * (timeStr_), the engine stores "yyyy-MM-dd HH:mm" (stampLocal). Slicing by character position
   * worked for one and printed "17" for the other. Run the real parser against every format that
   * can actually reach it rather than asserting the source text. */
  const src = /const atHHmm=v=>\{([\s\S]*?)\};/.exec(appCode);
  ok_('the parser was found', !!src);
  const atHHmm = new Function('v', src[1]);
  eq('GAS "HH:mm"', atHHmm('17:30'), '17:30');
  eq('engine "yyyy-MM-dd HH:mm"', atHHmm('2026-09-21 17:30'), '17:30');
  eq('...with seconds', atHHmm('2026-09-21 17:30:05'), '17:30');
  eq('blank stays blank rather than printing junk', [atHHmm(''), atHHmm(null), atHHmm(undefined)], ['', '', '']);
  /* A DATE MUST NOT BE MISTAKEN FOR A CLOCK. "2026-09-21" on its own has no time in it, and a
   * parser anchored loosely could read "09-21" as one. */
  eq('a bare date yields nothing', atHHmm('2026-09-21'), '');
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
