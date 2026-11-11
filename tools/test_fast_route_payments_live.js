/**
 * tools/test_fast_route_payments_live.js — W4 3b money received through server/host.js and staging Postgres
 *   node tools/test_fast_route_payments_live.js       (needs secrets/supabase.env — fabricated data only)
 *
 * tools/test_fast_route_payments.js proves routes.js settles money exactly as Apps Script from the same rows. This proves
 * the host's half: only an ADMIN may record or decide money (a family may only say it paid cash, for its own
 * children), PAID/PARTIAL/PENDING_VERIFY land in real typed columns (numeric · date), and the rows read back equal
 * what Apps Script wrote. LINE_SEND=capture — nothing is sent.
 * 🔴 Fabricated data only; the tenant is deleted at the end (pg_sweep_tenants knows the p23- prefix).
 */
'use strict';
const path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const TENANT = crypto.randomUUID();
const SECRET = 'route-payments-live-' + crypto.randomBytes(12).toString('hex');
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

const kid = (id, nick) => ({ StudentID: id, Name: 'ด.ช. ' + nick, Nickname: nick, Class: 'N1', Plan: 'P1', ParentID: 'PAR-' + id.slice(-2), Status: 'ACTIVE', EnrollDate: '2026-06-01' });
const bill = (sid, extra) => Object.assign({ BillingID: 'BL-2026-11-' + sid, StudentID: sid, Month: '2026-11', Amount: 6900, Status: 'UNPAID', SlipAmount: 0, DueDate: '2026-11-05' }, extra || {});
const slip = (id, ref, kind, sid, amt, status, extra) => Object.assign({ SlipID: id, RefKind: kind, RefID: ref, StudentID: sid, Amount: amt, Url: '', FileId: '', Verified: '', TransRef: '', Receiver: '', SubmittedDate: '2026-11-08 10:00:00', Status: status }, extra || {});
const P5 = tokenFor('Parent', 'PAR-05', 'Uparenttest00005');
const SEED = {
  STAFF: [{ StaffID: 'STF-A', Name: 'แอดมินเอ', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', StartDate: '2025-01-01' },
    { StaffID: 'STF-T', Name: 'ครูที', Role: 'Teacher', PositionLevel: 'Teacher', Department: 'N1', Status: 'ACTIVE', StartDate: '2025-01-01' },
    { StaffID: 'STF-O', Name: 'ผู้ตรวจ', Role: 'Observer', PositionLevel: 'Teacher', Status: 'ACTIVE', StartDate: '2025-01-01' }],
  STUDENTS: [kid('S01', 'เอ'), kid('S02', 'บี'), kid('S03', 'ซี'), kid('S04', 'ดี'), kid('S05', 'อี')],
  PARENTS: [{ ParentID: 'PAR-05', Name: 'แม่อี', LineUID: 'Uparenttest00005', StudentID: 'S05' }],
  BILLING: [bill('S01'), bill('S02', { Status: 'PENDING_VERIFY', SlipAmount: 6900 }), bill('S03', { Status: 'PAID', SlipAmount: 6900, PaidDate: '2026-11-03', VerifiedStatus: 'CONFIRMED' }), bill('S05', { Amount: 4500 })],
  OT_DAILY: [{ OTID: 'OT-20261110-S01', Date: '2026-11-10', StudentID: 'S01', PickupTime: '18:30', PlanEnd: '17:00', LateMinutes: 90, Hours: 2, FullAmount: 200, Discount: 0, Amount: 200, Status: 'UNPAID', SlipRef: '', SlipAmount: 0 }],
  STUDENT_CHARGES: [{ ChargeID: 'CH-0001', StudentID: 'S01', Month: '2026-11', Label: 'ทัศนศึกษา', Amount: 500, Status: 'UNPAID' },
    { ChargeID: 'CH-0002', StudentID: 'S05', Month: '2026-11', Label: 'ชุดกีฬา', Amount: 350, Status: 'UNPAID' }],
  PREPAYMENTS: [{ PrepayID: 'PP-0001', StudentID: 'S04', Months: 2, Discount: 5, Gross: 13800, Amount: 13110, Covered: '["2026-12","2027-01"]', Status: 'UNPAID', SlipAmount: 0, Date: '2026-11-08' }],
  PAYMENT_SLIPS: [slip('SL-A', 'BL-2026-11-S02', 'bill', 'S02', 6900, 'SUBMITTED', { Url: 'https://drive.example/a', Verified: 'YES' }),
    slip('SL-B', 'BL-2026-11-S03', 'bill', 'S03', 6900, 'CONFIRMED', { Url: 'https://drive.example/b', Verified: 'YES' }),
    slip('SL-C', 'BL-2026-11-S01', 'bill', 'S01', 100, 'SUBMITTED', { Method: 'cash' })],
  LINE_RECIPIENTS: [{ Name: 'ผอ.', LineUID: 'Udirectortest0004', Topics: 'approval', Active: 'YES', Note: '' }]
};
const CONFIG = [['Timezone', 'Asia/Bangkok'], ['NotifyAdminApproval', 'app'], ['LineChannelAccessToken', 'fake-token-not-real']];
const SHEETS = [['MAIN', 'BILLING'], ['MAIN', 'OT_DAILY'], ['MAIN', 'STUDENT_CHARGES'], ['MAIN', 'PREPAYMENTS'], ['MAIN', 'PAYMENT_SLIPS'], ['MAIN', 'ADMIN_INBOX'], ['MAIN', 'AUDIT_LOG']];
const SEEDED = [['MAIN', 'SCHOOL_CONFIG'], ['HR', 'STAFF'], ['MAIN', 'STUDENTS'], ['MAIN', 'PARENTS'], ['MAIN', 'USER_LINKS'], ['MAIN', 'USERS'], ['MAIN', 'LINE_RECIPIENTS']];

async function viaHost(msg, who) {
  let out = ''; const hdr = {};
  const res = { setHeader(k, v) { hdr[k.toLowerCase()] = v; }, writeHead() {}, end(s) { out = s; } };
  await handle({}, res, JSON.stringify(Object.assign({ token: who.token }, msg)));
  const r = JSON.parse(out);
  r.__line = hdr['x-atom-line'] ? JSON.parse(hdr['x-atom-line']) : [];
  return r;
}
const norm = (name, rows) => rows.map(r => { const o = Object.assign({}, r); delete o.__id;
  if (name === 'ADMIN_INBOX') o.InboxID = String(o.InboxID || '').indexOf('IN-') === 0 ? 'IN-…' : o.InboxID;
  if (name === 'PAYMENT_SLIPS' && o.Verified === 'MANUAL') o.SlipID = String(o.SlipID).replace(/-\d+$/, '-rnd');
  if (name === 'PAYMENT_SLIPS' && o.SubmittedDate) { const s = String(o.SubmittedDate); const t = Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + '+07:00'); o.SubmittedDate = isFinite(t) ? 'min:' + Math.floor(t / 60000) : s; }
  if (name === 'AUDIT_LOG') o.RecordID = String(o.RecordID || '').replace(/^(SL-\d+)-\d+ /, '$1-rnd ');
  if (name === 'AUDIT_LOG') { const s = String(o.Timestamp || '');
    const t = Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + '+07:00');
    o.Timestamp = isFinite(t) ? 'min:' + Math.floor(t / 60000) : s; }
  Object.keys(o).forEach(k => {
    if (o[k] == null) o[k] = '';
    if (typeof o[k] === 'number' || typeof o[k] === 'boolean') o[k] = String(o[k]);
    if (/^-?\d+\.0+$/.test(o[k])) o[k] = o[k].replace(/\.0+$/, '');
  });
  return o; });

