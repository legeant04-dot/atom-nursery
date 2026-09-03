/**
 * Perf.gs — Phase 0 telemetry sink + summary
 * ------------------------------------------------------------------
 * WHY THIS EXISTS
 * PageSpeed / Lighthouse can only ever measure the signed-out login page. Every complaint we have
 * had — "the finance screen takes forever", "it errors on my phone", the v186 batch incident — comes
 * from AFTER sign-in, behind LINE, where no external tool can reach. So the app measures itself and
 * posts the numbers here. Three to five days of this replaces guessing with a ranked list.
 *
 * PDPA / PRIVACY
 * A row carries NO name, NO student / parent / staff id and NO payload — only:
 *   the action name, how long it took, whether it failed (+ error code), coarse device class,
 *   connection class, app version, and a session id that is random per browser session.
 * The session id exists only to tell "one phone had 40 slow calls" apart from "40 phones had one
 * each". It is never written next to a person. `sanitizeText_` below strips anything that looks
 * like an id or an e-mail out of free-text error messages before they are stored.
 *
 * SECURITY — this route is reachable WITHOUT a session token, on purpose:
 * the most valuable rows are the ones from a user who could NOT sign in (exactly the failure
 * reported on 2026-08-03), and those have no token by definition. That makes it an unauthenticated
 * write, so it is deliberately fenced in:
 *   - it can only ever touch PERF_LOG, which no business logic reads;
 *   - every field is whitelisted, coerced to a primitive and length-capped (no formula injection:
 *     a leading = / + / - / @ is prefixed with ');
 *   - at most MAX_ROWS_PER_CALL rows per request, and an oversized body is rejected outright;
 *   - the sheet is trimmed to MAX_KEEP rows, so it cannot grow without bound;
 *   - it takes its OWN lock, never the write lock, so flooding it cannot stall real writes;
 *   - SCHOOL_CONFIG PerfLog='off' disables collection for everyone, instantly.
 * Reading the data back (perfSummary) is admin-only.
 */

var PERF_SHEET = 'PERF_LOG';
var PERF_HEADERS = ['Ts', 'Sid', 'Role', 'Type', 'Action', 'Ms', 'Ok', 'Code', 'Batch', 'Screen', 'Dev', 'Net', 'Pwa', 'Ver'];
var PERF_MAX_ROWS_PER_CALL = 60;
var PERF_MAX_KEEP = 20000;          // ~4 days of a 30-user school; older rows are dropped

function perfEnabled_() {
  try { return String(getConfig_('PerfLog', 'on')).toLowerCase() !== 'off'; } catch (e) { return true; }
}

/** Get (or create) the log sheet. Isolated: nothing else in the app reads it. */
function perfSheet_() {
  var ss = getMainSpreadsheet_();
  var sh = ss.getSheetByName(PERF_SHEET);
  if (!sh) {
    sh = ss.insertSheet(PERF_SHEET);
    sh.getRange(1, 1, 1, PERF_HEADERS.length).setValues([PERF_HEADERS]);
    sh.setFrozenRows(1);
    try { sh.getRange(1, 1, 1, PERF_HEADERS.length).setFontWeight('bold'); } catch (e) {}
  }
  return sh;
}

/**
 * A value going into a cell must be inert. Sheets treats a leading = + - @ as a formula, so a
 * crafted "error message" could otherwise become a live formula in the school's spreadsheet.
 */
function perfCell_(v, max) {
  var s = (v === null || v === undefined) ? '' : String(v);
  s = s.replace(/[\r\n\t]+/g, ' ');
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s.slice(0, max || 60);
}
function perfNum_(v, max) {
  var n = Number(v);
  if (!isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n), max || 3600000);
}
/**
 * Free-text (error messages) is the only field we do not fully control, so scrub the shapes that
 * could carry personal data before it is ever written: our own record ids, e-mail addresses, LINE
 * uids and long digit runs (phone / national id).
 */
function perfText_(v) {
  var s = perfCell_(v, 200);
  s = s.replace(/\b(STD|PAR|STF|BL|PS|OT|ATR|INJ)-[A-Za-z0-9\-]+/g, '$1-…');
  s = s.replace(/[\w.+-]+@[\w.-]+\.\w+/g, '…@…');
  s = s.replace(/\bU[0-9a-f]{20,}\b/gi, 'Uxxx');
  s = s.replace(/\d{9,}/g, '…');
  return s;
}

/**
 * Append a batch of telemetry rows. Best-effort by contract: any failure returns ok:false and is
 * never allowed to propagate, because a telemetry problem must not become a user-facing error.
 */
