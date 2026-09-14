/**
 * tools/test_sticky_login.js — staying signed in, and being able to undo it.
 *   node tools/test_sticky_login.js
 *
 * WHY THIS FILE EXISTS. Asked 2026-09-14, the evening several parents could not get in:
 * "เราสามารถ Login ค้างไว้เลยเหมือน Facebook ได้ไม่ต้อง Login บ่อยๆ".
 *
 * They could not get in because of two things at once, and only one of them was the session length:
 *
 *   1. THE APP WENT TO LINE ON EVERY OPEN. boot() loaded the LIFF SDK, ran liff.init() and called
 *      `auth` — a full Apps Script execution that itself calls out to LINE — while a perfectly valid
 *      token sat in localStorage doing nothing. p50 for one call was 6.8s that week. Worse, it meant
 *      walking every returning parent through the LINE hand-off, and `lineHandoff :: never returned`
 *      hit 8 people in the same window: iOS gives access.line.me to the LINE app, the app opens on
 *      some other tab, and nothing comes back.
 *   2. THE TOKEN DIED ON AN ABSOLUTE CLOCK. Twelve hours from sign-in, whatever you were doing. A
 *      parent who opened the app on Monday morning and again on Wednesday evening ALWAYS had to sign
 *      in again — there was no sequence of events in which they did not.
 *
 * The fix is the Facebook shape: our own session is what the app runs on, and LINE is only consulted
 * when we have no session to run on. That makes the session the thing that must be revocable, which
 * is the other half of this file: a 30-day session on a phone that is lost, sold or handed to a child
 * is a liability unless somebody can end it.
 *
 * The three properties worth protecting, in order of how much they would cost to get wrong:
 *   · a REVOKED or expired token must not open the app, however good it looks on the client
 *   · a non-Admin must not be able to sign ANYBODY ELSE out
 *   · resuming must be refused whenever we are not certain whose app this is
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '\n         got=' + JSON.stringify(got) + '\n        want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const auth = R('src/Auth.gs'), code = R('src/Code.gs'), api = R('webapp/api.js'), app = R('webapp/app.js');

/** Pull one function out of a .gs file so it can be run for real rather than regex-matched. */
function cut(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('no such function: ' + name);
  let d = 0, e = i;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) { e = k; break; } }
  }
  return src.slice(i, e + 1);
}

