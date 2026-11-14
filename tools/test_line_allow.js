/**
 * tools/test_line_allow.js — UAT can only reach the testers' LINE, never a real family
 *   node tools/test_line_allow.js          (offline — LINE is a stub; nothing is sent)
 *
 * 2026-11-14 (ROLLOUT_PLAN · UAT). UAT runs a COPY of the Apps Script project and the fast host on a copy
 * of the real data — real parents' LINE ids — with the school's real LINE token. One switch on both
 * sides: LINE_SEND = on | allow | off, LINE_ALLOW = the testers' LINE ids.
 *
 *   A  Apps Script (src/Line.gs, run as-is)
 *      1  🔴 nothing set, on Sheets → sends to everyone: the live project today is unchanged
 *      2  🔴 nothing set, on Postgres → allow: an unconfigured copy reaches nobody
 *      3  allow → only the listed ids · on → everyone · off → nobody · a typo → allow · a broken
 *         Postgres config → allow
 *      4  LINE_ALLOW parsing: commas, spaces, new lines · junk ignored · a duplicate counted once
 *      5  the queue (lineDeferBegin_/Flush_): a held message is refused when queued (never counted as
 *         sent) and never fetched
 *      6  the admin's "test push" (handleLineDiag testUid — the one push outside linePush_) is held too,
 *         and the diag says which mode the project is in
 *      7  the log keeps the last 6 characters of the id, never the message
 *   B  fast host (server/line_send.js · routes.js sandbox)
 *      8  LINE_SEND=allow sends only to LINE_ALLOW; the rest 'held' — counted, not failed, not fetched
 *      9  empty list → no fetch at all · a typo → capture (never send) · allow needs the token
 *     10  the sandbox's linePush_ answers false for anyone not allowed (same answer as Apps Script)
 *   C  static
 *     11  every push to LINE in src/ is linePush_ or the gated diag — nothing else calls message/push
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const ROOT = path.join(__dirname, '..');
const U = n => 'U' + String(n).repeat(32).slice(0, 32);           // a well-formed LINE user id
const TESTER = U('a'), TESTER2 = U('b'), PARENT = U('c'), OTHER = U('d');

/* ── A: Apps Script, Line.gs run whole ────────────────────────────────────────────────────────── */
function gas(props, opts) {
  opts = opts || {};
  const fetched = [], logs = [];
  const box = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null) }) },
    UrlFetchApp: { fetch: (url, o) => { fetched.push({ url, to: JSON.parse(o.payload || '{}').to }); return { getResponseCode: () => 200, getContentText: () => '{}' }; } },
    Logger: { log: s => logs.push(String(s)) },
    getConfig_: (k, d) => k === 'LineChannelAccessToken' ? 'tok-test' : d,
    demoOn_: () => false,
    nowStr_: () => '2026-11-14 10:00',
    console
  };
  if (opts.pg !== undefined) box.pgEnabled_ = () => { if (opts.pg === 'throw') throw new Error('PG_TARGET missing'); return opts.pg; };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'Line.gs'), 'utf8'), box, { filename: 'Line.gs' });
  const push = to => box.linePush_(to, [{ type: 'text', text: 'ลูกมาถึงโรงเรียนแล้ว' }]);
  return { box, fetched, logs, push };
}
const sentTo = (g, ids) => ids.map(id => g.push(id) === true);

console.log('\nA1) 🔴 ไม่ได้ตั้งค่า + อยู่บนชีต = ระบบจริงวันนี้ → ส่งทุกคนเหมือนเดิม');
{ const g = gas({}, { pg: false });
  const r = sentTo(g, [PARENT, OTHER]);
  ok_('ส่งถึงผู้ปกครองตามปกติ', r.every(Boolean) && g.fetched.length === 2);
  const g2 = gas({});                                           // no DbPg.gs loaded at all
  ok_('...ไม่มี DbPg ก็ถือว่าอยู่บนชีต', g2.push(PARENT) === true && g2.fetched.length === 1); }

console.log('\nA2) 🔴 ไม่ได้ตั้งค่า + อยู่บน Postgres (สำเนา UAT) → ไม่ส่งใครเลย');
{ const g = gas({}, { pg: true });
  ok_('ผู้ปกครองจริงไม่ได้รับ', g.push(PARENT) === false);
  ok_('...ไม่มีการเรียก LINE เลย', g.fetched.length === 0);
  const g2 = gas({ LINE_ALLOW: TESTER }, { pg: true });
  ok_('ใส่รายชื่อผู้ทดสอบ → ผู้ทดสอบได้รับ', g2.push(TESTER) === true);
  ok_('...ผู้ปกครองจริงยังไม่ได้รับ', g2.push(PARENT) === false && g2.fetched.length === 1 && g2.fetched[0].to === TESTER); }

