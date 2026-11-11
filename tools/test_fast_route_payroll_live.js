/**
 * tools/test_fast_route_payroll_live.js — W4 3d payroll through server/host.js and staging Postgres
 *   node tools/test_fast_route_payroll_live.js       (needs secrets/supabase.env — fabricated data only)
 *
 * tools/test_fast_route_payroll.js proves routes.js works a slip out exactly as Apps Script from the same rows. This
 * proves the host's half: only an ADMIN may save, approve, pay or adjust; the slip lands in numeric columns; the
 * child count comes from the host's own engine on Postgres data; the backup-first writes go to Apps Script and
 * leave nothing behind. 🔴 Fabricated data only; the tenant is deleted at the end (pg_sweep_tenants knows p23-).
 */
'use strict';
const path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const TENANT = crypto.randomUUID();
const SECRET = 'route-payroll-live-' + crypto.randomBytes(12).toString('hex');
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
const A = tokenFor('Admin', 'STF-A', 'U-A'), T = tokenFor('Teacher', 'STF-T', 'U-T'), OBS = tokenFor('Observer', 'STF-O', 'U-O');

const st = (id, name, extra) => Object.assign({ StaffID: id, Name: name, Role: 'Teacher', PositionLevel: 'Teacher', Position: 'ครูประจำชั้น', Department: 'N1',
  Status: 'ACTIVE', StartDate: '2025-01-01', BaseSalary: 15000, BankName: 'SCB', BankAccount: '000-0-00000-0' }, extra || {});
const kid = id => ({ StudentID: id, Name: 'ด.ช. ' + id, Nickname: id, Class: 'N1', Plan: 'P1', Status: 'ACTIVE', EnrollDate: '2026-01-05' });
const pr = (id, sid, month, extra) => Object.assign({ PayrollID: id, StaffID: sid, Month: month, BaseSalary: 15000, GrossIncome: 15000, NetPay: 15000, TotalDeductions: 0,
  OTEvening: 0, Contribution: 0, SlipSent: 'NO', GeneratedDate: month + '-28T03:00:00.000Z', GeneratedBy: 'STF-A' }, extra || {});
const SEED = {
  STAFF: [st('STF-T', 'ครูที', { ContributionOpening: 5000, ContributionAccum: 5400 }), st('STF-U', 'ครูยู'),
    st('STF-P', 'ครูพัก', { BaseSalary: 20000, PauseFrom: '2026-11-05', PauseTo: '2026-11-25', PauseSalaryMode: 'HALF', PauseReason: 'ลาคลอด' }),
    st('STF-J', 'ครูเจ', { ContributionOpening: 0, ContributionAccum: 35800 }),
    st('STF-A', 'แอดมินเอ', { Role: 'Admin', PositionLevel: 'Admin', Position: 'ผู้จัดการ' }), st('STF-O', 'ผู้ตรวจ', { Role: 'Observer' })],
  STUDENTS: ['K1', 'K2', 'K3', 'K4', 'K5'].map(kid),
  ABSENCE_LOG: [3, 4, 5].map(d => ({ StudentID: 'K5', Date: '2026-11-0' + d, Type: 'ABSENT' })),
  LEAVE_REQUEST_STD: [9, 10, 11].map(d => ({ LeaveID: 'SL-' + d, StudentID: 'K5', Date: '2026-11-' + String(d).padStart(2, '0'), Status: 'APPROVED', Type: 'sick' })),
  PAYROLL_CONFIG: [{ StaffID: 'STF-T', ChildThreshold: 3, ChildMultiplier: 300, DiligenceAttendanceAmount: 1000, Contribution: 200, SocialSecurityDeduct: 'YES' }],
  PAYROLL: [pr('PR-0001', 'STF-T', '2026-10', { OTEvening: 100, Contribution: 200, SlipSent: 'YES', PaidDate: '2026-10-31' }),
    pr('PR-0002', 'STF-J', '2026-07', { Contribution: 200, ContributionEmployer: 200, PaidDate: '2026-07-31', SlipSent: 'YES' }),
    pr('PR-0003', 'STF-J', '2026-07', { GrossIncome: 0, NetPay: 0, BaseSalary: 0 }),
    pr('PR-0004', 'STF-J', '2026-08', { Contribution: 200, ContributionEmployer: 200 })],
  LEAVE_REQUEST: [{ LeaveID: 'LV-1', StaffID: 'STF-U', Type: 'sick', StartDate: '2026-11-16', EndDate: '2026-11-19', Days: 4, Status: 'APPROVED' }],
  CHECKIN_STAFF: [{ StaffID: 'STF-U', Date: '2026-11-03', CheckIn: '08:07', LateMinutes: 7 }, { StaffID: 'STF-T', Date: '2026-11-14', CheckIn: '08:20', LateMinutes: 0 }],
  OT_RECORDS: [{ OTRecordID: 'OTR-1', StaffID: 'STF-T', Date: '2026-10-20', Hours: 1, Amount: 100, Status: 'APPROVED', Month: '2026-10' },
    { OTRecordID: 'OTR-2', StaffID: 'STF-T', Date: '2026-10-30', Hours: 2, Amount: 200, Status: 'APPROVED', Month: '2026-10' },
    { OTRecordID: 'OTR-3', StaffID: 'STF-T', Date: '2026-11-10', Hours: 2.5, Amount: 250, Status: 'APPROVED', Month: '2026-11' },
    { OTRecordID: 'OTR-5', StaffID: 'STF-T', Date: '2026-11-15', Hours: 0, Amount: 800, Status: 'APPROVED', Month: '2026-11', Kind: 'HOLIDAY' }]
};
const CONFIG = [['Timezone', 'Asia/Bangkok'], ['DiligenceAttendanceAmount', '500'], ['DiligenceFacebookAmount', '500'], ['DiligenceLeaveMaxDays', '3'],
  ['TrainingCertMaxPerMonth', '2'], ['TrainingCertRate', '100'], ['SocialSecurityRate', '0.05'], ['SocialSecurityMax', '750'], ['ContributionMatchRate', '1'],
  ['OTEveningRate', '100'], ['BigCleaningAmount', '200'], ['BigCleaningDays', '2026-11-14'], ['AbsenceRateExcludeDays', '6']];
