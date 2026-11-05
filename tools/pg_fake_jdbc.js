/**
 * tools/pg_fake_jdbc.js — Apps Script's Jdbc, answered from the harness's in-memory spreadsheets
 *
 * Used by tools/gas_test_harness.js when ATOM_DB=pg. src/DbPg.gs turns the Sheet API into SQL; this
 * turns that SQL back into the harness's sheets — so every suite that seeds a sheet and asserts on a
 * sheet keeps working, and every call in between goes through DbPg's SQL, its row numbering, and its
 * value rules. What it proves: the emulation is faithful. What it cannot prove: that the SQL is valid
 * on a real Postgres — tools/test_dbpg_live.js runs the same statements against staging for that.
 *
 * 🔴 STORED THE WAY POSTGRES WOULD STORE IT. A value read out goes through DbPg's own pgEncode_ first
 * (the migrator's rule), so a cell real Postgres would refuse (a boolean column holding "CONFIRMED",
 * a date column holding "วันที่ 15") comes back EMPTY here exactly as it would on migration day — and a
 * column the schema never declared is simply not there. Those failures are the findings.
 *
 * Only the statement shapes DbPg.gs generates are understood; anything else throws, so a new shape
 * cannot slip through untested.
 */
'use strict';
const crypto = require('crypto');