console.log('\nA3) โหมดที่ตั้งเอง');
{ const g = gas({ LINE_SEND: 'allow', LINE_ALLOW: TESTER }, { pg: false });
  ok_('allow บนชีต → เฉพาะผู้ทดสอบ', g.push(TESTER) === true && g.push(PARENT) === false && g.fetched.length === 1);
  const on = gas({ LINE_SEND: 'on' }, { pg: true });
  ok_('on บน Postgres (คืนย้าย) → ส่งทุกคน', on.push(PARENT) === true && on.fetched.length === 1);
  const off = gas({ LINE_SEND: 'off', LINE_ALLOW: TESTER }, { pg: false });
  ok_('off → ไม่ส่งใคร แม้อยู่ในรายชื่อ', off.push(TESTER) === false && off.fetched.length === 0);
  for (const typo of ['onn', 'ON ', 'yes', 'true', 'all']) {
    const t = gas({ LINE_SEND: typo, LINE_ALLOW: TESTER }, { pg: false });
    const want = typo.trim().toLowerCase() === 'on';
    ok_('LINE_SEND=' + JSON.stringify(typo) + ' → ' + (want ? 'on (ตัวพิมพ์/ช่องว่างไม่นับ)' : 'allow (พิมพ์ผิดไม่ใช่ "ส่งทุกคน")'),
      want ? t.push(PARENT) === true : (t.push(PARENT) === false && t.push(TESTER) === true));
  }
  const br = gas({}, { pg: 'throw' });
  ok_('ตั้งค่า Postgres เสีย (pgEnabled_ โยน) → allow ไม่ใช่ส่งทุกคน', br.push(PARENT) === false && br.fetched.length === 0); }

console.log('\nA4) อ่านรายชื่อ LINE_ALLOW');
{ const g = gas({ LINE_SEND: 'allow', LINE_ALLOW: ' ' + TESTER + ',\n' + TESTER2 + ' , junk, U123, ' + TESTER + ', ' + TESTER.toUpperCase() }, { pg: true });
  ok_('คั่นด้วย , ช่องว่าง ขึ้นบรรทัดใหม่ ได้หมด', g.push(TESTER) === true && g.push(TESTER2) === true);
  ok_('ของที่ไม่ใช่ LINE id ถูกเมิน', g.box.lineSendCfg_().count === 2);
  ok_('ผู้ปกครองยังไม่ได้รับ', g.push(PARENT) === false); }

console.log('\nA5) คิวที่ส่งหลังปลดล็อก (lineDeferBegin_/Flush_)');
{ const g = gas({ LINE_ALLOW: TESTER }, { pg: true });
  g.box.lineDeferBegin_();
  const q1 = g.box.linePushText_(PARENT, 'แจ้งผู้ปกครอง'), q2 = g.box.linePushText_(TESTER, 'แจ้งผู้ทดสอบ');
  ok_('ผู้ที่ไม่อยู่ในรายชื่อ → ตอบ false ตอนเข้าคิว (ไม่นับว่าส่งแล้ว)', q1 === false && q2 === true);
  ok_('...ยังไม่มีอะไรถูกส่งระหว่างล็อก', g.fetched.length === 0);
  g.box.lineDeferFlush_();
  ok_('ปลดล็อกแล้ว ส่งเฉพาะผู้ทดสอบ', g.fetched.length === 1 && g.fetched[0].to === TESTER); }

console.log('\nA6) ปุ่ม "ทดสอบส่ง" ของแอดมิน (handleLineDiag)');
{ const g = gas({ LINE_ALLOW: TESTER }, { pg: true });
  const d = g.box.handleLineDiag({ testUid: PARENT });
  const pushes = g.fetched.filter(f => /message\/push/.test(f.url));
  ok_('LINE ที่ไม่อยู่ในรายชื่อ → ไม่ส่ง', pushes.length === 0 && d.testPush && d.testPush.held === true);
  ok_('...บอกโหมดและจำนวนผู้ทดสอบ', d.sendMode === 'allow' && d.allowCount === 1 && /LINE_SEND=on/.test(d.sendNote));
  const d2 = g.box.handleLineDiag({ testUid: TESTER });
  ok_('LINE ของผู้ทดสอบ → ส่งได้', g.fetched.filter(f => /message\/push/.test(f.url)).length === 1 && d2.testPush.http === 200);
  const live = gas({}, { pg: false }).box.handleLineDiag({});
  ok_('ระบบจริง (บนชีต) → โหมด on ไม่มีคำเตือน', live.sendMode === 'on' && live.sendNote === ''); }

console.log('\nA7) บันทึก log');
{ const g = gas({ LINE_ALLOW: TESTER }, { pg: true });
  g.push(PARENT);
  const line = g.logs.find(l => /held/.test(l)) || '';
  ok_('บันทึกว่าถูกกัน พร้อม 6 ตัวท้ายของ id', line.includes(PARENT.slice(-6)) && !line.includes(PARENT));
  ok_('...ไม่มีข้อความถึงผู้ปกครองใน log', !g.logs.some(l => l.includes('ลูกมาถึง'))); }

