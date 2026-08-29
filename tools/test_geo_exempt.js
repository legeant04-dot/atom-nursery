/**
 * tools/test_geo_exempt.js — the one phone that cannot be fenced.
 *   node tools/test_geo_exempt.js
 *
 * REPORTED 2026-08-29, with a photograph of the refusal:
 *
 *   ⚠️ อยู่นอกรัศมีโรงเรียน (620 ม. เกินกำหนด 50 ม. · เพื่อความคลาดเคลื่อน GPS 50 ม.
 *      · ความแม่นยำที่เครื่องแจ้ง ±2000 ม. (ต่ำมาก — โทรศัพท์อาจส่งตำแหน่งแบบคร่าวๆ))
 *
 * The parent was standing at the gate. The fence was not wrong and the school was not wrong: the
 * HANDSET was, and it said so itself — a stated margin of error three kilometres wide. Nothing in
 * that phone's settings changes it, and the school has confirmed the family in person.
 *
 * So the exception is per CHILD, granted by an admin, and recorded — not a wider radius, not a
 * school-wide switch, and emphatically not "stop fencing pick-ups". The school's rule that a pick-up
 * is a safety record and starts the OT clock is a good rule; this suite exists mostly to prove that
 * it is still in force for everyone who has not been named.
 *
 * The four ways this could have gone wrong, all pinned below:
 *   · the exemption leaks to other children;
 *   · the DISTANCE stops being recorded, so nobody can ever audit the exception;
 *   · a head teacher, who may edit the rest of the same form, silently clears or grants it;
 *   · the column is never added to the sheet, so ticking the box saves nothing at all.
 */
const fs = require('fs'), path = require('path');
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));

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
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), cfgGs = R('src/Config.gs'), staffGs = R('src/Staff.gs'),
      parentGs = R('src/Parent.gs'), checkinGs = R('src/Checkin.gs'), engGs = R('src/Engine.gs');

// the school, and a spot 620 m from it — the real number off the report
const SCHOOL = { lat: 13.792472, lng: 100.646389 };
const FAR = { lat: 13.798, lng: 100.646389 };            // ~610 m north

const TODAY = (() => { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })();
function fresh(geoExempt) {
  const M = {
    config: { GPS_Lat: SCHOOL.lat, GPS_Lng: SCHOOL.lng, Radius: 50, GpsAccuracySlack: 50,
      Plans: [{ id: 'p1', price: 6900, end: '17:00' }], Departments: 'Nursery 1' },
    students: [
      { StudentID: 'STD-01', NameTH: 'เด็กที่โทรศัพท์เพี้ยน', Class: 'Nursery 1', Plan: 'p1', Status: 'ACTIVE', ParentID: 'PAR-01', GeoExempt: geoExempt },
      { StudentID: 'STD-02', NameTH: 'เด็กปกติ', Class: 'Nursery 1', Plan: 'p1', Status: 'ACTIVE', ParentID: 'PAR-02' }
    ],
    parents: [{ ParentID: 'PAR-01', NameTH: 'พ่อ', StudentID: 'STD-01', LineUID: 'U1' },
              { ParentID: 'PAR-02', NameTH: 'แม่', StudentID: 'STD-02', LineUID: 'U2' }],
    staff: [], classes: [], holidays: [],
    // the suite must not depend on the day of the week it is run — both children are named as
    // expected today, which is the school's own mechanism for a child who comes in on a closed day
    holidayAttend: [{ Date: TODAY, StudentID: 'STD-01' }, { Date: TODAY, StudentID: 'STD-02' }],
    checkinStudent: [], studentCheckins: [], studentAttendanceToday: [], studentLeaves: [],
    otDaily: [], otRecords: [], payments: [], feed: [], activityLog: [], userLinks: []
  };
  return { M, H: createAtomAPI(M).H };
}
const out = (H, sid) => H.parentCheckin({ parentId: 'PAR-0' + sid.slice(-1), studentId: sid, type: 'OUT', lat: FAR.lat, lng: FAR.lng, acc: 2000 });

