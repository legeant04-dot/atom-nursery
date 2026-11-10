/**
 * tools/test_fast_route_checkin_live.js — W3 staff clock-in/out through server/host.js and staging Postgres
 *   node tools/test_fast_route_checkin_live.js       (needs secrets/supabase.env — fabricated data only)
 *
 * tools/test_fast_route_checkin.js proves routes.js computes the same lateness and OT as Apps Script from the
 * same rows. This proves the host's half: the session pins WHO is clocking in (a teacher cannot punch for a
 * colleague), the rows are COMMITTED to real tables with real column types, and they read back baht for baht
 * equal to what Apps Script wrote for the same step at the same minute. LINE_SEND=capture — nothing is sent.
 * 🔴 Fabricated data only; the tenant is deleted at the end (pg_sweep_tenants knows the p23- prefix).
 */
'use strict';
const path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const TENANT = crypto.randomUUID();
const SECRET = 'route-checkin-live-' + crypto.randomBytes(12).toString('hex');
process.env.SESSION_SECRET = SECRET;
process.env.TENANT_ID = TENANT;
process.env.LINE_SEND = 'capture';
delete process.env.LINE_TOKEN;

const { connect } = require(path.join(ROOT, 'tools', 'pg_lib.js'));
const PG = require(path.join(ROOT, 'tools', 'pg_engine.js'));
const GATE = require(path.join(ROOT, 'server', 'gate.js'));
const LINE = require(path.join(ROOT, 'server', 'line_send.js'));
const ROUTES = require(path.join(ROOT, 'server', 'routes.js'));
const { handle } = require(path.join(ROOT, 'server', 'host.js'));
const { sign_ } = require(path.join(ROOT, 'server', 'session.js'));
const ALL = Object.keys(PG.COLLECTIONS);

const REAL_NOW = Date.now();
const tokenFor = (role, linkedId, uid) => {
  const b = Buffer.from(JSON.stringify({ uid, role, linkedId, iat: REAL_NOW, exp: REAL_NOW + 3600e3 })).toString('base64');
  return { sess: { uid, role, linkedId }, token: b + '.' + sign_(b, SECRET) };
};
const T = tokenFor('Teacher', 'STF-T', 'U-T'), U = tokenFor('Teacher', 'STF-U', 'U-U'), L = tokenFor('Teacher', 'STF-L', 'U-L'),
  Hd = tokenFor('Teacher', 'STF-H', 'U-H'), OBS = tokenFor('Observer', 'STF-O', 'U-O'), A = tokenFor('Admin', 'STF-A', 'U-A');

const LAT = 13.7563, LNG = 100.5018;
const st = (id, name, extra) => Object.assign({ StaffID: id, Name: name, Role: 'Teacher', PositionLevel: 'Teacher', Department: 'N1', Status: 'ACTIVE', StartDate: '2025-01-01', BaseSalary: 24000 }, extra || {});
const SEED = {
  STAFF: [st('STF-T', 'ครูที', { StaffGroup: 'G1' }), st('STF-U', 'ครูยู'), st('STF-L', 'หัวหน้าแอล', { PositionLevel: 'Leader' }), st('STF-H', 'ครูวันหยุด'),
    st('STF-O', 'ผู้ตรวจ', { Role: 'Observer' }), st('STF-A', 'แอดมินเอ', { Role: 'Admin', PositionLevel: 'Admin' })],
  STAFF_GROUPS: [{ GroupName: 'G1', GroupNameEN: 'G1', CheckInTime: '07:30', CheckOutTime: '16:30' }],
  HOLIDAYS: [{ Date: '2026-11-11', NameTH: 'วันหยุดทั้งวัน' }, { Date: '2026-11-12', NameTH: 'ประชุมผู้ปกครอง', StartTime: '08:00', EndTime: '12:00' }],
  OT_RECORDS: [{ OTRecordID: 'OTR-0001', StaffID: 'STF-H', Date: '2026-11-15', Hours: 0, Rate: 0, Amount: 800, Status: 'APPROVED', Kind: 'HOLIDAY', Month: '2026-11', Note: 'เหมาจ่าย' }],
  LINE_RECIPIENTS: [{ Name: 'ผอ.', LineUID: 'Udirectortest0004', Topics: 'approval', Active: 'YES', Note: '' }]
};
const CONFIG = [['Timezone', 'Asia/Bangkok'], ['GPS_Lat', String(LAT)], ['GPS_Lng', String(LNG)], ['Radius', '30'], ['LateGraceMinutes', '5'],
  ['DefaultCheckInTime', '08:00'], ['DefaultCheckOutTime', '17:00'], ['StaffOTHourlyRate', '100'], ['OTRoundUpMinutes', '50'], ['EarlyLeaveMinutes', '30'],
  ['BigCleaningDays', '2026-11-14'], ['BigCleaningIn', '08:30'], ['BigCleaningOut', '17:00'], ['HolidayReopenWindowMinutes', '15'],
  ['LineChannelAccessToken', 'fake-token-not-real'], ['NotifyAdminApproval', 'app'], ['NotifyStaffApproval', 'app,line']];