function handlePerfLog(p) {
  try {
    if (!perfEnabled_()) return { ok: false, skipped: 'off' };
    p = p || {};
    var rows = p.rows;
    if (!rows || !rows.length) {
      if (!p.hit && !p.miss) return { ok: true, written: 0 };
      rows = [];
    }
    if (!Array.isArray(rows)) return { ok: false, skipped: 'bad-rows' };
    if (rows.length > PERF_MAX_ROWS_PER_CALL) rows = rows.slice(0, PERF_MAX_ROWS_PER_CALL);

    // Role comes from the VERIFIED session, never from the client. No token (a signed-out or
    // failing-to-sign-in user) is itself a fact worth recording, so it is stored as 'anon'.
    var role = 'anon';
    try { var sess = p.__sess; if (sess && sess.role) role = String(sess.role).slice(0, 12); } catch (e) {}

    var sid = perfCell_(p.sid, 20), dev = perfCell_(p.dev, 10), net = perfCell_(p.net, 8),
        ver = perfCell_(p.ver, 20), pwa = p.pwa ? 1 : 0;
    var ts = perfStamp_(new Date());

    var out = rows.map(function (r) {
      r = r || {};
      return [ts, sid, role, perfCell_(r.t, 8), perfCell_(r.a, 40), perfNum_(r.ms), (r.ok ? 1 : 0),
              perfText_(r.c), perfNum_(r.b, 50), perfCell_(r.s, 30), dev, net, pwa, ver];
    });
    // one aggregate row for the read-cache counters (far too frequent to log individually)
    if (p.hit || p.miss) {
      out.push([ts, sid, role, 'cache', 'readCache', 0, 1, '', perfNum_(p.hit, 100000), 'hit', dev, net, pwa, ver]);
      out.push([ts, sid, role, 'cache', 'readMiss', 0, 1, '', perfNum_(p.miss, 100000), 'miss', dev, net, pwa, ver]);
    }
    if (!out.length) return { ok: true, written: 0 };

    // Its OWN lock. Using the script write-lock would let telemetry queue behind — and worse, ahead
    // of — a real save. If we cannot get it quickly, drop the batch: losing samples is fine.
    var lock = null;
    try { lock = LockService.getDocumentLock(); } catch (e) { lock = null; }
    if (lock && !lock.tryLock(5000)) return { ok: false, skipped: 'busy' };
    try {
      var sh = perfSheet_();
      var start = Math.max(sh.getLastRow(), 1) + 1;
      sh.getRange(start, 1, out.length, PERF_HEADERS.length).setValues(out);
      perfTrim_(sh);
    } finally { if (lock) { try { lock.releaseLock(); } catch (e) {} } }
    return { ok: true, written: out.length };
  } catch (err) {
    try { Logger.log('perfLog failed: ' + (err && err.stack || err)); } catch (x) {}
    return { ok: false, skipped: 'error' };
  }
}

function perfTz_() {
  try { return getMainSpreadsheet_().getSpreadsheetTimeZone() || 'Asia/Bangkok'; } catch (e) { return 'Asia/Bangkok'; }
}

/**
 * A timestamp that SORTS. Every number in this report depends on it, and it was wrong.
 *
 * The rows are written as 'yyyy-MM-dd HH:mm:ss', which sorts correctly as text — but Sheets stores
 * that as a DATE, and getValues() hands it back as a Date object. `String(date)` is
 * "Fri Aug 21 2026 10:00:00 GMT+0700", which starts with the WEEKDAY. Two consequences, neither
 * visible in the numbers themselves:
 *
 *   - the "last N days" filter compared "Fri Aug 21…" against "2026-08-14…". Digits sort before
 *     letters, so every row passed. The report has been covering the whole log, not the window it
 *     printed, so figures from two reports were never over the same period.
 *   - the header read "Fri Aug 21 2026 -> Wed Aug 19 2026", because min and max were alphabetical
 *     by weekday name.
 *
 * Same trap as the holiday times (v251): a Sheets cell read back as a Date and treated as a string.
 */
/**
 * Answers the server gives ON PURPOSE. Every one of these is the rule working: the person was
 * outside the geofence, had already clocked in, left a required field empty, tried to edit a journal
 * the parent has already been sent. None of them is a fault in the app, and counting them as
 * failures put "staffCheckin 53%" at the top of a report where it drowned the things that were.
 *
 * Adding to this list is a deliberate act. Anything not listed is OURS until proven otherwise —
 * which is the right way round for a list that decides what we stop looking at.
 */