console.log('\n1) The app opens from the session it already holds, not from LINE');
{
  ok_('boot tries our own session first', /if \(resumeSession\(\)\) return;/.test(app));
  /* ORDER IS THE WHOLE POINT. Below this line boot() fetches the LIFF SDK and calls `auth`; if the
   * resume were attempted after that, it would save nothing at all. */
  const iResume = app.indexOf('if (resumeSession()) return;');
  const iLiff = app.indexOf('liffReady().then(() => {', iResume - 4000 > 0 ? iResume - 4000 : 0);
  ok_('...BEFORE the LIFF SDK and the auth round trip', iResume > 0 && iResume < app.indexOf('liffReady().then', iResume));
  ok_('...and after the browser-login callback, which is a sign-in in progress',
    app.indexOf('lineFinishBrowserLogin(_webCode); return;') < iResume);
  ok_('the client can read its own token', /window\.__atomSessionInfo = \(\) => \{/.test(api));
  ok_('...and treats an expired one as no session at all', /if \(!p \|\| !p\.exp \|\| Date\.now\(\) >= p\.exp\) return null;/.test(api));
}

console.log('\n2) Resuming is refused whenever we are not sure whose app this is');
{
  // run the real resumeSession against a fake localStorage + token
  const body = o => Buffer.from(JSON.stringify(o)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_');
  function tryResume(tokenPayload, stored) {
    const calls = [];
    const ctx = {
      Date, JSON, console,
      __atomSessionInfo: () => {
        if (!tokenPayload) return null;
        return (tokenPayload.exp && Date.now() < tokenPayload.exp) ? tokenPayload : null;
      },
      localStorage: { getItem: k => (k === 'atom_me' && stored ? JSON.stringify(stored) : null) },
      LOGIN_REAL: (...a) => calls.push(a),
      applyLangNow: () => {},
      PENDING_LINE_UID: null
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    const i = app.indexOf('  function resumeSession(){');
    const j = app.indexOf('\n  }', i);
    vm.runInContext(app.slice(i, j + 4).replace(/^\s*function/, 'function'), ctx);
    return { resumed: ctx.resumeSession(), calls, ctx };
  }
  const live = { uid: 'U1', role: 'Parent', linkedId: 'PAR-1', iat: 1, exp: Date.now() + 9e6 };
  const me = { role: 'Parent', linkedId: 'PAR-1', uid: 'U1', displayName: 'กานต์', pictureUrl: 'p.jpg' };

  const good = tryResume(live, me);
  ok_('a live token + a matching profile resumes', good.resumed === true);
  eq('...as the role and id the TOKEN says, with the cached name and photo',
    good.calls[0], ['Parent', 'PAR-1', 'กานต์', 'p.jpg']);

  eq('no token: go to LINE', tryResume(null, me).resumed, false);
  eq('expired token: go to LINE', tryResume({ uid: 'U1', role: 'Parent', linkedId: 'PAR-1', exp: Date.now() - 1 }, me).resumed, false);
  /* A guest is a half-finished registration. Resuming would drop them into onboarding screens that
   * need the LINE profile, and strand anybody who never finished becoming a parent. */
  eq('guest token: go to LINE', tryResume({ uid: 'U1', role: 'guest', linkedId: '', exp: Date.now() + 9e6 }, me).resumed, false);
  eq('no cached profile: go to LINE', tryResume(live, null).resumed, false);
  /* THE ONE THAT MATTERS. A different LINE account signed in on this device since, so the name and
   * photo on disk belong to somebody else. Opening the app with them would put one family's name on
   * another family's session. */
  eq('the cached profile belongs to someone else: go to LINE',
    tryResume(live, { role: 'Parent', linkedId: 'PAR-9', displayName: 'อื่น' }).resumed, false);
  eq('the cached ROLE disagrees with the token: go to LINE',
    tryResume(live, { role: 'Teacher', linkedId: 'PAR-1', displayName: 'x' }).resumed, false);

  ok_('the profile is written on every real sign-in', /localStorage\.setItem\('atom_me'/.test(app));
  ok_('...and dropped on sign-out, so the next person does not inherit a header',
    /localStorage\.removeItem\('atom_me'\)/.test(app));
}

console.log('\n2b) "จดจำการเข้าสู่ระบบ" finally does something');
{
  /* THE BOX WAS DECORATION. It has been on the login card, ticked, since the first build, and
   * nothing ever read it — grep for `rememberMe` before v383 and the only hit is the markup that
   * draws it. So the app promised the school exactly what they asked for on 2026-09-14 while going
   * to LINE on every single open. Leaving a control that lies next to a feature that now works
   * would be worse than not having built the feature. */
  ok_('the shell copy is wired', /id="rememberMe"[\s\S]{0,80}onchange="window\.REMEMBER_ME&&REMEMBER_ME\(this\)"/.test(R('webapp/index.html')));
  ok_('the app copy is wired', /id="rememberMe" \$\{rememberMe\(\)\?'checked':''\}[\s\S]{0,60}onchange="REMEMBER_ME\(this\)"/.test(app));
  ok_('...and reflects the saved choice rather than always showing ticked', /const rememberMe = \(\) => \{ try \{ return localStorage\.getItem\(REMEMBER_KEY\) !== '0'; \}/.test(app));
  /* Recorded on TAP, not on return: liff.login() reloads the page from scratch, so a value read
   * when the session comes back would be read off a checkbox that no longer exists. */
  ok_('the choice is stored the moment it is tapped', /window\.REMEMBER_ME = el => \{ try \{\n    localStorage\.setItem\(REMEMBER_KEY, el && el\.checked \? '1' : '0'\);/.test(app));
  ok_('unticking also forgets the device already on disk', /if \(el && !el\.checked\) localStorage\.removeItem\('atom_me'\);/.test(app));
  ok_('...and a sign-in does not re-remember it', /if \(rememberMe\(\)\) localStorage\.setItem\('atom_me'/.test(app));
  ok_('the default is ON — a family phone, and what the box has always shown',
    /catch \(e\) \{ return true; \} \};/.test(app));
}

console.log('\n3) How long a session survives being left alone');
{
  const ctx = { SESSION_TTL_SEC: 43200, SESSION_TTL_BY_ROLE_: null };
  vm.createContext(ctx);
  vm.runInContext(auth.slice(auth.indexOf('var SESSION_TTL_BY_ROLE_'), auth.indexOf('/* ---- REVOKING SESSIONS')), ctx);
  const D = 24 * 3600;
  eq('parent 30 days', ctx.sessionTtlFor_('Parent'), 30 * D);
  eq('teacher 14 days', ctx.sessionTtlFor_('Teacher'), 14 * D);
  /* NOT LENGTHENED, and this is the deliberate half of the answer. An Admin session sees every
   * family's records and the school's money; a parent session sees their own children. */
  eq('admin stays at 12h', ctx.sessionTtlFor_('Admin'), 43200);
  eq('leader stays at 12h', ctx.sessionTtlFor_('Leader'), 43200);
  eq('observer stays at 12h', ctx.sessionTtlFor_('Observer'), 43200);
  eq('guest stays at 12h', ctx.sessionTtlFor_('guest'), 43200);
  eq('an unknown role falls back to the SHORT default', ctx.sessionTtlFor_('Whatever'), 43200);
  eq('no role at all falls back too', ctx.sessionTtlFor_(''), 43200);
}

console.log('\n4) A token can be taken back');
{
  const store = {};
  const ctx = {
    Date, JSON, Object, Number, String, isFinite, console,
    getConfig_: (k, d) => (store[k] === undefined ? d : store[k]),
    setConfigValue_: (k, v) => { store[k] = v; return v; }
  };
  vm.createContext(ctx);
  vm.runInContext(
    auth.slice(auth.indexOf('var SESSION_EPOCH_KEY_'), auth.indexOf('function sessionSecret_')), ctx);

  eq('nobody is revoked to begin with', ctx.sessionEpochOf_('U1'), 0);
  const at = ctx.bumpSessionEpoch_('U1');
  ok_('...and after a revoke there is a cut-off', ctx.sessionEpochOf_('U1') === at && at > 0);
  eq('which is stored as ONE config value, not a sheet read per request',
    Object.keys(store), ['SessionEpochs']);
  eq('revoking one person does not touch another', ctx.sessionEpochOf_('U2'), 0);
  /* Unreadable config must not sign the whole school out — a JSON parse failure is OUR bug, and
   * turning it into "nobody may use the app" would make a small fault a total outage. */
  store.SessionEpochs = '{not json';
  eq('a corrupt value fails OPEN, not closed', ctx.sessionEpochOf_('U1'), 0);
  store.SessionEpochs = '';
  eq('a blank value means nobody is revoked', ctx.sessionEpochOf_('U1'), 0);

  // an epoch older than the longest possible session can no longer refuse anything
  store.SessionEpochs = JSON.stringify({ OLD: Date.now() - 40 * 24 * 3600 * 1000, KEEP: Date.now() - 1000 });
  ctx.bumpSessionEpoch_('NEW');
  const after = JSON.parse(store.SessionEpochs);
  ok_('dead entries are pruned, so the cell cannot grow forever', !('OLD' in after));
  ok_('...but a live one is kept', 'KEEP' in after && 'NEW' in after);
}

console.log('\n5) verifySession_ refuses a revoked token, however good the signature is');
{
  const store = { epoch: 0 };
  const ctx = {
    Date, JSON, Number, String, console,
    sessionSecret_: () => 's',
    sessionEpochOf_: () => store.epoch,
    Utilities: {
      base64EncodeWebSafe: s => 'SIG:' + s,
      base64DecodeWebSafe: s => s,
      computeHmacSha256Signature: (b) => b,
      newBlob: s => ({ getDataAsString: () => s })
    }
  };
  vm.createContext(ctx);
  vm.runInContext(cut(auth, 'verifySession_'), ctx);
  // the fake codec makes a valid token simply "<json>.SIG:<json>"
  const tok = o => { const b = JSON.stringify(o); return b + '.SIG:' + b; };
  const live = { uid: 'U1', role: 'Parent', linkedId: 'PAR-1', iat: 1000, exp: Date.now() + 9e6 };

  ok_('a good token verifies', !!ctx.verifySession_(tok(live)));
  ok_('a tampered one does not', ctx.verifySession_(JSON.stringify(live) + '.SIG:nope') === null);
  ok_('an expired one does not', ctx.verifySession_(tok(Object.assign({}, live, { exp: Date.now() - 1 }))) === null);

  store.epoch = 2000;                                  // revoked AFTER this token was minted
  ok_('a token from before the revoke is refused', ctx.verifySession_(tok(live)) === null);
  ok_('...and one minted at the cut-off instant survives — the device that asked keeps working',
    !!ctx.verifySession_(tok(Object.assign({}, live, { iat: 2000 }))));
  ok_('...as does one minted after it', !!ctx.verifySession_(tok(Object.assign({}, live, { iat: 2001 }))));
  /* A token from before the app carried `iat` has nothing to compare. Treated as the OLDEST
   * possible, because "sign out of everything" has to include the sessions that existed before the
   * button did — the lost phone is exactly the one running last week's build. */
  ok_('a token with no iat at all is refused once a revoke exists',
    ctx.verifySession_(tok({ uid: 'U1', role: 'Parent', linkedId: 'PAR-1', exp: Date.now() + 9e6 })) === null);
  store.epoch = 0;
  ok_('...but is fine while nobody has revoked anything (old tokens keep working through the rollout)',
    !!ctx.verifySession_(tok({ uid: 'U1', role: 'Parent', linkedId: 'PAR-1', exp: Date.now() + 9e6 })));
}

console.log('\n6) Who may sign whom out');
{
  function run(payload, rows) {
    const store = {}, audit = [];
    const ctx = {
      Date, JSON, Object, Number, String, isFinite, console,
      SESSION_EPOCH_KEY_: 'SessionEpochs',   // declared outside the functions being cut
      getConfig_: (k, d) => (store[k] === undefined ? d : store[k]),
      setConfigValue_: (k, v) => { store[k] = v; return v; },
      apiError_: (c, m) => Object.assign(new Error(m), { apiCode: c }),
      logAudit: (...a) => audit.push(a),
      readObjects_: sh => sh,
      sheet_: (wb, name) => (rows[name] || []),
      getMainSpreadsheet_: () => 'MAIN', getHrSpreadsheet_: () => 'HR',
      resolveIdentity_: uid => (uid === 'U-ME' ? { role: 'Parent', linkedId: 'PAR-1' } : null),
      issueSession_: (uid, role, linkedId, at) => 'TOK:' + uid + ':' + role + ':' + at,
      ROLES: { PARENT: 'Parent' }
    };
    vm.createContext(ctx);
    vm.runInContext(cut(auth, 'sessionEpochs_') + '\n' + cut(auth, 'sessionEpochOf_') + '\n' +
      cut(auth, 'bumpSessionEpoch_') + '\n' + cut(auth, 'sessionUidsFor_') + '\n' +
      cut(auth, 'handleSignOutEverywhere'), ctx);
    let out = null, thrown = null;
    try { out = ctx.handleSignOutEverywhere(payload); } catch (e) { thrown = e; }
    return { out, thrown, store, audit, epochs: JSON.parse(store.SessionEpochs || '{}') };
  }
  const SHEETS = {
    USERS: [{ LinkedID: 'STF-1', LineUID: 'U-USERS' }],
    PARENTS: [{ ParentID: 'PAR-1', LineUID: 'U-ME' }],
    STAFF: [{ StaffID: 'STF-1', LineUID: 'U-STAFF' }, { StaffID: 'STF-2', LineUID: '' }]
  };

  // --- myself, with no target
  const self = run({ __me: 'U-ME', __role: 'Parent' }, SHEETS);
  ok_('a parent may sign out their own devices', self.out && self.out.ok === true && self.out.self === true);
  ok_('...which is recorded as their own doing', self.audit[0] && self.audit[0][1] === 'SIGNOUT_ALL_SELF');
  ok_('...the cut-off lands on THEIR uid', !!self.epochs['U-ME']);
  /* THE PHONE IN THEIR HAND KEEPS WORKING. Signing yourself out of the device you are holding, in
   * order to sign out the one you lost, is not what the button means. */
  eq('...and they are handed a replacement token minted at that exact instant',
    self.out.token, 'TOK:U-ME:Parent:' + self.epochs['U-ME']);

  // --- somebody else
  const asParent = run({ __me: 'U-ME', __role: 'Parent', staffId: 'STF-1' }, SHEETS);
  eq('a parent naming a target is REFUSED', asParent.thrown && asParent.thrown.apiCode, 'NO_PERMISSION');
  eq('...and nothing was revoked', Object.keys(asParent.epochs), []);
  const asTeacher = run({ __me: 'U-ME', __role: 'Teacher', staffId: 'STF-1' }, SHEETS);
  eq('a teacher naming a target is refused too', asTeacher.thrown && asTeacher.thrown.apiCode, 'NO_PERMISSION');
  const asObserver = run({ __me: 'U-ME', __role: 'Observer', staffId: 'STF-1' }, SHEETS);
  eq('an observer naming a target is refused as well', asObserver.thrown && asObserver.thrown.apiCode, 'NO_PERMISSION');

  const admin = run({ __me: 'U-ADM', __role: 'Admin', staffId: 'STF-1' }, SHEETS);
  ok_('an admin may sign somebody else out', admin.out && admin.out.ok === true && admin.out.self === false);
  /* ONE PERSON, MORE THAN ONE DOOR. An Admin-provisioned USERS row AND a STAFF row is the normal
   * shape here, and revoking only one of them would leave a working session on the lost phone. */
  eq('...on EVERY LINE account that record answers to', admin.out.devices, 2);
  ok_('...both cut off', !!admin.epochs['U-USERS'] && !!admin.epochs['U-STAFF']);
  ok_('...and it is in the audit log with who did it', admin.audit[0] && admin.audit[0][1] === 'SIGNOUT_ALL_ADMIN');

  const none = run({ __me: 'U-ADM', __role: 'Admin', staffId: 'STF-2' }, SHEETS);
  eq('a record with no LINE account says so instead of silently doing nothing',
    none.thrown && none.thrown.apiCode, 'NOT_FOUND');
  const nobody = run({ __role: 'Admin', staffId: 'STF-1' }, SHEETS);
  eq('no caller at all is refused', nobody.thrown && nobody.thrown.apiCode, 'NO_SESSION');
}

console.log('\n7) The route is wired the way a write has to be');
{
  ok_('the route exists', /signOutEverywhere:\s+function \(p\) \{ return handleSignOutEverywhere\(p\); \}/.test(code));
  /* NOT in ADMIN_ONLY on purpose: that list would refuse a parent their own button. The split is
   * made inside the handler, where the caller's real role is known. */
  ok_('it is NOT admin-only', !/ADMIN_ONLY[\s\S]*?signOutEverywhere: 1[\s\S]*?parentKidsMap/.test(code));
  /* Nor does it get the ordinary identity stamping: applyIdentity_ would put a parentId/staffId on
   * a request that means "myself", making every self sign-out indistinguishable from an admin
   * targeting somebody. */
  ok_('applyIdentity_ passes the caller through untouched but named',
    /if \(action === 'signOutEverywhere'\) \{ payload\.__me = sess\.uid; payload\.__role = sess\.role; return payload; \}/.test(code));
  /* "sign…" is not a mutating verb, and the anchored verb test is how three features have already
   * shipped without a write lock or a cache clear. */
  ok_('the SERVER counts it as a write', /signOutEverywhere: 1 \};/.test(code));
  ok_('the CLIENT counts it as a write too', /signOutEverywhere: 1\n  \};/.test(api));
  ok_('an Observer may still close their own sessions',
    /var ownSessionWrite = \(action === 'signOutEverywhere'\);/.test(code) &&
    /if \(mutates && !ownSessionWrite && sess && String\(sess\.role\) === 'Observer'\)/.test(code));
}

console.log('\n8) The buttons exist where somebody would look for them');
{
  ok_('a self-service card', /const signOutAllCard = \(\) =>/.test(app));
  ok_('...on the parent My-info screen', /\$\{googleLinkCard\(me\.Email\|\|'', !!me\.GoogleLinked\)\}\n      \$\{signOutAllCard\(\)\}/.test(app));
  ok_('...and on the staff profile screen', /\$\{googleLinkCard\(s\.Email\|\|'', !!s\.GoogleLinked\)\}\n      \$\{signOutAllCard\(\)\}/.test(app));
  ok_('it confirms first — it does log other phones out', /window\.SIGNOUT_ALL = async \(btn\) => \{\n    if \(!confirm\(/.test(app));
  /* Without this the very next request from this phone would carry the token just revoked, and the
   * person who pressed "sign out my other devices" would be signed out of this one. */
  ok_('...and stores the replacement token', /if \(r && r\.token && window\.__atomSetSession\) __atomSetSession\(r\.token\);/.test(app));
  ok_('api.js can accept a token that did not come from a sign-in', /window\.__atomSetSession = t => \{/.test(api));
  ok_('...and refuses junk', /if \(!t \|\| String\(t\)\.indexOf\('\.'\) <= 0\) return false;/.test(api));

  ok_('the admin has the same button on a staff record', /window\.A_signOutStaff=async\(id\)=>\{/.test(app));
  ok_('...which names the person rather than acting on the caller', /api\('signOutEverywhere',\{staffId:id\}\)/.test(app));
}

console.log(fail ? `\nFAILED ${pass} passed, ${fail} failed` : `\nALL PASS ${pass} checks`);
process.exit(fail ? 1 : 0);
