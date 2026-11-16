/**
 * tools/test_pw_lock.js — a password check cannot be guessed forever (2026-11-16).
 *   node tools/test_pw_lock.js
 *
 * The salary-slip unlock (checkStaffPassword) and changePassword's old-password check: 5 wrong in a
 * row lock that account's check for 15 minutes, server-side (Script Properties), cleared by a correct
 * answer. See Password.gs pwLock*_.
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

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                    'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                    'GasEngine', 'Engine', 'Day6', 'Password', 'Perf']);
const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  appendObject_(sheet_(getHrSpreadsheet_(), 'STAFF'), { StaffID: 'STF-PW', Name: 'ครูทดสอบ', Role: 'Teacher', Status: 'ACTIVE', PasswordHash: 'Right123' });
  appendObject_(sheet_(getHrSpreadsheet_(), 'STAFF'), { StaffID: 'STF-OTHER', Name: 'ครูอีกคน', Role: 'Teacher', Status: 'ACTIVE', PasswordHash: 'Other123' });
  var chk = function (id, pw) {
    try { return handleCheckStaffPassword({ staffId: id, password: pw }); }
    catch (e) { return { thrown: e && e.apiCode, message: e && e.message }; }
  };
  var o = {};
  o.right = chk('STF-PW', 'Right123');
  o.w = [];
  for (var i = 0; i < 4; i++) o.w.push(chk('STF-PW', 'guess' + i));
  o.okResets = chk('STF-PW', 'Right123');              // a correct answer clears the count
  o.w2 = [];
  for (var j = 0; j < 5; j++) o.w2.push(chk('STF-PW', 'again' + j));
  o.lockedEvenIfRight = chk('STF-PW', 'Right123');
  o.otherUnaffected = chk('STF-OTHER', 'Other123');
  o.inbox = readObjects_(sheet_(getMainSpreadsheet_(), 'ADMIN_INBOX')).filter(function (r) { return /ล็อก 15 นาที/.test(String(r.Text || r.Message || JSON.stringify(r))); }).length;
  // the lock runs out
  var k = pwLockKey_('slip', 'STF-PW');
  PropertiesService.getScriptProperties().setProperty(k, JSON.stringify({ n: 0, until: Date.now() - 1000 }));
  o.afterExpiry = chk('STF-PW', 'Right123');
  o.expected = !!PERF_EXPECTED_.PW_LOCKED;
  return JSON.stringify(o);
}));

console.log('\nslip unlock');
eq('the right password opens it', res.right, { ok: true });
eq('wrong answers count down', res.w.map(x => x.left), [4, 3, 2, 1]);
eq('a correct answer clears the count', res.okResets, { ok: true });
eq('...so the next mistakes start again at 4', res.w2.slice(0, 4).map(x => x.left), [4, 3, 2, 1]);
eq('the fifth wrong in a row locks it', res.w2[4].thrown, 'PW_LOCKED');
ok_('...saying for how long and what to do', /15 นาที/.test(res.w2[4].message || '') && /แอดมิน/.test(res.w2[4].message || ''));
eq('while locked, even the right password is refused', res.lockedEvenIfRight.thrown, 'PW_LOCKED');
eq('another teacher is not affected', res.otherUnaffected, { ok: true });
ok_('the admins\' bell is told once', res.inbox === 1);
eq('when the lock runs out, the right password works again', res.afterExpiry, { ok: true });
ok_('the health report counts PW_LOCKED as a rule working, not a failure', res.expected);

console.log('\nchangePassword (old password)');
const auth = fs.readFileSync(path.join(__dirname, '..', 'src', 'Auth.gs'), 'utf8');
ok_('checks the lock before comparing', /pwLockCheck_\('user', user\.UserID\);[^\n]*\r?\n\s*if \(!verifyPassword_/.test(auth));
ok_('counts a wrong old password', /if \(!pwLockFail_\('user', user\.UserID\)\)/.test(auth));
ok_('clears on a right one', /pwLockClear_\('user', user\.UserID\);/.test(auth));

const app = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'app.js'), 'utf8');
ok_('the slip screen says how many tries are left', /เหลืออีก \$\{left\} ครั้ง/.test(app));

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
