/**
 * tools/test_freeze.js — P6b on Apps Script: freezeWrites() stops every write, reads carry on
 *   node tools/test_freeze.js
 *
 * Through doPost, the way a phone reaches it (the seam is where these rules live):
 *   · a write → WRITE_FROZEN and nothing changes · a batch refuses the write, answers the read
 *   · sign-in waits (it writes USERS/PARENTS without the lock) · ping still answers
 *   · the six time triggers do nothing while frozen
 *   · WRITE_FROZEN is a deliberate refusal in the perf report, not a failure
 *   · unfreezeWrites() → the same write lands
 * The Cloud Run half is tools/test_freeze_live.js (it needs Postgres).
 */
'use strict';
const path = require('path'), fs = require('fs');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));
let pass = 0, fail = 0;
const ok_ = (label, cond, extra) => { console.log((cond ? '  ok   ' : '  FAIL ') + label + (cond || extra === undefined ? '' : '  ' + JSON.stringify(extra))); cond ? pass++ : fail++; };

const { run, props, g, PUSH } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
  'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup', 'PaySlips', 'Slips', 'Perf',
  'GasEngine', 'Engine', 'Day6', 'Freeze']);
const LOG = [];
g.Logger = { log: s => LOG.push(String(s)) };
g.PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] === undefined ? null : props[k],
  setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) };

const r = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var post = function (action, payload) {
    var x = doPost({ postData: { contents: JSON.stringify({ action: action, payload: payload }) } });
    return JSON.parse(x.getContent ? x.getContent() : x);
  };
  var rows = function (sheet) { return readObjects_(sheet_(getMainSpreadsheet_(), sheet)).length; };
  var hol = function (d) { return { date: d, name: 'วันหยุดทดสอบ ' + d }; };
  var o = {};
  o.before = post('addHoliday', hol('2026-12-31'));
  o.n0 = rows('HOLIDAYS');

  o.freeze = freezeWrites();
  o.prop = PropertiesService.getScriptProperties().getProperty('WRITE_FREEZE');
  _configCache = null; o.cfg = getConfig_('WriteFreeze', '');
  o.single = post('addHoliday', hol('2027-01-01'));
  o.n1 = rows('HOLIDAYS');
  o.batch = post('batch', { calls: [{ action: 'addHoliday', payload: hol('2027-01-02') }, { action: 'holidays', payload: {} }] });
  o.n2 = rows('HOLIDAYS');
  o.read = post('holidays', {});
  o.auth = post('auth', { lineUid: 'U-x' });
  o.line = post('lineExchange', { code: 'x' });
  o.ping = post('ping', {});

  var before = { audit: rows('AUDIT_LOG') };
  ['forgotCheckinReminder', 'forgotCheckoutReminder', 'digestMorning_', 'digestEvening_', 'slipOkExpiryCheck_', 'dailyBackup']
    .forEach(function (n) { this[n](); }, this);
  o.auditAfterTriggers = rows('AUDIT_LOG') - before.audit;

  o.unfreeze = unfreezeWrites();
  o.propAfter = PropertiesService.getScriptProperties().getProperty('WRITE_FREEZE');
  _configCache = null; o.cfgAfter = getConfig_('WriteFreeze', '');
  o.after = post('addHoliday', hol('2027-01-03'));
  o.n3 = rows('HOLIDAYS');
  o.expected = !!PERF_EXPECTED_.WRITE_FROZEN;
  o.audit = readObjects_(sheet_(getMainSpreadsheet_(), 'AUDIT_LOG')).map(function (x) { return x.Action; })
    .filter(function (a) { return /WRITE_FREEZE/.test(a); });
  return JSON.stringify(o);
}));

console.log('\n1) ก่อนปิด');
ok_('เขียนได้ตามปกติ', r.before.ok === true, r.before);

console.log('\n2) freezeWrites()');
ok_('ตั้งทั้ง Script Property และ SCHOOL_CONFIG', r.prop === 'on' && r.cfg === 'on', [r.prop, r.cfg]);
ok_('🔴 เขียนทีละอัน → WRITE_FROZEN', r.single.ok === false && r.single.error.code === 'WRITE_FROZEN', r.single);
ok_('ไม่มีอะไรถูกบันทึก', r.n1 === r.n0, [r.n0, r.n1]);
const [bw, br] = (r.batch && r.batch.data) || [];
ok_('batch: การเขียนถูกปฏิเสธทีละ call', bw && bw.error && bw.error.code === 'WRITE_FROZEN', r.batch);
ok_('batch: การอ่านข้าง ๆ ยังตอบได้', br && br.ok === true, br);
ok_('batch: ไม่มีอะไรถูกบันทึก', r.n2 === r.n0, [r.n0, r.n2]);
ok_('อ่านอย่างเดียวยังได้', r.read.ok === true, r.read);
ok_('🔴 ล็อกอินใหม่รอก่อน (auth · lineExchange)', r.auth.error && r.auth.error.code === 'WRITE_FROZEN' && r.line.error && r.line.error.code === 'WRITE_FROZEN', [r.auth, r.line]);
ok_('ping ยังตอบ', r.ping.ok === true, r.ping);
ok_('ตัวตั้งเวลาทั้ง 6 ไม่ทำอะไร (ไม่มี LINE · ไม่มีแถวใหม่)', PUSH.length === 0 && r.auditAfterTriggers === 0, { push: PUSH.length, audit: r.auditAfterTriggers });
const skipped = ['forgotCheckinReminder', 'forgotCheckoutReminder', 'digestMorning_', 'digestEvening_', 'slipOkExpiryCheck_', 'dailyBackup']
  .filter(n => LOG.some(l => l.indexOf('WRITE_FREEZE: ' + n) === 0));
ok_('...และบอกใน log ว่าข้ามรอบ ครบ 6', skipped.length === 6, skipped);

console.log('\n3) unfreezeWrites()');
ok_('ล้างทั้งสองที่', r.propAfter === null && r.cfgAfter === '', [r.propAfter, r.cfgAfter]);
ok_('เขียนได้อีกครั้ง', r.after.ok === true && r.n3 === r.n0 + 1, [r.after, r.n0, r.n3]);
ok_('บันทึกใน AUDIT_LOG ทั้งตอนปิดและตอนเปิด', JSON.stringify(r.audit) === JSON.stringify(['WRITE_FREEZE_ON', 'WRITE_FREEZE_OFF']), r.audit);

console.log('\n4) รายงานความเร็ว');
ok_('WRITE_FROZEN เป็นการปฏิเสธโดยตั้งใจ ไม่นับเป็นความเสีย', r.expected);

console.log('\n5) ไม่ใช่ route');
{
  const routes = run(() => Object.keys(ROUTES).concat(Object.keys(createAtomAPI({}, null).H || {})));
  ok_('ไม่มี freezeWrites / unfreezeWrites ใน ROUTES หรือ engine', routes.length > 50 && !routes.some(k => /freeze/i.test(k)), routes.filter(k => /freeze/i.test(k)));

}

console.log('\n' + (fail ? '❌' : '✅') + ' test_freeze: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