/* compared after every step … and seeded on both sides */
const SHEETS = [['HR', 'CHECKIN_STAFF'], ['HR', 'OT_RECORDS'], ['MAIN', 'ADMIN_INBOX'], ['MAIN', 'AUDIT_LOG'], ['HR', 'AUDIT_LOG'], ['HR', 'ATTENDANCE_REQUEST']];
const SEEDED = [['MAIN', 'SCHOOL_CONFIG'], ['HR', 'STAFF'], ['HR', 'STAFF_GROUPS'], ['HR', 'WORK_SCHEDULE'], ['MAIN', 'HOLIDAYS'], ['MAIN', 'USERS'], ['MAIN', 'LINE_RECIPIENTS']];
const hostName = (wb, s) => (wb === 'HR' && s === 'AUDIT_LOG') ? 'HR_AUDIT_LOG' : s;

async function viaHost(msg, who) {
  let out = ''; const hdr = {};
  const res = { setHeader(k, v) { hdr[k.toLowerCase()] = v; }, writeHead() {}, end(s) { out = s; } };
  await handle({}, res, JSON.stringify(Object.assign({ token: who.token }, msg)));
  const r = JSON.parse(out);
  r.__line = hdr['x-atom-line'] ? JSON.parse(hdr['x-atom-line']) : [];
  return r;
}
/* STORAGE, not meaning (docs/schema/001_init.sql): numbers come back as numbers on both sides once stringified;
 * a `time` column answers HH:mm:ss where the sheet holds HH:mm; a `date` answers the day. Both sides run at the
 * same fixed minute, so audit and inbox stamps are compared as written — only the random inbox id is masked. */
const norm = (name, rows) => rows.map(r => { const o = Object.assign({}, r); delete o.__id;
  if (name === 'ADMIN_INBOX') o.InboxID = String(o.InboxID || '').indexOf('IN-') === 0 ? 'IN-…' : o.InboxID;
  /* the same INSTANT, written two ways: the harness hands a Date back as ISO (…Z), Postgres as the school's
   * wall clock. Compared as the instant, to the minute. */
  if (/AUDIT_LOG$/.test(name)) { const s = String(o.Timestamp || '');
    const t = Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + '+07:00');
    o.Timestamp = isFinite(t) ? 'min:' + Math.floor(t / 60000) : s; }
  Object.keys(o).forEach(k => {
    if (o[k] == null) o[k] = '';
    if (typeof o[k] === 'number' || typeof o[k] === 'boolean') o[k] = String(o[k]);
    if (/^\d{2}:\d{2}:00$/.test(o[k])) o[k] = o[k].slice(0, 5);
    if (/^-?\d+\.0+$/.test(o[k])) o[k] = o[k].replace(/\.0+$/, '');
  });
  return o; });

