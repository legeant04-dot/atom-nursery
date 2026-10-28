/**
 * tools/test_alert_skeleton.js — แถบแจ้งเตือนที่ค้างไว้ และโครงร่างระหว่างโหลด
 *   node tools/test_alert_skeleton.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * ผอ. 2026-10-28:
 *   · "เปลี่ยน App Loading ทั้งหมดเป็น Skeleton Loader ทุก Menu/Functions"
 *   · "เพิ่ม Alert Title ... เปลี่ยนจาก Pop-up เป็น Alert Title ค้างไว้ให้กดปิดแทน"
 *
 * 🔴 ชุดนี้ตรึง "คำรับประกัน" ไม่ใช่รูปร่างของบรรทัด — เพราะของที่ถูกแทนที่ (หน้าต่างเด้งตอน
 * บันทึกไม่สำเร็จ) มีขึ้นมาด้วยเหตุผลที่จริงจัง และเหตุผลนั้นยังต้องเป็นจริงกับของใหม่
 */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  console.log((okk ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (okk ? '' : ' want=' + JSON.stringify(want)));
  okk ? pass++ : fail++;
}
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), css = R('webapp/styles.css'), html = R('webapp/index.html');
const nseg = app.slice(app.indexOf('window.notify = (type'), app.indexOf('window.skel ='));

