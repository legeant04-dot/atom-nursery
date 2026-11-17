/**
 * tools/route_sweep_real.js — every READ route, on the school's REAL data, answers the same on both sides
 *
 *   ATOM_PG_ENV=atom-prod.env node tools/route_sweep_real.js --file secrets/export/<export>.json --tenant atom
 *   node tools/route_sweep_real.js --from-db --tenant <code>          self-test: side A built from the database
 *
 * docs/REHEARSAL_RUNBOOK.md R5. Found 17 Nov 2026: every suite we have (95 through run_dbpg_parity)
 * runs on data the suite wrote itself. Nothing had ever answered a route with four years of the
 * school's own rows — the old formats, the blank cells, the records from before a column existed.
 * That is where a move breaks, and it is the one thing the rehearsal can show before UAT does.
 *
 *   A  Apps Script, as it runs today: every src/*.gs in the GAS harness, the export's sheets loaded
 *      into the in-memory workbooks, the request through Code.gs dispatch_ — session check,
 *      applyIdentity_, the route, the envelope. Nothing leaves this machine.
 *   B  the new server, as UAT will meet it: server/host.js handle() against the migrated database
 *      (ATOM_PG_ENV), the SAME token, the SAME request.
 *   Callers: the admin, a teacher, a head teacher, a parent — real people from the data, chosen by
 *   rule (first ACTIVE with that role), so the run is repeatable. Each gets every route in the app's
 *   own FAST_ACTIONS read list (webapp/api.js) with one payload that carries every id a route may ask
 *   for (handlers ignore what they do not use; applyIdentity_/the gate stamp who is asking).
 *
 * 🔴 READ ONLY, AND PROVEN. Only FAST_ACTIONS reads are sent; and every table of the target database
 *    is fingerprinted (count + MD5 of every row) before and after — any change fails the run.
 * 🔴 NO DATA IS PRINTED. A difference is reported as the route, the caller's ROLE, and the JSON path
 *    where the two answers first part — never a value, never a name. The full answers go nowhere.
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? (argv[i + 1] || true) : d; };
const FILE = arg('file', ''), FROM_DB = argv.includes('--from-db'), CODE = arg('tenant', '');
if ((!FILE && !FROM_DB) || !CODE) { console.error('usage: --file <export.json> --tenant <code>   |   --from-db --tenant <code>'); process.exit(2); }

const SECRET = 'sweep-' + crypto.randomBytes(16).toString('hex');
process.env.SESSION_SECRET = SECRET;
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
const MONTH = TODAY.slice(0, 7);

/* the app's own read list — not retyped, so a route added to the app is swept the day it is added */
const READS = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'webapp', 'api.js'), 'utf8');
  const m = /const FAST_ACTIONS = \{([\s\S]*?)\n\s*\};/.exec(src);
  return [...new Set((m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').match(/(\w+)\s*:\s*1/g) || []).map(s => s.split(':')[0].trim()))];
})();

/* the fingerprint the restore drill uses: count + MD5 of every row of every table */
async function fingerprint(c) {
  const t = (await c.query("select tablename from pg_tables where schemaname='public' order by 1")).rows.map(r => r.tablename);
  const sql = t.map(n => `select '${n}' t, count(*)::int n, md5(coalesce(string_agg(x.r, '|' order by x.r), '')) h from (select q::text r from public."${n}" q) x`).join(' union all ');
  const out = {}; (await c.query(sql)).rows.forEach(r => { out[r.t] = r.n + ':' + r.h; }); return out;
}

/* where two answers first part — keys and indexes only, never a value */
function firstDiff(a, b, p) {
  p = p || '$';
  if (a === b) return null;
  const ta = Array.isArray(a) ? 'array' : a === null ? 'null' : typeof a, tb = Array.isArray(b) ? 'array' : b === null ? 'null' : typeof b;
  if (ta !== tb) return p + ' (A=' + ta + ' B=' + tb + ')';
  if (ta === 'array') {
    if (a.length !== b.length) return p + ' (length A=' + a.length + ' B=' + b.length + ')';
    for (let i = 0; i < a.length; i++) { const d = firstDiff(a[i], b[i], p + '[' + i + ']'); if (d) return d; }
    return null;
  }
  if (ta === 'object') {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    const onlyA = ka.filter(k => !(k in b)), onlyB = kb.filter(k => !(k in a));
    if (onlyA.length || onlyB.length) return p + ' (keys only in A: ' + onlyA.slice(0, 5).join(',') + ' · only in B: ' + onlyB.slice(0, 5).join(',') + ')';
    for (const k of ka) { const d = firstDiff(a[k], b[k], p + '.' + k); if (d) return d; }
    return null;
  }
  return p + ' (' + ta + ' differs)';
}
/* what is not the answer: a renewed token, timings */
const norm = r => { if (!r || typeof r !== 'object') return r; const o = Object.assign({}, r); delete o.token; delete o.ms; delete o.perf;
  if (o.error) o.error = { code: o.error.code }; return o; };

(async () => {
  const { connect } = require(path.join(ROOT, 'tools', 'pg_lib.js'));
  const PG = require(path.join(ROOT, 'tools', 'pg_engine.js'));
  const { client: c } = await connect();
  const tr = (await c.query('select id::text id from tenant where code = $1', [CODE])).rows[0];
  if (!tr) { console.error('🔴 ไม่พบ tenant code "' + CODE + '"'); process.exit(1); }
  process.env.TENANT_ID = tr.id;

  /* ── side A's data ───────────────────────────────────────────────────────────────────────── */
  let wbs;
  if (FILE) {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    wbs = { MAIN: j.MAIN || {}, HR: j.HR || {} };
  } else {
    /* self-test: read every sheet back out of the database the way the host does. A sheet's workbook
     * is not recorded there, so each goes into BOTH (the code only ever opens it in the right one) —
     * except AUDIT_LOG, which is two different logs (hr_audit_log). */
    wbs = { MAIN: {}, HR: {} };
    for (const s of Object.keys(PG.SHEET_COLS())) {
      let rows; try { rows = await PG.readSheet(c, tr.id, s); } catch (e) { continue; }
      if (s === 'AUDIT_LOG') { wbs.MAIN[s] = rows; continue; }
      wbs.MAIN[s] = rows; wbs.HR[s] = rows;
    }
  }
  const rowsOf = (wb, s) => (wbs[wb] && wbs[wb][s]) || [];
  const nRows = Object.values(wbs.MAIN).reduce((a, r) => a + r.length, 0) + (FILE ? Object.values(wbs.HR).reduce((a, r) => a + r.length, 0) : 0);

  /* ── callers, by rule ────────────────────────────────────────────────────────────────────── */
  const staff = rowsOf('HR', 'STAFF').filter(r => String(r.Status || 'ACTIVE').toUpperCase() === 'ACTIVE')
    .sort((a, b) => String(a.StaffID).localeCompare(String(b.StaffID)));
  const students = rowsOf('MAIN', 'STUDENTS').filter(r => String(r.Status || '').toUpperCase() === 'ACTIVE')
    .sort((a, b) => String(a.StudentID).localeCompare(String(b.StudentID)));
  const links = rowsOf('MAIN', 'USER_LINKS'), parents = rowsOf('MAIN', 'PARENTS');
  const admin = staff.find(r => r.Role === 'Admin');
  const teachers = staff.filter(r => r.Role !== 'Admin' && r.Role !== 'Observer');
  const leader = teachers.find(r => /leader|head/i.test(String(r.PositionLevel || '')));
  const teacher = teachers.find(r => r !== leader && r.Classes && r.Classes !== '*') || teachers.find(r => r !== leader);
  /* a parent who can really sign in to a child: a LINE uid that Code.gs parentOwnsStudent_ accepts —
   * USER_LINKS(UserUID, StudentID) or the legacy PARENTS(LineUID, StudentID). A parent without one
   * is refused on both sides and would sweep nothing. */
  const active = new Set(students.map(s => String(s.StudentID)));
  let kid = null, parent = null;
  for (const l of links.filter(l => l.UserUID && active.has(String(l.StudentID))).sort((a, b) => String(a.StudentID).localeCompare(String(b.StudentID)))) {
    const p = parents.find(p => String(p.ParentID) === String(l.ParentID)) || parents.find(p => String(p.LineUID) === String(l.UserUID));
    if (p) { kid = students.find(s => String(s.StudentID) === String(l.StudentID)); parent = Object.assign({}, p, { LineUID: l.UserUID }); break; }
  }
  if (!parent) {
    parent = parents.find(p => p.LineUID && active.has(String(p.StudentID))) || null;
    kid = parent ? students.find(s => String(s.StudentID) === String(parent.StudentID)) : students[0];
  }
  const NOW = Date.now();
  const who = (role, rec, id) => {
    if (!rec) return null;
    const uid = String(rec.LineUID || ('U-sweep-' + id));
    const body = Buffer.from(JSON.stringify(Object.assign({ uid, role, linkedId: id, iat: NOW, exp: NOW + 3600e3 }, role === 'Admin' ? { pa: NOW } : {}))).toString('base64');
    const { sign_ } = require(path.join(ROOT, 'server', 'session.js'));
    return { role, token: body + '.' + sign_(body, SECRET),
      payload: { role, staffId: role === 'Parent' ? undefined : id, parentId: role === 'Parent' ? id : undefined,
        studentId: kid && kid.StudentID, classId: kid && kid.Class, className: kid && kid.Class, cls: kid && kid.Class,
        month: MONTH, ym: MONTH, date: TODAY, day: TODAY } };
  };
  const CALLERS = [
    ['แอดมิน', who('Admin', admin, admin && admin.StaffID)],
    ['ครู', who(teacher && teacher.Role || 'Teacher', teacher, teacher && teacher.StaffID)],
    ['หัวหน้าครู', who(leader && leader.Role || 'Teacher', leader, leader && leader.StaffID)],
    ['ผู้ปกครอง', who('Parent', parent, parent && parent.ParentID)]
  ].filter(x => x[1]);

  console.log('ข้อมูลฝั่ง A: ' + (FILE ? 'ไฟล์ export' : 'อ่านจากฐาน (self-test)') + ' · ' + nRows + ' แถว · tenant ' + CODE);
  console.log('ผู้เรียก: ' + CALLERS.map(x => x[0]).join(' · ') + ' · route อ่าน ' + READS.length + ' ตัว (webapp/api.js FAST_ACTIONS)');
  if (CALLERS.length < 4) console.log('⚠️  ไม่พบผู้เรียกบางบทบาทในข้อมูล — ข้ามบทบาทนั้น');

  /* ── side A: Apps Script ─────────────────────────────────────────────────────────────────── */
  delete process.env.ATOM_DB;
  const files = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.gs')).map(f => f.slice(0, -3));
  const H = require('./gas_test_harness.js')(files);
  H.props.SESSION_SECRET = SECRET;
  H.run(function () { _configCache = null; setupAll(); _configCache = null; return ''; });
  /* the export's rows straight into the workbooks — header = the sheet's own columns, then any the
   * export has that setup did not create (a sheet is what it holds, not what setup expects) */
  const fill = (wbName, ss) => {
    for (const [name, rows] of Object.entries(wbs[wbName])) {
      const sh = ss.getSheetByName(name) || ss.insertSheet(name);
      const head = (sh.data[0] || []).filter(h => h !== '' && h !== undefined).map(String);
      rows.forEach(r => Object.keys(r).forEach(k => { if (head.indexOf(k) < 0) head.push(k); }));
      sh.cols = Math.max(sh.cols, head.length);
      sh.data = [head].concat(rows.map(r => head.map(h => { const v = r[h];
        return v === undefined || v === null ? '' : (typeof v === 'object' ? JSON.stringify(v) : v); })));
    }
  };
  const ids = JSON.parse(H.run(function () { return JSON.stringify({ m: getMainSpreadsheet_().getId(), h: getHrSpreadsheet_().getId() }); }));
  fill('MAIN', H.store[ids.m]); fill('HR', H.store[ids.h]);
  /* the live school runs with RequireSessionToken='true' (HMAC sessions enforced); the host always does.
   * Without it Code.gs skips applyIdentity_ and the two sides would answer different questions. */
  H.run(function () { _configCache = null; sessionRequired_ = function () { return true; }; return ''; });
  const viaGas = (action, payload, token) => {
    H.g.__REQ = JSON.stringify({ action, payload, token });
    return JSON.parse(H.run(function () { var q = JSON.parse(__REQ); return dispatch_(q.action, q.payload, q.token).getContent(); }));
  };

  /* ── side B: the new server ──────────────────────────────────────────────────────────────── */
  const { handle } = require(path.join(ROOT, 'server', 'host.js'));
  const viaHost = async (action, payload, token) => {
    let out = ''; const res = { setHeader() {}, writeHead() {}, end(s) { out = s; } };
    await handle({}, res, JSON.stringify({ action, payload, token }));
    return JSON.parse(out);
  };

  const before = await fingerprint(c);
  const results = []; let same = 0, diff = 0, bothErr = 0;
  for (const [label, w] of CALLERS) {
    console.log('\n── ' + label);
    for (const action of READS) {
      let a, b;
      try { a = norm(viaGas(action, JSON.parse(JSON.stringify(w.payload)), w.token)); } catch (e) { a = { ok: false, error: { code: 'HARNESS:' + String(e.message).slice(0, 60) } }; }
      try { b = norm(await viaHost(action, JSON.parse(JSON.stringify(w.payload)), w.token)); } catch (e) { b = { ok: false, error: { code: 'HOST:' + String(e.message).slice(0, 60) } }; }
      const d = firstDiff(a, b);
      const ok = !d, errs = a && a.ok === false && b && b.ok === false;
      if (ok) same++; else diff++;
      if (ok && errs) bothErr++;
      const tag = ok ? (errs ? '  =err ' : '  ok   ') : '  DIFF ';
      const codes = (a && a.ok === false ? ' A=' + a.error.code : '') + (b && b.ok === false ? ' B=' + b.error.code : '');
      console.log(tag + action + codes + (d ? '\n         ' + d : ''));
      results.push({ caller: label, action, same: ok, where: d || '', a: a && a.ok === false ? a.error.code : 'ok', b: b && b.ok === false ? b.error.code : 'ok' });
    }
  }
  const after = await fingerprint(c);
  const changed = Object.keys(Object.assign({}, before, after)).filter(t => before[t] !== after[t]);
  await c.end();

  console.log('\n' + '═'.repeat(60));
  console.log('ตรงกัน ' + same + ' (ในนี้ตอบ error เหมือนกันทั้งสองฝั่ง ' + bothErr + ') · ไม่ตรง ' + diff + ' · จาก ' + (same + diff) + ' คำขอ');
  console.log(changed.length ? '🔴 ฐานข้อมูลถูกเปลี่ยนระหว่างรัน: ' + changed.join(', ') : '🔒 ฐานข้อมูลไม่ถูกเปลี่ยน (ลายนิ้วมือทุกตารางเหมือนก่อนรัน)');
  const out = path.join(ROOT, 'secrets', 'export', 'route_sweep_' + TODAY + '.json');
  try { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify({ tenant: CODE, rows: nRows, results, changed }, null, 1)); console.log('ผลละเอียด (ไม่มีข้อมูลจริง) → ' + path.relative(ROOT, out)); } catch (e) {}
  process.exit(diff || changed.length ? 1 : 0);
})().catch(e => { console.error('🔴 ' + (e && e.stack || e)); process.exit(1); });
