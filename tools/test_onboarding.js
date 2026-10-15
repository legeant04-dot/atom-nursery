/**
 * tools/test_onboarding.js — PHASE 4.1: can a second school be brought up without inheriting the first?
 *   node tools/test_onboarding.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 THE BUG CLASS
 *
 * `setupAll` builds all 46 sheets and seeds all 80 config keys, so onboarding LOOKED solved. The
 * problem was never missing code — it was that the seed in Config.gs WAS Atom Nursery. A second
 * school brought up from it would have started life verifying its parents' bank transfers against
 * Atom's SlipOK account, on Atom's quota, with Atom's API key sitting in a sheet owned by another
 * company — and with its check-in fence centred on Atom's car park.
 *
 * Nothing would have thrown. Both schools would have looked fine until the quota ran out.
 *
 * Section 1 is the structural guard: EVERY seeded key must be classified by a person. A key added
 * next month with a value copied from live is exactly how this comes back, and it comes back
 * silently, so the only defence is that adding one without deciding fails the build.
 */
const path = require('path'), fs = require('fs');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                    'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                    'PaySlips', 'PayAdjust', 'Password', 'Certificate', 'Dspm', 'BillRun',
                    'Onboarding', 'Portability', 'GasEngine', 'Engine', 'Day6']);

/* A BRAND-NEW SCHOOL: setupAll and nothing else. This is literally what school #2 gets on day one,
 * which is the only fixture that can answer the question this suite exists for. */
const fresh = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var seeded = {};
  SCHOOL_CONFIG_DEFAULTS.forEach(function (r) { seeded[r[0]] = String(r[1] == null ? '' : r[1]); });
  return JSON.stringify({ check: handleOnboardingCheck({}), seeded: seeded,
    scope: ONBOARD_SCOPE_, atom: ONBOARD_ATOM_VALUES_ });
}));

console.log('\n1) 🔴 ทุกคีย์ที่ seed ไว้ ต้องมีคนตัดสินว่าเป็นของโรงเรียนหรือของกลาง');
{
  const seededKeys = Object.keys(fresh.seeded);
  const scoped = Object.keys(fresh.scope);
  eq('คีย์ที่ seed แล้วแต่ยังไม่ได้จัดประเภท', seededKeys.filter(k => !fresh.scope[k]), []);
  eq('...และไม่มีคีย์ที่จัดประเภทไว้แต่ไม่มีใน seed', scoped.filter(k => !(k in fresh.seeded)), []);
  ok_('มีคีย์มากกว่า 70 ตัว (ถ้าเหลือหยิบมือเดียว คือ parser พัง ไม่ใช่ seed ว่าง)', seededKeys.length > 70);
  const kinds = {};
  scoped.forEach(k => { kinds[fresh.scope[k]] = (kinds[fresh.scope[k]] || 0) + 1; });
  ok_('มีครบทั้ง 4 ประเภท', ['BLOCKER', 'REQUIRED', 'CONFIRM', 'UNIVERSAL'].every(x => kinds[x] > 0));
  console.log('         ' + JSON.stringify(kinds));
}

