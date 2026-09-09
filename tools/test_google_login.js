/**
 * tools/test_google_login.js — the second key, and the door it must open onto.
 *   node tools/test_google_login.js
 *
 * Built 2026-09-09 after the director approved it, for the parents whose phone cannot complete the
 * LINE hand-off. Everything here is one claim tested from several directions:
 *
 *   SIGNING IN WITH GOOGLE MUST NOT BE A SECOND PLACE WHERE "WHO IS THIS" IS DECIDED.
 *
 * That is how a second sign-in method goes wrong. One route learns about a suspended account and the
 * other does not; one applies the last-working-day rule and the other lets a teacher who left in
 * June back in in September. So this route resolves a Google account to the LineUID already on that
 * person's row and then calls handleAuth with it — the role, the DISABLED and ENDED gates, the
 * twelve-hour token and the home payload are all produced by the code that already existed.
 *
 * The security checks that cannot be inherited are the two Google's tokeninfo cannot make for us:
 *   · `aud` — a token minted for SOMEBODY ELSE'S app is a perfectly valid Google token. Without this
 *     check, any site the parent has ever signed in to could hand us one and be let in as them.
 *   · `email_verified` — an address Google has not confirmed the person owns is not an identity.
 *
 * The tokeninfo call is faked here, exactly as Google's endpoint answers, so the real handler runs.
 */
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), code = R('src/Code.gs'), auth = R('src/Auth.gs'),
      cfg = R('src/Config.gs'), perf = R('src/Perf.gs'), api = R('webapp/api.js'), eng = R('webapp/engine.js');
/* `accept="image/*"` opens a block comment that never closes — strip that first or the next sixteen
 * thousand characters of real code vanish and every assertion over them asks about nothing. */
const srcCode = s => s.replace(/image\/\*/g, 'image_ANY')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CLIENT_ID = '120486339414-6auhdq0a1fur2ihu24rr8po58vgci3s1.apps.googleusercontent.com';

/**
 * A live-ish school: two parents, two staff, one of each with a Google account already linked.
 * `tokens` maps a fake credential string onto what Google's tokeninfo would answer for it.
 */
