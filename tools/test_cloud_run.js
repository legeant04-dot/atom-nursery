/**
 * tools/test_cloud_run.js — what may leave this machine when the fast host is built on Cloud Run
 *   node tools/test_cloud_run.js
 *
 * ผอ. 2026-11-04 chose Google Cloud Run (Singapore) for the fast host. `gcloud run deploy --source .`
 * UPLOADS the folder to Google Cloud Build — so the question that matters is not what the image
 * contains but what is allowed to be uploaded at all. .gcloudignore is a whitelist; this suite reads
 * it with gitignore rules and proves the secrets, the signature and the artwork stay here.
 */
const path = require('path'), fs = require('fs');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n?/g, '\n');

// gitignore semantics, for the anchored patterns .gcloudignore uses ("/x", "/x/", "/x/*", "!…")
const rules = R('.gcloudignore').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  .map(l => { const neg = l.startsWith('!'); let p = neg ? l.slice(1) : l; const dir = p.endsWith('/');
    p = p.replace(/^\//, '').replace(/\/$/, '');
    return { neg, dir, re: new RegExp('^' + p.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$') }; });
const match = (p, isDir) => rules.reduce((st, r) => (r.dir && !isDir) || !r.re.test(p) ? st : !r.neg, false);
function uploaded(file) {
  const parts = file.split('/');
  for (let d = 1; d < parts.length; d++) if (match(parts.slice(0, d).join('/'), true)) return false;  // git cannot re-include inside an excluded dir
  return !match(file, false);
}

console.log('\n1) 🔴 สิ่งที่ห้ามออกจากเครื่องนี้');
['secrets/supabase.env', 'secrets/supabase.env.example', 'Atom Signature.png', 'Certificate ENG.png', 'Cetificate Templete.png',
 'Blank Template.png', 'THSarabunNew/THSarabunNew.ttf', 'webapp/CNAME', 'webapp/app.js', 'webapp/assets/logo.png',
 /* src/Code.gs and src/Auth.gs USED to be listed here as "not needed"; since 2026-11-04 server/gate.js
  * loads them (Code.gs's own door), checked to hold no secret and already public in the repo. Two .gs
  * files the image still has no use for take their place, so the whitelist is still being tested.
  * (Certificate.gs was one of them until 2026-11-06, when routes.js began running certText — Slips.gs now;
  * PaySlips.gs until 2026-11-10, when the late-fee rule needed paySlipSum_; BillRun.gs until 2026-11-11 (W4 3a) —
  * Repair.gs now.) */
 'src/Slips.gs', 'src/Repair.gs', 'tools/test_bill_document.js', 'tools/pg_sync.js', 'design/receipt-sample.html',
 'docs/pdpa/02_ROPA.md', 'docs/WORKLOG.md', '.claude/settings.local.json', 'dist_pages/app.js'].forEach(f =>
  ok_('🔴 ไม่ถูกอัปโหลด: ' + f, !uploaded(f)));

console.log('\n2) ...และสิ่งที่ต้องมี ขึ้นไปครบ');
const copies = (R('Dockerfile').match(/^COPY\s+(\S+)/gm) || []).map(s => s.split(/\s+/)[1]);
ok_('Dockerfile คัดลอกไฟล์ทีละไฟล์ ไม่ใช่ทั้งโฟลเดอร์', copies.length >= 10 && !copies.includes('.') && !copies.some(c => c.endsWith('/')));
copies.forEach(f => ok_('อัปโหลดได้และมีอยู่จริง: ' + f, uploaded(f) && fs.existsSync(path.join(__dirname, '..', f))));
ok_('ไม่มี COPY ของ secrets หรือไฟล์ env', !copies.some(c => /secret|\.env/i.test(c)));

console.log('\n3) รหัสฐานข้อมูลมาจาก Secret Manager ไม่ใช่ไฟล์');
const lib = R('tools/pg_lib.js');
ok_('pg_lib อ่าน SUPABASE_DB_URL จาก environment เมื่อไม่มีไฟล์', /process\.env\.SUPABASE_DB_URL && !fs\.existsSync\(ENVFILE\)/.test(lib));
ok_('...รับเฉพาะคีย์ที่รู้จัก', /\['SUPABASE_DB_URL', 'SUPABASE_REGION', 'TENANT_CODE', 'PDPA_SIGNED'\]/.test(lib));
/* 🔴 the first real deploy crashed on every request: the secret carried the file's leading space */
ok_('🔴 ...และตัดช่องว่างหัวท้าย เหมือนตัวอ่านไฟล์', /out\[k\] = String\(process\.env\[k\]\)\.trim\(\)/.test(lib));
/* 🔴 and the second answered 210 of 300 calls with "reading 'Departments'" — no settings at all */
ok_('🔴 โฮสต์โหลดการตั้งค่าโรงเรียน (M.config) ทุกคำขอ', /M\.config = await PG\.hydrateConfig\(client, tenant(, \{ rows: cfgRows \})?\)/.test(R('server/host.js')));
ok_('...ด้วย hydrateConfig_ ตัวเดียวกับ Apps Script ไม่ใช่สำเนา', /liftGas_\(gas, \/\^function hydrateConfig_/.test(R('tools/pg_engine.js')));
ok_('container ไม่รันด้วย root', /^USER node$/m.test(R('Dockerfile')));
/* 🔴 the fourth deploy answered every call with "ENOENT … /app/src/Leave.gs": pg_engine had started
 * lifting code from a file the image did not contain. Every file it reads at run time must be both
 * COPY'd and allowed through .gcloudignore — checked here, not discovered on the host. */
{
  const reads = [...new Set([...R('tools/pg_engine.js').matchAll(/\bR\('([^']+)'\)/g)].map(m => m[1]))];
  const docker = R('Dockerfile'), ignore = R('.gcloudignore');
  const missing = reads.filter(f => !new RegExp('^COPY ' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s', 'm').test(docker) ||
    ignore.indexOf('!/' + f) < 0);
  ok_('🔴 ทุกไฟล์ที่ pg_engine อ่านตอนทำงาน อยู่ใน image (' + reads.join(' · ') + ')' + (missing.length ? '  → ขาด ' + missing.join(' ') : ''),
    reads.length >= 3 && missing.length === 0);
  /* ...and every .gs the GATE loads, and every server/ file the host requires — same failure, same check */
  const gateFiles = ((/const FILES = \[([^\]]*)\]/.exec(R('server/gate.js')) || [])[1] || '').match(/'([^']+)'/g) || [];
  const routeFiles = ((/const FILES = \[([^\]]*)\]/.exec(R('server/routes.js')) || [])[1] || '').match(/'([^']+)'/g) || [];
  const needed = [...new Set(gateFiles.concat(routeFiles))].map(x => 'src/' + x.slice(1, -1) + '.gs')
    .concat([...R('server/host.js').matchAll(/require\(path\.join\(__dirname, '([a-z_]+\.js)'\)\)/g)].map(m => 'server/' + m[1]));
  const absent = needed.filter(f => !new RegExp('^COPY ' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s', 'm').test(docker) ||
    ignore.indexOf('!/' + f) < 0);
  ok_('🔴 ทุกไฟล์ที่ด่าน (gate) และโฮสต์ต้องใช้ อยู่ใน image (' + needed.length + ' ไฟล์)' + (absent.length ? '  → ขาด ' + absent.join(' ') : ''),
    needed.length >= 9 && absent.length === 0);
}
ok_('🔴 api.js ยังไม่ชี้ไปโฮสต์ใหม่ — ไม่มีผู้ใช้จริงคนไหนวิ่งเส้นนี้จนกว่าจะตั้งใจเปิด', /FAST_URL: ''/.test(R('webapp/api.js')));

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