console.log('\n2) 🔴 โรงเรียนใหม่ต้องไม่ได้รับค่าของ Atom Nursery ติดมา');
{
  /* The assertion written as the CLAIM: no seeded value is one of Atom's. Listing the keys we
   * remembered to blank would pass on the day somebody adds an eleventh. */
  const leaked = Object.keys(fresh.atom).filter(k => fresh.seeded[k] === fresh.atom[k]
    && k !== 'GoogleClientId');
  eq('ค่าของ Atom ที่ยังติดอยู่ใน seed', leaked, []);
  ok_('🔴 SlipOK ไม่มีทั้ง url และ key ใน seed (เรื่องเงิน — ใช้บัญชีร่วมกันไม่ได้เด็ดขาด)',
    !fresh.seeded.SlipOK_Url && !fresh.seeded.SlipOK_ApiKey);
  ok_('🔴 พิกัด GPS ว่าง (ว่าง = ปฏิเสธทุกคน ซึ่งปลอดภัยกว่าการชี้ไปที่โรงเรียนอื่น)',
    !fresh.seeded.GPS_Lat && !fresh.seeded.GPS_Lng);
  ok_('ชื่อโรงเรียนและลิงก์ LINE/Facebook ว่าง',
    !fresh.seeded.SchoolName && !fresh.seeded.LineOAId && !fresh.seeded.Links_Facebook);
  /* 🔴 THE ONE THAT IS STILL THERE, ON PURPOSE AND WITH A NOTE. Atom's live SCHOOL_CONFIG has no
   * GoogleClientId row at all — sign-in-with-Google runs off this seed through
   * googleClientIdDefault_. Blanking it would switch Google login off for the school that is live
   * today. Pinned so it cannot be forgotten, and so removing it is a deliberate act. */
  ok_('🔴 GoogleClientId ยังอยู่ใน seed — และยังเป็นหนี้ที่ค้าง (ดูบันทึกใน Onboarding.gs)',
    fresh.seeded.GoogleClientId === fresh.atom.GoogleClientId);
  ok_('...และมีคำอธิบายว่าทำไมถึงยังลบไม่ได้',
    /ไม่มีแถว|NO GoogleClientId row/i.test(R('src/Onboarding.gs')) &&
    /googleClientIdDefault_/.test(R('src/Onboarding.gs')));
}

console.log('\n3) โรงเรียนที่เพิ่ง setup เสร็จ ต้องบอกได้ว่ายังขาดอะไร');
{
  const c = fresh.check;
  ok_('🔴 ยังไม่พร้อมเปิด (ถ้าตอบว่าพร้อม แปลว่ามันไม่ได้ตรวจอะไรเลย)', c.ready === false);
  ok_('มีรายการติดขัด', (c.blockers || []).length > 0);
  const bk = (c.blockers || []).map(x => x.key);
  ['GPS_Lat', 'SlipOK_ApiKey', 'LiffID', 'SchoolName'].forEach(k =>
    ok_('  ติดขัด: ' + k, bk.indexOf(k) >= 0));
  /* 🔴 NO ROW AT ALL vs AN EMPTY ROW — the distinction that found the GoogleClientId problem. A
   * missing row falls back to the CODE, so the school runs on a value it never chose and cannot
   * see; an empty row is a decision. They must not read the same. */
  const placeholders = (c.blockers || []).concat(c.required || [])
    .filter(x => /ตัวอย่าง/.test(x.why)).map(x => x.key);
  ok_('🔴 แยก "<FILL …>" ออกจาก "ว่าง" ได้ (ค่าตัวอย่างไม่ใช่ค่าว่าง และไม่ใช่ค่าจริง)',
    placeholders.indexOf('LiffID') >= 0 && placeholders.indexOf('QRCode') >= 0);
  ok_('ไม่มีคีย์ UNIVERSAL โผล่มาให้แอดมินต้องดู',
    (c.blockers || []).concat(c.required || [], c.confirm || [])
      .every(x => fresh.scope[x.key] !== 'UNIVERSAL'));
  // ...and the structural things no setting can create
  ok_('นับชั้นเรียน / แผนราคา / กลุ่มพนักงาน ให้ด้วย', c.counts && typeof c.counts.classes === 'number'
    && typeof c.counts.plans === 'number' && typeof c.counts.staffGroups === 'number');
}

console.log('\n4) 🔴 รายงานความพร้อม ต้องไม่เผยค่าของการตั้งค่าใดเลย');
{
  /* A readiness screen that prints the API key to prove it is set has published it to whoever is
   * standing behind the admin. Asserted against the WHOLE reply, not against the fields we chose. */
  const whole = JSON.stringify(fresh.check);
  const seeds = fresh.seeded;
  const leaked = Object.keys(seeds).filter(k => {
    const v = String(seeds[k] || '');
    return v.length >= 8 && !/^<FILL/.test(v) && whole.indexOf(v) >= 0;
  });
  eq('ค่าที่หลุดเข้าไปในคำตอบ', leaked, []);
  ok_('...แต่ยังบอกชื่อโรงเรียนได้ (เป็นสิ่งที่แอดมินต้องเห็นเพื่อรู้ว่ากำลังดูโรงเรียนไหน)',
    'school' in fresh.check);
}