module.exports = function makeFakeJdbc(g, store, props) {
  const ids = new WeakMap();                       // row array → uuid
  const idOf = row => { if (!ids.has(row)) ids.set(row, crypto.randomUUID()); return ids.get(row); };
  const log = [];                                  // every statement, for tools/test_dbpg_live.js

  // table → { wb, sheet, cols: { pgCol: [sheetCol, type] } } — from the generated map, read live
  const tables = () => {
    const out = {};
    Object.keys(g.PG_SCHEMA_).forEach(k => { const [wb, sheet] = k.split(':'); const d = g.PG_SCHEMA_[k];
      out[d.t] = { wb, sheet, cols: Object.fromEntries(d.c.map(c => [c[1], [c[0], c[2]]])) }; });
    return out;
  };
  const sheetFor = t => {
    const def = tables()[t]; if (!def) throw new Error('fake jdbc: unknown table ' + t);
    const ss = store[props[def.wb === 'HR' ? g.PROP.HR_ID : g.PROP.MAIN_ID]];
    if (!ss) throw new Error('fake jdbc: workbook ' + def.wb + ' not set up');
    let sh = ss.getSheetByName(def.sheet);
    if (!sh) { sh = ss.insertSheet(def.sheet); sh.data[0] = Object.values(def.cols).map(c => c[0]); }
    return { def, sh };
  };
  const hdrOf = sh => (sh.data[0] || []).map(String);
  const live = sh => sh.data.slice(1, sh.getLastRow() || 1).filter(r => r && r.some(c => c !== '' && c !== undefined));
  const base = t => String(t).split(/[ (]/)[0];
  const toPgText = (v, type) => {                  // what `col::text` returns on a real Postgres
    const e = g.pgEncode_(v, type, null);
    if (e === null) return null;
    const t = base(type);
    if (t === 'boolean') return e === 'true' ? 't' : 'f';
    if (t === 'time') return e.length === 5 ? e + ':00' : e;
    if (t === 'timestamptz') return (e.length === 16 ? e + ':00' : e.length === 10 ? e + ' 00:00:00' : e) + '+07';
    return e;
  };
  const fromParam = (s, cast) => {                 // what the stored cell becomes
    if (s === null) return '';
    if (cast === 'numeric') return Number(s);
    if (cast === 'boolean') return s === 'true';
    return s;
  };
  const cellIdx = (sh, sheetCol) => {              // a declared column the sheet does not have yet is added
    const h = hdrOf(sh); let i = h.indexOf(sheetCol);
    if (i < 0) { sh.data[0] = (sh.data[0] || []).concat([sheetCol]); i = sh.data[0].length - 1; }
    return i;
  };
  const casts = sql => [...sql.matchAll(/\?(?:::(\w+))?/g)].map(m => m[1] || 'text');

  function prepareStatement(sql) {
    const params = [];
    const st = {
      setString: (i, v) => { params[i - 1] = String(v); },
      setNull: i => { params[i - 1] = null; },
      close: () => {},
      executeQuery: () => { log.push({ sql, params: params.slice() }); return run(sql, params, true); },
      executeUpdate: () => { log.push({ sql, params: params.slice() }); run(sql, params, false); return 1; },
      execute: () => true
    };
    return st;
  }
  function rs(rows) {
    let i = -1;
    return { next: () => ++i < rows.length, getString: k => { const v = rows[i][k - 1]; return v === undefined ? null : v; }, close: () => {} };
  }
  function run(sql, p, query) {
    let m;
    if (/^select 1$/.test(sql)) return rs([['1']]);
    /* the write lock shared with the Cloud Run host (pgWriteLock_) — `api.lockFails` plays somebody else holding it */
    if ((m = /^select pg_advisory_(un)?lock\(hashtextextended\(\?, 0\)\)$/.exec(sql))) {
      if (!m[1] && api.lockFails) throw new Error('canceling statement due to lock timeout');
      return rs([['']]);
    }
    if ((m = /^select "id"::text,(.*) from "(\w+)" where "tenant_id" = \?::uuid order by "seq"$/.exec(sql))) {
      const { def, sh } = sheetFor(m[2]);
      const want = [...m[1].matchAll(/"(\w+)"::text/g)].map(x => x[1]);
      const h = hdrOf(sh);
      return rs(live(sh).map(row => [idOf(row)].concat(want.map(pc => {
        const [sc, type] = def.cols[pc]; const i = h.indexOf(sc);
        return i < 0 ? null : toPgText(row[i], type);
      }))));
    }
    if ((m = /^insert into "(\w+)" \("tenant_id"(?:,(.*))?\) values \(\?::uuid(?:,(.*))?\) returning "id"::text$/.exec(sql))) {
      const { def, sh } = sheetFor(m[1]);
      const names = m[2] ? [...m[2].matchAll(/"(\w+)"/g)].map(x => x[1]) : [];
      const cs = casts(sql).slice(1);
      const row = new Array(hdrOf(sh).length).fill('');
      names.forEach((pc, j) => { const i = cellIdx(sh, def.cols[pc][0]); row[i] = fromParam(p[j + 1], cs[j]); });
      sh.data.splice(sh.getLastRow() || 1, 0, row);     // after the last real row, like appendRow
      return rs([[idOf(row)]]);
    }
    if ((m = /^update "(\w+)" set (.*) where "id" = \?::uuid and "tenant_id" = \?::uuid$/.exec(sql))) {
      const { def, sh } = sheetFor(m[1]);
      const sets = [...m[2].matchAll(/"(\w+)" = \?(?:::(\w+))?/g)].map(x => [x[1], x[2] || 'text']);
      const id = p[sets.length];
      const row = live(sh).find(r => idOf(r) === id); if (!row) throw new Error('fake jdbc: update of a row that is gone');
      sets.forEach(([pc, cast], j) => { const i = cellIdx(sh, def.cols[pc][0]); row[i] = fromParam(p[j], cast); });
      return null;
    }
    if ((m = /^delete from "(\w+)" where "id" = \?::uuid and "tenant_id" = \?::uuid$/.exec(sql))) {
      const { sh } = sheetFor(m[1]);
      const at = sh.data.findIndex((r, i) => i > 0 && r && idOf(r) === p[0]);
      if (at > 0) sh.data.splice(at, 1);
      return null;
    }
    throw new Error('fake jdbc: statement shape not understood — ' + sql.slice(0, 90));
  }
  const conn = { prepareStatement, createStatement: () => ({ execute: q => { log.push({ sql: String(q), params: [] }); return true; }, close: () => {} }), close: () => {} };
  const api = { Jdbc: { getConnection: () => conn }, log, lockFails: false };
  return api;
};
