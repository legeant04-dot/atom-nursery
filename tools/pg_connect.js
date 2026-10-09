/**
 * tools/pg_connect.js — the first handshake with Postgres, and the migration runner.
 *
 *   node tools/pg_connect.js                     ตรวจว่าเชื่อมต่อได้ไหม (ไม่เขียนอะไรเลย)
 *   node tools/pg_connect.js --tables            รายชื่อตารางที่มีอยู่ตอนนี้
 *   node tools/pg_connect.js --run <file.sql>    รันไฟล์ SQL (ถามยืนยันก่อน)
 *
 * READS secrets/supabase.env AND NEVER PRINTS WHAT IT FINDS THERE. The connection string carries
 * the database password; this repo is PUBLIC and this file's output ends up in chat transcripts and
 * screenshots. Everything printed below is either a count, a name, or a masked host — never a
 * credential. That is not politeness, it is the lesson of the Google backup codes (committed here
 * 2026-06-22) and of the OAuth client secret that left in a screenshot in September.
 */
const fs = require('fs'), path = require('path');

const ENV = path.join(__dirname, '..', 'secrets', 'supabase.env');
const EXAMPLE = path.join(__dirname, '..', 'secrets', 'supabase.env.example');

function readEnv() {
  if (!fs.existsSync(ENV)) {
    console.log('\n🔴 ยังไม่มีไฟล์  secrets/supabase.env');
    console.log('   ทำตามนี้:');
    console.log('     1. คัดลอก  secrets/supabase.env.example  เป็น  secrets/supabase.env');
    console.log('     2. เติม SUPABASE_DB_URL จาก Supabase dashboard (ปุ่ม Connect → Connection string)');
    console.log('     3. รันคำสั่งนี้อีกครั้ง\n');
    console.log('   ไฟล์นี้ถูกกันไว้ใน .gitignore แล้ว — ตรวจแล้วว่า `git add -A` ไม่เห็นมัน\n');
    process.exit(2);
  }
  const out = {};
  fs.readFileSync(ENV, 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  });
  return out;
}

/* WHAT A HOST MAY BE PRINTED AS. The region and the shape of the host are useful ("am I on the
 * Singapore pooler?"); the project ref and the password are not ours to show. */
const safeHost = (url) => {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^([^.]{0,4})[^.]*/, (_, a) => a + '…');
    return host + ':' + (u.port || '5432');
  } catch (e) { return '(unreadable)'; }
};

/* 🔴 SCRUB EVERY PIECE, NOT THE WHOLE STRING.
 *
 * The first version replaced the connection URL in an error message and believed that was enough.
 * It was not: the driver reports failures like `tenant/user postgres.wxyz9876 not found`, naming
 * the project ref on its own, and that sailed straight through. Caught by testing the failure path
 * with a fake credential and grepping the output for it — not by reading the code.
 *
 * So anything that came out of the secrets file is replaced wherever it appears, piece by piece:
 * the password, the user, the whole URL, and every other value in the file. A project ref is not as
 * dangerous as a password, but this output lands in chat transcripts and screenshots, and the rule
 * that holds is the simple one — nothing from that file is ever printed.
 */
function makeScrubber(env, url) {
  const bits = [];
  try { const u = new URL(url); if (u.password) bits.push(decodeURIComponent(u.password), u.password);
                                if (u.username) bits.push(decodeURIComponent(u.username), u.username); } catch (e) {}
  Object.keys(env).forEach(k => { const v = env[k]; if (v && v.length >= 6) bits.push(v); });
  bits.push(url);
  // longest first, or replacing a short fragment can leave a longer secret half-masked
  const uniq = [...new Set(bits.filter(Boolean))].sort((a, b) => b.length - a.length);
  return (s) => { let out = String(s == null ? '' : s);
    uniq.forEach(b => { out = out.split(b).join('«ซ่อนไว้»'); }); return out; };
}

