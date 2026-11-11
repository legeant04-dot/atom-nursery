/**
 * tools/test_fast_route_pickup_live.js — W3 parent drop-off / pick-up through server/host.js and staging Postgres
 *   node tools/test_fast_route_pickup_live.js       (needs secrets/supabase.env — fabricated data only)
 *
 * tools/test_fast_route_pickup.js proves routes.js charges late pick-up exactly as Apps Script does from the same
 * rows. This proves the host's half: the session decides WHICH FAMILY is acting (another family's child is
 * NO_ACCESS), rows are COMMITTED to real tables with real column types (OT_DAILY numerics, CHECKIN_STUDENT
 * date/time), the double-tap window still finds today's row after Postgres has typed it, and a pick-up refused
 * outside the fence still leaves its audit row (routes.js keepOnRefusal). LINE_SEND=capture — nothing is sent.
 * 🔴 Fabricated data only; the tenant is deleted at the end (pg_sweep_tenants knows the p23- prefix).
 */
'use strict';
const path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const TENANT = crypto.randomUUID();
const SECRET = 'route-pickup-live-' + crypto.randomBytes(12).toString('hex');
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
const P1 = tokenFor('Parent', 'PAR-01', 'Uparenttest00001'), P4 = tokenFor('Parent', 'PAR-04', 'Uparenttest00004'),
  P9 = tokenFor('Parent', 'PAR-09', 'Uparenttest00009'), P10 = tokenFor('Parent', 'PAR-10', 'Uparenttest00010'),
  T = tokenFor('Teacher', 'STF-T', 'Uteachertest0001'), Z = tokenFor('Teacher', 'STF-Z', 'Uteachertest0009');

const LAT = 13.7563, LNG = 100.5018;
const kid = (id, nick, extra) => Object.assign({ StudentID: id, Name: 'ด.ช. ' + nick, Nickname: nick, Class: 'N1', Plan: 'P1', ParentID: 'PAR-' + id.slice(-2),
  Status: 'ACTIVE', EnrollDate: '2026-06-01' }, extra || {});
const mom = id => ({ ParentID: 'PAR-' + id.slice(-2), Name: 'แม่' + id.slice(-2), Relationship: 'มารดา', Phone: '0800000000', LineUID: 'Uparenttest000' + id.slice(-2), StudentID: id });
const SEED = {
  PARENTS: ['S01', 'S04', 'S09', 'S10'].map(mom),
  STUDENTS: [kid('S01', 'เอ'), kid('S04', 'ดี', { OTRate: 150 }), kid('S09', 'ไอ', { Plan: 'P2' }), kid('S10', 'เจ')],
  CLASSES: [{ ClassID: 'C1', ClassName: 'N1', TeacherID: 'STF-T' }, { ClassID: 'C2', ClassName: 'N2', TeacherID: 'STF-Z' }],
  STAFF: [{ StaffID: 'STF-T', Name: 'ครูที', Role: 'Teacher', PositionLevel: 'Teacher', Department: 'N1', Status: 'ACTIVE', StartDate: '2025-01-01', LineUID: 'Uteachertest0001' },
    { StaffID: 'STF-Z', Name: 'ครูห้องอื่น', Role: 'Teacher', PositionLevel: 'Teacher', Department: 'N2', Status: 'ACTIVE', StartDate: '2025-01-01' }],
  LEAVE_REQUEST_STD: [{ LeaveID: 'LVS-0001', StudentID: 'S04', Date: '2026-11-13', Type: 'ลาป่วย', Reason: 'มีไข้', Status: 'APPROVED' },
    { LeaveID: 'LVS-0002', StudentID: 'S01', Date: '2026-11-20', Type: 'ลากิจ', Reason: 'ไปงานแต่ง', Status: 'APPROVED' },
    ...['16', '17', '18', '19'].map((d, i) => ({ LeaveID: 'LVS-000' + (5 + i), StudentID: 'S10', Date: '2026-11-' + d, DateTo: '2026-11-19', GroupID: 'LVG-S10-2026-11-16', Type: 'ลากิจ', Reason: 'ต่างจังหวัด', Status: 'APPROVED' }))],
  OT_DAILY: [{ OTID: 'OT-20261110-S10', Date: '2026-11-10', StudentID: 'S10', PickupTime: '18:30', PlanEnd: '17:00', LateMinutes: 90, Hours: 2, FullAmount: 200,
    Discount: 100, DiscountReason: 'ผอ.ลดให้', DiscountBy: 'ADM', Amount: 100, Status: 'UNPAID', SlipRef: '', SlipAmount: 0 }],
  LINE_RECIPIENTS: [{ Name: 'ผอ.', LineUID: 'Udirectortest0004', Topics: 'approval', Active: 'YES', Note: '' }]
};
const CONFIG = [['Timezone', 'Asia/Bangkok'], ['GPS_Lat', String(LAT)], ['GPS_Lng', String(LNG)], ['Radius', '30'],
  ['Plans', JSON.stringify([{ id: 'P1', name: 'เต็มวัน', end: '17:00', price: 6900 }, { id: 'P2', name: 'ครึ่งวัน', end: '12:00', price: 4500 }])],
  ['OTRatePerHour', '100'], ['OTGraceMinutes', '21'], ['CheckinDedupMinutes', '10'], ['NotifyStaffArrival', 'app,line'], ['NotifyParentOt', 'app,line'], ['NotifyParentCheckin', 'app,line'], ['NotifyStaffLeave', 'app,line'],
  ['LineChannelAccessToken', 'fake-token-not-real']];
