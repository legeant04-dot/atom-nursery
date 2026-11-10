/**
 * tools/pg_engine.js — Phase 2.1. The same engine, fed from Postgres instead of Sheets.
 *
 * `webapp/engine.js` is 320 handlers that take one object, `M`, holding the school's collections as
 * plain arrays. GasEngine builds that object out of spreadsheets. This builds the identical object
 * out of Postgres, and that is the entire job: **no handler may be able to tell the difference.**
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 THE PART THAT IS EASY TO GET WRONG IS NOT THE QUERY. IT IS THE VALUES.
 *
 * The engine does `String(r.Date||'').slice(0,10)`, `r.Status==='DRAFT'`, `Number(r.Amount||0)`.
 * Sheets hands it strings for dates and '' for empty cells, because decodeCell_ makes it so.
 * Postgres hands back Date objects, nulls and numerics. Feed those straight in and nothing throws —
 * the answers just quietly change. So decode_() below reproduces decodeCell_'s contract exactly:
 *
 *     a date          → 'YYYY-MM-DD'          (midnight in the school's timezone)
 *     a timestamp     → 'YYYY-MM-DD HH:mm:ss'
 *     a time          → 'HH:mm'
 *     empty           → ''                     NOT null — the engine compares with === all over
 *     '[…]' / '{…}'   → parsed                 (same rule decodeCell_ uses)
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 AND WRITES ARE A DIFF, NOT A REWRITE.
 *
 * GasEngine persists a whole collection: it rewrites the sheet from the array. That is why
 * NO_SHRINK_SHEETS exists, why 167 routes in Code.gs bypass the engine to write one row in place,
 * and why the 2026-07-09 wipe was possible at all. None of that is inherent to the engine — it is
 * inherent to SHEETS. Here, hydrate keeps a snapshot and persist emits per-row INSERT / UPDATE /
 * DELETE for what actually changed. A partial hydrate can no longer truncate anything, because
 * nothing is ever rewritten wholesale.
 */
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const decomment = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const snake = s => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toLowerCase();
/* Quote every identifier, for the same reason the generator does (see q() in schema_inventory.js):
 * STUDENT_TERMS has columns called `from` and `to`, which are reserved words in Postgres. Unquoted
 * they are a syntax error — and an INSERT that fails is a row that silently never arrives. */