// ============================================================================
console.log('\n1) with no exemption, the rule is exactly what it was');
{
  const { H } = fresh('');
  throws_('a pick-up 620 m away is refused', () => out(H, 'STD-01'), 'OUT_OF_RANGE');
  throws_('...for the other child too', () => out(H, 'STD-02'), 'OUT_OF_RANGE');
  // and the fence has not been quietly widened for anybody
  ok_('at the gate it still works', !!H.parentCheckin({ parentId: 'PAR-02', studentId: 'STD-02', type: 'OUT', lat: SCHOOL.lat, lng: SCHOOL.lng, acc: 10 }));
}

console.log('\n2) the named child, and only the named child');
{
  const { M, H } = fresh('YES');
  const r = out(H, 'STD-01');
  eq('the exempt child is checked out', r.type, 'OUT');
  /* THE DISTANCE IS STILL MEASURED. The exception is about refusing, not about knowing — a pick-up
   * nobody can audit afterwards would be a worse answer than the refusal it replaced. */
  ok_('...with the real distance still recorded', r.distance > 500 && r.distance < 750);
  throws_('the child beside them is still fenced', () => out(H, 'STD-02'), 'OUT_OF_RANGE');
  eq('...and has no attendance row from the attempt', M.checkinStudent.filter(x => x.StudentID === 'STD-02').length, 0);
}
{
  // the flag is text in a spreadsheet, and a human may have typed it
  ['YES', 'yes', 'Yes', 'true', '1', 'Y'].forEach(v =>
    ok_('"' + v + '" means yes', (() => { try { return !!out(fresh(v).H, 'STD-01'); } catch (e) { return false; } })()));
  ['', 'NO', 'no', 'false', '0', 'N', 'maybe', ' '].forEach(v =>
    throws_('"' + v + '" does not', () => out(fresh(v).H, 'STD-01'), 'OUT_OF_RANGE'));
}
{
  // DROP-OFF was never fenced and must not become fenced by this change
  const { H } = fresh('');
  ok_('drop-off still works from anywhere, as it always did',
    !!H.parentCheckin({ parentId: 'PAR-02', studentId: 'STD-02', type: 'IN', lat: FAR.lat, lng: FAR.lng, acc: 2000 }));
}

console.log('\n3) the same rule on the GAS route, which SHADOWS the engine and is what runs live');
{
  ok_('the route asks whether this child is exempt', /if \(type === 'OUT' && studentGeoExempt_\(payload\.studentId\)\)/.test(parentGs));
  ok_('...and still measures the distance when it is', /studentGeoExempt_[\s\S]{0,200}dist = geoDistanceSafe_/.test(parentGs));
  ok_('...and writes it to the audit log', /STUDENT_CHECKOUT_GEO_EXEMPT/.test(parentGs));
  ok_('the helper reads the column defensively', /function studentGeoExempt_\(studentId\)/.test(checkinGs));
  ok_('...treating a missing column as "no", not as an error', /catch \(e\) \{ return false; \}/.test(checkinGs));
  ok_('the two sides agree on what counts as yes',
    (checkinGs.match(/\^\(yes\|true\|1\|y\)\$/g) || []).length >= 1 &&
    (engGs.match(/\^\(yes\|true\|1\|y\)\$/g) || []).length >= 1 &&
    (app.match(/\^\(yes\|true\|1\|y\)\$/g) || []).length >= 1);
  // an unfenced check-out is still an OUT_OF_RANGE-shaped thing to review later
  ok_('a REFUSED pick-up is still logged too', /STUDENT_CHECKOUT_OUT_OF_RANGE/.test(parentGs));
}

console.log('\n4) the column exists, or the box saves nothing');
{
  ok_('declared in the STUDENTS schema', /STUDENTS:\s*\[[\s\S]*?'GeoExempt'[\s\S]*?\],\n  CLASSES:/.test(cfgGs));
  ok_('...and ensured on save, since writeRows_ drops a field with no column in silence',
    /ensureColumns_\(sh, \[[\s\S]*?'GeoExempt'[\s\S]*?\]\); \} catch \(e\) \{\}/.test(staffGs));
}

