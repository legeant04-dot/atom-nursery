/**
 * tools/test_geofence_acc.js — the school fence judges where someone COULD be, not where the dot fell.
 *   node tools/test_geofence_acc.js
 *
 * parentCheckin was 14% OUT_OF_RANGE (x8) in the 2026-08-11 report. Reading the code:
 *   · parent CHECK-IN is allowed from anywhere, so every one of those was a CHECK-OUT (รับกลับ);
 *   · Radius defaults to 30 m, chosen on the assumption of ±5–15 m GPS drift (Config.gs);
 *   · but the client threw pos.coords.accuracy away, so a ±60 m fix at the gate was treated as an
 *     exact position 60 m outside the fence.
 * The fix is not a bigger radius — that would let someone check out from the next street. It is to
 * use the margin of error the phone already reports, capped (GpsAccuracySlack, default 50 m).
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), checkin = R('src/Checkin.gs'), parent = R('src/Parent.gs'),
      cfgSrc = R('src/Config.gs'), staffSrc = R('src/Staff.gs');

/* Run the REAL server geofence out of Checkin.gs against a stub config. */
function loadFence(conf) {
  const src = checkin.slice(checkin.indexOf('function haversineMeters_('), checkin.indexOf('// Distance to school WITHOUT'));
  const ctx = {
    Math, Number, String, isNaN, isFinite, parseFloat, console,
    getConfig_: (k, d) => (conf[k] !== undefined ? conf[k] : d),
    apiError_: (code, msg) => { const e = new Error(msg); e.apiCode = code; return e; }
  };
  vm.createContext(ctx);
  // tolerate a build without gpsSlack_ so an old checkout FAILS these checks cleanly instead of
  // crashing the run — a suite that dies proves nothing about the code it was meant to test
  vm.runInContext(src + '\nthis.fence = assertWithinGeofence_;' +
    '\nthis.slack = (typeof gpsSlack_ === "function") ? gpsSlack_ : function(){ return 0; };', ctx);
  return ctx;
}
// school at Config.gs's own coordinates; a metre of latitude is ~1/111320 of a degree
const LAT = 13.792472, LNG = 100.5;
const northOf = m => LAT + m / 111320;
const CONF = { GPS_Lat: String(LAT), GPS_Lng: String(LNG), Radius: '30', GpsAccuracySlack: '50' };
function tryFence(ctx, metres, acc) {
  try { return { ok: true, dist: ctx.fence(northOf(metres), LNG, acc) }; }
  catch (e) { return { ok: false, code: e.apiCode, msg: e.message }; }
}

console.log('\n1) the case that was failing: at the gate, with a phone that is unsure');
{
  const ctx = loadFence(CONF);
  eq('45 m away, phone says ±60 m → allowed', tryFence(ctx, 45, 60).ok, true);
  eq('45 m away, phone says ±5 m → refused', tryFence(ctx, 45, 5).ok, false);
  eq('20 m away, no accuracy reported → allowed (inside anyway)', tryFence(ctx, 20, undefined).ok, true);
  eq('45 m away, no accuracy reported → refused (old behaviour, unchanged)', tryFence(ctx, 45, undefined).ok, false);
}

console.log('\n2) ...and someone who is genuinely NOT at the school still cannot check out');
{
  const ctx = loadFence(CONF);
  eq('2 km away, phone says ±5 m → refused', tryFence(ctx, 2000, 5).ok, false);
  eq('2 km away, phone claims ±2000 m → STILL refused (slack is capped)', tryFence(ctx, 2000, 2000).ok, false);
  eq('500 m away with the worst allowed slack → refused', tryFence(ctx, 500, 9999).ok, false);
  eq('the cap is the configured one, not the phone\'s claim', ctx.slack(9999), 50);
  eq('a modest margin is taken as given', ctx.slack(18), 18);
  eq('a nonsense accuracy buys nothing', [ctx.slack(0), ctx.slack(-4), ctx.slack('x')], [0, 0, 0]);
}

