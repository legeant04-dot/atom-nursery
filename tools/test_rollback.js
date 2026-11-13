/**
 * tools/test_rollback.js — P4 of docs/ROLLOUT_PLAN.md: Postgres → Sheets, proven before it is needed
 *   node tools/test_rollback.js
 *
 * The harness in ATOM_DB=pg mode IS a Postgres for src/DbPg.gs (tools/pg_fake_jdbc.js stores what a
 * real one would). So the story runs end to end in memory:
 *   1. the move-night spreadsheets (S0) are snapshotted — they are what Drive will copy
 *   2. the school keeps working ON POSTGRES: rows added, a cell edited, a row deleted
 *   3. rollbackToSheets copies S0 and fills the copy from Postgres
 *   4. activate, and the app — now on Sheets — must read EXACTLY what it read on Postgres
 * The copy behaves like real Sheets on the way in (numeric-looking text becomes a number unless it
 * carries the apostrophe), so the leading-zero rule is tested against the thing it guards against.
 */
'use strict';
process.env.ATOM_DB = 'pg';
const fs = require('fs'), path = require('path');
const H = require('./gas_test_harness.js');
let pass = 0, fail = 0;
const ok_ = (label, cond, extra) => { console.log((cond ? '  ok   ' : '  FAIL ') + label + (cond || extra === undefined ? '' : '  ' + JSON.stringify(extra))); cond ? pass++ : fail++; };
const eq = (label, got, want) => ok_(label, JSON.stringify(got) === JSON.stringify(want), { got, want });

const TABLES = ['MAIN:STUDENTS', 'MAIN:PARENTS', 'MAIN:BILLING', 'HR:PAYROLL'];

function world(opts) {
  opts = opts || {};
  const h = H(['Config', 'Db', 'PgSchema', 'DbPg', 'Freeze', 'Rollback']);
  const { g, store, props, run } = h;
  // the harness's properties have no deleteProperty; the real service does
  g.PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] === undefined ? null : props[k],
    setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) };
  const S = run(() => PG_SCHEMA_);

  // ── S0: the move-night workbooks, with the oddities a real sheet has ───────────────────────────
  const main = g.SpreadsheetApp.create('MAIN'), hr = g.SpreadsheetApp.create('HR');
  props.WB_MAIN_ID = main.getId(); props.WB_HR_ID = hr.getId();
  const book = k => k.startsWith('HR:') ? hr : main;
  const typ = t => String(t).split(/[ (]/)[0];
  TABLES.forEach(k => {
    const d = S[k], sh = book(k).insertSheet(k.split(':')[1]);
    const head = d.c.map(c => c[0]).concat(['LegacyNote']);           // a column Postgres never had
    sh.data[0] = head;
    for (let r = 1; r <= 3; r++) {
      sh.data[r] = d.c.map((c, i) => {
        const t = typ(c[2]);
        if (t === 'numeric') return 1000 + r * 0.25 + i;
        if (t === 'boolean') return r % 2 === 1;
        if (t === 'date') return i % 2 ? '2026-11-0' + r : new Date(2026, 10, r);   // text dates AND Date cells
        if (t === 'timestamptz') return new Date(2026, 10, r, 8, 30, 15);
        if (t === 'time') return '08:3' + r;
        return c[0] + '-' + r;
      }).concat(['legacy ' + r]);
    }
  });
  main.insertSheet('OLD_SHEET').data[0] = ['only on sheets'];
  const clone = ss => { const c = g.SpreadsheetApp.create(ss.getName() + '·S0'); delete c.sheets.Sheet1;
    Object.values(ss.sheets).forEach(sh => { c.insertSheet(sh.name).data = sh.data.map(r => (r || []).map(v => v instanceof Date ? new Date(v) : v)); });
    return c; };
  const S0 = { [main.getId()]: clone(main), [hr.getId()]: clone(hr) };

  // the copy behaves like Sheets on the way in: numeric-looking text becomes a number, "'x" stays text
  const sheetsLike = ss => Object.values(ss.sheets).forEach(sh => {
    const gr = sh.getRange.bind(sh);
    sh.getRange = (...a) => { const rg = gr(...a), sv = rg.setValues.bind(rg);
      rg.setValues = v => sv(v.map(row => row.map(x => {
        if (typeof x !== 'string') return x;
        if (x[0] === "'") return opts.sabotage ? '' : x.slice(1);   // sabotage: a Sheets that loses a value
        return /^-?\d+(\.\d+)?$/.test(x) ? Number(x) : x;
      })));
      return rg; };
    const ins = ss.insertSheet.bind(ss);
    ss.insertSheet = n => { const s = ins(n); sheetsLike({ sheets: { [n]: s }, insertSheet: ins }); return s; };
  });
  const copies = [];
  g.DriveApp.getFileById = id => ({ makeCopy: name => { const c = clone(S0[id]), cid = c.getId(); sheetsLike(c); copies.push(cid);
    return { getId: () => cid }; } });
  return Object.assign(h, { S, S0, main, hr, copies });
}

