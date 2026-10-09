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

/* ── the mapping, read from the SAME declarations the SQL was generated from ──────────────────────
 * Three names for one thing, and all three are needed:
 *     engine field   NameTH        what webapp/engine.js reads
 *     sheet column   Name          what SCHEMA declares  (FIELD_ALIAS maps between these two)
 *     pg column      name          snake(sheet column)   — exactly what 001_init.sql created
 * Deriving it rather than writing it out means the mapping cannot drift from the schema. */
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
    c.toPg = {}; c.toEngine = {};
    cols.forEach(sheetCol => {
      const engineField = a[sheetCol] || sheetCol;
      const pgCol = snake(sheetCol);
      c.toPg[engineField] = pgCol; c.toEngine[pgCol] = engineField;
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
/** The other direction: what goes back into a column. */
function encode_(v) {
  if (v === undefined || v === '' ) return null;
  if (v === null) return null;
  if (typeof v === 'object' && !(v instanceof Date)) return JSON.stringify(v);
  return v;
}

/* ── hydrate ─────────────────────────────────────────────────────────────────────────────────────
 * Only the collections asked for. GasEngine does the same thing lazily per request, and for the
 * same reason: a screen that needs the class list must not pay for four years of journals. */
async function hydrate(client, tenantId, keys) {
  const M = {}, snapshot = {};
  for (const key of keys) {
    const c = COLLECTIONS[key];
    if (!c) throw new Error('unknown collection: ' + key);
    if (!c.known) { M[key] = []; snapshot[key] = []; continue; }
    const res = await client.query(`select * from ${c.table} where tenant_id = $1 order by seq`, [tenantId]);
    const types = {};
    res.fields.forEach(f => { types[f.name] = f.dataTypeID; });
    const rows = res.rows.map(r => {
      const o = { __id: r.id };   // seq is the sheet position; never shown to a handler
      Object.keys(r).forEach(pgCol => {
        const ef = c.toEngine[pgCol];
        if (!ef) return;                                    // id / tenant_id / created_at / updated_at
        o[ef] = decode_(r[pgCol], pgTypeName(types[pgCol]));
      });
      return o;
    });
    M[key] = rows;
    snapshot[key] = rows.map(r => JSON.stringify(r));        // what persist() compares against
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
      const cols = Object.keys(c.toPg).filter(f => row[f] !== undefined);
      if (row.__id == null) {
        const names = cols.map(f => c.toPg[f]);
        const vals = cols.map(f => encode_(row[f]));
        const ph = vals.map((_, i) => '$' + (i + 2)).join(',');
        const res = await client.query(
          `insert into ${c.table} (tenant_id${names.length ? ',' + names.join(',') : ''})
           values ($1${vals.length ? ',' + ph : ''}) returning id`, [tenantId, ...vals]);
        row.__id = res.rows[0].id; out.inserted++;
      } else {
        seen.add(row.__id);
        if (before.get(row.__id) === JSON.stringify(row)) continue;   // untouched
        const names = cols.map((f, i) => c.toPg[f] + '=$' + (i + 3));
        const vals = cols.map(f => encode_(row[f]));
        await client.query(
          `update ${c.table} set ${names.join(',')}, updated_at = now()
           where id = $1 and tenant_id = $2`, [row.__id, tenantId, ...vals]);
        out.updated++;
      }
    }
    for (const id of before.keys()) {
      if (seen.has(id)) continue;
      await client.query(`delete from ${c.table} where id = $1 and tenant_id = $2`, [id, tenantId]);
      out.deleted++;
    }
  }
  return out;
}

module.exports = { COLLECTIONS, hydrate, persist, decode_, encode_, snake };
