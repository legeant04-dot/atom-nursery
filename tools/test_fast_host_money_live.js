/**
 * tools/test_fast_host_money_live.js — every MONEY write the fast host may save, proven on staging
 *   node tools/test_fast_host_money_live.js          (needs secrets/supabase.env — fabricated data only)
 *
 * ผอ., 2026-11-05: "ทำต่อได้เลย พอร์ตการเขียนเงินบน Cloud Run" — and the standing rule:
 * "เรื่องเงินเป็นเรื่องละเอียดและสำคัญมากต่อความน่าเชื่อถือของ Application เรา".
 *
 * The same proof as test_fast_host_writes_live.js, for the money actions in server/write_proven.js
 * (MONEY): for each, what Postgres holds afterwards must equal what Apps Script's sheets would hold —
 * every collection, every baht, every row, in order — and the declaration must match what it writes.
 * Plus what only money needs:
 *
 *   · 🔴 the same bill issued by two people at once is ONE bill, not two (issueBill finds-or-creates
 *     the month's bill; without the lock both would create it and the family is charged twice)
 *   · confirming an already-PAID bill again does not move its receipt date (ReceiptDate is written
 *     once, on the transition to PAID)
 *   · the totals: the sum of every bill and charge in Postgres equals the sum Apps Script would hold
 *   · payrollConfig — a derived key — is written by its writer and reads back the same
 *
 * Config is SCHOOL_CONFIG_DEFAULTS from src/Config.gs (the plans and prepay tiers a new school starts
 * with), so the amounts come from real pricing rules, not numbers typed into this file.
 * The clock is frozen so ① and ② stamp the same second. 🔴 Fabricated data only, p23- tenant, deleted at the end.
 */
'use strict';
const path = require('path'), crypto = require('crypto'), fs = require('fs'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const RealDate = Date;
const FROZEN = (() => { const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new RealDate());
  return new RealDate(d + 'T10:00:00+07:00').getTime(); })();
class FrozenDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(FROZEN); }
  static now() { return FROZEN; }
}
global.Date = FrozenDate;

const TENANT = crypto.randomUUID();
const SECRET = 'money-live-' + crypto.randomBytes(12).toString('hex');
process.env.SESSION_SECRET = SECRET;
process.env.TENANT_ID = TENANT;

