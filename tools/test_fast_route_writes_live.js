/**
 * tools/test_fast_route_writes_live.js — W1 write routes through server/host.js and staging Postgres
 *   node tools/test_fast_route_writes_live.js          (needs secrets/supabase.env — fabricated data only)
 *
 * tools/test_fast_route_writes.js proves routes.js records the same writes Apps Script makes, given the
 * same rows. This proves the rest of the path, where the types live: the host saves them into REAL
 * tables (insert / update / delete, one transaction, the shared lock), and what Postgres holds afterwards
 * — read back the way the host reads it — equals what Apps Script's sheets hold after its own handler ran
 * the same step on the same rows. Every step, every declared table, both audit logs.
 *
 *   + a teacher is refused the admin's writes at the gate, and nothing moves
 *   + an announcement with an image answers NOT_ON_FAST_HOST and nothing moves (the app asks Apps Script)
 *   + every table a step wrote has a new cache version (Apps Script's cached rows retire with it)
 * 🔴 Fabricated data only; the tenant is deleted at the end (pg_sweep_tenants knows the p23- prefix).
 */
'use strict';
const path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const TENANT = crypto.randomUUID();
const SECRET = 'route-writes-live-' + crypto.randomBytes(12).toString('hex');
process.env.SESSION_SECRET = SECRET;
process.env.TENANT_ID = TENANT;

const { connect } = require(path.join(ROOT, 'tools', 'pg_lib.js'));
const PG = require(path.join(ROOT, 'tools', 'pg_engine.js'));
const GATE = require(path.join(ROOT, 'server', 'gate.js'));
const { handle } = require(path.join(ROOT, 'server', 'host.js'));
const { sign_ } = require(path.join(ROOT, 'server', 'session.js'));
const ALL = Object.keys(PG.COLLECTIONS);
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());

const NOW = Date.now();
const tokenFor = (role, linkedId, uid) => {
  const b = Buffer.from(JSON.stringify({ uid, role, linkedId, iat: NOW, exp: NOW + 3600e3 })).toString('base64');
  return { sess: { uid, role, linkedId }, token: b + '.' + sign_(b, SECRET) };
};
const ADMIN = tokenFor('Admin', 'STF-A', 'U-A'), TEACHER = tokenFor('Teacher', 'STF-T', 'U-T'), HEAD = tokenFor('Teacher', 'STF-H', 'U-H');
const WHOM = { ADMIN, TEACHER, HEAD };