var PERF_EXPECTED_ = {
  OUT_OF_RANGE: 1,          // standing away from the school — the geofence doing its job
  ALREADY_CHECKED_IN: 1, ALREADY_CHECKED_OUT: 1,   // the server refusing a duplicate punch
  MISSING_FIELDS: 1, BAD_INPUT: 1,                 // a form submitted incomplete
  FUTURE_TIME: 1,           // an injury timed later than now — the form catching a typing slip
  JOURNAL_LOCKED: 1,        // already sent to the parent
  ON_LEAVE: 1,              // the family told us the child is away today
  SCHOOL_CLOSED: 1, NOT_STARTED: 1, STUDENT_PAUSED: 1,
  STUDENT_DAY_OFF: 1,       // this child's agreed weekly day off — the arrangement, not a fault
  ENDED: 1,                 // a staff member whose last working day has passed — the door, working
  NO_PERMISSION: 1, READ_ONLY: 1,                  // asking for something this role may not have
  ALREADY_PAID: 1, DUPLICATE: 1, NOT_FOUND: 1,
  /* The onboarding guards. These became visible only once the engine's fail() started passing its
   * code through (it was setting `code` where dispatch_ reads `apiCode`, so every one of them
   * arrived as INTERNAL). They are rules working, not the app failing:
   *   ALREADY_REGISTERED — the school already has this parent or child on file, so nothing is
   *     created twice. This is the guard added after the registration form made 84 duplicate
   *     parents; a parent re-tapping the button SHOULD hit it.
   *   VERIFY_FAILED — the national id typed does not match the record being claimed. That is the
   *     identity check refusing, and it is the only thing standing between a stranger and somebody
   *     else's child.
   *   AMOUNT_MISMATCH — the slip's total does not match what is owed. */
  ALREADY_REGISTERED: 1, VERIFY_FAILED: 1, AMOUNT_MISMATCH: 1,
  // a slip this school has already taken money against, offered for something else — the reuse
  // check refusing, which is the point of storing the bank reference at all
  SLIP_ALREADY_USED: 1
};

/**
 * WHAT A SCREEN SHOULD COST, in round trips per visit.
 *
 * Not a limit the code enforces — a screen that needs more must be allowed to have more. It is the
 * number that makes growth VISIBLE: every request queues behind the last one (Apps Script runs a
 * single execution at a time per user), so a screen quietly going from four requests to nine is
 * twice the wait, with no individual call getting any slower and nothing in the report to say why.
 *
 * Batching is why these are as low as they are: a screen fetching six things in one batch counts as
 * ONE. So a number well over budget usually means something was added outside the batch.
 *
 * Raising a figure here is a decision, taken once, with a reason — not something that happens by
 * itself over six releases.
 */
var SCREEN_BUDGET_DEFAULT_ = 4;
var SCREEN_BUDGET_ = {
  home: 6,        // the busiest screen in the app, for every role
  finance: 8,     // bills, slips, payroll and the month's totals
  leaves: 6,      // approvals + both calendars
  manage: 5,
  class: 4, journal: 4, checkin: 3, payment: 5, growth: 3, dspm: 4,
  chat: 2, schedule: 4, leave: 4, absence: 3, daily: 3, injury: 3
};

function perfStamp_(d) { return Utilities.formatDate(d, perfTz_(), 'yyyy-MM-dd HH:mm:ss'); }
function perfTs_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return perfStamp_(v);
  return String(v == null ? '' : v);
}

/** Keep the sheet bounded: drop the oldest rows once it passes the cap. */
function perfTrim_(sh) {
  try {
    var n = sh.getLastRow() - 1;
    if (n <= PERF_MAX_KEEP) return;
    var drop = n - PERF_MAX_KEEP;
    sh.deleteRows(2, drop);
  } catch (e) {}
}

// ---- reading it back (admin only) --------------------------------------------------------
/**
 * Ranked summary of the collected data. Deliberately opinionated: it answers the four questions
 * Phase 0 exists to answer, rather than dumping rows.
 *   1. which ACTIONS are slow (p50 / p95 / worst, and how often they run)
 *   2. which SCREENS are slow to draw
 *   3. what is FAILING, ranked by how many people it hit
 *   4. is it everyone, or one device / connection class
 */