/* compared after every step */
const SHEETS = [['HR', 'PAYROLL'], ['HR', 'STAFF'], ['HR', 'PAYROLL_CONFIG'], ['HR', 'PAY_ADJUSTMENTS'], ['MAIN', 'ADMIN_INBOX'], ['HR', 'AUDIT_LOG']];
const SEEDED = [['MAIN', 'SCHOOL_CONFIG'], ['MAIN', 'STUDENTS'], ['MAIN', 'ABSENCE_LOG'], ['MAIN', 'LEAVE_REQUEST_STD'], ['HR', 'LEAVE_REQUEST'],
  ['HR', 'CHECKIN_STAFF'], ['HR', 'OT_RECORDS'], ['MAIN', 'USERS']];
const keyOf = x => (x[0] === 'HR' && x[1] === 'AUDIT_LOG') ? 'HR_AUDIT_LOG' : x[1];

async function viaHost(msg, who) {
  let out = ''; const hdr = {};
  const res = { setHeader(k, v) { hdr[k.toLowerCase()] = v; }, writeHead() {}, end(s) { out = s; } };
  await handle({}, res, JSON.stringify(Object.assign({ token: who.token }, msg)));
  const r = JSON.parse(out);
  r.__line = hdr['x-atom-line'] ? JSON.parse(hdr['x-atom-line']) : [];
  return r;
}
/* a MOMENT, compared as the minute it names: Apps Script keeps a Date or 'yyyy-MM-dd HH:mm' (Bangkok); Postgres a timestamptz */
const instant = v => { const s = String(v == null ? '' : v); if (!s) return '';
  const t = Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + '+07:00'); return isFinite(t) ? 'min:' + Math.floor(t / 60000) : s; };
const MOMENTS = ['GeneratedDate', 'ApprovedAt', 'CreatedAt', 'Timestamp', 'at'];   // `at` = payAdjustHistory's CreatedAt
const norm = (name, rows) => rows.map(r => { const o = Object.assign({}, r); delete o.__id;
  if (name === 'ADMIN_INBOX') o.InboxID = String(o.InboxID || '').indexOf('IN-') === 0 ? 'IN-…' : o.InboxID;
  if (name === 'PAY_ADJUSTMENTS') o.AdjID = /^ADJ-\d+-\d+$/.test(String(o.AdjID)) ? 'ADJ-' + String(o.AdjID).split('-')[2] : o.AdjID;
  MOMENTS.forEach(k => { if (k in o) o[k] = instant(o[k]); });
  Object.keys(o).forEach(k => {
    if (o[k] == null) o[k] = '';
    if (typeof o[k] === 'number' || typeof o[k] === 'boolean') o[k] = String(o[k]);
    if (/^-?\d+\.0+$/.test(o[k])) o[k] = o[k].replace(/\.0+$/, '');
    if (/^-?\d+\.\d*?0+$/.test(o[k])) o[k] = o[k].replace(/0+$/, '');
  });
  return o; });