function fixture() {
  const M = {}; ALL.forEach(k => { M[k] = []; });
  M.classes = [{ ClassID: 'C1', ClassName: 'N1' }];
  const st = (id, name, role, lvl) => ({ StaffID: id, NameTH: name, Role: role, PositionLevel: lvl || role, Department: 'N1', Classes: '*', Status: 'ACTIVE', StartDate: '2025-01-01' });
  M.staff = [st('STF-A', 'แอดมินทดสอบ', 'Admin'), st('STF-T', 'ครูทดสอบ', 'Teacher'), st('STF-U', 'ครูอีกคน', 'Teacher'),
    Object.assign(st('STF-H', 'หัวหน้าครูทดสอบ', 'Teacher', 'Leader'), { Department: '*' })];
  M.holidays = [{ Date: '2026-12-31', NameTH: 'วันสิ้นปี', NameEN: "New Year's Eve", Recurring: true, StartTime: '', EndTime: '' }];
  M.students = [{ StudentID: 'STD-1', NameTH: 'เด็กทดสอบหนึ่ง', Nickname: 'หนึ่ง', Class: 'N1', Status: 'ACTIVE', DOB: '2023-03-01', EnrollDate: '2025-01-01' }];
  M.dspmCriteria = [
    { ItemNo: 1, AgeFrom: 0, AgeTo: 6, AgeLabelTH: '0-6 เดือน', Skill: 'GM', Description: 'ยกศีรษะ', Track: 'Teacher' },
    { ItemNo: 2, AgeFrom: 0, AgeTo: 6, AgeLabelTH: '0-6 เดือน', Skill: 'FM', Description: 'มองตาม', Track: 'Teacher' },
    { ItemNo: 1, AgeFrom: 0, AgeTo: 6, AgeLabelTH: '0-6 เดือน', Skill: 'GM', Description: 'ฉบับผู้ปกครอง', Track: 'Parent' }];
  M.leaves = [
    { LeaveID: 'LV-1', StaffID: 'STF-T', Department: 'N1', Type: 'ลาป่วย', StartDate: '2026-11-17', EndDate: '2026-11-17', Days: 1, Reason: 'ไข้', Status: 'APPROVED', HalfDay: '', CreatedDate: '2026-11-01 09:00:00' },
    { LeaveID: 'LV-2', StaffID: 'STF-T', Department: 'N1', Type: 'ลากิจ', StartDate: '2026-11-20', EndDate: '2026-11-21', Days: 2, Reason: 'ธุระ', Status: 'PENDING_ADMIN', HalfDay: '', CreatedDate: '2026-11-02 09:00:00' },
    { LeaveID: 'LV-3', StaffID: 'STF-U', Department: 'N1', Type: 'ลากิจ', StartDate: '2026-11-17', EndDate: '2026-11-17', Days: 1, Reason: 'x', Status: 'APPROVED', HalfDay: '', CreatedDate: '2026-11-03 09:00:00' }];
  M.studentLeaves = [{ LeaveID: 'LVS-1', StudentID: 'STD-1', Date: '2026-11-10', Reason: 'ป่วย', Type: 'sick', Status: 'Notified' }];
  M.journals = [{ Date: '2026-11-05', StudentID: 'STD-1', TeacherID: 'STF-T', Mood: 'ยิ้ม', Theme: 'ผีเสื้อ', Status: 'SUBMITTED', SubmittedAt: '2026-11-05 16:00' },
    { Date: '2026-11-06', StudentID: 'STD-1', TeacherID: 'STF-T', Mood: 'ยิ้ม', Status: 'SUBMITTED', SubmittedAt: '2026-11-06 16:00' },
    { Date: '2026-11-06', StudentID: 'STD-2', TeacherID: 'STF-U', Mood: 'เฉย', Status: 'SUBMITTED', SubmittedAt: '2026-11-06 16:05' }];
  M.announcements = [{ AnnID: 'ANN1', Title: 'ประกาศเดิม', Content: 'เนื้อหา', Date: '2026-11-01', Type: 'news', TargetGroup: 'all', Popup: false, Priority: 0 }];
  return M;
}
const CONFIG = [['Departments', 'N1,N2'], ['LeaveQuota', '{"ลาป่วย":30}'], ['CertTitleTH', 'เกียรติบัตรเดิม'], ['Timezone', 'Asia/Bangkok']];
/* where each sheet lives on Apps Script, and its name on the host */
const SHEETS = [['MAIN', 'SCHOOL_CONFIG'], ['MAIN', 'DSPM_CRITERIA'], ['HR', 'LEAVE_REQUEST'], ['MAIN', 'LEAVE_REQUEST_STD'],
  ['MAIN', 'DAILY_JOURNAL'], ['MAIN', 'ANNOUNCEMENTS'], ['MAIN', 'AUDIT_LOG'], ['HR', 'AUDIT_LOG'],
  ['MAIN', 'HOLIDAYS'], ['MAIN', 'ADMIN_INBOX'], ['HR', 'STAFF']];
const hostName = (wb, s) => (wb === 'HR' && s === 'AUDIT_LOG') ? 'HR_AUDIT_LOG' : s;

async function viaHost(msg, who) {
  let out = '';
  const res = { setHeader() {}, writeHead() {}, end(s) { out = s; } };
  await handle({}, res, JSON.stringify(Object.assign({ token: who.token }, msg)));
  return JSON.parse(out);
}
/* an audit row's Timestamp is compared as "a time, just now" — the two sides stamp it a moment apart */
const recent = v => { const s = String(v || ''); const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + '+07:00'); return isFinite(t) && Math.abs(Date.now() - t) < 180000; };
/* A NUMBER WRITTEN INTO A TEXT COLUMN reads back as its text — DSPM_CRITERIA.AgeTo is `text` in the schema,
 * so after the switch-over Apps Script itself reads "7" (DbPg pgDecode_), exactly as the host does; only
 * this harness, which imitates Sheets, keeps 7. Compared as text for that reason. NOT used where money is
 * concerned: those columns are numeric and tools/test_fast_routes_live.js asserts typeof === 'number'. */