console.log('1) 📣 แถบแจ้งเตือนต้องค้างอยู่จริง');
{
  ok_('มีที่ติดตั้งอยู่ในเปลือกหน้าเว็บ', /<div id="alertBox" role="status" aria-live="polite">/.test(html));
  /* 🔴 ข้อที่พลาดง่ายที่สุดของงานนี้ · #app คือ <main> เอง และทุกหน้าจอเขียนทับ innerHTML ทั้งก้อน
   * ถ้าแถบอยู่ข้างใน ข้อความ "บันทึกแล้ว" จะถูกลบทิ้งโดยการวาดหน้าจอใหม่ที่เกิดขึ้น
   * *เพราะ* การบันทึกนั้นเอง — แถบจะกะพริบแล้วหายไป ซึ่งแย่กว่าไม่มีเลย */
  ok_('🔴 ...อยู่นอก #app เพราะหน้าจอเขียนทับ innerHTML ของ #app ทั้งก้อน',
    html.indexOf('id="alertBox"') < html.indexOf('<main id="app">'));
  ok_('🔴 ไม่มีตัวนับเวลา — ปิดเมื่อถูกกดปิดเท่านั้น', !/setTimeout/.test(nseg));
  ok_('...และปุ่มปิดทำงานจริง', /\.ax'\)\.onclick = \(\) => el\.remove\(\)/.test(nseg));
  ok_('🔴 หนึ่งแถบต่อหนึ่งเรื่อง — ไม่ซ้อนกันจนบังกันเอง', /if \(!opts\.stack\) box\.innerHTML = '';/.test(nseg));
  /* "ค้างไว้" ที่ไม่มีใครเห็น ก็คือ toast */
  ok_('🔴 ...และเลื่อนจอขึ้นไปหาตัวเอง', /scrollIntoView/.test(nseg));
  ok_('มีทางถอยถ้าไม่มีที่ติดตั้ง (ไม่เงียบหาย)', /if \(!box\) \{ toast\(/.test(nseg));
}

console.log('\n2) 🔴 และต้องอ่านออกทั้งโหมดสว่างและโหมดมืด');
{
  /* บทเรียนเดิมในโปรเจกต์นี้: ความเด่นห้ามฝากไว้กับเฉดสีจาง ๆ ตัวเดียว — --surface-2 เท่ากับ --bg
   * เป๊ะทั้งสองโหมด และกล่องที่ตั้งใจให้เด่นก็เลยไม่เคยเด่น · สีทึบ + --on-accent สลับค่าเองทั้งคู่ */
  ok_('ใช้สีทึบของระบบ ไม่ใช่เฉดจาง',
    /\.alert\.ok\{background:var\(--ok\);\}/.test(css) && /\.alert\.bad\{background:var\(--bad\);\}/.test(css));
  ok_('🔴 ...และตัวหนังสือใช้ --on-accent ซึ่งสลับค่าเองระหว่างสองโหมด', /\.alert\{[^}]*color:var\(--on-accent\)/.test(css));
  ok_('มีครบทั้งสี่ชนิด', ['ok', 'info', 'warn', 'bad'].every(t => css.indexOf('.alert.' + t + '{') > -1));
  /* audit §2.6: emoji หน้าตาไม่เหมือนกันบน Android ทุกยี่ห้อ — พอรับได้สำหรับของประดับ
   * แต่ไม่ใช่สำหรับตัวที่บอกว่า "สำเร็จ" หรือ "ผิดพลาด" */
  ok_('🔴 ไอคอนเป็น SVG ไม่ใช่ emoji', /const AL_MARK = \{/.test(app) &&
    ['ok', 'info', 'warn', 'bad'].every(t => new RegExp(t + ":\\s*'<svg").test(app)));
  /* 44px คือขั้นต่ำของ Apple/Google — ไม่ใช่ขนาดของกากบาท แต่คือขนาดของนิ้วโป้ง */
  ok_('ปุ่มปิดกดโดนด้วยนิ้ว', /\.alert \.ax\{[^}]*min-width:44px;min-height:44px/.test(css));
}

console.log('\n3) 📣 ใช้กับงานที่จบเรื่อง และข้อผิดพลาดทุกตัว');
{
  const eseg = app.slice(app.indexOf('function err(e)'), app.indexOf('\n  function modal(html)'));
  ok_('ข้อผิดพลาดทุกตัวเป็นแถบ', /notify\('bad'/.test(eseg) && !/toast\(/.test(eseg));
  ok_('🔴 ...แต่การเขียนที่ล้มเหลวมีหัวข้อของตัวเอง เพราะหน้าจอข้างหลังยังดูปกติ',
    /writes \? \(EN\(\) \? 'Not saved' : 'บันทึกไม่สำเร็จ'\) : head/.test(eseg));
  const n = (app.match(/notify\("ok"/g) || []).length;
  ok_('งานที่จบเรื่องถูกเปลี่ยนเป็นแถบแล้วหลายสิบจุด (ได้ ' + n + ')', n >= 35);
  /* 🔴 ครึ่งที่เสียง่ายที่สุด: ด่านที่ขวางคนทำงานจะถูกเลี่ยงเสมอ
   * ครูเช็คอินเด็ก 20 คนไม่ควรต้องกดปิด 20 ครั้ง — งานที่ทำรัว ๆ ต้องยังเป็นข้อความเด้ง */
  ok_('🔴 เช็คอิน/เช็คเอาท์ ยังเป็นข้อความเด้ง ไม่ใช่แถบที่ต้องกดปิด',
    /toast\(`✅ \$\{type==='IN'\?/.test(app) && /toast\(kind==='in'\?/.test(app));
  ok_('...คัดลอกก็เช่นกัน', /toast\(EN\(\)\?'Copied':'คัดลอกแล้ว'\)/.test(app));
  ok_('🔴 ...และไม่มีเครื่องหมายถูกซ้อนกันสองอัน (องค์ประกอบวาดให้เองแล้ว)',
    !/notify\("ok",\s*['"`]?✅/.test(app));
}

console.log('\n4) 🦴 โครงร่างแทนคำว่า "กำลังโหลด…"');
{
  ok_('มีตัวสร้างโครงร่าง', /window\.skel = \(kind, n\)/.test(app));
  ok_('...ครบทุกทรงที่หน้าจอใช้จริง', ['rows', 'stats', 'lines'].every(k => app.indexOf("kind === '" + k + "'") > -1));
  /* 🔴 โครงร่างมีหน้าที่เดียวคือ "บอกว่าอะไรกำลังจะมา" — ถ้ามันวาดผังที่ไม่ตรงกับของจริง
   * มันก็โกหกเรื่องที่มันมีหน้าที่บอก · วัดบนเบราว์เซอร์: .grid2 ยุบเหลือคอลัมน์เดียวที่ ≤560px
   * ส่วน .kpigrid ยังเป็นสองช่อง ซึ่งคือสิ่งที่การ์ดตัวเลขบนหน้าหลักเป็นจริง ๆ บนมือถือ */
  ok_('🔴 ...และการ์ดตัวเลขใช้ผังเดียวกับของจริง (.kpigrid ไม่ใช่ .grid2)',
    /if \(kind === 'stats'\) return `<div class="kpigrid">/.test(app));
  const left = (app.replace(/\/\*[\s\S]*?\*\//g, '').match(/กำลังโหลด/g) || []).length;
  eq('🔴 ไม่เหลือคำว่า "กำลังโหลด…" บนหน้าจอแล้ว', left, 0);
  ok_('หน้าจอใหม่เริ่มด้วยโครงร่าง ไม่ใช่การ์ดเปล่า', /app\.innerHTML=skel\('card',3\)\+skel\('rows',4\)/.test(app));
  ok_('มีลวดลายเคลื่อนไหวบอกว่ายังทำงานอยู่', /@keyframes skWave/.test(css));
  /* คนที่ตั้งค่าเครื่องว่า "ลดการเคลื่อนไหว" มักตั้งเพราะมันทำให้เวียนหัว — โครงร่างที่กะพริบ
   * อยู่แปดวินาทีคือสิ่งที่การตั้งค่านั้นมีไว้ปิด */
  ok_('🔴 ...ที่หยุดนิ่งให้คนที่ขอลดการเคลื่อนไหว', /prefers-reduced-motion:reduce\)\{\*\{animation-duration:\.001ms/.test(css));
}

console.log('\n5) 🔴 จอคลุมตอนกดบันทึก ต้องไม่ถูกแตะ');
{
  /* มันไม่ใช่ตัวบอกสถานะ มันคือตัวกันกดซ้ำ (กันจ่ายเงินซ้ำ/เช็คอินซ้ำ)
   * การเปลี่ยนมันเป็นโครงร่างคือการถอดด่านออก ไม่ใช่การเปลี่ยนหน้าตา */
  ok_('จอคลุมยังอยู่', /#busyOverlay\{/.test(css) && /_busyEl\.id='busyOverlay'/.test(app));
  ok_('🔴 ...และยังกั้นการกดอยู่', /#busyOverlay\{[^}]*position:fixed;inset:0/.test(css));
  ok_('...และยังมีเหตุผลเขียนกำกับไว้ว่าทำไมห้ามเปลี่ยน', /ตัวกันกดซ้ำ/.test(css));
}

console.log('\n6) 📣 แถบหมดอายุเมื่อย้ายหน้าจอ ไม่ใช่เมื่อวาดหน้าเดิมใหม่');
{
  /* บันทึกเสร็จ -> หน้าจอเดิมถูกวาดใหม่ -> ข้อความ "บันทึกแล้ว" ต้องอยู่ต่อ
   * ย้ายไปอีกหน้า -> ข้อความของหน้าเก่าค้างอยู่คือการโกหกเกี่ยวกับหน้าใหม่ */
  ok_('ล้างเมื่อเป็นการย้ายหน้าจอจริงเท่านั้น', /if\(!snap && !\(opts&&opts\.silent\)\) notifyClear\(\);/.test(app));
  ok_('...และมีตัวล้างให้เรียกได้', /window\.notifyClear = \(\)/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
