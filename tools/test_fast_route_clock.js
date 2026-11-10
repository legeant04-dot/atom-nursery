/**
 * tools/test_fast_route_clock.js — the fast host runs on the SCHOOL'S clock, or it does not run a route
 *   node tools/test_fast_route_clock.js
 *
 * Found 2026-11-10 while porting staff check-in: Apps Script reads the hour with Date.getHours() and the
 * weekday with getDay(), in Asia/Bangkok. Cloud Run's container was UTC. Every comparison test passed,
 * because this machine is in Bangkok too — and on the real host a teacher at 08:20 would have been read as
 * 01:20: never late, no OT, and the weekend seven hours out of place.
 */
'use strict';
const path = require('path'), fs = require('fs'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const probe = "const R=require('./server/routes.js');try{R.run('otWaiveDays',{},{SCHOOL_CONFIG:[]},{},{},[]);console.log('RAN '+new Date().getTimezoneOffset())}catch(e){console.log((e.apiCode||'ERR')+' '+e.message)}";
const runIn = tz => cp.execFileSync(process.execPath, ['-e', probe], { cwd: ROOT, env: Object.assign({}, process.env, { TZ: tz }), encoding: 'utf8' }).trim();

const utc = runIn('UTC'), bkk = runIn('Asia/Bangkok'), tokyo = runIn('Asia/Tokyo');
ok_('🔴 นาฬิกา UTC → ไม่รัน route (NOT_ON_FAST_HOST แอปถาม Apps Script แทน)', /^NOT_ON_FAST_HOST /.test(utc) && /not Asia\/Bangkok/.test(utc));
ok_('🔴 นาฬิกาเขตอื่น (โตเกียว) → ไม่รันเช่นกัน', /^NOT_ON_FAST_HOST /.test(tokyo));
ok_('นาฬิกาไทย → รันตามปกติ' + (/^RAN -420$/.test(bkk) ? '' : '  got: ' + bkk.slice(0, 200)), /^RAN -420$/.test(bkk));

const docker = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8'), host = fs.readFileSync(path.join(ROOT, 'server', 'host.js'), 'utf8');
ok_('🔴 Dockerfile ตั้ง TZ=Asia/Bangkok', /^ENV TZ=Asia\/Bangkok$/m.test(docker));
ok_('🔴 host.js ตั้งนาฬิกาก่อนโหลดอย่างอื่น', host.indexOf("process.env.TZ = 'Asia/Bangkok';") > 0 && host.indexOf("process.env.TZ = 'Asia/Bangkok';") < host.indexOf("require('http')"));
{ // the host really does come up on the school's clock even when the container says otherwise
  const out = cp.execFileSync(process.execPath, ['-e', "process.env.TZ='UTC';const s=require('fs').readFileSync('server/host.js','utf8');eval(s.slice(s.indexOf(\"process.env.TZ = 'Asia/Bangkok';\"),s.indexOf(\"const http\")));console.log(new Date().getTimezoneOffset())"], { cwd: ROOT, encoding: 'utf8' }).trim();
  ok_('...และบรรทัดนั้นเปลี่ยนนาฬิกาได้จริงแม้ container บอก UTC', out === '-420');
}
console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
