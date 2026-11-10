/**
 * tools/test_fast_host_writes_live.js — every write the fast host may save, proven on staging
 *   node tools/test_fast_host_writes_live.js          (needs secrets/supabase.env — fabricated data only)
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * The gate for server/write_proven.js. An action is listed there only if THIS suite passes for it:
 *
 *   ① EXPECTED — load the tenant from Postgres, run the action the way Apps Script would (Code.gs's
 *     applyIdentity_ through server/gate.js, then the engine handler), and keep the resulting M.
 *   ② ACTUAL — send the same request to the real server/host.js handle(), against staging.
 *   ③ load the tenant again and compare EVERY collection with ① — rows, values and ORDER.
 *   ④ the set of collections ① changed must be EXACTLY what write_proven.js declares for it —
 *     a declaration that is too wide lets a bug write somewhere unexpected; too narrow and the
 *     host refuses a legitimate write. Both directions fail here.
 *
 * Plus the two properties that only exist because there is more than one request:
 *   · two writes at once — both land, with different ids (the lock, not luck)
 *   · a row inserted at the TOP of a collection reads back at the top (row order, see persist)
 *
 * The clock is frozen for the whole run so ① and ② stamp the same second.
 * 🔴 Fabricated data only, in a p23- tenant that is deleted at the end (pg_sweep_tenants knows it).
 */
'use strict';
const path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

/* ── a frozen clock: 10:00 Bangkok today ─────────────────────────────────────────────────────── */
const RealDate = Date;
const FROZEN = (() => { const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new RealDate());
  return new RealDate(d + 'T10:00:00+07:00').getTime(); })();
class FrozenDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(FROZEN); }
  static now() { return FROZEN; }
}
global.Date = FrozenDate;

const TENANT = crypto.randomUUID();
const SECRET = 'writes-live-' + crypto.randomBytes(12).toString('hex');
process.env.SESSION_SECRET = SECRET;
process.env.TENANT_ID = TENANT;

const { connect } = require(path.join(ROOT, 'tools', 'pg_lib.js'));
const PG = require(path.join(ROOT, 'tools', 'pg_engine.js'));
const GATE = require(path.join(ROOT, 'server', 'gate.js'));
const { createAtomAPI } = require(path.join(ROOT, 'webapp', 'engine.js'));
const { handle } = require(path.join(ROOT, 'server', 'host.js'));
const { WRITE_PROVEN, MONEY } = require(path.join(ROOT, 'server', 'write_proven.js'));
/* money has its own suite (test_fast_host_money_live.js) and its own fixture — this one covers the rest */
const GENERAL = Object.keys(WRITE_PROVEN).filter(a => MONEY.indexOf(a) < 0);
const { sign_ } = require(path.join(ROOT, 'server', 'session.js'));
const ALL = Object.keys(PG.COLLECTIONS);
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());

const tokenFor = (role, linkedId, uid) => {
  const b = Buffer.from(JSON.stringify({ uid, role, linkedId, iat: FROZEN, exp: FROZEN + 3600e3 })).toString('base64');
  return { sess: { uid, role, linkedId }, token: b + '.' + sign_(b, SECRET) };
};
const TEACHER = tokenFor('Teacher', 'STF-T', 'U-T');

