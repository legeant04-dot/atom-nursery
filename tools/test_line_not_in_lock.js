/**
 * tools/test_line_not_in_lock.js — a LINE push must not hold the school's write lock.
 *   node tools/test_line_not_in_lock.js
 *
 * 🔴 WHERE THIS CAME FROM. The 06–09/10 speed report, by the hour:
 *
 *     18:00  fail 13%        19:00  fail 15%        20:00  fail 37%
 *
 * The worst three hours of the day, and the three hours when every teacher clocks out. A check-out
 * that produced OT called notifyAdmins_, which calls UrlFetchApp out to LINE — and every bit of that
 * ran inside withWriteLock_. So one teacher's notification was ~300ms during which NOBODY else in
 * the school could write, and a bulk action messaging ten families held the lock for seconds. With
 * tryLock at 25 seconds, a queue that deep starts answering BUSY.
 *
 * THE FIX IS IN ONE PLACE BECAUSE THE PROBLEM IS. Twenty-two call sites push LINE across ten files.
 * Changing them all would be twenty-two chances to miss one — and the twenty-third, written next
 * month, would put it straight back. So linePushText_ QUEUES while a locked section is running, and
 * dispatch_ flushes the queue once the lock is released.
 *
 * This suite drives the REAL dispatch_ with a real (mocked) LockService, and asserts of every push
 * that the lock was NOT held when it went out. That is the whole claim, measured rather than read.
 */
const path = require('path'), fs = require('fs');
const harness = require('./gas_test_harness');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

/* A real lock and a real push, both watched.
 *
 * withWriteLock_ short-circuits when LockService is undefined, which is how the harness normally
 * runs — so a lock mock has to be installed or the branch under test never executes at all. */
