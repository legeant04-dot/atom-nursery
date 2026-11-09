/**
 * tools/test_line_send.js — server/line_send.js against a FAKE LINE on this machine (never the real one)
 *   node tools/test_line_send.js
 *
 * What the fast host's LINE sender promises (docs/FAST_HOST_WRITES_PLAN.md W2):
 *   one recipient's messages in the order they were made · recipients side by side
 *   a retry reuses its X-Line-Retry-Key (so LINE delivers once) · 409 = already delivered
 *   5xx / timeout → one retry · 4xx (bad id, token, 429 quota) → no retry
 *   never throws · never waits past the cap · 'capture' and 'off' send nothing · a typo is 'capture'
 *   the log line holds no message text
 */
'use strict';
const http = require('http');
const path = require('path');
const LINE = require(path.join(__dirname, '..', 'server', 'line_send.js'));
let pass = 0, fail = 0;
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  console.log((okk ? '  ok   ' : '  FAIL ') + label + (okk ? '' : '\n         got=' + JSON.stringify(got).slice(0, 500) + '\n        want=' + JSON.stringify(want).slice(0, 500)));
  okk ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

/* the fake: behaviour per recipient — a list of answers, one per request ('hang' = never answers) */
let PLAN = {}, LOG = [];
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c; });
  req.on('end', () => {
    const b = JSON.parse(body || '{}');
    LOG.push({ to: b.to, text: b.messages && b.messages[0] && b.messages[0].text, key: req.headers['x-line-retry-key'], auth: req.headers.authorization, t: Date.now() });
    const q = PLAN[b.to] || [];
    const ans = q.length ? q.shift() : 200;
    if (ans === 'hang') return;                                  // the socket stays open: a timeout
    const delay = typeof ans === 'object' ? ans.delay : 0, code = typeof ans === 'object' ? ans.code : ans;
    setTimeout(() => { res.writeHead(code, { 'content-type': 'application/json' }); res.end('{}'); }, delay);
  });
});