(async () => {
  const { client: c } = await connect();
  try {
    await c.query("insert into tenant (id, code, name_th) values ($1, $2, 'ทดสอบรับเงินบนโฮสต์ (ข้อมูลปลอม)')", [TENANT, 'p23-' + TENANT.slice(0, 8)]);
    for (const [k, v] of CONFIG) await c.query('insert into school_config (tenant_id, "key", "value") values ($1, $2, $3)', [TENANT, k, v]);
    for (const s of Object.keys(SEED)) for (const row of SEED[s]) await PG.insertSheetRow(c, TENANT, s, row);

    delete process.env.ATOM_DB;
    const H = require('./gas_test_harness.js')(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Checkin', 'Triggers', 'Leave',
      'Notify', 'Parent', 'Staff', 'GasEngine', 'Engine', 'Payroll', 'Day6', 'OtStaff', 'OT', 'PaySlips', 'Password', 'BillRun', 'Certificate', 'Dspm', 'DspmAdmin', 'Journal', 'Announce']);
    const start = {};
    for (const [wb, s] of SHEETS.concat(SEEDED)) start[s] = await PG.readSheet(c, TENANT, s);
    H.g.__FIX = JSON.stringify(start); H.g.__SHEETS = JSON.stringify(SHEETS.concat(SEEDED));
    H.run(function () {
      _configCache = null; setupAll(); _configCache = null;
      var F = JSON.parse(__FIX), main = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
      JSON.parse(__SHEETS).forEach(function (x) {
        var wb = x[0] === 'HR' ? hr : main, sh = wb.getSheetByName(x[1]) || sheet_(wb, x[1]);
        if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
        if (x[1] === 'BILLING') ensureColumns_(sh, ['BillRun', 'IssuedDate', 'ReceiptDate']);
        if (x[1] === 'PAYMENT_SLIPS') ensureColumns_(sh, ['SlipGroup', 'TransDate', 'TransTime', 'Sender', 'Method', 'SendBank', 'StatedDate', 'StatedTime']);
        (F[x[1]] || []).forEach(function (r) { appendObject_(sh, r); });
      });
      _configCache = null; return '';
    });
    const gasState = () => JSON.parse(H.run(function () {
      var out = {}, main = getMainSpreadsheet_();
      JSON.parse(__SHEETS).slice(0, 7).forEach(function (x) {
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

    const step = async (label, action, fn, ask, who) => {
      const p = GATE.identity(action, JSON.parse(JSON.stringify(ask)), who.sess, M);
      H.g.__P = JSON.stringify(p); H.g.__F = fn;
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
    const row = async (sheet, key, id) => (await PG.readSheet(c, TENANT, sheet)).find(x => String(x[key]) === id) || {};
    const ADM = { staffId: 'STF-A', adminId: 'STF-A', adminName: 'แอดมินเอ' };
    at('2026-11-12', '09:00');
    let r;

    console.log('\n1) 🔴 ประตู');
    for (const [a, who, name] of [['recordCashPayment', T, 'ครู'], ['recordCashPayment', P5, 'ผู้ปกครอง'], ['confirmSlip', T, 'ครู'], ['confirmSlip', OBS, 'ผู้ตรวจ'], ['deleteSlip', P5, 'ผู้ปกครอง']]) {
      const o = await viaHost({ action: a, payload: { kind: 'bill', refId: 'BL-2026-11-S01', amount: 6900, slipId: 'SL-A' } }, who);
      ok_('🔴 ' + name + ' เรียก ' + a + ' → ' + (o.error && o.error.code) + ' ไม่บันทึก', o.ok === false && (await row('BILLING', 'BillingID', 'BL-2026-11-S01')).Status === 'UNPAID' && (await row('PAYMENT_SLIPS', 'SlipID', 'SL-A')).Status === 'SUBMITTED');
    }

    console.log('\n2) 💰 แอดมินรับเงินนอกแอป (Postgres)');
    r = await step('รับเงินสด 3,000 จาก 6,900', 'recordCashPayment', 'handleRecordCashPayment', Object.assign({ kind: 'bill', refId: 'BL-2026-11-S01', amount: 3000, date: '2026-11-11' }, ADM), A);
    ok_('💰 Postgres: PARTIAL · SlipAmount 3000 (รวมเงินสดรอตรวจ 100 = submitted 3,100)', ['PARTIAL'].includes((await row('BILLING', 'BillingID', 'BL-2026-11-S01')).Status));
    await step('🔴 รับเกิน → OVERPAY', 'recordCashPayment', 'handleRecordCashPayment', Object.assign({ kind: 'bill', refId: 'BL-2026-11-S01', amount: 4000 }, ADM), A);
    r = await step('รับค่ารับช้า 200', 'recordCashPayment', 'handleRecordCashPayment', Object.assign({ kind: 'ot', refId: 'OT-20261110-S01', amount: 200 }, ADM), A);
    ok_('💰 Postgres: OT PAID 200', (await row('OT_DAILY', 'OTID', 'OT-20261110-S01')).Status === 'PAID' && Number((await row('OT_DAILY', 'OTID', 'OT-20261110-S01')).SlipAmount) === 200);
    r = await step('รับค่าทัศนศึกษา 500', 'recordCashPayment', 'handleRecordCashPayment', Object.assign({ kind: 'charge', refId: 'CH-0001', amount: 500 }, ADM), A);
    ok_('💰 Postgres: ค่าใช้จ่ายเพิ่มเติม PAID', (await row('STUDENT_CHARGES', 'ChargeID', 'CH-0001')).Status === 'PAID');
    r = await step('รับชำระล่วงหน้า 13,110', 'recordCashPayment', 'handleRecordCashPayment', Object.assign({ kind: 'prepay', refId: 'PP-0001', amount: 13110 }, ADM), A);
    ok_('💰 Postgres: PREPAYMENTS PAID · PaidDate วันนี้', (await row('PREPAYMENTS', 'PrepayID', 'PP-0001')).Status === 'PAID' && String((await row('PREPAYMENTS', 'PrepayID', 'PP-0001')).PaidDate).slice(0, 10) === '2026-11-12');

    console.log('\n3) 💰 ยืนยัน / ปฏิเสธ / ลบ');
    r = await step('ยืนยันสลิปน้องบี', 'confirmSlip', 'handleConfirmSlip', Object.assign({ slipId: 'SL-A', paidDate: '2026-11-09' }, ADM), A);
    { const b = await row('BILLING', 'BillingID', 'BL-2026-11-S02');
      ok_('💰 Postgres: PAID · PaidDate 2026-11-09 · ReceiptDate 2026-11-12', b.Status === 'PAID' && String(b.PaidDate).slice(0, 10) === '2026-11-09' && String(b.ReceiptDate).slice(0, 10) === '2026-11-12'); }
    r = await step('ปฏิเสธสลิปที่ยืนยันแล้วของน้องซี', 'rejectSlip', 'handleRejectSlip', Object.assign({ slipId: 'SL-B' }, ADM), A);
    ok_('💰 Postgres: บิลน้องซีกลับเป็น UNPAID', (await row('BILLING', 'BillingID', 'BL-2026-11-S03')).Status === 'UNPAID');
    await step('🔴 ลบรายการที่มีสลิปแนบ → HAS_SLIP', 'deleteSlip', 'handleDeleteSlip', Object.assign({ slipId: 'SL-A' }, ADM), A);
    r = await step('ลบเงินสดรอตรวจ 100 ที่ไม่มีรูป', 'deleteSlip', 'handleDeleteSlip', Object.assign({ slipId: 'SL-C' }, ADM), A);
    ok_('💰 Postgres: SL-C หายไป · บิลน้องเอยัง PARTIAL 3,000', !(await row('PAYMENT_SLIPS', 'SlipID', 'SL-C')).SlipID && (await row('BILLING', 'BillingID', 'BL-2026-11-S01')).Status === 'PARTIAL' && Number((await row('BILLING', 'BillingID', 'BL-2026-11-S01')).SlipAmount) === 3000);

    console.log('\n4) 💰 แม่อีแจ้งจ่ายเงินสด');
    const fam = extra => Object.assign({ items: [{ kind: 'bill', id: 'BL-2026-11-S05' }, { kind: 'charge', id: 'CH-0002' }] }, extra);
    await step('🔴 ยอดไม่ตรง → AMOUNT_MISMATCH', 'payCombinedCash', 'handlePayCombinedCash', fam({ amount: 4000 }), P5);
    {
      const o = await viaHost({ action: 'payCombinedCash', payload: { items: [{ kind: 'bill', id: 'BL-2026-11-S01' }], amount: 3900 } }, P5);
      ok_('🔴 แม่อีแจ้งจ่ายบิลของบ้านอื่น → ' + (o.error && o.error.code), o.ok === false && o.error.code === 'NO_PERMISSION');
    }
    r = await step('💰 แจ้งจ่ายเงินสด 4,850 เมื่อวาน', 'payCombinedCash', 'handlePayCombinedCash', fam({ amount: 4850, paidDate: '2026-11-11' }), P5);
    { const rows = (await PG.readSheet(c, TENANT, 'PAYMENT_SLIPS')).filter(x => x.SlipGroup && x.SlipGroup === (r.got.data || {}).groupId);
      ok_('💰 Postgres: 2 แถว SUBMITTED เงินสด · บิลอี PENDING_VERIFY · จด LINE ถึงคนในรายชื่อ', rows.length === 2 && rows.every(x => x.Status === 'SUBMITTED' && x.Method === 'cash') &&
        (await row('BILLING', 'BillingID', 'BL-2026-11-S05')).Status === 'PENDING_VERIFY' && r.got.__line.length === 1); }
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
