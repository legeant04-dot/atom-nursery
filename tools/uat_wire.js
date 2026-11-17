/**
 * tools/uat_wire.js — REHEARSAL_RUNBOOK R7 in one command: point UAT at the migrated data
 *
 *   ATOM_PG_ENV=atom-prod.env node tools/uat_wire.js --testers "ชื่อ1,ชื่อ2,…"              plan only
 *   ATOM_PG_ENV=atom-prod.env node tools/uat_wire.js --testers "…" --apply                 do it
 *     --all-staff     every ACTIVE staff member (teachers, admins, the ผอ. if she has a STAFF row) AND every
 *                     ACTIVE Admin/Observer account in USERS — the ผอ.'s decision 17 Nov: "all teachers +
 *                     Admin + ผอ." (anyone past their last working day is left out)
 *     --parent-of "<ชื่อเล่นลูก>,…"   the parent(s) linked to that child (e.g. "เลอา" for คุณแม่เลอา)
 *     --skip-web      the fast host only (no build/deploy of the UAT web)
 *     --allow-no-line a tester found in the data but never signed in with LINE is a warning, not a stop —
 *                     the safe direction (they get no LINE). Unknown or ambiguous names still stop --apply.
 *
 * What it does, in order — every step prints what it did and stops on the first failure:
 *   1. tenant `atom` on atom-prod: its id, and that it HAS data (refuses an empty copy)
 *   2. testers → LINE ids, from the migrated data: STAFF.LineUID · PARENTS.LineUID · USERS.LineUID ·
 *      USER_LINKS.UserUID of a matched parent. A name is matched EXACTLY against NameTH / Nickname /
 *      NameEN (spaces ignored). A name that matches nobody — or more than one person — is reported
 *      and refuses --apply: an unmatched tester gets no LINE, a wrong match sends LINE to the wrong
 *      person. LINE ids are never printed.
 *   3. Cloud Run atom-fast-uat: TENANT_ID + LINE_ALLOW (LINE_SEND stays `allow`) + min-instances 1
 *   4. build dist_uat (tools/build_web.js --uat, the UAT LIFF) and deploy atom-uat-web
 *   5. checks: the host answers `ping`; its LINE mode is allow with N ids; the web page carries the
 *      UAT build (FAST_URL of atom-fast-uat, the UAT LIFF, not the live one)
 *   6. prints the Apps Script UAT Script Properties for a person to paste (Apps Script has no API
 *      for them) — DB_BACKEND=pg LAST
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const PROJECT = 'atom-nursery', REGION = 'asia-southeast1';
const FAST = 'https://atom-fast-uat-120486339414.asia-southeast1.run.app';
const WEB = 'https://atom-uat-web-120486339414.asia-southeast1.run.app';
const GAS = 'https://script.google.com/macros/s/AKfycbyZLcCasfkWNb7JpeJAD_lhN5MTg3p2WkJqZE7GzBaPh9tx5pKyjzqvmxnPFFbR4peh/exec';
const LIFF = '2010457597-RoqhGdPK';
const argv = process.argv.slice(2);
const arg = n => { const i = argv.indexOf('--' + n); return i < 0 ? null : (argv[i + 1] || true); };
const APPLY = argv.includes('--apply'), SKIP_WEB = argv.includes('--skip-web'), ALLOW_NO_LINE = argv.includes('--allow-no-line');
const ALL_STAFF = argv.includes('--all-staff');
const PARENT_OF = String(arg('parent-of') === true ? '' : (arg('parent-of') || '')).split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
const TESTERS = String(arg('testers') === true ? '' : (arg('testers') || '')).split(/[,\n]+/).map(s => s.trim()).filter(Boolean);

if (path.basename(process.env.ATOM_PG_ENV || '') !== 'atom-prod.env') { console.error('🔴 ATOM_PG_ENV=atom-prod.env เท่านั้น'); process.exit(2); }
if (!TESTERS.length && !ALL_STAFF && !PARENT_OF.length) { console.error('usage: [--all-staff] [--parent-of "ชื่อเล่นลูก"] [--testers "ชื่อ1,…"] [--apply] [--skip-web]'); process.exit(2); }
const die = m => { console.error('🔴 ' + m); process.exit(1); };
const step = m => console.log('\n▶ ' + m);
/* gcloud through bash: single quotes keep the ^|^ delimiter away from any shell's own meaning */
const sh = (cmd, label) => {
  const r = cp.spawnSync('bash', ['-c', cmd], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) die(label + ' ล้ม: ' + String(r.stderr || r.stdout).slice(-800));
  return r.stdout;
};
const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();
const UID = /^U[0-9a-f]{32}$/;