(async () => {
  const { client: c } = await connect();
  try {
    await c.query("insert into tenant (id, code, name_th) values ($1, $2, 'ทดสอบลงเวลาครูบนโฮสต์ (ข้อมูลปลอม)')", [TENANT, 'p23-' + TENANT.slice(0, 8)]);
    for (const [k, v] of CONFIG) await c.query('insert into school_config (tenant_id, "key", "value") values ($1, $2, $3)', [TENANT, k, v]);
    for (const s of Object.keys(SEED)) for (const row of SEED[s]) await PG.insertSheetRow(c, TENANT, s, row);

    delete process.env.ATOM_DB;
    const H = require('./gas_test_harness.js')(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Checkin', 'Triggers', 'Leave',
      'Notify', 'Parent', 'Staff', 'GasEngine', 'Engine', 'Payroll', 'Day6', 'OtStaff', 'OT', 'AttReq', 'Password', 'PaySlips', 'Certificate', 'Dspm', 'DspmAdmin', 'Journal', 'Announce']);
    const start = {};
    for (const [wb, s] of SHEETS.concat(SEEDED)) start[hostName(wb, s)] = await PG.readSheet(c, TENANT, hostName(wb, s));
    H.g.__FIX = JSON.stringify(start); H.g.__SHEETS = JSON.stringify(SHEETS.concat(SEEDED));
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
      JSON.parse(__SHEETS).slice(0, 6).forEach(function (x) {
        out[(x[0] === 'HR' && x[1] === 'AUDIT_LOG') ? 'HR_AUDIT_LOG' : x[1]] = readObjects_(sheet_(x[0] === 'HR' ? hr : main, x[1]))
          .map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; return o; });
      });
      return JSON.stringify(out);
    }));
    const pgState = async () => { const o = {}; for (const [wb, s] of SHEETS) o[hostName(wb, s)] = await PG.readSheet(c, TENANT, hostName(wb, s)); return o; };
    const { M } = await PG.hydrateFast(c, TENANT, ALL, {});
    M.config = await PG.hydrateConfig(c, TENANT);

    H.g.__FAKE = ROUTES.FAKE_DATE;
    const at = (ymd, hm) => { const ms = Date.parse(ymd + 'T' + hm + ':00+07:00'); ROUTES.setClock(ms); H.g.__MS = ms;
      H.run(function () { if (typeof __RD === 'undefined') __RD = Date; Date = __RD; eval(__FAKE)(__MS); return ''; }); };

    const step = async (label, a, fn, ask, who) => {
      const p = GATE.identity(a, JSON.parse(JSON.stringify(ask)), who.sess, M);
      H.g.__P = JSON.stringify(p); H.g.__F = fn;
      const want = JSON.parse(H.run(function () {
        _configCache = null; PUSH.length = 0;
        var r; try { r = { ok: true, data: this[__F](JSON.parse(__P)) }; } catch (e) { r = { ok: false, code: e.apiCode || e.message }; }
        r.line = PUSH.slice(); return JSON.stringify(r); }));
      const got = await viaHost({ action: a, payload: ask }, who);
      if (!got.ok && process.env.DEBUG_LIVE) console.log('         host error: ' + JSON.stringify(got.error).slice(0, 400));
      const g = JSON.stringify(got.ok ? { ok: true, data: got.data } : { ok: false, code: got.error && got.error.code });
      const w = JSON.stringify(want.ok ? { ok: true, data: want.data } : { ok: false, code: want.code });
      ok_(label + ' — คำตอบ' + (g === w ? '' : '\n         host=' + g.slice(0, 300) + '\n          gas=' + w.slice(0, 300)), g === w);
      const pg = await pgState(), gs = gasState();
      const diff = Object.keys(gs).filter(k => JSON.stringify(norm(k, pg[k] || [])) !== JSON.stringify(norm(k, gs[k])));
      ok_('   ...ทุกตารางใน Postgres = Apps Script' + (diff.length ? '  ต่าง: ' + diff.join(',') : ''), !diff.length);
      diff.forEach(k => { const P = norm(k, pg[k] || []), Gs = norm(k, gs[k]); const fields = [];
        Gs.forEach((gr, i) => { const pr = P[i] || {}; Object.keys(Object.assign({}, gr, pr)).forEach(f => {
          if (JSON.stringify(gr[f]) !== JSON.stringify(pr[f])) fields.push('#' + i + '.' + f + ' pg=' + JSON.stringify(pr[f]) + ' gas=' + JSON.stringify(gr[f])); }); });
        console.log('         ' + k + ' (pg ' + P.length + ' แถว · gas ' + Gs.length + ' แถว)\n           ' + fields.slice(0, 8).join('\n           ')); });
      const wantFp = want.line.map(x => LINE.fingerprint({ to: x.to, messages: [{ type: 'text', text: x.text }] }));
      ok_('   ...LINE ที่โฮสต์จด = ที่ Apps Script ส่ง (' + wantFp.length + ')', JSON.stringify(got.__line) === JSON.stringify(wantFp));
      return { got, want };
    };
    const here = extra => Object.assign({ lat: LAT, lng: LNG, acc: 10 }, extra || {});
    const IN = 'staffCheckin', INF = 'handleStaffCheckin', OUT = 'staffCheckout', OUTF = 'handleStaffCheckout';
    const ck = async id => (await PG.readSheet(c, TENANT, 'CHECKIN_STAFF')).filter(r => r.StaffID === id).slice(-1)[0] || {};
    const ot = async id => (await PG.readSheet(c, TENANT, 'OT_RECORDS')).filter(r => r.StaffID === id).slice(-1)[0] || {};

    console.log('\n1) วันอังคาร 10/11/2026 — เข้างาน');
    at('2026-11-10', '07:25');
    let r = await step('ครูกลุ่ม G1 (07:30) มา 07:25', IN, INF, here(), T);
    ok_('💰 แถวอยู่ใน Postgres: ไม่สาย', Number((await ck('STF-T')).LateMinutes) === 0 && String((await ck('STF-T')).CheckIn).slice(0, 5) === '07:25');
    await step('🔴 กดซ้ำ → ALREADY_CHECKED_IN', IN, INF, here(), T);
    at('2026-11-10', '08:20');
    r = await step('ครูค่าเริ่มต้น 08:00 มา 08:20', IN, INF, here(), U);
    ok_('💰 สาย 15 นาที ใน Postgres', Number((await ck('STF-U')).LateMinutes) === 15 && r.got.data.lateMinutes === 15);
    {
      const before = (await PG.readSheet(c, TENANT, 'CHECKIN_STAFF')).length;
      r = await step('🔴 ครูส่ง staffId ของเพื่อนมา — เซสชันเป็นคนตัดสิน', IN, INF, here({ staffId: 'STF-L' }), U);
      ok_('🔴 ...ลงเวลาแทนคนอื่นไม่ได้: ไม่มีแถวของหัวหน้าเกิดขึ้น', (await PG.readSheet(c, TENANT, 'CHECKIN_STAFF')).length === before && !(await ck('STF-L')).StaffID);
      const o = await viaHost({ action: IN, payload: here() }, OBS);
      ok_('🔴 ผู้ตรวจ (Observer) → ' + (o.error && o.error.code) + ' ไม่บันทึก', o.ok === false && (await PG.readSheet(c, TENANT, 'CHECKIN_STAFF')).length === before);
    }
    at('2026-11-10', '08:00');
    await step('หัวหน้ามา 08:00', IN, INF, here(), L);
    await step('🔴 อยู่นอกรัศมี → OUT_OF_RANGE', IN, INF, here({ lat: LAT + 0.01 }), Hd);

    console.log('\n2) วันอังคาร — ออกงาน และ 💰 OT');
    at('2026-11-10', '16:00');
    r = await step('ครู G1 ออก 16:00 (ก่อนเวลา 30 นาที)', OUT, OUTF, here(), T);
    ok_('...ไม่มี OT · เสนอใบลา', r.got.data && r.got.data.early === true && r.got.data.otHours === 0);
    at('2026-11-10', '18:53');
    r = await step('ครูเลิก 17:00 ออก 18:53', OUT, OUTF, here(), U);
    { const o = await ot('STF-U');
      ok_('💰 Postgres: OT 2 ชม. × 100 = 200.00 · PENDING_LEADER · 113 นาที', Number(o.Hours) === 2 && Number(o.Rate) === 100 && Number(o.Amount) === 200 && o.Status === 'PENDING_LEADER' && Number(o.Minutes) === 113 && o.Month === '2026-11');
      ok_('...จด LINE ถึงคนในรายชื่อ 1 ข้อความ', r.got.__line.length === 1 && r.want.line[0].to === 'Udirectortest0004'); }
    at('2026-11-10', '19:00');
    r = await step('หัวหน้าออก 19:00', OUT, OUTF, here(), L);
    ok_('💰 OT ของหัวหน้าข้ามขั้นแรก (PENDING_ADMIN)', (await ot('STF-L')).Status === 'PENDING_ADMIN' && (await ot('STF-L')).Step1Status === 'Skipped');
    await step('🔴 ออกซ้ำ → ALREADY_CHECKED_OUT', OUT, OUTF, here(), L);
    await step('🔴 ยังไม่ได้เข้างาน → NOT_CHECKED_IN', OUT, OUTF, here(), Hd);

    console.log('\n3) วันหยุด · ครึ่งวัน · Big Cleaning · OT วันหยุด');
    at('2026-11-11', '08:00'); await step('🔴 วันหยุดทั้งวัน → SCHOOL_CLOSED', IN, INF, here(), T);
    at('2026-11-12', '09:00'); await step('🔴 ช่วงที่ยังปิด → SCHOOL_CLOSED', IN, INF, here(), U);
    at('2026-11-12', '11:50'); r = await step('มารอก่อนเปิด 10 นาที', IN, INF, here(), U);
    ok_('💰 ไม่สาย', r.got.data && r.got.data.lateMinutes === 0);
    at('2026-11-12', '12:20'); r = await step('กะ 08:00 มา 12:20 (เปิด 12:00 · ผ่อนผัน 15)', IN, INF, here(), L);
    ok_('💰 สาย 5 นาที ใน Postgres', Number((await ck('STF-L')).LateMinutes) === 5);
    at('2026-11-14', '08:40'); r = await step('Big Cleaning มา 08:40', IN, INF, here(), T);
    ok_('💰 สาย 5 (วัดจาก 08:30)', r.got.data && r.got.data.lateMinutes === 5);
    at('2026-11-14', '18:00'); r = await step('Big Cleaning ออก 18:00', OUT, OUTF, here(), T);
    ok_('💰 OT 1 ชม. จาก 17:00 = 100', Number((await ot('STF-T')).Amount) === 100 && String((await ot('STF-T')).PlanOut).slice(0, 5) === '17:00');
    at('2026-11-15', '09:30'); await step('🔴 วันอาทิตย์ คนทั่วไป → SCHOOL_CLOSED', IN, INF, here(), T);
    r = await step('คนที่ได้ OT วันหยุด ลงเวลาได้', IN, INF, here(), Hd);
    at('2026-11-15', '20:00');
    { const n = (await PG.readSheet(c, TENANT, 'OT_RECORDS')).length;
      r = await step('...ออก 20:00', OUT, OUTF, here(), Hd);
      ok_('💰 ไม่มี OT รายชั่วโมงซ้อนเหมาจ่าย', r.got.data && r.got.data.otHours === 0 && (await PG.readSheet(c, TENANT, 'OT_RECORDS')).length === n && r.got.__line.length === 0); }

    console.log('\n4) 💰 อนุมัติ OT: หัวหน้า → แอดมิน (ใน Postgres)');
    const otAll = async () => PG.readSheet(c, TENANT, 'OT_RECORDS');
    const idOf = async (sid, d) => ((await otAll()).find(x => x.StaffID === sid && String(x.Date).slice(0, 10) === d) || {}).OTRecordID;
    const row = async id => (await otAll()).find(x => x.OTRecordID === id) || {};
    const uTue = await idOf('STF-U', '2026-11-10'), tSat = await idOf('STF-T', '2026-11-14');
    await step('🔴 ครูธรรมดาอนุมัติ → NO_PERMISSION', 'approveOT', 'handleApproveOT', { otId: uTue, decision: 'approve' }, U);
    r = await step('หัวหน้าอนุมัติ OT ของครูยู', 'approveOT', 'handleApproveOT', { otId: uTue, decision: 'approve' }, L);
    ok_('...Postgres: PENDING_ADMIN · Step1By หัวหน้าแอล', (await row(uTue)).Status === 'PENDING_ADMIN' && (await row(uTue)).Step1By === 'หัวหน้าแอล');
    await step('🔴 อนุมัติซ้ำ → BAD_STATE', 'approveOT', 'handleApproveOT', { otId: uTue, decision: 'approve' }, L);
    { const o = await viaHost({ action: 'confirmOT', payload: { staffId: 'STF-A', otId: uTue, decision: 'approve' } }, L);
      ok_('🔴 หัวหน้าเรียกขั้นแอดมิน (แม้ส่ง staffId ของแอดมินมา) → ' + (o.error && o.error.code) + ' ที่ประตู ไม่บันทึก', o.ok === false && (await row(uTue)).Status === 'PENDING_ADMIN'); }
    { const o = await viaHost({ action: 'confirmOT', payload: { staffId: 'STF-A', otId: uTue, decision: 'approve' } }, OBS);
      ok_('🔴 ผู้ตรวจ (Observer) ยืนยันไม่ได้ → ' + (o.error && o.error.code), o.ok === false && (await row(uTue)).Status === 'PENDING_ADMIN'); }
    /* the school corrects its OT rate before approving — both sides */
    await c.query("update school_config set value = '120' where tenant_id = $1 and key = 'StaffOTHourlyRate'", [TENANT]);
    H.run(function () { _configCache = null; setConfigValue_('StaffOTHourlyRate', '120'); _configCache = null; return ''; });
    r = await step('💰 แอดมินยืนยันหลังแก้อัตราเป็น 120', 'confirmOT', 'handleConfirmOT', { staffId: 'STF-A', otId: uTue, decision: 'approve' }, A);
    { const o = await row(uTue);
      ok_('💰 Postgres: 2 ชม. × 120 = 240 · APPROVED · ApprovedBy แอดมินเอ', o.Status === 'APPROVED' && Number(o.Hours) === 2 && Number(o.Rate) === 120 && Number(o.Amount) === 240 && o.ApprovedBy === 'แอดมินเอ'); }
    r = await step('💰 ยืนยัน OT วันหยุดเหมาจ่าย', 'confirmOT', 'handleConfirmOT', { staffId: 'STF-A', otId: 'OTR-0001', decision: 'approve' }, A);
    ok_('💰 800 คงเดิม (ไม่ถูกคิดเป็นชั่วโมง × อัตรา)', Number((await row('OTR-0001')).Amount) === 800);
    r = await step('แอดมินไม่อนุมัติ OT Big Cleaning', 'confirmOT', 'handleConfirmOT', { staffId: 'STF-A', otId: tSat, decision: 'reject' }, A);
    ok_('...REJECTED', (await row(tSat)).Status === 'REJECTED' && (await row(tSat)).Step2Status === 'Rejected');

    console.log('\n5) ขอลงเวลา: ยื่น → หัวหน้า (ใน Postgres · ขั้นแอดมินอยู่ W4)');
    const reqs = async () => PG.readSheet(c, TENANT, 'ATTENDANCE_REQUEST');
    at('2026-11-17', '09:00');
    r = await step('ครูยูขอลงเวลาเข้า 16/11 07:55', 'submitTimeRequest', 'handleSubmitTimeRequest', { type: 'IN', date: '2026-11-16', time: '07:55', reason: 'GPS ใช้ไม่ได้' }, U);
    { const q = (await reqs())[0] || {};
      ok_('...Postgres: ATR-001 · PENDING_LEADER · StaffID จากเซสชัน · เวลา 07:55', q.ReqID === 'ATR-001' && q.Status === 'PENDING_LEADER' && q.StaffID === 'STF-U' && String(q.RequestTime).slice(0, 5) === '07:55'); }
    {
      const n = (await reqs()).length;
      await step('🔴 ครูส่ง staffId ของหัวหน้ามา — คำขอยังเป็นของตัวเอง', 'submitTimeRequest', 'handleSubmitTimeRequest', { staffId: 'STF-L', type: 'OUT', date: '2026-11-16', time: '18:00' }, U);
      const q = (await reqs()).slice(-1)[0] || {};
      ok_('🔴 ...แถวใหม่เป็นของ STF-U และรอหัวหน้า (ไม่ข้ามขั้นแบบหัวหน้า)', (await reqs()).length === n + 1 && q.StaffID === 'STF-U' && q.Status === 'PENDING_LEADER');
    }
    at('2026-11-17', '10:30');
    await step('🔴 ครูธรรมดาอนุมัติ → NO_PERMISSION', 'approveTimeRequest', 'handleApproveTimeRequest', { reqId: 'ATR-001', decision: 'approve' }, T);
    r = await step('หัวหน้าอนุมัติ ATR-001', 'approveTimeRequest', 'handleApproveTimeRequest', { reqId: 'ATR-001', decision: 'approve' }, L);
    { const q = (await reqs()).find(x => x.ReqID === 'ATR-001') || {};
      ok_('...Postgres: PENDING_ADMIN · Step1At มีวันและเวลา (timestamptz)', q.Status === 'PENDING_ADMIN' && /2026-11-17.10:30/.test(String(q.Step1At))); }
    r = await step('หัวหน้าไม่อนุมัติ ATR-002 พร้อมเหตุผล', 'approveTimeRequest', 'handleApproveTimeRequest', { reqId: 'ATR-002', decision: 'reject', reason: 'วันนั้นออก 17:00' }, L);
    ok_('...REJECTED · เหตุผลอยู่ใน Postgres · จด LINE ถึงผู้ขอ 0 (ไม่มี LineUID) · กระดิ่ง 1', ((await reqs()).find(x => x.ReqID === 'ATR-002') || {}).DecisionNote === 'วันนั้นออก 17:00' && r.got.__line.length === 0);
  } finally {
    ROUTES.setClock(null);
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