/* ── B: fast host ─────────────────────────────────────────────────────────────────────────────── */
const LINE = require(path.join(ROOT, 'server', 'line_send.js'));
(async () => {
  console.log('\nB8) โฮสต์ใหม่ LINE_SEND=allow');
  const env = { LINE_SEND: 'allow', LINE_TOKEN: 'tok-test', LINE_ALLOW: TESTER + ', ' + TESTER2 };
  const calls = [];
  const fakeFetch = async (url, o) => { calls.push(JSON.parse(o.body).to); return { status: 200, text: async () => '' }; };
  const pushes = [PARENT, TESTER, OTHER, TESTER2, TESTER].map(to => ({ to, messages: [{ type: 'text', text: 'x' }] }));
  const s = await LINE.sendAll(pushes, { env, fetch: fakeFetch });
  ok_('ส่งเฉพาะผู้ทดสอบ (3 ข้อความ)', calls.length === 3 && calls.every(t => t === TESTER || t === TESTER2));
  ok_('ผู้ปกครอง 2 คน → held ไม่ใช่ failed', s.held === 2 && s.failed === 0 && s.sent === 3);
  ok_('...ผลรายคนบอก held', s.results[0].r === 'held' && s.results[2].r === 'held');
  ok_('log มี held=2 และไม่มี id เต็ม', /held=2/.test(LINE.logLine('x', s)) && !LINE.logLine('x', s).includes(PARENT));
  ok_('ready: allow + token → พร้อม', LINE.ready(env) === true && LINE.ready({ LINE_SEND: 'allow' }) === false);
  ok_('allowed(): ผู้ทดสอบ ใช่ · ผู้ปกครอง ไม่ใช่', LINE.allowed(TESTER, env) === true && LINE.allowed(PARENT, env) === false);

  console.log('\nB9) ขอบ');
  calls.length = 0;
  const e0 = await LINE.sendAll(pushes, { env: { LINE_SEND: 'allow', LINE_TOKEN: 'tok-test', LINE_ALLOW: '' }, fetch: fakeFetch });
  ok_('รายชื่อว่าง → ไม่เรียก LINE เลย', calls.length === 0 && e0.held === 5 && e0.failed === 0);
  const ty = await LINE.sendAll(pushes, { env: { LINE_SEND: 'alow', LINE_TOKEN: 'tok-test', LINE_ALLOW: TESTER }, fetch: fakeFetch });
  ok_('พิมพ์ผิด → capture (ไม่ส่ง)', calls.length === 0 && ty.mode === 'capture');
  const on = await LINE.sendAll([{ to: PARENT, messages: [] }], { env: { LINE_SEND: 'on', LINE_TOKEN: 'tok-test', LINE_ALLOW: TESTER }, fetch: fakeFetch });
  ok_('on → ส่งทุกคน (รายชื่อไม่มีผล) — ระบบจริงหลังย้าย', calls.length === 1 && on.sent === 1);
  ok_('capture/off: allowed() เหมือนเดิม', LINE.allowed(PARENT, { LINE_SEND: 'capture' }) === true && LINE.allowed(TESTER, { LINE_SEND: 'off' }) === false);

  console.log('\nB10) sandbox ของ route ตอบเหมือน Apps Script');
  const routes = fs.readFileSync(path.join(ROOT, 'server', 'routes.js'), 'utf8');
  const host = fs.readFileSync(path.join(ROOT, 'server', 'host.js'), 'utf8');
  ok_('routes.js: linePush_ ตอบ false ถ้าไม่อยู่ในรายชื่อ (ก่อนจดลงรายการ)',
    /if \(typeof line\.allowed === 'function' && !line\.allowed\(String\(toUid\)\)\) return false;\s*\n\s*lineOps\.push/.test(routes));
  ok_('host.js ส่ง allowed ของ line_send เข้า sandbox', /lineOut = \{ ready: LINE\.ready\(\), allowed: uid => LINE\.allowed\(uid\)/.test(host));

  console.log('\nC11) ทุกทางออกไป LINE');
  const pushSites = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.gs'))) {
    const lines = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8').split(/\r?\n/);
    lines.forEach((l, i) => { if (/UrlFetchApp\.fetch\(\s*(LINE_API|'https:\/\/api\.line\.me\/v2\/bot\/message\/(push|multicast|broadcast|narrowcast))/.test(l)) pushSites.push(f + ':' + (i + 1)); });
  }
  const line = fs.readFileSync(path.join(ROOT, 'src', 'Line.gs'), 'utf8');
  ok_('มีแค่ 2 จุดที่ส่งข้อความ LINE ทั้งระบบ (' + pushSites.join(', ') + ')', pushSites.length === 2 && pushSites.every(s => s.startsWith('Line.gs:')));
  ok_('...linePush_ ตรวจรายชื่อก่อน fetch', /function linePush_[\s\S]*?lineAllowed_\(toUid\)[\s\S]*?UrlFetchApp\.fetch\(LINE_API/.test(line));
  ok_('...ปุ่มทดสอบตรวจรายชื่อก่อน fetch', /p\.testUid && !lineAllowed_\(p\.testUid\)[\s\S]*?else if \(p\.testUid\)[\s\S]*?message\/push/.test(line));

  console.log('\ntest_line_allow: ' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