/** Every table as the app sees it, encoded per column — the thing that must not change. */
const SNAP = function () {
  var out = {};
  ['MAIN:STUDENTS', 'MAIN:PARENTS', 'MAIN:BILLING', 'HR:PAYROLL'].forEach(function (k) {
    var wb = k.split(':')[0], name = k.split(':')[1], def = PG_SCHEMA_[k];
    var sh = (wb === 'HR' ? getHrSpreadsheet_() : getMainSpreadsheet_()).getSheetByName(name);
    var vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues(), head = vals[0].map(String);
    out[k] = vals.slice(1).filter(function (r) { return r.some(function (v) { return v !== '' && v !== null; }); })
      .map(function (r) { return def.c.map(function (c) { var i = head.indexOf(c[0]); return i < 0 ? null : pgEncode_(r[i], c[2], null); }); });
  });
  return out;
};

console.log('\n1) ด่านก่อนเริ่ม');
{
  const w = world();
  w.props.DB_BACKEND = '';
  eq('ยังไม่ได้อยู่บน Postgres → ไม่มีอะไรต้องย้ายกลับ', w.run(() => rbRun_({}).code), 'NOT_ON_POSTGRES');
}
{
  const w = world();
  eq('🔴 ยังไม่ปิดรับการเขียน → ไม่เริ่ม', w.run(() => rbRun_({}).code), 'NOT_FROZEN');
  eq('และไม่ได้สร้างสำเนาใด ๆ', w.copies.length, 0);
  eq('สลับไม่ได้ถ้ายังไม่ได้คัดลอก', w.run(() => rbActivate_().code), 'NOT_FINISHED');
  w.props.WRITE_FREEZE = 'on';
  eq('🔴 ปิดแค่ฝั่ง Apps Script (Cloud Run ยังเขียนได้) → ไม่เริ่ม', w.run(() => rbRun_({}).code), 'NOT_FROZEN');
  w.run(() => freezeWrites());
  eq('freezeWrites() ปิดทั้งสองฝั่ง', [w.props.WRITE_FREEZE, w.run(() => { _configCache = null; return getConfig_('WriteFreeze', ''); })], ['on', 'on']);
}

console.log('\n2) โรงเรียนทำงานบน Postgres ต่อ แล้วย้อนกลับ');
const w = world();
const { run, props, g } = w;
run(function () {
  var m = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
  var st = m.getSheetByName('STUDENTS'), par = m.getSheetByName('PARENTS'), bill = m.getSheetByName('BILLING');
  var hd = function (sh) { return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]; };
  var row = function (sh, o) { return hd(sh).map(function (h) { return o[h] === undefined ? '' : o[h]; }); };
  st.appendRow(row(st, { StudentID: 'STU-NEW', Name: 'เด็กใหม่', DOB: new Date(2023, 4, 9), Weight: 12.35, GeoExempt: true, StartTime: '07:45' }));
  par.appendRow(row(par, { ParentID: 'PAR-NEW', Name: 'ผู้ปกครองใหม่', Phone: '0812345678', OfficePhone: '+66812345678' }));
  var b = hd(bill), amt = b.indexOf('Amount') + 1, paid = b.indexOf('PaidDate') + 1;
  bill.getRange(3, amt).setValue(6899.999999999999);              // the float that becomes 6900.00
  bill.getRange(3, paid).setValue(new Date(2026, 10, 20));
  bill.deleteRow(2);                                                // a bill removed after the move
  hr.getSheetByName('PAYROLL').appendRow(row(hr.getSheetByName('PAYROLL'), { PayrollID: 'PAY-NEW', StaffID: 'STF-1', BaseSalary: 15000, GeneratedDate: new Date(2026, 11, 1, 9, 5, 0) }));
});
const before = run(SNAP);
eq('ก่อนย้อน: นักเรียน 4 · ผู้ปกครอง 4 · บิล 2 · เงินเดือน 4', ['MAIN:STUDENTS', 'MAIN:PARENTS', 'MAIN:BILLING', 'HR:PAYROLL'].map(k => before[k].length), [4, 4, 2, 4]);

run(() => freezeWrites());
const part = run(() => rbRun_({ budgetMs: -1 }));
ok_('งบเวลาหมด → หยุดกลางทาง บอกให้รันต่อ', part.finished === false && /อีกครั้ง/.test(part.note), part);
eq('สร้างสำเนา 2 ไฟล์ครั้งเดียว (MAIN · HR)', w.copies.length, 2);
const rep = run(() => rbRun_({}));
eq('รันต่อจนครบทุกตาราง', [rep.finished, rep.sheets], [true, Object.keys(w.S).length + '/' + Object.keys(w.S).length]);
eq('🔴 อ่านกลับทุกช่องแล้วตรงทั้งหมด', [rep.ok, rep.mismatches, rep.canActivate], [true, 0, true]);
eq('สำเนาไม่ซ้ำเมื่อรันซ้ำ', w.copies.length, 2);
ok_('รายงานคอลัมน์ที่ไม่เคยอยู่ใน Postgres', rep.columnsNotInPostgres.some(s => /MAIN:STUDENTS: .*LegacyNote/.test(s)), rep.columnsNotInPostgres);