function handlePerfSummary(p) {
  p = p || {};
  var days = Math.min(Math.max(Number(p.days) || 7, 1), 30);
  var ss = getMainSpreadsheet_();
  var sh = ss.getSheetByName(PERF_SHEET);
  if (!sh || sh.getLastRow() < 2) {
    return { empty: true, enabled: perfEnabled_(), days: days,
             note: 'ยังไม่มีข้อมูล — ระบบเพิ่งเริ่มเก็บ ลองใช้งานสักพักแล้วกลับมาดูใหม่' };
  }
  var last = sh.getLastRow();
  var vals = sh.getRange(2, 1, last - 1, PERF_HEADERS.length).getValues();
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
  var cutStr = perfStamp_(cutoff);

  var acts = {}, screens = {}, errs = {}, devs = {}, nets = {}, sids = {}, boot = {}, roles = {};
  var healed = {}, healedTotal = 0;
  var cacheHit = 0, cacheMiss = 0, total = 0, failed = 0, firstTs = '', lastTs = '', skipped = 0;
  var refusedTotal = 0, refusals = {};

  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    var ts = perfTs_(r[0]);
    if (ts < cutStr) { skipped++; continue; }
    if (!firstTs || ts < firstTs) firstTs = ts;
    if (ts > lastTs) lastTs = ts;
    var sid = String(r[1]), role = String(r[2] || ''), type = String(r[3]), action = String(r[4]),
        ms = Number(r[5]) || 0, ok = Number(r[6]) === 1, code = String(r[7]),
        batch = Number(r[8]) || 0, screen = String(r[9]), dev = String(r[10]), net = String(r[11]);
    sids[sid] = 1;

    if (type === 'cache') { if (action === 'readCache') cacheHit += batch; else cacheMiss += batch; continue; }
    if (type === 'boot') { (boot[action] = boot[action] || []).push(ms); continue; }
    /* A call that failed and then RECOVERED — an expired session signed back in behind the scenes
     * and the call went through. The first attempt is still recorded as a failure (it was one), but
     * without this the report showed "NO_SESSION ×10" for a morning nobody noticed, and we went
     * looking for a fault that had already fixed itself. Counted per action, and subtracted from
     * the failure count so the headline rate reflects what people actually experienced. */
    if (type === 'healed') { healed[action] = (healed[action] || 0) + 1; healedTotal++; continue; }
    if (type === 'err') {
      var ek = action + ' · ' + code;
      var e = errs[ek] || (errs[ek] = { what: action, detail: code, n: 0, users: {} });
      e.n++; e.users[sid] = 1;
      // Count it against the device too. A phone that produces NOTHING BUT errors would otherwise
      // never appear in the device breakdown — and that is precisely the phone we are looking for.
      if (dev) { devs[dev] = devs[dev] || { dev: dev, n: 0, fail: 0, ms: [] }; devs[dev].n++; devs[dev].fail++; }
      continue;
    }
    if (type === 'nav') {
      var s = screens[action] || (screens[action] = { screen: action, n: 0, ms: [] });
      s.n++; s.ms.push(ms); continue;
    }
    // type === 'api'
    total++;
    /* REFUSED IS NOT BROKEN. "staffCheckin fail 53%" was six people standing outside the geofence
     * and four tapping a button they had already used — the server working exactly as designed,
     * reported as though the app were falling over. Mixed into the headline it hides the failures
     * that ARE ours, and a report that cries wolf stops being read. Counted separately, and kept
     * out of the failure figures. */
    var refused = !ok && PERF_EXPECTED_[code] === 1;
    if (refused) { refusedTotal++; refusals[code] = (refusals[code] || 0) + 1; }
    var a = acts[action] || (acts[action] = { action: action, n: 0, fail: 0, refused: 0, ms: [], codes: {} });
    a.n++; a.ms.push(ms);
    if (!ok) { a.codes[code || 'ERR'] = (a.codes[code || 'ERR'] || 0) + 1;
      if (refused) a.refused++; else { a.fail++; failed++; } }
    if (dev) devs[dev] = devs[dev] || { dev: dev, n: 0, fail: 0, ms: [] };
    if (dev) { devs[dev].n++; devs[dev].ms.push(ms); if (!ok && !refused) devs[dev].fail++; }
    /* "Desktop p50 10.7s vs Android 5.8s" invited the conclusion that desktops are slow. They are
     * not: the office computer is the ADMIN, whose screens (finance, payroll, the dashboard) ask for
     * far more than a parent's do, and whose browser stays open all day. The role is already
     * recorded on every row — verified server-side, never self-reported — so summarise it, and the
     * device breakdown stops being read as a claim about hardware. */
    if (role) { roles[role] = roles[role] || { role: role, n: 0, fail: 0, ms: [], sids: {} };
      roles[role].n++; roles[role].ms.push(ms); roles[role].sids[sid] = 1; if (!ok && !refused) roles[role].fail++; }
    if (net) nets[net] = nets[net] || { net: net, n: 0, ms: [] };
    if (net) { nets[net].n++; nets[net].ms.push(ms); }
    if (screen) {
      var sc = screens[screen] || (screens[screen] = { screen: screen, n: 0, ms: [] });
      sc.apiN = (sc.apiN || 0) + 1; sc.apiMs = (sc.apiMs || 0) + ms;
      /* ROUND TRIPS, WHICH IS WHAT THE BUDGET IS ABOUT — and what this was NOT counting.
       *
       * api.js micro-batches every call made in the same tick into ONE request, and records the
       * batch size on each row. This counted the ROWS, so a screen that fetches nine things in one
       * request was reported as nine and flagged over a budget of four — while a screen making four
       * separate requests, which is genuinely four times slower, looked fine. The comment on
       * perVisit has always described round trips ("a screen that grew from 4 requests to 9"); the
       * arithmetic underneath it counted actions.
       *
       * Each row is 1/batch of a request, so the batch's rows sum back to exactly 1. A row from
       * before the Batch column existed reads 0 and is treated as its own request, which is what it
       * was. Nothing new is collected — the column has been filled in all along. */
      sc.trips = (sc.trips || 0) + (1 / (batch > 0 ? batch : 1));
    }
  }

  var pct = function (arr, q) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (x, y) { return x - y; });
    return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * q))]);
  };
  var statify = function (o) {
    return { p50: pct(o.ms, 0.5), p95: pct(o.ms, 0.95), max: o.ms.length ? Math.round(Math.max.apply(null, o.ms)) : 0 };
  };

  // Slowest actions, ranked by TOTAL time spent waiting (n × p50), not by p50 alone — a 4s call
  // that runs once matters far less than a 900ms call on every screen.
  var slowest = Object.keys(acts).map(function (k) {
    var a = acts[k], st = statify(a);
    return { action: a.action, n: a.n, fail: a.fail, p50: st.p50, p95: st.p95, max: st.max,
             cost: Math.round(a.n * st.p50 / 1000), codes: a.codes };
  }).sort(function (x, y) { return y.cost - x.cost; }).slice(0, 20);

  /* CALLS PER VISIT — the number a screen's cost is actually made of, and the one nobody could see.
   * Every round trip queues behind the last (Apps Script runs one execution at a time per user), so a
   * screen that grew from 4 requests to 9 got twice as slow without any single call getting slower —
   * and the report, which only ever showed p50 and p95, made that look like the server having a bad
   * week. It is not a limit the code enforces; it is the figure that makes the growth visible while
   * it is still one screen and not the whole app. SCREEN_BUDGET_ is what we think each should need.
   */
  var slowScreens = Object.keys(screens).map(function (k) {
    var s = screens[k], st = statify({ ms: s.ms || [] });
    // REQUESTS per visit, not actions per visit — see sc.trips above for why those are not the same
    var per = s.n ? Math.round((s.trips || 0) / s.n * 10) / 10 : 0;
    // ...and the action count kept alongside it, because the gap between the two IS the batching
    // working. A screen at 20 actions and 2 requests is doing the right thing; the old number
    // would have condemned it.
    var perAct = s.n ? Math.round((s.apiN || 0) / s.n * 10) / 10 : 0;
    var budget = SCREEN_BUDGET_[s.screen] != null ? SCREEN_BUDGET_[s.screen] : SCREEN_BUDGET_DEFAULT_;
    return { screen: s.screen, n: s.n, p50: st.p50, p95: st.p95, max: st.max,
             apiCalls: s.apiN || 0, apiMs: s.apiMs || 0,
             perVisit: per, actionsPerVisit: perAct, budget: budget, over: per > budget };
  }).filter(function (s) { return s.n > 0; }).sort(function (x, y) { return y.p95 - x.p95; }).slice(0, 20);

  var problems = Object.keys(errs).map(function (k) {
    var e = errs[k];
    return { what: e.what, detail: e.detail, n: e.n, users: Object.keys(e.users).length };
  }).sort(function (x, y) { return (y.users - x.users) || (y.n - x.n); }).slice(0, 25);

  // failing ACTIONS are a different question from crashing screens — rank them separately
  // ranked by REAL failures. An action that only ever refuses on purpose does not belong on a list
  // headed FAILING — the refusals are still shown beside it, so nothing is hidden.
  var failing = Object.keys(acts).filter(function (k) { return acts[k].fail > 0; }).map(function (k) {
    var a = acts[k];
    return { action: a.action, n: a.n, fail: a.fail, refused: a.refused || 0,
             rate: Math.round(a.fail / a.n * 100), codes: a.codes };
  }).sort(function (x, y) { return y.fail - x.fail; }).slice(0, 20);

  var byDev = Object.keys(devs).map(function (k) {
    var d = devs[k], st = statify(d);
    return { dev: d.dev, n: d.n, fail: d.fail, rate: d.n ? Math.round(d.fail / d.n * 100) : 0, p50: st.p50, p95: st.p95 };
  }).sort(function (x, y) { return y.n - x.n; });

  // calls PER SESSION is the number Phase 1 set out to move: it was 71, and it is the reason every
  // action queued behind another. A total on its own hides it — 17,308 calls means nothing until you
  // know how many visits produced them.
  var byRole = Object.keys(roles).map(function (k) {
    var t = roles[k], st = statify(t), ns = Object.keys(t.sids).length;
    return { role: t.role, n: t.n, sessions: ns, perSession: ns ? Math.round(t.n / ns) : 0,
      fail: t.fail, p50: st.p50, p95: st.p95 };
  }).sort(function (x, y) { return y.n - x.n; });

  var byNet = Object.keys(nets).map(function (k) {
    var t = nets[k], st = statify(t);
    return { net: t.net, n: t.n, p50: st.p50, p95: st.p95 };
  }).sort(function (x, y) { return y.n - x.n; });

  var bootStats = Object.keys(boot).map(function (k) {
    return { mark: k, n: boot[k].length, p50: pct(boot[k], 0.5), p95: pct(boot[k], 0.95) };
  });

  var allMs = [];
  Object.keys(acts).forEach(function (k) { allMs = allMs.concat(acts[k].ms); });

  return {
    empty: false, enabled: perfEnabled_(), days: days,
    from: firstTs, to: lastTs,
    sessions: Object.keys(sids).length,
    calls: total, failed: failed,
    failRate: total ? Math.round(failed / total * 1000) / 10 : 0,
    p50: pct(allMs, 0.5), p95: pct(allMs, 0.95),
    cacheHit: cacheHit, cacheMiss: cacheMiss,
    cacheRate: (cacheHit + cacheMiss) ? Math.round(cacheHit / (cacheHit + cacheMiss) * 100) : 0,
    slowest: slowest, slowScreens: slowScreens, problems: problems, failing: failing,
    byDev: byDev, byNet: byNet, byRole: byRole, boot: bootStats,
    // failures that recovered by themselves, and what is left after taking them out
    healed: healedTotal,
    healedBy: Object.keys(healed).map(function (k) { return { action: k, n: healed[k] }; })
      .sort(function (x, y) { return y.n - x.n; }).slice(0, 10),
    realFailed: Math.max(0, failed - healedTotal),
    realFailRate: total ? Math.round(Math.max(0, failed - healedTotal) / total * 1000) / 10 : 0,
    perSession: Object.keys(sids).length ? Math.round(total / Object.keys(sids).length) : 0,
    rows: Math.max(0, sh.getLastRow() - 1), cap: PERF_MAX_KEEP,
    /* The window may be shorter than the one asked for. The log is capped, so once it is full the
     * oldest rows are dropped — and if NOTHING was skipped as too old, the earliest row we have is
     * younger than the cutoff and the report covers less than `days`. Saying so is the difference
     * between "the school got quieter" and "we are looking at a shorter period". */
    older: skipped,
    truncated: (skipped === 0 && Math.max(0, sh.getLastRow() - 1) >= PERF_MAX_KEEP),
    // refused on purpose — the rule working, not the app failing (see PERF_EXPECTED_)
    refused: refusedTotal,
    refusedBy: Object.keys(refusals).map(function (k) { return { code: k, n: refusals[k] }; })
      .sort(function (x, y) { return y.n - x.n; })
  };
}

/** Admin: wipe the log (after acting on it, or to start a clean measurement window). */
function handlePerfClear(p) {
  var ss = getMainSpreadsheet_();
  var sh = ss.getSheetByName(PERF_SHEET);
  if (!sh || sh.getLastRow() < 2) return { cleared: 0 };
  var n = sh.getLastRow() - 1;
  sh.deleteRows(2, n);
  return { cleared: n };
}
