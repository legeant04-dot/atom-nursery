/**
 * tools/test_settings_split.js — one settings dialog became five, and one save became one request.
 *   node tools/test_settings_split.js
 *
 * Asked 2026-10-07: "แก้ไขชื่อเป็น 'ตั้งค่าระบบ' เพราะในเมนูนี้มีหลายเรื่องมากกว่าค่าเบี้ยและวันลา …
 * ลองประเมินเพิ่มเติมว่ามีฟังก์ชันไหนควรแยกออกมาเป็นเมนูของตัวเอง เพื่อลดภาระการโหลดข้อมูล".
 *
 * 🔴 THE SPLIT IS THE SMALL HALF. Opening the old dialog cost one round trip whatever you came for;
 * SAVING it cost eight, awaited one after another — setSchoolConfig, four setConfigVal, then one
 * setLeaveQuota PER LEAVE TYPE. On the v421 measurement every one of those is a 2.7-to-30-second
 * draw, so pressing บันทึก could take a minute and took the server's write lock eight times.
 *
 * And splitting a form whose save read `m.querySelector('#cfgLat').value` WITHOUT A GUARD would have
 * thrown the moment anybody opened ตั้งค่าวันลา and pressed save — a settings screen that cannot
 * save, shipped to a live school. §1 is that, run rather than read.
 */
const path = require('path'), fs = require('fs'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), i18n = R('webapp/i18n.js');
const appCode = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* THE REAL SAVE FUNCTION, lifted out and run against a fake dialog. Every assertion below about
 * which calls it makes, and how many requests those become, is measured.
 *
 * Cut from the RAW source and ended at the function's own last line: the comment-stripped copy has
 * no `// ----` markers left to aim at, and a slice that overruns drags half the admin screen in. */
const SAVE_FROM = app.indexOf('window.A_saveSettings=async(btn)=>{');
const SAVE_END  = app.indexOf('catch(e){ err(e); btn.disabled=false; } };', SAVE_FROM);
const SAVE_SRC  = app.slice(SAVE_FROM, SAVE_END + 'catch(e){ err(e); btn.disabled=false; } };'.length);
if (SAVE_FROM < 0 || SAVE_END < 0) throw new Error('A_saveSettings not found in app.js');

function runSave(fields) {
  const src = SAVE_SRC;
  const calls = [];
  // one "request" per TICK, which is exactly what api.js's micro-batch does
  let tick = 0, ticks = [];
  const api = (action, payload) => { calls.push({ action, payload });
    if (ticks[tick] === undefined) ticks[tick] = 0; ticks[tick]++; return Promise.resolve({ ok: true }); };
  const el = (id) => {
    if (!(id in fields)) return null;
    const v = fields[id];
    return (typeof v === 'boolean') ? { checked: v } : { value: String(v) };
  };
  const modal = {
    querySelector: sel => el(sel.replace('#', '')),
    querySelectorAll: () => Object.keys(fields).filter(k => k.indexOf('lq_') === 0)
      .map(k => ({ id: k, value: String(fields[k]) })),
    remove: () => { modal.removed = true; }
  };
  const ctx = { window: {}, api, Promise, Object, Math, String, Number, parseFloat, isNaN,
                confirmSaved: () => {}, err: e => { ctx.thrown = e; }, t: () => 'saved' };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const btn = { closest: () => modal, disabled: false };
  const p = ctx.window.A_saveSettings(btn);
  // everything issued synchronously before the first await is ONE batch
  const firstTickCalls = calls.length;
  return p.then(() => ({ calls, firstTickCalls, removed: !!modal.removed, thrown: ctx.thrown }));
}

