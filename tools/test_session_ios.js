/**
 * tools/test_session_ios.js — nobody gets signed out mid-task, and a dropped request is not a crash.
 *   node tools/test_session_ios.js
 *
 * Two findings from the live report:
 *   NO_SESSION scattered across every action — the token expired 12 hours after sign-in no matter
 *   what you were doing, so a teacher who signed in at 07:00 was thrown out at 19:00.
 *   iOS failed 8% of calls against 0% on desktop, with "Load failed" — Safari's wording for a fetch
 *   that never completed, which is what iOS does to an in-flight request when the app is
 *   backgrounded. With calls taking nine seconds, glancing at another app was enough.
 *
 * The rule that must not bend: a WRITE is never sent twice.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const wait = ms => new Promise(r => setTimeout(r, ms));
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function boot(reply) {
  const sent = [], listeners = {}, store = {};
  const mkStore = () => ({ getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }, key: i => Object.keys(store)[i], get length() { return Object.keys(store).length; } });
  const ctx = {
    console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval, Promise, JSON, Math, Date, Object, Array, String, Number, isFinite,
    Blob: function (a, b) { this.parts = a; this.type = b && b.type; },
    localStorage: mkStore(), sessionStorage: mkStore(),
    navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', connection: { effectiveType: '4g' }, sendBeacon: null, maxTouchPoints: 5 },
    performance: { getEntriesByType: () => [] },
    document: {
      addEventListener: (n, f) => { (listeners[n] = listeners[n] || []).push(f); },
      removeEventListener: (n, f) => { listeners[n] = (listeners[n] || []).filter(x => x !== f); },
      hidden: false, currentScript: null
    },
    __sent: sent, __store: store, __fire: n => (listeners[n] || []).slice().forEach(f => f({}))
  };
  ctx.window = ctx; ctx.matchMedia = () => ({ matches: false }); ctx.addEventListener = ctx.document.addEventListener;
  ctx.fetch = (url, init) => {
    const body = JSON.parse(init.body); sent.push(body);
    const out = reply(body, sent);
    if (out === 'NETFAIL') return Promise.reject(new TypeError('Load failed'));
    return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(out)) });
  };
  vm.createContext(ctx);
  vm.runInContext(R('webapp/api.js'), ctx);
  ctx.CONFIG.MODE = 'gas'; ctx.CONFIG.GAS_URL = 'https://example.test/exec';
  return ctx;
}
const listOf = a => ({ ok: true, data: [{ a: a }] });
const batchOf = b => ({ ok: true, data: (b.payload.calls || []).map(c => ({ ok: true, data: [{ a: c.action }] })) });
const anyReply = b => (b.action === 'batch' ? batchOf(b) : listOf(b.action));
const reached = (c, a) => c.__sent.reduce((n, b) =>
  n + (b.action === a ? 1 : (b.action === 'batch' ? (b.payload.calls || []).filter(x => x.action === a).length : 0)), 0);

(async () => {
  console.log('\n1) SERVER: a session in use is renewed, an abandoned one still dies');
  {
    const auth = R('src/Auth.gs');
    ok_('there is a renewal', /function renewSession_/.test(auth));
    ok_('it only fires past the halfway point', /left > \(SESSION_TTL_SEC \* 1000\) \/ 2\) return ''/.test(auth));
    ok_('an already-expired token is NOT renewed — that would be a way back in', /left <= 0/.test(auth));
    ok_('the renewed token keeps the same identity, it does not invent one',
      /issueSession_\(sess\.uid, sess\.role, sess\.linkedId\)/.test(auth));

    // run it for real against a fake GAS runtime
    const ctx = { Date, JSON, SESSION_TTL_SEC: 43200, sessionSecret_: () => 'test-secret',
      Utilities: { base64EncodeWebSafe: s => 'B64(' + String(s).slice(0, 40) + ')', computeHmacSha256Signature: () => 'SIG' } };
    vm.createContext(ctx);
    const cut = src => { const i = auth.indexOf('function ' + src); let d = 0, j = auth.indexOf('{', i), e = j;
      for (let k = j; k < auth.length; k++) { if (auth[k] === '{') d++; else if (auth[k] === '}') { d--; if (!d) { e = k; break; } } } return auth.slice(i, e + 1); };
    vm.runInContext(cut('issueSession_') + '\n' + cut('renewSession_'), ctx);
    const now = Date.now(), TTL = 43200 * 1000;
    eq('fresh token (11h left): not renewed', ctx.renewSession_({ uid: 'U', exp: now + TTL * 0.9 }), '');
    ok_('past halfway (5h left): renewed', !!ctx.renewSession_({ uid: 'U', exp: now + TTL * 0.4 }));
    ok_('nearly gone (1 min left): renewed', !!ctx.renewSession_({ uid: 'U', exp: now + 60000 }));
    eq('already expired: refused', ctx.renewSession_({ uid: 'U', exp: now - 1000 }), '');
    eq('no session at all: refused', ctx.renewSession_(null), '');

    const code = R('src/Code.gs');
    ok_('the renewed token rides back on a normal reply', /function withRenewal_/.test(code));
    ok_('...on single calls', /return jsonOut_\(withRenewal_\(\{ ok: true, data: handler\(payload\) \}, sess\)\);/.test(code));
    ok_('...and on batches', /action === 'batch'[\s\S]{0,160}withRenewal_/.test(code));
    ok_('a failure to renew can never take the request down', /try \{ var t = renewSession_\(sess\); [\s\S]{0,80}catch \(e\) \{\}/.test(code));
  }

  console.log('\n2) CLIENT: it picks the renewed token up and uses it from then on');
  {
    let n = 0;
    const c = boot(b => { n++; const r = anyReply(b); if (n === 1) r.token = 'NEWTOKEN.SIG'; return r; });
    await c.api('classList', {});
    eq('the new token is stored on the device', c.__store['atom_session_token'], 'NEWTOKEN.SIG');
    await c.api('myLeaves', {});
    const last = c.__sent[c.__sent.length - 1];
    eq('...and sent with the next request', last.token, 'NEWTOKEN.SIG');
  }

  console.log('\n3) CLIENT: an expired session signs back in instead of ejecting the user');
  {
    let signedIn = false, tries = 0;
    const c = boot(b => {
      if (b.action === 'auth') { signedIn = true; return { ok: true, data: { role: 'teacher' } }; }
      if (b.action === 'myLeaves' || (b.action === 'batch')) {
        tries++;
        if (tries === 1 && !signedIn) return { ok: false, error: { code: 'NO_SESSION', message: 'เซสชันหมดอายุ' } };
      }
      return anyReply(b);
    });
    c.window.__atomReauth = async () => { await c.api('auth', {}); return true; };
    const got = await c.api('myLeaves', {});
    ok_('the call succeeds — the user never sees an error', Array.isArray(got));
    ok_('it signed in again behind the scenes', signedIn);
  }
  {
    // LINE cannot vouch for them either → the error must surface, not be swallowed
    const c = boot(b => ({ ok: false, error: { code: 'NO_SESSION', message: 'เซสชันหมดอายุ' } }));
    c.window.__atomReauth = async () => false;
    let err = null;
    await c.api('classList', {}).catch(e => { err = e; });
    ok_('a genuine sign-out is still reported', err && err.code === 'NO_SESSION');
  }
  {
    // this is the one that could take money twice if it were wrong
    let attempts = 0, signedIn = false;
    const c = boot(b => {
      if (b.action === 'auth') { signedIn = true; return { ok: true, data: { role: 'parent' } }; }
      if (b.action === 'payCombined') { attempts++; if (attempts === 1) return { ok: false, error: { code: 'NO_SESSION', message: 'x' } }; }
      return anyReply(b);
    });
    c.window.__atomReauth = async () => { await c.api('auth', {}); return true; };
    await c.api('payCombined', { amount: 100 });
    eq('the payment reached the server exactly ONCE after signing in', attempts, 2);
    ok_('...which is safe only because NO_SESSION is refused before the handler runs',
      /if \(sessionRequired_\(\) && !publicAction_\(action\) && !sess\)[\s\S]{0,140}NO_SESSION/.test(R('src/Code.gs')));
  }
  {
    let auths = 0;
    const c = boot(b => {
      if (b.action === 'auth') { auths++; return { ok: true, data: { role: 'teacher' } }; }
      return { ok: false, error: { code: 'NO_SESSION', message: 'x' } };
    });
    c.window.__atomReauth = async () => { await c.api('auth', {}); return true; };
    await Promise.all([c.api('classList', {}).catch(() => {}), c.api('myLeaves', {}).catch(() => {}), c.api('notifications', {}).catch(() => {})]);
    eq('three failing screens share ONE sign-in, not three', auths, 1);
  }
  {
    const src = R('webapp/api.js');
    ok_('auth itself never tries to re-auth (that would loop forever)', /action === 'auth'\) throw e/.test(src));
    const app = R('webapp/app.js');
    ok_('the hook exists in the app', /window\.__atomReauth = async/.test(app));
    ok_('it goes through LINE rather than asking for a password', /liff\.getAccessToken\(\)/.test(app));
    ok_('an unregistered account is not treated as signed in', /u\.role !== 'guest'/.test(app));
    ok_('it can never throw into the caller', /window\.__atomReauth = async[\s\S]{0,700}catch \(e\) \{ return false; \}/.test(app));
  }

  console.log('\n4) iOS: a request the phone cancelled is retried, not shown as a crash');
  {
    let n = 0;
    const c = boot(b => { if (b.action === 'classList' || b.action === 'batch') { n++; if (n === 1) return 'NETFAIL'; } return anyReply(b); });
    const got = await c.api('classList', {});
    ok_('the screen still loads', Array.isArray(got));
    eq('it was retried once', n, 2);
  }
  {
    // backgrounded: retrying immediately just gets cancelled again, so wait to be back on screen
    let n = 0;
    const c = boot(b => { if (b.action === 'classList') { n++; if (n === 1) return 'NETFAIL'; } return anyReply(b); });
    c.document.hidden = true;
    const p = c.api('classList', {});
    await wait(120);
    eq('nothing is retried while the app is in the background', n, 1);
    c.document.hidden = false; c.__fire('visibilitychange');
    const got = await p;
    ok_('and it completes when the user comes back', Array.isArray(got));
    eq('...on the second attempt', n, 2);
  }
  {
    // a write must NOT be repeated: it may already have been applied before the connection dropped
    let n = 0;
    const c = boot(b => { if (b.action === 'payCombined') { n++; return 'NETFAIL'; } return anyReply(b); });
    let err = null;
    await c.api('payCombined', { amount: 100 }).catch(e => { err = e; });
    eq('the payment was sent once and not repeated', n, 1);
    ok_('and the failure is reported', !!err);
    ok_('with something a parent can act on, not "Load failed"',
      err && /อินเทอร์เน็ต/.test(err.message) && !/Load failed/.test(err.message));
    eq('...tagged so it can be counted separately from a server error', err && err.code, 'OFFLINE');
  }
  {
    const src = R('webapp/api.js');
    ok_('the wait for the foreground cannot hang forever', /removeEventListener\('visibilitychange', on\); r\(\); \}, 30000\)/.test(src));
    ok_('a batch is only retried if EVERY call in it is safe to repeat',
      /catch \(netErr\)[\s\S]{0,300}calls\) \|\| \[\]\)\.every\(c => RETRY_SAFE\(c\.action\)\)/.test(src));
  }

  console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' : 'ALL PASS ') + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})();