const q = name => '"' + String(name).replace(/"/g, '""') + '"';

/* ── the mapping, read from the SAME declarations the SQL was generated from ──────────────────────
 * Three names for one thing, and all three are needed:
 *     engine field   NameTH        what webapp/engine.js reads
 *     sheet column   Name          what SCHEMA declares  (FIELD_ALIAS maps between these two)
 *     pg column      name          snake(sheet column)   — exactly what 001_init.sql created
 * Deriving it rather than writing it out means the mapping cannot drift from the schema. */
let SHEET_COLS = {};
function buildMap() {
  const cfg = decomment(R('src/Config.gs')), gas = R('src/GasEngine.gs');
  const sheets = {};
  for (const wb of ['MAIN', 'HR']) {
    const start = cfg.indexOf(`SCHEMA[WB.${wb}] = {`); if (start < 0) continue;
    const end = cfg.indexOf('\n};', start);
    const block = cfg.slice(start, end < 0 ? undefined : end);
    const re = /^\s{2}([A-Z][A-Z0-9_]*):\s*\[([\s\S]*?)\],?\s*$/gm;
    let m;
    while ((m = re.exec(block))) {
      const cols = (m[2].match(/'([^']+)'/g) || []).map(s => s.slice(1, -1));
      if (cols.length) sheets[m[1]] = [...new Set(cols)];      // STAFF declares Pause* twice
    }
  }
  SHEET_COLS = sheets;
  // COLLECTION_MAP: which engine collection comes from which sheet
  const cm = /var COLLECTION_MAP = \{([\s\S]*?)\n\};/.exec(gas);
  const collections = {};
  /* \s* everywhere, not a single space: COLLECTION_MAP is column-aligned, so the HR half reads
   * `{ wb: 'HR',   sheet: 'STAFF' }`. A regex written against the MAIN half silently matched 34 of
   * the 44 collections and dropped every HR one — including staff and payroll. */
  for (const x of cm[1].matchAll(/(\w+)\s*:\s*\{\s*wb\s*:\s*'(\w+)'\s*,\s*sheet\s*:\s*'([A-Z0-9_]+)'/g))
    collections[x[1]] = { wb: x[2], sheet: x[3], table: snake(x[3]) };
  // FIELD_ALIAS: sheet column → engine field
  const al = /var FIELD_ALIAS = \{([\s\S]*?)\};/.exec(gas);
  const alias = {};
  if (al) for (const b of al[1].matchAll(/([A-Z_]+):\s*\{([^}]*)\}/g)) {
    alias[b[1]] = {};
    for (const p of b[2].matchAll(/(\w+):\s*'(\w+)'/g)) alias[b[1]][p[1]] = p[2];
  }
  // engine field ⇄ pg column, per collection
  for (const key of Object.keys(collections)) {
    const c = collections[key];
    const cols = sheets[c.sheet] || [];
    const a = alias[c.sheet] || {};
    c.toPg = {}; c.toEngine = {}; c.toSheet = {};
    cols.forEach(sheetCol => {
      const engineField = a[sheetCol] || sheetCol;
      const pgCol = snake(sheetCol);
      c.toPg[engineField] = pgCol; c.toEngine[pgCol] = engineField; c.toSheet[engineField] = sheetCol;
    });
    c.known = cols.length > 0;
  }
  return collections;
}
const COLLECTIONS = buildMap();

/* ── values ──────────────────────────────────────────────────────────────────────────────────────
 * decodeCell_'s contract, reproduced. The school's timezone, not the server's: a date read back in
 * UTC is the off-by-one that has already cost this project a payslip month and a leave count. */
const TZ_OFFSET_MIN = 7 * 60;                       // Asia/Bangkok; the only timezone this school has
const p2 = n => String(n).padStart(2, '0');
function localParts(d) {
  const t = new Date(d.getTime() + TZ_OFFSET_MIN * 60000);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, da: t.getUTCDate(),
           h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds() };
}
function decode_(v, pgType) {
  /* 🔴 THE TYPE NAME, NOT THE WHOLE DECLARATION (found 2026-11-06, porting getPayslip). Two callers
   * pass two spellings: hydrate passes the driver's type name ('numeric'), readSheet passes the
   * declared one from the schema ('numeric(12,2)', 'date not null'). Compared with ===, every money
   * column on the route path — BaseSalary, NetPay, Contribution — came back as the TEXT '15000.00'
   * where Sheets (and the engine path) give the number 15000. Reduced to the bare name here, once. */
  pgType = String(pgType || '').toLowerCase().replace(/\(.*$/, '').replace(/\s+(not null|null|default\b.*|references\b.*|primary key\b.*)$/, '').trim();
  if (v === null || v === undefined) return '';            // Sheets gives '' — the engine compares with ===
  if (v instanceof Date) {
    const p = localParts(v);
    const ymd = p.y + '-' + p2(p.mo) + '-' + p2(p.da);
    if (pgType === 'date') return ymd;
    if (!p.h && !p.mi && !p.s) return ymd;                  // midnight reads back as a date
    return ymd + ' ' + p2(p.h) + ':' + p2(p.mi) + ':' + p2(p.s);
  }
  /* 🔴 numeric COMES BACK AS A STRING, AND THAT IS A MONEY BUG (found 2026-10-09).
   *
   * node-postgres refuses to parse `numeric` into a JS number on purpose — numeric can hold values
   * float64 cannot represent, so handing back a number would lose precision silently. Correct of the
   * driver, and wrong for us: Sheets gives the engine a NUMBER, so a column that arrives as
   * '18000.00' changes what the engine computes without changing what it reads.
   *
   *     Number('18000.00')          18000        — so Number(x||0) sites survive, and most are
   *     '18000.00' + '1200.50'      '18000.001200.50'   — and these do not
   *     '0.00' === 0                false        — nor these
   *     sort((a,b) => a.Amount - b.Amount)       works; sort by string does not
   *
   * The irony is exact: thirteen columns became numeric TO protect the money, and becoming numeric
   * is what turned them into strings. This was hidden by a test that asserted
   * `Number(staff[0].BaseSalary) === 16000` — Number() applied in the assertion itself, which tests
   * the value and cannot see the type. 12 digits with 2 decimals is at most 9,999,999,999.99, well
   * inside float64's exact range in cents, so nothing is lost converting here — and this is the same
   * number the engine has always worked with on Sheets. */
  if (pgType === 'numeric') {
    if (v === '') return '';
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }
  if (pgType === 'time' || pgType === 'time without time zone') return String(v).slice(0, 5);
  if (typeof v === 'string' && /^[[{]/.test(v.trim())) { try { return JSON.parse(v); } catch (e) {} }
  if (typeof v === 'object') return v;                      // jsonb already parsed by the driver
  return v;
}
/* ── the other direction: what goes back into a column ───────────────────────────────────────────
 *
 * 🔴 TYPE-AWARE SINCE PHASE 2.3, and borrowed from the migrator rather than written again.
 *
 * This used to hand the value straight to the driver, which is fine until the value is one a
 * spreadsheet really holds and a typed column really refuses — "Sat Dec 30 1899" in a `time`,
 * "500,000.00" in a `numeric`, "วันที่ 15" where a day of the month was expected. Running the test
 * suites against the live schema produced all four shapes in a single sweep, because the fixtures
 * are a record of what has already happened to this school.
 *
 * It is pg_migrate's encode_ because there must not be two answers to "what goes in this column".
 * The migrator is where the rule is written down and tested; this follows it. */
const TYPES_BY_TABLE = (() => {
  try { return require('./pg_migrate.js').targetSchema(); } catch (e) { return {}; }
})();
const migEncode_ = (() => {
  try { return require('./pg_migrate.js').encode_; } catch (e) { return null; }
})();
function encode_(v, pgType, where) {
  if (migEncode_) return migEncode_(v, pgType, where);
  if (v === undefined || v === '' || v === null) return null;
  if (typeof v === 'object' && !(v instanceof Date)) return JSON.stringify(v);
  return v;
}
/** The declared type of one column, so encode_ above knows what it is aiming at. */
const typeOf_ = (table, col) => (TYPES_BY_TABLE[table] || {})[col] || '';

/* ── hydrate ─────────────────────────────────────────────────────────────────────────────────────
 * Only the collections asked for. GasEngine does the same thing lazily per request, and for the
 * same reason: a screen that needs the class list must not pay for four years of journals. */
/**
 * hydrateFast — เหมือน hydrate ทุกประการ แต่ยิง query เดียว
 *
 * 🔴 วัดเมื่อ 2026-10-30 บน staging (สิงคโปร์ · เครื่องวัดอยู่ไทย):
 *
 *     ค่าเดินทางต่อ 1 query      30ms
 *     hydrate ยิง 38 query       1,140ms  ← ของเดิม
 *     38 statement ใน query เดียว   31ms  ← ของใหม่
 *
 * **เป็นความผิดพลาดเดียวกับ Apps Script ย่อส่วน: ราคาอยู่ที่ "จำนวนรอบ" ไม่ใช่ "งาน"**
 * เอนจินทำงานจบใน 2ms ส่วนการไปเอาข้อมูลมาใช้ 1,140ms เพราะเดินทาง 38 เที่ยว
 *
 * ลองยิงทั้ง 38 แบบไม่ await ทีละอันแล้ว — ไม่ช่วยเลย (1,126ms → 1,160ms)
 * เพราะ node-postgres ต่อคิวให้บน connection เดียว ไม่ได้ส่งขนานจริง
 *
 * ─────────────────────────────────────────────────
 * 🔴 ทำไมไม่ใช้ json_agg ซึ่งเป็นวิธีที่นึกถึงก่อน
 *
 * เพราะ decode_ ตัดสินใจจาก **dataTypeID ของคอลัมน์** ว่าอันไหนเป็น date อันไหนเป็น timestamp
 * ถ้าห่อเป็น JSON ทุกอย่างจะกลายเป็นสตริงและข้อมูลชนิดนั้นหายไป — ซึ่งคือทางตรงไปสู่
 * บั๊กเวลาเพี้ยน 7 ชั่วโมงที่โปรเจ็กต์นี้จ่ายค่าไปแล้วสองครั้ง (ดูหมายเหตุใน decode_)
 * multi-statement คืน fields ครบทุกชุด ชนิดข้อมูลจึงยังอ่านได้เหมือนเดิมทุกตัว
 *
 * 🔴 ข้อแลกเปลี่ยน: simple query ไม่มีพารามิเตอร์ tenant_id จึงต้องต่อเป็นสตริง
 * จึงบังคับให้เป็น uuid เท่านั้นก่อนต่อ — ถ้าไม่ใช่ ปฏิเสธทันที ไม่ใช่พยายาม escape เอาเอง
 */
const UUID_ = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function hydrateFast(client, tenantId, keys, opts) {
  if (!UUID_.test(String(tenantId || ''))) {
    // ไม่ใช่ uuid = ไม่ต่อสตริง · ล้มเสียงดังดีกว่าเปิดช่องให้ค่าที่ควบคุมไม่ได้เข้าไปอยู่ใน SQL
    throw new Error('hydrateFast: tenantId ต้องเป็น uuid');
  }
  const M = {}, snapshot = {};
  const asked = [];
  for (const key of keys) {
    const c = COLLECTIONS[key];
    if (!c) throw new Error('unknown collection: ' + key);
    /* จองที่ของคีย์ไว้ตามลำดับที่ถูกถามมา แล้วค่อยเติมเนื้อทีหลัง
     * 🔴 ถ้าปล่อยให้คีย์ที่ไม่รู้จักมาก่อนคีย์ที่รู้จัก JSON.stringify(M) จะต่างจาก hydrate
     * ทั้งที่ทุกแถวเหมือนกัน — ความต่างที่ไม่มีความหมาย แต่ทำให้การเทียบสองทางอ่านไม่ออก */
    M[key] = []; snapshot[key] = [];
    if (c.known) asked.push(key);
  }
  if (!asked.length) return { M, snapshot };

  /* ── แคบลงตามวัน ─────────────────────────────────────────────────────────────────
   * วัดบน staging 2026-10-30 ด้วยข้อมูล 120 วันเรียน:
   *
   *     ทั้ง 43 collection                395ms
   *     ตัด journals ออก                  167ms   ← journals อย่างเดียว 228ms / 937KB
   *     ตัด journals + checkinStudent      38ms   ← checkinStudent 129ms / 356KB
   *
   * **สอง collection คือ 90% ของเวลาทั้งหมด** และเป็นสองตัวที่โตขึ้นทุกวันไม่มีหยุด
   * ที่เหลืออีก 41 ตัวรวมกันแค่ 38ms
   *
   * GasEngine แคบ journals เหลือวันเดียวมาตั้งแต่ต้น (journalScopeFor_ + lazyRO_) ด้วยเหตุผลเดียวกัน
   * — ที่นี่ทำเหมือนกัน แต่ให้ **ผู้เรียกประกาศมาเอง** ไม่ใช่เดาจาก action
   *
   * 🔴 ทำไมการแคบถึงไม่ทำให้ข้อมูลหาย:
   * persist() ลบเฉพาะแถวที่อยู่ใน snapshot แต่ไม่อยู่ใน M — และ snapshot ก็ถูกแคบมาพร้อมกัน
   * แถวของวันอื่นจึงไม่เคยถูกโหลดมา และไม่เคยเข้าไปอยู่ในชุดที่พิจารณาลบ
   * (นี่คือสิ่งที่ lazyRO_ ใน GasEngine ป้องกันด้วยวิธีอื่น เพราะชีตเขียนทับทั้งแผ่น)
   *
   * ⚠️ แต่ยังแปลว่า: handler ที่ต้องการเห็นทุกวัน จะเห็นไม่ครบถ้าผู้เรียกแคบผิด
   * ผู้เรียกจึงต้องแคบเฉพาะตอนที่รู้ว่าคำขอนั้นถามถึงวันเดียวจริง ๆ */
  const scope = (opts && opts.scope) || {};
  const DATE_COL = { journals: 'date', checkinStudent: 'date' };
  const sql = asked.map(k => {
    const col = DATE_COL[k], d = scope[k];
    let where = `tenant_id = '${tenantId}'`;
    if (col && d) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) throw new Error('hydrateFast: scope.' + k + ' ต้องเป็น YYYY-MM-DD');
      where += ` and "${col}" = '${d}'`;
    }
    return `select * from ${COLLECTIONS[k].table} where ${where} order by seq`;
  }).join('; ');
  const res = await client.query(sql);
  // statement เดียวคืน object · หลาย statement คืน array — ทำให้เป็น array เสมอ
  const list = Array.isArray(res) ? res : [res];
  if (list.length !== asked.length) {
    throw new Error('hydrateFast: ได้ผลลัพธ์ ' + list.length + ' ชุด แต่ถามไป ' + asked.length);
  }
  asked.forEach((key, i) => { rowsInto_(M, snapshot, key, list[i]); });
  return { M, snapshot };
}

/** แปลงผลลัพธ์หนึ่งชุดเป็นแถวของเอนจิน — ใช้ร่วมกันทั้ง hydrate และ hydrateFast
 *  ให้สองทางถอดรหัสด้วยโค้ดบรรทัดเดียวกัน ไม่ใช่สองสำนวนที่ต้องคอยดูว่าตรงกันไหม */
function rowsInto_(M, snapshot, key, res) {
  const c = COLLECTIONS[key];
  const types = {};
  res.fields.forEach(f => { types[f.name] = f.dataTypeID; });
  const rows = res.rows.map(r => {
    const o = { __id: r.id };
    Object.keys(r).forEach(pgCol => {
      const ef = c.toEngine[pgCol];
      if (!ef) return;
      o[ef] = decode_(r[pgCol], pgTypeName(types[pgCol]));
    });
    return o;
  });
  M[key] = rows;
  snapshot[key] = rows.map(r => JSON.stringify(r));
}

async function hydrate(client, tenantId, keys) {
  const M = {}, snapshot = {};
  for (const key of keys) {
    const c = COLLECTIONS[key];
    if (!c) throw new Error('unknown collection: ' + key);
    if (!c.known) { M[key] = []; snapshot[key] = []; continue; }
    const res = await client.query(`select * from ${c.table} where tenant_id = $1 order by seq`, [tenantId]);
    /* ถอดรหัสด้วยตัวเดียวกับ hydrateFast — สองทางเข้าถึงข้อมูล แต่ต้องได้แถวหน้าตาเดียวกันเป๊ะ
     * ถ้าแยกเป็นสองสำนวน วันหนึ่งมันจะต่างกันโดยไม่มีอะไรบอก และจะต่างกันเรื่องชนิดของวันที่
     * ซึ่งเป็นเรื่องที่โปรเจ็กต์นี้จ่ายค่าไปแล้วสองครั้ง · tools/test_pg_hydrate_fast.js ตรึงไว้ */
    rowsInto_(M, snapshot, key, res);
  }
  return { M, snapshot };
}
// the handful of oids this schema actually uses — enough to tell a date from a timestamp
const OID = { 1082: 'date', 1083: 'time', 1114: 'timestamp', 1184: 'timestamptz', 1700: 'numeric' };
const pgTypeName = oid => OID[oid] || '';

/* ── persist ─────────────────────────────────────────────────────────────────────────────────────
 * Per row, by diff. A row the engine added has no __id; one it changed has a different shape from
 * its snapshot; one it removed is simply gone. Nothing is ever rewritten wholesale, which is the
 * single most important difference from GasEngine. */
async function persist(client, tenantId, M, snapshot, keys) {
  const out = { inserted: 0, updated: 0, deleted: 0 };
  for (const key of (keys || Object.keys(M))) {
    const c = COLLECTIONS[key]; if (!c || !c.known) continue;
    const before = new Map();
    (snapshot[key] || []).forEach(s => { const r = JSON.parse(s); before.set(r.__id, s); });
    const seen = new Set();

    for (const row of (M[key] || [])) {
      /* 🔴 NOTHING NULL GOES INTO created_at / updated_at. Three sheets carry their own CreatedAt /
       * UpdatedAt columns, which snake onto the reserved ones the schema declares `not null default
       * now()`. A blank cell encodes to null and the insert is refused outright; so does a cell
       * holding something that is not a timestamp, which is the commoner case and the reason this
       * tests the ENCODED value rather than the raw one. Leaving the column out lets the default do
       * exactly what it is there for. */
      const cols = Object.keys(c.toPg).filter(f => {
        if (row[f] === undefined) return false;
        if (!/^(created_at|updated_at)$/.test(c.toPg[f])) return true;
        return encode_(row[f], typeOf_(c.table, c.toPg[f])) != null;
      });
      if (row.__id == null) {
        const names = cols.map(f => q(c.toPg[f]));
        const vals = cols.map(f => encode_(row[f], typeOf_(c.table, c.toPg[f]), c.table + "." + c.toPg[f]));
        const ph = vals.map((_, i) => '$' + (i + 2)).join(',');
        const res = await client.query(
          `insert into ${c.table} (tenant_id${names.length ? ',' + names.join(',') : ''})
           values ($1${vals.length ? ',' + ph : ''}) returning id`, [tenantId, ...vals]);
        row.__id = res.rows[0].id; out.inserted++;
      } else {
        seen.add(row.__id);
        if (before.get(row.__id) === JSON.stringify(row)) continue;   // untouched
        const names = cols.map((f, i) => q(c.toPg[f]) + '=$' + (i + 3));
        const vals = cols.map(f => encode_(row[f], typeOf_(c.table, c.toPg[f]), c.table + "." + c.toPg[f]));
        /* the sheet's own UpdatedAt (DAILY_JOURNAL) is the engine's to set, not ours — see stampUpdated_ */
        const own = Object.keys(c.toPg).some(f => c.toPg[f] === 'updated_at');
        const sets = names.join(',') + (own ? '' : (names.length ? ', ' : '') + 'updated_at = now()');
        if (!sets) continue;
        await client.query(
          `update ${c.table} set ${sets}
           where id = $1 and tenant_id = $2`, [row.__id, tenantId, ...vals]);
        out.updated++;
      }
    }
    for (const id of before.keys()) {
      if (seen.has(id)) continue;
      await client.query(`delete from ${c.table} where id = $1 and tenant_id = $2`, [id, tenantId]);
      out.deleted++;
    }
    /* 🔴 ROW ORDER IS PART OF WHAT GasEngine WRITES (found porting writes, 2026-11-04).
     * writeRows_ puts the rows on the sheet in ARRAY order, so a handler that unshifts — a new
     * announcement goes on top — leaves it in row 2. Here an insert always takes the next seq, so
     * read back it came out LAST, and anything that reads "the first" or "the latest" by position
     * would have answered differently from Apps Script. When the order in M is not already the
     * order in the table (an insert that is not at the end, or rows moved), the collection is
     * renumbered to M's order. Appends — nearly every write — stay a single insert. */
    const beforeIds = [...before.keys()].filter(id => seen.has(id));
    const nowIds = (M[key] || []).map(r => r.__id);
    const kept = nowIds.filter(id => before.has(id));
    const firstNew = nowIds.findIndex(id => !before.has(id));
    const tailOnly = firstNew < 0 || nowIds.slice(firstNew).every(id => !before.has(id));
    if (!tailOnly || kept.join() !== beforeIds.join()) {
      for (const id of nowIds) {
        await client.query(`update ${c.table} set seq = nextval(pg_get_serial_sequence('${c.table}', 'seq'))
          where id = $1 and tenant_id = $2`, [id, tenantId]);
      }
      out.reordered = (out.reordered || 0) + 1;
    }
  }
  return out;
}

/* ── M.config — the school's settings ─────────────────────────────────────────────────────────
 * 🔴 FOUND ON THE FIRST REAL DEPLOY (Cloud Run, 2026-11-04): this file built every collection and
 * never M.config, so on the fast host 210 of the teacher home's 300 calls died with "Cannot read
 * properties of undefined (reading 'Departments')". measure_fast_host.js never saw it — it wraps
 * each handler in `catch (e) {}` — and the suites never saw it because pg_hook keeps the suite's
 * own M.config. GasEngine loads it eagerly because "almost everything" uses it.
 *
 * NOT A SECOND COPY. The settings are shaped by GasEngine's own hydrateConfig_ (array keys, JSON
 * cells, numbers, Links, the leave-quota and insurance defaults), lifted from src/GasEngine.gs and
 * run here, so the two cannot drift. Only its inputs are swapped: SCHOOL_CONFIG rows come from the
 * school_config table, and there is no CacheService. */
function liftGas_(src, startRe) {
  /* A top-level function or object in GasEngine.gs closes with `}` in column 0. Counting braces
   * instead would be fooled by the `{` inside hydrateConfig_'s own regex, /^[\[{]/. One-liners
   * (`var X = { … };` on a single line) end on the line they start. */
  const m = startRe.exec(src); if (!m) throw new Error('pg_engine: not found in GasEngine.gs: ' + startRe);
  const eol = src.indexOf('\n', m.index), first = src.slice(m.index, eol);
  if (/\};?\s*(\/\/.*)?$/.test(first) && (first.match(/\{/g) || []).length === (first.match(/\}/g) || []).length) return first;
  const end = src.indexOf('\n}', m.index); if (end < 0) throw new Error('pg_engine: no end for ' + startRe);
  return src.slice(m.index, end + 2);
}
let configShaper_ = null;
function configShaper() {
  if (configShaper_) return configShaper_;
  const gas = R('src/GasEngine.gs'), vm = require('vm');
  const code = [
    liftGas_(gas, /^var CONFIG_ARRAY_KEYS = /m) + ';',
    liftGas_(gas, /^var ENGINE_REF = /m) + ';',
    liftGas_(gas, /^function decodeCell_\(/m),
    liftGas_(gas, /^function hydrateConfig_\(/m),
    'function cacheGet_() { return null; } function cachePut_() {}',
    'function shape(raw) { getAllConfig_ = function () { return raw; }; return hydrateConfig_(); }'
  ].join('\n');
  const box = { getAllConfig_: null };
  vm.runInNewContext(code, box);
  return (configShaper_ = box.shape);
}
async function hydrateConfig(client, tenantId, opts) {
  const r = await client.query('select "key", "value" from school_config where tenant_id = $1 order by seq', [tenantId]);
  const raw = {};
  r.rows.forEach(x => { raw[String(x.key)] = x.value == null ? '' : x.value; });   // a blank cell reads '' from Sheets
  /* opts.rows: the same rows AS A SHEET — exactly what readSheet(…, 'SCHOOL_CONFIG') returns (same query,
   * same order, same decode_) — so server/routes.js's getConfig_ needs no second round trip.
   * test_fast_routes_live.js compares the two on a real database. */
  if (opts && Array.isArray(opts.rows)) {
    r.rows.forEach(x => opts.rows.push({ Key: sheetDecode_(x.key, typeOf_('school_config', 'key')), Value: sheetDecode_(x.value, typeOf_('school_config', 'value')) }));
  }
  /* vm objects carry the sandbox's prototypes; round-trip so handlers get ordinary objects */
  return JSON.parse(JSON.stringify(configShaper()(raw)));
}

/* ── the DERIVED keys — what GasEngine computes rather than reads ─────────────────────────────────
 * 🔴 FOUND THE SAME DAY AS M.config. Running every read handler for all three roles over an M built
 * here, with a Proxy recording what they reached for, listed eleven keys this file never made —
 * today's attendance for children and staff, staff history, check-in pairs, leave used, payroll
 * settings, the feed and calendar, the permission matrix, the vaccine schedule. ~35 handlers, four
 * of them on the teacher's home screen.
 *
 * NOT A SECOND COPY, again. The block of hydrateLazy_ that defines them is lifted out of
 * src/GasEngine.gs, with the helpers it calls, and run here; only its two raw reads are swapped
 * (CHECKIN_STAFF and PAYROLL_CONFIG, read from their tables below, with the SHEET's column names —
 * readRows_ hands back raw sheet rows, not aliased engine fields).
 *
 * 🔴 NOTHING DERIVED IS WRITTEN BACK. GasEngine persists payrollConfig and staffAttendanceToday;
 * this does not, so a staff clock-in through the fast host would vanish without an error. That is
 * why server/host.js refuses every write until that path exists and is tested. */
/* 🔴 ONE SHEET NAME, TWO TABLES. AUDIT_LOG exists in both workbooks and they are different logs (MAIN →
 * audit_log, HR → hr_audit_log — schema_inventory HR_PREFIXED). A caller names the HR one 'HR_AUDIT_LOG'
 * (server/routes.js does, from the workbook a sheet_() call names): same columns, its own table. */
const colsOf = sheet => SHEET_COLS[sheet] || (sheet === 'HR_AUDIT_LOG' ? SHEET_COLS.AUDIT_LOG : null) || [];
/* 🔴 A SHEET'S TEXT IS TEXT (found 2026-11-07, the first W1 run on staging). decode_ is the ENGINE's reader
 * — it turns '{"ลาป่วย":30}' into an object, because GasEngine's decodeCell_ does. But the rows readSheet
 * hands back are read by Apps Script's OWN code (server/routes.js), which on Sheets — and on Postgres,
 * through DbPg.gs pgDecode_ — gets the text as text. SCHOOL_CONFIG.LeaveQuota came back an object here and
 * a string there. A handler that does String(r.Value) would have printed "[object Object]". So: text and
 * jsonb stay their text, exactly as pgDecode_ returns them; numbers, dates, times and booleans as before. */
function sheetDecode_(v, pgType) {
  const t = String(pgType || '').toLowerCase().replace(/\(.*$/, '').trim().split(/\s+/)[0];
  const typed = /^(numeric|integer|bigint|smallint|real|double|date|time|timestamp|timestamptz|boolean)$/.test(t);
  if (!typed && typeof v === 'string') return v;
  if (!typed && v && typeof v === 'object' && !(v instanceof Date)) return JSON.stringify(v);   // jsonb, parsed by the driver
  return decode_(v, pgType);
}
async function readSheet(client, tenantId, sheet, opts) {
  const cols = colsOf(sheet); if (!cols || !cols.length) return [];
  const table = snake(sheet), withId = !!(opts && opts.withId);
  const r = await client.query('select ' + (withId ? 'id::text as "__id",' : '') + cols.map(c => q(snake(c))).join(',') + ' from ' + table +
    ' where tenant_id = $1 order by seq', [tenantId]);
  return r.rows.map(row => {
    const o = {}; cols.forEach(c => { o[c] = sheetDecode_(row[snake(c)], typeOf_(table, snake(c))); });
    if (withId) o.__id = row.__id;            // which row to update — server/routes.js strips it before Apps Script code sees it
    return o;
  });
}
/* 🔴 updated_at IS SOMETIMES THE SHEET'S OWN COLUMN (found 2026-11-07, W1 on staging). DAILY_JOURNAL has an
 * `UpdatedAt` — when the teacher last edited the report — and the schema deliberately lands it on the
 * reserved updated_at (schema_inventory RESERVED NAMES). Stamping now() on every update therefore rewrote
 * the TEACHER'S time on writes that never touched it (unlockJournal changes the status only), where Apps
 * Script — on Sheets and through DbPg alike — leaves the cell as it was. So now() is added only when the
 * sheet has no column of its own there; when it does, the sheet's value moves only if the write names it.
 * (And naming it AND stamping it would assign the column twice, which Postgres refuses.) */
function stampUpdated_(cols, keys) {
  const own = cols.some(c => snake(c) === 'updated_at');
  return (own || keys.some(k => snake(k) === 'updated_at')) ? '' : ', updated_at = now()';
}
/* Update named cells of rows read with readSheet(…, { withId: true }) — what DbPg's updateRow_ does for a
 * Code.gs route run on the fast host. A row deleted meanwhile is an error, not a silent no-op, and only
 * the sheet's declared columns can be named. */
async function updateSheetRows(client, tenantId, sheet, updates) {
  const cols = colsOf(sheet), table = snake(sheet);
  let n = 0;
  for (const u of updates || []) {
    const keys = Object.keys(u.patch || {});
    if (!u.id || !keys.length) throw new Error('updateSheetRows: ' + sheet + ' update without a row id or a column');
    keys.forEach(k => { if (cols.indexOf(k) < 0) throw new Error('updateSheetRows: ' + sheet + ' has no column ' + k); });
    const vals = keys.map(k => encode_(u.patch[k], typeOf_(table, snake(k)), table + '.' + snake(k)));
    const sets = keys.map((k, i) => q(snake(k)) + ' = $' + (i + 3)).join(', ');
    const r = await client.query('update ' + table + ' set ' + sets + stampUpdated_(cols, keys) + ' where id = $1 and tenant_id = $2',
      [u.id, tenantId].concat(vals));
    if (r.rowCount !== 1) throw new Error('updateSheetRows: ' + sheet + ' row ' + u.id + ' is gone');
    n++;
  }
  return { updated: n };
}
/* Append one row — what appendObject_ does (a new row at the END: seq is the sheet's row order).
 * Only the sheet's declared columns; a key that is not one is an error, never silently dropped
 * (server/routes.js has already reduced the object to the header columns, as appendObject_ does). */
async function insertSheetRow(client, tenantId, sheet, row) {
  const cols = colsOf(sheet), table = snake(sheet);
  if (!cols.length) throw new Error('insertSheetRow: no sheet ' + sheet);
  /* a blank CreatedAt / UpdatedAt (they snake onto the reserved not-null columns) is left to the default,
   * exactly as persist does — '' would encode to null and the insert would be refused outright */
  const keys = Object.keys(row || {}).filter(k => row[k] !== undefined &&
    !(/^(created_at|updated_at)$/.test(snake(k)) && encode_(row[k], typeOf_(table, snake(k))) == null));
  keys.forEach(k => { if (cols.indexOf(k) < 0) throw new Error('insertSheetRow: ' + sheet + ' has no column ' + k); });
  const vals = keys.map(k => encode_(row[k], typeOf_(table, snake(k)), table + '.' + snake(k)));
  const r = await client.query('insert into ' + table + ' (tenant_id' + keys.map(k => ',' + q(snake(k))).join('') + ') values ($1' +
    keys.map((_, i) => ',$' + (i + 2)).join('') + ') returning id::text as id', [tenantId].concat(vals));
  return r.rows[0].id;
}
/* Delete one row by its id — what sheet.deleteRow does. A row already gone is an error: the caller read
 * it under the same lock, so it vanishing means something is wrong, not "nothing to do". */
async function deleteSheetRow(client, tenantId, sheet, id) {
  const r = await client.query('delete from ' + snake(sheet) + ' where id = $1 and tenant_id = $2', [id, tenantId]);
  if (r.rowCount !== 1) throw new Error('deleteSheetRow: ' + sheet + ' row ' + id + ' is gone');
}
/**
 * Apply what a ported Code.gs route did, IN THE ORDER IT DID IT (server/routes.js sink):
 *   { op:'update', sheet, id, patch } · { op:'insert', sheet, tmp, row } · { op:'delete', sheet, id }
 * A row the route added and then changed or removed carries a temporary id ('new:…'); it is mapped to
 * the real one as the insert lands. Returns { SHEET: { updated, inserted, deleted } }.
 */
async function applySheetOps(client, tenantId, ops) {
  const real = {}, out = {};
  const idOf = id => (String(id).indexOf('new:') === 0 ? real[id] : id);
  for (const o of ops || []) {
    const c = out[o.sheet] || (out[o.sheet] = { updated: 0, inserted: 0, deleted: 0 });
    if (o.op === 'insert') { real[o.tmp] = await insertSheetRow(client, tenantId, o.sheet, o.row); c.inserted++; }
    else if (o.op === 'update') { await updateSheetRows(client, tenantId, o.sheet, [{ id: idOf(o.id), patch: o.patch }]); c.updated++; }
    else if (o.op === 'delete') { await deleteSheetRow(client, tenantId, o.sheet, idOf(o.id)); c.deleted++; }
    else throw new Error('applySheetOps: unknown op ' + o.op);
  }
  return out;
}
/* 🔴 Apps Script caches rows in CacheService under keys that carry each sheet's version (src/DbPg.gs
 * CACHE VERSIONS). A write here that does not bump the version leaves Apps Script serving the old rows
 * for up to CacheTTL — so every writer calls this, inside the SAME transaction as the write: the new
 * version and the new rows become visible together. Sheet names, as the GAS cache keys use them. */
async function bumpCacheVersions(client, tenantId, sheets) {
  const list = [...new Set(sheets || [])].sort();     // one fixed order: two writers never deadlock on these rows
  for (const s of list) {
    await client.query('insert into cache_version (tenant_id, sheet, ver) values ($1, $2, 1) ' +
      'on conflict (tenant_id, sheet) do update set ver = cache_version.ver + 1', [tenantId, s]);
  }
  return list;
}
let deriver_ = null;
function deriver() {
  if (deriver_) return deriver_;
  const gas = R('src/GasEngine.gs'), leave = R('src/Leave.gs'), vm = require('vm');
  const h = gas.indexOf('function hydrateLazy_(');
  const from = gas.indexOf("  lazyRW_(M, cache, snap, 'payrollConfig'", h), to = gas.indexOf('  function persist() {', h);
  if (h < 0 || from < 0 || to < from) throw new Error('pg_engine: derived block not found in hydrateLazy_');
  const lift = re => liftGas_(gas, re);
  const code = [
    lift(/^var ENGINE_REF = /m) + ';',
    liftGas_(leave, /^var LEAVE_TYPE_ALIAS_ = /m) + ';',
    liftGas_(leave, /^function leaveTypeTH_\(/m),
    lift(/^function decodeCell_\(/m), lift(/^function coerce_\(/m), lift(/^function ciTimeHHmm_\(/m),
    lift(/^function ymd4_\(/m), lift(/^function deriveStudentCheckins_\(/m), lift(/^function deriveStudentToday_\(/m),
    lift(/^function deriveLeaveUsed_\(/m), lift(/^function hydratePayrollConfig_\(/m),
    'function derive(M, raw, t, lazyRW_, lazyRO_) {',
    '  var cache = {}, snap = {};',
    '  gasToday_ = function () { return t; };',
    '  readRows_ = function (wb, sheet) { return raw[sheet] || []; };',
    '  function rawCheckinStaff() { return raw.CHECKIN_STAFF || []; }',
    gas.slice(from, to),
    '}'
  ].join('\n');
  const box = { gasToday_: null, readRows_: null, getConfig_: (k, d) => d,
    Utilities: { formatDate: () => '' } };          // rows arrive as strings; no Date reaches formatDate
  vm.runInNewContext(code, box);
  return (deriver_ = box.derive);
}
/* ── the derived keys that ARE written back on GAS ────────────────────────────────────────────────
 * payrollConfig — GasEngine's writePayrollConfig_ turns the map back into one row per staff member
 * (`{...settings, StaffID}`) and rewrites PAYROLL_CONFIG with exactly those rows, in the map's order.
 * Same here, inside the caller's transaction and lock: the tenant's rows are replaced by the map.
 * A key the sheet has no column for is dropped, exactly as writeRows_ drops it.
 * (staffAttendanceToday — a staff clock-in — still has NO writer: the host refuses it.) */
async function writePayrollConfig(client, tenantId, obj) {
  const cols = SHEET_COLS.PAYROLL_CONFIG || [];
  if (!cols.length) throw new Error('writePayrollConfig: PAYROLL_CONFIG has no declared columns');
  const table = 'payroll_config';
  const rows = Object.keys(obj || {}).map(id => Object.assign({}, obj[id], { StaffID: id }));
  await client.query('delete from ' + table + ' where tenant_id = $1', [tenantId]);
  for (const r of rows) {
    const use = cols.filter(c => r[c] !== undefined);
    const vals = use.map(c => encode_(r[c], typeOf_(table, snake(c)), table + '.' + snake(c)));
    await client.query('insert into ' + table + ' (tenant_id' + use.map(c => ',' + q(snake(c))).join('') + ') values ($1' +
      vals.map((_, i) => ',$' + (i + 2)).join('') + ')', [tenantId, ...vals]);
  }
  return { rows: rows.length };
}

/* Lazy, like GasEngine — a handler that never touches staff history never pays for it — and each
 * value is copied out of the sandbox so handlers get this realm's arrays and objects. */
const plain_ = v => v === undefined ? v : JSON.parse(JSON.stringify(v));
function lazy_(M, cache, key, loader, init) {
  Object.defineProperty(M, key, { enumerable: true, configurable: true,
    get() { if (!(key in cache)) { cache[key] = plain_(loader()); init[key] = JSON.stringify(cache[key]); } return cache[key]; },
    set(v) { if (!(key in init)) init[key] = JSON.stringify(plain_(loader())); cache[key] = v; } });
}
async function hydrateDerived(client, tenantId, M, today) {
  const raw = { CHECKIN_STAFF: await readSheet(client, tenantId, 'CHECKIN_STAFF'),
                PAYROLL_CONFIG: await readSheet(client, tenantId, 'PAYROLL_CONFIG') };
  const cache = {}, init = {}, ro = {};
  const def = (Mx, _c, _s, key, loader) => lazy_(Mx, cache, key, loader, init);
  /* lazyRO_ keys (feed, calendar, …) are READ-ONLY on Apps Script: GasEngine's setter keeps the change in
   * memory and nothing ever saves it. So a handler that pushes to one (submitInjury adds to M.feed) is not
   * a write here either — it is dropped exactly as Apps Script drops it (W2, 2026-11-09). */
  deriver()(M, raw, today, (Mx, c, s, key, loader) => def(Mx, c, s, key, loader), (Mx, c, key, loader) => { ro[key] = 1; def(Mx, c, null, key, loader); });
  /** the derived keys a handler CHANGED that Apps Script would save — read, untouched and read-only ones are not listed */
  return function derivedChanged() { return Object.keys(init).filter(k => !ro[k] && JSON.stringify(cache[k]) !== init[k]); };
}

module.exports = { COLLECTIONS, hydrate, hydrateFast, hydrateConfig, hydrateDerived, readSheet, updateSheetRows, insertSheetRow, deleteSheetRow, applySheetOps, colsOf, bumpCacheVersions, writePayrollConfig, persist, decode_, encode_, snake, liftGas_, SHEET_COLS: () => SHEET_COLS };
