// Reusable in-memory GAS mock harness for testing src/*.gs in Node.
// Usage: const { load, store, PUSH } = require('./gas_test_harness')(['Config','Db',...]);
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

module.exports = function (files, srcDir) {
  srcDir = srcDir || path.join(__dirname, '..', 'src');
  const store = {};
  const PUSH = [];
  const p2 = n => String(n).padStart(2, '0');

  class Range {
    constructor(s, r, c, nr, nc) { this.s = s; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
    getValues() {
      const o = [];
      for (let i = 0; i < this.nr; i++) {
        const row = [];
        for (let j = 0; j < this.nc; j++) {
          const rr = this.s.data[this.r - 1 + i] || [];
          row.push(rr[this.c - 1 + j] === undefined ? '' : rr[this.c - 1 + j]);
        }
        o.push(row);
      }
      return o;
    }
    /* What the cell SHOWS, as characters — the real API's getDisplayValues().
     *
     * The distinction matters to anything that exports: getValues() hands back a Date object for a
     * date cell, which serialises as an ISO timestamp and is not what the sheet displays. Modelled
     * the same way decodeCell_ describes Sheets behaving: a midnight Date is a date, anything else
     * keeps its time, and everything comes back as a string. */
    getDisplayValues() {
      const fmt = v => {
        if (v === null || v === undefined) return '';
        if (Object.prototype.toString.call(v) === '[object Date]') {
          const d = v.getFullYear() + '-' + p2(v.getMonth() + 1) + '-' + p2(v.getDate());
          return (v.getHours() || v.getMinutes() || v.getSeconds())
            ? d + ' ' + p2(v.getHours()) + ':' + p2(v.getMinutes()) + ':' + p2(v.getSeconds()) : d;
        }
        return String(v);
      };
      return this.getValues().map(row => row.map(fmt));
    }
    setValues(v) {
      for (let i = 0; i < v.length; i++) {
        if (!this.s.data[this.r - 1 + i]) this.s.data[this.r - 1 + i] = [];
        for (let j = 0; j < v[i].length; j++) this.s.data[this.r - 1 + i][this.c - 1 + j] = v[i][j];
      }
      return this;
    }
    setValue(v) { return this.setValues([[v]]); }
    clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) { if (this.s.data[this.r - 1 + i]) this.s.data[this.r - 1 + i][this.c - 1 + j] = ''; } return this; }
    setFontWeight() { return this; } setBackground() { return this; }
    setFontColor() { return this; } setVerticalAlignment() { return this; }
  }
  class Sheet {
    constructor(n) { this.name = n; this.data = []; this.cols = 40; }
    getName() { return this.name; }
    getLastRow() { let n = 0; this.data.forEach((r, i) => { if (r && r.some(c => c !== '' && c !== undefined)) n = i + 1; }); return n; }
    getLastColumn() { let n = 0; this.data.forEach(r => { if (r) r.forEach((c, j) => { if (c !== '' && c !== undefined) n = Math.max(n, j + 1); }); }); return n; }
    getMaxColumns() { return this.cols; }
    getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
    appendRow(row) { this.data.push(row.slice()); return this; }
    setFrozenRows() { return this; }
    deleteColumns(c, n) { this.cols -= n; return this; }
  }
  class Spreadsheet {
    constructor(n) { this.name = n; this.sheets = {}; this.insertSheet('Sheet1'); }
    getName() { return this.name; }
    getSheetByName(n) { return this.sheets[n] || null; }
    insertSheet(n) { this.sheets[n] = new Sheet(n); return this.sheets[n]; }
    getSheets() { return Object.values(this.sheets); }
    deleteSheet(s) { delete this.sheets[s.name]; }
    getUrl() { return 'mock://' + this.name; }
    getId() { return 'id_' + this.name; }
  }

  const g = {};
  g.console = console;
  g.SpreadsheetApp = { openById: id => store[id], create: n => { const ss = new Spreadsheet(n); store['id_' + n] = ss; return ss; } };
  const props = {};
  g.PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k], setProperty: (k, v) => { props[k] = v; } }) };
  g.Logger = { log: () => {} };
  g.Utilities = {
    getUuid: () => crypto.randomUUID(),
    DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 },
    computeDigest: (_a, s) => { const h = crypto.createHash('sha256').update(s, 'utf8').digest(); return Array.from(h).map(b => b > 127 ? b - 256 : b); },
    computeHmacSha256Signature: (msg, key) => { const h = crypto.createHmac('sha256', key).update(String(msg), 'utf8').digest(); return Array.from(h).map(b => b > 127 ? b - 256 : b); },
    base64EncodeWebSafe: data => { const buf = Array.isArray(data) ? Buffer.from(data.map(b => b < 0 ? b + 256 : b)) : Buffer.from(String(data), 'utf8'); return buf.toString('base64url'); },
    base64DecodeWebSafe: str => Array.from(Buffer.from(String(str), 'base64url')).map(b => b > 127 ? b - 256 : b),
    newBlob: bytes => ({ getDataAsString: () => Buffer.from((Array.isArray(bytes) ? bytes : []).map(b => b < 0 ? b + 256 : b)).toString('utf8') }),
    formatDate: (d, tz, fmt) => {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      if (fmt === 'yyyy-MM-dd') return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
      if (fmt === 'HH:mm') return p2(d.getHours()) + ':' + p2(d.getMinutes());
      if (fmt === 'EEEE') return days[d.getDay()];
      if (fmt === 'yyyy') return '' + d.getFullYear();
      return d.toISOString();
    }
  };
  g.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: t => ({ _t: t, setMimeType() { return this; }, getContent() { return this._t; } }) };
  g.UrlFetchApp = {
    fetch: (url, opt) => {
      if (String(url).indexOf('push') >= 0 && opt && opt.payload) {
        const b = JSON.parse(opt.payload); PUSH.push({ to: b.to, text: b.messages[0].text });
      }
      return { getResponseCode: () => 200, getContentText: () => '{}' };
    }
  };
  g.ScriptApp = {
    getProjectTriggers: () => [],
    deleteTrigger: () => {},
    newTrigger: () => ({ timeBased: () => ({ atHour: () => ({ everyDays: () => ({ create: () => {}, nearMinute: () => ({ everyDays: () => ({ create: () => {} }) }) }), nearMinute: () => ({ everyDays: () => ({ create: () => {} }) }) }) }) })
  };
  g.HtmlService = {
    createHtmlOutput: html => ({ _h: html, setTitle() { return this; }, addMetaTag() { return this; }, getContent() { return this._h; } })
  };
  g.PUSH = PUSH; // expose captured LINE pushes to tests running in-context
  vm.createContext(g);
  files.forEach(f => vm.runInContext(fs.readFileSync(path.join(srcDir, f + '.gs'), 'utf8'), g, { filename: f + '.gs' }));
  // Run a test function's body inside the GAS context so it sees all globals.
  g.__run = fn => vm.runInContext('(' + fn.toString() + ')()', g);
  return { g, store, PUSH, props, run: g.__run };
};
