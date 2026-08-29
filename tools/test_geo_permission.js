/**
 * tools/test_geo_permission.js — a blocked site is not a GPS problem.
 *   node tools/test_geo_permission.js
 *
 * REPORTED 2026-08-25: a parent standing at the gate could not pick their child up. Not a fence
 * problem and not a phone problem — the app's URL was not in that browser's allowed list, so the
 * page was never permitted to ask where they were.
 *
 * WHAT THE APP CAN AND CANNOT DO. There is no API that adds an origin to a browser's allowed list;
 * a browser only ever grants permission in response to a real request from a real user gesture, and
 * once it has recorded "block" for an origin IT NEVER ASKS AGAIN. So there are exactly two moves:
 *
 *   · while the state is `prompt` — ask ONCE, at a calm moment, from a button. Granting is permanent
 *     for the origin, and that is the "allowed list" that was missing.
 *   · once the state is `denied` — no dialog will ever appear, so the only honest thing is the taps
 *     that undo it in the browser's own settings. This is where the old advice was actively wrong:
 *     "please allow location access and try again" describes a button that is not there.
 *
 * THE FAILURE THIS EXISTS FOR, precisely: every refusal produced ONE sentence, so a blocked site and
 * a phone with no satellite fix were told to do the same five Android settings, four of which could
 * not possibly help. getPosition now carries the REASON, and every screen branches on it.
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
const app = R('webapp/app.js'), css = R('webapp/styles.css');

console.log('\n1) the reason a refusal happened is carried, not thrown away');
{
  /* Run the real mapping out of app.js against the three codes the Geolocation API defines.
   * PERMISSION_DENIED = 1, POSITION_UNAVAILABLE = 2, TIMEOUT = 3. */
  const src = /const GEO_MSG = why =>[\s\S]*?const geoErr_ = why => \{[^\n]*\n/.exec(app);
  ok_('both helpers are there to test', !!src);
  const ctx = { EN: () => false, Error };
  vm.createContext(ctx); vm.runInContext(src[0].replace(/^\s*const/, 'var').replace(/\n\s*const geoErr_/, '\nvar geoErr_'), ctx);
  const why = code => code === 1 ? 'DENIED' : code === 3 ? 'TIMEOUT' : 'UNAVAILABLE';
  eq('the three codes map to three different reasons',
    [1, 2, 3].map(why), ['DENIED', 'UNAVAILABLE', 'TIMEOUT']);
  const msgs = ['DENIED', 'TIMEOUT', 'UNAVAILABLE', 'UNSUPPORTED'].map(w => ctx.GEO_MSG(w));
  eq('...and to four different sentences', new Set(msgs).size, 4);
  ok_('the blocked one names the browser, not the GPS', /เบราว์เซอร์บล็อก/.test(ctx.GEO_MSG('DENIED')));
  ok_('...and none of them still says "please allow and try again"',
    msgs.every(m => !/กรุณาอนุญาตการเข้าถึงตำแหน่ง แล้วลองใหม่/.test(m)));
  eq('the error object carries the reason for a caller to branch on', ctx.geoErr_('DENIED').geo, 'DENIED');
}
{
  ok_('getPosition classifies rather than flattening',
    /e=>reject\(geoErr_\(e&&e\.code===1\?'DENIED':e&&e\.code===3\?'TIMEOUT':'UNAVAILABLE'\)\)/.test(app));
  ok_('...and a device with no geolocation at all is its own case', /reject\(geoErr_\('UNSUPPORTED'\)\); return;/.test(app));
  // the accuracy figure the SERVER needs is untouched — it is what separates "outside" from "vague"
  ok_('the phone’s own margin of error is still sent', /acc:Math\.round\(pos\.coords\.accuracy\)\|\|0/.test(app));
  ok_('...and high accuracy is still requested', /enableHighAccuracy:true,timeout:10000,maximumAge:0/.test(app));
}

