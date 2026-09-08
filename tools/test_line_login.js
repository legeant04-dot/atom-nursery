/**
 * tools/test_line_login.js — signing in with LINE, without looking like it failed.
 *   node tools/test_line_login.js
 *
 * REPORTED 2026-08-27, on both iOS and Android: tapping "เข้าสู่ระบบด้วย LINE" spins, throws the
 * parent back to the login screen, and has to be done at least twice before it works.
 *
 * Nothing was actually broken. This is what they were watching:
 *
 *   1. the shell paints the login card instantly (static HTML, for LCP)
 *   2. the LIFF SDK is fetched, then liff.init() — two network waits
 *   3. not signed in yet → fallback() → loginScreen() … THE SAME CARD, REDRAWN.
 *      To a parent, the app just bounced them back to the start.
 *   4. they tap → full-page redirect to LINE → back to our URL → the page reloads FROM SCRATCH, so
 *      the card paints again, the SDK is fetched again, and only then does api('auth') run — one
 *      more Apps Script round trip with the login card still on screen.
 *
 * The redirect is how OAuth works and cannot be removed. Never showing the login card during it can.
 *
 * AND TWO REAL BUGS, each of which cost a wasted tap:
 *   · `if (window.liff) { liff.login(); return; }` — the SDK being PRESENT is not the same as being
 *     initialised, and liff.login() before init THROWS. The tap did nothing, so they tapped again.
 *   · init ran in two places, so a tap during boot did the whole handshake a second time.
 *
 * This file drives the REAL code out of app.js against a stub SDK and watches the sequence, rather
 * than reading the source and hoping.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const src = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const css = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'styles.css'), 'utf8').replace(/\r\n/g, '\n');
const R_ = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const auth = R_('src/Auth.gs'), code = R_('src/Code.gs'), apijs = R_('webapp/api.js');

/** the real LIFF block from app.js, run against a LINE that we control */
function boot(over) {
  over = over || {};
  const code = src.slice(src.indexOf('let _liffReady = null;'), src.indexOf('window.PROVIDER ='));
  const log = [], sess = {}, loc = Object.assign({}, over.localStorage);
  if (over.state) sess.atom_line_state = over.state;
  const liff = { _init: false, _in: !!over.signedIn, _loginCalls: 0, _initCalls: 0,
    init() { liff._initCalls++; log.push('init'); return Promise.resolve().then(() => { liff._init = true; }); },
    // exactly like the real SDK: both of these throw before init
    isLoggedIn() { if (!liff._init) throw new Error('LIFF init has not been finished yet'); return liff._in; },
    login() { if (!liff._init) throw new Error('LIFF init has not been finished yet'); liff._loginCalls++; log.push('redirect-to-LINE'); },
    getProfile() { log.push('getProfile'); return Promise.resolve({ userId: 'U1', displayName: 'father' }); },
    getAccessToken() { return 'tok'; } };
  /* The browser bits the block now uses: a timer it can cancel, the page-visibility events it
   * listens on to notice a hand-off to LINE that never came back, and a location it can send the
   * parent to LINE with. Held here so a test can fire them (see "the hand-off never comes back"). */
  const listeners = {};
  const doc = { visibilityState: 'visible',
    addEventListener: (k, fn) => { (listeners[k] = listeners[k] || []).push(fn); },
    removeEventListener: (k, fn) => { listeners[k] = (listeners[k] || []).filter(f => f !== fn); } };
  const fire = k => (listeners[k] || []).slice().forEach(fn => fn());
  const ctx = {
    CONFIG: { MODE: 'gas', LIFF_ID: 'x' }, liff, console, setTimeout, clearTimeout,
    document: doc, navigator: { userAgent: over.userAgent || 'Mozilla/5.0 (iPhone) Safari' },
    location: { set href(v) { log.push('goto:' + v); }, get href() { return 'https://s.io/app/'; },
      origin: 'https://s.io', pathname: '/app/', search: over.search || '' },
    history: { replaceState: (a, b, url) => log.push('replaceState:' + url) },
    URLSearchParams, t: k => k,
    loadLiff: over.sdkFails ? () => { log.push('loadSDK'); return Promise.reject(new Error('offline')); }
                            : () => { log.push('loadSDK'); return Promise.resolve(liff); },
    sessionStorage: { getItem: k => (k in sess ? sess[k] : null), setItem: (k, v) => { sess[k] = v; }, removeItem: k => { delete sess[k]; } },
    localStorage: { getItem: k => (k in loc ? loc[k] : null), setItem: (k, v) => { loc[k] = v; }, removeItem: k => { delete loc[k]; } },
    EN: () => false, esc: s => s, toast: m => log.push('toast:' + m),
    setHeader: () => {}, nav: {},
    app: { set innerHTML(v) { log.push('screen:' + (/กำลังเข้าสู่ระบบ/.test(v) ? 'SIGNING_IN'
      : /ยังเข้าสู่ระบบไม่สำเร็จ/.test(v) ? 'STUCK' : 'other')); } },
    api: over.authFails ? a => { log.push('api:' + a); return Promise.reject(new Error('NO_SESSION')); }
                        : a => { log.push('api:' + a); return Promise.resolve({ role: over.role || 'Parent', linkedId: 'PAR-1', displayName: 'father' }); },
    LOGIN_REAL: () => log.push('LOGIN_REAL'), applyLangNow: () => {}, accountStage: () => log.push('accountStage'),
    loginScreen: () => log.push('screen:LOGIN_CARD'), PROVIDER: () => {},
    USER: null, AUTH_RENDER: null, PENDING_LINE_UID: null, PENDING_PROVIDER: null,
    // pageshow is listened for on window, visibilitychange on document — same registry either way
    addEventListener: doc.addEventListener, removeEventListener: doc.removeEventListener,
    window: {} };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(code, ctx);
  return { ctx, log, liff, sess, doc, fire };
}
const settle = () => new Promise(r => setTimeout(r, 60));
const THAI_LINE_FAIL = /เชื่อมต่อ LINE ไม่สำเร็จ/;