const push = (to, text) => ({ to, messages: [{ type: 'text', text }] });
const ON = { LINE_SEND: 'on', LINE_TOKEN: 'fake-token-for-the-fake-server' };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/v2/bot/message/push';
  const send = (list, o) => LINE.sendAll(list, Object.assign({ env: ON, url, attemptMs: 400, capMs: 3000 }, o || {}));

  console.log('\n1) ส่งได้ปกติ — ลำดับต่อคน · คนละคนส่งพร้อมกัน');
  PLAN = { Ua: [{ code: 200, delay: 150 }, 200, 200], Ub: [200] }; LOG = [];
  let t0 = Date.now();
  let s = await send([push('Ua', 'a1'), push('Ub', 'b1'), push('Ua', 'a2'), push('Ua', 'a3')]);
  eq('ส่งครบ 4', [s.n, s.sent, s.failed], [4, 4, 0]);
  eq('ผู้รับคนเดียวกันได้ตามลำดับที่สร้าง', LOG.filter(x => x.to === 'Ua').map(x => x.text), ['a1', 'a2', 'a3']);
  ok_('คนละคนไม่ต้องรอกัน: Ub ถึงก่อน a1 ของ Ua ตอบเสร็จ', LOG.findIndex(x => x.to === 'Ub') < LOG.findIndex(x => x.text === 'a2'));
  ok_('ทุกข้อความมีรหัสลองใหม่ ไม่ซ้ำกัน และส่ง token ในหัว', new Set(LOG.map(x => x.key)).size === 4 && LOG.every(x => /^[0-9a-f-]{36}$/.test(x.key) && x.auth === 'Bearer ' + ON.LINE_TOKEN));

  console.log('\n2) ลองใหม่ — รหัสเดิม ครั้งเดียว');
  PLAN = { Ua: [500, 200], Ub: ['hang', 200], Uc: [500, 500], Ud: [500, 409] }; LOG = [];
  s = await send([push('Ua', 'x'), push('Ub', 'y'), push('Uc', 'z'), push('Ud', 'w')]);
  const keys = to => LOG.filter(x => x.to === to).map(x => x.key);
  ok_('500 แล้วลองใหม่ด้วยรหัสเดิม → ส่งได้', keys('Ua').length === 2 && keys('Ua')[0] === keys('Ua')[1] && s.results[0].r === 'ok');
  ok_('หมดเวลา แล้วลองใหม่ด้วยรหัสเดิม → ส่งได้', keys('Ub').length === 2 && keys('Ub')[0] === keys('Ub')[1] && s.results[1].r === 'ok');
  ok_('500 สองครั้ง → เลิก (ลองแค่ครั้งเดียว)', keys('Uc').length === 2 && s.results[2].r === 'fail:500');
  ok_('409 ตอนลองใหม่ = LINE รับไปแล้ว → นับว่าส่งแล้ว', s.results[3].r === 'dup');
  eq('สรุป', [s.sent, s.failed], [3, 1]);

  console.log('\n3) ไม่ลองใหม่เมื่อลองไปก็ไม่ช่วย');
  PLAN = { Ua: [429], Ub: [400], Uc: [401] }; LOG = [];
  s = await send([push('Ua', '1'), push('Ub', '2'), push('Uc', '3')]);
  eq('429 (โควตาหมด) · 400 · 401 → ไม่ลองใหม่', [LOG.length, s.results.map(x => x.r)], [3, ['fail:429', 'fail:400', 'fail:401']]);

  console.log('\n4) 🔴 ไม่รอเกินเพดาน และไม่โยน error');
  PLAN = { Ua: ['hang', 'hang'], Ub: [200] }; LOG = [];
  t0 = Date.now();
  s = await send([push('Ua', 'a'), push('Ua', 'a2'), push('Ub', 'b')], { attemptMs: 2000, capMs: 600 });
  const took = Date.now() - t0;
  ok_('เพดาน 600ms → กลับมาใน ~600ms (ได้ ' + took + 'ms)', took >= 550 && took < 1200);
  eq('ที่ค้างนับเป็น pending · ที่เสร็จแล้วนับจริง', [s.sent, s.pending, s.results.map(x => x.r)], [1, 2, ['pending', 'pending', 'ok']]);
  let threw = false;
  try { await LINE.sendAll([push('Ua', 'x')], { env: ON, url: 'http://127.0.0.1:1/nothing', attemptMs: 300, capMs: 2000 }); } catch (e) { threw = true; }
  ok_('เชื่อมต่อไม่ได้เลย → ไม่โยน error', !threw);
  let s2 = await LINE.sendAll([push('Ua', 'x')], { env: ON, url: 'http://127.0.0.1:1/nothing', attemptMs: 300, capMs: 2000 });
  eq('...และบอกว่าล้ม', s2.results[0].r, 'fail:network');

  console.log('\n5) 🔴 โหมด — staging ไม่ส่งถึงใคร');
  LOG = [];
  const cap = await send([push('Ua', 'x')], { env: { LINE_SEND: 'capture', LINE_TOKEN: 'fake' } });
  const off = await send([push('Ua', 'x')], { env: { LINE_SEND: 'off', LINE_TOKEN: 'fake' } });
  const typo = await send([push('Ua', 'x')], { env: { LINE_SEND: 'yes please', LINE_TOKEN: 'fake' } });
  const none = await send([push('Ua', 'x')], { env: {} });
  eq("capture · off · พิมพ์ผิด · ไม่ได้ตั้ง → ไม่มีคำขอถึง LINE เลย", [LOG.length, cap.mode, off.mode, typo.mode, none.mode], [0, 'capture', 'off', 'capture', 'capture']);
  const noTok = await send([push('Ua', 'x')], { env: { LINE_SEND: 'on' } });
  eq("'on' แต่ไม่มี token → ไม่ส่ง และบอกว่าล้ม", [LOG.length, noTok.results[0].r], [0, 'fail:no-token']);
  eq('ready(): linePush_ ในกล่องทรายตอบว่า "ส่ง" เมื่อไร',
    [LINE.ready({ LINE_SEND: 'capture' }), LINE.ready({}), LINE.ready({ LINE_SEND: 'on', LINE_TOKEN: 'x' }), LINE.ready({ LINE_SEND: 'on' }),
     LINE.ready({ LINE_SEND: 'on', LINE_TOKEN: '<FILL ME>' }), LINE.ready({ LINE_SEND: 'off', LINE_TOKEN: 'x' })],
    [true, true, true, false, false, false]);

  console.log('\n6) 🔴 log ไม่มีเนื้อความ');
  PLAN = {}; LOG = [];
  s = await send([push('U1234567890abcdef', 'ข้อความเรื่องเด็กที่ห้ามอยู่ใน log')]);
  const line = LINE.logLine('saveTeacherReply', s);
  ok_('log: เก็บแค่ 6 ตัวท้ายของ LINE id กับผลการส่ง', /abcdef:ok/.test(line) && line.indexOf('ข้อความ') < 0 && line.indexOf('U1234567890') < 0);
  ok_('fingerprint เดียวกันสำหรับข้อความเดียวกัน ต่างกันเมื่อผู้รับหรือข้อความต่าง',
    LINE.fingerprint(push('Ua', 'x')) === LINE.fingerprint(push('Ua', 'x')) && LINE.fingerprint(push('Ua', 'x')) !== LINE.fingerprint(push('Ub', 'x')) &&
    LINE.fingerprint(push('Ua', 'x')) !== LINE.fingerprint(push('Ua', 'y')) && /^[0-9a-f]{16}$/.test(LINE.fingerprint(push('Ua', 'x'))));

  server.close();
  console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