console.log('\n5) เส้นทางนี้เป็นการอ่าน เป็นของแอดมิน และเข้าถึงได้จริง');
{
  const code = R('src/Code.gs'), app = R('webapp/app.js');
  ok_('onboardingCheck อยู่ในรายการ admin-only', /onboardingCheck:\s*1/.test(code));
  ok_('มี route', /onboardingCheck:\s*function/.test(code));
  /* 🔴 REACHABLE. The ☀️ summer button and the whole-school backup both shipped behind no caller and
   * behind a menu nobody would open — twice in a fortnight. A feature with no way in is not shipped. */
  ok_('🔴 มีปุ่มเรียกจริงในหน้าเครื่องมือตรวจสอบ',
    /A_onboardCheck\(this\)/.test(app) && /window\.A_onboardCheck\s*=/.test(app));
  ok_('...และเป็นการอ่าน (ไม่เข้า MUTATING_RE จึงไม่ไปรอคิว write lock)',
    !/^(submit|save|add|remove|delete|set|register|pay|upload|confirm|reject|issue|generate|move|import|compute|cancel|prepay|link|notify|request|mark|approve|edit|rename|update|change|seed|recompute|restore|bind|provision)/i.test('onboardingCheck'));
  ok_('มีคู่มือขั้นตอนที่ต้องทำบนเว็บ', fs.existsSync(path.join(__dirname, '..', 'docs/ONBOARDING.md')));
}

console.log('\n6) 🔴 setupAll ต้องไม่ทับค่าที่โรงเรียนตั้งไว้แล้ว');
{
  /* The whole seed change above is only safe because of this. If setupAll overwrote, blanking the
   * seed would have wiped the live school's GPS and SlipOK key the next time anyone ran setup. */
  const after = JSON.parse(run(function () {
    _configCache = null; setupAll(); _configCache = null;
    setConfigValue_('GPS_Lat', '7.000001');
    setConfigValue_('SlipOK_ApiKey', 'SLIPOKMYOWNKEY');
    setConfigValue_('SchoolName', 'โรงเรียนที่สอง');
    _configCache = null;
    setupAll();                                    // run it again, the way a re-deploy would
    _configCache = null;
    try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}
    return JSON.stringify({ lat: getConfig_('GPS_Lat', ''), key: getConfig_('SlipOK_ApiKey', ''),
      name: getConfig_('SchoolName', ''), ready: handleOnboardingCheck({}).ready });
  }));
  eq('พิกัดที่ตั้งเองยังอยู่', after.lat, '7.000001');
  eq('คีย์ SlipOK ที่ตั้งเองยังอยู่', after.key, 'SLIPOKMYOWNKEY');
  eq('ชื่อโรงเรียนที่ตั้งเองยังอยู่', after.name, 'โรงเรียนที่สอง');
  ok_('...และยังไม่พร้อมอยู่ดี เพราะยังเหลือค่าอื่น (LIFF ฯลฯ)', after.ready === false);
}