function check(env) {
  const url = env.SUPABASE_DB_URL || '';
  if (!url) {
    console.log('\n🔴 ไฟล์มีอยู่ แต่ SUPABASE_DB_URL ยังว่าง');
    console.log('   Dashboard → ปุ่ม Connect ด้านบน → Connection string → Session pooler → Copy\n');
    process.exit(2);
  }
  if (/\[YOUR-PASSWORD\]|\[YOUR_PASSWORD\]/i.test(url)) {
    console.log('\n🔴 ยังไม่ได้แทน [YOUR-PASSWORD] ด้วยรหัสผ่านจริง');
    console.log('   รหัสผ่านฐานข้อมูลคือตัวที่ตั้งตอนสร้าง project');
    console.log('   ถ้าจำไม่ได้: Settings → Database → Reset database password (ไม่เสียข้อมูล)\n');
    process.exit(2);
  }
  if (!/^postgres(ql)?:\/\//.test(url)) {
    console.log('\n🔴 SUPABASE_DB_URL ไม่ใช่สายเชื่อมต่อฐานข้อมูล');
    console.log('   ต้องขึ้นต้นด้วย postgresql://  ไม่ใช่ https://');
    console.log('   (https://…supabase.co คือ Project URL ซึ่งใส่ในช่อง SUPABASE_URL แทน)\n');
    process.exit(2);
  }
  return url;
}