function boot(tokens) {
  const H = require(path.join(__dirname, 'gas_test_harness.js'));
  const ctx = H(['Config', 'Db', 'Checkin', 'Audit', 'Code', 'Auth', 'Staff', 'Perf']);
  const g = ctx.g;
  g.UrlFetchApp.fetch = (url) => {
    const u = String(url);
    if (u.indexOf('oauth2.googleapis.com/tokeninfo') < 0) return { getResponseCode: () => 200, getContentText: () => '{}' };
    const cred = decodeURIComponent(u.split('id_token=')[1] || '');
    const t = tokens[cred];
    if (!t) return { getResponseCode: () => 400, getContentText: () => '{"error":"invalid_token"}' };
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(t) };
  };
  ctx.run(function () {
    var main = SpreadsheetApp.create('MAIN'), hr = SpreadsheetApp.create('HR');
    PropertiesService.getScriptProperties().setProperty('WB_MAIN_ID', main.getId());
    PropertiesService.getScriptProperties().setProperty('WB_HR_ID', hr.getId());
    var sc = main.insertSheet('SCHOOL_CONFIG');
    sc.appendRow(['Key', 'Value']);
    sc.appendRow(['GoogleClientId', '120486339414-6auhdq0a1fur2ihu24rr8po58vgci3s1.apps.googleusercontent.com']);
    main.insertSheet('USERS').appendRow(['UserID', 'LineUID', 'Role', 'LinkedID', 'PasswordHash', 'CreatedDate', 'Status']);
    main.insertSheet('AUDIT_LOG').appendRow(['Timestamp', 'UserID', 'Action', 'Sheet', 'Ref']);
    var p = main.insertSheet('PARENTS');
    p.appendRow(['ParentID', 'NationalID', 'Name', 'NameEN', 'Relationship', 'Phone', 'LineUID', 'StudentID', 'Email', 'GoogleSub']);
    //                                                                        LineUID    child    email                 sub
    p.appendRow(['PAR-1', '1', 'กานต์ ดีงาม', 'Karn', 'มารดา', '0811111111', 'U_mum', 'S1', 'karn@gmail.com', 'gsub_mum']);
    p.appendRow(['PAR-2', '2', 'วิทย์ เก่งกล้า', 'Wit', 'บิดา', '0822222222', 'U_dad', 'S1', 'wit@gmail.com', '']);
    p.appendRow(['PAR-3', '3', 'ไม่มีไลน์', 'NoLine', 'มารดา', '0833333333', '', 'S2', 'noline@gmail.com', '']);
    var s = hr.insertSheet('STAFF');
    s.appendRow(['StaffID', 'Name', 'NameEN', 'Role', 'Status', 'LineUID', 'EndDate', 'Email', 'GoogleSub']);
    s.appendRow(['STF-1', 'ครูฟิล์ม', 'Film', 'Teacher', 'ACTIVE', 'U_film', '', 'film@gmail.com', '']);
    s.appendRow(['STF-2', 'ครูที่ลาออก', 'Gone', 'Teacher', 'ACTIVE', 'U_gone', '2026-06-30', 'gone@gmail.com', '']);
    s.appendRow(['STF-3', 'ครูที่ถูกระงับ', 'Off', 'Teacher', 'INACTIVE', 'U_off', '', 'off@gmail.com', '']);
    return 'ok';
  });
  return ctx;
}
/** run one call inside the GAS context and bring back either the result or the refusal code */
function call(ctx, fnSrc) {
  return JSON.parse(ctx.run(new Function(
    'try { return JSON.stringify({ ok:true, v: (' + fnSrc + ')() }); }' +
    'catch (e) { return JSON.stringify({ ok:false, code: String((e && (e.apiCode || e.code)) || "THREW"), msg: String(e && e.message || e) }); }'
  )));
}
const good = (sub, email) => ({ sub, email, email_verified: 'true', aud: CLIENT_ID, name: 'Test', picture: '' });