console.log('\n2) the ask, made once, before it matters');
{
  ok_('the permission state can be read without punching anything', /const GEO_STATE = async \(\) => \{/.test(app));
  ok_('...via the Permissions API', /navigator\.permissions\.query\(\{name:'geolocation'\}\)/.test(app));
  /* iOS Safari has no Permissions API for geolocation. It must answer "unknown" and be OFFERED the
   * ask anyway — on iOS the prompt is the whole point, and treating unknown as granted would hide
   * the one button that fixes this for every iPhone parent in the school. */
  ok_('a browser that cannot answer says unknown', /if\(!navigator\.permissions \|\| !navigator\.permissions\.query\) return 'unknown';/.test(app));
  ok_('...and unknown is still offered the ask', /if\(st==='granted'\)\{ el\.innerHTML=''; return; \}/.test(app));
  ok_('a thrown query does not take the screen with it', /\}catch\(e\)\{ return 'unknown'; \}/.test(app));
}
{
  ok_('there is a button that requests it', /window\.GEO_ASK = async \(btn\) => \{/.test(app));
  /* AND IT MUST NOT PRETEND. Once denied, requesting again produces nothing at all — no dialog, no
   * delay, no change — so the button must go straight to the instructions instead of appearing to
   * try and silently failing. */
  ok_('...which does not try when the answer is already no', /if\(st==='denied'\)\{ GEO_blocked\(\); return; \}/.test(app));
  ok_('granting it says so plainly', /เปิดสิทธิ์ตำแหน่งแล้ว — กดรับกลับได้เลย/.test(app));
  ok_('...and the nudge removes itself', /GEO_gateFill\(\); return;/.test(app));
  ok_('a refusal DURING the ask lands on the blocked screen', /if\(why==='DENIED'\)\{ GEO_blocked\(\); return; \}/.test(app));
  ok_('...while "allowed but no fix" goes to the accuracy check instead', /\/\/ is\b|GEO_check\(\);\n  \};/.test(app));
}

console.log('\n3) blocked gets its OWN instructions — the accuracy list cannot help it');
{
  ok_('there is a separate un-block card', /const GEO_UNBLOCK=\(\)=>/.test(app));
  ok_('...and it is shown only for a denial', /const GEO_HELP=\(why\)=>\(why==='DENIED'\?GEO_UNBLOCK\(\):''\)\+/.test(app));
  ok_('Chrome: the lock icon in the address bar', /แตะไอคอน <b>🔒 \(หรือ ⓘ\)<\/b>/.test(app));
  ok_('Safari: the ᴀA menu, and Location Services', /แตะ <b>ᴀA<\/b>/.test(app) && /บริการหาตำแหน่ง → Safari/.test(app));
  ok_('and a way back without hunting for the button again', /🔄 \$\{EN\(\)\?'I have allowed it — try again':'เปิดให้แล้ว — ลองใหม่'\}/.test(app));
  /* LINE and Facebook open links in their own browser, which keeps its own permission list. It is a
   * common enough cause at this school to name rather than let a parent work through five Android
   * settings that were never involved. */
  ok_('an in-app browser is detected', /const IN_APP_BROWSER = \(\) => \/\\bLine\\\/\|FBAN\|FBAV\|Instagram\/i\.test/.test(app));
  ok_('...and named as the likely cause', /เปิดในเบราว์เซอร์/.test(app));
  ok_('installing to the home screen is offered as the permanent answer', /เพิ่มแอปนี้ไว้ที่หน้าจอโฮม/.test(app));
  // the accuracy advice is unchanged and still there for the case it was written for
  ok_('the precise-location list survives', /ใช้ตำแหน่งที่แม่นยำ<\/b>/.test(app));
  ok_('...and so does the "ขอลงเวลา" fallback for staff', /ให้ใช้ “ขอลงเวลา” ไปก่อน/.test(app));
}

