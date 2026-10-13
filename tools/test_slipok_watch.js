/**
 * tools/test_slipok_watch.js — the SlipOK package, and noticing before it stops.
 *   node tools/test_slipok_watch.js
 *
 * Asked 2026-10-13: "ระบบสามารถต่ออายุ SlipOK เองได้ไหม หรือมีการแจ้งเตือนทุกวันที่ 7 ของทุกเดือน
 * ให้ทำการต่ออายุได้ไหม?"
 *
 * Renewing is not automated and never will be — it spends the school's money. The warning is, and
 * it is driven by SlipOK's own endDate rather than a day of the month.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 WHAT THIS IS GUARDING
 *
 * §1  it SPEAKS when something is running out — days, or slips, or the service already refusing
 * §2  it is SILENT otherwise. A monthly notice that arrives whether or not anything is wrong is a
 *     notice nobody reads, and the one month it matters it is skimmed past with the other eleven
 * §3  the three ways it can already be broken say DIFFERENT things, because they need different
 *     actions — a wrong branch id, a wrong key and an unpaid package are not one problem
 * §4  the warning reaches the admin's 🔔 bell and does NOT push LINE (the school's instruction:
 *     "แจ้งเตือน Admin ส่งทาง Notification App")
 * §5  ...and it is not gated behind the notification topic switches, which are all OFF — hiding an
 *     alarm about the school's money behind a switch nobody has ticked is how the thing it warns
 *     about goes unnoticed
 * §6  the probe is ONE function, shared with the diagnostics screen: two copies of a question about
 *     money is two chances to answer it differently
 */
const path = require('path'), fs = require('fs');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '\n         got =' + JSON.stringify(got) + '\n         want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const slips = R('src/PaySlips.gs'), trig = R('src/Triggers.gs'), app = R('webapp/app.js');

const TODAY = '2026-10-13';

// ============================================================================
console.log('\n1) 🟡 พูดเมื่อของกำลังจะหมด');
{
  const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Notify', 'Checkin', 'PaySlips', 'Setup', 'Dspm_Seed']);
  const got = JSON.parse(run(function () {
    _configCache = null; setupAll(); _configCache = null;   // dateStr_ asks the school's own clock
    var now = new Date('2026-10-13T09:00:00');
    var live = function (o) { var b = { checked: true, alive: true, quota: 500, endDate: '' }; for (var k in o) b[k] = o[k]; return b; };
    return JSON.stringify({
      // the warning window opens at 14 days and gets louder inside 7
      d20: slipOkWarning_(live({ endDate: '2026-11-02' }), now),
      d14: slipOkWarning_(live({ endDate: '2026-10-27' }), now),
      d7: slipOkWarning_(live({ endDate: '2026-10-20' }), now),
      d1: slipOkWarning_(live({ endDate: '2026-10-14' }), now),
      d0: slipOkWarning_(live({ endDate: '2026-10-13' }), now),
      lowQuota: slipOkWarning_(live({ endDate: '2027-01-01', quota: 50 }), now),
      okQuota: slipOkWarning_(live({ endDate: '2027-01-01', quota: 51 }), now),
      both: slipOkWarning_(live({ endDate: '2026-10-16', quota: 3 }), now),
      // SlipOK gave us no end date we can read — say nothing about days rather than guess
      noDate: slipOkWarning_(live({ endDate: '', quota: 500 }), now),
      junkDate: slipOkWarning_(live({ endDate: 'ไม่ระบุ', quota: 500 }), now),
      days20: slipOkDaysLeft_('2026-11-02', now),
      days0: slipOkDaysLeft_('2026-10-13', now),
      daysPast: slipOkDaysLeft_('2026-10-10', now),
      daysNull: slipOkDaysLeft_('', now)
    });
  }));
  ok_('🟡 เหลือ 14 วัน → เตือน', /14 วัน/.test(got.d14));
  ok_('🟠 เหลือ 7 วัน → เตือนแรงขึ้น', got.d7.indexOf('🟠') >= 0);
  ok_('...และ 14 วันยังเป็นสีอ่อน', got.d14.indexOf('🟡') >= 0 && got.d14.indexOf('🟠') < 0);
  ok_('เหลือ 1 วัน → เตือน', /1 วัน/.test(got.d1));
  ok_('หมดอายุวันนี้ → เตือน (0 วัน ไม่ใช่ -0.x)', /0 วัน/.test(got.d0));
  ok_('🟡 โควตาเหลือน้อย → เตือน แม้วันยังเหลือเยอะ', /โควตา.*50 ใบ/.test(got.lowQuota));
  ok_('🔴 ของสองอย่างหมดพร้อมกัน → บอกทั้งสองอย่าง', /วัน/.test(got.both) && /โควตา/.test(got.both));
  /* ...and the figure it prints is the one the admin has to act on. A warning that says "soon" is a
   * warning that gets postponed; a warning that says "3 วัน" is a date in the diary. */
  ok_('ข้อความมีวันหมดอายุจริงอยู่ในนั้น', got.d7.indexOf('2026-10-20') >= 0);
  eq('นับวันถูก (20 วัน)', got.days20, 20);
  eq('...และวันนี้คือ 0', got.days0, 0);
  eq('...และเลยมาแล้วติดลบ', got.daysPast, -3);
  eq('ไม่มีวันหมดอายุ → null ไม่ใช่ 0', got.daysNull, null);
  ok_('🔴 ไม่มีวันหมดอายุ → ไม่พูดเรื่องวัน (ไม่เดา)', got.noDate === '' && got.junkDate === '');
}

