/**
 * tools/test_demo_mode.js — โหมดสาธิต (Phase A)
 *   node tools/test_demo_mode.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * ผอ. 2026-10-21 · ลำดับ B → C → A
 *
 * เจ้าของเนอสเซอรี่ที่เห็นโฆษณาต้องกดดูได้ทันที ไม่ต้องจองเดโม ไม่ต้องคุยกับเซลส์ — จากรายงาน
 * เทียบ 19 แพลตฟอร์ม (ก.ย. 2026) ไม่มีเจ้าไหนให้ทำแบบนั้นได้เลย
 *
 * 🔴 แต่ของที่อันตรายที่สุดในฟีเจอร์นี้ ไม่ใช่ข้อมูลปลอม — มันคือ **ประตูที่ล็อกอินได้โดยไม่ต้องมี
 * LINE** ถ้าประตูนั้นเผลอเปิดบน deployment ของโรงเรียนจริง = ใครที่รู้ URL ก็เข้าดูข้อมูลเด็ก
 * ทั้งโรงเรียนได้
 *
 * ชุดทดสอบนี้จึงตรวจ "มันปิดอยู่จริงไหม" มากกว่าตรวจว่า "มันทำงานไหม"
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
const app = R('webapp/app.js'), demo = R('src/Demo.gs'), line = R('src/Line.gs');

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                    'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                    'PaySlips', 'PayAdjust', 'Password', 'Certificate', 'Dspm', 'BillRun', 'AttReq',
                    'Journal', 'Day6', 'Demo', 'GasEngine', 'Engine']);

const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var MAIN = getMainSpreadsheet_(), HR = getHrSpreadsheet_();
  appendObject_(sheet_(HR, 'STAFF'), { StaffID: 'DM-ADM', Name: 'แอดมินตัวอย่าง', Role: 'Admin',
    PositionLevel: 'Admin', Status: 'ACTIVE', Department: '*', StartDate: '2025-01-01' });
  appendObject_(sheet_(HR, 'STAFF'), { StaffID: 'DM-T', Name: 'ครูตัวอย่าง', Role: 'Teacher',
    PositionLevel: 'Staff', Status: 'ACTIVE', Department: 'Nursery 1', StartDate: '2025-01-01' });
  appendObject_(sheet_(MAIN, 'PARENTS'), { ParentID: 'DM-P', Name: 'ผู้ปกครองตัวอย่าง', LineUID: 'U-DM-P' });

  function setCfg(k, v) {
    var cfg = sheet_(MAIN, 'SCHOOL_CONFIG');
    var r = findObject_(cfg, function (x) { return String(x.Key) === k; });
    if (r) updateRow_(cfg, r._row, { Value: v }); else appendObject_(cfg, { Key: k, Value: v });
    _configCache = null; try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}
  }
  function prop(v) {
    var P = PropertiesService.getScriptProperties();
    if (v === null) P.setProperty('ATOM_DEMO', ''); else P.setProperty('ATOM_DEMO', v);
  }
  function tryLogin(role) {
    try { var r = handleDemoLogin({ role: role }); return { ok: true, role: r.role, linkedId: r.linkedId, token: !!r.token }; }
    catch (e) { return { ok: false, code: (e && e.apiCode) || String((e && e.message) || e) }; }
  }
  var out = {};

  // ── กุญแจดอกเดียว = ปิด ───────────────────────────────────────────────────────────────────────
  setCfg('DemoMode', 'false'); prop(null);
  out.bothOff = { on: demoOn_(), status: handleDemoStatus().demo, login: tryLogin('Admin') };
  setCfg('DemoMode', 'true');  prop(null);
  out.cfgOnly = { on: demoOn_(), status: handleDemoStatus().demo, login: tryLogin('Admin') };
  setCfg('DemoMode', 'false'); prop('1');
  out.propOnly = { on: demoOn_(), status: handleDemoStatus().demo, login: tryLogin('Admin') };

  // ── กุญแจครบสองดอก = เปิด ─────────────────────────────────────────────────────────────────────
  setCfg('DemoMode', 'true'); prop('1');
  out.both = { on: demoOn_(), status: handleDemoStatus().demo };
  out.loginAdmin  = tryLogin('Admin');
  out.loginParent = tryLogin('Parent');
  out.loginBogus  = tryLogin('Owner');          // บทบาทที่ไม่ได้ประกาศไว้
  // เซสชันที่ออกให้ ต้องตรวจสอบได้และเป็นของ uid ที่ขึ้นต้นด้วย DEMO-
  try { var s = verifySession_(handleDemoLogin({ role: 'Admin' }).token);
        out.sess = { uid: s.uid, role: s.role, linkedId: s.linkedId }; } catch (e) { out.sess = String(e); }

  // ── 🔴 และต้องไม่มี LINE ออกไปหาใครเลย ───────────────────────────────────────────────────────
  setCfg('LineChannelAccessToken', 'DUMMY-TOKEN-NOT-REAL');
  out.pushInDemo = linePush_('U-SOMEBODY-REAL', [{ type: 'text', text: 'x' }]);
  setCfg('DemoMode', 'false'); prop(null);
  out.offAgain = demoOn_();
  return JSON.stringify(out);
}));

console.log('\n1) 🔴 กุญแจสองดอก — ดอกเดียวไม่พอ');
{
  /* ถ้าใช้สวิตช์เดียว วันหนึ่งจะมีคนกดเปิดในสมุดงานของโรงเรียนจริง (หรือคัดลอกสมุดงานสาธิตไปทับ)
   * แล้วระบบของโรงเรียนจริงจะกลายเป็นระบบที่ล็อกอินได้โดยไม่ต้องมี LINE — เงียบๆ โดยไม่มีใครรู้ */
  eq('ไม่ตั้งอะไรเลย — ปิด', res.bothOff.on, false);
  eq('🔴 ตั้งแค่ใน SCHOOL_CONFIG — ยังปิด', res.cfgOnly.on, false);
  eq('🔴 ตั้งแค่ Script Property — ยังปิด', res.propOnly.on, false);
  eq('ครบสองดอก — เปิด', res.both.on, true);
  eq('ตอนปิด: demoStatus ตอบว่าไม่', res.cfgOnly.status, false);
  eq('🔴 ตอนปิด: demoLogin ปฏิเสธ', res.cfgOnly.login.code, 'NOT_DEMO');
  eq('🔴 ...และปฏิเสธแม้ตั้ง Script Property ไว้แล้ว', res.propOnly.login.code, 'NOT_DEMO');
}