console.log('\n6b) 🔴 ห้ามบอกโรงเรียนเจ้าของค่า ว่าค่าของตัวเองเป็นของคนอื่น');
{
  /* 🔴 THE FALSE POSITIVE FROM THE FIRST RUN ON THE REAL SCHOOL (2026-10-15).
   *
   * The inherited-value net was written for the copy-the-workbook case and walked straight into the
   * obvious thing: Atom Nursery is itself a school using this app. Its LineOAId IS '@atomnursery'.
   * The first live run put Links_LINE, LineOAId and Links_Facebook in red and told the school to
   * change its own LINE account — three false alarms out of four findings, with the one real finding
   * sitting among them.
   *
   * A report that cries wolf stops being read, and the next time it is right nobody looks. Both
   * directions are asserted here: the origin school is left alone, AND a copy that was renamed is
   * still caught, or the fix would have been to simply switch the net off. */
  const two = JSON.parse(run(function () {
    _configCache = null; setupAll(); _configCache = null;
    function check(name) {
      setConfigValue_('SchoolName', name);
      setConfigValue_('LineOAId', '@atomnursery');
      setConfigValue_('Links_LINE', 'https://line.me/R/ti/p/@atomnursery');
      _configCache = null;
      try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}
      var r = handleOnboardingCheck({});
      var flagged = (r.blockers || []).concat(r.required || [], r.confirm || [])
        .filter(function (x) { return /ค่าของ Atom/.test(x.why); })
        .map(function (x) { return x.key; }).sort();
      return flagged;
    }
    return JSON.stringify({ origin: check('Atom Nursery'), copy: check('โรงเรียนอนุบาลแห่งที่สอง') });
  }));
  eq('🔴 โรงเรียนเจ้าของค่า — ไม่มีรายการ "ยังเป็นค่าของ Atom" เลย', two.origin, []);
  /* GoogleClientId is in that list too, and correctly so: it is the one Atom value still in the
   * seed (it cannot be blanked yet — see section 2), so a second school really would be carrying
   * Atom's OAuth client and really should be told. */
  eq('...แต่ชีตที่ถูกคัดลอกแล้วเปลี่ยนชื่อ ยังโดนจับเหมือนเดิม',
    two.copy, ['GoogleClientId', 'LineOAId', 'Links_LINE']);
}

console.log('\n6c) 🧩 เพิ่มแถวที่ขาด — ต้องเพิ่มอย่างเดียว ห้ามแตะแถวที่มีอยู่');
{
  const bf = JSON.parse(run(function () {
    _configCache = null; setupAll(); _configCache = null;
    var sh = getMainSpreadsheet_().getSheetByName('SCHOOL_CONFIG');
    // a school that is missing a row entirely, and one whose row holds a value it chose itself
    var rows = readObjects_(sh);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].Key) === 'GoogleClientId') { sh.deleteRow(rows[i]._row); break; }
    }
    setConfigValue_('OTRatePerHour', '175');     // the school's own figure, not the seed's 100
    setConfigValue_('SchoolName', '');            // an EMPTY row — a decision, not an absence
    _configCache = null;
    try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}
    var pv = handleBackfillConfig({ preview: true });
    var before = readObjects_(sh).length;
    var done = handleBackfillConfig({ preview: false, adminId: 'ADM' });
    _configCache = null;
    try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}
    var again = handleBackfillConfig({ preview: true });
    return JSON.stringify({ pv: pv, done: done, before: before,
      after: readObjects_(sh).length, again: again.count,
      ot: getConfig_('OTRatePerHour', ''), name: getConfig_('SchoolName', 'FELLTHROUGH'),
      google: getConfig_('GoogleClientId', '') });
  }));
  eq('ดูก่อนว่าจะเพิ่มอะไร — เจอคีย์ที่หายไป', bf.pv.wouldAdd, ['GoogleClientId']);
  ok_('🔴 ดูอย่างเดียวต้องไม่เขียนอะไร (เพิ่มจริงตอน preview:false เท่านั้น)', bf.pv.preview === true);
  eq('เพิ่มแล้ว 1 แถว', bf.done.count, 1);
  eq('จำนวนแถวเพิ่มขึ้น 1', bf.after - bf.before, 1);
  // compared as text: getConfig_ hands back whatever the cell holds, and '175' vs 175 is the
  // reader's type, not the answer
  eq('🔴 ค่าที่โรงเรียนตั้งเอง ไม่ถูกเขียนทับ', String(bf.ot), '175');
  /* 🔴 AN EMPTY ROW IS A DECISION. getConfig_ hands back the default for a blank cell, so this
   * reads as the fallback — the point is that the ROW was not re-added and not overwritten, which
   * `again === 0` proves. Re-adding it would turn "I cleared this on purpose" into "here is the
   * seed value again", silently. */
  eq('🔴 รันซ้ำแล้วไม่เพิ่มอะไรอีก (รวมถึงแถวที่ตั้งใจเว้นว่าง)', bf.again, 0);
  ok_('...และคีย์ที่หายไป กลับมามีค่าใช้งานได้', String(bf.google || '').indexOf('.apps.googleusercontent.com') > 0);
}