console.log('\n3) the school can turn it off, or widen it');
{
  eq('slack 0 = the old strict rule', tryFence(loadFence(Object.assign({}, CONF, { GpsAccuracySlack: '0' })), 45, 60).ok, false);
  eq('slack 100 lets a ±100 m fix through at 80 m', tryFence(loadFence(Object.assign({}, CONF, { GpsAccuracySlack: '100' })), 80, 100).ok, true);
  eq('a corrupt setting falls back to 50, it does not crash', loadFence(Object.assign({}, CONF, { GpsAccuracySlack: 'abc' })).slack(999), 50);
  ok_('and 50 is the shipped default', /\['GpsAccuracySlack',\s*'50'\]/.test(cfgSrc));
  ok_('the admin can save it', /GpsAccuracySlack: 1/.test(staffSrc));
  ok_('...from the settings screen', /id="cfgSlack"/.test(app));
  ok_('0 is savable — the test is for NaN, not falsiness', /if\(!isNaN\(slack\)&&slack>=0\) gv\.GpsAccuracySlack=slack/.test(app));
}

console.log('\n4) bad input is still bad input');
{
  const ctx = loadFence(CONF);
  let code = '';
  try { ctx.fence(null, null, 10); } catch (e) { code = e.apiCode; }
  eq('no GPS at all → BAD_GPS, not OUT_OF_RANGE', code, 'BAD_GPS');
}

console.log('\n5) the refusal says how far, and how far is allowed');
{
  const r = tryFence(loadFence(CONF), 500, 20);
  ok_('the distance is in the message', /500 ม\.|49\d ม\.|50\d ม\./.test(r.msg));
  ok_('so is the limit', /เกินกำหนด 30 ม\./.test(r.msg));
  ok_('and the tolerance that was applied', /เผื่อความคลาดเคลื่อน GPS 20 ม\./.test(r.msg));
  // the client must not replace that sentence with a generic one
  ok_('the client keeps the server sentence', /\} else if\(code==='OUT_OF_RANGE'\)\{[\s\S]{0,400}head = raw;/.test(app));
  ok_('the generic entry is gone from ERR_MSG', !/OUT_OF_RANGE:\s*\['อยู่นอกรัศมีของโรงเรียน'/.test(app));
  ok_('a parent gets advice a parent can follow', /ลองยืนใกล้ประตูโรงเรียนแล้วกดใหม่/.test(app));
  ok_('...and is NOT told to use the staff-only manual request', /USER&&USER\.role==='Parent'/.test(app));
  ok_('staff still get the manual-request advice', /หรือใช้ "ขอลงเวลา"/.test(app));
}

console.log('\n6) the phone\'s margin actually reaches the server');
{
  ok_('getPosition reports it', /acc:Math\.round\(pos\.coords\.accuracy\)\|\|0/.test(app));
  ok_('parent check-out sends it', /parentCheckin',\{parentId:USER\.parentId,uid:USER\.uid,studentId,type,lat,lng,acc\}/.test(app));
  ok_('...and check-in destructures it too', /if\(type==='OUT'\)\{ \(\{lat,lng,acc\}=await getPosition\(\)\); \}/.test(app));
  ok_('staff check-in/out sends it', /staffCheckin':'staffCheckout',\{staffId:USER\.staffId,lat,lng,acc\}/.test(app));
  ok_('the staff routes read it', (checkin.match(/assertWithinGeofence_\(payload\.lat, payload\.lng, payload\.acc\)/g) || []).length === 2);
  ok_('the parent route reads it', /assertWithinGeofence_\(payload\.lat, payload\.lng, payload\.acc\)/.test(parent));
  // the engine must agree with the route, or mock and live behave differently
  const eng = R('webapp/engine.js');
  ok_('the engine mirrors the rule', /function gpsSlack\(acc\)/.test(eng) && /if\(dist-slack>cfg\.Radius\)/.test(eng));
  ok_('and every engine caller passes it', (eng.match(/geo\(p\.lat,p\.lng,p\.acc\)/g) || []).length === 3);
}

console.log('\n7) a refused pickup is recorded, so "14%" can be judged next time');
{
  ok_('the refusal is logged', /STUDENT_CHECKOUT_OUT_OF_RANGE/.test(parent));
  ok_('with the distance and the accuracy', /'m acc=' \+ \(Number\(payload\.acc\) \|\| 0\)/.test(parent));
  ok_('but never coordinates', !/GPS_Lat.{0,40}OUT_OF_RANGE/.test(parent));
  ok_('and the refusal is still thrown after logging', /throw geoErr;/.test(parent));
  ok_('a failure to log can never swallow the refusal', /catch \(logErr\) \{\}/.test(parent));
  ok_('the client counts it too', /window\.__atomPerfErr\('outOfRange', raw\)/.test(app));
  // check-IN must stay open from anywhere — that is the whole point of the two paths
  ok_('check-in is still unfenced', /geoDistanceSafe_\(payload\.lat, payload\.lng\)/.test(parent));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
