/**
 * tools/test_fast_host_pool.js — the fast host reuses database connections, and only clean ones
 *   node tools/test_fast_host_pool.js          (offline — the `pg` driver is a stub; no database, no secret printed)
 *
 * 2026-11-14. server/host.js opened a fresh connection (TLS + login to Supabase) for every request,
 * and pg_lib.connect() ends the process when that fails — one database blip took the whole Cloud Run
 * instance down. tools/pg_lib.js acquire() now hands out pooled clients. Reuse is only safe if a client
 * comes back exactly as it left, so this proves:
 *
 *   A  pg_lib, with a fake driver
 *      1  the second request reuses the first connection · the pool is made once · time zone set once
 *      2  🔴 a client returned mid-transaction ('T' / 'E') is DESTROYED — never handed to the next request
 *         with somebody's open transaction and advisory lock
 *      3  release(true) destroys · release twice is harmless
 *      4  a connection idle past 30s is pinged; a dead one is replaced, not handed out
 *      5  🔴 the time zone cannot be set → that connection is destroyed, never used
 *      6  the database cannot be reached → acquire() THROWS (the request answers INTERNAL) — never process.exit
 *      7  size: PG_POOL_MAX (default 4, clamped 1..20) · allowExitOnIdle · an 'error' listener (else a
 *         dropped idle connection crashes node)
 *   B  the real host handle(), with acquire() stubbed
 *      8  a normal request releases clean · a request that throws releases bad · a closed route's audit
 *         releases its own · every acquire is released exactly once
 *   C  static
 *      9  host.js never calls connect()
 */
'use strict';
const path = require('path');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const ROOT = path.join(__dirname, '..');

/* ── a fake `pg` that records what happens to each physical connection ─────────────────────────── */
let pools = [], nextId = 0, connectFails = false, tzFails = false;
class FakeClient {
  constructor() { this.id = ++nextId; this.sql = []; this.tx = 'I'; this.dead = false; this.destroyed = false; this.out = false; }
  async query(sql) {
    const s = String(sql); this.sql.push(s);
    if (this.dead) throw new Error('Connection terminated unexpectedly');
    if (/set time zone/.test(s) && tzFails) throw new Error('tz refused');
    if (/^begin/.test(s)) this.tx = 'T';
    if (/^(commit|rollback)/.test(s)) this.tx = 'I';
    return { rows: [] };
  }
  getTransactionStatus() { return this.tx; }
}
class FakePool {
  constructor(opts) { this.opts = opts; this.idle = []; this.all = []; this.listeners = {}; pools.push(this); }
  on(ev, fn) { this.listeners[ev] = fn; return this; }
  async connect() {
    if (connectFails) throw new Error('getaddrinfo ENOTFOUND db');
    let c = this.idle.shift();
    if (!c) { c = new FakeClient(); this.all.push(c); }
    c.out = true;
    const pool = this;
    c.release = (destroy) => { c.out = false; if (destroy) { c.destroyed = true; pool.all = pool.all.filter(x => x !== c); } else pool.idle.push(c); };
    return c;
  }
  get totalCount() { return this.all.length; } get idleCount() { return this.idle.length; } get waitingCount() { return 0; }
  async end() {}
}
const pgPath = require.resolve('pg', { paths: [path.join(ROOT, 'tools')] });
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool, Client: class {} } };
/* 🔴 no process.exit may happen anywhere in here */
const realExit = process.exit;
process.exit = (c) => { throw new Error('process.exit(' + c + ') called'); };
/* the connection string: a made-up one, never the real secret file */
process.env.SUPABASE_DB_URL = 'postgresql://u.fake:pw-fake@aws-0-x.pooler.supabase.com:5432/postgres';
const fs = require('fs');
const realExists = fs.existsSync;
fs.existsSync = p => /supabase\.env$/.test(String(p)) ? false : realExists(p);

const LIB = require(path.join(ROOT, 'tools', 'pg_lib.js'));