console.log('\n7) 🔴 รั้วที่ยังไม่ได้ตั้งจุดศูนย์กลาง ต้องปฏิเสธ ไม่ใช่ปล่อยผ่าน');
{
  /* 🔴 THE BUG BLANKING THE SEED EXPOSED — and it was there all along, hidden.
   *
   * With GPS_Lat/GPS_Lng unset, parseFloat('') is NaN, the distance is NaN, and `NaN > radius` is
   * FALSE. So the geofence did not refuse. It stopped guarding, silently: every staff member could
   * clock in from home and the row would look completely normal. It had simply never been reachable,
   * because the seed carried Atom's own coordinates and so the value was never actually absent.
   *
   * Asserted on BOTH halves. The .gs route is what the school runs today; the engine is what runs
   * after the cutover, and a refusal the two halves disagree about is the Phase 2.6 shape. */
  const g = JSON.parse(run(function () {
    _configCache = null; setupAll(); _configCache = null;
    try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}
    var out = {};
    // ── the Sheets route, with the school's address never set ──
    try { assertWithinGeofence_(13.792472, 100.646389, 10); out.routeBlank = 'ALLOWED'; }
    catch (e) { out.routeBlank = (e && e.apiCode) || 'ERR'; }
    // ── the engine half, same question ──
    function engineGeo(latCfg, lngCfg) {
      setConfigValue_('GPS_Lat', latCfg); setConfigValue_('GPS_Lng', lngCfg);
      _configCache = null;
      try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}
      var ctx = hydrateLazy_(['staff', 'students']);
      var H = createAtomAPI(ctx.M, null).H;
      try { H.geoCheckOnly ? H.geoCheckOnly({}) : null; } catch (e) {}
      // staffCheckin is the real door the fence sits behind
      try { H.staffCheckin({ staffId: 'NOBODY', lat: 13.792472, lng: 100.646389, accuracy: 10 }); return 'ALLOWED'; }
      catch (e) { return (e && e.apiCode) || 'ERR'; }
    }
    out.engineBlank = engineGeo('', '');
    /* ...and once the school HAS set an address, the fence must be back to judging distance — a
     * guard that refuses everything is not a fix, it is the same outage in the other direction. */
    setConfigValue_('GPS_Lat', '13.792472'); setConfigValue_('GPS_Lng', '100.646389');
    _configCache = null;
    try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}
    try { assertWithinGeofence_(13.792472, 100.646389, 10); out.routeSet = 'ALLOWED'; }
    catch (e) { out.routeSet = (e && e.apiCode) || 'ERR'; }
    try { assertWithinGeofence_(13.9, 100.9, 10); out.routeFar = 'ALLOWED'; }
    catch (e) { out.routeFar = (e && e.apiCode) || 'ERR'; }
    return JSON.stringify(out);
  }));
  eq('🔴 ยังไม่ตั้งพิกัด → ฝั่ง Sheets ปฏิเสธ (เดิมปล่อยผ่านเงียบๆ)', g.routeBlank, 'NO_SCHOOL_GPS');
  ok_('🔴 ...ฝั่ง engine ก็ปฏิเสธด้วยเหตุผลเดียวกัน', g.engineBlank === 'NO_SCHOOL_GPS');
  eq('ตั้งพิกัดแล้ว ยืนอยู่ที่โรงเรียน → ผ่าน', g.routeSet, 'ALLOWED');
  eq('...และยืนอยู่ไกล → ยังถูกปฏิเสธเหมือนเดิม', g.routeFar, 'OUT_OF_RANGE');
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