(async () => {
  console.log('\n1) one tap, one handshake, one redirect');
  {
    const b = boot();
    b.ctx.LIFF_LOGIN();
    b.ctx.LIFF_LOGIN();                    // the impatient second tap, while the first is working
    await settle();
    eq('the sequence', b.log, ['screen:SIGNING_IN', 'loadSDK', 'init', 'redirect-to-LINE']);
    /* THE TAP IS ACKNOWLEDGED BEFORE ANY NETWORK. Previously the first thing that happened was a
     * 32 KB SDK fetch with nothing on screen changing, which is why it read as "my tap did nothing". */
    eq('the screen changes first, not after the network', b.log[0], 'screen:SIGNING_IN');
    eq('the login card is never shown', b.log.filter(x => x === 'screen:LOGIN_CARD'), []);
    eq('init happens once, not once per tap', b.liff._initCalls, 1);
    eq('...and so does the redirect', b.liff._loginCalls, 1);
    eq('the return trip is flagged, so the reload knows not to show the card', b.sess.atom_liff_pending, '1');
  }
  {
    // liff.login() before init THROWS — this is the bug that cost the second tap
    const b = boot();
    let threw = null;
    try { b.liff.login(); } catch (e) { threw = e.message; }
    ok_('the stub reproduces the real SDK rule', /init has not been finished/.test(threw || ''));
    b.ctx.LIFF_LOGIN(); await settle();
    ok_('...and the real code never trips it', b.log.indexOf('redirect-to-LINE') > b.log.indexOf('init'));
  }

  console.log('\n2) coming back from LINE — straight through, no card');
  {
    const b = boot({ signedIn: true });
    b.ctx.LIFF_LOGIN(); await settle();
    eq('no second redirect when LINE already knows them', b.liff._loginCalls, 0);
    eq('the sequence', b.log, ['screen:SIGNING_IN', 'loadSDK', 'init', 'getProfile', 'api:auth', 'LOGIN_REAL']);
    eq('the flag is cleared once they are in', b.sess.atom_liff_pending, undefined);
  }

  console.log('\n3) a returning parent never sees the login card at boot');
  {
    /* Two cases where an attempt is known to be under way: back from the redirect (the flag), and a
     * device that has signed in here before (atom_last_uid) — which is every returning parent. */
    /* sessionStorage, not localStorage: it has to survive the redirect to LINE and back, and it has
     * to DIE with the tab — a flag left behind would put the next cold start on a sign-in screen
     * that nobody asked for. (Behaviour of setting and clearing it is covered in 1, 2 and 4; these
     * are the two facts about it that no sequence can show.) */
    ok_('the flag lives in sessionStorage', /sessionStorage\.setItem\(LIFF_PENDING/.test(src));
    ok_('...and is removed, not just overwritten', /sessionStorage\.removeItem\(LIFF_PENDING\)/.test(src));
    ok_('...and a storage failure cannot break sign-in', /catch \(e\) \{ return false; \}/.test(src.slice(src.indexOf('const liffPending'), src.indexOf('const liffPending') + 200)));
    // the boot path runs before app.js is loadable in isolation, so it is asserted on the source
    const bootSrc = src.slice(src.indexOf('function boot(){ ensureTranslateObserver();'), src.indexOf('// ================= REGISTRATION'));
    ok_('boot shows the sign-in screen for both', /if \(liffPending\(\) \|\| _known\) signingInScreen\(\);/.test(bootSrc));
    ok_('...and a first-time visitor still gets the card immediately',
      /let _known = false; try \{ _known = !!localStorage\.getItem\('atom_last_uid'\); \}/.test(bootSrc));
    ok_('boot and the button share ONE init', /liffReady\(\)\.then/.test(bootSrc) && /function liffReady\(\)/.test(src));
    ok_('...and ONE auth routine', /return liffAuth\(\)\.catch/.test(bootSrc) && /function liffAuth\(\)/.test(src));
  }

  console.log('\n4) when it fails, it fails onto a screen they can use');
  {
    const b = boot({ sdkFails: true });
    b.ctx.LIFF_LOGIN(); await settle();
    ok_('LINE unreachable, told plainly', b.log.some(x => THAI_LINE_FAIL.test(x)));
    eq('...and not left spinning for ever', b.log[b.log.length - 1], 'screen:LOGIN_CARD');
    eq('...with the return flag cleared', b.sess.atom_liff_pending, undefined);
  }
  {
    /* A refusal from OUR server must not say "check your connection" — it sends a parent to hunt for
     * better wifi when the problem is at our end and trying again will not help. */
    const b = boot({ signedIn: true, authFails: true });
    b.ctx.LIFF_LOGIN(); await settle();
    ok_('a server refusal reports itself, not the network', b.log.some(x => /NO_SESSION/.test(x)));
    ok_('...and does NOT blame LINE', !b.log.some(x => THAI_LINE_FAIL.test(x)));
    eq('...and still lands somewhere usable', b.log[b.log.length - 1], 'screen:LOGIN_CARD');
  }
  {
    // an unregistered LINE account goes to onboarding, exactly as before
    const b = boot({ signedIn: true, role: 'guest' });
    b.ctx.LIFF_LOGIN(); await settle();
    ok_('a guest is sent to registration', b.log.indexOf('accountStage') > 0);
    ok_('...and not logged in as anybody', b.log.indexOf('LOGIN_REAL') < 0);
  }

  console.log('\n5) the waiting screen itself');
  {
    ok_('it says what is happening, in Thai', /กำลังเข้าสู่ระบบด้วย LINE/.test(src));
    ok_('...and warns that the first time is slower', /ครั้งแรกอาจใช้เวลาสักครู่/.test(src));
    ok_('there is a spinner to look at', /<div class="authspin"/.test(src));
    ok_('...and it exists in the stylesheet', /\.authspin\{/.test(css));
    ok_('...reusing the one spin animation the app already has',
      /animation:busySpin/.test(css.slice(css.indexOf('.authspin{'), css.indexOf('.authspin{') + 300)));
  }

  /* ---------------------------------------------------------------------------------------------
   * 6) THE HAND-OFF TO LINE THAT NEVER COMES BACK.
   *
   * A parent could not get in on 08/09/26; the recording shows it twice. liff.login() navigates to
   * access.line.me — which iOS treats as a LINE universal link and hands to the app instead of
   * loading. LINE opened on its Wallet tab, no consent screen, no redirect back. Returning to Safari
   * left our spinner on screen for ever, with nothing on it to press: the overlay that stops a
   * double tap became the dead end.
   *
   * On the SUCCESSFUL path the browser navigates back to our URL and the page reloads from scratch,
   * so none of this code is alive to run. Being here at all means the hand-off did not complete.
   * ------------------------------------------------------------------------------------------- */
  console.log('\n6) when LINE opens and never comes back (iPhone)');
  {
    const b = boot();
    b.ctx.LIFF_LOGIN(); await settle();
    eq('we left for LINE', b.log[b.log.length - 1], 'redirect-to-LINE');
    // the parent comes back to Safari, still not signed in
    b.fire('visibilitychange');
    await new Promise(r => setTimeout(r, 1100));
    ok_('the spinner is not what they are left with', b.log.indexOf('screen:STUCK') > 0);
    eq('...and the return flag is cleared, so a reload shows the card', b.sess.atom_liff_pending, undefined);
    // ...and it is a screen they can act on
    ok_('it offers the LINE app, which has no OAuth hop to lose', /เปิดในแอป LINE/.test(src));
    ok_('...and says why, rather than blaming them', /ไม่กลับมาที่หน้านี้/.test(src));
    ok_('...and still lets them retry in the browser', /ลองอีกครั้งในเบราว์เซอร์นี้/.test(src));
  }
  {
    // a sign-in that DID land while we were away is a sign-in, not a failure
    const b = boot();
    b.ctx.LIFF_LOGIN(); await settle();
    b.liff._in = true;                       // LINE authorised without a page reload
    b.fire('visibilitychange');
    await new Promise(r => setTimeout(r, 1100));
    ok_('it re-asks LINE before giving up', b.log.indexOf('api:auth') > 0);
    eq('...and signs them in', b.log[b.log.length - 1], 'LOGIN_REAL');
    eq('...without ever showing the stuck screen', b.log.filter(x => x === 'screen:STUCK'), []);
  }
  {
    const b = boot();
    b.ctx.OPEN_IN_LINE();
    eq('the escape hatch opens THIS app inside LINE', b.log[0], 'goto:https://liff.line.me/x');
  }
  {
    // becoming visible when nothing is in flight must not manufacture a failure
    const b = boot();
    b.fire('visibilitychange');
    await new Promise(r => setTimeout(r, 1100));
    eq('an idle tab is left alone', b.log, []);
  }
  {
    ok_('the login card offers the LINE app as a second route', /หรือเปิดผ่านแอป LINE/.test(src));
    /* ...but not inside LINE's own browser, where it would reload the same page. LINE's in-app
     * WebView puts " Line/" in the user agent. */
    ok_('...only outside LINE', /!inLineApp\(\)\?/.test(src));
    ok_('...detected from the user agent LINE actually sends', /\\bLine\\\//.test(src));
  }

  /* ---------------------------------------------------------------------------------------------
   * 7) THE THIRD ROUTE — signing in to LINE inside the browser.
   *
   * LINE's own answer to the hand-off that never returns is disable_auto_login=true on the
   * authorization URL, which keeps the whole login in the browser. It cannot be reached through the
   * SDK (liff.login() builds its own URL and takes only redirectUri), so this builds the URL and the
   * SERVER finishes it — the code→token exchange needs the channel secret, which never goes near a
   * phone. Deliberately a fallback: with auto login off the parent has to sign in to LINE itself.
   * ------------------------------------------------------------------------------------------- */
  console.log('\n7) signing in to LINE in the browser (the disable_auto_login route)');
  {
    const b = boot();
    b.ctx.LINE_BROWSER_LOGIN();
    const url = (b.log.find(x => x.indexOf('goto:https://access.line.me') === 0) || '').slice(5);
    ok_('it goes to the authorization endpoint itself', /^https:\/\/access\.line\.me\/oauth2\/v2\.1\/authorize\?/.test(url));
    ok_('...asking for a code', /[?&]response_type=code(&|$)/.test(url));
    ok_('...as the LINE Login channel, which is the LIFF id before the dash', /[?&]client_id=x(&|$)/.test(url));
    /* THE POINT OF THE WHOLE EXERCISE. Without it iOS hands access.line.me to the LINE app, which
     * is where the parent was lost on 08/09. */
    ok_('...with auto login switched OFF', /[?&]disable_auto_login=true(&|$)/.test(url));
    ok_('...and a scope that yields a profile', /[?&]scope=profile(%20|\+)openid(&|$)/.test(url));
    // the callback URL is matched character for character against the console's list
    ok_('the redirect carries no query or hash of its own', /[?&]redirect_uri=https%3A%2F%2Fs\.io%2Fapp%2F(&|$)/.test(url));
    ok_('a state is generated', /[?&]state=atom/.test(url));
    ok_('...and kept, or the callback cannot be recognised as ours', /^atom/.test(b.sess.atom_line_state || ''));
    eq('the parent is not left looking at the login card', b.log[0], 'screen:SIGNING_IN');
    eq('...and the LIFF return flag is cleared — this route does not come back through LIFF', b.sess.atom_liff_pending, undefined);
  }
  {
    // coming back with OUR code — recognised by the state we saved
    const b = boot({ search: '?code=THECODE&state=atomABC', state: 'atomABC' });
    eq('the callback is recognised', b.ctx.lineCallbackCode(), 'THECODE');
    eq('...and the state is spent, so a reload cannot replay it', b.sess.atom_line_state, undefined);
    b.ctx.lineFinishBrowserLogin('THECODE');
    await settle();
    ok_('the code is exchanged on the server, not in the browser', b.log.indexOf('api:lineExchange') >= 0);
    ok_('the query is stripped BEFORE the exchange, so a reload cannot spend the code twice',
      b.log.indexOf('replaceState:https://s.io/app/') >= 0 &&
      b.log.indexOf('replaceState:https://s.io/app/') < b.log.indexOf('api:lineExchange'));
    eq('and they end up signed in', b.log[b.log.length - 1], 'LOGIN_REAL');
  }
  {
    /* LIFF comes back to this same URL with a code of its own. Treating that as ours would burn it
     * and break the route that works for nearly everyone. */
    const b = boot({ search: '?code=LIFFCODE&state=someoneelse', state: 'atomABC' });
    eq('a code that is not ours is left alone', b.ctx.lineCallbackCode(), null);
    eq('...with our state untouched', b.sess.atom_line_state, 'atomABC');
    const c = boot({ search: '?code=LIFFCODE&state=s2' });   // nothing of ours saved at all
    eq('...and so is a callback we never started', c.ctx.lineCallbackCode(), null);
    eq('an ordinary visit is not a callback', boot({ search: '' }).ctx.lineCallbackCode(), null);
  }
  {
    const b = boot({ search: '?code=THECODE&state=atomABC', state: 'atomABC', authFails: true });
    b.ctx.lineFinishBrowserLogin('THECODE');
    await settle();
    ok_('a refused exchange lands on a screen with a way forward', b.log.indexOf('screen:STUCK') > 0);
  }
  {
    // the boot wiring itself — asserted on source, like the rest of the boot path above
    const bootSrc = src.slice(src.indexOf('function boot(){ ensureTranslateObserver();'), src.indexOf('// ================= REGISTRATION'));
    // plain text, not a regex: every character here is punctuation a regex would have to escape
    ok_('boot checks OUR callback first', bootSrc.indexOf('const _webCode = lineCallbackCode();') >= 0);
    ok_('...and returns, so liff.init is never handed a code that is not its own',
      bootSrc.indexOf('if (_webCode) { lineFinishBrowserLogin(_webCode); return; }') >= 0);
    ok_('...before the LIFF path it would otherwise take', bootSrc.indexOf('_webCode') < bootSrc.indexOf('liffReady()'));
  }
  {
    ok_('the button is hidden until the server says it is configured', /id="lineWebBtn"[^>]*\$\{lineWebReady\(\)\?'':'hidden'\}/.test(src));
    ok_('...which is one question, asked once', /function lineWebReady/.test(src) && /api\('lineLoginReady'/.test(src));
    ok_('the QR code is named, because nobody remembers their LINE password', /สแกน QR/.test(src));
    ok_('the exchange is server-side, where the channel secret lives', /handleLineExchange/.test(auth) && /client_secret: c\.secret/.test(auth));
    /* The secret never leaves the server. Asserted on what actually crosses the wire, not on the
     * absence of the word — the admin settings screen names the KEY on purpose, to tell whoever is
     * setting it up which row to add. */
    ok_('the readiness answer is a yes/no, never the secret itself',
      /return \{ ready: !!c\.secret, channelId: c\.id \};/.test(auth));
    ok_('...and the phone sends only the code, the callback and a public channel id',
      /api\('lineExchange', \{ code, redirectUri, clientId: lineChannelId\(\) \}\)/.test(src));
    ok_('...so no secret is ever read on the client', !/getConfig[\s\S]{0,40}Secret/.test(src));
    ok_('an unconfigured school gets told what to set, not a blank failure', /LINE_LOGIN_NOT_CONFIGURED/.test(auth));
    ok_('the sign-in routes are reachable before there is a session', /lineLoginReady' \|\| a === 'lineExchange'/.test(code));
    /* An authorization code can only be spent once, so the reply must never be re-sent — the name
     * starts with no mutating verb, which would have made it retry-safe. */
    ok_('a lost reply is not retried with a burned code', /lineExchange: 1/.test(code) && /lineExchange: 1/.test(apijs));
  }
  {
    /* THE ADMIN CAN SEE WHETHER IT IS SET UP. Two things have to be right and neither is visible
     * from inside the app; until this screen existed the only way to find out was to wait for a
     * parent to fail to sign in and watch whether the button appeared. */
    ok_('the settings screen reports it', /A_lineWebStatus/.test(src) && /id="lineWebCfg"/.test(src));
    ok_('...saying plainly whether the secret is set', /ยังไม่ได้ตั้งค่า/.test(src) && /ตั้งค่าแล้ว/.test(src));
    /* The callback URL is the half the server cannot check — it lives in the LINE console. Printing
     * the exact string the app will send is what makes a mismatch (which reads as
     * "invalid_request", from neither end) something a person can spot. */
    ok_('...and prints the exact callback URL the app will send', /A_lineWebStatus[\s\S]{0,1600}location\.origin \+ location\.pathname/.test(src));
    ok_('...which is the same one the sign-in uses, not a second guess',
      (src.match(/location\.origin \+ location\.pathname/g) || []).length >= 2 && /const lineRedirectUri = \(\) => location\.origin \+ location\.pathname;/.test(src));
    ok_('...and names the row to add when it is missing', /LineLoginChannelSecret/.test(src));
    ok_('...warning which channel it belongs to', /Messaging API/.test(src));
  }

  console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