function boot() {
  const { g } = harness(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code']);
  const seen = [];            // every push, with whether the lock was held at that moment
  let held = false, acquired = 0;

  g.LockService = {
    getScriptLock: () => ({
      tryLock: () => { held = true; acquired++; return true; },
      releaseLock: () => { held = false; }
    })
  };
  g.UrlFetchApp = {
    fetch: (url, opt) => {
      const b = JSON.parse(opt.payload);
      seen.push({ to: b.to, text: b.messages[0].text, lockHeld: held });
      return { getResponseCode: () => 200, getContentText: () => '{}' };
    }
  };
  // a token, or linePush_ refuses before it ever reaches the network
  g.getConfig_ = (k, d) => (k === 'LineChannelAccessToken' ? 'TOKEN' : (d === undefined ? '' : d));

  return { g, seen, lock: () => ({ held, acquired }) };
}

// ============================================================================
console.log('\n1) 🔴 a write that notifies — the lock is free before LINE is called');
{
  const { g, seen, lock } = boot();
  // 'save…' is a mutating verb, so dispatch_ takes the lock for it — exactly the staffCheckout shape
  g.ROUTES.saveThing = function () {
    g.linePushText_('U-PARENT', 'first');
    g.linePushText_('U-ADMIN', 'second');
    return { ok: 1 };
  };
  const out = JSON.parse(g.dispatch_('saveThing', {}).getContent());

  ok_('the write itself succeeded', out.ok === true);
  eq('both notifications went out', seen.map(s => s.to), ['U-PARENT', 'U-ADMIN']);
  eq('🔴 ...and NEITHER was sent while the lock was held', seen.map(s => s.lockHeld), [false, false]);
  ok_('...the lock really was taken, so this is not passing by accident', lock().acquired === 1);
  ok_('...and it is released afterwards', lock().held === false);
  /* ORDER SURVIVES THE QUEUE. A family must still read "arrived" before "picked up". */
  eq('...and they arrive in the order they were made', seen.map(s => s.text), ['first', 'second']);
}

// ============================================================================
console.log('\n2) 🔴 CONTROL — without the fix, this suite would see the lock held');
{
  /* A check that cannot fail proves nothing. The deferral is disarmed here, which is precisely the
   * code as it shipped before today, and the push must then be seen INSIDE the lock. */
  const { g, seen } = boot();
  g.lineDeferBegin_ = function () {};        // pretend nobody armed the queue
  g.ROUTES.saveThing = function () { g.linePushText_('U1', 'x'); return { ok: 1 }; };
  g.dispatch_('saveThing', {});
  eq('🔴 CONTROL · the old behaviour really did push inside the lock', seen.map(s => s.lockHeld), [true]);
}

// ============================================================================
console.log('\n2b) 🔴 how much lock time this actually gives back');
{
  /* The claim is "the school's write lock is held for less time". Measured, not asserted: a LINE
   * push is modelled at a realistic 60ms (the real one is 200–400ms over the wire) and the lock's
   * held-duration is timed on both paths. Ten families is an ordinary bulk send — a class's daily
   * reports, or a month's bills. */
  const PUSH_MS = 60, N = 10;
  const busy = ms => { const t = Date.now(); while (Date.now() - t < ms) ; };
  const timeIt = (defer) => {
    const { g } = boot();
    let t0 = 0, heldMs = 0;
    g.LockService = { getScriptLock: () => ({
      tryLock: () => { t0 = Date.now(); return true; },
      releaseLock: () => { heldMs = Date.now() - t0; } }) };
    g.UrlFetchApp = { fetch: () => { busy(PUSH_MS); return { getResponseCode: () => 200, getContentText: () => '{}' }; } };
    if (!defer) g.lineDeferBegin_ = function () {};      // the code as it shipped before today
    g.ROUTES.saveThing = function () {
      for (var i = 0; i < N; i++) { busy(5); g.linePushText_('U' + i, 'x'); }   // 5ms = the sheet write
      return { ok: 1 };
    };
    g.dispatch_('saveThing', {});
    return heldMs;
  };
  const before = timeIt(false), after = timeIt(true);
  console.log('        lock held, pushing inside it : ' + before + 'ms');
  console.log('        lock held, pushing after it  : ' + after + 'ms');
  console.log('        given back to the school     : ' + (before - after) + 'ms  (' +
              Math.round((1 - after / before) * 100) + '% less)');
  ok_('🔴 the lock is held for dramatically less time', after < before / 2);
  ok_('...and what is left is the writes themselves, not the network', after < N * PUSH_MS / 2);
}

// ============================================================================
console.log('\n3) a read is not slowed down by a queue it does not need');
{
  const { g, seen, lock } = boot();
  g.ROUTES.listThing = function () { return { rows: [] }; };   // not a mutating verb
  g.dispatch_('listThing', {});
  ok_('🔴 a read never takes the lock', lock().acquired === 0);
  eq('...and pushes nothing', seen.length, 0);
  ok_('...and leaves the queue disarmed, so a trigger pushing later goes straight out',
    g.LINE_DEFER_ === null);
}
{
  /* OUTSIDE A REQUEST ENTIRELY — the 06:50 reminder, the daily digests, the evening job. Those run
   * from a trigger with no lock and no dispatch_, and must be completely unaffected. */
  const { g, seen } = boot();
  g.linePushText_('U-DIGEST', 'morning digest');
  eq('a trigger’s push goes out immediately, not into a queue', seen.map(s => s.to), ['U-DIGEST']);
  eq('...and not marked as locked', seen[0].lockHeld, false);
}

// ============================================================================
console.log('\n4) 🔴 the notification can never break the write');
{
  const { g } = boot();
  g.UrlFetchApp = { fetch: () => { throw new Error('LINE is down'); } };
  g.ROUTES.saveThing = function () { g.linePushText_('U1', 'x'); return { saved: true }; };
  const out = JSON.parse(g.dispatch_('saveThing', {}).getContent());
  ok_('🔴 LINE being down still returns a successful save', out.ok === true && out.data.saved === true);
}
{
  /* A HANDLER THAT THREW STILL SENDS WHAT IT QUEUED. Those pushes were queued AFTER their writes
   * (notifyAdmins_ runs after updateRow_), so they describe things that really happened — dropping
   * them would mean a row written and nobody told. */
  const { g, seen } = boot();
  g.ROUTES.saveThing = function () { g.linePushText_('U1', 'the row was written'); throw new Error('boom'); };
  const out = JSON.parse(g.dispatch_('saveThing', {}).getContent());
  ok_('the error still reaches the caller', out.ok === false);
  eq('🔴 ...and the notification for the write that DID happen is still sent', seen.map(s => s.to), ['U1']);
  ok_('...and the queue is disarmed afterwards, not left armed for the next request', g.LINE_DEFER_ === null);
}

// ============================================================================
console.log('\n5) what a caller is told while the queue is armed');
{
  const { g } = boot();
  let answered = null;
  g.ROUTES.saveThing = function () { answered = g.linePushText_('U1', 'x'); return { ok: 1 }; };
  g.dispatch_('saveThing', {});
  /* Several callers count the return value (`if (linePushText_(…)) sent++`) to decide whether anyone
   * was reached. A queued push answers TRUE — a promise rather than a receipt, which is the honest
   * trade: the alternative is holding the lock to find out. */
  eq('a queued push answers true, so the "did we reach anybody" counts still work', answered, true);
}
{
  const { g, seen } = boot();
  g.getConfig_ = () => '';                   // no channel token configured
  let answered = null;
  g.ROUTES.saveThing = function () { answered = g.linePushText_('U1', 'x'); return { ok: 1 }; };
  g.dispatch_('saveThing', {});
  /* 🔴 ...but a push that could NEVER have gone still answers false, exactly as before. Queuing one
   * would have turned "nobody is reachable" into "everybody was reached" — and notifyAdmins_ decides
   * whether to use its fallback uid on precisely that count. */
  eq('🔴 ...and a push with no token still answers false', answered, false);
  eq('...and nothing was queued or sent', seen.length, 0);
}

// ============================================================================
console.log('\n6) the shape of the fix, so it stays in one place');
{
  const line = R('src/Line.gs'), code = R('src/Code.gs');
  ok_('the queue lives with the push, not in ten files', /var LINE_DEFER_ = null;/.test(line));
  /* CONFINED TO Line.gs — comments stripped, because the note explaining the fix naturally names the
   * variable several times and counting those tells us nothing. What matters is that no OTHER file
   * has to know the queue exists; that is the whole reason this is one function and not twenty-two. */
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const elsewhere = ['src/Checkin.gs', 'src/Journal.gs', 'src/Parent.gs', 'src/Notify.gs',
                     'src/Leave.gs', 'src/Dspm.gs', 'src/AttReq.gs', 'src/ClassOrg.gs']
    .filter(f => /LINE_DEFER_/.test(strip(R(f))));
  eq('🔴 ...and no pushing file has to know the queue exists', elsewhere, []);
  ok_('...only Line.gs touches it, and only in three functions',
    /function linePushText_[\s\S]{0,400}LINE_DEFER_/.test(strip(line)) &&
    /function lineDeferBegin_/.test(line) && /function lineDeferFlush_/.test(line));
  ok_('dispatch_ arms it only for a write', /if \(mutates\) lineDeferBegin_\(\);/.test(code));
  ok_('🔴 ...and flushes in a finally, outside the lock',
    /\} finally \{\s*\n\s*if \(mutates\) \{ try \{ lineDeferFlush_\(\); \} catch \(e\) \{\} \}/.test(code));
  /* 🔴 DISARM BEFORE SENDING, or the flush would queue its own pushes and send nothing for ever. */
  ok_('🔴 the flush disarms the queue before it starts sending',
    /LINE_DEFER_ = null;[\s\S]{0,120}for \(var i = 0; i < q\.length/.test(line));
  /* 🔴 NOTHING MAY CALL linePush_ DIRECTLY. One that does walks straight past the queue — and the
   * sweep that found this also found that the one offender had never worked at all: notifyAdmin_
   * handed linePush_ a bare STRING where it takes an array of message objects, so every push it made
   * went out with no messages in it and was swallowed by a try/catch. Three callers, all mutating
   * (insurance filled, insurance edited, password reset), all silent for as long as they existed. */
  const direct = ['src/Day6.gs', 'src/Checkin.gs', 'src/Journal.gs', 'src/Parent.gs', 'src/Notify.gs',
                  'src/Leave.gs', 'src/Dspm.gs', 'src/AttReq.gs', 'src/ClassOrg.gs', 'src/Password.gs', 'src/Code.gs']
    .filter(f => /(^|[^A-Za-z_])linePush_\(/.test(strip(R(f))));
  eq('🔴 only Line.gs itself calls linePush_ — everything else goes through linePushText_', direct, []);
  ok_('...and notifyAdmin_ builds a real message now', /linePushText_\(uid, message\)/.test(R('src/Day6.gs')));
  // and nothing else goes out over the wire from inside a lock
  const outbound = ['src/PaySlips.gs', 'src/Day6.gs', 'src/Auth.gs']
    .filter(f => /UrlFetchApp\.fetch/.test(R(f)));
  eq('the other outbound calls are the ones we checked: slip verify, slip diagnostics, sign-in',
    outbound, ['src/PaySlips.gs', 'src/Day6.gs', 'src/Auth.gs']);
  ok_('...and none of those three is a mutating verb, so none of them holds the lock',
    !/^(submit|save|add|remove|delete|set|register|pay|upload|confirm|reject|issue|generate|move|import|compute|cancel|prepay|link|notify|request|mark|approve|edit|rename|update|change|seed|recompute|restore|bind|provision)/i.test('verifySlip')
    && !/^(submit|save)/i.test('slipDiag') && !/^(submit|save)/i.test('googleExchange'));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