// ============================================================================
console.log('\n2) 🔇 เงียบเมื่อไม่มีอะไรต้องบอก');
{
  const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Notify', 'Checkin', 'PaySlips', 'Setup', 'Dspm_Seed']);
  const got = JSON.parse(run(function () {
    _configCache = null; setupAll(); _configCache = null;   // dateStr_ asks the school's own clock
    var now = new Date('2026-10-13T09:00:00');
    return JSON.stringify({
      healthy: slipOkWarning_({ checked: true, alive: true, quota: 5000, endDate: '2027-06-30' }, now),
      // not configured at all — this school does not use SlipOK, and nagging it would be absurd
      unset: slipOkWarning_({ checked: false }, now),
      d15: slipOkWarning_({ checked: true, alive: true, quota: 5000, endDate: '2026-10-28' }, now)
    });
  }));
  eq('🔴 ทุกอย่างปกติ → ไม่เตือนเลย', got.healthy, '');
  eq('ยังไม่ได้ตั้งค่า SlipOK → ไม่เตือน', got.unset, '');
  eq('เหลือ 15 วัน (ยังไม่ถึงหน้าต่างเตือน) → เงียบ', got.d15, '');
}

// ============================================================================
console.log('\n3) 🔴 พังคนละแบบ ต้องบอกคนละอย่าง');
{
  const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Notify', 'Checkin', 'PaySlips', 'Setup', 'Dspm_Seed']);
  const got = JSON.parse(run(function () {
    _configCache = null; setupAll(); _configCache = null;   // dateStr_ asks the school's own clock
    var now = new Date('2026-10-13T09:00:00');
    var base = { checked: true, alive: false, quota: null, endDate: '' };
    var w = function (o) { var b = {}; for (var k in base) b[k] = base[k]; for (var j in o) b[j] = o[j]; return b; };
    return JSON.stringify({
      branch: slipOkWarning_(w({ badBranch: true }), now),
      key: slipOkWarning_(w({ badKey: true }), now),
      expired: slipOkWarning_(w({ expired: true }), now),
      down: slipOkWarning_(w({ message: 'ติดต่อ SlipOK ไม่ได้: timeout' }), now)
    });
  }));
  /* The point of separating these is that they are four different errands. Told as one "SlipOK has
   * a problem" the admin goes to the dashboard, renews a package that had not expired, and the
   * slips keep failing because the branch id was wrong all along. */
  ok_('รหัสสาขาผิด → บอกให้ไปแก้รหัสสาขา', /สาขา/.test(got.branch) && !/ต่ออายุ/.test(got.branch));
  ok_('API Key ผิด → บอกให้ไปแก้ Key', /Key/.test(got.key) && !/ต่ออายุ/.test(got.key));
  ok_('แพ็กเกจหมดอายุ → บอกให้ไปต่ออายุ', /ต่ออายุ/.test(got.expired));
  ok_('ติดต่อไม่ได้ → บอกว่าติดต่อไม่ได้ ไม่ใช่ว่าหมดอายุ', /ติดต่อ/.test(got.down) && !/หมดอายุ/.test(got.down));
  ok_('ทั้งสี่แบบข้อความไม่ซ้ำกัน',
    new Set([got.branch, got.key, got.expired, got.down]).size === 4);
}

// ============================================================================
console.log('\n4) 🔔 ถึงกระดิ่งแอดมิน · 💬 ไม่ส่ง LINE');
{
  const h = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Notify', 'Checkin', 'PaySlips', 'Setup', 'Dspm_Seed']);
  const got = JSON.parse(h.run(function () {
    _configCache = null; setupAll(); _configCache = null;
    setConfigValue_('SlipOK_Url', 'https://api.slipok.com/api/line/apikey/12345');
    setConfigValue_('SlipOK_ApiKey', 'SLIPOKTESTKEY');
    _configCache = null;
    // SlipOK answers: alive, but the package ends in three days
    UrlFetchApp.fetch = function () {
      return { getResponseCode: function () { return 200; },
        getContentText: function () {
          return JSON.stringify({ success: true, data: { quota: 900, overQuota: 0, endDate: '2026-10-16' } });
        } };
    };
    var r = slipOkExpiryCheck_();
    var sh = getMainSpreadsheet_().getSheetByName('ADMIN_INBOX');
    var rows = sh ? readObjects_(sh) : [];
    return JSON.stringify({ r: r, rows: rows.map(function (x) {
      return { cat: String(x.Category || ''), staff: String(x.StaffID || ''), stu: String(x.StudentID || ''), text: String(x.Text || '') };
    }), pushes: PUSH.length });
  }));
  ok_('เตือนแล้ว', got.r.warned === true);
  eq('🔔 เขียนลงกระดิ่ง 1 แถว', got.rows.length, 1);
  /* StaffID blank = the SHARED admin tray (inboxItems_(''), handleAdminInbox) — every admin sees it,
   * which is right for a notice about the school's own plumbing. StudentID blank too: if it were
   * set, inboxItems_ would read it as a FAMILY row and the parents of some child would be told the
   * school's SlipOK package is expiring. */
  // read defensively, so a regression REPORTS rather than throwing and hiding the LINE check below
  const row = got.rows[0] || {};
  eq('🔴 ส่งถึงแอดมินทุกคน (StaffID ว่าง) และไม่ใช่ของครอบครัวใคร (StudentID ว่าง)',
    [row.staff, row.stu], ['', '']);
  eq('หมวด system', row.cat, 'system');
  ok_('ข้อความบอกว่าเหลือ 3 วัน', /3 วัน/.test(row.text || ''));
  eq('🔴 ไม่ส่ง LINE สักข้อความ (ตามที่โรงเรียนสั่ง)', got.pushes, 0);
}

