/**
 * tools/test_geo_selfcheck.js — "I am standing in the school and it says I am 620 m away."
 *   node tools/test_geo_selfcheck.js
 *
 * REPORTED 2026-08-24, with a photo: a teacher inside the nursery, refused with
 *   "อยู่นอกรัศมีโรงเรียน (620 ม. เกินกำหนด 50 ม. · เผื่อความคลาดเคลื่อน GPS 50 ม.)"
 *
 * THE NUMBER THAT WOULD HAVE EXPLAINED IT WAS THE ONE NOT SHOWN. `slack` is the phone's own margin
 * of error ALREADY CAPPED at 50 m — so a phone guessing to the nearest 2 km and a phone with a
 * perfect fix printed exactly the same "· เผื่อความคลาดเคลื่อน GPS 50 ม.", and nobody could tell
 * "you really are down the road" from "your phone does not know where it is".
 *
 * A ±1,500 m fix is not a location, it is a postcode. Android's "approximate location" permission
 * and a Wi-Fi/cell-tower fallback both land there, and both are settings on the PHONE rather than
 * facts about where somebody is standing.
 *
 * THE RADIUS IS NOT TOUCHED. It is the school's setting and has been off-limits since v239; a
 * geofence widened to paper over a permission toggle would wave through someone at home.
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
const eng = R('webapp/engine.js'), app = R('webapp/app.js'), ci = R('src/Checkin.gs');

// the school, and a few real places relative to it
const LAT = 13.7563, LNG = 100.5018;
const away = m => ({ lat: LAT + (m / 111320), lng: LNG });   // m metres due north

function boot() {
  const M = {
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [], Departments: '', GPS_Lat: LAT, GPS_Lng: LNG, Radius: 50, GpsAccuracySlack: 50 },
    staff: [], students: [], classes: [], parents: [], userLinks: [], payments: [], studentCharges: [],
    prepayments: [], otDaily: [], paymentSlips: [], otRecords: [], payroll: [], payrollConfig: {},
    checkinStudent: [], studentCheckins: [], studentAttendanceToday: [], studentLeaves: [], journals: [],
    comments: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    leaves: [], absenceLog: [], dspmCriteria: [], activityLog: [], announcements: [], notifications: [],
    vaccines: [], growth: [], growthRecords: [], assessments: [], classChanges: [], timeRequests: [],
    adminInbox: [], foodMenus: [], foodItems: [], surveys: [], surveyResponses: [], injuries: [],
    insurance: [], bigCleaning: [], departments: [], permissions: {}, feed: [], calendar: [],
    holidays: [], holidayAttend: []
  };
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return ctx.createAtomAPI(M, {}).H;
}
const H = boot();
const check = (m, acc) => H.geoCheck(Object.assign({ acc }, away(m)));

console.log('\n1) the case in the photo: inside the school, 620 m out');
{
  // the reading the phone gave: a long way off, and unsure by a long way
  const r = check(620, 1500);
  eq('the fence still refuses it — the dot is not inside', r.ok, false);
  eq('...but it says WHY: the phone does not know where it is', r.reason, 'VAGUE_FIX');
  eq('...and hands back the number that says so', r.accuracy, 1500);
  ok_('...which the old message never showed — it printed the CAPPED slack', r.slack === 50 && r.accuracy > r.slack);
}
{
  // ...as against somebody who really is down the road, with a good fix
  const r = check(620, 12);
  eq('a trustworthy fix 620 m away is simply outside', [r.ok, r.reason], [false, 'TOO_FAR']);
  // against the distance the engine measured, not the one the fixture asked for — haversine rounds
  eq('...and says how far over, after every allowance', r.over, r.distance - 12 - 50);
}

console.log('\n2) the ordinary cases still behave');
{
  eq('standing at the gate with a good fix', check(20, 10).ok, true);
  eq('...at the fence, with the ±60 m fix a phone gives under a roof', check(95, 60).ok, true);
  eq('...and the slack is capped, so ±2 km never waves anybody through', check(3000, 2000).ok, false);
  eq('a phone that reports no accuracy at all gets the old strict rule', [check(80, 0).ok, check(80, 0).slack], [false, 0]);
  eq('no position at all is not "outside", it is "no fix"', H.geoCheck({}).reason, 'NO_FIX');
}
{
  const r = check(10, 8);
  eq('a good fix inside reports OK, not vague', [r.ok, r.reason, r.vague], [true, 'OK', false]);
  eq('...and the screen can print all four numbers', [typeof r.distance, r.radius, r.slack, r.accuracy], ['number', 50, 8, 8]);
}

console.log('\n3) the refusal now carries the phone\'s own accuracy');
{
  ok_('the engine puts it in the message', /ความแม่นยำที่เครื่องแจ้ง ±\$\{Math\.round\(a\)\} ม\./.test(eng));
  ok_('...and so does Apps Script, which is what runs live',
    /ความแม่นยำที่เครื่องแจ้ง ±' \+ Math\.round\(acc\) \+ ' ม\.'/.test(ci));
  ok_('...both name a hopeless fix for what it is', /โทรศัพท์อาจส่งตำแหน่งแบบคร่าวๆ/.test(eng) && /โทรศัพท์อาจส่งตำแหน่งแบบคร่าวๆ/.test(ci));
  ok_('...and both say "no accuracy reported" rather than nothing', /เครื่องไม่แจ้งความแม่นยำ/.test(eng) && /เครื่องไม่แจ้งความแม่นยำ/.test(ci));
}

console.log('\n4) the question can be asked without punching anything');
{
  ok_('there is a check', /geoCheck: p => geoCheck_/.test(eng));
  ok_('...it is a READ — it records nothing', /It changes nothing and records nothing/.test(eng));
  ok_('...and the mutation test agrees', !/^(submit|save|add|remove|delete|set|register|pay|upload|confirm|reject|issue|generate|move|import|compute|cancel|prepay|link|notify|request|mark|approve|edit|rename|update|change|seed|recompute|restore|bind|provision)/i.test('geoCheck')
    && !/check(in|out)/i.test('geoCheck'));
  ok_('a teacher can reach it before it matters', /onclick="GEO_check\(this\)"/.test(app));
  ok_('...and it opens itself when a punch is refused for range', /if\(code==='OUT_OF_RANGE'\) setTimeout\(\(\)=>GEO_check\(\)/.test(app));
  ok_('the app already asks for the best fix the phone can give',
    /enableHighAccuracy:true,timeout:10000,maximumAge:0/.test(app));
}

console.log('\n5) it says what to change, in the order that fixes it');
{
  ok_('precise location first — the one that looks fine and is a kilometre wrong', /ใช้ตำแหน่งที่แม่นยำ/.test(app));
  ok_('...Google location accuracy and Wi-Fi scanning', /ความแม่นยำของตำแหน่ง Google/.test(app) && /การสแกน Wi-Fi/.test(app));
  ok_('...battery saver, which quietly drops GPS for a network fix', /โหมดประหยัดแบตเตอรี่/.test(app));
  ok_('...and a real browser rather than one inside another app', /Chrome\/Safari/.test(app));
  ok_('a way through today, so nobody loses the day to a settings menu', /ขอลงเวลา/.test(app));
  ok_('it says plainly that the school\'s fence is not the problem', /ไม่ใช่รัศมีของโรงเรียน/.test(app));
}

console.log('\n6) THE RADIUS IS NOT TOUCHED (standing instruction since v239)');
{
  eq('the fixture\'s radius is what the fixture set', check(10, 5).radius, 50);
  ok_('nothing here writes GPS_Lat/GPS_Lng/Radius', !/geoCheck_[\s\S]{0,900}cfg\.Radius\s*=/.test(eng));
  ok_('...and the check is a pure function of what it was handed', /function geoCheck_\(lat,lng,acc\)\{/.test(eng));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