(async () => {

// ============================================================================
console.log('\n1) 🔴 every field is optional — five forms share one save');
{
  // ตั้งค่าวันลา: ONLY the quota boxes exist. The old save read #cfgLat.value unguarded.
  const r = await runSave({ lq_ลาป่วย: 30, lq_ลากิจ: 6, lq_ลาพักร้อน: 6 });
  ok_('🔴 a leave-only form saves without throwing', !r.thrown);
  eq('🔴 ...and writes ONLY the quotas', r.calls.map(c => c.action).sort(),
    ['setLeaveQuota', 'setLeaveQuota', 'setLeaveQuota']);
  eq('...with the type taken off the id', r.calls.map(c => c.payload.type).sort(),
    ['ลากิจ', 'ลาป่วย', 'ลาพักร้อน']);
  ok_('...and the dialog closes', r.removed);
}
{
  // 🔔 notifications only: five checkboxes, nothing else
  const r = await runSave({ setAdminLine: true, setStaffLine: false, setParentLine: true,
                            setDigM: true, setDigE: false });
  eq('🔴 a notifications-only form writes one call', r.calls.map(c => c.action), ['setSchoolConfig']);
  eq('🔴 ...carrying exactly those five keys, as strings', r.calls[0].payload.values,
    { AdminLineNotify: 'true', StaffLineNotify: 'false', ParentLineNotify: 'true',
      DigestMorning: 'true', DigestEvening: 'false' });
  ok_('🔴 ...and NOT the geofence it never drew', !('GPS_Lat' in r.calls[0].payload.values));
}
{
  // ⚙️ system only: geofence + cache
  const r = await runSave({ cfgLat: 13.79, cfgLng: 100.64, cfgRadius: 30, cfgSlack: 0, setTtl: 900 });
  const gv = r.calls.find(c => c.action === 'setSchoolConfig').payload.values;
  eq('the geofence is written', [gv.GPS_Lat, gv.GPS_Lng, gv.Radius], [13.79, 100.64, 30]);
  /* 🔴 0 IS A REAL CHOICE — "judge by the dot alone, strict". A falsiness test would drop it and
   * silently leave the school on whatever was there before. */
  eq('🔴 a tolerance of 0 survives the save', gv.GpsAccuracySlack, 0);
  eq('...and the cache goes through setConfigVal', (r.calls.find(c => c.action === 'setConfigVal') || {}).payload,
    { key: 'CacheTTL', value: 900 });
  ok_('🔴 ...and no leave quota is touched', !r.calls.some(c => c.action === 'setLeaveQuota'));
  /* CONTROL — THE RADIUS IS CARRIED, NOT INVENTED. The school's 30 m fence is a standing decision;
   * this suite would catch a refactor that quietly defaulted it. */
  eq('CONTROL · the radius saved is the one on the form', gv.Radius, 30);
}
{
  // 💰 money only
  const r = await runSave({ setAtt: 500, setFb: 500, setOtRate: 100, setMatch: 1 });
  eq('the four money keys, and nothing else',
    r.calls.map(c => c.payload.key).sort(),
    ['ContributionMatchRate', 'DiligenceAttendanceAmount', 'DiligenceFacebookAmount', 'StaffOTHourlyRate']);
  ok_('...no setSchoolConfig, because this form has no checkbox and no geofence',
    !r.calls.some(c => c.action === 'setSchoolConfig'));
}
{
  // a form with nothing on it writes nothing at all, rather than an empty setSchoolConfig
  const r = await runSave({});
  eq('🔴 a form with no fields sends no request', r.calls.length, 0);
  ok_('...and still closes', r.removed);
}

// ============================================================================
console.log('\n2) 🔴 the whole save is ONE request');
{
  /* The shape the old code had: eight writes, each awaited. Here every call must be issued before
   * the first await — which is what api.js folds into a single batch. Counted, not asserted about. */
  const r = await runSave({ cfgLat: 13.79, cfgLng: 100.64, cfgRadius: 30, cfgSlack: 50,
                            setAdminLine: true, setStaffLine: false, setParentLine: true,
                            setDigM: true, setDigE: true,
                            setAtt: 500, setFb: 500, setOtRate: 100, setMatch: 1, setTtl: 900,
                            lq_ลาป่วย: 30, lq_ลากิจ: 6, lq_ลาพักร้อน: 6 });
  /* Nine: one setSchoolConfig (geofence + five checkboxes), five setConfigVal (two allowances, the
   * OT rate, the fund match, the cache) and one setLeaveQuota per leave type. */
  eq('the old dialog’s whole content is nine writes', r.calls.length, 9);
  eq('🔴 ...and every one of them is issued in the SAME tick', r.firstTickCalls, r.calls.length);
  ok_('...which is ONE request where it used to be nine', r.firstTickCalls === 9);
  /* 🔴 THE THING THAT SILENTLY UNDOES IT. One stray `await` between the calls splits the batch, and
   * on this backend the cost is not "a bit slower" — it is another 2.7-to-30-second draw. */
  const body = appCode.slice(appCode.indexOf('const jobs=[];'), appCode.indexOf('if(!jobs.length)'));
  ok_('🔴 nothing awaits while the calls are being issued', !/\bawait\b/.test(body));
  ok_('...and they are awaited together', /await Promise\.all\(jobs\)/.test(appCode));
}
{
  /* 🔴 A SAVE THAT FAILED MUST SAY SO. There was no catch at all: a failed save left the dialog open
   * with no message, which looks exactly like one that worked — the shape of the น้องโมน่า report. */
  const src = SAVE_SRC;
  ok_('🔴 a failure is caught and shown', /catch\(e\)\{ err\(e\); btn\.disabled=false; \}/.test(src));
  ok_('...and the dialog is NOT closed on failure', src.indexOf('m.remove(); confirmSaved') < src.indexOf('catch(e)'));
  ok_('...and the button is re-enabled so it can be tried again', /btn\.disabled=false/.test(src));
}

// ============================================================================
console.log('\n3) five dialogs, each loading only its own data');
{
  /* Each dialog cut at the START OF THE NEXT ONE, not at a guessed character count: a fixed 400-char
   * window ran past A_setLeave into A_setNotify, so "ตั้งค่าวันลา does not read schoolConfig" failed
   * on the NEXT function's fetch. A slice that overruns tests the wrong code and says nothing. */
  const dlg = n => { const i = appCode.indexOf('window.' + n + '=');
    if (i < 0) return '';
    const j = appCode.indexOf('\n  window.', i + 10);
    return appCode.slice(i, j < 0 ? i + 600 : j); };
  eq('each dialog slice stops at the next one', ['A_settings','A_setMoney','A_setLeave','A_setNotify','A_setTools']
    .filter(n => dlg(n).indexOf('window.', 10) >= 0), []);
  ok_('🔴 ตั้งค่าวันลา reads the quota and nothing else',
    /A_setLeave=async\(\)=>\{ const q=await api\('getLeaveQuota'\);/.test(appCode) &&
    !/schoolConfig/.test(dlg('A_setLeave')));
  ok_('🔴 ตั้งค่าการแจ้งเตือน reads the config and nothing else',
    /A_setNotify=async\(\)=>\{ const sc=await api\('schoolConfig'\);/.test(appCode) &&
    !/getLeaveQuota/.test(dlg('A_setNotify')));
  ok_('🔴 เครื่องมือตรวจสอบ fetches nothing until a button is pressed',
    /window\.A_setTools=\(\)=>\{/.test(appCode) && !/await api\(/.test(dlg('A_setTools')));
  ok_('⚙️ ตั้งค่าระบบ no longer loads the leave quota it never showed',
    !/getLeaveQuota/.test(dlg('A_settings')));

  /* ONE DEFINITION PER FIELD. A_saveSettings finds its inputs by id, so the same id appearing in two
   * fragments is a setting that saves from one screen and not the other. */
  ['cfgLat', 'setTtl', 'setAtt', 'setParentLine', 'setDigM'].forEach(id =>
    eq('id "' + id + '" exists exactly once', (appCode.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1));
}

// ============================================================================
console.log('\n4) the name, and the way in');
{
  ok_('🔴 it is called ตั้งค่าระบบ now, not ตั้งค่าเบี้ย/วันลา',
    /'manage\.settings':\['ตั้งค่าระบบ','System settings'\]/.test(i18n));
  ok_('...and the old name is gone', !/ตั้งค่าเบี้ย\/วันลา/.test(i18n));
  ['A_setNotify()', 'A_setMoney()', 'A_setLeave()', 'A_setTools()'].forEach(fn =>
    ok_('the menu has a door to ' + fn, appCode.indexOf("'" + fn + "'") > 0));
  /* The dashboard's leave-reset reminder used to open the whole dialog; it now opens the one screen
   * it is about. A reminder that lands somewhere you then have to scroll is half a reminder. */
  ok_('🔴 the leave-reset reminder goes straight to the leave settings',
    /admin\.leaveReset[\s\S]{0,160}onclick="A_setLeave\(\)"/.test(app));
  // two identical icons in one grid is a menu nobody can scan
  const grid = appCode.slice(appCode.indexOf("t:EN()?'⚙️ Settings & tools'"), appCode.indexOf("t:EN()?'⚙️ Settings & tools'") + 900);
  const icons = (grid.match(/\['([^']*)',/g) || []).map(s => s.slice(2, -2));
  eq('every icon in the group is distinct', icons.length - new Set(icons).size, 0);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