console.log('\n2) 🧪 ตอนเปิด — ล็อกอินได้โดยไม่ต้องมี LINE');
{
  eq('เข้าเป็นแอดมินได้', res.loginAdmin.ok && res.loginAdmin.role, 'Admin');
  eq('...และผูกกับแอดมินในข้อมูลสาธิต', res.loginAdmin.linkedId, 'DM-ADM');
  eq('เข้าเป็นผู้ปกครองได้', res.loginParent.ok && res.loginParent.linkedId, 'DM-P');
  eq('🔴 บทบาทที่ไม่ได้ประกาศไว้ — ปฏิเสธ', res.loginBogus.code, 'BAD_INPUT');
  /* 🔴 uid ของเซสชันสาธิตขึ้นต้นด้วย DEMO- เสมอ จึงไม่มีทางตรงกับ LineUID ของคนจริงคนไหน
   * ถ้าปล่อยให้มันเป็น uid ว่างหรือ uid ที่เดาได้ มันจะกลายเป็นกุญแจของคนอื่น */
  ok_('🔴 เซสชันสาธิตใช้ uid ที่ขึ้นต้นด้วย DEMO- (ไม่ชนกับ LINE UID ของใคร)',
    /^DEMO-/.test(res.sess.uid || ''));
  eq('...และเป็นเซสชันที่ตรวจสอบได้จริง', res.sess.role, 'Admin');
}