console.log('1) it opens onto exactly the account LINE opens onto');
{
  const ctx = boot({ T_MUM: good('gsub_mum', 'karn@gmail.com') });
  const r = call(ctx, 'function(){ return handleGoogleExchange({credential:"T_MUM"}); }');
  ok_('the mother is signed in', r.ok);
  eq('...as a Parent', r.v.role, 'Parent');
  eq('...as HERSELF, not as somebody the Google route picked', r.v.linkedId, 'PAR-1');
  ok_('...with a session token, minted by the same issuer as every other route', !!r.v.token);
  /* THE POINT OF THE WHOLE DESIGN. The token carries the LINE UID, so USER_LINKS, parentOwnsStudent_
   * and every lookup that reads a uid keep working — there is no second identity anywhere. */
  const payload = JSON.parse(Buffer.from(r.v.token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  eq('the token carries her LINE uid, not a Google one', payload.uid, 'U_mum');
  eq('...and the same twelve hours', Math.round((payload.exp - Date.now()) / 3600000), 12);
}
{
  // a teacher gets a teacher's session, from the same call
  const ctx = boot({ T_FILM: good('gsub_film', 'film@gmail.com') });
  const r = call(ctx, 'function(){ return handleGoogleExchange({credential:"T_FILM"}); }');
  eq('a teacher signs in as a teacher', [r.ok, r.v && r.v.role, r.v && r.v.linkedId], [true, 'Teacher', 'STF-1']);
}

console.log('\n2) the gates that already existed still bite');
{
  /* NOT re-implemented here — inherited. handleAuth refuses a suspended account and one whose last
   * working day has passed, and this route reaches those refusals by going through it. If somebody
   * later adds a third rule to handleAuth, this door gets it for free. */
  const ctx = boot({ T_OFF: good('g_off', 'off@gmail.com'), T_GONE: good('g_gone', 'gone@gmail.com') });
  eq('a suspended account cannot come in through Google', call(ctx, 'function(){ return handleGoogleExchange({credential:"T_OFF"}); }').code, 'DISABLED');
  eq('nor can a teacher whose last working day has passed', call(ctx, 'function(){ return handleGoogleExchange({credential:"T_GONE"}); }').code, 'ENDED');
}

console.log('\n3) the two checks Google cannot make for us');
{
  // a REAL, correctly signed Google token — issued to a different application
  const ctx = boot({ T_OTHER: { sub: 'gsub_mum', email: 'karn@gmail.com', email_verified: 'true', aud: 'someone-elses-app.apps.googleusercontent.com' } });
  const r = call(ctx, 'function(){ return handleGoogleExchange({credential:"T_OTHER"}); }');
  eq('a token minted for another app is refused', r.code, 'GOOGLE_TOKEN_INVALID');
}
{
  const ctx = boot({ T_UNV: { sub: 'gsub_mum', email: 'karn@gmail.com', email_verified: 'false', aud: CLIENT_ID } });
  eq('an unverified address is not an identity', call(ctx, 'function(){ return handleGoogleExchange({credential:"T_UNV"}); }').code, 'GOOGLE_EMAIL_UNVERIFIED');
}
{
  const ctx = boot({});
  eq('a credential Google does not recognise is refused', call(ctx, 'function(){ return handleGoogleExchange({credential:"MADE_UP"}); }').code, 'GOOGLE_TOKEN_INVALID');
  eq('...and so is no credential at all', call(ctx, 'function(){ return handleGoogleExchange({}); }').code, 'BAD_INPUT');
}

console.log('\n4) an account nobody has linked is turned away, and told what to do');
{
  const ctx = boot({ T_NEW: good('g_new', 'stranger@gmail.com') });
  const r = call(ctx, 'function(){ return handleGoogleExchange({credential:"T_NEW"}); }');
  eq('a Google account with no matching record cannot get in', r.code, 'GOOGLE_NOT_LINKED');
  /* NAMING THE ADDRESS MATTERS. Somebody with three Google accounts on their phone has picked the
   * wrong one; "not linked" alone leaves them with nothing to act on. */
  ok_('...and the refusal says WHICH address was tried', r.msg.indexOf('stranger@gmail.com') >= 0);
  ok_('...and how to fix it', r.msg.indexOf('ผูกบัญชี Google') >= 0);
}
{
  // a row whose Email an admin filled in but which has no LINE behind it: refused rather than
  // improvised around, because a session on a uid nothing else knows would break every USER_LINKS read
  const ctx = boot({ T_NL: good('g_nl', 'noline@gmail.com') });
  eq('a record with no LINE account cannot be signed in', call(ctx, 'function(){ return handleGoogleExchange({credential:"T_NL"}); }').code, 'GOOGLE_NO_LINE_ACCOUNT');
}

console.log('\n5) the email finds you once; the permanent id is what is kept');
{
  /* PAR-2 has an email on file and no GoogleSub — the admin-rescue case, and the state every parent
   * is in the first time they use the button. */
  const ctx = boot({ T_DAD: good('gsub_dad', 'wit@gmail.com') });
  const r = call(ctx, 'function(){ return handleGoogleExchange({credential:"T_DAD"}); }');
  eq('recognised by his address alone the first time', [r.ok, r.v && r.v.linkedId], [true, 'PAR-2']);
  const sub = call(ctx, 'function(){ return findObject_(sheet_(getMainSpreadsheet_(),"PARENTS"), function(x){ return x.ParentID==="PAR-2"; }).GoogleSub; }');
  eq('...and the permanent account id is written down', sub.v, 'gsub_dad');
  /* WHY THAT MATTERS: he changes his email address next year. Matching on the address would lock
   * him out; matching on the id he was recognised by does not. */
  const ctx2 = boot({ T_DAD2: good('gsub_dad', 'wit.new.address@gmail.com') });
  call(ctx2, 'function(){ return handleGoogleExchange({credential:"T_DAD"}); }');   // no-op: unknown cred
  const moved = call(ctx2, 'function(){ ' +
    'var sh=sheet_(getMainSpreadsheet_(),"PARENTS"); var row=findObject_(sh,function(x){return x.ParentID==="PAR-2";}); ' +
    'updateRow_(sh,row._row,{GoogleSub:"gsub_dad"}); ' +
    'return handleGoogleExchange({credential:"T_DAD2"}).linkedId; }');
  eq('after he changes his email he still gets in, on the id', moved.v, 'PAR-2');
}
{
  // the id wins over the address, so a recycled address cannot claim somebody else's account
  const ctx = boot({ T_X: good('gsub_mum', 'wit@gmail.com') });
  const r = call(ctx, 'function(){ return handleGoogleExchange({credential:"T_X"}); }');
  eq('a matching sub decides, not a matching email', r.v.linkedId, 'PAR-1');
}

console.log('\n6) linking from inside a session — the safe way to collect an address');
{
  const ctx = boot({ T_FILM: good('gsub_film', 'film@gmail.com') });
  const r = call(ctx, 'function(){ return handleGoogleLink({staffId:"STF-1", credential:"T_FILM"}); }');
  eq('a teacher links her own account', [r.ok, r.v && r.v.linked, r.v && r.v.email], [true, true, 'film@gmail.com']);
  const sub = call(ctx, 'function(){ return findObject_(sheet_(getHrSpreadsheet_(),"STAFF"), function(x){ return x.StaffID==="STF-1"; }).GoogleSub; }');
  eq('...and it is remembered', sub.v, 'gsub_film');
}
{
  // THE RISK THE WHOLE FEATURE TURNS ON: one address must never open two accounts
  const ctx = boot({ T_MUMS: good('g_other', 'karn@gmail.com') });
  eq('the mother’s address cannot be linked to the father as well',
    call(ctx, 'function(){ return handleGoogleLink({parentId:"PAR-2", credential:"T_MUMS"}); }').code, 'EMAIL_TAKEN');
}
{
  // ...and neither can one GOOGLE ACCOUNT, even carrying an address nobody else holds
  const ctx = boot({ T_SUBDUP: good('gsub_mum', 'brand.new@gmail.com') });
  eq('a Google account already linked elsewhere cannot be linked again',
    call(ctx, 'function(){ return handleGoogleLink({parentId:"PAR-2", credential:"T_SUBDUP"}); }').code, 'EMAIL_TAKEN');
}
{
  const ctx = boot({});
  const r = call(ctx, 'function(){ return handleGoogleLink({parentId:"PAR-1", unlink:true}); }');
  eq('unlinking works', [r.ok, r.v && r.v.linked], [true, false]);
  const row = call(ctx, 'function(){ var x=findObject_(sheet_(getMainSpreadsheet_(),"PARENTS"), function(y){ return y.ParentID==="PAR-1"; }); return [x.Email, x.GoogleSub]; }');
  /* BOTH cleared. The address on its own is a way in — it is what a first sign-in matches on — so
   * leaving it behind would leave the door open after somebody asked to close it. */
  eq('...and clears the address as well as the id', row.v, ['', '']);
  const after = boot({});   // fresh sheet, then unlink and try the address
  call(after, 'function(){ return handleGoogleLink({parentId:"PAR-1", unlink:true}); }');
  eq('...so the old address no longer opens the account',
    call(after, 'function(){ return handleGoogleExchange({credential:"T_MUM"}); }').code, 'GOOGLE_TOKEN_INVALID');
}
{
  const ctx = boot({});
  eq('linking with no identity at all is refused', call(ctx, 'function(){ return handleGoogleLink({credential:"x"}); }').code, 'NO_SESSION');
}

console.log('\n7) readiness, and a school that has not set it up');
{
  const ctx = boot({});
  const r = call(ctx, 'function(){ return handleGoogleLoginReady(); }');
  eq('the client is told it is on, and the id, which is not a secret', [r.v.ready, r.v.clientId], [true, CLIENT_ID]);
  /* A SCHOOL THAT HAS NOT SET IT UP must see nothing, not a button that fails. The row is blanked in
   * the sheet the same way an admin would blank it, cache included. */
  const off = call(ctx, 'function(){' +
    ' var sh = sheet_(getMainSpreadsheet_(), "SCHOOL_CONFIG");' +
    ' var r = findObject_(sh, function (x) { return String(x.Key) === "GoogleClientId"; });' +
    ' updateRow_(sh, r._row, { Value: "" });' +
    ' try { CacheService.getScriptCache().removeAll(["col:SCHOOL_CONFIG","rows:SCHOOL_CONFIG","cfg"]); } catch (e) {}' +
    ' return [handleGoogleLoginReady().ready,' +
    '   (function(){ try { handleGoogleExchange({ credential: "T_MUM" }); return ""; }' +
    '               catch (e) { return String(e.apiCode || e.code); } })()]; }');
  eq('with no client id the button is off and the route refuses cleanly', off.v, [false, 'GOOGLE_NOT_CONFIGURED']);
  /* A BLANK ROW AND A MISSING ROW ARE DIFFERENT ANSWERS.
   *
   * getConfig_ treats a blank cell as absent and returns the default, which would make it impossible
   * to switch this off from the sheet. And the live workbook predates the key — defaults are seeded
   * only at setup — so with no fallback at all the feature would ship switched off and look broken
   * on the very deployment it was built for. A blank row means off; no row means the built-in one.
   */
  const ctx2 = boot({ T_MUM: good('gsub_mum', 'karn@gmail.com') });
  const gone = call(ctx2, 'function(){' +
    ' var sh = sheet_(getMainSpreadsheet_(), "SCHOOL_CONFIG");' +
    ' var r = findObject_(sh, function (x) { return String(x.Key) === "GoogleClientId"; });' +
    ' sh.deleteRow(r._row);' +
    ' try { CacheService.getScriptCache().removeAll(["col:SCHOOL_CONFIG","rows:SCHOOL_CONFIG","cfg"]); } catch (e) {}' +
    ' _configCache = null;' +
    ' return [handleGoogleLoginReady().clientId, handleGoogleExchange({ credential: "T_MUM" }).linkedId]; }');
  eq('a workbook with no row at all uses the school’s own client, and still signs people in',
    gone.v, [CLIENT_ID, 'PAR-1']);
}

console.log('\n8) how the request is allowed to reach the handler at all');
{
  const c = srcCode(code);
  ok_('the three routes exist', /googleLoginReady:\s+function/.test(c) && /googleExchange:\s+function/.test(c) && /googleLink:\s+function/.test(c));
  /* PUBLIC, and only these two: they run BEFORE a session exists, because producing one is what they
   * do. googleLink is the opposite — its entire safety is the session deciding whose row is written,
   * so it must NOT be public. */
  ok_('the two sign-in routes are public', /a === 'googleLoginReady' \|\| a === 'googleExchange'/.test(c));
  ok_('...and linking is NOT', !/publicAction_[\s\S]{0,400}googleLink/.test(c));
  ok_('linking is stamped with the caller’s own id, for every role including Admin', /if \(action === 'googleLink'\)/.test(c));
  ok_('...clearing anything the client sent first', /delete payload\.parentId; delete payload\.staffId;/.test(c));
  ok_('both writing routes take the write lock', /googleExchange: 1, googleLink: 1/.test(c));
  ok_('...and the client will not retry them behind the user’s back', /googleExchange: 1, googleLink: 1/.test(srcCode(api)));
  ok_('the client id has a home in SCHOOL_CONFIG', /'GoogleClientId',\s*'120486339414-/.test(cfg));
  ok_('every Google refusal is a rule, not an outage', /GOOGLE_NOT_LINKED: 1/.test(perf) && /GOOGLE_TOKEN_INVALID: 1/.test(perf));
}

console.log('\n8b) a LINE uid on its own is a claim, not a proof');
{
  /* FOUND WHILE BUILDING THIS. handleAuth takes `lineUid` without a token as a direct-API testing
   * fallback, and `auth` is public — so anybody holding somebody's LINE UID could post it and be
   * handed their session. Those ids are not secret: the sign-in screen prints your own for copying
   * and the admin forms hold everyone's. It matters here more than anywhere, because this feature's
   * entire design is "handleAuth is the one trustworthy place identity is decided". */
  const ctx = boot({});
  const on = call(ctx, 'function(){' +
    ' var sh = sheet_(getMainSpreadsheet_(), "SCHOOL_CONFIG"); sh.appendRow(["RequireSessionToken","true"]);' +
    ' try { CacheService.getScriptCache().removeAll(["col:SCHOOL_CONFIG","rows:SCHOOL_CONFIG","cfg"]); } catch (e) {}' +
    ' try { ROUTES.auth({ lineUid: "U_mum" }); return "LET IN"; }' +
    ' catch (e) { return String(e.apiCode || e.code); } }');
  eq('a bare uid cannot buy a session once enforcement is on', on.v, 'NO_IDENTITY');
  ok_('...and the attempt is recorded', /AUTH_UID_ONLY_REFUSED/.test(code));
  ok_('the refusal is at the ROUTE, so setup and diagnostics still call handleAuth directly',
    /auth:\s+function \(p\) \{[\s\S]{0,400}sessionRequired_\(\)/.test(srcCode(code)));
  // while enforcement is off (local testing) the fallback still works, exactly as before
  const off = call(boot({}), 'function(){ return ROUTES.auth({ lineUid: "U_mum" }).role; }');
  eq('...and nothing changes for local testing', off.v, 'Parent');
}

console.log('\n9) what the screens do with it');
{
  const c = srcCode(app);
  ok_('the login screen offers it', /data-gsi="signin"/.test(c));
  ok_('...and so does the screen a stuck parent lands on', (c.match(/data-gsi="signin"/g) || []).length >= 2);
  ok_('both My-info screens can link', /googleLinkCard\(/.test(c));
  /* GOOGLE REFUSES OAUTH IN AN EMBEDDED WEBVIEW (disallowed_useragent), so a button drawn inside
   * LINE's own browser could only ever fail — and it is not needed there, because LIFF signs people
   * in with no button at all. */
  ok_('nothing Google is drawn inside LINE’s browser', /if \(!boxes\.length \|\| inLineApp\(\) \|\| CONFIG\.MODE !== 'gas'\) return;/.test(c));
  /* AN UNKNOWN ANSWER STARTS THE QUESTION. Giving up on a falsy client id made the button depend on
   * the readiness reply having already arrived — and on a cold start it has not, because the box is
   * in the shell and the ask is a round trip behind it. Found by loading the live site. */
  ok_('...but an unknown readiness asks, rather than drawing nothing for ever', /if \(_gsiClientId === null\) \{ googleReady\(\); return; \}/.test(c));
  ok_('...and a school with no OAuth client still sees nothing', /if \(!_gsiClientId\) return;/.test(c));
  ok_('...including the link card', /if \(inLineApp\(\)\) return '';/.test(c));
  ok_('the button is never auto-triggered', /auto_select: false/.test(c));
  ok_('Safari’s tracking prevention is accounted for', /itp_support: true/.test(c));
  ok_('a readiness ask that FAILED is not remembered as a no', /\.catch\(\(\) => \{ _gsiClientId = null; \}\)/.test(c));
  /* NOBODY IS WAITING ON A READINESS ANSWER. A read still in flight after 350ms covers the screen
   * with a blocking "ระบบกำลังดำเนินการ", and the first Apps Script execution after a deploy takes
   * seconds — so probing CONFIGURATION was greying out the very LINE button the parent was reaching
   * for, on the sign-in screen, which is the one screen where that is least forgivable. */
  ok_('probing configuration does not cover the sign-in screen', /api\('googleLoginReady', \{\}, \{ quiet: true \}\)/.test(c));
  ok_('...and neither does the LINE one', /api\('lineLoginReady', \{\}, \{ quiet: true \}\)/.test(c));
  /* One callback for two jobs, told apart by whether anybody is signed in — the link button only
   * exists inside a session and the sign-in button only outside one. */
  ok_('the credential cannot reach the wrong handler', /if \(USER\) GOOGLE_LINK_SAVE\(cred\); else GOOGLE_SIGNIN\(cred\);/.test(c));
  /* Google working says nothing about whether the LINE hand-off on this phone is fixed. Clearing the
   * failure count would send the next sign-in back into the route that is still broken. */
  ok_('signing in with Google does not pretend LINE is fixed', !/GOOGLE_SIGNIN[\s\S]{0,900}clearLiffFails\(\)/.test(c));
  ok_('the home payload still rides back with the sign-in', /if \(u\.home && u\.home\.children\) window\._BOOT_HOME = u\.home;/.test(c));
  ok_('a refusal is explained and the parent is returned to the login screen', /\.catch\(e => \{ err\(e\); loginScreen\(\); \}\)/.test(c));
  // the server's sentence names the address; a generic dictionary entry would hide it
  ok_('GOOGLE_NOT_LINKED keeps the server’s own words', !/GOOGLE_NOT_LINKED:\s*\[/.test(app));
  ok_('the other Google codes are translated', /GOOGLE_TOKEN_INVALID:\s*\[/.test(app) && /GOOGLE_EMAIL_UNVERIFIED:\s*\[/.test(app));
  ok_('only whether it is linked reaches the client, never the account id', /GoogleLinked: !!pa\.GoogleSub/.test(eng) && !/GoogleSub:\s*pa\.GoogleSub/.test(eng));
  ok_('mock mode answers honestly instead of drawing a button that cannot work', /googleLoginReady: \(\) => \(\{ ready:false/.test(eng));
}

console.log('\n10) LINE is still the way in');
{
  const c = srcCode(app);
  ok_('the LINE button is still first on the login screen', c.indexOf('LIFF_LOGIN()') < c.indexOf('data-gsi="signin"'));
  ok_('opening inside LINE is still the first thing a stuck parent is offered',
    c.indexOf('OPEN_IN_LINE()') < c.indexOf('data-gsi="signin"'));
  ok_('handleAuth is unchanged as the one place identity is decided', /function handleAuth\(payload\)/.test(auth));
  ok_('...and the Google route goes through it rather than around it', /return handleAuth\(\{ lineUid: uid/.test(auth));
}

console.log('\n11) the button exists on a COLD start, which is the visit that fails');
{
  const html = R('webapp/index.html'), c = srcCode(app);
  /* FOUND BY LOADING THE REAL SITE, not by reading the code. loginScreen() returns early while the
   * shell is on screen, so on a first visit in Thai the page contained neither the LINE-by-email
   * fallback nor the Google button — the two routes that exist for the parent whose FIRST attempt
   * is the one that fails. index.html already carried this lesson for the .apk card. */
  ok_('the shell carries the Google container', /data-gsi="signin"/.test(html));
  ok_('...and the LINE-by-email fallback', /id="lineWebBtn"/.test(html));
  ok_('...and the open-in-LINE route', /id="openInLineBtn"/.test(html));
  ok_('the fallback starts hidden until the server says it is configured', /id="lineWebBtn" hidden/.test(html));
  ok_('the shell guards every handler, since app.js may not have run yet', /window.LINE_BROWSER_LOGIN&&LINE_BROWSER_LOGIN()/.test(html) && /window.OPEN_IN_LINE&&OPEN_IN_LINE()/.test(html));
  ok_('all three are removed inside LINE’s own browser', /['lineWebBtn','openInLineBtn','gsiShell'].forEach/.test(c));
  /* inLineApp is a const arrow, so calling it from the top-level prune beside apkCard would be a
   * temporal-dead-zone ReferenceError rather than a hoisted call. */
  ok_('...after inLineApp exists, not before it', c.indexOf('const inLineApp') < c.indexOf("['lineWebBtn','openInLineBtn','gsiShell']"));
  const ls = c.slice(c.indexOf('function loginScreen()'), c.indexOf('function loginScreen()') + 3000);
  ok_('the paint is asked for above the early return', ls.indexOf('GOOGLE_PAINT()') < ls.indexOf("getElementById('bootSplash')"));
}

console.log(fail ? `\nFAILED ${pass} passed, ${fail} failed` : `\nPASSED ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