(async () => {
  const { connect } = require('./pg_lib.js');
  const PG = require('./pg_engine.js');
  const { client: c } = await connect();

  step('1) tenant atom บน atom-prod');
  const t = (await c.query("select id::text id from tenant where code = 'atom'")).rows[0];
  if (!t) die('ไม่มี tenant atom — ย้ายข้อมูล (R3) ก่อน');
  const nStu = (await c.query('select count(*)::int n from students where tenant_id = $1', [t.id])).rows[0].n;
  if (!nStu) die('tenant atom ไม่มีนักเรียนเลย — ย้ายข้อมูล (R3) ก่อน');
  console.log('   tenant id …' + t.id.slice(-6) + ' · นักเรียน ' + nStu + ' แถว');

  step('2) ผู้ทดสอบ → LINE id (จากข้อมูลที่ย้ายมา)');
  const staff = await PG.readSheet(c, t.id, 'STAFF'), parents = await PG.readSheet(c, t.id, 'PARENTS');
  const users = await PG.readSheet(c, t.id, 'USERS'), links = await PG.readSheet(c, t.id, 'USER_LINKS');
  await c.end();
  /* the sheets' own column names (src/Config.gs SCHEMA): the name is `Name`, not NameTH — the first
   * version of this file looked for NameTH and matched nobody; the fake dress rehearsal caught it.
   * USERS rows have no name: they belong to the staff/parent whose id is their LinkedID. */
  const usersOf = id => users.filter(u => String(u.LinkedID) === String(id)).map(u => u.LineUID);
  const people = [];
  staff.forEach(r => people.push({ kind: 'ครู/แอดมิน', names: [r.Name, r.NameEN, r.Nickname],
    uids: [r.LineUID].concat(usersOf(r.StaffID)) }));
  parents.forEach(r => people.push({ kind: 'ผู้ปกครอง', names: [r.Name, r.NameEN, r.Nickname, r.NicknameEN],
    uids: [r.LineUID].concat(usersOf(r.ParentID), links.filter(l => String(l.ParentID) === String(r.ParentID)).map(l => l.UserUID)) }));
  const allow = new Set(), problems = [], warnings = [];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
  const take = (label, kinds, uidList) => {
    const uids = [...new Set(uidList.map(String).filter(u => UID.test(u)))];
    if (!uids.length) { (ALLOW_NO_LINE ? warnings : problems).push(label + ': (' + kinds + ') ยังไม่เคยเข้าแอปด้วย LINE — จะไม่ได้รับ LINE'); console.log('   ✗ ' + label + ' — ' + kinds + ' · ยังไม่มี LINE id'); return; }
    uids.forEach(u => allow.add(u)); console.log('   ✓ ' + label + ' — ' + kinds + ' · LINE id ' + uids.length);
  };
  if (ALL_STAFF) {
    console.log('   — ครูและบุคลากรทุกคนที่ยังทำงาน (--all-staff)');
    staff.filter(r => String(r.Status || 'ACTIVE').toUpperCase() === 'ACTIVE' && !(r.EndDate && String(r.EndDate).slice(0, 10) < today))
      .forEach(r => take(String(r.Nickname || r.Name || r.StaffID), String(r.Role || 'Teacher'), [r.LineUID].concat(usersOf(r.StaffID))));
    /* accounts with no STAFF row (an owner/ผอ. login provisioned in USERS) */
    const staffIds = new Set(staff.map(r => String(r.StaffID)));
    users.filter(u => /^(Admin|Observer)$/.test(String(u.Role)) && String(u.Status || 'ACTIVE').toUpperCase() === 'ACTIVE' && !staffIds.has(String(u.LinkedID)))
      .forEach(u => take('บัญชี ' + u.Role + ' ' + String(u.UserID || u.LinkedID || ''), 'USERS', [u.LineUID]));
  }
  if (PARENT_OF.length) {
    const students = await (async () => { const { client: c2 } = await connect(); try { return await PG.readSheet(c2, t.id, 'STUDENTS'); } finally { await c2.end(); } })();
    for (const kidName of PARENT_OF) {
      const kids = students.filter(s => String(s.Status || '').toUpperCase() === 'ACTIVE' && [s.Nickname, s.NicknameEN, s.Name].some(n => n && norm(n) === norm(kidName)));
      if (kids.length !== 1) { problems.push('ผู้ปกครองของ ' + kidName + ': ' + (kids.length ? 'พบเด็กชื่อนี้ ' + kids.length + ' คน — ใช้ชื่อจริง' : 'ไม่พบเด็กชื่อนี้')); console.log('   ✗ ผู้ปกครองของ ' + kidName + ' — ' + (kids.length ? 'ตรงหลายคน' : 'ไม่พบ')); continue; }
      const k = kids[0];
      const ps = parents.filter(p => String(p.ParentID) === String(k.ParentID) || String(p.StudentID) === String(k.StudentID) ||
        links.some(l => String(l.StudentID) === String(k.StudentID) && String(l.ParentID) === String(p.ParentID)));
      const linkUids = links.filter(l => String(l.StudentID) === String(k.StudentID)).map(l => l.UserUID);
      take('ผู้ปกครองของ ' + kidName + ' (' + ps.length + ' คน)', 'ผู้ปกครอง', ps.flatMap(p => [p.LineUID].concat(usersOf(p.ParentID))).concat(linkUids));
    }
  }
  for (const name of TESTERS) {
    const hits = people.filter(p => p.names.some(n => n && norm(n) === norm(name)));
    const uids = [...new Set(hits.flatMap(h => h.uids).map(String).filter(u => UID.test(u)))];
    const kinds = [...new Set(hits.map(h => h.kind))].join('/');
    if (!hits.length) { problems.push(name + ': ไม่พบชื่อนี้'); console.log('   ✗ ' + name + ' — ไม่พบ'); continue; }
    /* two STAFF (or two PARENTS) with this name = two people; a teacher who is also a parent is one */
    const perKind = {}; hits.forEach(h => { perKind[h.kind] = (perKind[h.kind] || 0) + 1; });
    if (Object.values(perKind).some(n => n > 1)) { problems.push(name + ': ตรงหลายคนในกลุ่มเดียวกัน — ใช้ชื่อเต็ม'); console.log('   ✗ ' + name + ' — ตรงหลายคน'); continue; }
    if (!uids.length) { (ALLOW_NO_LINE ? warnings : problems).push(name + ': พบ (' + kinds + ') แต่ยังไม่เคยเข้าแอปด้วย LINE — จะไม่ได้รับ LINE'); console.log('   ✗ ' + name + ' — ' + kinds + ' · ยังไม่มี LINE id'); continue; }
    uids.forEach(u => allow.add(u));
    console.log('   ✓ ' + name + ' — ' + kinds + ' · LINE id ' + uids.length);
  }
  console.log('   รวม LINE id ที่จะอนุญาต: ' + allow.size);
  if (warnings.length) console.log('\n   ⚠️ (--allow-no-line):\n     · ' + warnings.join('\n     · '));
  if (problems.length) {
    console.log('\n   ⚠️ ต้องแก้ก่อน --apply:\n     · ' + problems.join('\n     · '));
    if (APPLY) die('มีผู้ทดสอบที่จับคู่ไม่ได้ — แก้ชื่อให้ตรงกับในระบบ หรือเอาออกจากรายการ');
  }
  if (!APPLY) { console.log('\n(แผนเท่านั้น — ใส่ --apply เพื่อดำเนินการ)'); return; }

  step('3) Cloud Run atom-fast-uat: TENANT_ID · LINE_ALLOW · min-instances 1');
  sh(`gcloud run services update atom-fast-uat --region ${REGION} --project ${PROJECT} --min-instances 1 ` +
     `--update-env-vars '^|^TENANT_ID=${t.id}|LINE_SEND=allow|LINE_ALLOW=${[...allow].join(',')}' --quiet`, 'update atom-fast-uat');
  console.log('   ✓ revision ใหม่ขึ้นแล้ว');

  if (!SKIP_WEB) {
    step('4) build + deploy หน้าเว็บ UAT');
    sh(`node tools/build_web.js --uat --fast ${FAST} --gas ${GAS} --liff ${LIFF}`, 'build_web');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atom-uat-web-'));
    fs.copyFileSync(path.join(ROOT, 'uat_web', 'Dockerfile'), path.join(tmp, 'Dockerfile'));
    fs.copyFileSync(path.join(ROOT, 'uat_web', 'nginx.conf'), path.join(tmp, 'nginx.conf'));
    fs.cpSync(path.join(ROOT, 'dist_uat'), path.join(tmp, 'dist_uat'), { recursive: true });
    sh(`gcloud run deploy atom-uat-web --source '${tmp.replace(/\\/g, '/')}' --region ${REGION} --project ${PROJECT} --quiet`, 'deploy atom-uat-web');
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('   ✓ deploy แล้ว');
  }

  step('5) ตรวจ');
  const ping = await fetch(FAST, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'ping' }) }).then(r => r.json()).catch(e => ({ error: String(e) }));
  /* the host asks for a session on EVERY call, ping included — an answer in its envelope is "up" */
  const up = ping && (ping.ok || (ping.error && ping.error.code === 'NO_SESSION'));
  console.log('   โฮสต์ UAT: ' + (up ? '✓ ตอบ' : '✗ ' + JSON.stringify(ping).slice(0, 200)));
  const env = sh(`gcloud run services describe atom-fast-uat --region ${REGION} --project ${PROJECT} --format=json`, 'describe');
  const vars = (JSON.parse(env).spec.template.spec.containers[0].env || []);
  const v = n => (vars.find(x => x.name === n) || {}).value || '';
  const nAllow = v('LINE_ALLOW').split(/[\s,]+/).filter(u => UID.test(u)).length;
  console.log('   LINE_SEND=' + v('LINE_SEND') + ' · LINE_ALLOW ' + nAllow + ' id ' + (v('LINE_SEND') === 'allow' && nAllow === allow.size ? '✓' : '✗'));
  console.log('   TENANT_ID ' + (v('TENANT_ID') === t.id ? '✓' : '✗'));
  if (!SKIP_WEB) {
    const html = await fetch(WEB + '/?v=' + Date.now()).then(r => r.text()).catch(() => '');
    const js = await fetch(WEB + '/api.js?v=' + Date.now()).then(r => r.text()).catch(() => '');
    const all = html + js;
    console.log('   หน้าเว็บ UAT: ' + (all.includes(FAST) ? '✓ FAST_URL ของ UAT' : '✗ ไม่เจอ FAST_URL ของ UAT') +
      ' · ' + (all.includes(LIFF) ? '✓ LIFF ของ UAT' : '(ตรวจ LIFF ด้วยตาในหน้าเว็บ)'));
  }

  step('6) Apps Script UAT › Project Settings › Script Properties (คนวาง — ไม่มี API)');
  console.log('   ' + ['PG_TENANT_ID = ' + t.id, 'PG_TARGET = production', 'PDPA_SIGNED = yes', 'LINE_SEND = allow',
    'LINE_ALLOW = (ค่าเดียวกับ Cloud Run — คัดลอกจาก Cloud Run console › atom-fast-uat › Variables)',
    'DB_BACKEND = pg   ← ใส่เป็นข้อสุดท้าย'].join('\n   '));
  console.log('\n✅ R7 ฝั่ง Cloud Run เสร็จ — ต่อด้วย Script Properties แล้ว R8 (ล็อกอินทดสอบ 1 ครั้ง)');
})().catch(e => die(e && e.stack || e));