(async () => {
  console.log('\nA1) ใช้การเชื่อมต่อซ้ำ');
  const h1 = await LIB.acquire(); const c1 = h1.client; h1.release();
  const h2 = await LIB.acquire(); const c2 = h2.client;
  ok_('คำขอที่สองได้การเชื่อมต่อเดิม (ไม่ล็อกอินใหม่)', c1 === c2 && pools[0].all.length === 1);
  ok_('สร้าง pool ครั้งเดียว', pools.length === 1);
  ok_('ตั้งเวลาโรงเรียนครั้งเดียวต่อการเชื่อมต่อ', c2.sql.filter(s => /set time zone 'Asia\/Bangkok'/.test(s)).length === 1);
  ok_('...และก่อนคำสั่งแรกของคำขอ', /set time zone/.test(c1.sql[0]));
  h2.release();

  console.log('\nA2) 🔴 คืนกลางธุรกรรม → ทิ้ง ไม่คืน pool');
  const h3 = await LIB.acquire(); const c3 = h3.client;
  await c3.query('begin'); await c3.query('select pg_advisory_xact_lock(1)');
  h3.release();                                          // the caller forgot to commit
  ok_("สถานะ 'T' → การเชื่อมต่อถูกทิ้ง", c3.destroyed === true);
  const h4 = await LIB.acquire();
  ok_('คำขอถัดไปได้การเชื่อมต่อใหม่ ไม่ใช่ตัวที่ค้างธุรกรรม', h4.client !== c3 && h4.client.tx === 'I');
  h4.client.tx = 'E'; h4.release();
  ok_("สถานะ 'E' (ธุรกรรมพัง) → ทิ้ง", h4.client.destroyed === true);

  console.log('\nA3) release(true) · release ซ้ำ');
  const h5 = await LIB.acquire(); h5.release(true);
  ok_('release(true) → ทิ้ง', h5.client.destroyed === true);
  const before = pools[0].idle.length; h5.release(); h5.release(false);
  ok_('release ซ้ำไม่คืน pool ซ้ำ', pools[0].idle.length === before);
  const h6 = await LIB.acquire(); h6.release();
  const cnt = pools[0].idle.filter(x => x === h6.client).length;
  ok_('การเชื่อมต่อที่สะอาดกลับเข้า pool หนึ่งครั้ง', cnt === 1);

  console.log('\nA4) เงียบนาน → ping ก่อนใช้ · ตายแล้ว → เปลี่ยนตัว');
  const idleC = pools[0].idle[0];
  idleC.__atomUsed = Date.now() - 31 * 1000; idleC.sql = [];
  const h7 = await LIB.acquire();
  ok_('เงียบเกิน 30 วินาที → select 1 ก่อน', h7.client === idleC && idleC.sql[0] === 'select 1');
  h7.release();
  idleC.__atomUsed = Date.now() - 10 * 60 * 1000; idleC.dead = true;
  const h8 = await LIB.acquire();
  ok_('ตัวที่ตายถูกทิ้ง', idleC.destroyed === true);
  ok_('...และได้ตัวใหม่ที่ตั้งเวลาโรงเรียนแล้ว', h8.client !== idleC && /set time zone/.test(h8.client.sql[0]));
  h8.release();
  const fresh = pools[0].idle[0]; fresh.sql = []; fresh.__atomUsed = Date.now();
  const h9 = await LIB.acquire();
  ok_('ใช้งานล่าสุดไม่นาน → ไม่ ping (ไม่เสียรอบเดินทาง)', h9.client === fresh && fresh.sql.length === 0);
  h9.release();
  /* every idle one died together (a quiet night) */
  const extra = await Promise.all([LIB.acquire(), LIB.acquire(), LIB.acquire()]);
  extra.forEach(h => h.release());
  pools[0].idle.forEach(c => { c.dead = true; c.__atomUsed = 0; });
  const nIdle = pools[0].idle.length;
  const h10 = await LIB.acquire();
  ok_('ตัวที่ว่างตายหมด (' + nIdle + ' ตัว) → ยังได้ตัวใหม่ที่ใช้ได้', !h10.client.dead && !h10.client.destroyed);
  h10.release();

  console.log('\nA5) 🔴 ตั้งเวลาโรงเรียนไม่ได้ → ไม่ใช้การเชื่อมต่อนั้น');
  pools[0].idle.length = 0; tzFails = true;
  let tzErr = null; try { await LIB.acquire(); } catch (e) { tzErr = e; }
  ok_('acquire ปฏิเสธ (ไม่ส่งการเชื่อมต่อที่เวลาผิด)', !!tzErr);
  ok_('...และการเชื่อมต่อเหล่านั้นถูกทิ้งทั้งหมด', pools[0].all.every(c => !c.out) && pools[0].idle.length === 0);
  tzFails = false;

  console.log('\nA6) 🔴 ฐานข้อมูลล่ม → โยน error ไม่ปิดเครื่อง');
  connectFails = true;
  let cErr = null; try { await LIB.acquire(); } catch (e) { cErr = e; }
  ok_('acquire โยน error (ไม่ใช่ process.exit)', !!cErr && !/process\.exit/.test(cErr.message));
  ok_('...ข้อความภาษาไทยบอกว่าเชื่อมต่อไม่ได้', /เชื่อมต่อฐานข้อมูลไม่สำเร็จ/.test(cErr && cErr.message));
  ok_('...ไม่มีรหัสผ่านในข้อความ', !/pw-fake|u\.fake/.test(cErr && cErr.message));
  connectFails = false;
  const h11 = await LIB.acquire(); h11.release();
  ok_('ฐานข้อมูลกลับมา → ใช้งานต่อได้เลย', !!h11.client);

  console.log('\nA7) ขนาดและตัวเลือกของ pool');
  const o = pools[0].opts;
  ok_('ค่าเริ่มต้น max 4', o.max === 4);
  ok_('allowExitOnIdle (เครื่องมือ/ชุดทดสอบปิดตัวเองได้)', o.allowExitOnIdle === true);
  ok_('TLS · รอคิวไม่เกิน 15 วินาที', o.ssl && o.connectionTimeoutMillis === 15000);
  ok_("มีตัวรับ 'error' (การเชื่อมต่อที่ถูกตัดไม่ทำ node พัง)", typeof pools[0].listeners.error === 'function');
  let logged = ''; const realLog = console.log; console.log = s => { logged += s; };
  pools[0].listeners.error(new Error('server closed the connection pw-fake'));
  console.log = realLog;
  ok_("...และไม่พิมพ์รหัสผ่าน", logged && !/pw-fake/.test(logged));
  for (const [v, want] of [['8', 8], ['99', 20], ['0', 4], ['abc', 4], ['1', 1]]) {
    await LIB.closePool(); process.env.PG_POOL_MAX = v;
    const h = await LIB.acquire(); h.release();
    ok_('PG_POOL_MAX=' + v + ' → ' + want, pools[pools.length - 1].opts.max === want);
  }
  delete process.env.PG_POOL_MAX;
  const st = LIB.poolStats();
  ok_('poolStats บอกจำนวน (ไม่มีข้อมูลการเชื่อมต่อ)', st && typeof st.total === 'number' && !JSON.stringify(st).includes('pooler'));

  /* ── B: the real host ─────────────────────────────────────────────────────────────────────── */
  console.log('\nB8) host.js คืนการเชื่อมต่อทุกครั้ง และทิ้งเมื่อพัง');
  const SECRET = 'pool-test-' + 'x'.repeat(24);
  process.env.SESSION_SECRET = SECRET;
  process.env.TENANT_ID = '00000000-0000-4000-8000-0000000000ac';
  let held = [];
  const libPath = require.resolve(path.join(ROOT, 'tools', 'pg_lib.js'));
  require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: {
    acquire: async () => { const rec = { released: 0, bad: null };
      held.push(rec);
      return { client: { query: async (q) => ({ rows: /^s*insert/i.test(String(q)) ? [{ id: '1' }] : [] }), getTransactionStatus: () => 'I' }, release(b) { rec.released++; rec.bad = !!b; } }; } } };
  const PG = require(path.join(ROOT, 'tools', 'pg_engine.js'));
  let boom = false;
  PG.persist = async () => ({});
  PG.hydrateConfig = async () => ({ Departments: ['Nursery 1'] });
  PG.hydrateFast = async (client, tenant, keys) => {
    if (boom) throw new Error('relation does not exist');
    const M = {}; keys.forEach(k => { M[k] = []; });
    M.staff = [{ __id: 's1', StaffID: 'STF-002', NameTH: 'ครูทดสอบ', Role: 'Teacher', PositionLevel: 'Teacher', Department: 'Nursery 1', Classes: '*', Status: 'ACTIVE', StartDate: '2025-01-01' }];
    return { M, snapshot: {} };
  };
  const { handle } = require(path.join(ROOT, 'server', 'host.js'));
  const { sign_ } = require(path.join(ROOT, 'server', 'session.js'));
  const NOW = Date.now();
  const b = Buffer.from(JSON.stringify({ uid: 'U-T', role: 'Teacher', linkedId: 'STF-002', iat: NOW, exp: NOW + 3600e3 })).toString('base64');
  const TOKEN = b + '.' + sign_(b, SECRET);
  const call = async (action) => { let out = ''; held = [];
    const res = { setHeader() {}, writeHead() {}, end(s) { out = s; } };
    await handle({}, res, JSON.stringify({ token: TOKEN, action, payload: {} }));
    return JSON.parse(out); };

  const r1 = await call('staffSelf');
  ok_('คำขอปกติ → ตอบได้', r1.ok === true);
  ok_('...คืนการเชื่อมต่อครั้งเดียว แบบสะอาด', held.length === 1 && held[0].released === 1 && held[0].bad === false);
  boom = true;
  const r2 = await call('staffSelf');
  boom = false;
  ok_('คำขอที่พัง → INTERNAL (เครื่องยังอยู่)', r2.ok === false && r2.error.code === 'INTERNAL');
  ok_('...การเชื่อมต่อถูกทิ้ง (release(true))', held.length === 1 && held[0].released === 1 && held[0].bad === true);
  const closed = require(path.join(ROOT, 'server', 'gate.js'));
  const closedName = ['getConfig', 'exportAll', 'debugDump'].find(a => closed.isClosed(a));
  if (closedName) {
    const r3 = await call(closedName);
    ok_('route ที่ปิด (' + closedName + ') → UNKNOWN_ACTION', r3.error && r3.error.code === 'UNKNOWN_ACTION');
    ok_('...บันทึก audit ด้วยการเชื่อมต่อของตัวเอง แล้วคืนแบบสะอาด', held.length === 1 && held[0].released === 1 && held[0].bad === false);
  } else ok_('มี route ที่ปิดให้ทดสอบ', false);
  const r4 = await call('');
  ok_('ไม่มี action → ไม่แตะ pool เลย', r4.error && r4.error.code === 'NO_ACTION' && held.length === 0);

  /* ── C: static ──────────────────────────────────────────────────────────────────────────────── */
  console.log('\nC9) โค้ด');
  const host = fs.readFileSync(path.join(ROOT, 'server', 'host.js'), 'utf8');
  ok_('host.js ไม่เรียก connect() (ซึ่ง process.exit ได้)', !/\bconnect\s*\(\s*\)/.test(host.replace(/\/\*[\s\S]*?\*\//g, '')));
  ok_('host.js ใช้ acquire จาก pg_lib', /const \{ acquire \} = require\(/.test(host));
  const docker = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  ok_('Dockerfile ยังคัดลอก pg_lib.js (ที่อยู่ของ pool)', /COPY tools\/pg_lib\.js/.test(docker));

  process.exit = realExit;
  console.log('\ntest_fast_host_pool: ' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { process.exit = realExit; console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
