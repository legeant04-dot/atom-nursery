/**
 * tools/test_freeze_live.js — P6b: the Cloud Run host stops writing when SCHOOL_CONFIG WriteFreeze=on
 *   node tools/test_freeze_live.js          (needs secrets/supabase.env — fabricated data only)
 *
 * The host reads the switch from Postgres (it cannot see Apps Script's Script Properties). Proven on
 * staging against the real server/host.js handle():
 *   · a write → WRITE_FROZEN, and the table is exactly as before
 *   · a batch → the write refused, the read beside it still answers
 *   · the message is word for word Apps Script's (src/Freeze.gs), so the app shows one message
 *   · switch off → the same write lands
 * 🔴 Fabricated data only, in a p23- tenant deleted at the end.
 */
'use strict';
const path = require('path'), crypto = require('crypto'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok_ = (label, cond, extra) => { console.log((cond ? '  ok   ' : '  FAIL ') + label + (cond || extra === undefined ? '' : '  ' + JSON.stringify(extra))); cond ? pass++ : fail++; };

const TENANT = crypto.randomUUID();
const SECRET = 'freeze-live-' + crypto.randomBytes(12).toString('hex');
process.env.SESSION_SECRET = SECRET;
process.env.TENANT_ID = TENANT;

const { connect } = require(path.join(ROOT, 'tools', 'pg_lib.js'));
const PG = require(path.join(ROOT, 'tools', 'pg_engine.js'));
const { handle } = require(path.join(ROOT, 'server', 'host.js'));
const { sign_ } = require(path.join(ROOT, 'server', 'session.js'));
const ALL = Object.keys(PG.COLLECTIONS);

const now = Date.now();
const tokenFor = (role, linkedId, uid) => {
  const b = Buffer.from(JSON.stringify({ uid, role, linkedId, iat: now, exp: now + 3600e3 })).toString('base64');
  return b + '.' + sign_(b, SECRET);
};
const TEACHER = tokenFor('Teacher', 'STF-T', 'U-T');
const GAS_MSG = /var WRITE_FROZEN_MSG_ = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'src', 'Freeze.gs'), 'utf8'))[1];

async function viaHost(msg) {
  let out = '';
  const res = { setHeader() {}, writeHead() {}, end(s) { out = s; } };
  await handle({}, res, JSON.stringify(Object.assign({ token: TEACHER }, msg)));
  return JSON.parse(out);
}

(async () => {
  const { client: c } = await connect();
  const setFreeze = v => c.query('update school_config set "value" = $2 where tenant_id = $1 and "key" = \'WriteFreeze\'', [TENANT, v]);
  const count = async () => (await c.query('select count(*)::int n from comments where tenant_id = $1', [TENANT])).rows[0].n;
  try {
    await c.query("insert into tenant (id, code, name_th) values ($1, $2, 'ทดสอบปิดรับการเขียน (ข้อมูลปลอม)')", [TENANT, 'p23-' + TENANT.slice(0, 8)]);
    for (const [k, v] of [['Departments', 'Nursery 1'], ['Timezone', 'Asia/Bangkok'], ['WriteFreeze', 'on']])
      await c.query('insert into school_config (tenant_id, "key", "value") values ($1, $2, $3)', [TENANT, k, v]);
    const M = {}; ALL.forEach(k => { M[k] = []; });
    M.classes = [{ ClassID: 'C1', ClassName: 'Nursery 1' }];
    M.staff = [{ StaffID: 'STF-T', NameTH: 'ครูทดสอบ', Nickname: 'ครูที', Role: 'Teacher', PositionLevel: 'Teacher', Department: 'Nursery 1', Classes: '*', Status: 'ACTIVE', StartDate: '2025-01-01' }];
    M.students = [{ StudentID: 'STD-1', NameTH: 'เด็กทดสอบ', Nickname: 'หนึ่ง', Class: 'Nursery 1', Status: 'ACTIVE', DOB: '2023-03-01', EnrollDate: '2025-01-01' }];
    M.comments = [{ CommentID: 'CM-1', StudentID: 'STD-1', SenderRole: 'Parent', SenderName: 'แม่', Message: 'สวัสดีค่ะ', Timestamp: '2026-10-01 08:00:00' }];
    await PG.persist(c, TENANT, M, {}, ALL);
    const write = { action: 'addComment', payload: { studentId: 'STD-1', message: 'ทดสอบ', senderRole: 'Teacher', senderName: 'ครูที' } };

    console.log('\n▶ WriteFreeze = on');
    const r1 = await viaHost(write);
    ok_('🔴 เขียน → WRITE_FROZEN', r1.ok === false && r1.error && r1.error.code === 'WRITE_FROZEN', r1);
    ok_('ข้อความตรงกับ Apps Script ทุกตัวอักษร', r1.error && r1.error.message === GAS_MSG, r1.error);
    ok_('ไม่มีอะไรถูกบันทึก (comments ยัง 1 แถว)', await count() === 1);
    const r2 = await viaHost({ action: 'batch', payload: { calls: [write, { action: 'classList', payload: {} }] } });
    const [w, rd] = (r2 && r2.data) || [];
    ok_('batch: การเขียนถูกปฏิเสธทีละ call', w && w.error && w.error.code === 'WRITE_FROZEN', r2);
    ok_('batch: การอ่านข้าง ๆ ยังตอบได้', rd && rd.ok === true && rd.data && Array.isArray(rd.data.students) && rd.data.students.length === 1, rd);
    ok_('และยังไม่มีอะไรถูกบันทึก', await count() === 1);

    console.log('\n▶ WriteFreeze = (ว่าง)');
    await setFreeze('');
    const r3 = await viaHost(write);
    ok_('เปิดรับการเขียนแล้ว → บันทึกได้', r3.ok === true, r3);
    ok_('comments เป็น 2 แถว', await count() === 2);
    await setFreeze('ON ');
    const r4 = await viaHost(write);
    ok_('"ON " (ตัวใหญ่ + ช่องว่าง) ก็นับว่าปิด', r4.error && r4.error.code === 'WRITE_FROZEN', r4);
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