/* compared after every step … and seeded on both sides */
const SHEETS = [['MAIN', 'CHECKIN_STUDENT'], ['MAIN', 'OT_DAILY'], ['MAIN', 'ADMIN_INBOX'], ['MAIN', 'AUDIT_LOG'], ['MAIN', 'LEAVE_REQUEST_STD'], ['MAIN', 'ACTIVITY_LOG']];
const SEEDED = [['MAIN', 'SCHOOL_CONFIG'], ['MAIN', 'PARENTS'], ['MAIN', 'STUDENTS'], ['MAIN', 'CLASSES'], ['HR', 'STAFF'], ['MAIN', 'HOLIDAYS'],
  ['MAIN', 'HOLIDAY_ATTEND'], ['MAIN', 'PAYMENT_SLIPS'], ['MAIN', 'USERS'], ['MAIN', 'USER_LINKS'], ['MAIN', 'LINE_RECIPIENTS']];

async function viaHost(msg, who) {
  let out = ''; const hdr = {};
  const res = { setHeader(k, v) { hdr[k.toLowerCase()] = v; }, writeHead() {}, end(s) { out = s; } };
  await handle({}, res, JSON.stringify(Object.assign({ token: who.token }, msg)));
  const r = JSON.parse(out);
  r.__line = hdr['x-atom-line'] ? JSON.parse(hdr['x-atom-line']) : [];
  return r;
}
/* STORAGE, not meaning (docs/schema/001_init.sql): numbers as strings, `time` HH:mm:ss → HH:mm, numeric 200.00 → 200,
 * audit stamps compared as the instant to the minute; the random inbox id masked. */
const STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/;
const norm = (name, rows) => rows.map(r => { const o = Object.assign({}, r); delete o.__id;
  if (name === 'ADMIN_INBOX') o.InboxID = String(o.InboxID || '').indexOf('IN-') === 0 ? 'IN-…' : o.InboxID;
  /* the ENGINE (editStudentAttendance) runs outside the sandbox, on the real clock, so its stamps cannot equal the
   * fixed one: a full 'YYYY-MM-DD HH:mm' ByAt is the engine's (the routes write 'HH:mm'), and ACTIVITY_LOG is all
   * engine. Their FORMAT is still checked below; everything else in those rows is compared. */
  if (name === 'CHECKIN_STUDENT' && STAMP.test(String(o.ByAt || ''))) o.ByAt = 'stamp';
  if (name === 'ACTIVITY_LOG') o.Timestamp = STAMP.test(String(o.Timestamp || '')) ? 'stamp' : o.Timestamp;
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
    await c.query("insert into tenant (id, code, name_th) values ($1, $2, 'ทดสอบรับส่งเด็กบนโฮสต์ (ข้อมูลปลอม)')", [TENANT, 'p23-' + TENANT.slice(0, 8)]);
    for (const [k, v] of CONFIG) await c.query('insert into school_config (tenant_id, "key", "value") values ($1, $2, $3)', [TENANT, k, v]);
    for (const s of Object.keys(SEED)) for (const row of SEED[s]) await PG.insertSheetRow(c, TENANT, s, row);

    delete process.env.ATOM_DB;
    const H = require('./gas_test_harness.js')(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Checkin', 'Triggers', 'Leave',
      'Notify', 'Parent', 'Staff', 'GasEngine', 'Engine', 'Payroll', 'Day6', 'OtStaff', 'OT', 'PaySlips', 'Certificate', 'Dspm', 'DspmAdmin', 'Journal', 'Announce']);
    const start = {};
    for (const [, s] of SHEETS.concat(SEEDED)) start[s] = await PG.readSheet(c, TENANT, s);
    H.g.__FIX = JSON.stringify(start); H.g.__SHEETS = JSON.stringify(SHEETS.concat(SEEDED));
    H.run(function () {
      _configCache = null; setupAll(); _configCache = null;
      var F = JSON.parse(__FIX), main = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
      JSON.parse(__SHEETS).forEach(function (x) {
        var wb = x[0] === 'HR' ? hr : main, sh = wb.getSheetByName(x[1]) || sheet_(wb, x[1]);
        if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
        (F[x[1]] || []).forEach(function (r) { appendObject_(sh, r); });
      });
      _configCache = null; return '';
    });
    const gasState = () => JSON.parse(H.run(function () {
      var out = {}, main = getMainSpreadsheet_();
      JSON.parse(__SHEETS).slice(0, 6).forEach(function (x) {
        out[x[1]] = readObjects_(sheet_(main, x[1])).map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; return o; });
      });
      return JSON.stringify(out);
    }));
    const pgState = async () => { const o = {}; for (const [, s] of SHEETS) o[s] = await PG.readSheet(c, TENANT, s); return o; };
    const { M } = await PG.hydrateFast(c, TENANT, ALL, {});
    M.config = await PG.hydrateConfig(c, TENANT);

    H.g.__FAKE = ROUTES.FAKE_DATE;
    const at = (ymd, hm) => { const ms = Date.parse(ymd + 'T' + hm + ':00+07:00'); ROUTES.setClock(ms); H.g.__MS = ms;
      H.run(function () { if (typeof __RD === 'undefined') __RD = Date; Date = __RD; eval(__FAKE)(__MS); return ''; }); };

    const step = async (label, ask, who, action, fn) => {
      action = action || 'parentCheckin'; H.g.__F = fn || 'handleParentCheckin';
      const p = GATE.identity(action, JSON.parse(JSON.stringify(ask)), who.sess, M);
      H.g.__P = JSON.stringify(p);
      const want = JSON.parse(H.run(function () {
        _configCache = null; PUSH.length = 0;
        var r; try { r = { ok: true, data: this[__F](JSON.parse(__P)) }; } catch (e) { r = { ok: false, code: e.apiCode || e.message }; }
        r.line = PUSH.slice(); return JSON.stringify(r); }));
      const got = await viaHost({ action, payload: ask }, who);
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
    const go = (sid, type, extra) => Object.assign({ studentId: sid, type, lat: LAT, lng: LNG, acc: 10 }, extra || {});
    const rows = async sid => (await PG.readSheet(c, TENANT, 'CHECKIN_STUDENT')).filter(r => r.StudentID === sid);
    const ot = async sid => (await PG.readSheet(c, TENANT, 'OT_DAILY')).filter(r => r.StudentID === sid).slice(-1)[0] || {};

    console.log('\n1) วันอังคาร 10/11/2026 — มาส่ง · กดซ้ำ (หาแถวของวันนี้จาก Postgres ได้)');
    at('2026-11-10', '07:40');
    let r = await step('แม่น้องเอ มาส่ง 07:40', go('S01', 'IN'), P1);
    ok_('...Postgres: 1 แถว · ParentID มาจากเซสชัน', (await rows('S01')).length === 1 && (await rows('S01'))[0].ParentID === 'PAR-01');
    at('2026-11-10', '07:46');
    r = await step('🔴 กดซ้ำ 07:46', go('S01', 'IN'), P1);
    ok_('🔴 ...แถวเดิมเลื่อนเป็น 07:46 · ไม่มีแถวใหม่ · ไม่แจ้งซ้ำ', r.got.data && r.got.data.duplicate === true && (await rows('S01')).length === 1 &&
      String((await rows('S01'))[0].Time).slice(0, 5) === '07:46' && r.got.__line.length === 0);
    {
      const before = (await PG.readSheet(c, TENANT, 'CHECKIN_STUDENT')).length;
      const o = await viaHost({ action: 'parentCheckin', payload: go('S04', 'IN') }, P1);
      ok_('🔴 แม่น้องเอ ส่งรหัสลูกบ้านอื่น → ' + (o.error && o.error.code) + ' ไม่บันทึก',
        o.ok === false && o.error.code === 'NO_ACCESS' && (await PG.readSheet(c, TENANT, 'CHECKIN_STUDENT')).length === before);
    }

    console.log('\n2) 💰 รับกลับ');
    at('2026-11-10', '17:15');
    r = await step('🔴 รับกลับจากที่ห่าง ~1.1 กม.', go('S01', 'OUT', { lat: LAT + 0.01 }), P1);
    { const a = (await PG.readSheet(c, TENANT, 'AUDIT_LOG')).filter(x => x.Action === 'STUDENT_CHECKOUT_OUT_OF_RANGE');
      ok_('🔴 ...OUT_OF_RANGE · ไม่มีแถวรับกลับ · ไม่มี LINE · audit ถูกบันทึกใน Postgres (เมตรเท่านั้น)',
        r.got.error && r.got.error.code === 'OUT_OF_RANGE' && (await rows('S01')).length === 1 && r.got.__line.length === 0 &&
        a.length === 1 && a[0].RecordID === 'S01 · 1112m acc=10m'); }
    r = await step('น้องเอ รับ 17:15 (ผ่อนผัน 21)', go('S01', 'OUT'), P1);
    ok_('💰 ไม่มีค่ารับช้า', r.got.data && r.got.data.ot === null && !(await ot('S01')).OTID);
    at('2026-11-10', '17:22');
    r = await step('น้องดี (อัตรา 150) รับ 17:22', go('S04', 'OUT'), P4);
    { const o = await ot('S04');
      ok_('💰 Postgres: 22 นาที → 1 ชม. × 150 = 150 · UNPAID', Number(o.LateMinutes) === 22 && Number(o.Hours) === 1 && Number(o.FullAmount) === 150 && Number(o.Amount) === 150 && o.Status === 'UNPAID' && o.OTID === 'OT-20261110-S04');
      ok_('...จด LINE 2 ข้อความ (ครู · แม่)', r.got.__line.length === 2); }
    at('2026-11-10', '19:01');
    r = await step('น้องไอ (ครึ่งวัน เลิก 12:00) รับ 19:01', go('S09', 'OUT'), P9);
    ok_('💰 421 นาที → 8 ชม. × 100 = 800', Number((await ot('S09')).Amount) === 800 && Number((await ot('S09')).Hours) === 8);
    r = await step('น้องเจ (มีส่วนลด 100) รับ 19:01', go('S10', 'OUT'), P10);
    { const o = await ot('S10');
      ok_('💰 คิดใหม่ 300 · ส่วนลด 100 คงอยู่ → เรียกเก็บ 200', Number(o.FullAmount) === 300 && Number(o.Discount) === 100 && Number(o.Amount) === 200 && o.DiscountReason === 'ผอ.ลดให้'); }
    at('2026-11-10', '20:05');
    r = await step('น้องไอ กดรับอีกครั้ง 20:05 (พ้นช่วงกดซ้ำ)', go('S09', 'OUT'), P9);
    ok_('💰 แถวเดิมคิดใหม่ 485 นาที → 9 ชม. = 900 · ยังมีแถวเดียว',
      (await PG.readSheet(c, TENANT, 'OT_DAILY')).filter(x => x.StudentID === 'S09').length === 1 && Number((await ot('S09')).Amount) === 900);

    console.log('\n3) วันเสาร์ 14/11 — โรงเรียนปิด');
    at('2026-11-14', '08:00');
    await step('🔴 วันเสาร์ → SCHOOL_CLOSED', go('S01', 'IN'), P1);

    console.log('\n4) ครูบันทึกรับ-ส่งแทน — วันศุกร์ 13/11');
    const sst = (label, ask, who) => step(label, ask, who, 'staffStudentCheckin', 'handleStaffStudentCheckin');
    const by = (sid, type, extra) => Object.assign({ studentId: sid, type, remark: 'คุณยายมารับ-ส่ง' }, extra || {});
    at('2026-11-13', '08:30');
    {
      const n = (await PG.readSheet(c, TENANT, 'CHECKIN_STUDENT')).length;
      const o = await viaHost({ action: 'parentCheckin', payload: { parentId: 'PAR-01', studentId: 'S01', type: 'IN', lat: LAT, lng: LNG } }, T);
      ok_('🔴 ครูใช้ปุ่มของผู้ปกครองพร้อม parentId ของครอบครัว → ' + (o.error && o.error.code) + ' ไม่บันทึก',
        o.ok === false && o.error.code === 'NO_PERMISSION' && (await PG.readSheet(c, TENANT, 'CHECKIN_STUDENT')).length === n);
    }
    await sst('🔴 ครูห้องอื่น → NO_ACCESS', by('S01', 'IN'), Z);
    await sst('🔴 เด็กที่แจ้งลาวันนี้ → ON_LEAVE', by('S04', 'IN'), T);
    {
      const n = (await PG.readSheet(c, TENANT, 'CHECKIN_STUDENT')).length;
      r = await sst('🔴 ครูห้องอื่นส่ง staffId ของครูประจำชั้นมา — เซสชันเป็นคนตัดสิน', by('S01', 'IN', { staffId: 'STF-T' }), Z);
      ok_('🔴 ...NO_ACCESS ไม่บันทึก', r.got.error && r.got.error.code === 'NO_ACCESS' && (await PG.readSheet(c, TENANT, 'CHECKIN_STUDENT')).length === n);
    }
    r = await sst('ครูบันทึกมาส่ง 07:50 (กดตอน 08:30)', by('S01', 'IN', { time: '07:50' }), T);
    { const x = (await rows('S01')).slice(-1)[0];
      ok_('...Postgres: Time 07:50 · ByAt 08:30 · ByStaffID STF-T', String(x.Time).slice(0, 5) === '07:50' && String(x.ByAt).slice(0, 5) === '08:30' && x.ByStaffID === 'STF-T'); }
    at('2026-11-13', '17:30');
    r = await sst('ครูบันทึกรับกลับ 17:45', by('S01', 'OUT', { time: '17:45' }), T);
    ok_('💰 Postgres: OT-20261113-S01 = 100', Number((await ot('S01')).Amount) === 100 && (await ot('S01')).OTID === 'OT-20261113-S01');
    r = await sst('💰 แก้เป็น 16:50', by('S01', 'OUT', { time: '16:50' }), T);
    ok_('💰 ยกเลิกอัตโนมัติ (AUTO_TIME) · 0 บาท', (await ot('S01')).Status === 'CANCELLED' && Number((await ot('S01')).Amount) === 0 && (await ot('S01')).CancelledBy === 'AUTO_TIME');
    r = await sst('💰 แก้อีกครั้งเป็น 18:30', by('S01', 'OUT', { time: '18:30' }), T);
    ok_('💰 กลับมา UNPAID 200 · แถวรับกลับของวันนั้นยังมีแถวเดียว', (await ot('S01')).Status === 'UNPAID' && Number((await ot('S01')).Amount) === 200 &&
      (await rows('S01')).filter(x => x.Type === 'OUT' && String(x.Date).slice(0, 10) === '2026-11-13').length === 1);

    console.log('\n5) ผู้ปกครองแก้ / ยกเลิกใบลา — วันอังคาร 17/11');
    const lvs = async () => PG.readSheet(c, TENANT, 'LEAVE_REQUEST_STD');
    at('2026-11-17', '08:00');
    r = await step('แม่น้องเอแก้เหตุผล + ย้ายไป 24/11', { studentId: 'S01', leaveId: 'LVS-0002', reason: 'ไปงานบวช', date: '2026-11-24' }, P1, 'parentEditLeave', 'handleParentEditLeave');
    { const l = (await lvs()).find(x => x.LeaveID === 'LVS-0002') || {};
      ok_('...Postgres: วันที่ 2026-11-24 · เหตุผลใหม่', String(l.Date).slice(0, 10) === '2026-11-24' && l.Reason === 'ไปงานบวช'); }
    {
      const o = await viaHost({ action: 'parentEditLeave', payload: { leaveId: 'LVS-0005', studentId: 'S10', reason: 'x' } }, P1);
      ok_('🔴 แม่น้องเอแก้ใบลาของลูกบ้านอื่น → ' + (o.error && o.error.code), o.ok === false && o.error.code === 'NO_ACCESS');
    }
    {
      const n = (await lvs()).length;
      const o = await viaHost({ action: 'parentCancelLeave', payload: { parentId: 'PAR-10', studentId: 'S10', leaveId: 'LVS-0006' } }, T);
      ok_('🔴 ครูยกเลิกใบลาในนามผู้ปกครอง → ' + (o.error && o.error.code) + ' ไม่ลบอะไร', o.ok === false && o.error.code === 'NO_PERMISSION' && (await lvs()).length === n);
    }
    r = await step('ยกเลิกใบลาต่อเนื่อง 16–19/11', { studentId: 'S10', leaveId: 'LVS-0006' }, P10, 'parentCancelLeave', 'handleParentCancelLeave');
    { const left = (await lvs()).filter(x => x.StudentID === 'S10').map(x => String(x.Date).slice(0, 10));
      ok_('...Postgres: เหลือแค่ 16/11 (ผ่านไปแล้ว) · ยกเลิก 3 วัน', JSON.stringify(left) === '["2026-11-16"]' && r.got.data && r.got.data.cancelled === 3); }

    console.log('\n6) 💰 ครูแก้เวลามา-กลับย้อนหลัง (editStudentAttendance → engine) — วันพุธ 18/11');
    const EA = (label, ask, who) => step(label, ask, who, 'editStudentAttendance', 'editAttendanceWrite_');
    at('2026-11-18', '09:00');
    await EA('🔴 ครูห้องอื่นแก้ → NO_ACCESS', { studentId: 'S04', date: '2026-11-17', checkIn: '07:45', checkOut: '18:30' }, Z);
    r = await EA('ครูประจำชั้นใส่เวลาของน้องดี 17/11: มา 07:45 กลับ 18:30', { studentId: 'S04', date: '2026-11-17', checkIn: '07:45', checkOut: '18:30', remark: 'ลืมกด' }, T);
    { const o = (await PG.readSheet(c, TENANT, 'OT_DAILY')).find(x => x.OTID === 'OT-20261117-S04') || {};
      ok_('💰 Postgres: รับช้า 90 นาที → 2 ชม. × 150 = 300 · UNPAID', Number(o.LateMinutes) === 90 && Number(o.Amount) === 300 && o.Status === 'UNPAID');
      const day = (await rows('S04')).filter(x => String(x.Date).slice(0, 10) === '2026-11-17');
      ok_('...2 แถว (IN 07:45 · OUT 18:30) · ByStaffID STF-T · ByAt คือเวลาที่แก้', day.length === 2 && day.every(x => x.ByStaffID === 'STF-T') && day.every(x => STAMP.test(String(x.ByAt))));
      ok_('...แจ้งครอบครัว (ค่ารับช้าย้อนหลัง) — จด LINE', r.got.__line.length >= 1); }
    r = await EA('💰 แก้เวลากลับเป็น 16:50', { studentId: 'S04', date: '2026-11-17', checkOut: '16:50' }, T);
    { const o = (await PG.readSheet(c, TENANT, 'OT_DAILY')).find(x => x.OTID === 'OT-20261117-S04') || {};
      ok_('💰 ค่ารับช้ายกเลิก (แถวยังอยู่ · 0 บาท) · ไม่แจ้งเงิน', o.Status === 'CANCELLED' && Number(o.Amount) === 0 && r.got.__line.length === 0); }
    r = await EA('ลบเวลากลับออก (ยังไม่ได้รับ)', { studentId: 'S04', date: '2026-11-17', checkOut: '' }, T);
    ok_('...แถว OUT ของวันนั้นถูกลบ · IN ยังอยู่', (await rows('S04')).filter(x => String(x.Date).slice(0, 10) === '2026-11-17').map(x => x.Type).join() === 'IN');
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