console.log('\n3) 🔴 เดโมส่ง LINE หาใครไม่ได้เด็ดขาด');
{
  /* ระบบนี้มีข้อความที่ **ตั้งใจให้ไม่มีสวิตช์ปิด**: รายงานอุบัติเหตุส่ง LINE หาแอดมิน หัวหน้าครู
   * และครอบครัวเสมอ ซึ่งถูกต้องสำหรับโรงเรียนจริง และจะเป็นหายนะถ้าคนแปลกหน้ากดลองในเดโม
   * แล้วมันไปถึงพ่อแม่ตัวจริง — จึงตัดที่ "ท่อ" ไม่ใช่ที่สวิตช์รายหัวข้อ */
  eq('🔴 linePush_ ไม่ส่งเลยในโหมดสาธิต', res.pushInDemo, false);
  ok_('🔴 ตัดที่ linePush_ ซึ่งเป็นทางออกเดียวของทุกข้อความ',
    /function linePush_[\s\S]{0,900}demoOn_\(\)/.test(line));
  ok_('...ไม่ได้ไปตัดทีละหัวข้อ (ฟีเจอร์ที่เขียนพรุ่งนี้จะถูกปิดด้วยโดยไม่ต้องจำ)',
    (line.match(/demoOn_\(\)/g) || []).length === 1);
}

console.log('\n4) 🔵 หน้าจอบอกว่าเป็นเดโม และไม่ชวนเมื่อปิดอยู่');
{
  ok_('แถบบนทุกหน้าบอกว่าเป็นข้อมูลจำลอง', /โหมดสาธิต — ชื่อ เด็ก และตัวเลขทั้งหมดเป็นข้อมูลจำลอง/.test(app));
  /* ข้อความ "ข้อมูลปลอม" สำคัญกว่า "คุณแก้ไม่ได้" — ถ้าซ้อนกันต้องเห็นอันแรก */
  ok_('🔴 แถบเดโมมาก่อนแถบ Observer (หนึ่งแถบ หนึ่งที่)',
    app.indexOf('if (window.__DEMO) {') < app.indexOf("else if (USER && USER.role === 'Observer')"));
  ok_('ปุ่มเข้าดูตัวอย่างซ่อนไว้จนกว่าเซิร์ฟเวอร์จะบอกว่าเปิด', /id="demoBox" \$\{demoReady\(\)\?'':'hidden'\}/.test(app));
  /* 🔴 หน้าจอไม่ใช่ด่าน — ซ่อนปุ่มไม่ได้แปลว่าปลอดภัย เซิร์ฟเวอร์ต้องปฏิเสธเองด้วย ซึ่งข้อ 1 พิสูจน์แล้ว */
  ok_('🔴 ...แต่ความปลอดภัยอยู่ที่เซิร์ฟเวอร์ ไม่ใช่ที่การซ่อนปุ่ม', /if \(!demoOn_\(\)\) throw apiError_\('NOT_DEMO'/.test(demo));
  ok_('เข้าเดโมแล้วเดินเข้าประตูเดียวกับการล็อกอินจริง (LOGIN_REAL)',
    /LOGIN_REAL\(r\.role, r\.linkedId/.test(app));
  ok_('demoStatus คืนแค่ boolean ไม่มีข้อมูลโรงเรียนหลุดก่อนล็อกอิน',
    /return \{ demo: on, school: on \? String\(getConfig_\('SchoolName'/.test(demo));
}

console.log('\n5) 🧯 ปิดกลับได้ และค่าปริยายคือปิด');
{
  eq('ถอดกุญแจออกแล้วปิดทันที', res.offAgain, false);
  ok_('ค่าปริยายใน SCHOOL_CONFIG คือ false', /\['DemoMode',\s*'false'\]/.test(R('src/Config.gs')));
  ok_('อ่านค่าไม่ได้ = ปิด (ไม่ใช่เปิด)', /catch \(e\) \{ return false; \}/.test(demo));
  ok_('จัดประเภทไว้ให้โรงเรียนใหม่แล้ว (UNIVERSAL — ไม่ใช่เรื่องที่ต้องถาม)',
    /DemoMode:\s*'UNIVERSAL'/.test(R('src/Onboarding.gs')));
  ok_('ปุ่มรีเซ็ตข้อมูลสาธิตยังไม่พร้อม และบอกตรงๆ ว่ายังไม่พร้อม',
    /NOT_READY/.test(demo) && /PHASE_DEMO_TODO_DASHBOARD/.test(demo));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