const copyMain = w.store[rep.copies.MAIN];
ok_('ชีตที่ไม่มีตาราง (OLD_SHEET) อยู่ในสำเนาเหมือนคืนย้าย', copyMain.getSheetByName('OLD_SHEET') && copyMain.getSheetByName('OLD_SHEET').data[0][0] === 'only on sheets');
const par = copyMain.getSheetByName('PARENTS'), ph = par.data[0].indexOf('Phone'), li = par.data[0].indexOf('OfficePhone');
eq('🔴 เบอร์ที่ขึ้นต้นด้วย 0 ยังเป็นข้อความ (ไม่กลายเป็นตัวเลข)', par.data.find(r => r[0] === 'PAR-NEW')[ph], '0812345678');
eq('+66… ยังเป็นข้อความ', par.data.find(r => r[0] === 'PAR-NEW')[li], '+66812345678');
const stu = copyMain.getSheetByName('STUDENTS'), hd = stu.data[0];
const dateCols = w.S['MAIN:STUDENTS'].c.filter(c => /^date/.test(c[2])).map(c => c[0]);
const textDate = dateCols.find((c, i) => typeof w.S0[w.main.getId()].getSheetByName('STUDENTS').data[1][hd.indexOf(c)] === 'string');
ok_('คอลัมน์วันที่ที่คืนย้ายเป็นข้อความ → กลับมาเป็นข้อความรูปเดิม', textDate && typeof stu.data[1][hd.indexOf(textDate)] === 'string' && /^\d{4}-\d\d-\d\d$/.test(stu.data[1][hd.indexOf(textDate)]), { textDate, v: textDate && stu.data[1][hd.indexOf(textDate)] });
ok_('ไฟล์ต้นฉบับคืนย้ายไม่ถูกแตะ', w.S0[w.main.getId()].getSheetByName('BILLING').data.length === 4);

console.log('\n3) สลับไปใช้สำเนา — แอปต้องเห็นข้อมูลเดิมทุกช่อง');
const act = run(() => rbActivate_());
ok_('สลับสำเร็จ', act.ok, act);
eq('WB ids ชี้สำเนา · DB_BACKEND ปิด', [props.WB_MAIN_ID === rep.copies.MAIN, props.WB_HR_ID === rep.copies.HR, props.DB_BACKEND], [true, true, 'sheets']);
const after = run(SNAP);
ok_('อ่านผ่าน getMainSpreadsheet_ เป็นชีตจริง ไม่ใช่ Postgres', run(() => !getMainSpreadsheet_().__pg));
TABLES.forEach(k => eq('🔴 ' + k + ' — บนชีตตรงกับบน Postgres ทุกแถวทุกช่อง', after[k], before[k]));
ok_('💰 6899.999999999999 กลับมาเป็น 6900 (ค่าที่ Postgres เก็บ)', JSON.stringify(after['MAIN:BILLING']).includes('"6900"'));

console.log('\n4) ถอยการสลับได้');
const und = run(() => rbUndoActivate_());
eq('กลับไป Postgres และไฟล์คืนย้าย', [und.ok, props.DB_BACKEND, props.WB_MAIN_ID === w.main.getId()], [true, 'pg', true]);
eq('ข้อมูลบน Postgres ยังเหมือนเดิม', run(SNAP), before);

console.log('\n5) 🔴 ถ้าชีตทำค่าหาย → สลับไม่ได้');
{
  const w2 = world({ sabotage: true });
  w2.run(function () { var p = getMainSpreadsheet_().getSheetByName('PARENTS'); var h = p.getRange(1, 1, 1, p.getLastColumn()).getValues()[0];
    p.appendRow(h.map(function (x) { return x === 'ParentID' ? 'PAR-Z' : x === 'Phone' ? '0899999999' : ''; })); });
  w2.run(() => freezeWrites());
  const r2 = w2.run(() => rbRun_({}));
  ok_('รายงานช่องที่ไม่ตรง พร้อมตำแหน่ง', r2.mismatches === 1 && r2.mismatchedSheets[0] === 'MAIN:PARENTS (1)' && r2.detail['MAIN:PARENTS'].mismatches[0].col === 'Phone', r2.detail && r2.detail['MAIN:PARENTS']);
  eq('🔴 สลับถูกปฏิเสธ', w2.run(() => rbActivate_().code), 'MISMATCH');
  eq('แอปยังอยู่บน Postgres', w2.props.DB_BACKEND, 'pg');
}

console.log('\n6) ไม่ใช่ route');
{
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'Code.gs'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'src', 'Engine.gs'), 'utf8');
  ok_('ไม่มีชื่อ rollback* / rb*_ ใน Code.gs หรือ Engine.gs', !/rollback(ToSheets|Activate|UndoActivate|Reset)|rb(Run|Activate|UndoActivate|CopySheet)_/.test(code));
}

console.log('\n' + (fail ? '❌' : '✅') + ' test_rollback: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
