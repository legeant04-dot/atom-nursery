/* receipt.js — ใบเสร็จรับเงิน / ใบแจ้งหนี้, drawn on the family's own device as an A5 landscape PDF.
 * ===============================================================================================
 * Asked 2026-11-03 by the ผอ.: the receipt was an HTML page with a print button, sized A5 portrait
 * by @page and at the mercy of whatever the phone's print dialog did with it. It is now a FILE —
 * PDF only, A5 landscape, fixed — and an invoice comes from the same data.
 *
 * WHAT is printed is decided by the engine (billDocument in webapp/engine.js), not here, so the
 * family's copy and the office's copy of one bill cannot disagree and the rules are tested without
 * a canvas (tools/test_bill_document.js). This file only lays it out.
 *
 * NOTHING IS UPLOADED. Like the certificate and the report card, the document exists only on the
 * device that asked for it; the PDF writer is report_card.js's (one implementation, not two).
 *
 * The sheet is 210 × 148 mm drawn at 200 dpi (1654 × 1166 px). Every position below is in
 * MILLIMETRES and converted once by `mm`, so the layout reads like the paper it becomes.
 */
(function () {
  'use strict';

  var W = 1654, H = 1166, K = W / 210;               // px per mm
  var mm = function (v) { return v * K; };
  var pt = function (v) { return v * 0.3528 * K; };  // type size in points → px
  var INK = '#1f2937', MUTE = '#6b7280', LINE = '#d9dee7', BRAND = '#1565C0', OK = '#1b7f3b', DUE = '#b42318', WARN = '#b45309';
  var FONT = '"Sarabun", "Noto Sans Thai", "Leelawadee UI", Tahoma, sans-serif';
  var font = function (size, weight) { return (weight || 400) + ' ' + pt(size).toFixed(1) + 'px ' + FONT; };

  var TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  function thDate(ymd) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || '')); if (!m) return '–';
    return (+m[3]) + ' ' + TH_MONTHS[+m[2] - 1] + ' ' + (+m[1] + 543); }
  function thMonth(ym) { var m = /^(\d{4})-(\d{2})/.exec(String(ym || '')); if (!m) return String(ym || '');
    return TH_MONTHS[+m[2] - 1] + ' ' + (+m[1] + 543); }
  function money(n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  /* The bank the family paid FROM. SlipOK gives the Bank of Thailand code ('004'); some replies carry
   * the short name instead. An unknown code is printed as it came — never guessed into a name. */
  var BANKS = { '002': 'กรุงเทพ', '004': 'กสิกรไทย', '006': 'กรุงไทย', '011': 'ทหารไทยธนชาต', '014': 'ไทยพาณิชย์',
    '017': 'ซิตี้แบงก์', '022': 'ซีไอเอ็มบี ไทย', '024': 'ยูโอบี', '025': 'กรุงศรีอยุธยา', '030': 'ออมสิน',
    '033': 'อาคารสงเคราะห์', '034': 'ธ.ก.ส.', '066': 'อิสลามแห่งประเทศไทย', '067': 'ทิสโก้', '069': 'เกียรตินาคินภัทร',
    '070': 'ไอซีบีซี (ไทย)', '071': 'ไทยเครดิต', '073': 'แลนด์ แอนด์ เฮ้าส์', '098': 'SME D Bank',
    BBL: 'กรุงเทพ', KBANK: 'กสิกรไทย', KTB: 'กรุงไทย', TTB: 'ทหารไทยธนชาต', SCB: 'ไทยพาณิชย์', BAY: 'กรุงศรีอยุธยา',
    GSB: 'ออมสิน', BAAC: 'ธ.ก.ส.', GHB: 'อาคารสงเคราะห์', KKP: 'เกียรตินาคินภัทร', CIMBT: 'ซีไอเอ็มบี ไทย', UOBT: 'ยูโอบี' };
  function bankName(code) { var c = String(code || '').trim(); if (!c) return '';
    return BANKS[c] || BANKS[('000' + c).slice(-3)] || BANKS[c.toUpperCase()] || c; }

  /** One line per way the money came in — the receipt says HOW it was paid, not just that it was. */
  function methodText(pmts) {
    var seen = {}, out = [];
    (pmts || []).forEach(function (p) {
      var t = p.method === 'cash' ? 'เงินสด (Cash)'
        : p.method === 'prepay' ? 'ชำระล่วงหน้า (Prepaid) · ' + (p.ref || '')
        : p.method === 'manual' ? 'รับชำระที่โรงเรียน (Recorded by the school)'
        : 'โอนผ่านธนาคาร' + (bankName(p.bank) ? ' — ' + bankName(p.bank) : '') + ' (Bank transfer)';
      if (!seen[t]) { seen[t] = 1; out.push(t); }
    });
    return out;
  }
  function refText(pmts) {
    return (pmts || []).filter(function (p) { return p.method === 'transfer' && p.ref; })
      .map(function (p) { return p.ref; }).filter(function (r, i, a) { return a.indexOf(r) === i; }).join(', ');
  }
  /* English beside the Thai item name, for the lines every bill has. Anything else stays Thai only —
   * a guessed translation on a money document is worse than none. */
  function itemEN(label) { var s = String(label || '');
    if (/^ค่าเทอม \(ชำระล่วงหน้าแล้ว\)/.test(s)) return 'Tuition, paid in advance';
    if (/^ค่าเทอม/.test(s)) return 'Tuition';
    if (/^ส่วนลด/.test(s)) return 'Discount';
    if (/^ค่าอาหาร(\s|$)/.test(s)) return 'Meals';
    if (/^ค่ากิจกรรม(\s|$)/.test(s)) return 'Activities';
    return ''; }

  // ---- drawing helpers ---------------------------------------------------------------------------
  function txt(ctx, s, x, y, o) { o = o || {};
    ctx.font = font(o.size || 9.4, o.weight); ctx.fillStyle = o.color || INK;
    ctx.textAlign = o.align || 'left'; ctx.textBaseline = 'alphabetic';
    var str = String(s == null ? '' : s);
    if (o.max) { var max = mm(o.max); if (ctx.measureText(str).width > max) {
      while (str.length > 1 && ctx.measureText(str + '…').width > max) str = str.slice(0, -1); str += '…'; } }
    ctx.fillText(str, mm(x), mm(y)); return ctx.measureText(str).width / K; }
  function rect(ctx, x, y, w, h, fill, stroke, r) {
    ctx.beginPath(); var R = mm(r || 0);
    if (ctx.roundRect && R) ctx.roundRect(mm(x), mm(y), mm(w), mm(h), R); else ctx.rect(mm(x), mm(y), mm(w), mm(h));
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = mm(0.25); ctx.stroke(); } }
  function hline(ctx, x1, x2, y, color, w, dash) { ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = mm(w || 0.2);
    if (dash) ctx.setLineDash([mm(0.6), mm(0.6)]); ctx.beginPath(); ctx.moveTo(mm(x1), mm(y)); ctx.lineTo(mm(x2), mm(y)); ctx.stroke(); ctx.restore(); }
  function loadImg(src) { return new Promise(function (res) { if (!src) return res(null);
    var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { res(null); }; i.src = src; }); }
  /* Thai in the webfont, or the canvas silently draws it in a fallback face. The page loads Sarabun
   * with display=optional, so it may never have been fetched at all — ask for each weight we use,
   * and never hang on it. */
  function fontsReady() {
    if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return Promise.resolve();
    var want = ['400 20px Sarabun', '600 20px Sarabun', '700 20px Sarabun'].map(function (f) { return document.fonts.load(f, 'กขค').catch(function () {}); });
    return Promise.race([Promise.all(want), new Promise(function (r) { setTimeout(r, 3000); })]); }

  // ---- the sheet ---------------------------------------------------------------------------------
  function draw(ctx, d, logo, sig) {
    var S = d.school || {}, st = d.student || {}, receipt = d.kind === 'receipt';
    var L = 9, R = 201;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);

    // letterhead
    var lx = L;
    if (logo) { var lh = 17, lw = lh * logo.width / logo.height; ctx.drawImage(logo, mm(L), mm(7), mm(lw), mm(lh)); lx = L + lw + 4; }
    var y = 12;
    txt(ctx, S.DocSchoolName || '', lx, y, { size: 12.5, weight: 700, color: BRAND, max: 118 });
    y += 4.4;
    [S.DocAddress1, S.DocAddress2].filter(Boolean).forEach(function (a) { txt(ctx, a, lx, y, { size: 8.2, color: '#374151', max: 118 }); y += 3.5; });
    var contact = [S.DocPhone ? 'โทร ' + S.DocPhone : '', S.DocLineId ? 'LINE ' + S.DocLineId : ''].filter(Boolean).join('  ·  ');
    if (contact) { txt(ctx, contact, lx, y, { size: 8.2, color: '#374151', max: 118 }); y += 3.5; }
    if (S.DocTaxId) { txt(ctx, 'เลขประจำตัวผู้เสียภาษี ' + S.DocTaxId, lx, y, { size: 8.2, color: '#374151', max: 118 }); y += 3.5; }

    // document title + number + dates (right)
    txt(ctx, receipt ? 'ใบเสร็จรับเงิน' : 'ใบแจ้งหนี้', R, 13, { size: 15, weight: 700, align: 'right' });
    txt(ctx, receipt ? 'RECEIPT' : 'INVOICE', R, 17, { size: 8.6, weight: 600, color: MUTE, align: 'right' });
    var meta = [['เลขที่ No.', d.no, INK, 600], ['วันที่ออก Issue date', thDate(d.issueDate), INK, 400]];
    if (!receipt && d.dueDate) meta.push(['ครบกำหนด Due', thDate(d.dueDate), DUE, 700]);
    var my = 21.5;
    meta.forEach(function (m) { txt(ctx, m[1], R, my, { size: 8.6, weight: m[3], color: m[2], align: 'right' });
      txt(ctx, m[0], R - 33, my, { size: 8.2, color: MUTE, align: 'right' }); my += 3.7; });

    var top = Math.max(y, my) + 0.6;
    hline(ctx, L, R, top, BRAND, 0.6);

    // two boxes: the child, and the payment (receipt) or who it is addressed to (invoice)
    var by = top + 2.6, bw = (R - L - 3) / 2, bh = 22;
    rect(ctx, L, by, bw, bh, null, LINE, 1.6); rect(ctx, L + bw + 3, by, bw, bh, null, LINE, 1.6);
    function box(x, title, rows) {
      txt(ctx, title, x + 2.6, by + 4.2, { size: 7.8, weight: 700, color: BRAND });
      var ry = by + 8.4;
      rows.forEach(function (r) { txt(ctx, r[0], x + 2.6, ry, { size: 8.2, color: MUTE });
        /* Names in the document's own weight (2026-11-03): in Sarabun Bold, Thai letterforms change
         * enough that the ผอ. read the names as a different font. Same font, same weight now. */
        txt(ctx, r[1], x + 29, ry, { size: 8.6, max: bw - 31 }); ry += 3.6; }); }
    var nameLine = (st.name || '') + (st.nick ? ' (' + st.nick + ')' : '');
    box(L, 'ข้อมูลนักเรียน · STUDENT', [
      ['ชื่อ Name', nameLine, true], ['รหัส ID', st.id || '–'], ['ชั้น/ห้อง Class', st.className || '–'],
      ['งวด Period', thMonth(d.month) + (receipt ? '  ·  บิล ' + d.billingId : '')]]);
    if (receipt) {
      var meth = methodText(d.payments), ref = refText(d.payments);
      var rows = [['ผู้ชำระ Payer', d.payer || '–', true], ['วิธีชำระ Method', meth[0] || '–']];
      if (meth.length > 1) rows.push(['', '+ ' + meth.slice(1).join(' · ')]);
      if (ref) rows.push(['อ้างอิง Ref.', ref]);
      rows.push(['วันที่ชำระ Paid on', thDate(d.paidDate) + (d.paidTime ? '  ·  ' + d.paidTime + ' น.' : '')]);
      box(L + bw + 3, 'การชำระเงิน · PAYMENT', rows.slice(0, 4).concat(rows.length > 4 ? [rows[rows.length - 1]] : []));
    } else {
      box(L + bw + 3, 'เรียน · BILL TO', [['ผู้ปกครอง Parent', d.parentName || '–', true],
        ['ช่องทางชำระ', 'สแกน QR ในแอปของโรงเรียน (เมนู ชำระเงิน)'], ['', 'แล้วแนบสลิปในแอป'],
        ['Pay via', 'the school app → Payment']]);
    }

    // items — sized to fit: an unusually long bill gets smaller rows rather than a second page
    var items = (d.items || []).slice();
    if (!receipt && d.paidSoFar > 0) items.push(['ชำระแล้ว (Paid so far)', -d.paidSoFar, 'paid']);
    var ty = by + bh + 3, footTop = 116, sumH = 8;
    var rowH = Math.min(5.2, (footTop - ty - 6 - sumH - 2) / Math.max(1, items.length)), fs = Math.min(9, rowH * 1.75);
    rect(ctx, L, ty, R - L, 6, '#f1f5fb');
    txt(ctx, '#', L + 2, ty + 4.2, { size: 8.6, weight: 600, color: '#334155' });
    txt(ctx, 'รายการ Description', L + 10, ty + 4.2, { size: 8.6, weight: 600, color: '#334155' });
    txt(ctx, 'จำนวนเงิน (บาท) Amount', R - 2, ty + 4.2, { size: 8.6, weight: 600, color: '#334155', align: 'right' });
    var iy = ty + 6;
    items.forEach(function (it, i) {
      var neg = Number(it[1]) < 0, col = neg ? OK : INK;
      txt(ctx, String(i + 1), L + 2, iy + rowH * 0.72, { size: fs, color: MUTE });
      var w = txt(ctx, it[0], L + 10, iy + rowH * 0.72, { size: fs, color: col, max: 130 });
      var en = it[2] === 'paid' ? '' : itemEN(it[0]);
      if (en && w < 120) txt(ctx, en, L + 10 + w + 1.6, iy + rowH * 0.72, { size: fs * 0.9, color: '#9aa3af' });
      txt(ctx, (neg ? '−' : '') + money(Math.abs(it[1])), R - 2, iy + rowH * 0.72, { size: fs, color: col, align: 'right' });
      iy += rowH; hline(ctx, L, R, iy, '#eef1f5', 0.2); });

    // the total, with the amount in words beside it
    var sy = iy + 2, amount = receipt ? d.total : (d.outstanding || d.total);
    rect(ctx, L, sy, R - L, sumH, '#f6f8fc', null, 1.6);
    var wl = txt(ctx, 'จำนวนเงินตัวอักษร:', L + 2.6, sy + 5.3, { size: 8.8, color: '#374151' });
    txt(ctx, '(' + d.words + ')', L + 2.6 + wl + 1.5, sy + 5.3, { size: 8.8, weight: 700, max: 100 });
    txt(ctx, (receipt ? 'รวม ' : 'ยอดที่ต้องชำระ ') + money(amount) + ' บาท', R - 2.6, sy + 5.6, { size: 12.5, weight: 700, color: BRAND, align: 'right' });

    // footer: tax status + provenance (left) · stamp (middle) · signature (right, receipt only)
    var notes = [];
    if (S.DocTaxNote) notes.push(S.DocTaxNote);
    if (!receipt) notes.push('ใบแจ้งหนี้นี้ไม่ใช่ใบเสร็จรับเงิน · This invoice is not a receipt');
    var now = new Date(), stamp = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
    notes.push('ออกจากระบบของโรงเรียน · พิมพ์เมื่อ ' + thDate(stamp));
    var ny = 141 - (notes.length - 1) * 3.5;
    notes.forEach(function (n) { txt(ctx, n, L, ny, { size: 7.6, color: MUTE, max: 92 }); ny += 3.5; });

    ctx.save(); ctx.translate(mm(112), mm(128)); ctx.rotate(-12 * Math.PI / 180);
    var sc = receipt ? OK : (d.paidSoFar > 0 ? WARN : DUE);
    var s1 = receipt ? 'ชำระแล้ว' : (d.paidSoFar > 0 ? 'ชำระบางส่วน' : 'รอชำระ'), s2 = receipt ? 'PAID' : (d.paidSoFar > 0 ? 'PARTIAL' : 'UNPAID');
    ctx.globalAlpha = 0.85; ctx.strokeStyle = sc; ctx.lineWidth = mm(0.7);
    ctx.font = font(13, 700); var sw = Math.max(ctx.measureText(s1).width / K, 22) + 6;
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(-mm(sw / 2), -mm(7), mm(sw), mm(11.5), mm(2)); else ctx.rect(-mm(sw / 2), -mm(7), mm(sw), mm(11.5)); ctx.stroke();
    ctx.fillStyle = sc; ctx.textAlign = 'center'; ctx.fillText(s1, 0, mm(0.6));
    ctx.font = font(7, 700); ctx.fillText(s2, 0, mm(3.6)); ctx.restore();

    if (receipt) {
      var cx = R - 31;
      if (sig) { var sh = 12, sw2 = Math.min(56, sh * sig.width / sig.height); ctx.drawImage(sig, mm(cx - sw2 / 2), mm(120.5), mm(sw2), mm(sw2 * sig.height / sig.width)); }
      hline(ctx, cx - 31, cx + 31, 133, '#555', 0.25, true);
      txt(ctx, '(' + (S.DocSignerName || '') + ')', cx, 136.8, { size: 8.6, align: 'center' });
      txt(ctx, S.DocSignerTitle || 'ผู้รับเงิน', cx, 140.6, { size: 8.2, align: 'center' });
      txt(ctx, 'Collector / Authorised signatory', cx, 143.8, { size: 7.4, color: MUTE, align: 'center' });
    }
  }

  function render(d, opts) {
    opts = opts || {};
    return Promise.all([fontsReady(), loadImg(opts.logo), loadImg(d.kind === 'receipt' ? opts.sig : '')]).then(function (r) {
      var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      draw(cv.getContext('2d'), d, r[1], r[2]);
      return { dataUrl: cv.toDataURL('image/jpeg', 0.93), width: W, height: H };
    });
  }
  function fileName(d) { return (d.kind === 'receipt' ? 'Receipt_' : 'Invoice_') + String(d.no || 'document').replace(/[^\w.-]+/g, '_') + '.pdf'; }
  function pdfBytes(page) {
    var k = window.AtomReportCard;
    return k.buildPdf([{ bytes: k.b64ToBytes(page.dataUrl.split(',')[1]), w: page.width, h: page.height, landscape: true, a5: true }]);
  }
  /* Hand the file over. A phone inside LINE (and iOS generally) does nothing visible with a download
   * link, so where the system share sheet can take a FILE we use it — "Save to Files" is in it. Must
   * be called straight from a tap: the share sheet needs the user's gesture. */
  function save(d, page) {
    var bytes = pdfBytes(page), name = fileName(d);
    var ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    var file = null;
    try { file = new File([bytes], name, { type: 'application/pdf' }); } catch (e) {}
    if (file && /iPhone|iPad|iPod|Line\//i.test(ua) && navigator.canShare && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], title: name }).then(function () { return { shared: true, name: name }; },
        function (e) { if (e && e.name === 'AbortError') return { cancelled: true, name: name };
          window.AtomReportCard.download(bytes, name, 'application/pdf'); return { name: name }; });
    }
    window.AtomReportCard.download(bytes, name, 'application/pdf');
    return Promise.resolve({ name: name });
  }

  window.AtomReceipt = { render: render, save: save, fileName: fileName, bankName: bankName, methodText: methodText };
})();
