/**
 * server/line_send.js — the fast host's ONE way out to LINE (W2 of docs/FAST_HOST_WRITES_PLAN.md)
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHO DECIDES, WHO SENDS. Whether a message goes, to whom, and what it says is decided by Apps Script's
 * own code running in server/routes.js — the topic switches, the "no LINE id, skip" rule, the emergency
 * that always goes. That code calls linePush_, which in the sandbox only WRITES DOWN { to, messages }.
 * This file sends what was written down — and only after the host has committed the write it describes.
 *
 * 🔴 A FAILED SEND NEVER FAILS THE REQUEST. The data is saved; the teacher's reply is saved; a LINE
 *    outage must not turn that into an error on somebody's screen. Same rule as lineDeferFlush_.
 * 🔴 NO DUPLICATES. Every push carries an X-Line-Retry-Key, and a retry reuses it — LINE then delivers
 *    once however many times it is asked (409 = "already accepted" = delivered).
 * 🔴 ORDER. One recipient's messages go one after another, in the order they were made ("arrived"
 *    before "picked up"); different recipients go side by side.
 * 🔴 NO TEXT IN THE LOG. The log keeps the last 6 characters of the LINE id and the result. Never the
 *    message — it is about a child (PDPA).
 * 🔴 THE TOKEN NEVER ENTERS THE SANDBOX. It is read here, from the environment (Secret Manager).
 *
 * Modes (LINE_SEND): 'capture' (the default) writes down and sends nothing — staging; 'on' sends;
 * 'off' does not even pretend, so a handler sees "no LINE" exactly as with no token on Apps Script.
 */
'use strict';
const crypto = require('crypto');

const LINE_PUSH = 'https://api.line.me/v2/bot/message/push';
const MODES = { off: 1, capture: 1, on: 1 };

function mode(env) {
  const m = String((env || process.env).LINE_SEND || 'capture').toLowerCase().trim();
  return MODES[m] ? m : 'capture';                    // a typo must never mean "send"
}
/** Does linePush_ in the sandbox answer "sent"? On Apps Script: a recipient AND a token. Here the token
 *  is the host's (on), or pretended (capture — so staging records what WOULD go). Off = no token. */
function ready(env) {
  const m = mode(env), tok = String((env || process.env).LINE_TOKEN || '');
  if (m === 'capture') return true;
  if (m === 'on') return !!tok && tok.indexOf('<FILL') !== 0;
  return false;
}
const tail = uid => String(uid || '').slice(-6);
/** a fingerprint of one push, the same on both sides — the live test compares these, never the text */
const fingerprint = p => crypto.createHash('sha256').update(String(p.to) + '\n' + JSON.stringify(p.messages)).digest('hex').slice(0, 16);

/** one HTTP attempt → 'ok' | 'dup' | 'retry:<why>' | 'fail:<why>' */
async function attempt(p, key, o) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), o.attemptMs);
  try {
    const r = await o.fetch(o.url, {
      method: 'POST', signal: ac.signal,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + o.token, 'x-line-retry-key': key },
      body: JSON.stringify({ to: p.to, messages: p.messages })
    });
    try { await r.text(); } catch (e) {}
    if (r.status === 200) return 'ok';
    if (r.status === 409) return 'dup';                 // this retry key was already accepted: delivered
    if (r.status >= 500) return 'retry:' + r.status;
    return 'fail:' + r.status;                          // 400 bad id · 401 token · 429 quota — retrying cannot help
  } catch (e) {
    return 'retry:' + (e && e.name === 'AbortError' ? 'timeout' : 'network');
  } finally { clearTimeout(timer); }
}
async function sendOne(p, o) {
  const key = crypto.randomUUID();                       // ONE key for this push, reused by its retry
  let r = await attempt(p, key, o);
  if (r.indexOf('retry:') === 0) r = await attempt(p, key, o);
  return r.indexOf('retry:') === 0 ? 'fail:' + r.slice(6) : r;
}

/**
 * Send what the routes wrote down. Never throws. Resolves within capMs whatever LINE does.
 * pushes [{ to, messages }] in the order they were made.
 * → { mode, n, sent, failed, pending, results: [{ to: last6, r }] } — nothing in it is message text
 */
async function sendAll(pushes, opts) {
  opts = opts || {};
  const env = opts.env || process.env;
  const m = mode(env), list = (pushes || []).filter(p => p && p.to);
  const out = { mode: m, n: list.length, sent: 0, failed: 0, pending: 0, results: list.map(p => ({ to: tail(p.to), r: m === 'on' ? 'pending' : m })) };
  if (!list.length || m !== 'on') return out;
  const o = { fetch: opts.fetch || globalThis.fetch, url: opts.url || LINE_PUSH, token: String(env.LINE_TOKEN || ''),
    attemptMs: opts.attemptMs || 3000 };
  if (!o.token) { out.results.forEach(x => { x.r = 'fail:no-token'; }); out.failed = list.length; return out; }
  /* per recipient, in order; recipients in parallel */
  const byTo = new Map();
  list.forEach((p, i) => { if (!byTo.has(p.to)) byTo.set(p.to, []); byTo.get(p.to).push(i); });
  const chains = [...byTo.values()].map(async idx => {
    for (const i of idx) { const r = await sendOne(list[i], o); out.results[i].r = r; }
  });
  let timer;
  const cap = new Promise(res => { timer = setTimeout(res, opts.capMs || 8000); });
  try { await Promise.race([Promise.all(chains).catch(() => {}), cap]); } finally { clearTimeout(timer); }
  out.results.forEach(x => { if (x.r === 'ok' || x.r === 'dup') out.sent++; else if (x.r === 'pending') out.pending++; else out.failed++; });
  return out;
}

/** the log line: who (last 6) and what happened — never what was said */
const logLine = (action, s) => 'line ' + action + ' ' + s.mode + ' n=' + s.n + ' sent=' + s.sent + ' failed=' + s.failed +
  (s.pending ? ' pending=' + s.pending : '') + ' ' + s.results.map(x => x.to + ':' + x.r).join(' ');

module.exports = { sendAll, mode, ready, fingerprint, logLine, tail };