const norm = (name, rows) => rows.map(r => { const o = Object.assign({}, r); delete o.__id;
  if (/AUDIT_LOG$/.test(name)) o.Timestamp = recent(o.Timestamp) ? 'now' : o.Timestamp;
  /* inboxAdd_ builds its id from Date.now() + a random number and stamps the minute: the same on neither side by design */
  if (name === 'ADMIN_INBOX') { o.InboxID = String(o.InboxID || '').indexOf('IN-') === 0 ? 'IN-…' : o.InboxID; o.Date = o.Date ? 'now' : o.Date; }
  /* holidays.recurring is TEXT in the schema too: false reads back as "false" — app.js holRec() reads both */
  Object.keys(o).forEach(k => { if (typeof o[k] === 'number' || typeof o[k] === 'boolean') o[k] = String(o[k]); });
  return o; });

(async () => {
  const { client: c } = await connect();
  try {
    await c.query("insert into tenant (id, code, name_th) values ($1, $2, 'ทดสอบ route เขียนบนโฮสต์ (ข้อมูลปลอม)')", [TENANT, 'p23-' + TENANT.slice(0, 8)]);
    for (const [k, v] of CONFIG) await c.query('insert into school_config (tenant_id, "key", "value") values ($1, $2, $3)', [TENANT, k, v]);
    await PG.persist(c, TENANT, fixture(), {}, ALL);

    const pgState = async () => { const o = {}; for (const [wb, s] of SHEETS) o[hostName(wb, s)] = await PG.readSheet(c, TENANT, hostName(wb, s)); return o; };
    /* Apps Script, seeded with exactly what Postgres holds now (read back the way the host reads it) */
    delete process.env.ATOM_DB;
    const H = require('./gas_test_harness.js')(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Checkin', 'Triggers', 'Leave',
      'Notify', 'Parent', 'Staff', 'GasEngine', 'Engine', 'Payroll', 'Day6', 'OtStaff', 'OT', 'Certificate', 'Dspm', 'DspmAdmin', 'Journal', 'Announce']);
    const start = await pgState();
    start.STUDENTS = await PG.readSheet(c, TENANT, 'STUDENTS');
    H.g.__FIX = JSON.stringify(start); H.g.__SHEETS = JSON.stringify(SHEETS.concat([['MAIN', 'STUDENTS']]));
    H.run(function () {
      _configCache = null; setupAll(); _configCache = null;
      var F = JSON.parse(__FIX), main = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
      JSON.parse(__SHEETS).forEach(function (x) {
        var sh = sheet_(x[0] === 'HR' ? hr : main, x[1]);
        if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
        (F[(x[0] === 'HR' && x[1] === 'AUDIT_LOG') ? 'HR_AUDIT_LOG' : x[1]] || []).forEach(function (r) { appendObject_(sh, r); });
      });
      _configCache = null; return '';
    });
    const gasState = () => JSON.parse(H.run(function () {
      var out = {}, main = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
      JSON.parse(__SHEETS).forEach(function (x) {
        if (x[1] === 'STUDENTS') return;
        out[(x[0] === 'HR' && x[1] === 'AUDIT_LOG') ? 'HR_AUDIT_LOG' : x[1]] = readObjects_(sheet_(x[0] === 'HR' ? hr : main, x[1]))
          .map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; return o; });
      });
      return JSON.stringify(out);
    }));
    const { M } = await PG.hydrateFast(c, TENANT, ALL, {});
    M.config = await PG.hydrateConfig(c, TENANT);
    const vers = async () => Object.fromEntries((await c.query('select sheet, ver from cache_version where tenant_id = $1', [TENANT])).rows.map(r => [r.sheet, Number(r.ver)]));

    console.log('\n1) ขั้นเดียวกันทั้งสองฝั่ง — Postgres (ผ่านโฮสต์จริง) = ชีตของ Apps Script หลังทุกขั้น');
    const STEPS = [
      ['addDepartment', 'handleAddDepartment', { name: 'N3' }],
      ['renameDepartment', 'handleRenameDepartment', { old: 'N1', new: 'Nursery 1' }],
      ['setLeaveQuota', 'handleSetLeaveQuota', { type: 'ลาพักร้อน', days: 6 }],
      ['saveCertText', 'handleSaveCertText', { CertTitleTH: 'เกียรติบัตรใหม่', CertLine1TH: 'ขอมอบให้' }],
      ['saveDocInfo', 'handleSaveDocInfo', { DocSchoolName: ' Atom Nursery ', DocPhone: '02-000-0000' }],
      ['saveDspmCriteria', 'handleSaveDspmCriteria', { itemNo: 2, track: 'Teacher', data: { Description: 'มองตามของเล่น', AgeTo: '7' } }],
      ['saveDspmCriteria', 'handleSaveDspmCriteria', { data: { AgeFrom: 7, AgeTo: 9, AgeLabelTH: '7-9 เดือน', Skill: 'GM', Description: 'นั่งเอง', Track: 'Teacher' } }],
      ['deleteDspmCriteria', 'handleDeleteDspmCriteria', { itemNo: 1, track: 'Parent' }],
      ['editLeave', 'handleEditLeave', { leaveId: 'LV-2', startDate: '2026-11-24', endDate: '2026-11-25', reason: 'ย้ายวัน' }],
      ['editLeave', 'handleEditLeave', { leaveId: 'LV-2', startDate: '2026-11-17', endDate: '2026-11-17' }],
      ['cancelLeave', 'handleCancelLeave', { leaveId: 'LV-3' }],
      ['editStudentLeave', 'handleEditStudentLeave', { leaveId: 'LVS-1', date: '2026-11-11', reason: 'ไปหาหมอ' }],
      ['unlockJournal', 'handleUnlockJournal', { studentId: 'STD-1', date: '2026-11-05' }],
      ['addAnnouncement', 'handleAddAnnouncement', { title: 'ปิดเทอม', content: 'หยุด 1-5 ธ.ค.', popup: true, startDate: '2026-11-07', priority: 2, startTime: '08:30' }],
      ['editAnnouncement', 'handleEditAnnouncement', { annId: 'ANN1', title: 'ประกาศแก้แล้ว', popup: true }],
      ['deleteAnnouncement', 'handleDeleteAnnouncement', { annId: 'ANN1' }],
      // the rest of W1 (2026-11-09): holidays go through the ENGINE (holidayWrite_ → engineDispatch_ → M.holidays → persist)
      ['addHoliday', 'holidayWrite_', { date: '2026-12-05', nameTH: 'วันพ่อแห่งชาติ', nameEN: "Father's Day" }, { args: ['addHoliday'] }],
      ['editHoliday', 'holidayWrite_', { date: '2026-12-05', nameTH: 'วันพ่อแห่งชาติ', startTime: '12:00', endTime: '17:00' }, { args: ['editHoliday'] }],
      ['removeHoliday', 'holidayWrite_', { date: '2026-12-31', nameTH: 'วันสิ้นปี' }, { args: ['removeHoliday'] }],
      ['addBigCleaning', 'handleAddBigCleaning', { date: '2026-11-20' }],
      ['addBigCleaning', 'handleAddBigCleaning', { date: '2026-12-18' }],
      ['removeBigCleaning', 'handleRemoveBigCleaning', { date: '2026-11-20' }],
      ['recallJournalsMany', 'handleRecallJournalsMany', { date: '2026-11-06', studentIds: ['STD-1', 'STD-2', 'STD-9'] }, { who: 'HEAD' }]];
    const replies = [];
    for (const [a, fn, ask, opt] of STEPS) {
      const o = opt || {}, who = WHOM[o.who || 'ADMIN'];
      const v0 = await vers();
      const p = GATE.identity(a, JSON.parse(JSON.stringify(ask)), who.sess, M);
      H.g.__P = JSON.stringify(p); H.g.__F = fn; H.g.__A = JSON.stringify(o.args || []);
      const want = JSON.parse(H.run(function () {
        _configCache = null;
        try { return JSON.stringify({ ok: true, data: this[__F].apply(null, JSON.parse(__A).concat([JSON.parse(__P)])) }); }
        catch (e) { return JSON.stringify({ ok: false, code: e.apiCode || e.message }); } }));
      const got = await viaHost({ action: a, payload: ask }, who);
      replies.push([a, got]);
      const g = JSON.stringify(got.ok ? { ok: true, data: got.data } : { ok: false, code: got.error && got.error.code });
      ok_(a + ' ' + JSON.stringify(ask).slice(0, 70) + ' — คำตอบ' + (g === JSON.stringify(want) ? '' : '\n         host=' + g.slice(0, 300) + '\n          gas=' + JSON.stringify(want).slice(0, 300)), g === JSON.stringify(want));
      const pg = await pgState(), gs = gasState();
      const diff = Object.keys(gs).filter(k => JSON.stringify(norm(k, pg[k] || [])) !== JSON.stringify(norm(k, gs[k])));
      ok_('   ...สถานะทุกตาราง' + (diff.length ? '  ต่าง: ' + diff.join(',') : ''), !diff.length);
      diff.forEach(k => console.log('         ' + k + '\n            pg=' + JSON.stringify(norm(k, pg[k] || [])).slice(0, 500) + '\n           gas=' + JSON.stringify(norm(k, gs[k])).slice(0, 500)));
      if (got.ok) {
        const v1 = await vers();
        const bumped = Object.keys(v1).filter(s => (v1[s] || 0) > (v0[s] || 0));
        ok_('   ...เวอร์ชันแคชของตารางที่เขียนขยับ (' + bumped.join(',') + ')', bumped.length > 0);
      }
    }

    console.log('\n2) ข้อเท็จจริง — ว่าการเทียบข้างบนเทียบของจริง');
    const pg = await pgState();
    const cfg = Object.fromEntries(pg.SCHOOL_CONFIG.map(r => [r.Key, r.Value]));
    ok_('แผนก · โควตา · ใบประกาศ · ใบเสร็จ อยู่ใน school_config จริง', cfg.Departments === 'Nursery 1,N2,N3' && JSON.parse(cfg.LeaveQuota)['ลาพักร้อน'] === 6 && cfg.CertLine1TH === 'ขอมอบให้' && cfg.DocSchoolName === 'Atom Nursery');
    ok_('เกณฑ์ DSPM: แก้ · เพิ่ม · ลบ', pg.DSPM_CRITERIA.map(r => r.Track + r.ItemNo + ':' + r.Description).join('|') === 'Teacher1:ยกศีรษะ|Teacher2:มองตามของเล่น|Teacher3:นั่งเอง');
    ok_('ใบลา: LV-2 ย้ายวัน (การแก้ที่ทับใบเดิมถูกปฏิเสธ) · LV-3 ถูกลบ', pg.LEAVE_REQUEST.map(r => r.LeaveID + ':' + r.StartDate).join('|') === 'LV-1:2026-11-17|LV-2:2026-11-24'
      && replies[9][1].ok === false && replies[9][1].error.code === 'LEAVE_OVERLAP');
    ok_('บันทึกกลับเป็นร่าง · ประกาศใหม่ ANN-2 (popup = true เป็น boolean)', pg.DAILY_JOURNAL[0].Status === 'DRAFT' && pg.ANNOUNCEMENTS.length === 1 && pg.ANNOUNCEMENTS[0].AnnID === 'ANN-2' && pg.ANNOUNCEMENTS[0].Popup === true);
    ok_('🔴 บันทึกตรวจสอบ: audit_log 5 แถว (+ส่งบันทึกกลับ) · hr_audit_log 2 แถว (แก้ลา · ยกเลิก — ตาราง HR แยกจริง)', pg.AUDIT_LOG.length === 5 && pg.AUDIT_LOG[4].Action === 'JOURNAL_RECALL_MANY' && pg.HR_AUDIT_LOG.length === 2 &&
      pg.HR_AUDIT_LOG.map(r => r.Action).join() === 'LEAVE_EDIT,LEAVE_CANCEL');
    ok_('วันหยุด: เพิ่ม 05/12 (ครึ่งวัน 12:00-17:00) · ลบ 31/12', pg.HOLIDAYS.map(r => r.Date + ':' + r.StartTime + '-' + r.EndTime).join('|') === '2026-12-05:12:00-17:00');
    ok_('Big Cleaning: เหลือ 18/12 วันเดียว', String(cfg.BigCleaningDays || '') === '2026-12-18');
    ok_('หัวหน้าครูส่งบันทึก 06/11 กลับ 2 ใบ → เป็นร่าง + กล่องแจ้งเตือนครูเจ้าของ 2 ข้อความ', pg.DAILY_JOURNAL.filter(r => r.Date === '2026-11-06').every(r => r.Status === 'DRAFT')
      && pg.ADMIN_INBOX.map(r => r.StaffID).sort().join() === 'STF-T,STF-U');

    console.log('\n3) 🔴 ด่าน');
    {
      const before = JSON.stringify(await pgState());
      for (const [a, ask] of [['addDepartment', { name: 'แอบเพิ่ม' }], ['cancelLeave', { leaveId: 'LV-1' }], ['unlockJournal', { studentId: 'STD-1', date: '2026-11-05' }]]) {
        const r = await viaHost({ action: a, payload: ask }, TEACHER);
        ok_('ครูเรียก ' + a + ' → ' + (r.error && r.error.code), r.ok === false && r.error.code === 'NO_PERMISSION');
      }
      const img = await viaHost({ action: 'addAnnouncement', payload: { title: 'มีรูป', image: 'data:image/png;base64,iVBORw0KGgo=' } }, ADMIN);
      ok_('ประกาศที่มีรูป → NOT_ON_FAST_HOST (แอปส่งต่อให้ Apps Script)', img.ok === false && img.error.code === 'NOT_ON_FAST_HOST');
      ok_('...และไม่มีอะไรในฐานข้อมูลเปลี่ยนเลย', JSON.stringify(await pgState()) === before);
      /* a holiday dated TODAY re-checks today's staff check-ins (and may send LINE) — that half stays on Apps Script */
      const hol = await viaHost({ action: 'addHoliday', payload: { date: TODAY, nameTH: 'หยุดกะทันหัน' } }, ADMIN);
      ok_('เพิ่มวันหยุดเป็นวันนี้ → ' + (hol.error && hol.error.code) + ' (แอปส่งต่อให้ Apps Script)', hol.ok === false && ['NOT_ON_FAST_HOST', 'READ_ONLY_HOST'].includes(hol.error.code));
      ok_('...และไม่มีอะไรในฐานข้อมูลเปลี่ยนเลย', JSON.stringify(await pgState()) === before);
      const rc = await viaHost({ action: 'recallJournalsMany', payload: { date: '2026-11-05', studentIds: ['STD-1'] } }, TEACHER);
      ok_('ครูธรรมดาส่งบันทึกกลับ → ' + (rc.error && rc.error.code), rc.ok === false);
      const b = await viaHost({ action: 'batch', payload: { calls: [{ action: 'cancelLeave', payload: { leaveId: 'LV-1' } }, { action: 'allLeaves', payload: {} }] } }, ADMIN);
      ok_('batch [ยกเลิกใบลา, รายการลา] — รายการเห็นผลของการยกเลิกทันที', b.ok && b.data[0].ok && b.data[1].ok && b.data[1].data.map(x => x.LeaveID).join() === 'LV-2');
      ok_('...และบันทึกจริง', (await PG.readSheet(c, TENANT, 'LEAVE_REQUEST')).map(r => r.LeaveID).join() === 'LV-2');
    }
  } finally {
    const tabs = (await c.query("select table_name from information_schema.tables where table_schema='public' and table_name <> 'tenant'")).rows.map(r => r.table_name);
    for (const t of tabs) { try { await c.query('delete from ' + t + ' where tenant_id = $1', [TENANT]); } catch (e) {} }
    await c.query('delete from tenant where id = $1', [TENANT]);
    const left = (await c.query('select count(*)::int n from school_config where tenant_id = $1', [TENANT])).rows[0].n;
    console.log('\n🧹 ลบ tenant ทดสอบแล้ว (เหลือ ' + left + ' แถว)');
    await c.end();
  }
  console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('🔴 ' + (e && e.stack || e)); process.exit(1); });