const { connect } = require(path.join(ROOT, 'tools', 'pg_lib.js'));
const PG = require(path.join(ROOT, 'tools', 'pg_engine.js'));
const GATE = require(path.join(ROOT, 'server', 'gate.js'));
const { createAtomAPI } = require(path.join(ROOT, 'webapp', 'engine.js'));
const { handle } = require(path.join(ROOT, 'server', 'host.js'));
const { WRITE_PROVEN, MONEY } = require(path.join(ROOT, 'server', 'write_proven.js'));
const { sign_ } = require(path.join(ROOT, 'server', 'session.js'));
const TYPES = require(path.join(ROOT, 'tools', 'pg_migrate.js')).targetSchema();
const ALL = Object.keys(PG.COLLECTIONS);
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
const THIS_MONTH = TODAY.slice(0, 7);
const NEXT_MONTH = (() => { const [y, m] = THIS_MONTH.split('-').map(Number); return m === 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0'); })();
const LAST_MONTH = (() => { const [y, m] = THIS_MONTH.split('-').map(Number); return m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0'); })();

const tokenFor = (role, linkedId, uid) => {
  const b = Buffer.from(JSON.stringify({ uid, role, linkedId, iat: FROZEN, exp: FROZEN + 3600e3 })).toString('base64');
  return { sess: { uid, role, linkedId }, token: b + '.' + sign_(b, SECRET) };
};
const ADMIN = tokenFor('Admin', 'STF-A', 'U-A'), PARENT = tokenFor('Parent', 'PAR-1', 'U-P');

function configDefaults() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'Config.gs'), 'utf8').replace(/\r\n/g, '\n');
  const i = src.search(/^var SCHOOL_CONFIG_DEFAULTS = \[/m), end = src.indexOf('\n];', i);
  const box = {}; vm.runInNewContext(src.slice(i, end + 3) + '\nthis.D = SCHOOL_CONFIG_DEFAULTS;', box);
  return box.D.map(r => [String(r[0]), r[1] == null ? '' : String(r[1])]);
}
function fixture() {
  const M = {}; ALL.forEach(k => { M[k] = []; });
  M.classes = [{ ClassID: 'C1', ClassName: 'Nursery 1' }];
  M.staff = [
    { StaffID: 'STF-A', NameTH: 'แอดมินทดสอบ', Role: 'Admin', PositionLevel: 'Admin', Classes: '*', Status: 'ACTIVE', StartDate: '2025-01-01', BaseSalary: 20000 },
    { StaffID: 'STF-T', NameTH: 'ครูทดสอบ', Role: 'Teacher', PositionLevel: 'Teacher', Department: 'Nursery 1', Classes: '*', Status: 'ACTIVE', StartDate: '2025-01-01', BaseSalary: 15000 }];
  const kid = (id, par, plan) => ({ StudentID: id, NameTH: 'เด็กทดสอบ ' + id, Nickname: id, Class: 'Nursery 1', Status: 'ACTIVE', ParentID: par,
    DOB: '2023-03-01', EnrollDate: '2025-01-01', Plan: plan });
  M.students = [kid('STD-1', 'PAR-1', 'p_0717'), kid('STD-2', 'PAR-2', 'p_0717'), kid('STD-3', 'PAR-3', 'p_0718')];
  M.parents = [{ ParentID: 'PAR-1', NameTH: 'ผู้ปกครองทดสอบ', StudentID: 'STD-1', LineUID: 'U-P' }];
  M.userLinks = [{ UserUID: 'U-P', StudentID: 'STD-1', ParentID: 'PAR-1' }];
  const bill = (id, sid, month, status, extra) => Object.assign({ BillingID: id, StudentID: sid, Month: month, Amount: 6500, Status: status,
    DueDate: month + '-05', OTRollover: 0, SlipUrl: '' }, extra || {});
  M.payments = [
    bill('BL-OLD', 'STD-1', LAST_MONTH, 'PENDING_VERIFY', { PaymentMethod: 'transfer', SlipAmount: 6500, TransactionDate: LAST_MONTH + '-04 09:00:00' }),
    bill('BL-REJ', 'STD-2', LAST_MONTH, 'PENDING_VERIFY', { PaymentMethod: 'transfer', SlipAmount: 6000 }),
    bill('BL-CASH', 'STD-1', '2026-09', 'UNPAID')];
  M.studentCharges = [{ ChargeID: 'CH-9', StudentID: 'STD-2', Month: LAST_MONTH, Label: 'ค่าทัศนศึกษา', Amount: 450, Status: 'UNPAID' }];
  return M;
}

async function load(c) {
  const { M } = await PG.hydrateFast(c, TENANT, ALL, {});
  M.config = await PG.hydrateConfig(c, TENANT);
  await PG.hydrateDerived(c, TENANT, M, TODAY);
  return M;
}
const strip = rows => (rows || []).map(r => { const o = Object.assign({}, r); delete o.__id; return o; });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const asSent = v => JSON.stringify(v, (k, x) => (k === '__id' ? undefined : x));
function sheetView(k, rows) {                       // what a sheet would hold — see test_fast_host_writes_live.js
  const c = PG.COLLECTIONS[k], ty = TYPES[c.table] || {};
  return (rows || []).map(r => {
    const o = {};
    Object.keys(c.toPg).forEach(f => {
      let v = r[f]; if (v === undefined || v === null) v = '';
      const t = String(ty[c.toPg[f]] || '');
      if (/^timestamp/.test(t) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(v))) v = v + ':00';
      else if (t === 'date' && typeof v === 'string') v = v.slice(0, 10);
      else if (t === 'numeric' && v !== '') v = Number(v);
      else if ((t === 'time' || t === 'time without time zone') && typeof v === 'string') v = v.slice(0, 5);
      else if (typeof v === 'object' && v !== '') v = JSON.stringify(v);
      o[f] = v;
    });
    return o;
  });
}
/* payrollConfig as GasEngine would read PAYROLL_CONFIG back: coerce_ on every cell */
const pcView = pc => JSON.stringify(Object.keys(pc || {}).map(id => [id, Object.keys(pc[id]).sort()
  .filter(k => pc[id][k] !== '' && pc[id][k] !== undefined).map(k => [k, String(pc[id][k])])]));
const money = M => (M.payments || []).reduce((s, b) => s + (Number(b.Amount) || 0), 0) +
                   (M.studentCharges || []).reduce((s, c) => s + (Number(c.Amount) || 0), 0) +
                   (M.prepayments || []).reduce((s, p) => s + (Number(p.Amount) || 0), 0);

async function viaHost(msg, who) {
  let out = '';
  const res = { setHeader() {}, writeHead() {}, end(s) { out = s; } };
  await handle({}, res, JSON.stringify(Object.assign({ token: who.token }, msg)));
  return JSON.parse(out);
}

(async () => {
  const { client: c } = await connect();
  try {
    await c.query("insert into tenant (id, code, name_th) values ($1, $2, 'ทดสอบเงินบนโฮสต์ (ข้อมูลปลอม)')", [TENANT, 'p23-' + TENANT.slice(0, 8)]);
    for (const [k, v] of configDefaults()) await c.query('insert into school_config (tenant_id, "key", "value") values ($1, $2, $3)', [TENANT, k, v]);
    await PG.persist(c, TENANT, fixture(), {}, ALL);
    await PG.writePayrollConfig(c, TENANT, { 'STF-T': { PayType: 'monthly', DailyRate: 0 } });

    const CASES = [
      ['issueBill',            ADMIN,  { studentId: 'STD-1', month: THIS_MONTH, adminId: 'STF-A' }],
      ['addStudentCharge',     ADMIN,  { studentId: 'STD-1', month: THIS_MONTH, label: 'ค่าชุดกีฬา', amount: 350, adminId: 'STF-A' }],
      ['removeStudentCharge',  ADMIN,  { chargeId: 'CH-9' }],
      ['notifyCash',           PARENT, { kind: 'bill', id: 'BL-CASH', amount: 6500 }],
      ['confirmPayment',       ADMIN,  { kind: 'bill', id: 'BL-OLD', paidDate: TODAY, method: 'transfer', adminId: 'STF-A' }],
      ['rejectPayment',        ADMIN,  { kind: 'bill', id: 'BL-REJ' }],
      ['prepay',               PARENT, { studentId: 'STD-1', months: 3 }],
      ['issueBillsFor',        ADMIN,  { studentIds: ['STD-2'], month: THIS_MONTH, adminId: 'STF-A' }],
      ['generateMonthlyBills', ADMIN,  { month: NEXT_MONTH, adminId: 'STF-A' }],
      ['setPayrollConfig',     ADMIN,  { staffId: 'STF-T', config: { PayType: 'daily', DailyRate: 520 } }]
    ];
    const covered = new Set(), seen = {};
    for (const [action, who, payload] of CASES) {
      console.log('\n▶ ' + action);
      covered.add(action); seen[action] = seen[action] || new Set();
      const E = await load(c);
      const before = {}; ALL.forEach(k => { before[k] = JSON.stringify(strip(E[k])); });
      const pcBefore = pcView(E.payrollConfig);
      let expectErr = null, expectData;
      try { expectData = createAtomAPI(E, null).H[action](GATE.identity(action, JSON.parse(JSON.stringify(payload)), who.sess, E)); }
      catch (e) { expectErr = e.code || e.apiCode || e.message; }
      ok_('ฝั่ง Apps Script รันได้' + (expectErr ? '  → ' + expectErr : ''), !expectErr);
      const observed = ALL.filter(k => JSON.stringify(strip(E[k])) !== before[k]).concat(pcView(E.payrollConfig) !== pcBefore ? ['payrollConfig'] : []).sort();
      observed.forEach(k => seen[action].add(k));
      const declared = (WRITE_PROVEN[action] || []).slice().sort();
      ok_('🔴 เปลี่ยนเฉพาะที่ประกาศ  ประกาศ[' + declared + '] · จริง[' + observed + ']', observed.every(k => declared.indexOf(k) >= 0));
      const r = await viaHost({ action, payload }, who);
      ok_('โฮสต์ตอบสำเร็จ' + (r.ok ? '' : '  → ' + JSON.stringify(r.error).slice(0, 160)), r.ok === true);
      ok_('...คำตอบเท่ากับฝั่ง Apps Script' + (asSent(r.data) === asSent(expectData) ? '' : '  pg=' + String(asSent(r.data)).slice(0, 220) + ' gas=' + String(asSent(expectData)).slice(0, 220)),
        asSent(r.data) === asSent(expectData));
      const A = await load(c);
      const diff = ALL.filter(k => !same(sheetView(k, A[k]), sheetView(k, E[k])));
      const firstDiff = k => { const a = sheetView(k, A[k]), e = sheetView(k, E[k]); const i = a.findIndex((x, j) => !same(x, e[j]));
        return k + '[' + i + '] pg=' + JSON.stringify(a[i]) + ' gas=' + JSON.stringify(e[i]); };
      ok_('🔴 ทุก collection = ผลของ Apps Script' + (diff.length ? '  → ' + diff.map(firstDiff).join(' | ').slice(0, 700) : ''), diff.length === 0);
      ok_('🔴 ยอดเงินรวม (บิล + รายการ + จ่ายล่วงหน้า) ตรงกันทุกบาท  pg=' + money(A) + ' gas=' + money(E), money(A) === money(E));
      ok_('ตั้งค่าเงินเดือน (payrollConfig) ตรงกัน', pcView(A.payrollConfig) === pcView(E.payrollConfig));
    }
    ok_('\n🔴 ทุก action เงินใน write_proven.js มีกรณีในชุดนี้', MONEY.every(a => covered.has(a)));
    const wide = MONEY.map(a => [a, (WRITE_PROVEN[a] || []).filter(k => !(seen[a] && seen[a].has(k)))]).filter(x => x[1].length);
    ok_('🔴 ไม่มีคำประกาศที่กว้างเกินกว่าที่เขียนจริง' + (wide.length ? '  → ' + JSON.stringify(wide) : ''), wide.length === 0);

    console.log('\n▶ ยืนยันบิลที่จ่ายแล้วซ้ำ');
    const rd0 = (await load(c)).payments.find(b => b.BillingID === 'BL-OLD').ReceiptDate;
    const again = await viaHost({ action: 'confirmPayment', payload: { kind: 'bill', id: 'BL-OLD', paidDate: TODAY, method: 'transfer', adminId: 'STF-A' } }, ADMIN);
    const rd1 = (await load(c)).payments.find(b => b.BillingID === 'BL-OLD').ReceiptDate;
    ok_('สำเร็จ · วันที่ออกใบเสร็จไม่ขยับ (' + rd0 + ')', again.ok && rd0 && rd0 === rd1);

    console.log('\n▶ 🔴 ออกบิลเดียวกันพร้อมกันสองคน');
    const n0 = (await load(c)).payments.filter(b => b.StudentID === 'STD-3' && String(b.Month).slice(0, 7) === THIS_MONTH).length;
    const [x1, x2] = await Promise.all([
      viaHost({ action: 'issueBill', payload: { studentId: 'STD-3', month: THIS_MONTH, adminId: 'STF-A' } }, ADMIN),
      viaHost({ action: 'issueBill', payload: { studentId: 'STD-3', month: THIS_MONTH, adminId: 'STF-A' } }, ADMIN)]);
    const bills = (await load(c)).payments.filter(b => b.StudentID === 'STD-3' && String(b.Month).slice(0, 7) === THIS_MONTH);
    ok_('ทั้งสองคำขอสำเร็จ', x1.ok && x2.ok);
    ok_('🔴 มีบิลเดือนนี้ของนักเรียนคนนี้ "ใบเดียว" — ไม่เรียกเก็บซ้ำ (ก่อน ' + n0 + ' · หลัง ' + bills.length + ')', n0 === 0 && bills.length === 1);
  } finally {
    const tabs = (await c.query("select table_name from information_schema.tables where table_schema='public' and table_name <> 'tenant'")).rows.map(r => r.table_name);
    for (const t of tabs) { try { await c.query('delete from ' + t + ' where tenant_id = $1', [TENANT]); } catch (e) {} }
    await c.query('delete from tenant where id = $1', [TENANT]);
    console.log('\n🧹 ลบ tenant ทดสอบแล้ว');
    await c.end();
  }
  console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('🔴 ' + (e && e.stack || e)); process.exit(1); });
