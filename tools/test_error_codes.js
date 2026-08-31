/**
 * tools/test_error_codes.js — a refusal must not be reported as a crash.
 *   node tools/test_error_codes.js
 *
 * The health report of 2026-08-30 said:
 *
 *     FAILING: registerParent 82% INTERNALx9
 *
 * which reads as "the registration form is broken and nine families could not sign up". It was not.
 * Those nine were parents the school ALREADY HAD ON FILE, being turned away by the idempotency guard
 * added after the registration form created 84 duplicate parents. The guard was working perfectly.
 *
 * The engine's fail() set `e.code`. dispatch_ in src/Code.gs reads `err.apiCode` — the property
 * apiError_ sets in the .gs handlers — and falls back to 'INTERNAL' when it is absent. So EVERY
 * business rule the engine enforces arrived at the client, and at the report, labelled a server
 * crash. The Thai message was right, so nothing looked wrong from outside; only the one report the
 * school makes decisions from was lying, and it sent this session hunting an outage that never
 * existed.
 *
 * Everything here goes through doPost, not through the engine directly — the whole defect lived in
 * the seam between the two, and a test that calls the engine would have passed throughout.
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
const engine = R('webapp/engine.js'), gasEngine = R('src/Engine.gs'), perfGs = R('src/Perf.gs');

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                    'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                    'GasEngine', 'Engine', 'Day6']);
const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var o = {};
  // every call goes over the wire, exactly as a phone would make it
  var post = function (action, payload) {
    var r = doPost({ postData: { contents: JSON.stringify({ action: action, payload: payload }) } });
    return JSON.parse(r.getContent ? r.getContent() : r);
  };
  var par = function (n, nid, ph, extra) {
    return Object.assign({ Name: n, NameTH: n, NationalID: nid, Phone: ph, Relationship: 'มารดา', Address: 'x' }, extra || {});
  };

  o.ok = post('registerParent', { uid: 'U1', parent: par('ทดสอบ ก', '1101700000001', '0810000001') });
  // the SAME national id again — the guard that exists because the form once made 84 duplicates
  o.again = post('registerParent', { uid: 'U2', parent: par('คนละชื่อ', '1101700000001', '0899999999') });
  // ...and a genuinely different family, which must still get through
  o.other = post('registerParent', { uid: 'U3', parent: par('ทดสอบ ข', '1101700000002', '0810000002') });

  // a mandatory live-capture ID photo, comfortably over the 50,000-character cell limit
  var img = 'data:image/jpeg;base64,' + '/9j/4AAQSkZJRgABAQAAAQABAAD/'.repeat(2000);
  o.imgLen = img.length;
  o.withPhoto = post('registerParent', { uid: 'U4', parent: par('ทดสอบ ค', '1101700000003', '0810000003', { Photo: img }) });
  var rows = readObjects_(sheet_(getMainSpreadsheet_(), 'PARENTS'));
  var withPhoto = rows.filter(function (r) { return String(r.Photo || ''); });
  o.photoCells = withPhoto.map(function (r) { return String(r.Photo).slice(0, 32); });
  o.longestCell = Math.max.apply(null, [0].concat(rows.map(function (r) {
    var m = 0; for (var k in r) if (r.hasOwnProperty(k) && k !== '_row') m = Math.max(m, String(r[k] == null ? '' : r[k]).length);
    return m; })));

  // a second engine rule, to show this is not one handler's problem. linkExisting is the one a
  // parent hits when the national id they typed matches no child — the check that keeps a stranger
  // away from somebody else's record.
  o.badLink = post('linkExisting', { uid: 'U9', nationalId: '0000000000000' });
  o.parents = rows.length;
  return JSON.stringify(o);
}));

// ============================================================================
console.log('\n1) a rule refusing is not the server crashing');
{
  ok_('a new family registers', res.ok.ok === true && !!res.ok.data.parentId);
  eq('...and a different family too', res.other.ok, true);
  eq('a parent already on file is refused', res.again.ok, false);
  /* THE DEFECT. This was 'INTERNAL' — "ระบบขัดข้องชั่วคราว" — for a rule that fired exactly as
   * designed, and nine of them read as an outage in the health report. */
  eq('...with the REASON, not INTERNAL', res.again.error.code, 'ALREADY_REGISTERED');
  ok_('...and the sentence a parent can act on', /มีอยู่ในระบบแล้ว/.test(res.again.error.message));
  ok_('...naming who is already there', /คนละชื่อ|ทดสอบ ก/.test(res.again.error.message));
  eq('nothing was created by the refusal', res.parents, 3);
  // not one handler: fail() is the engine's single throw and every rule goes through it
  eq('another engine rule keeps its code too', [res.badLink.ok, res.badLink.error.code], [false, 'NOT_FOUND']);
  ok_('...with its own sentence intact', /เลขบัตรไม่ตรง/.test(res.badLink.error.message));
}

console.log('\n2) both property names, because two readers exist');
{
  /* `code` is what the engine and the in-browser mock path have always read; `apiCode` is what GAS's
   * dispatch_ reads. Setting one and not the other is the whole bug. */
  ok_('fail() sets both', /const fail = \(code,msg\)=>\{ const e=new Error\(msg\); e\.code=code; e\.apiCode=code; throw e; \};/.test(engine));
  ok_('...and the built engine has it too',
    /const fail = \(code,msg\)=>\{ const e=new Error\(msg\); e\.code=code; e\.apiCode=code; throw e; \};/.test(gasEngine));
  ok_('the reason is written down beside it', /EVERY BUSINESS RULE THE ENGINE ENFORCES WAS BEING REPORTED AS A CRASH/.test(engine));
}

console.log('\n3) ...so the health report stops accusing them');
{
  /* PERF_EXPECTED_ is what separates "the rule working" from "the app failing" in the report. These
   * three could never appear there before, because they always arrived as INTERNAL. */
  ['ALREADY_REGISTERED', 'VERIFY_FAILED', 'AMOUNT_MISMATCH'].forEach(c =>
    ok_('"' + c + '" counts as refused, not failed', new RegExp(c + ': 1').test(perfGs)));
  // ...and things that ARE problems stay problems
  ok_('a lost session is still a failure worth seeing', !/NO_SESSION: 1/.test(perfGs));
  ok_('...and so is a bad reply', !/BAD_RESPONSE: 1/.test(perfGs));
}

console.log('\n4) the ID photo actually reaches Drive');
{
  /* driveifyImage_ swallows its own failures on purpose — "Drive failed → keep the base64, setValues
   * may throw loudly, never silent". The test harness had no Utilities.base64Decode, so every test
   * that put an image through a sheet write hit that catch and got the raw data URL back. The
   * offload that exists to keep a photo under the 50,000-character cell limit had never once run in
   * a test, and registration REQUIRES a live-capture photo. */
  ok_('the photo is well over the cell limit to begin with', res.imgLen > 50000);
  eq('the registration succeeds', res.withPhoto.ok, true);
  ok_('...and the cell holds a Drive link, not the image',
    res.photoCells.length === 1 && /^https:\/\/drive\.google\.com\//.test(res.photoCells[0]));
  ok_('...so nothing in the sheet is anywhere near 50,000 characters', res.longestCell < 1000);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