function fixture() {
  const M = {}; ALL.forEach(k => { M[k] = []; });
  M.classes = [{ ClassID: 'C1', ClassName: 'Nursery 1' }];
  M.staff = [
    { StaffID: 'STF-T', NameTH: 'ครูทดสอบ', Nickname: 'ครูที', Role: 'Teacher', PositionLevel: 'Teacher', Department: 'Nursery 1', Classes: '*', Status: 'ACTIVE', StartDate: '2025-01-01' },
    { StaffID: 'STF-A', NameTH: 'แอดมินทดสอบ', Role: 'Admin', PositionLevel: 'Admin', Classes: '*', Status: 'ACTIVE', StartDate: '2025-01-01' }];
  M.students = [
    { StudentID: 'STD-1', NameTH: 'เด็กทดสอบหนึ่ง', Nickname: 'หนึ่ง', Class: 'Nursery 1', Status: 'ACTIVE', ParentID: 'PAR-1', DOB: '2023-03-01', EnrollDate: '2025-01-01', Weight: 12, Height: 88 },
    { StudentID: 'STD-2', NameTH: 'เด็กทดสอบสอง', Nickname: 'สอง', Class: 'Nursery 1', Status: 'ACTIVE', ParentID: 'PAR-2', DOB: '2023-05-01', EnrollDate: '2025-01-01' }];
  M.parents = [{ ParentID: 'PAR-1', NameTH: 'ผู้ปกครองทดสอบ', StudentID: 'STD-1', LineUID: 'U-P' }];
  M.userLinks = [{ UserUID: 'U-P', StudentID: 'STD-1', ParentID: 'PAR-1', Relation: 'แม่' }];
  M.growthRecords = [{ Date: '2026-09-01', StudentID: 'STD-1', AgeMonth: 42, Weight: 12, Height: 88, RecordedBy: 'STF-T', RecordedAt: '2026-09-01 09:00:00' }];
  M.vaccineRecords = [{ StudentID: 'STD-1', Key: 'HB2', VaccineName: 'ตับอักเสบบี', Dates: ['2023-04-01'] }];
  M.comments = [{ CommentID: 'CM-1', StudentID: 'STD-1', ParentID: 'PAR-1', SenderRole: 'Parent', SenderName: 'แม่', Message: 'สวัสดีค่ะ', Timestamp: '2026-10-01 08:00:00' }];
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
/* WHAT A SHEET WOULD HOLD, not what M holds in memory. GasEngine's writeRows_ maps each row onto the
 * sheet's columns and drops a field that has none (addComment's SenderName: COMMENTS has no such
 * column, so live has never stored it), and Sheets turns '2026-11-04 10:00' typed into a timestamp
 * column into a date that decodeCell_ reads back with seconds. Comparing Postgres with raw M would
 * call both of those a host bug when they are what Apps Script does too. */
const TYPES = require(path.join(ROOT, 'tools', 'pg_migrate.js')).targetSchema();
function sheetView(k, rows) {
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
      o[f] = v;
    });
    return o;
  });
}

async function viaHost(msg, who) {
  let out = '';
  const res = { setHeader() {}, writeHead() {}, end(s) { out = s; } };
  await handle({}, res, JSON.stringify(Object.assign({ token: who.token }, msg)));
  return JSON.parse(out);
}