/* a reply: the same moments, wherever they sit */
const normReply = v => JSON.parse(JSON.stringify(v == null ? null : v), (k, x) => MOMENTS.indexOf(k) >= 0 ? instant(x) : x);

(async () => {
  const { client: c } = await connect();
  try {
    await c.query("insert into tenant (id, code, name_th) values ($1, $2, 'ทดสอบเงินเดือนบนโฮสต์ (ข้อมูลปลอม)')", [TENANT, 'p23-' + TENANT.slice(0, 8)]);
    for (const [k, v] of CONFIG) await c.query('insert into school_config (tenant_id, "key", "value") values ($1, $2, $3)', [TENANT, k, v]);
    for (const s of Object.keys(SEED)) for (const row of SEED[s]) await PG.insertSheetRow(c, TENANT, s, row);

    delete process.env.ATOM_DB;
    const H = require('./gas_test_harness.js')(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Checkin', 'Triggers', 'Leave',
      'Notify', 'Parent', 'Staff', 'GasEngine', 'Engine', 'Payroll', 'PayAdjust', 'Day6', 'OtStaff', 'OT', 'PaySlips', 'Password', 'BillRun', 'Certificate', 'Dspm', 'DspmAdmin', 'Journal', 'Announce']);
    const start = {};
    for (const x of SHEETS.concat(SEEDED)) start[keyOf(x)] = await PG.readSheet(c, TENANT, keyOf(x));
    if (process.env.DEBUG_LIVE) ['ABSENCE_LOG', 'LEAVE_REQUEST_STD', 'PAYROLL_CONFIG'].forEach(k => console.log('   seed ' + k + ' ' + JSON.stringify(start[k]).slice(0, 500)));
    H.g.__FIX = JSON.stringify(start); H.g.__SHEETS = JSON.stringify(SHEETS.concat(SEEDED));
    H.run(function () {
      _configCache = null; setupAll(); _configCache = null;
      var F = JSON.parse(__FIX), main = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
      JSON.parse(__SHEETS).forEach(function (x) {
        var wb = x[0] === 'HR' ? hr : main, sh = wb.getSheetByName(x[1]) || sheet_(wb, x[1]);
        var key = (x[0] === 'HR' && x[1] === 'AUDIT_LOG') ? 'HR_AUDIT_LOG' : x[1];
        if (x[1] === 'PAYROLL') ensureColumns_(sh, SCHEMA[WB.HR].PAYROLL);
        if (x[1] === 'STAFF') ensureColumns_(sh, SCHEMA[WB.HR].STAFF);
        if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
        (F[key] || []).forEach(function (r) { appendObject_(sh, r); });
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
    const pgState = async () => { const o = {}; for (const x of SHEETS) o[keyOf(x)] = await PG.readSheet(c, TENANT, keyOf(x)); return o; };
    const { M } = await PG.hydrateFast(c, TENANT, ALL, {});
    M.config = await PG.hydrateConfig(c, TENANT);
    H.g.__FAKE = ROUTES.FAKE_DATE;
    const at = (ymd, hm) => { const ms = Date.parse(ymd + 'T' + hm + ':00+07:00'); ROUTES.setClock(ms); H.g.__MS = ms;
      H.run(function () { if (typeof __RD === 'undefined') __RD = Date; Date = __RD; eval(__FAKE)(__MS); return ''; }); };

    const step = async (label, action, fn, ask, who) => {
      const p = GATE.identity(action, JSON.parse(JSON.stringify(ask)), who.sess, M);
      H.g.__P = JSON.stringify(p); H.g.__F = fn;
      const want = JSON.parse(H.run(function () {
        _configCache = null; _ratedChildCache_ = {}; PUSH.length = 0;
        var r; try { r = { ok: true, data: this[__F](JSON.parse(__P)) }; } catch (e) { r = { ok: false, code: e.apiCode || e.message }; }
        r.line = PUSH.slice(); return JSON.stringify(r); }));
      const got = await viaHost({ action, payload: ask }, who);
      if (!got.ok && process.env.DEBUG_LIVE) console.log('         host error: ' + JSON.stringify(got.error).slice(0, 400));
      const g = JSON.stringify(got.ok ? { ok: true, data: normReply(got.data) } : { ok: false, code: got.error && got.error.code });
      const w = JSON.stringify(want.ok ? { ok: true, data: normReply(want.data) } : { ok: false, code: want.code });
      ok_(label + ' — คำตอบ' + (g === w ? '' : '\n         host=' + g.slice(0, 600) + '\n          gas=' + w.slice(0, 600)), g === w);
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
    const ROW = async (sid, m) => (await PG.readSheet(c, TENANT, 'PAYROLL')).filter(x => x.StaffID === sid && String(x.Month).slice(0, 7) === m);
    const S = async id => (await PG.readSheet(c, TENANT, 'STAFF')).find(x => x.StaffID === id) || {};
    const ADM = { adminId: 'STF-A', generatedBy: 'STF-A' };
    at('2026-11-28', '10:00');
    let r;

    console.log('\n1) 🔴 ประตู');
    for (const [a, who, name] of [['approvePayslip', T, 'ครู'], ['adjustStaffPay', T, 'ครู'], ['markSalaryPaid', OBS, 'ผู้ตรวจ'], ['recomputeContributions', T, 'ครู'],
      ['deletePayrollRow', T, 'ครู']]) {
      const o = await viaHost({ action: a, payload: { targetId: 'STF-T', staffId: 'STF-T', month: '2026-10', baseSalary: 99999, reason: 'x', paid: false, preview: false, payrollId: 'PR-0003', confirm: true } }, who);
      ok_('🔴 ' + name + ' เรียก ' + a + ' → ' + (o.error && o.error.code) + ' ไม่บันทึก', o.ok === false && Number((await S('STF-T')).BaseSalary) === 15000 &&
        (await ROW('STF-T', '2026-10'))[0].SlipSent === 'YES' && Number((await S('STF-J')).ContributionAccum) === 35800 && (await ROW('STF-J', '2026-07')).length === 2);
    }
    r = await viaHost({ action: 'computePayroll', payload: { staffId: 'STF-T', month: '2026-11' } }, T);
    ok_('🔴 ครูขอคำนวณจริง → ได้ตัวอย่าง ไม่มีแถวใหม่', r.ok && r.data && r.data.Preview === true && !(await ROW('STF-T', '2026-11')).length);

    console.log('\n2) 💰 สลิปครูที พ.ย. (Postgres)');
    const TPAY = Object.assign({ staffId: 'STF-T', month: '2026-11', facebookPosted: true, trainingCertCount: 3,
      adjustments: [{ label: 'ค่าเดินทาง', amount: 300 }, { label: 'เบิกล่วงหน้า', amount: -1000 }] }, ADM);
    r = await step('บันทึกสลิป', 'computePayroll', 'handleComputePayroll', TPAY, A);
    { const x = (await ROW('STF-T', '2026-11'))[0] || {};
      if (process.env.DEBUG_LIVE) console.log('         ' + JSON.stringify([x.GrossIncome, x.TotalDeductions, x.NetPay, x.ExtraChildCount, x.RatedTotal, x.OTCarry, x.ContributionAccum, x.Approved]));
      ok_('💰 Postgres: รวมรายได้ 19,050 · หัก 1,950 · สุทธิ 17,100 · เด็ก 2 คน (นับได้ 4) · ยกมา 200 · สะสม 5,800 · ยังไม่อนุมัติ',
        [x.GrossIncome, x.TotalDeductions, x.NetPay, x.ExtraChildCount, x.RatedTotal, x.OTCarry, x.ContributionAccum].map(Number).join() === '19050,1950,17100,2,4,200,5800' && x.Approved === 'NO');
      ok_('💰 Postgres: STAFF ยอดสะสม 5,800', Number((await S('STF-T')).ContributionAccum) === 5800); }
    await step('อนุมัติสลิป', 'approvePayslip', 'handleApprovePayslip', Object.assign({ targetId: 'STF-T', month: '2026-11' }, ADM), A);
    await step('คำนวณใหม่ (ไม่ได้โพสต์ FB) → ถอนการอนุมัติ', 'computePayroll', 'handleComputePayroll', Object.assign({}, TPAY, { facebookPosted: false }), A);
    { const x = await ROW('STF-T', '2026-11');
      ok_('💰 Postgres: แถวเดียว · สุทธิ 16,600 · Approved NO', x.length === 1 && Number(x[0].NetPay) === 16600 && x[0].Approved === 'NO'); }
    await step('ครูยู: สาย · ลาเกิน · ยังไม่ตั้งเรทเด็ก', 'computePayroll', 'handleComputePayroll', Object.assign({ staffId: 'STF-U', month: '2026-11' }, ADM), A);
    await step('ครูพัก: ครึ่งเงินเดือน', 'computePayroll', 'handleComputePayroll', Object.assign({ staffId: 'STF-P', month: '2026-11' }, ADM), A);
    ok_('💰 Postgres: ครูพัก 10,000 · STAFF ยัง 20,000', Number((await ROW('STF-P', '2026-11'))[0].BaseSalary) === 10000 && Number((await S('STF-P')).BaseSalary) === 20000);

    console.log('\n3) 💰 จ่ายแล้ว · ปรับเงินเดือน');
    await step('จ่ายแล้ว + ลิงก์สลิป', 'markSalaryPaid', 'handleMarkSalaryPaid', Object.assign({ staffId: 'STF-T', month: '2026-11', paid: true, slipUrl: 'https://drive.example/salary-t' }, ADM), A);
    ok_('💰 Postgres: SlipSent YES · PaidDate 2026-11-28', (await ROW('STF-T', '2026-11'))[0].SlipSent === 'YES' && String((await ROW('STF-T', '2026-11'))[0].PaidDate).slice(0, 10) === '2026-11-28');
    { const o = await viaHost({ action: 'markSalaryPaid', payload: Object.assign({ staffId: 'STF-U', month: '2026-11', paid: true, slipUrl: 'data:image/jpeg;base64,AAAA' }, ADM) }, A);
      ok_('🔴 แนบรูปสลิป → NOT_ON_FAST_HOST · ไม่บันทึก', o.ok === false && o.error.code === 'NOT_ON_FAST_HOST' && (await ROW('STF-U', '2026-11'))[0].SlipSent !== 'YES'); }
    await step('ขึ้นเงินเดือน 16,000 · เรทเด็ก 350', 'adjustStaffPay', 'handleAdjustStaffPay', Object.assign({ targetId: 'STF-T', baseSalary: 16000, childMultiplier: 350, reason: 'ประเมินประจำปี' }, ADM), A);
    at('2026-11-28', '10:05');   // AdjID = 'ADJ-' + Date.now() — a frozen clock would mint the first call's ids again
    await step('ครูยู สมทบ 300 (แถวตั้งค่าใหม่)', 'adjustStaffPay', 'handleAdjustStaffPay', Object.assign({ targetId: 'STF-U', contribution: 300, reason: 'เริ่มสมทบ' }, ADM), A);
    await step('ประวัติการปรับของครูที', 'payAdjustHistory', 'handlePayAdjustHistory', { targetId: 'STF-T' }, A);
    await step('ครูทีดูประวัติของตัวเอง', 'payAdjustHistory', 'handlePayAdjustHistory', { targetId: 'STF-T' }, T);

    console.log('\n4) 💰 เงินสมทบ · สลิปซ้ำ');
    await step('หาสลิปซ้ำ', 'payrollDuplicates', 'handlePayrollDuplicates', ADM, A);
    await step('ลบแถวซ้ำ — ดูตัวอย่าง', 'deletePayrollRow', 'handleDeletePayrollRow', Object.assign({ payrollId: 'PR-0003' }, ADM), A);
    { const o = await viaHost({ action: 'deletePayrollRow', payload: Object.assign({ payrollId: 'PR-0003', confirm: true }, ADM) }, A);
      ok_('🔴 ลบจริง → NOT_ON_FAST_HOST (Apps Script สำรองข้อมูลก่อน) · แถวยังอยู่', o.ok === false && o.error.code === 'NOT_ON_FAST_HOST' && (await ROW('STF-J', '2026-07')).length === 2); }
    await step('ล้างเงินสมทบครูเจ — ดูตัวอย่าง', 'contributionReset', 'handleContributionReset', Object.assign({ staffId: 'STF-J', newOpening: 35000 }, ADM), A);
    { const o = await viaHost({ action: 'contributionReset', payload: Object.assign({ staffId: 'STF-J', newOpening: 35000, confirm: true }, ADM) }, A);
      ok_('🔴 ล้างจริง → NOT_ON_FAST_HOST · ยอดยังเดิม', o.ok === false && o.error.code === 'NOT_ON_FAST_HOST' && Number((await S('STF-J')).ContributionAccum) === 35800); }
    await step('คำนวณยอดสะสมใหม่ — บันทึก', 'recomputeContributions', 'handleRecomputeContributions', Object.assign({ preview: false }, ADM), A);
    ok_('💰 Postgres: ครูเจ 35,800 → 800', Number((await S('STF-J')).ContributionAccum) === 800);
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
