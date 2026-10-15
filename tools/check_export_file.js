/**
 * tools/check_export_file.js — did the REAL export leak anything?
 *   node tools/check_export_file.js "<path to AtomNursery_*.xlsx>"
 *   node tools/check_export_file.js "<file>" --where "<regex>"   # which COLUMN matched (no values)
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 WHY THIS EXISTS SEPARATELY FROM tools/test_export_school.js
 *
 * That suite proves the redaction works on a school it BUILT: it plants bait values and searches the
 * whole output for them. It cannot prove anything about the school's real SCHOOL_CONFIG row, because
 * it has never seen it. The first real export is the first time the redaction meets values nobody
 * wrote into a fixture — and a credential that leaks is invisible in a file that otherwise looks
 * perfect.
 *
 * 🔴 IT PRINTS NO PERSONAL DATA. This file holds every child, every parent's phone number and every
 * salary in the school. The output is COUNTS and VERDICTS only, never a cell value: a check on a
 * PDPA file must not be the thing that copies it into a terminal scrollback.
 *
 * 🔴 AND IT CHECKS CELLS, NOT THE RAW XML — the first version did the latter and reported a LINE
 * channel access token in PARENTS on the very first real run. It was `LinePictureUrl`: LINE's public
 * avatar CDN address, 220 characters, whose path contains a long alphanumeric run. A false alarm on
 * a leak check is not a harmless false alarm — the next real one gets waved through. Every shape
 * below is therefore anchored to a WHOLE cell value, because a credential is the entire contents of
 * its cell and never a fragment of a URL.
 */
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const file = process.argv[2];
const whereAt = process.argv.indexOf('--where');
const wherePat = whereAt > 0 ? process.argv[whereAt + 1] : null;
if (!file) { console.error('usage: node tools/check_export_file.js "<file.xlsx>" [--where "<regex>"]'); process.exit(2); }
if (!fs.existsSync(file)) { console.error('not found: ' + file); process.exit(2); }

/* xlsx_min writes STORE-only, but a file that has been through anything else may be deflated —
 * handle both rather than silently reading zero sheets. A reader that reports "nothing suspicious"
 * because it parsed nothing is the worst possible outcome for this particular tool. */
const b = fs.readFileSync(file), E = {};
for (let i = 0; i < b.length - 3; i++) {
  if (b.readUInt32LE(i) !== 0x04034b50) continue;
  const method = b.readUInt16LE(i + 8), csize = b.readUInt32LE(i + 18), usize = b.readUInt32LE(i + 22);
  const nlen = b.readUInt16LE(i + 26), elen = b.readUInt16LE(i + 28);
  const name = b.slice(i + 30, i + 30 + nlen).toString('utf8'), start = i + 30 + nlen + elen;
  if (!csize && !usize) continue;
  let d = b.slice(start, start + (method === 8 ? csize : usize));
  if (method === 8) { try { d = zlib.inflateRawSync(d); } catch (e) { continue; } }
  E[name] = d.toString('utf8');
}
const wb = E['xl/workbook.xml'] || '';
const unesc = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const names = (wb.match(/<sheet [^>]*name="([^"]*)"/g) || []).map(s => unesc((s.match(/name="([^"]*)"/) || [])[1]));
const files = Object.keys(E).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
  .sort((a, b2) => Number(a.match(/\d+/)[0]) - Number(b2.match(/\d+/)[0]));