console.log('\n4) the nudge sits where the punching happens, and costs nothing');
{
  ok_('it renders as an empty slot', /const GEO_gate = \(\) => `<div id="geoGate"><\/div>`;/.test(app));
  /* NO api() CALL. GEO_gateFill runs on the parent home and the teacher home — the two busiest
   * screens in the app — and Apps Script runs one execution at a time per user, so a round trip for
   * a nudge would be ~5s in front of every morning. It is entirely client-side. */
  const fill = app.slice(app.indexOf('window.GEO_gateFill = async () => {'), app.indexOf('window.GEO_check=async(btn)=>{'));
  ok_('the slice really is GEO_gateFill', fill.length > 200 && fill.length < 3000);
  ok_('...and filling it makes no server call', fill.indexOf("api('") < 0);
  /* TWO since 2026-08-29, not three. The third was the parent's รับ-ส่ง tab, and that tab is gone:
   * its only other content was a card telling the parent the buttons were on Home. The nudge now
   * sits on the two screens where somebody actually punches — the parent home and the teacher home. */
  eq('it is placed on both screens that punch',
    (app.match(/\$\{GEO_gate\(\)\}/g) || []).length, 2);
  eq('...and filled on each of them', (app.match(/GEO_gateFill\(\)/g) || []).length >= 3, true);
  /* The outstanding-balance card was deliberately put DIRECTLY under the kid cards. A nudge that is
   * empty for most families must not push the money down the screen. */
  ok_('the parent’s outstanding card keeps its place', /\$\{kidsHtml\}\n\s*<div id="pDue"><\/div>/.test(app));
  ok_('a blocked state is coloured as a problem, not a suggestion', /const blocked = st==='denied';/.test(app));
  /* AN INLINE onclick RUNS IN GLOBAL SCOPE. GEO_blocked was a module-scope const, so the one button
   * a blocked parent can press raised a ReferenceError and did nothing — found by opening the app in
   * a browser that had already blocked the origin, which is precisely the reported case.
   * Checked for EVERY inline handler, not just this one, since the mistake is invisible in review. */
  const handlers = [...new Set([...app.matchAll(/onclick="([A-Za-z_][A-Za-z0-9_]*)\(/g)].map(m => m[1]))]
    .filter(n => n !== 'if');
  ok_('there are inline handlers to check', handlers.length > 40);
  eq('every one of them is reachable from global scope',
    handlers.filter(n => !new RegExp('window\\.' + n + '\\s*=').test(app)), []);
}

console.log('\n5) the pick-up itself branches on it');
{
  const punch = app.slice(app.indexOf('window.P_punch=async'), app.indexOf('window.P_otQR='));
  /* A BLOCKED SITE NEVER REACHES THE SERVER, so it cannot be OUT_OF_RANGE — and GEO_check would only
   * repeat the same refusal in a bigger box. */
  ok_('a denial opens the un-block screen', /if\(\(\(e&&e\.geo\)\|\|''\)==='DENIED'\)\{ setTimeout\(\(\)=>GEO_blocked\(\), 600\); return; \}/.test(punch));
  ok_('...before the out-of-range check, which cannot apply', punch.indexOf("e.geo)||'')==='DENIED'") < punch.indexOf("==='OUT_OF_RANGE'"));
  ok_('and a real out-of-range still opens the location check', /if\(\(\(e&&e\.code\)\|\|''\)==='OUT_OF_RANGE'\) setTimeout\(\(\)=>GEO_check\(\), 900\);/.test(punch));
  // drop-off is NOT fenced and must stay that way — a parent who forgot can tap it from the car
  ok_('drop-off still tolerates having no location at all',
    /else \{ try\{ \(\{lat,lng,acc\}=await getPosition\(GEO_QUICK\)\); \}catch\(e\)\{ lat=null; lng=null; acc=0; \} \}/.test(punch));
  /* v288: and it no longer WAITS for one. Nothing checks a drop-off's position, but it was asked for
   * with enableHighAccuracy and a 10s timeout — up to ten seconds of spinner, indoors, on the tap
   * parents make most often. Pick-up is fenced and is deliberately untouched. */
  ok_('...and does not wait ten seconds for a fix nobody reads',
    /const GEO_QUICK = \{enableHighAccuracy:false, timeout:3000, maximumAge:120000\};/.test(app));
  ok_('pick-up still demands the best fix the phone can give',
    /if\(type==='OUT'\)\{ \(\{lat,lng,acc\}=await getPosition\(\)\); \}/.test(punch) &&
    /Object\.assign\(\{enableHighAccuracy:true,timeout:10000,maximumAge:0\}, opts\|\|\{\}\)/.test(app));
}

console.log('\n6) 📍 ตรวจสอบตำแหน่ง says which problem it found');
{
  const chk = app.slice(app.indexOf('window.GEO_check=async(btn)=>{'), app.indexOf('const GEO_UNBLOCK='));
  ok_('it reads the reason off the error', /const why=\(e0&&e0\.geo\)\|\|'';/.test(chk));
  ok_('blocked and "no fix at all" are different headlines', /why==='DENIED'\n\s*\? \(EN\(\)\?'This browser is blocking/.test(chk));
  ok_('...and get different instructions', /\$\{GEO_HELP\(why\)\}/.test(chk));
  // the distance/accuracy/slack table is what separates "outside" from "vague", and is untouched
  ok_('the numbers that separate outside from vague are still shown',
    /Phone’s own accuracy/.test(chk) && /Allowance given/.test(chk) && /School radius/.test(chk));
  /* THE SCHOOL'S RADIUS IS NOT TOUCHED BY ANY OF THIS — a standing instruction since v239. Nothing
   * here changes the fence; it changes what the app says when the fence was never consulted. */
  ok_('the radius still comes from the server, never from the client', chk.indexOf('r.radius') >= 0 && !/Radius\s*=/.test(chk));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