console.log('\n5) it is the admin’s decision, and it has a name on it');
{
  ok_('the box is drawn for an admin only', /\$\{USER\.role==='Admin'\?`<label class="chk-inline"><input type="checkbox" id="stf_GeoExempt"/.test(app));
  /* A HEAD TEACHER MAY EDIT THE REST OF THIS FORM. An absent checkbox reads as unchecked, so sending
   * the field unconditionally would have had a head teacher SILENTLY CLEARING the exemption every
   * time they corrected a phone number. Both halves are pinned: not sent, and not accepted. */
  ok_('...and not sent at all when it was not drawn',
    /const _ge=m\.querySelector\('#stf_GeoExempt'\); if\(_ge\) data\.GeoExempt=_ge\.checked\?'YES':'';/.test(app));
  ok_('...and dropped from a non-admin’s patch on the server',
    /if \(row\.GeoExempt !== undefined && p\.role && p\.role !== 'Admin'\) delete row\.GeoExempt;/.test(staffGs));
  ok_('granting and revoking are both logged', /STUDENT_GEO_EXEMPT_ON/.test(staffGs) && /STUDENT_GEO_EXEMPT_OFF/.test(staffGs));
  /* Compared BEFORE the write, or there is nothing left to compare against. Scoped to
   * handleSaveStudent: `updateRow_(sh, st._row, row)` also appears in handleSaveStaff further up the
   * file, and a whole-file indexOf found that one instead — the assertion passed for the wrong
   * reason and would have failed for the wrong reason too. */
  {
    const fn = staffGs.slice(staffGs.indexOf('function handleSaveStudent'), staffGs.indexOf('function handleSetStudentPause'));
    ok_('...compared before the write, since afterwards there is nothing to compare with',
      fn.indexOf('STUDENT_GEO_EXEMPT_ON') > 0 && fn.indexOf('STUDENT_GEO_EXEMPT_ON') < fn.indexOf('updateRow_(sh, st._row, row);'));
  }
  ok_('...and only when it actually changed', /if \(wasEx !== nowEx\)/.test(staffGs));
  ok_('the admin who did it is named', /api\('saveStudent',\{studentId:id,data,adminId:USER\.staffId\}\)/.test(app));
  ok_('the screen says what it is for, in the school’s own words',
    /ยืนอยู่หน้าโรงเรียนแต่ระบบแจ้งว่าอยู่ไกลเป็นกิโลเมตร/.test(app));
}

console.log('\n6) ...and on GAS, end to end');
{
  const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin', 'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT']);
  const res = JSON.parse(run(function () {
    _configCache = null; setupAll(); _configCache = null;
    const MAIN = getMainSpreadsheet_(), cfg = sheet_(MAIN, 'SCHOOL_CONFIG');
    const setCfg = (k, v) => { const r = findObject_(cfg, x => x.Key === k); if (r) updateRow_(cfg, r._row, { Value: v }); else appendObject_(cfg, { Key: k, Value: v }); };
    setCfg('GPS_Lat', 13.792472); setCfg('GPS_Lng', 100.646389); setCfg('Radius', 50); setCfg('GpsAccuracySlack', 50);
    _configCache = null;
    appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: 'STD-001', Name: 'เพี้ยน', Class: 'Nursery 1', ParentID: 'PAR-001', Status: 'ACTIVE' });
    appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: 'STD-002', Name: 'ปกติ', Class: 'Nursery 1', ParentID: 'PAR-002', Status: 'ACTIVE' });
    appendObject_(sheet_(MAIN, 'PARENTS'), { ParentID: 'PAR-001', Name: 'พ่อ', LineUID: 'U1', StudentID: 'STD-001' });
    appendObject_(sheet_(MAIN, 'PARENTS'), { ParentID: 'PAR-002', Name: 'แม่', LineUID: 'U2', StudentID: 'STD-002' });
    // the day of the week must not decide whether this suite passes — see the engine fixture above
    const today = dateStr_(new Date());
    appendObject_(sheet_(MAIN, 'HOLIDAY_ATTEND'), { Date: today, StudentID: 'STD-001', AddedBy: 'TEST', AddedAt: '' });
    appendObject_(sheet_(MAIN, 'HOLIDAY_ATTEND'), { Date: today, StudentID: 'STD-002', AddedBy: 'TEST', AddedAt: '' });
    const o = {}, far = { lat: 13.798, lng: 100.646389, acc: 2000 };
    const tryOut = (pid, sid) => { try { return { ok: true, r: handleParentCheckin({ parentId: pid, studentId: sid, type: 'OUT', lat: far.lat, lng: far.lng, acc: far.acc }) }; }
                                   catch (e) { return { ok: false, code: e && e.apiCode, msg: String((e && e.message) || e) }; } };
    o.beforeGrant = tryOut('PAR-001', 'STD-001');
    // the admin grants it through the real save path, columns and audit log and all
    handleSaveStudent({ studentId: 'STD-001', adminId: 'STF-ADM', data: { GeoExempt: 'YES' } });
    o.hasColumn = readObjects_(sheet_(MAIN, 'STUDENTS'))[0].GeoExempt;
    o.afterGrant = tryOut('PAR-001', 'STD-001');
    o.exemptFlag = studentGeoExempt_('STD-001');
    o.neighbour = tryOut('PAR-002', 'STD-002');
    // a head teacher edits the same child — must not be able to take it away
    handleSaveStudent({ studentId: 'STD-001', role: 'Teacher', staffId: 'STF-T', data: { Nickname: 'ใหม่', GeoExempt: '' } });
    o.afterTeacherEdit = readObjects_(sheet_(MAIN, 'STUDENTS'))[0].GeoExempt;
    o.teacherEditTookEffect = readObjects_(sheet_(MAIN, 'STUDENTS'))[0].Nickname;
    o.audit = readObjects_(sheet_(MAIN, 'AUDIT_LOG')).map(function (a) { return String(a.Action || ''); })
      .filter(function (a) { return /GEO_EXEMPT/.test(a); });
    return JSON.stringify(o);
  }));
  eq('before it is granted, the live route refuses', [res.beforeGrant.ok, res.beforeGrant.code], [false, 'OUT_OF_RANGE']);
  eq('saving actually writes the column', res.hasColumn, 'YES');
  eq('after it is granted, the same pick-up goes through', [res.afterGrant.ok, res.afterGrant.code, res.afterGrant.msg, res.exemptFlag], [true, null, null, true]);
  ok_('...with the distance still on the record', res.afterGrant.r.distance > 500 && res.afterGrant.r.distance < 750);
  eq('the child beside them is untouched', [res.neighbour.ok, res.neighbour.code], [false, 'OUT_OF_RANGE']);
  eq('a head teacher cannot revoke it', res.afterTeacherEdit, 'YES');
  eq('...while the rest of their edit still saves', res.teacherEditTookEffect, 'ใหม่');
  /* TWO KINDS OF LINE, and both are wanted: who GRANTED it (…_ON, once) and every pick-up that then
   * USED it (…CHECKOUT_GEO_EXEMPT, one per pick-up). An exemption with only the first is a decision
   * nobody can review; with only the second, a use nobody can attribute.
   * The head teacher's attempted revoke is absent, because it never reached the sheet. */
  eq('the grant, and every pick-up that used it, are both on the record',
    res.audit, ['STUDENT_GEO_EXEMPT_ON', 'STUDENT_CHECKOUT_GEO_EXEMPT']);
  ok_('...and the head teacher’s attempted revoke logged nothing, having changed nothing',
    res.audit.indexOf('STUDENT_GEO_EXEMPT_OFF') < 0);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