/** one worksheet -> { header:[...], rows:[[cell,...]] }, inline strings (what the exporter writes) */
function readSheet(xml) {
  const rows = xml.split(/<row\b/).slice(1).map(r =>
    (r.match(/<c\b[\s\S]*?(?:\/>|<\/c>)/g) || []).map(c => {
      const t = (c.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
      const v = t != null ? t : (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      return unesc(v == null ? '' : v);
    }));
  return { header: rows[0] || [], rows: rows.slice(1) };
}
const sheets = files.map((f, i) => Object.assign({ tab: names[i] || f }, readSheet(E[f])));

console.log('\nไฟล์: ' + path.basename(file) + '  (' + (b.length / 1024 / 1024).toFixed(2) + ' MB)');
console.log('แท็บในสมุดงาน: ' + names.length + ' · worksheet ที่อ่านได้: ' + files.length);
if (files.length !== names.length) {
  console.log('⚠️  อ่าน worksheet ได้ไม่ครบ — ผลข้างล่างอ่านได้ไม่ครบไฟล์ ห้ามอ่านว่า "ปลอดภัย"');
}

/* ── --where: which COLUMN does a pattern land in? (never the value) ──────────────────────────── */
if (wherePat) {
  const re = new RegExp(wherePat);
  console.log('\n── ค้นหา /' + wherePat + '/ — แสดงเฉพาะชื่อคอลัมน์และความยาว ไม่แสดงค่า ──');
  let any = false;
  sheets.forEach(s => {
    const byCol = {};
    s.rows.forEach(cells => cells.forEach((v, i) => {
      if (!re.test(v)) return;
      const k = s.header[i] || ('col#' + i);
      const e = byCol[k] || (byCol[k] = { n: 0, min: 1e9, max: 0 });
      e.n++; e.min = Math.min(e.min, v.length); e.max = Math.max(e.max, v.length);
    }));
    Object.keys(byCol).forEach(k => { any = true;
      console.log('  ' + s.tab + '.' + k + ' · ' + byCol[k].n + ' แถว · ยาว ' + byCol[k].min + '–' + byCol[k].max + ' ตัวอักษร'); });
  });
  if (!any) console.log('  ไม่พบในช่องใดเลย');
  console.log('');
  process.exit(0);
}

/* ── 🔴 THE CHECK THAT MATTERS ───────────────────────────────────────────────────────────────────
 * Shapes, not the school's real values — the actual key must never be typed into a file in this
 * repo. Anchored with ^...$ so a credential is matched as a WHOLE cell: a token IS its cell, and
 * anything that merely contains a long alphanumeric run is a URL, not a secret (see the header).
 * A hit is reported as tab + column, never as the value. */
const SHAPES = [
  ['SlipOK API key',              /^SLIPOK[A-Z0-9]{6,}$/i],
  ['LINE channel access token',   /^[A-Za-z0-9+/]{120,}=*$/],
  ['bcrypt / argon password hash',/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{20,}$|^\$argon2/],
  ['Google OAuth client secret',  /^GOCSPX-[A-Za-z0-9_-]{10,}$/],
  ['key-shaped hex (32+)',        /^[a-f0-9]{32,}$/i],
  ['PEM private key',             /-----BEGIN [A-Z ]*PRIVATE KEY-----/]
];
const hits = [];
sheets.forEach(s => s.rows.forEach(cells => cells.forEach((v, i) => {
  SHAPES.forEach(([label, re]) => {
    if (!re.test(v)) return;
    const k = s.tab + '.' + (s.header[i] || ('col#' + i));
    if (!hits.some(h => h.at === k && h.label === label)) hits.push({ at: k, label: label });
  });
})));

const cfg = sheets.filter(s => s.tab === 'SCHOOL_CONFIG')[0];
const redacted = cfg ? cfg.rows.filter(r => r.indexOf('(ไม่ส่งออก)') >= 0).length : 0;
const hasPwCol = sheets.some(s => s.header.indexOf('PasswordHash') >= 0);

console.log('\n── 🔴 ความลับ ──────────────────────────────────────────────');
console.log((hasPwCol ? '  ❌' : '  ✅') + ' คอลัมน์ PasswordHash ' + (hasPwCol ? 'ยังอยู่ในไฟล์' : 'ไม่อยู่ในไฟล์เลย'));
console.log((redacted > 0 ? '  ✅' : '  ⚠️ ') + ' SCHOOL_CONFIG ปิดค่าไว้ ' + redacted + ' แถว ' +
  (redacted > 0 ? '— การปิดค่าทำงานจริงบนข้อมูลจริง' : '— ไม่พบเลย: โรงเรียนยังไม่ได้ตั้งคีย์ใดๆ หรือการปิดค่าไม่ทำงาน'));
if (hits.length) {
  console.log('  ❌ ช่องที่มีรูปร่างเหมือนคีย์/รหัสผ่าน:');
  hits.forEach(h => console.log('       ' + h.at + '  ←  ' + h.label));
} else {
  console.log('  ✅ ไม่พบช่องใดที่มีรูปร่างเหมือนคีย์หรือรหัสผ่าน');
}

console.log('\n── จำนวนแถวต่อแท็บ (ไม่นับหัวตาราง) ───────────────────────');
let total = 0;
sheets.map(s => ({ tab: s.tab, n: s.rows.length })).forEach(t => { total += t.n; });
sheets.map(s => ({ tab: s.tab, n: s.rows.length })).filter(t => t.n).sort((a, c) => c.n - a.n)
  .forEach(t => console.log('  ' + String(t.n).padStart(6) + '  ' + t.tab));
const empty = sheets.filter(s => !s.rows.length).map(s => s.tab);
console.log('  ' + String(0).padStart(6) + '  (ว่าง ' + empty.length + ' แท็บ) ' + empty.join(' · '));
console.log('\n  รวม ' + total.toLocaleString() + ' แถว · ' + sheets.length + ' แท็บ\n');
