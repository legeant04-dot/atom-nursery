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

/** the real LIFF block from app.js, run against a LINE that we control */
function boot(over) {
  over = over || {};
  const code = src.slice(src.indexOf('let _liffReady = null;'), src.indexOf('window.PROVIDER ='));
  const log = [], sess = {}, loc = Object.assign({}, over.localStorage);
  const liff = { _init: false, _in: !!over.signedIn, _loginCalls: 0, _initCalls: 0,
    init() { liff._initCalls++; log.push('init'); return Promise.resolve().then(() => { liff._init = true; }); },
    // exactly like the real SDK: both of these throw before init
    isLoggedIn() { if (!liff._init) throw new Error('LIFF init has not been finished yet'); return liff._in; },
    login() { if (!liff._init) throw new Error('LIFF init has not been finished yet'); liff._loginCalls++; log.push('redirect-to-LINE'); },
    getProfile() { log.push('getProfile'); return Promise.resolve({ userId: 'U1', displayName: 'father' }); },
    getAccessToken() { return 'tok'; } };
  const ctx = {
    CONFIG: { MODE: 'gas', LIFF_ID: 'x' }, liff, console, setTimeout,
    loadLiff: over.sdkFails ? () => { log.push('loadSDK'); return Promise.reject(new Error('offline')); }
                            : () => { log.push('loadSDK'); return Promise.resolve(liff); },
    sessionStorage: { getItem: k => (k in sess ? sess[k] : null), setItem: (k, v) => { sess[k] = v; }, removeItem: k => { delete sess[k]; } },
    localStorage: { getItem: k => (k in loc ? loc[k] : null), setItem: (k, v) => { loc[k] = v; }, removeItem: k => { delete loc[k]; } },
    EN: () => false, esc: s => s, toast: m => log.push('toast:' + m),
    setHeader: () => {}, nav: {},
    app: { set innerHTML(v) { log.push('screen:' + (/กำลังเข้าสู่ระบบ/.test(v) ? 'SIGNING_IN' : 'other')); } },
    api: over.authFails ? a => { log.push('api:' + a); return Promise.reject(new Error('NO_SESSION')); }
                        : a => { log.push('api:' + a); return Promise.resolve({ role: over.role || 'Parent', linkedId: 'PAR-1', displayName: 'father' }); },
    LOGIN_REAL: () => log.push('LOGIN_REAL'), applyLangNow: () => {}, accountStage: () => log.push('accountStage'),
    loginScreen: () => log.push('screen:LOGIN_CARD'), PROVIDER: () => {},
    USER: null, AUTH_RENDER: null, PENDING_LINE_UID: null, PENDING_PROVIDER: null, window: {} };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(code, ctx);
  return { ctx, log, liff, sess };
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

  console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