// ============================================================================
console.log('\n5) 🔴 ไม่ถูกปิดปากโดยสวิตช์แจ้งเตือนที่ยังปิดอยู่ทั้ง 15 ข้อ');
{
  const h = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Notify', 'Checkin', 'PaySlips', 'Setup', 'Dspm_Seed']);
  const got = JSON.parse(h.run(function () {
    _configCache = null; setupAll(); _configCache = null;
    setConfigValue_('SlipOK_Url', 'https://api.slipok.com/api/line/apikey/12345');
    setConfigValue_('SlipOK_ApiKey', 'SLIPOKTESTKEY');
    // EVERY topic explicitly off — the live state of the school today
    ['NotifyAdminApproval', 'NotifyStaffApproval', 'NotifyStaffApprovalQueue'].forEach(function (k) { setConfigValue_(k, 'false'); });
    _configCache = null;
    UrlFetchApp.fetch = function () {
      return { getResponseCode: function () { return 200; },
        getContentText: function () { return JSON.stringify({ success: true, data: { quota: 900, endDate: '2026-10-15' } }); } };
    };
    slipOkExpiryCheck_();
    var sh = getMainSpreadsheet_().getSheetByName('ADMIN_INBOX');
    return JSON.stringify({ n: sh ? readObjects_(sh).length : 0, pushes: PUSH.length });
  }));
  /* notifyAdmins_ would have been the obvious call to reuse and would have been wrong twice: it
   * gates the bell on appTopicOn_('admin.approval') — currently OFF, so nothing would appear — and
   * it also pushes LINE, which the school asked us not to do for this. */
  eq('🔴 ปิดสวิตช์ทุกข้อแล้ว กระดิ่งยังขึ้น', got.n, 1);
  eq('...และยังไม่ส่ง LINE', got.pushes, 0);
}

// ============================================================================
console.log('\n6) 📐 โครงสร้าง — ถามคำถามเดียว ที่เดียว');
{
  ok_('มี slipOkProbe_ แยกออกมา', /function slipOkProbe_/.test(slips));
  ok_('🔴 หน้าตรวจสอบใช้ probe ตัวเดียวกัน ไม่ได้ copy',
    /var live = slipOkProbe_\(\);/.test(slips));
  ok_('...และมีการเรียก /quota อยู่ชุดเดียวในไฟล์',
    (slips.match(/'\/quota'/g) || []).length === 1);
  ok_('ตั้งเวลาเช็กทุกวันไว้แล้ว', /newTrigger\('slipOkExpiryCheck_'\)/.test(trig));
  /* 🔴 THE WARNING MUST NOT OPEN THE SLIP QUEUE. Its text contains "สลิป", and notifTarget's keyword
   * fallback reads that as a payment — which would drop the admin on a screen full of parents'
   * transfers and nothing about the package that is expiring. */
  ok_('กดกระดิ่งแล้วเปิดหน้าตรวจ SlipOK', /cat==='system'\?'slipok'/.test(app));
  ok_('...และ slipok ผูกกับ A_slipDiag ของแอดมิน', /slipok:\(\)=>window\.A_slipDiag/.test(app));
  /* RENEWING IS NOT AUTOMATED, and this is what keeps it that way: the only thing the watch sends
   * to SlipOK is a GET to /quota. No POST, no endpoint that could buy anything, and so no path by
   * which the school's money gets spent without a person deciding to spend it. */
  const probe = slips.slice(slips.indexOf('function slipOkProbe_'), slips.indexOf('function handleSlipDiag'));
  ok_('🔴 ของที่ยิงออกไปมีแค่ GET /quota', /method: 'get'/.test(probe) && !/method: 'post'/i.test(probe));
  ok_('...และเส้นทางนี้ยิงออกนอกระบบจุดเดียว',
    (probe.match(/UrlFetchApp\.fetch/g) || []).length === 1);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
