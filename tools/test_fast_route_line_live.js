/**
 * tools/test_fast_route_line_live.js — W2 routes that send LINE, through server/host.js and staging Postgres
 *   node tools/test_fast_route_line_live.js          (needs secrets/supabase.env — fabricated data only)
 *
 * tools/test_fast_route_line.js proves routes.js writes down the same LINE messages Apps Script sends, from
 * the same rows. This proves the host's half: the write is COMMITTED to real tables, and what the host
 * would send (LINE_SEND=capture — staging never sends) is exactly what Apps Script sent for the same step.
 * The host hands back one fingerprint per push (x-atom-line: sha256 of recipient + messages — no text);
 * Apps Script's pushes are fingerprinted the same way and compared, in order.
 *
 *   + a topic switched off · a teacher outside the class · an Observer → nothing written, nothing recorded
 *   + LINE_SEND=off → the write still commits and nothing is recorded (Apps Script with no token)
 * 🔴 Fabricated data only; the tenant is deleted at the end (pg_sweep_tenants knows the p23- prefix).
 */
'use strict';
const path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const TENANT = crypto.randomUUID();
const SECRET = 'route-line-live-' + crypto.randomBytes(12).toString('hex');
process.env.SESSION_SECRET = SECRET;
process.env.TENANT_ID = TENANT;
process.env.LINE_SEND = 'capture';                  // 🔴 staging: write down, never send
delete process.env.LINE_TOKEN;

const { connect } = require(path.join(ROOT, 'tools', 'pg_lib.js'));
const PG = require(path.join(ROOT, 'tools', 'pg_engine.js'));
const GATE = require(path.join(ROOT, 'server', 'gate.js'));
const LINE = require(path.join(ROOT, 'server', 'line_send.js'));
const { handle } = require(path.join(ROOT, 'server', 'host.js'));
const { sign_ } = require(path.join(ROOT, 'server', 'session.js'));
const ALL = Object.keys(PG.COLLECTIONS);

const NOW = Date.now();
const tokenFor = (role, linkedId, uid) => {
  const b = Buffer.from(JSON.stringify({ uid, role, linkedId, iat: NOW, exp: NOW + 3600e3 })).toString('base64');
  return { sess: { uid, role, linkedId }, token: b + '.' + sign_(b, SECRET) };
};
const TEACHER = tokenFor('Teacher', 'STF-T', 'U-T'), OTHER = tokenFor('Teacher', 'STF-U', 'U-U'), OBS = tokenFor('Observer', 'STF-O', 'U-O');

function fixture() {
  const M = {}; ALL.forEach(k => { M[k] = []; });
  M.classes = [{ ClassID: 'C1', ClassName: 'N1' }, { ClassID: 'C2', ClassName: 'N2' }];
  const st = (id, name, role, dept, extra) => Object.assign({ StaffID: id, NameTH: name, Role: role, PositionLevel: role, Department: dept, Classes: '', Status: 'ACTIVE', StartDate: '2025-01-01' }, extra || {});
  M.staff = [st('STF-T', 'ครูทดสอบ', 'Teacher', 'N1', { LineUID: 'Utttttttttttest0009' }), st('STF-U', 'ครูชั้นอื่น', 'Teacher', 'N2'), st('STF-O', 'ผู้ตรวจ', 'Observer', '*')];
  M.students = [{ StudentID: 'STD-1', NameTH: 'เด็กทดสอบหนึ่ง', Nickname: 'หนึ่ง', Class: 'N1', Status: 'ACTIVE', DOB: '2023-03-01', EnrollDate: '2025-01-01' }];
  /* two parents with LINE (one also linked — messaged once) and one without */
  M.parents = [{ ParentID: 'PAR-1', StudentID: 'STD-1', NameTH: 'แม่ทดสอบ', LineUID: 'Uaaaaaaaaaatest0001' },
               { ParentID: 'PAR-2', StudentID: 'STD-1', NameTH: 'พ่อทดสอบ', LineUID: '' }];
  M.userLinks = [{ UserUID: 'Ubbbbbbbbbbtest0002', StudentID: 'STD-1', Role: 'Parent' }, { UserUID: 'Uaaaaaaaaaatest0001', StudentID: 'STD-1', Role: 'Parent' }];
  M.journals = [{ Date: '2026-11-05', StudentID: 'STD-1', TeacherID: 'STF-T', Mood: 'ยิ้ม', Status: 'SUBMITTED', ParentComment: 'ขอบคุณครับ', TeacherReply: '' }];
  return M;
}
const CONFIG = [['Departments', 'N1,N2'], ['Timezone', 'Asia/Bangkok'], ['LineChannelAccessToken', 'fake-token-not-real'], ['NotifyParentJournalReply', 'app,line']];
const SHEETS = [['MAIN', 'DAILY_JOURNAL'], ['MAIN', 'ADMIN_INBOX'], ['MAIN', 'AUDIT_LOG'], ['HR', 'AUDIT_LOG']];
const SEED = [['MAIN', 'SCHOOL_CONFIG'], ['MAIN', 'STUDENTS'], ['MAIN', 'PARENTS'], ['MAIN', 'USER_LINKS'], ['HR', 'STAFF'], ['MAIN', 'CLASSES']];
const hostName = (wb, s) => (wb === 'HR' && s === 'AUDIT_LOG') ? 'HR_AUDIT_LOG' : s;