(async () => {
  const { client: c } = await connect();
  try {
    await c.query("insert into tenant (id, code, name_th) values ($1, $2, 'ทดสอบการเขียนบนโฮสต์ (ข้อมูลปลอม)')", [TENANT, 'p23-' + TENANT.slice(0, 8)]);
    for (const [k, v] of [['Departments', 'Nursery 1'], ['DefaultCheckOutTime', '17:00'], ['Timezone', 'Asia/Bangkok']])
      await c.query('insert into school_config (tenant_id, "key", "value") values ($1, $2, $3)', [TENANT, k, v]);
    await PG.persist(c, TENANT, fixture(), {}, ALL);

    /* ── every proven write, one case each ─────────────────────────────────────────────── */
    const CASES = [
      ['addComment',         TEACHER, { studentId: 'STD-1', message: 'วันนี้ทานข้าวหมดค่ะ', senderRole: 'Teacher', senderName: 'ครูที' }],
      ['updateGrowth',       TEACHER, { studentId: 'STD-1', weight: 12.4, height: 89, date: TODAY }],
      /* rows are addressed by POSITION in AgeMonth order and checked against what the screen saw */
      ['editGrowth',         TEACHER, { studentId: 'STD-1', idx: 0, wasDate: '2026-09-01', weight: 12.1 }],
      ['deleteGrowth',       TEACHER, { studentId: 'STD-1', idx: 0, wasDate: '2026-09-01' }],
      /* ...and the LATEST one, which also moves the child's current weight/height back (growthSyncLatest_) */
      ['deleteGrowth',       TEACHER, { studentId: 'STD-1', idx: 0, wasDate: TODAY }],
      ['saveVaccines',       TEACHER, { studentId: 'STD-1', records: [{ key: 'HB2', name: 'ตับอักเสบบี', dates: ['2023-04-01', '2023-05-01'] }, { key: 'BCG', name: 'วัณโรค', dates: ['2023-03-02'] }] }],
      ['setAbsenceFollowup', TEACHER, { studentId: 'STD-2', note: 'โทรคุยกับผู้ปกครองแล้ว', status: 'CONTACTED' }],
      /* W3: a family turned up on a closed Saturday — the teacher adds the child (taking a name off is the admin's holidayAttendSet — W4) */
      ['holidayAttendAdd',    TEACHER, { studentId: 'STD-2', date: '2026-11-21' }]
    ];
    const covered = new Set(), seen = {};
    for (const [action, who, payload] of CASES) {
      console.log('\n▶ ' + action);
      covered.add(action); seen[action] = seen[action] || new Set();
      // ① what Apps Script would leave behind
      const E = await load(c);
      const before = {}; ALL.forEach(k => { before[k] = JSON.stringify(strip(E[k])); });
      let expectErr = null, expectData;
      try { expectData = createAtomAPI(E, null).H[action](GATE.identity(action, JSON.parse(JSON.stringify(payload)), who.sess, E)); }
      catch (e) { expectErr = e.code || e.apiCode || e.message; }
      ok_('ฝั่ง Apps Script รันได้ (ไม่ใช่กรณีที่ถูกปฏิเสธ)' + (expectErr ? '  → ' + expectErr : ''), !expectErr);
      const observed = ALL.filter(k => JSON.stringify(strip(E[k])) !== before[k]).sort();
      const declared = (WRITE_PROVEN[action] || []).slice().sort();
      observed.forEach(k => seen[action].add(k));
      ok_('🔴 เปลี่ยนเฉพาะที่ประกาศใน write_proven  ประกาศ[' + declared + '] · จริง[' + observed + ']', observed.every(k => declared.indexOf(k) >= 0));
      // ② the host, for real
      const vers = async () => Object.fromEntries((await c.query('select sheet, ver::int v from cache_version where tenant_id = $1', [TENANT])).rows.map(x => [x.sheet, x.v]));
      const v0 = await vers();
      const r = await viaHost({ action, payload }, who);
      /* 🔴 Apps Script's row cache is keyed by these versions (src/DbPg.gs CACHE VERSIONS) — a sheet the
       * host wrote whose version did not move is a sheet Apps Script keeps answering from its old copy */
      const v1 = await vers();
      const stuck = observed.map(k => PG.COLLECTIONS[k].sheet).filter(s => !((v1[s] || 0) > (v0[s] || 0)));
      ok_('🔴 ทุกชีตที่เขียน ขยับเวอร์ชันแคชของ Apps Script' + (stuck.length ? '  → ค้าง: ' + stuck.join(',') : '  (' + observed.map(k => PG.COLLECTIONS[k].sheet).join(',') + ')'), stuck.length === 0);
      ok_('โฮสต์ตอบสำเร็จ' + (r.ok ? '' : '  → ' + JSON.stringify(r.error).slice(0, 140)), r.ok === true);
      /* the reply as the phone gets it — the host never sends `__id`, and neither does Apps Script */
      const asSent = v => JSON.stringify(v, (k, x) => (k === '__id' ? undefined : x));
      ok_('...คำตอบเท่ากับฝั่ง Apps Script' + (asSent(r.data) === asSent(expectData) ? '' : '  pg=' + String(asSent(r.data)).slice(0, 200) + ' gas=' + String(asSent(expectData)).slice(0, 200)), asSent(r.data) === asSent(expectData));
      // ③ what is in Postgres now
      const A = await load(c);
      const diff = ALL.filter(k => !same(sheetView(k, A[k]), sheetView(k, E[k])));
      const firstDiff = k => { const a = sheetView(k, A[k]), e = sheetView(k, E[k]); const i = a.findIndex((r, j) => !same(r, e[j]));
        return k + '[' + i + '] pg=' + JSON.stringify(a[i]) + ' gas=' + JSON.stringify(e[i]); };
      ok_('🔴 ทุก collection ใน Postgres = ผลของ Apps Script (ค่า + ลำดับ)' + (diff.length ? '  → ' + diff.map(firstDiff).join(' | ').slice(0, 600) : ''), diff.length === 0);
    }
    ok_('\n🔴 ทุก action ใน write_proven.js มีกรณีในชุดนี้', GENERAL.every(a => covered.has(a)));
    /* ...and no declaration is WIDER than what its cases actually change — a key nobody can show being
     * written is a key a bug could write without being refused */
    const wide = GENERAL.map(a => [a, WRITE_PROVEN[a].filter(k => !(seen[a] && seen[a].has(k)))]).filter(x => x[1].length);
    ok_('🔴 ไม่มีคำประกาศที่กว้างเกินกว่าที่กรณีทดสอบแสดงว่าเขียนจริง' + (wide.length ? '  → ' + JSON.stringify(wide) : ''), wide.length === 0);

    /* ── Apps Script's two cache-version statements, verbatim from src/DbPg.gs, on the real server ── */
    console.log('\n▶ คำสั่ง cache_version ของ Apps Script (ข้อความจริงจาก DbPg.gs) บน Postgres จริง');
    {
      const src = require('fs').readFileSync(path.join(ROOT, 'src', 'DbPg.gs'), 'utf8');
      const sel = (/prepareStatement\('(select "sheet", "ver"::text from "cache_version" where "tenant_id" = \?::uuid)'\)/.exec(src) || [])[1];
      const upsA = /prepareStatement\('(insert into "cache_version" [^']*)' \+\s*'([^']*)'\)/.exec(src);
      const ups = upsA && (upsA[1] + upsA[2]);
      ok_('พบทั้งสองคำสั่งใน DbPg.gs', !!sel && !!ups);
      const pgSql = s => { let i = 0; return s.replace(/\?/g, () => '$' + (++i)); };   // Jdbc ? → node-pg $n
      const before = Object.fromEntries((await c.query(pgSql(sel), [TENANT])).rows.map(r => [r.sheet, Number(r.ver)]));
      await c.query(pgSql(ups), [TENANT, 'COMMENTS']);
      await c.query(pgSql(ups), [TENANT, 'ZZ_NEW_SHEET']);
      const after = Object.fromEntries((await c.query(pgSql(sel), [TENANT])).rows.map(r => [r.sheet, Number(r.ver)]));
      ok_('upsert ของ Apps Script ขยับเวอร์ชันที่มีอยู่ +1 (COMMENTS ' + before.COMMENTS + ' → ' + after.COMMENTS + ')', after.COMMENTS === (before.COMMENTS || 0) + 1);
      ok_('...และสร้างแถวใหม่เป็น 1 ให้ชีตที่ยังไม่เคยมี', after.ZZ_NEW_SHEET === 1);
      ok_('select ของ Apps Script อ่านได้ (เวอร์ชันเป็นข้อความ "' + after.COMMENTS + '")', typeof (await c.query(pgSql(sel), [TENANT])).rows[0].ver === 'string');
    }

    /* ── two writes at the same moment ─────────────────────────────────────────────────── */
    console.log('\n▶ สองคำขอพร้อมกัน');
    const n0 = (await load(c)).comments.length;
    const [r1, r2] = await Promise.all([
      viaHost({ action: 'addComment', payload: { studentId: 'STD-1', message: 'พร้อมกัน ๑', senderRole: 'Teacher' } }, TEACHER),
      viaHost({ action: 'addComment', payload: { studentId: 'STD-1', message: 'พร้อมกัน ๒', senderRole: 'Teacher' } }, TEACHER)]);
    const after = (await load(c)).comments;
    const ids = after.map(x => x.CommentID);
    ok_('ทั้งสองสำเร็จ', r1.ok && r2.ok);
    ok_('🔴 ทั้งสองแถวอยู่ในฐานข้อมูล (ไม่มีใครเขียนทับใคร)', after.length === n0 + 2 &&
      after.some(x => x.Message === 'พร้อมกัน ๑') && after.some(x => x.Message === 'พร้อมกัน ๒'));
    ok_('🔴 รหัสไม่ซ้ำกัน — คนที่สองเห็นแถวของคนแรกก่อนคิดรหัส', new Set(ids).size === ids.length);

    /* ── Apps Script's lock and the host's lock are ONE lock ───────────────────────────── */
    console.log('\n▶ ล็อกของ Apps Script กับของโฮสต์ เป็นล็อกเดียวกัน');
    {
      /* DbPg.gs pgWriteLock_ holds a SESSION advisory lock; server/host.js takes a TRANSACTION advisory
       * lock — on the same key, hashtextextended(<tenant>, 0). Postgres says the two kinds conflict on
       * one key; this proves it on the real server rather than trusting the sentence. */
      const { client: gas } = await connect();
      await gas.query('select pg_advisory_lock(hashtextextended($1, 0))', [TENANT]);
      await c.query('begin');
      await c.query("set local lock_timeout = '1s'");
      let blocked = false;
      try { await c.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [TENANT]); } catch (e) { blocked = /lock timeout/.test(e.message); }
      await c.query('rollback');
      ok_('🔴 Apps Script ถือล็อกอยู่ → โฮสต์รอและไม่ได้ล็อก (หมดเวลา)', blocked);
      const r = await viaHost({ action: 'addComment', payload: { studentId: 'STD-1', message: 'ระหว่างที่ Apps Script ถือล็อก', senderRole: 'Teacher' } }, TEACHER);
      /* the host's own wait is 25s — too long for a test, so the call above waited for it; it must be BUSY, not a write */
      ok_('...การเขียนผ่านโฮสต์ระหว่างนั้น → BUSY ไม่ได้บันทึก', r.ok === false && r.error && r.error.code === 'BUSY' &&
        !(await load(c)).comments.some(x => x.Message === 'ระหว่างที่ Apps Script ถือล็อก'));
      await gas.query('select pg_advisory_unlock(hashtextextended($1, 0))', [TENANT]);
      await gas.end();
      await c.query('begin');
      let freed = true;
      try { await c.query("set local lock_timeout = '1s'"); await c.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [TENANT]); } catch (e) { freed = false; }
      await c.query('rollback');
      ok_('ปลดแล้ว → โฮสต์ได้ล็อกทันที', freed);
    }

    /* ── a row inserted at the top reads back at the top ───────────────────────────────── */
    console.log('\n▶ ลำดับแถว');
    const { M: O, snapshot: S } = await PG.hydrateFast(c, TENANT, ['comments'], {});
    O.comments.unshift({ CommentID: 'CM-TOP', StudentID: 'STD-1', SenderRole: 'Teacher', Message: 'แถวบนสุด', Timestamp: '2026-11-01 08:00:00' });
    const want = strip(O.comments).map(x => x.CommentID);
    const out = await PG.persist(c, TENANT, O, S, ['comments']);
    const got = strip((await load(c)).comments).map(x => x.CommentID);
    ok_('แถวที่ unshift อ่านกลับมาอยู่บนสุด  ' + got.slice(0, 3).join(','), same(got, want));
    ok_('...โดยการเรียงลำดับใหม่ (reordered)', out.reordered === 1);
  } finally {
    /* 🔴 leave staging as empty as it was found */
    const tabs = (await c.query("select table_name from information_schema.tables where table_schema='public' and table_name <> 'tenant'")).rows.map(r => r.table_name);
    for (const t of tabs) { try { await c.query('delete from ' + t + ' where tenant_id = $1', [TENANT]); } catch (e) {} }
    await c.query('delete from tenant where id = $1', [TENANT]);
    const left = (await c.query('select count(*)::int n from students where tenant_id = $1', [TENANT])).rows[0].n;
    console.log('\n🧹 ลบ tenant ทดสอบแล้ว (เหลือ ' + left + ' แถว)');
    await c.end();
  }
  console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('🔴 ' + (e && e.stack || e)); process.exit(1); });
