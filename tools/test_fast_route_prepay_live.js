/**
 * tools/test_fast_route_prepay_live.js — W4 3c advance tuition through server/host.js and staging Postgres
 *   node tools/test_fast_route_prepay_live.js       (needs secrets/supabase.env — fabricated data only)
 *
 * tools/test_fast_route_prepay.js proves routes.js re-quotes and repairs exactly as Apps Script from the same rows. This
 * proves the host's half: only an ADMIN may, the re-quoted amounts land in numeric columns and Covered in text, the
 * tiers land in school_config, a deleted prepayment is gone and the repaired bills read back equal.
 * 🔴 Fabricated data only; the tenant is deleted at the end (pg_sweep_tenants knows the p23- prefix).
 */
'use strict';
const path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const TENANT = crypto.randomUUID();
const SECRET = 'route-prepay-live-' + crypto.randomBytes(12).toString('hex');
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

const kid = (id, nick, plan) => ({ StudentID: id, Name: 'ด.ช. ' + nick, Nickname: nick, Class: 'N1', Plan: plan || 'P1', ParentID: 'PAR-' + id.slice(-2), Status: 'ACTIVE', EnrollDate: '2026-06-01' });
const pp = (id, sid, extra) => Object.assign({ PrepayID: id, StudentID: sid, Months: 2, Discount: 5, Gross: 13800, Amount: 13110, Covered: '["2026-12","2027-01"]', Status: 'UNPAID', SlipAmount: 0, Date: '2026-11-08' }, extra || {});
const bill = (sid, month, extra) => Object.assign({ BillingID: 'BL-' + month + '-' + sid, StudentID: sid, Month: month, Amount: 6900, Status: 'UNPAID', SlipAmount: 0, DueDate: month + '-05' }, extra || {});
const SEED = {
  STAFF: [{ StaffID: 'STF-A', Name: 'แอดมินเอ', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', StartDate: '2025-01-01' },
    { StaffID: 'STF-T', Name: 'ครูที', Role: 'Teacher', PositionLevel: 'Teacher', Department: 'N1', Status: 'ACTIVE', StartDate: '2025-01-01' },
    { StaffID: 'STF-O', Name: 'ผู้ตรวจ', Role: 'Observer', PositionLevel: 'Teacher', Status: 'ACTIVE', StartDate: '2025-01-01' }],
  STUDENTS: [kid('S01', 'เอ'), kid('S02', 'บี'), kid('S03', 'ซี', 'P0'), kid('S04', 'ดี')],
  PREPAYMENTS: [pp('PP-0001', 'S01'), pp('PP-0002', 'S02', { Status: 'PAID', SlipAmount: 13110, PaidDate: '2026-11-09' }), pp('PP-0003', 'S03'),
    pp('PP-0004', 'S04', { Months: 3, Discount: 10, Gross: 20700, Amount: 18630, Covered: '["2026-08","2026-09","2026-10"]', Status: 'PAID', SlipAmount: 18630 })],
  BILLING: [bill('S04', '2026-08', { Status: 'PAID', VerifiedStatus: 'PREPAID' }), bill('S04', '2026-09', { Status: 'PAID', VerifiedStatus: 'CONFIRMED', SlipAmount: 6900, PaidDate: '2026-09-04' }),
    bill('S04', '2026-10', { Status: 'PAID', VerifiedStatus: 'PREPAID', PaidDate: '2026-10-01' })]
};
const CONFIG = [['Timezone', 'Asia/Bangkok'], ['Plans', JSON.stringify([{ id: 'P1', name: 'เต็มวัน', end: '17:00', price: 6900 }, { id: 'P0', name: 'ไม่มีราคา', end: '17:00', price: 0 }])],
  ['PrepayTiers', JSON.stringify([{ months: 2, discount: 5 }, { months: 3, discount: 10 }])]];
const SHEETS = [['MAIN', 'BILLING'], ['MAIN', 'PREPAYMENTS'], ['MAIN', 'AUDIT_LOG']];
const SEEDED = [['MAIN', 'SCHOOL_CONFIG'], ['HR', 'STAFF'], ['MAIN', 'STUDENTS'], ['MAIN', 'PAYMENT_SLIPS'], ['MAIN', 'USERS']];

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
    await c.query("insert into tenant (id, code, name_th) values ($1, $2, 'ทดสอบชำระล่วงหน้าบนโฮสต์ (ข้อมูลปลอม)')", [TENANT, 'p23-' + TENANT.slice(0, 8)]);
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
      JSON.parse(__SHEETS).slice(0, 3).forEach(function (x) {
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
    const P = async id => (await PG.readSheet(c, TENANT, 'PREPAYMENTS')).find(x => x.PrepayID === id) || {};
    const B = async id => (await PG.readSheet(c, TENANT, 'BILLING')).find(x => x.BillingID === id) || {};
    const ADM = { staffId: 'STF-A', adminId: 'STF-A' };
    at('2026-11-12', '09:00');
    let r;

    console.log('\n1) 🔴 ประตู');
    for (const [a, who, name] of [['savePrepayTiers', T, 'ครู'], ['editPrepay', T, 'ครู'], ['cancelPrepay', OBS, 'ผู้ตรวจ'], ['prepayAudit', T, 'ครู']]) {
      const o = await viaHost({ action: a, payload: { prepayId: 'PP-0001', months: 6, tiers: [{ months: 2, discount: 90 }], apply: true } }, who);
      ok_('🔴 ' + name + ' เรียก ' + a + ' → ' + (o.error && o.error.code) + ' ไม่บันทึก', o.ok === false && Number((await P('PP-0001')).Months) === 2 && (await B('BL-2026-08-S04')).Status === 'PAID');
    }

    console.log('\n2) 💰 ระดับส่วนลด · แก้ · ลบ · ซ่อมบิล (Postgres)');
    r = await step('บันทึกระดับส่วนลด 5/10/15/20', 'savePrepayTiers', 'handleSavePrepayTiers', Object.assign({ tiers: [{ months: 12, discount: 20 }, { months: 2, discount: 5 }, { months: 3, discount: 10 }, { months: 6, discount: 15 }] }, ADM), A);
    { const v = (await c.query("select value from school_config where tenant_id = $1 and key = 'PrepayTiers'", [TENANT])).rows[0];
      ok_('💰 school_config: เรียงตามเดือน 4 ระดับ', v && JSON.stringify(JSON.parse(v.value).map(t => t.months)) === '[2,3,6,12]'); }
    r = await step('แก้ PP-0001: 3 เดือน 10%', 'editPrepay', 'handleEditPrepay', Object.assign({ prepayId: 'PP-0001', months: 3, discount: 10 }, ADM), A);
    { const p = await P('PP-0001');
      ok_('💰 Postgres: Gross 20,700 · Amount 18,630 · Covered ธ.ค.–ก.พ.', Number(p.Gross) === 20700 && Number(p.Amount) === 18630 && p.Covered === '["2026-12","2027-01","2027-02"]'); }
    await step('🔴 จ่ายแล้ว แก้จำนวนเดือน → ALREADY_PAID', 'editPrepay', 'handleEditPrepay', Object.assign({ prepayId: 'PP-0002', months: 6 }, ADM), A);
    r = await step('จ่ายแล้ว เลื่อนเดือนเริ่ม', 'editPrepay', 'handleEditPrepay', Object.assign({ prepayId: 'PP-0002', startMonth: '2027-01' }, ADM), A);
    ok_('💰 Postgres: ม.ค.–ก.พ. · ยอดเดิม 13,110', (await P('PP-0002')).Covered === '["2027-01","2027-02"]' && Number((await P('PP-0002')).Amount) === 13110);
    await step('🔴 แพ็กเกจไม่มีราคา → NO_PLAN_PRICE', 'editPrepay', 'handleEditPrepay', Object.assign({ prepayId: 'PP-0003', months: 3 }, ADM), A);
    r = await step('ลบรายการที่ยังไม่จ่าย', 'cancelPrepay', 'handleCancelPrepay', Object.assign({ prepayId: 'PP-0003' }, ADM), A);
    ok_('💰 Postgres: PP-0003 หายไป', !(await P('PP-0003')).PrepayID);
    r = await step('ซ่อมบิลที่ตรรกะเก่าทำเครื่องหมาย', 'prepayAudit', 'handlePrepayAudit', Object.assign({ apply: true }, ADM), A);
    ok_('💰 Postgres: ส.ค./ต.ค. → UNPAID · ก.ย. ที่จ่ายจริงยัง PAID', (await B('BL-2026-08-S04')).Status === 'UNPAID' && (await B('BL-2026-10-S04')).Status === 'UNPAID' &&
      (await B('BL-2026-09-S04')).Status === 'PAID' && r.got.data && r.got.data.repaired === 2);
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