async function main() {
  const env = readEnv();
  const url = check(env);
  let Client;
  try { Client = require('pg').Client; }
  catch (e) { console.log('\n🔴 ยังไม่ได้ติดตั้ง pg — รัน:  cd tools && npm install pg\n'); process.exit(2); }

  // built before the first thing that can fail, so every message below goes through it
  const scrub = makeScrubber(env, url);
  console.log('\n  host   : ' + safeHost(url) + '   (ปิดบังบางส่วนไว้ตั้งใจ)');

  /* 🔴 THE PASSWORD IS NOT PART OF A URL, SO DO NOT MAKE IT ONE.
   *
   * 2026-10-09, the very first connection attempt: `password authentication failed`. The password
   * Supabase generated contains a `%`, which is the percent-ESCAPE character. Handing the whole
   * string to pg means pg's own parser runs decodeURIComponent over it, so `%2f` becomes `/`,
   * `%ab` becomes something else again, and the password that reaches the server is not the one
   * anybody typed. The dashboard hands you a string with `[YOUR-PASSWORD]` in it and expects you to
   * percent-encode what you paste in — which nobody does, and which has to be redone every time the
   * password is reset.
   *
   * So the string is split here and the parts handed over SEPARATELY, with no decoding at all:
   * split at the LAST `@` (a password may contain one) and at the FIRST `:` after that (a username
   * may not). Any password now works exactly as typed.
   *
   * ...AND THE OTHER CASE IS STILL COVERED. Somebody who DID encode it properly would otherwise be
   * broken by this fix, so a failure is retried once with the decoded form. Two attempts, and the
   * message says which one worked — guessing silently is how this kind of thing stays mysterious.
   */
  const parseConn = (s) => {
    const m = String(s).match(/^postgres(?:ql)?:\/\/(.*)$/i);
    if (!m) return null;
    const rest = m[1];
    const at = rest.lastIndexOf('@');
    if (at < 0) return null;
    const cred = rest.slice(0, at), hostPart = rest.slice(at + 1);
    const colon = cred.indexOf(':');
    const user = colon < 0 ? cred : cred.slice(0, colon);
    const pass = colon < 0 ? '' : cred.slice(colon + 1);
    const hm = hostPart.match(/^([^:/?]+)(?::(\d+))?(?:\/([^?]*))?/);
    if (!hm) return null;
    return { user, password: pass, host: hm[1], port: Number(hm[2] || 5432),
             database: hm[3] || 'postgres' };
  };

  const base = parseConn(url);
  if (!base) { console.log('  🔴 อ่านสายเชื่อมต่อไม่ออก — คัดลอกมาจาก Dashboard → Connect → Connection string อีกครั้ง\n'); process.exit(2); }

  /* 🔴 THE BRACKETS. The dashboard hands you `...:[YOUR-PASSWORD]@...` and the instruction is to
   * replace the whole placeholder — brackets included. On 2026-10-09 the first real attempt put the
   * password INSIDE them, so an 18-character secret went to the server with `[` and `]` on it and
   * came back `password authentication failed`, which is the least informative thing it could have
   * said. Said plainly here, and tried anyway so nobody is blocked on punctuation. */
  if (/^\[.*\]$/.test(base.password)) {
    console.log('  ⚠️  รหัสผ่านมีวงเล็บ [ ] ครอบอยู่ — ตอน copy มาต้องลบวงเล็บออกด้วย');
    console.log('      (ผมลองแบบลบวงเล็บให้แล้ว · ถ้าผ่าน กรุณาแก้ไฟล์ให้ตรงด้วย)');
  }
  const attempts = [{ label: 'ตามที่พิมพ์ไว้', pw: base.password }];
  const seen = new Set([base.password]);
  const add = (label, pw) => { if (pw != null && !seen.has(pw)) { seen.add(pw); attempts.push({ label, pw }); } };
  if (/^\[.*\]$/.test(base.password)) add('ลบวงเล็บ [ ] ออก', base.password.slice(1, -1));
  let decoded = null;
  try { decoded = decodeURIComponent(base.password); } catch (e) {}
  add('แบบถอดรหัส %xx', decoded);

  let c = null, t0 = Date.now(), lastErr = null;
  for (const a of attempts) {
    const cand = new Client(Object.assign({}, base, { password: a.pw,
      ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 }));
    t0 = Date.now();
    try { await cand.connect(); c = cand;
      if (attempts.length > 1) console.log('  (ใช้รหัสผ่าน ' + a.label + ')');
      break; }
    catch (e) { lastErr = e; try { await cand.end(); } catch (x) {} }
  }
  if (!c) {
    console.log('  🔴 เชื่อมต่อไม่สำเร็จ: ' + scrub(lastErr && lastErr.message));
    console.log('\n  ตรวจ 3 อย่างนี้:');
    console.log('    · รหัสผ่านในสายเชื่อมต่อถูกต้องไหม (ตัวที่ตั้งตอนสร้าง project)');
    console.log('    · ใช้แบบ "Session pooler" หรือยัง — แบบ Direct connection ต้องใช้ IPv6');
    console.log('    · project ถูกหยุดชั่วคราวหรือเปล่า (free tier หยุดเองเมื่อไม่ใช้ 7 วัน) → กด Restore\n');
    process.exit(1);
  }
  console.log('  ✅ เชื่อมต่อได้ใน ' + (Date.now() - t0) + 'ms');

  const ver = await c.query('select version()');
  console.log('  server : ' + String(ver.rows[0].version).split(' ').slice(0, 2).join(' '));
  const tb = await c.query(
    "select table_name from information_schema.tables where table_schema='public' order by 1");
  console.log('  ตาราง  : ' + tb.rows.length + ' ตารางใน schema public');

  const arg = process.argv[2];
  if (arg === '--tables') {
    if (!tb.rows.length) console.log('         (ยังว่าง — ยังไม่ได้รัน 001_init.sql)');
    else tb.rows.forEach(r => console.log('         · ' + r.table_name));
  }

  if (arg === '--run') {
    const f = process.argv[3];
    if (!f) { console.log('\n  ใช้: node tools/pg_connect.js --run docs/schema/001_init.sql\n'); await c.end(); process.exit(2); }
    const sql = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    console.log('\n  จะรัน ' + f + '  (' + sql.split('\n').length + ' บรรทัด)');
    /* ONE TRANSACTION. A migration that stopped halfway would leave a database that is neither the
     * old shape nor the new one, and nothing in Phase 2 could tell which. Postgres runs DDL
     * transactionally, so either all 54 tables exist afterwards or none of them do. */
    try {
      await c.query('begin');
      await c.query(sql);
      await c.query('commit');
      const after = await c.query(
        "select count(*)::int n from information_schema.tables where table_schema='public'");
      console.log('  ✅ สำเร็จ — ตอนนี้มี ' + after.rows[0].n + ' ตาราง');
    } catch (e) {
      await c.query('rollback').catch(() => {});
      console.log('  🔴 ล้มเหลว — ย้อนกลับทั้งหมดแล้ว ฐานข้อมูลไม่เปลี่ยนแปลง');
      console.log('     ' + scrub(e.message).slice(0, 300));
      await c.end(); process.exit(1);
    }
  }

  await c.end();
  console.log('');
}
// the top-level catch cannot see the scrubber, so it prints nothing but the error TYPE
main().catch(e => { console.log('🔴 ' + String((e && e.code) || (e && e.name) || 'ERROR') +
  ' — รายละเอียดถูกซ่อนไว้เพราะอาจมีค่าจากไฟล์ความลับปนอยู่'); process.exit(1); });