async function viaHost(msg, who) {
  let out = '';
  const hdr = {};
  const res = { setHeader(k, v) { hdr[k.toLowerCase()] = v; }, writeHead() {}, end(s) { out = s; } };
  await handle({}, res, JSON.stringify(Object.assign({ token: who.token }, msg)));
  const r = JSON.parse(out);
  r.__line = hdr['x-atom-line'] ? JSON.parse(hdr['x-atom-line']) : [];
  r.__ms = hdr['x-atom-ms'] ? JSON.parse(hdr['x-atom-ms']) : {};
  return r;
}
const norm = (name, rows) => rows.map(r => { const o = Object.assign({}, r); delete o.__id;
  if (/AUDIT_LOG$/.test(name)) o.Timestamp = o.Timestamp ? 'now' : o.Timestamp;
  if (name === 'ADMIN_INBOX') { o.InboxID = String(o.InboxID || '').indexOf('IN-') === 0 ? 'IN-…' : o.InboxID; o.Date = o.Date ? 'now' : o.Date; }
  Object.keys(o).forEach(k => { if (typeof o[k] === 'number' || typeof o[k] === 'boolean') o[k] = String(o[k]); });
  return o; });

(async () => {
  const { client: c } = await connect();
  try {
    await c.query("insert into tenant (id, code, name_th) values ($1, $2, 'ทดสอบ route ส่ง LINE บนโฮสต์ (ข้อมูลปลอม)')", [TENANT, 'p23-' + TENANT.slice(0, 8)]);
    for (const [k, v] of CONFIG) await c.query('insert into school_config (tenant_id, "key", "value") values ($1, $2, $3)', [TENANT, k, v]);
    await PG.persist(c, TENANT, fixture(), {}, ALL);
    const setCfg = async (k, v) => {
      await c.query('update school_config set "value" = $3 where tenant_id = $1 and "key" = $2', [TENANT, k, v]);
      H.g.__K = k; H.g.__V = v; H.run(function () { _configCache = null; setConfigValue_(__K, __V); _configCache = null; return ''; });
    };

    const pgState = async () => { const o = {}; for (const [wb, s] of SHEETS) o[hostName(wb, s)] = await PG.readSheet(c, TENANT, hostName(wb, s)); return o; };
    delete process.env.ATOM_DB;
    const H = require('./gas_test_harness.js')(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Checkin', 'Triggers', 'Leave',
      'Notify', 'Parent', 'Staff', 'GasEngine', 'Engine', 'Payroll', 'Day6', 'OtStaff', 'OT', 'Certificate', 'Dspm', 'DspmAdmin', 'Journal', 'Announce']);
    /* Apps Script, seeded with exactly what Postgres holds (read back the way the host reads it) */
    const start = {};
    for (const [wb, s] of SHEETS.concat(SEED)) start[hostName(wb, s)] = await PG.readSheet(c, TENANT, hostName(wb, s));
    H.g.__FIX = JSON.stringify(start); H.g.__SHEETS = JSON.stringify(SHEETS.concat(SEED));
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
      JSON.parse(__SHEETS).slice(0, 4).forEach(function (x) {
        out[(x[0] === 'HR' && x[1] === 'AUDIT_LOG') ? 'HR_AUDIT_LOG' : x[1]] = readObjects_(sheet_(x[0] === 'HR' ? hr : main, x[1]))
          .map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; return o; });
      });
      return JSON.stringify(out);
    }));
    const { M } = await PG.hydrateFast(c, TENANT, ALL, {});
    M.config = await PG.hydrateConfig(c, TENANT);

    /* one step on both sides: the reply, every table, and the LINE fingerprints in order */
    const step = async (label, a, fn, ask, who) => {
      const p = GATE.identity(a, JSON.parse(JSON.stringify(ask)), who.sess, M);
      H.g.__P = JSON.stringify(p); H.g.__F = fn;
      const want = JSON.parse(H.run(function () {
        _configCache = null; PUSH.length = 0;
        var r; try { r = { ok: true, data: this[__F](JSON.parse(__P)) }; } catch (e) { r = { ok: false, code: e.apiCode || e.message }; }
        r.line = PUSH.slice(); return JSON.stringify(r); }));
      const got = await viaHost({ action: a, payload: ask }, who);
      const g = JSON.stringify(got.ok ? { ok: true, data: got.data } : { ok: false, code: got.error && got.error.code });
      const w = JSON.stringify(want.ok ? { ok: true, data: want.data } : { ok: false, code: want.code });
      ok_(label + ' — คำตอบ' + (g === w ? '' : '\n         host=' + g.slice(0, 300) + '\n          gas=' + w.slice(0, 300)), g === w);
      const pg = await pgState(), gs = gasState();
      const diff = Object.keys(gs).filter(k => JSON.stringify(norm(k, pg[k] || [])) !== JSON.stringify(norm(k, gs[k])));
      ok_('   ...สถานะทุกตาราง' + (diff.length ? '  ต่าง: ' + diff.join(',') : ''), !diff.length);
      diff.forEach(k => console.log('         ' + k + '\n            pg=' + JSON.stringify(norm(k, pg[k] || [])).slice(0, 500) + '\n           gas=' + JSON.stringify(norm(k, gs[k])).slice(0, 500)));
      const wantFp = want.line.map(x => LINE.fingerprint({ to: x.to, messages: [{ type: 'text', text: x.text }] }));
      ok_('   ...LINE ที่โฮสต์จะส่ง = ที่ Apps Script ส่ง (' + wantFp.length + ' ข้อความ ผู้รับ เนื้อความ ลำดับ)', JSON.stringify(got.__line) === JSON.stringify(wantFp));
      return { got, want };
    };

    console.log('\n1) saveTeacherReply — บันทึกลง Postgres จริง แล้วจด LINE (staging ไม่ส่ง)');
    const R = 'saveTeacherReply', F = 'handleSaveTeacherReply';
    const s1 = await step('ครูตอบความเห็น (app,line)', R, F, { studentId: 'STD-1', date: '2026-11-05', reply: 'ทานหมดจานค่ะ' }, TEACHER);
    ok_('จดไว้ 2 ข้อความ (ผู้ปกครองสองคน คนละครั้ง)', s1.got.__line.length === 2 && s1.want.line.map(x => x.to).join() === 'Uaaaaaaaaaatest0001,Ubbbbbbbbbbtest0002');
    ok_("x-atom-ms บอกโหมด capture จด 2 ส่ง 0", s1.got.__ms.line && s1.got.__ms.line.mode === 'capture' && s1.got.__ms.line.n === 2 && s1.got.__ms.line.sent === 0);
    ok_('คำตอบอยู่ใน Postgres จริง', (await PG.readSheet(c, TENANT, 'DAILY_JOURNAL'))[0].TeacherReply === 'ทานหมดจานค่ะ');

    await setCfg('NotifyParentJournalReply', 'app');
    await step("สวิตช์ 'app' อย่างเดียว → กระดิ่ง ไม่มี LINE", R, F, { studentId: 'STD-1', date: '2026-11-05', reply: 'แก้ (app)' }, TEACHER);
    await setCfg('NotifyParentJournalReply', 'app,line');

    console.log('\n2) 🔴 ไม่ผ่านด่าน = ไม่บันทึก ไม่จด');
    await step('ครูชั้นอื่น → NO_ACCESS', R, F, { studentId: 'STD-1', date: '2026-11-05', reply: 'ครูชั้นอื่น' }, OTHER);
    {
      const before = JSON.stringify(await pgState());
      const r = await viaHost({ action: R, payload: { studentId: 'STD-1', date: '2026-11-05', reply: 'ผู้ตรวจ' } }, OBS);
      ok_('Observer → ' + (r.error && r.error.code) + ' · ไม่มีอะไรเปลี่ยน · ไม่จด LINE', r.ok === false && r.error.code === 'READ_ONLY' && JSON.stringify(await pgState()) === before && r.__line.length === 0);
    }

    console.log('\n3) LINE_SEND=off — บันทึกได้ ไม่จด (= Apps Script ที่ไม่มี token)');
    process.env.LINE_SEND = 'off';
    await setCfg('LineChannelAccessToken', '');
    const s3 = await step('LINE_SEND=off', R, F, { studentId: 'STD-1', date: '2026-11-05', reply: 'ไม่มี token' }, TEACHER);
    ok_('...บันทึกแล้ว และไม่มี x-atom-line', s3.got.ok && s3.got.__line.length === 0 && (await PG.readSheet(c, TENANT, 'DAILY_JOURNAL'))[0].TeacherReply === 'ไม่มี token');
    process.env.LINE_SEND = 'capture';
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
