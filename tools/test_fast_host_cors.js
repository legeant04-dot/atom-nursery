/**
 * tools/test_fast_host_cors.js — only the app's own pages may call the fast host from a browser
 *   node tools/test_fast_host_cors.js          (offline — real HTTP to the real server on a free port)
 *
 * 2026-11-13. The host answered `access-control-allow-origin: *` — fine for a speed test on fabricated
 * data, not for children's records. Now (server/host.js corsFor):
 *   1  the app's origins → answered, that origin echoed back (never `*`), Vary: Origin
 *   2  any other origin → 403 BAD_ORIGIN, no CORS header, the database never reached
 *   3  no Origin (a server, curl, the test suites) → answered without CORS headers
 *   4  the preflight follows the same rule
 *   5  ALLOWED_ORIGINS replaces the default list
 */
'use strict';
const path = require('path'), http = require('http');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const ROOT = path.join(__dirname, '..');
process.env.SESSION_SECRET = 'cors-test-' + 'x'.repeat(24);
process.env.TENANT_ID = '00000000-0000-4000-8000-0000000000ac';
delete process.env.ALLOWED_ORIGINS;

let dbTouched = 0;
const libPath = require.resolve(path.join(ROOT, 'tools', 'pg_lib.js'));
require.cache[libPath] = { id: libPath, filename: libPath, loaded: true,
  exports: { connect: async () => { dbTouched++; return { client: { query: async () => ({ rows: [] }), end: async () => {} }, scrub: s => s }; } } };

const hostPath = path.join(ROOT, 'server', 'host.js');
const { server } = require(hostPath);

function send(port, method, origin, body) {
  return new Promise((resolve, reject) => {
    const headers = { 'content-type': 'text/plain' };
    if (origin) headers.origin = origin;
    const req = http.request({ host: '127.0.0.1', port, method, path: '/', headers }, res => {
      let s = ''; res.on('data', c => { s += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (e) {} resolve({ status: res.statusCode, h: res.headers, j }); });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const BODY = JSON.stringify({ action: 'staffSelf', payload: {}, token: '' });

  console.log('\n1) หน้าเว็บของแอป → ตอบ · ส่ง origin นั้นกลับ ไม่ใช่ *');
  for (const o of ['https://legeant04-dot.github.io', 'https://atomnurseryapp.com', 'https://www.atomnurseryapp.com']) {
    const r = await send(port, 'POST', o, BODY);
    ok_(o + ' → ตอบ (NO_SESSION เพราะไม่มี token) · allow-origin = ' + r.h['access-control-allow-origin'],
      r.status === 200 && r.j && r.j.error && r.j.error.code === 'NO_SESSION' && r.h['access-control-allow-origin'] === o);
  }
  const v = await send(port, 'POST', 'https://legeant04-dot.github.io', BODY);
  ok_('Vary: Origin (แคชกลางทางต้องไม่เอาคำตอบของ origin หนึ่งไปให้อีก origin)', /origin/i.test(String(v.h.vary || '')));

  console.log('\n2) 🔴 เว็บอื่น → 403 · ไม่มี header CORS · ไม่แตะฐานข้อมูล');
  dbTouched = 0;
  for (const o of ['https://evil.example', 'https://legeant04-dot.github.io.evil.example', 'http://legeant04-dot.github.io', 'null']) {
    const r = await send(port, 'POST', o, BODY);
    ok_(o + ' → 403 BAD_ORIGIN', r.status === 403 && r.j && r.j.error && r.j.error.code === 'BAD_ORIGIN' && !r.h['access-control-allow-origin']);
  }
  ok_('...ไม่มีครั้งไหนเชื่อมต่อฐานข้อมูล', dbTouched === 0);

  console.log('\n3) ไม่มี Origin (เซิร์ฟเวอร์ · ชุดทดสอบ) → ตอบ ไม่มี header CORS');
  const n = await send(port, 'POST', '', BODY);
  ok_('ตอบตามปกติ (NO_SESSION) · ไม่มี allow-origin', n.status === 200 && n.j.error.code === 'NO_SESSION' && !n.h['access-control-allow-origin']);
  const g = await send(port, 'GET', '', '');
  ok_('GET health check ยังตอบ', g.status === 200 && g.j && g.j.service === 'atom-fast-host');

  console.log('\n4) preflight (OPTIONS) ใช้กฎเดียวกัน');
  const p1 = await send(port, 'OPTIONS', 'https://atomnurseryapp.com', '');
  ok_('OPTIONS จากแอป → 204 + allow-origin + allow-headers', p1.status === 204 && p1.h['access-control-allow-origin'] === 'https://atomnurseryapp.com' && /content-type/.test(p1.h['access-control-allow-headers'] || ''));
  const p2 = await send(port, 'OPTIONS', 'https://evil.example', '');
  ok_('OPTIONS จากเว็บอื่น → 403 ไม่มี allow-origin', p2.status === 403 && !p2.h['access-control-allow-origin']);
  await new Promise(r => server.close(r));

  console.log('\n5) ALLOWED_ORIGINS แทนรายการเริ่มต้น');
  process.env.ALLOWED_ORIGINS = 'https://uat.atomnurseryapp.com/ , https://atomnurseryapp.com';
  delete require.cache[require.resolve(hostPath)];
  const H2 = require(hostPath);
  ok_('ตัวที่ตั้งไว้ (ตัด / ท้าย · ช่องว่าง) ผ่าน', H2.corsFor({ headers: { origin: 'https://uat.atomnurseryapp.com' } }).state === 'ok');
  ok_('ตัวที่ไม่ได้ตั้ง (github.io) ไม่ผ่านแล้ว', H2.corsFor({ headers: { origin: 'https://legeant04-dot.github.io' } }).state === 'bad');
  delete process.env.ALLOWED_ORIGINS;

  console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\nFAILED ' + pass + ' passed, ' + (fail + 1) + ' failed\n'); process.exit(1); });
