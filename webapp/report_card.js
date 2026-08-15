/* report_card.js — one-page child report card, built ENTIRELY on the reader's own device.
 * ---------------------------------------------------------------------------------------------
 * PDPA: this page carries a child's health and development data. Nothing here uploads, stores or
 * links anything — the picture is drawn into a <canvas> in the reader's browser and handed straight
 * to the download. There is no copy on any server and no shareable URL that could leak.
 *
 * Loaded on demand (api.js __atomLoadScript), so the ~15 KB only costs the people who actually
 * export a report.
 *
 * WHY CANVAS AND NOT SVG: an SVG rasterised through new Image() runs in a sandbox that does not
 * load the page's webfonts, so Thai text came out as boxes on some devices. Canvas fillText uses
 * the document's own fonts, which is why we wait for document.fonts before drawing.
 *
 * WHY A HAND-BUILT PDF: the alternative is shipping a PDF library (~200 KB) to every device for one
 * feature. A single-page PDF whose only content is one JPEG is a small, fully specified structure —
 * see buildPdf() — so we write the ~20 objects ourselves and stay dependency-free and offline.
 */
(function () {
  'use strict';

  // A4 portrait at 150 dpi. Big enough to print sharply, small enough that an old phone can still
  // allocate the bitmap (1240×1754×4 ≈ 8.7 MB).
  var W = 1240, H = 1754, PAD = 72;

  var C = {
    ink: '#1A2130', ink2: '#5A6478', ink3: '#95A0B4', line: '#DDE3EC',
    brand: '#1565C0', brandSoft: '#E8F1FB',
    ok: '#2E7D32', okSoft: '#E7F4E8', bad: '#C62828', badSoft: '#FBE9E9',
    warn: '#E9840B', band: '#EAF2FB', paper: '#FFFFFF'
  };
  var TH = function (n) { return '"Sarabun", "Noto Sans Thai", "Leelawadee UI", "Tahoma", sans-serif'; };
  var font = function (size, weight) { return (weight || 400) + ' ' + size + 'px ' + TH(); };

  // ---- small drawing helpers -------------------------------------------------------------
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function card(ctx, x, y, w, h, fill) {
    ctx.fillStyle = fill || C.paper; roundRect(ctx, x, y, w, h, 14); ctx.fill();
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; roundRect(ctx, x, y, w, h, 14); ctx.stroke();
  }
  function text(ctx, s, x, y, o) {
    o = o || {};
    ctx.font = font(o.size || 22, o.weight);
    ctx.fillStyle = o.color || C.ink;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.baseline || 'alphabetic';
    ctx.fillText(String(s == null ? '' : s), x, y);
  }
  /** Draw `s` clipped to `max` px, ending in an ellipsis rather than running over the next column. */
  function clipText(ctx, s, x, y, max, o) {
    o = o || {}; ctx.font = font(o.size || 22, o.weight);
    s = String(s == null ? '' : s);
    if (ctx.measureText(s).width > max) {
      while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
      s += '…';
    }
    text(ctx, s, x, y, o);
  }
  function pill(ctx, s, x, y, bg, fg) {
    ctx.font = font(18, 600);
    var w = ctx.measureText(s).width + 26;
    ctx.fillStyle = bg; roundRect(ctx, x, y - 20, w, 30, 15); ctx.fill();
    text(ctx, s, x + 13, y, { size: 18, weight: 600, color: fg });
    return w;
  }

  // ---- growth chart ----------------------------------------------------------------------
  /**
   * One measurement over time against the healthy band for that age and sex.
   * `band` is [{ageMonth,min,max}] from growth_standard.js — computed on the device, because the
   * reference tables ship with the app and not with the server engine.
   */
  function growthChart(ctx, x, y, w, h, recs, band, key, unit, title) {
    card(ctx, x, y, w, h);
    text(ctx, title, x + 20, y + 34, { size: 21, weight: 700 });

    var px = x + 62, py = y + 54, pw = w - 84, ph = h - 96;
    var vals = [];
    recs.forEach(function (r) { if (r[key] > 0) vals.push(r[key]); });
    (band || []).forEach(function (b) { if (b.min != null) vals.push(b.min); if (b.max != null) vals.push(b.max); });

    if (!vals.length) {
      text(ctx, 'ยังไม่มีการชั่ง/วัด', x + w / 2, y + h / 2 + 6, { size: 20, color: C.ink3, align: 'center' });
      return;
    }
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi - lo < 1) { hi = lo + 1; }
    var pad = (hi - lo) * 0.15; lo -= pad; hi += pad;

    var ages = recs.map(function (r) { return r.ageMonth; });
    var a0 = ages.length ? Math.min.apply(null, ages) : 0;
    var a1 = ages.length ? Math.max.apply(null, ages) : 12;
    if (a1 - a0 < 2) { a1 = a0 + 2; }
    var X = function (a) { return px + (a - a0) / (a1 - a0) * pw; };
    var Y = function (v) { return py + ph - (v - lo) / (hi - lo) * ph; };

    // healthy band
    var bs = (band || []).filter(function (b) { return b.min != null && b.max != null; });
    if (bs.length) {
      ctx.fillStyle = C.band; ctx.beginPath();
      bs.forEach(function (b, i) { var xx = X(b.ageMonth), yy = Y(b.max); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); });
      for (var i = bs.length - 1; i >= 0; i--) ctx.lineTo(X(bs[i].ageMonth), Y(bs[i].min));
      ctx.closePath(); ctx.fill();
    }
    // axes
    ctx.strokeStyle = C.line; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py + ph); ctx.lineTo(px + pw, py + ph); ctx.stroke();
    text(ctx, hi.toFixed(0), px - 10, py + 8, { size: 15, color: C.ink3, align: 'right' });
    text(ctx, lo.toFixed(0), px - 10, py + ph, { size: 15, color: C.ink3, align: 'right' });

    // the child's own line
    var pts = recs.filter(function (r) { return r[key] > 0; });
    if (pts.length) {
      ctx.strokeStyle = C.brand; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.beginPath();
      pts.forEach(function (r, i) { var xx = X(r.ageMonth), yy = Y(r[key]); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); });
      ctx.stroke();
      ctx.fillStyle = C.brand;
      pts.forEach(function (r) { ctx.beginPath(); ctx.arc(X(r.ageMonth), Y(r[key]), 6, 0, 6.2832); ctx.fill(); });
      var last = pts[pts.length - 1];
      text(ctx, last[key] + ' ' + unit, x + w - 20, y + 34, { size: 21, weight: 700, color: C.brand, align: 'right' });
    }
    text(ctx, a0 + ' เดือน', px, y + h - 16, { size: 15, color: C.ink3 });
    text(ctx, a1 + ' เดือน', px + pw, y + h - 16, { size: 15, color: C.ink3, align: 'right' });
  }

  // ---- the page --------------------------------------------------------------------------
  // ---- page furniture --------------------------------------------------------------------
  var ROW = 40;                    // one DSPM item
  var SIG_Y = H - 176;             // the signature RULE. Everything above it is space to sign in.
  var ITEM_BOTTOM = H - 128;       // items may run this far down on a page that carries no notes
  var NOTES_MIN = 300;             // notes box + the gap that makes it signable

  function header(ctx, d, logo, compact, subtitle) {
    subtitle = subtitle || 'รายงานพัฒนาการและการเจริญเติบโต';
    ctx.fillStyle = C.brandSoft; ctx.fillRect(0, 0, W, compact ? 116 : 168);
    var ly = compact ? 22 : 40, ls = compact ? 62 : 88;
    if (logo) { try { ctx.drawImage(logo, PAD, ly, ls, ls); } catch (e) {} }
    text(ctx, (d.school && d.school.name) || 'Atom Nursery', PAD + ls + 20, compact ? 60 : 78,
      { size: compact ? 24 : 30, weight: 700, color: C.brand });
    if (!compact) text(ctx, subtitle, PAD + 108, 114, { size: 21, color: C.ink2 });
    else text(ctx, subtitle, PAD + ls + 20, 88, { size: 17, color: C.ink2 });
    text(ctx, 'พิมพ์เมื่อ ' + (d.generatedAt || ''), W - PAD, compact ? 60 : 114,
      { size: 17, color: C.ink3, align: 'right' });
  }

  function footer(ctx, d, pageNo, pageCount) {
    ctx.strokeStyle = C.line; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(PAD, H - 92); ctx.lineTo(W - PAD, H - 92); ctx.stroke();
    text(ctx, 'เอกสารนี้มีข้อมูลสุขภาพของเด็ก — โปรดเก็บเป็นความลับ และแบ่งปันเฉพาะผู้ที่เกี่ยวข้อง',
      PAD, H - 56, { size: 17, color: C.ink3 });
    text(ctx, 'DSPM เป็นเครื่องมือเฝ้าระวัง ไม่ใช่การวินิจฉัยทางการแพทย์',
      PAD, H - 30, { size: 16, color: C.ink3 });
    // A multi-page report has to say so, or a reader cannot tell a second sheet is missing.
    text(ctx, pageCount > 1 ? 'หน้า ' + pageNo + ' / ' + pageCount : ((d.school && d.school.name) || 'Atom Nursery'),
      W - PAD, H - 30, { size: 16, color: C.ink3, align: 'right' });
  }

  /** The teacher's handwriting area plus the two signature rules. Only ever on the LAST page. */
  function notesAndSignatures(ctx, top) {
    // grow into whatever the item list left behind, but never so far that the signing gap disappears
    var nh = Math.max(150, Math.min(400, SIG_Y - 96 - top));
    card(ctx, PAD, top, W - PAD * 2, nh);
    text(ctx, 'บันทึกเพิ่มเติมของครู / สิ่งที่ควรส่งเสริมที่บ้าน', PAD + 20, top + 34, { size: 20, weight: 700 });
    ctx.strokeStyle = C.line; ctx.lineWidth = 1.5;
    for (var r = top + 68; r < top + nh - 16; r += 42) {
      ctx.beginPath(); ctx.moveTo(PAD + 20, r); ctx.lineTo(W - PAD - 20, r); ctx.stroke();
    }
    // The rule sits low on the page so there is real room to sign ABOVE it, which is where a
    // signature actually goes — the first version left barely a finger's width.
    ctx.strokeStyle = C.ink3; ctx.lineWidth = 1.5;
    [[PAD, 'ครูประจำชั้น'], [W / 2 + 20, 'ผู้ปกครอง']].forEach(function (sig) {
      ctx.beginPath(); ctx.moveTo(sig[0], SIG_Y); ctx.lineTo(sig[0] + 380, SIG_Y); ctx.stroke();
      text(ctx, 'ลงชื่อ ' + sig[1], sig[0], SIG_Y + 28, { size: 17, color: C.ink3 });
      text(ctx, '(............................................)', sig[0], SIG_Y + 56, { size: 15, color: C.ink3 });
    });
  }

  /** One DSPM row. Returns the y for the next row. */
  function itemRow(ctx, it, ly) {
    var mark = it.result === 'ผ่าน' ? '✓' : it.result === 'ไม่ผ่าน' ? '✗' : '–';
    var col = it.result === 'ผ่าน' ? C.ok : it.result === 'ไม่ผ่าน' ? C.bad : C.ink3;
    var bg = it.result === 'ผ่าน' ? C.okSoft : it.result === 'ไม่ผ่าน' ? C.badSoft : '#F3F5F9';
    ctx.fillStyle = bg; roundRect(ctx, PAD, ly - 26, 34, 34, 10); ctx.fill();
    text(ctx, mark, PAD + 17, ly, { size: 21, weight: 700, color: col, align: 'center' });
    text(ctx, String(it.itemNo), PAD + 50, ly, { size: 18, color: C.ink3 });
    clipText(ctx, it.description || '', PAD + 96, ly, W - PAD * 2 - 260, { size: 19 });
    text(ctx, it.skill || '', W - PAD, ly, { size: 17, color: C.ink3, align: 'right' });
    return ly + ROW;
  }

  /** Pages 2+: nothing but the child's name, the continued item list, and (last page) the notes. */
  function drawContinuation(ctx, d, logo, slice, isLast, pageNo, pageCount) {
    var st = d.student || {};
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
    header(ctx, d, logo, true);
    text(ctx, st.nick || st.name || st.studentId, PAD, 178, { size: 30, weight: 700 });
    text(ctx, (st.name || '') + '  ·  ' + (st.cls || ''), PAD, 208, { size: 18, color: C.ink3 });
    text(ctx, 'พัฒนาการตามวัย (DSPM) — ต่อ', W - PAD, 200, { size: 22, weight: 700, color: C.ink2, align: 'right' });

    var ly = 262;
    slice.forEach(function (it) { ly = itemRow(ctx, it, ly); });
    if (isLast) notesAndSignatures(ctx, ly + 20);
    footer(ctx, d, pageNo, pageCount);
  }

  function draw(ctx, d, logo, slice, isLast, pageCount) {
    var st = d.student || {}, dp = d.dspm || {}, gr = d.growth || [];

    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
    header(ctx, d, logo, false);

    // who this is about — nickname leads, real name small and light (the school's own convention)
    var y = 214;
    text(ctx, st.nick || st.name || st.studentId, PAD, y, { size: 44, weight: 700 });
    text(ctx, st.name || '', PAD, y + 34, { size: 20, color: C.ink3 });

    var yrs = Math.floor((st.ageMonth || 0) / 12), mos = (st.ageMonth || 0) % 12;
    var facts = [['ชั้นเรียน', st.cls || '-'], ['อายุ', yrs + ' ปี ' + mos + ' เดือน'],
                 ['วันเกิด', st.dob || '-'], ['เพศ', st.gender === 'M' ? 'ชาย' : st.gender === 'F' ? 'หญิง' : '-']];
    var fx = PAD;
    facts.forEach(function (f) {
      text(ctx, f[0], fx, y + 74, { size: 16, color: C.ink3 });
      text(ctx, f[1], fx, y + 102, { size: 22, weight: 600 });
      fx += 190;
    });
    if (st.allergy && String(st.allergy).trim() && String(st.allergy).trim() !== '-') {
      pill(ctx, '⚠ แพ้: ' + st.allergy, PAD, y + 146, C.badSoft, C.bad);
    }

    // growth
    y = 400;
    text(ctx, 'การเจริญเติบโต', PAD, y, { size: 26, weight: 700 });
    text(ctx, 'พื้นที่ฟ้าคือช่วงปกติตามอายุและเพศ', PAD + 190, y, { size: 17, color: C.ink3 });
    var gw = (W - PAD * 2 - 24) / 2;
    var STD = (typeof window !== 'undefined' && window.GROWTH_STD) || null;
    var bandOf = function (k) {
      return gr.map(function (r) {
        var at = STD ? STD.at(st.gender, r.ageMonth, k) : null;
        return { ageMonth: r.ageMonth, min: at ? at.min : null, max: at ? at.max : null };
      });
    };
    growthChart(ctx, PAD, y + 22, gw, 300, gr, bandOf('weight'), 'weight', 'กก.', 'น้ำหนัก');
    growthChart(ctx, PAD + gw + 24, y + 22, gw, 300, gr, bandOf('height'), 'height', 'ซม.', 'ส่วนสูง');

    // DSPM
    y = 764;
    text(ctx, 'พัฒนาการตามวัย (DSPM)', PAD, y, { size: 26, weight: 700 });
    if (dp.ageLabel) text(ctx, 'ช่วงอายุ ' + dp.ageLabel, PAD + 290, y, { size: 17, color: C.ink3 });

    card(ctx, PAD, y + 22, W - PAD * 2, 104);
    var kpis = [
      ['ประเมินแล้ว', (dp.passed + dp.failed) + '/' + dp.total, C.brand],
      ['ผ่าน', String(dp.passed), C.ok],
      ['ควรส่งเสริม', String(dp.failed), dp.failed ? C.bad : C.ink3],
      ['ยังไม่ประเมิน', String(dp.pending), C.ink3]
    ];
    var kw = (W - PAD * 2) / kpis.length;
    kpis.forEach(function (k, i) {
      var cx = PAD + kw * i + kw / 2;
      text(ctx, k[1], cx, y + 84, { size: 38, weight: 700, color: k[2], align: 'center' });
      text(ctx, k[0], cx, y + 110, { size: 17, color: C.ink3, align: 'center' });
    });

    // Coverage, NOT pass-rate, is the headline: a single passed item out of forty is not "100%".
    var by = y + 146;
    text(ctx, 'ความคืบหน้าการประเมิน ' + (dp.coverage || 0) + '%', PAD, by, { size: 19, weight: 600 });
    ctx.fillStyle = C.line; roundRect(ctx, PAD, by + 12, W - PAD * 2, 16, 8); ctx.fill();
    if (dp.coverage > 0) {
      ctx.fillStyle = C.brand;
      roundRect(ctx, PAD, by + 12, Math.max(16, (W - PAD * 2) * dp.coverage / 100), 16, 8); ctx.fill();
    }

    // this page's share of the item list (the rest continues on later pages)
    var ly = by + 66;
    (slice || []).forEach(function (it) { ly = itemRow(ctx, it, ly); });

    // A short list leaves most of an A4 page blank. Rather than pad it out, give the space to the
    // two things a printed report is actually used for: a teacher writing something by hand for the
    // parents, and a signature the receiving doctor or school can rely on.
    if (isLast) notesAndSignatures(ctx, ly + 20);
    footer(ctx, d, 1, pageCount);
  }

  /**
   * How the items are split across sheets.
   *
   * The report used to be one page whatever happened, printing "และอีก N ข้อ" and dropping the rest —
   * which is the wrong answer for a document whose purpose is to be complete when it leaves the
   * school. Age bands with a lot of items now simply continue onto further sheets, each numbered
   * "หน้า x / y" so a missing sheet is obvious.
   */
  var FIRST_TOP = 976;                     // y of the first item row on page 1 (under the DSPM card)
  var CONT_TOP = 262;                      // ...and on a continuation page
  var NOTES_TOP_MAX = SIG_Y - 96 - 150;    // the lowest the notes box may start and still be usable

  function paginate(items) {
    items = items || [];
    var fit = function (top, bottom) { return Math.max(0, Math.floor((bottom - top) / ROW)); };
    var withNotes = function (top) { return fit(top, NOTES_TOP_MAX - 20); };  // page that also carries notes+signatures
    var full = function (top) { return fit(top, ITEM_BOTTOM); };              // page that is items all the way down

    if (items.length <= withNotes(FIRST_TOP)) return [items];                 // one sheet is enough

    var pages = [], rest = items.slice();
    pages.push(rest.splice(0, full(FIRST_TOP)));
    while (rest.length) {
      if (rest.length <= withNotes(CONT_TOP)) { pages.push(rest.splice(0, rest.length)); break; }
      pages.push(rest.splice(0, full(CONT_TOP)));
    }
    return pages;
  }

  // ---- rendering -------------------------------------------------------------------------
  function loadLogo() {
    return new Promise(function (res) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { res(null); };   // a missing logo must never block the report
      img.src = 'assets/logo.png';
    });
  }

  /**
   * Draw the whole report and hand back one JPEG per sheet. Everything stays in this tab.
   * `dataUrl`/`width`/`height` describe the first sheet; `pages` is every sheet in order.
   */
  function render(d) {
    // Thai renders as boxes if the webfont has not arrived yet, so wait for it — but never hang on it.
    var fonts = (typeof document !== 'undefined' && document.fonts && document.fonts.ready)
      ? Promise.race([document.fonts.ready, new Promise(function (r) { setTimeout(r, 1500); })])
      : Promise.resolve();
    return Promise.all([fonts, loadLogo()]).then(function (r) {
      var logo = r[1];
      var sheets = paginate((d.dspm || {}).items);
      var n = sheets.length, out = [];
      for (var i = 0; i < n; i++) {
        var cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        var ctx = cv.getContext('2d');
        if (i === 0) draw(ctx, d, logo, sheets[0], n === 1, n);
        else drawContinuation(ctx, d, logo, sheets[i], i === n - 1, i + 1, n);
        out.push({ dataUrl: cv.toDataURL('image/jpeg', 0.92), width: W, height: H });
      }
      return { pages: out, pageCount: n, dataUrl: out[0].dataUrl, width: W, height: H };
    });
  }

  // ---- minimal single-page PDF -----------------------------------------------------------
  function b64ToBytes(b64) {
    var bin = atob(b64), n = bin.length, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  /**
   * A PDF holding exactly one JPEG, scaled to fill an A4 page.
   *
   * The JPEG is passed through untouched (/DCTDecode) — no re-encoding, no quality loss. The only
   * fiddly part is the cross-reference table: its entries are BYTE offsets, so everything is
   * assembled as byte chunks and measured as it goes, never as a string (a Thai character is one
   * char but three bytes, and counting characters would corrupt every offset after it).
   */
  function buildPdf(pagesOrBytes, w, h) {
    // accepts either a single image (bytes, w, h) or a list of [{bytes,w,h}] — one entry per sheet
    var pages = Array.isArray(pagesOrBytes) ? pagesOrBytes : [{ bytes: pagesOrBytes, w: w, h: h }];
    var A4W = 595.28, A4H = 841.89;
    var chunks = [], len = 0, offsets = [];
    var enc = function (s) { var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xFF; return a; };
    var put = function (x) { var b = (typeof x === 'string') ? enc(x) : x; chunks.push(b); len += b.length; };
    var obj = function (n, body) { offsets[n] = len; put(n + ' 0 obj\n' + body + '\nendobj\n'); };

    var N = pages.length;
    // object numbering: 1 catalog, 2 page tree, then per sheet {page, image, content}
    var pageObj = function (i) { return 3 + i * 3; };
    var total = 2 + N * 3;

    put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');   // the binary comment marks the file as non-text
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    var kids = [];
    for (var k = 0; k < N; k++) kids.push(pageObj(k) + ' 0 R');
    obj(2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + N + ' >>');

    for (var i = 0; i < N; i++) {
      var p = pages[i], pn = pageObj(i), imn = pn + 1, cn = pn + 2;
      // fit each image inside the page, centred, keeping its proportions
      var scale = Math.min(A4W / p.w, A4H / p.h);
      var iw = p.w * scale, ih = p.h * scale, ix = (A4W - iw) / 2, iy = (A4H - ih) / 2;
      var content = 'q ' + iw.toFixed(2) + ' 0 0 ' + ih.toFixed(2) + ' ' + ix.toFixed(2) + ' ' + iy.toFixed(2) + ' cm /Im0 Do Q';

      obj(pn, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + A4W + ' ' + A4H + ']' +
              ' /Resources << /XObject << /Im0 ' + imn + ' 0 R >> >> /Contents ' + cn + ' 0 R >>');
      offsets[imn] = len;
      put(imn + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + p.w + ' /Height ' + p.h +
          ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.bytes.length + ' >>\nstream\n');
      put(p.bytes);
      put('\nendstream\nendobj\n');
      obj(cn, '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
    }

    var xref = len;
    var pad = function (n) { var s = String(n); while (s.length < 10) s = '0' + s; return s; };
    var t = 'xref\n0 ' + (total + 1) + '\n0000000000 65535 f \n';
    for (var j = 1; j <= total; j++) t += pad(offsets[j]) + ' 00000 n \n';
    t += 'trailer\n<< /Size ' + (total + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    put(t);

    var out = new Uint8Array(len), at = 0;
    chunks.forEach(function (c) { out.set(c, at); at += c.length; });
    return out;
  }

  function download(bytesOrUrl, filename, mime) {
    var url;
    if (typeof bytesOrUrl === 'string') url = bytesOrUrl;
    else url = URL.createObjectURL(new Blob([bytesOrUrl], { type: mime }));
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    if (typeof bytesOrUrl !== 'string') setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function safeName(d, ext) {
    var st = d.student || {};
    var n = (st.nick || st.name || st.studentId || 'student').replace(/[\\/:*?"<>|\s]+/g, '_');
    return 'รายงานพัฒนาการ_' + n + '_' + String(d.generatedAt || '').slice(0, 10) + '.' + ext;
  }

  /* ---- A4 food menu, same on-device rules ------------------------------------------------
   * Printed and pinned up at the school, and sent home. Weekends are greyed rather than dropped so
   * a parent can see at a glance that a blank Saturday is not a missing menu.
   */
  function daysOf(month) {
    var p = String(month).split('-'), y = Number(p[0]), m = Number(p[1]);
    var n = new Date(y, m, 0).getDate(), out = [];
    for (var d = 1; d <= n; d++) out.push(month + '-' + (d < 10 ? '0' : '') + d);
    return out;
  }
  var DOW_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  // The five meals of the day, in the order they are served. DINNER was missing from the printed
  // sheet entirely — the kitchen was planning a meal the printout did not show. Only Nursery 1 stays
  // for it, which the column header says so nobody hands the sheet to the wrong class and wonders.
  var MEALS = [['breakfast', 'เช้า'], ['snackAM', 'ว่างเช้า'], ['lunch', 'กลางวัน'],
               ['snackPM', 'ว่างบ่าย'], ['dinner', 'เย็น', '(เฉพาะ Nursery 1)']];

  function drawMenu(ctx, d, logo, slice, pageNo, pageCount, empty) {
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
    header(ctx, d, logo, false, 'เมนูอาหารประจำเดือน');
    text(ctx, 'เมนูอาหาร' + (d.className ? ' · ' + d.className : ''), PAD, 214, { size: 40, weight: 700 });
    text(ctx, 'ประจำเดือน ' + (d.month || ''), PAD, 250, { size: 22, color: C.ink2 });
    if (empty) {
      // a blank grid looks like a broken export; say plainly that nothing has been entered yet
      card(ctx, PAD, 300, W - PAD * 2, 120);
      text(ctx, 'ยังไม่มีเมนูอาหารสำหรับเดือนนี้', W / 2, 360, { size: 26, weight: 700, color: C.ink3, align: 'center' });
      text(ctx, 'กรุณาบันทึกเมนูในระบบก่อนพิมพ์', W / 2, 396, { size: 18, color: C.ink3, align: 'center' });
    }

    // date + the five meals. Lunch is the longest dish name, the snacks are usually one fruit.
    var y = 288, colW = [84, 205, 175, 235, 175, 214];
    ctx.fillStyle = C.brandSoft; roundRect(ctx, PAD, y, W - PAD * 2, 56, 8); ctx.fill();
    var cx = PAD + 12;
    text(ctx, 'วันที่', cx, y + 26, { size: 19, weight: 700, color: C.brand }); cx += colW[0];
    MEALS.forEach(function (mm, i) {
      text(ctx, mm[1], cx, y + 26, { size: 19, weight: 700, color: C.brand });
      // who the meal is for, under its own column — it is a fact about that column, not a footnote
      if (mm[2]) text(ctx, mm[2], cx, y + 46, { size: 14, color: C.ink3 });
      cx += colW[i + 1];
    });
    y += 82;                          // clear of the header pill — the first row used to sit on top of it

    slice.forEach(function (row) {
      var g = new Date(row.date + 'T00:00:00').getDay(), we = (g === 0 || g === 6);
      if (we) { ctx.fillStyle = '#F5F7FA'; roundRect(ctx, PAD, y - 24, W - PAD * 2, 40, 6); ctx.fill(); }
      var x = PAD + 12;
      text(ctx, Number(row.date.slice(8)) + ' ' + DOW_TH[g] + '.', x, y, { size: 19, weight: we ? 400 : 600, color: we ? C.ink3 : C.ink });
      x += colW[0];
      MEALS.forEach(function (mm, i) {
        clipText(ctx, row[mm[0]] || (we ? '' : '-'), x, y, colW[i + 1] - 14, { size: 18, color: we ? C.ink3 : C.ink });
        x += colW[i + 1];
      });
      y += 40;
      if (row.note) { text(ctx, '📌 ' + row.note, PAD + 102, y - 12, { size: 15, color: C.ink3 }); y += 22; }
      ctx.strokeStyle = C.line; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD, y - 30); ctx.lineTo(W - PAD, y - 30); ctx.stroke();
    });

    ctx.strokeStyle = C.line; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(PAD, H - 92); ctx.lineTo(W - PAD, H - 92); ctx.stroke();
    text(ctx, 'เมนูอาจปรับเปลี่ยนตามวัตถุดิบที่มีในแต่ละวัน · แจ้งครูประจำชั้นได้หากบุตรหลานมีอาหารที่แพ้',
      PAD, H - 56, { size: 17, color: C.ink3 });
    text(ctx, pageCount > 1 ? 'หน้า ' + pageNo + ' / ' + pageCount : ((d.school && d.school.name) || 'Atom Nursery'),
      W - PAD, H - 30, { size: 16, color: C.ink3, align: 'right' });
  }

  function renderMenu(d) {
    d = d || {};
    // A missing/garbled month used to yield daysOf(undefined) -> NaN -> a silently blank sheet.
    if (!/^\d{4}-\d{2}$/.test(String(d.month || ''))) d.month = new Date().toISOString().slice(0, 7);
    var fonts = (typeof document !== 'undefined' && document.fonts && document.fonts.ready)
      ? Promise.race([document.fonts.ready, new Promise(function (r) { setTimeout(r, 1500); })])
      : Promise.resolve();
    return Promise.all([fonts, loadLogo()]).then(function (r) {
      var by = {}, filled = 0;
      (d.days || []).forEach(function (x) {
        by[x.date] = x;
        // dinner counts: a month with only Nursery 1's dinners entered is NOT an empty month
        if (x.breakfast || x.snackAM || x.lunch || x.snackPM || x.dinner || x.note) filled++;
      });
      if (!filled) {
        var cv0 = document.createElement('canvas'); cv0.width = W; cv0.height = H;
        drawMenu(cv0.getContext('2d'), d, r[1], [], 1, 1, true);
        return { pages: [{ dataUrl: cv0.toDataURL('image/jpeg', 0.92), width: W, height: H }], pageCount: 1, empty: true };
      }
      // every day of the month, so the sheet reads as a calendar and a gap is visibly a gap
      var rows = daysOf(d.month).map(function (ds) { return Object.assign({ date: ds }, by[ds] || {}); });
      var PER = 26, sheets = [];
      for (var i = 0; i < rows.length; i += PER) sheets.push(rows.slice(i, i + PER));
      var out = [];
      for (var s = 0; s < sheets.length; s++) {
        var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        drawMenu(cv.getContext('2d'), d, r[1], sheets[s], s + 1, sheets.length, false);
        out.push({ dataUrl: cv.toDataURL('image/jpeg', 0.92), width: W, height: H });
      }
      return { pages: out, pageCount: out.length, empty: false };
    });
  }

  /* ---- generic A4 table ----------------------------------------------------------------------
   * The staff month and the class report are both "a title, some totals, and a table that runs onto
   * as many sheets as it needs". Written once here rather than twice, so the two reports cannot end
   * up looking like they came from different systems.
   *
   * spec = { title, subtitle, note, stats:[{n,label}], columns:[{key,label,width,align}], rows:[{...}],
   *          groups:[{title, rows:[...]}] }   // groups OR rows
   * A column width is a share of the printable width, not pixels, so the table always fills the page.
   */
  function renderTable(spec) {
    var pagesOut = [], pageNo = 0, ctx = null, y = 0, cvs = null;
    var cols = spec.columns || [];
    var totalW = cols.reduce(function (a, c) { return a + (c.width || 1); }, 0);
    var inner = W - PAD * 2;
    var xs = [], acc = PAD;
    cols.forEach(function (c) { xs.push(acc); acc += inner * ((c.width || 1) / totalW); });
    var colW = function (i) { return inner * ((cols[i].width || 1) / totalW); };

    function newPage() {
      cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
      ctx = cvs.getContext('2d');
      ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
      pageNo++;
      // header band, repeated so a loose sheet still says what it is and which page it is
      ctx.fillStyle = C.brandSoft; ctx.fillRect(0, 0, W, 118);
      text(ctx, spec.title || '', PAD, 58, { size: 34, weight: 700, color: C.brand });
      if (spec.subtitle) text(ctx, spec.subtitle, PAD, 96, { size: 21, color: C.ink2 });
      text(ctx, 'Atom Nursery', W - PAD, 58, { size: 20, weight: 600, color: C.brand, align: 'right' });
      y = 150;
      pagesOut.push(cvs);
      return ctx;
    }
    function headerRow() {
      ctx.fillStyle = C.band; ctx.fillRect(PAD, y - 4, inner, 40);
      cols.forEach(function (c, i) {
        clipText(ctx, c.label, c.align === 'right' ? xs[i] + colW(i) - 8 : xs[i] + 8, y + 22,
          colW(i) - 16, { size: 19, weight: 700, color: C.ink2, align: c.align || 'left' });
      });
      y += 46;
    }
    function room(px) { if (y + px > H - 70) { newPage(); headerRow(); } }

    newPage();
    // the totals strip, on the first sheet only — it describes the whole report, not each page
    if (spec.stats && spec.stats.length) {
      var sw = inner / spec.stats.length;
      spec.stats.forEach(function (s, i) {
        var x = PAD + sw * i;
        card(ctx, x + 4, y, sw - 8, 86, C.paper);
        text(ctx, s.n, x + sw / 2, y + 46, { size: 32, weight: 700, align: 'center', color: s.color || C.brand });
        text(ctx, s.label, x + sw / 2, y + 72, { size: 17, align: 'center', color: C.ink3 });
      });
      y += 106;
    }
    if (spec.note) { text(ctx, spec.note, PAD, y + 14, { size: 17, color: C.ink3 }); y += 34; }

    function drawRows(rows) {
      rows.forEach(function (r, idx) {
        room(40);
        if (idx % 2 === 1) { ctx.fillStyle = '#F7F9FC'; ctx.fillRect(PAD, y - 2, inner, 38); }
        cols.forEach(function (c, i) {
          var v = r[c.key]; if (v == null) v = '';
          clipText(ctx, v, c.align === 'right' ? xs[i] + colW(i) - 8 : xs[i] + 8, y + 24, colW(i) - 16,
            { size: 19, weight: c.bold ? 700 : 400, color: (r._warn && c.key === cols[0].key) ? C.bad : C.ink, align: c.align || 'left' });
        });
        ctx.strokeStyle = C.line; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(PAD, y + 34); ctx.lineTo(W - PAD, y + 34); ctx.stroke();
        y += 38;
      });
    }

    if (spec.groups && spec.groups.length) {
      spec.groups.forEach(function (g) {
        room(90);
        ctx.fillStyle = C.brandSoft; roundRect(ctx, PAD, y, inner, 38, 8); ctx.fill();
        text(ctx, g.title, PAD + 12, y + 26, { size: 21, weight: 700, color: C.brand });
        y += 48;
        headerRow();
        drawRows(g.rows || []);
        y += 18;
      });
    } else { headerRow(); drawRows(spec.rows || []); }

    // page numbers last, once the total is known
    pagesOut.forEach(function (c, i) {
      var g = c.getContext('2d');
      text(g, (i + 1) + ' / ' + pagesOut.length, W - PAD, H - 40, { size: 17, color: C.ink3, align: 'right' });
      text(g, spec.footer || '', PAD, H - 40, { size: 17, color: C.ink3 });
    });
    var pages = pagesOut.map(function (c) { return { dataUrl: c.toDataURL('image/jpeg', 0.92), width: W, height: H }; });
    return { pages: pages, pageCount: pages.length };
  }

  /** Save any table spec as one A4 PDF, or as one JPEG per sheet. Built here; nothing is uploaded. */
  function saveTable(spec, kind) {
    var r = renderTable(spec);
    var base = String(spec.filename || spec.title || 'report').replace(/[\\/:*?"<>|\s]+/g, '_');
    if (kind === 'pdf') {
      var sheets = r.pages.map(function (p) { return { bytes: b64ToBytes(p.dataUrl.split(',')[1]), w: p.width, h: p.height }; });
      download(buildPdf(sheets), base + '.pdf', 'application/pdf');
    } else {
      r.pages.forEach(function (p, i) {
        download(p.dataUrl, base + (r.pageCount > 1 ? '_' + (i + 1) + 'of' + r.pageCount : '') + '.jpg');
      });
    }
    return r;
  }

  /* ==========================================================================================
   * แบบบันทึกการบาดเจ็บรายบุคคล — *๑๐ (๑.๓.๗)
   *
   * A rebuild of the school's official paper form, so a filled report can be printed and handed to
   * the authority as-is. It follows the original's layout box for box: same order, same wording,
   * same tick boxes — because a form an official does not recognise is a form they send back.
   *
   * WHAT IS FILLED IN vs WHAT PRINTS BLANK. Everything the app collects is printed in place — page
   * 2's wound list and การช่วยเหลือ included, now that the app asks for them. The BODY DIAGRAM is
   * still printed as an empty outline: a wound position is a mark on a picture, and inventing one
   * from a line of text would put a claim on an official document that nobody made. Photographs are
   * deliberately not printed either — they stay in the app under the same PDPA rule as the rest.
   * ========================================================================================== */
  var INJ_TYPES_TH = [
    'พลัดตกหกล้ม',
    'ถูกแรงกระทำโดยวัตถุ เช่น ถูกชน กระแทก ของหล่นใส่ ถูกกด หนีบ บีบทับ บาด ตำ ทิ่มแทง ยกเว้นการจราจร',
    'ถูกแรงระเบิดโดยไม่ตั้งใจ เช่น เล่นปืน ดอกไม้ไฟ พลุ ประทัด วัตถุระเบิดอื่น',
    'ถูกแรงกระทำจากสัตว์ เช่น กัด ชน กระแทก ยกเว้นแมลง สัตว์มีพิษ – งู',
    'ตกน้ำ จมน้ำ',
    'สิ่งแปลกปลอมเข้าหู จมูก ตา คอ เช่น ก้างปลา ลูกปัด ติดในจมูก ยกเว้นสิ่งแปลกปลอมอุดตันทางเดินหายใจหลอดลม',
    'ถูกควันไฟและเปลวไฟ',
    'ขาดอากาศหายใจแบบอื่น รวมสิ่งแปลกปลอมอุดตันหลอดลมและการสำลักควันไฟ ยกเว้นการจมน้ำ',
    'ถูกไฟฟ้าดูด',
    'ถูกน้ำร้อนลวกหรือวัตถุร้อน',
    'ได้รับสารพิษ เช่น น้ำยาเคมี สารเคมี ยาเกินขนาด ไอระเหย รวมทั้งสัตว์มีพิษ พืชมีพิษ',
    'การจราจร เช่น ถูกรถชน',
    'ถูกกระทำจากคนโดยไม่ตั้งใจ เช่น ชนกระแทก เล่นผลักแล้วล้ม',
    'จากการออกแรงมากเกินไป เช่น ดึง ดันของหนักมากเกินไป',
    'ถูกทำร้ายร่างกาย หรือน่าจะถูกทำร้ายร่างกาย',
    'ทำร้ายตนเอง',
    'อื่นๆ'
  ];
  var INJ_CHAR_TH = ['บาดแผลถลอก', 'บาดแผลฉีกขาด', 'บาดแผลถูกแทง', 'ฟกช้ำ',
    'บาดแผลจากวัตถุระเบิดหรือกระสุนปืน', 'บิดแพลง / เคล็ดขัดยอก', 'กระดูกเคลื่อน หรือหัก',
    'แผลไหม้ น้ำร้อนลวก', 'ไฟฟ้าดูด / ช็อต', 'สารพิษ / พิษแมลง', 'ขาดอากาศหายใจ',
    'บาดเจ็บทรวงอก-อวัยวะช่องท้อง', 'บาดเจ็บสมอง', 'อื่นๆ ..............................'];
  var INJ_PLACES = [['home', 'บ้าน'], ['school', 'โรงเรียน'], ['center', 'ศูนย์พัฒนาเด็กหรือศูนย์เลี้ยงเด็ก'],
    ['road', 'ถนน'], ['park', 'สวนสาธารณะหรือลานกีฬาสาธารณะ'], ['other', 'อื่นๆ']];
  var TH_MONTH_NAMES = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  var TH_DAY_NAMES = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

  // ---- form primitives: a plain 1px grid, like the printed original ----------------------
  function frame(ctx, x, y, w, h) { ctx.strokeStyle = '#000'; ctx.lineWidth = 1.4; ctx.strokeRect(x, y, w, h); }
  function hline(ctx, x1, y, x2) { ctx.strokeStyle = '#000'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); }
  function vline(ctx, x, y1, y2) { ctx.strokeStyle = '#000'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke(); }
  /** A tick box. `on` draws the ✓ — the value the app recorded, so nobody has to re-read the file. */
  function tick(ctx, x, y, on, size) {
    size = size || 16;
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.4; ctx.strokeRect(x, y - size + 2, size, size);
    if (on) {
      ctx.lineWidth = 2.4; ctx.beginPath();
      ctx.moveTo(x + 3, y - size / 2 + 2); ctx.lineTo(x + size / 2, y - 1); ctx.lineTo(x + size - 2, y - size + 5);
      ctx.stroke(); ctx.lineWidth = 1.4;
    }
    return x + size + 6;
  }
  /** A filled-in blank: the value on a dotted rule, exactly where the paper form has one. */
  function fill(ctx, val, x, y, w, o) {
    o = o || {};
    ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y + 3); ctx.lineTo(x + w, y + 3); ctx.stroke(); ctx.restore();
    if (val != null && String(val) !== '') clipText(ctx, val, x + 4, y, w - 8, { size: o.size || 17 });
  }
  /**
   * Break `s` into lines that fit maxW — the ONE place line breaking is decided, so measuring a
   * block and drawing it can never disagree.
   *
   * Thai does not put spaces between words. Splitting on whitespace alone leaves runs like
   * 'ถูกน้ำร้อนลวกหรือวัตถุร้อน' as a single unbreakable "word" that simply ran past the frame, so a
   * run wider than the column is broken character by character instead.
   */
  function wrapLines(ctx, s, maxW, size) {
    ctx.font = font(size || 17, 400);
    var words = String(s == null ? '' : s).split(/(\s+)/), out = [], line = '';
    function pushWord(word) {
      while (ctx.measureText(word).width > maxW) {          // no space to break at — break the run
        var cut = 1;
        while (cut < word.length && ctx.measureText(word.slice(0, cut + 1)).width <= maxW) cut++;
        out.push(word.slice(0, cut)); word = word.slice(cut);
      }
      line = word;
    }
    for (var i = 0; i < words.length; i++) {
      var next = line + words[i];
      if (ctx.measureText(next).width > maxW && line) { out.push(line); pushWord(words[i].replace(/^\s+/, '')); }
      else if (ctx.measureText(next).width > maxW) pushWord(next);
      else line = next;
    }
    if (line) out.push(line);
    return out;
  }
  /** Wrap into a fixed box; returns the y after the last line drawn. */
  function wrap(ctx, s, x, y, maxW, lineH, maxLines, size) {
    var lines = wrapLines(ctx, s, maxW, size);
    ctx.font = font(size || 17, 400); ctx.fillStyle = '#000';
    for (var i = 0; i < lines.length && i < maxLines; i++) { ctx.fillText(lines[i], x, y); y += lineH; }
    return y;
  }
  /** first name / surname, so each lands in its own box on the form as the original expects. */
  function splitName(s) {
    var t = String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
    if (!t) return ['', ''];
    var i = t.indexOf(' ');
    return i < 0 ? [t, ''] : [t.slice(0, i), t.slice(i + 1)];
  }
  /**
   * The recorder's REAL name. The form field is free text and teachers type their nickname into it
   * ("ฟิล์ม"), which leaves the surname box on an official document empty. A name with no space is
   * treated as a nickname and the roster's full name (teacherName) is used instead.
   */
  function recorderFull(d) {
    var typed = String((d && d.RecorderName) || '').trim(), roster = String((d && d.teacherName) || '').trim();
    if (/\s/.test(typed)) return typed;
    if (/\s/.test(roster)) return roster;
    return typed || roster;
  }
  function injTypeList(v) {
    var a = v;
    if (typeof a === 'string' && a) { try { a = JSON.parse(a); } catch (e) { a = String(a).split(/[,\s]+/).filter(Boolean); } }
    return (Array.isArray(a) ? a : []).map(function (n) { return String(n); });
  }
  var injCodeList = injTypeList;                       // same shape, read the same way
  /** Page 2's wounds. Stored as a JSON string: [{no, pos, char}]. */
  function injWoundList(d) {
    var a = d && d.Wounds;
    if (typeof a === 'string' && a) { try { a = JSON.parse(a); } catch (e) { a = []; } }
    return Array.isArray(a) ? a : [];
  }

  function drawInjuryPage1(ctx, d) {
    var x = 60, w = W - 120, y = 92;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    text(ctx, '*๑๐ (๑.๓.๗) แบบบันทึกการบาดเจ็บรายบุคคล', x, y, { size: 21, weight: 700 }); y += 40;
    text(ctx, 'แบบบันทึกการบาดเจ็บรายบุคคล', W / 2, y, { size: 22, weight: 700, align: 'center' }); y += 26;

    var top = y, rowH = 62, L = x, R = x + w;
    // --- date / time ---
    var splitT = x + w - 300;
    frame(ctx, L, y, w, rowH); vline(ctx, splitT, y, y + rowH);
    text(ctx, 'วันที่เกิดการบาดเจ็บ', L + 10, y + 24, { size: 18, weight: 700 });
    var dt = String(d.Date || '').slice(0, 10), dd = dt ? new Date(dt + 'T00:00:00') : null;
    var cx = L + 10;
    text(ctx, 'วัน', cx, y + 50, { size: 17 }); cx += 30;
    fill(ctx, dd ? TH_DAY_NAMES[dd.getDay()] : '', cx, y + 50, 110); cx += 118;
    text(ctx, 'ที่', cx, y + 50, { size: 17 }); cx += 22;
    fill(ctx, dd ? dd.getDate() : '', cx, y + 50, 50); cx += 58;
    text(ctx, 'เดือน', cx, y + 50, { size: 17 }); cx += 48;
    fill(ctx, dd ? TH_MONTH_NAMES[dd.getMonth()] : '', cx, y + 50, 140); cx += 148;
    text(ctx, 'พ.ศ. ๒๕', cx, y + 50, { size: 17 }); cx += 66;
    fill(ctx, dd ? String(dd.getFullYear() + 543).slice(2) : '', cx, y + 50, 46);
    text(ctx, 'เวลา', splitT + 14, y + 50, { size: 17 });
    fill(ctx, String(d.Time || '').slice(0, 5), splitT + 60, y + 50, 130);
    text(ctx, 'น.', splitT + 200, y + 50, { size: 17 });
    y += rowH;

    // --- centre / affiliation ---
    var h2 = 84, cCol = L + 120, aCol = x + w - 470;
    frame(ctx, L, y, w, h2); vline(ctx, cCol, y, y + h2); vline(ctx, aCol, y, y + h2);
    text(ctx, 'ชื่อศูนย์', L + 10, y + 34, { size: 17, weight: 700 });
    clipText(ctx, d.CenterName || '', cCol + 10, y + 34, aCol - cCol - 20, { size: 17 });
    text(ctx, 'สังกัด', aCol + 10, y + 30, { size: 17, weight: 700 });
    var ax = aCol + 78, aff = String(d.AffiliationType || '');
    ax = tick(ctx, ax, y + 30, aff === 'social'); text(ctx, 'สำนักพัฒนาสังคม', ax, y + 30, { size: 16 });
    ax = tick(ctx, ax + 150, y + 30, aff === 'other'); text(ctx, 'อื่นๆ ระบุ', ax, y + 30, { size: 16 });
    fill(ctx, aff === 'other' ? d.AffiliationOther : '', ax + 74, y + 30, R - ax - 88, { size: 15 });
    var bx = tick(ctx, aCol + 78, y + 66, !!d.District);
    text(ctx, 'ชื่อเขต', bx, y + 66, { size: 16 });
    fill(ctx, d.District || '', bx + 54, y + 66, R - bx - 68, { size: 15 });
    y += h2;

    // --- recorder / child: given name and surname each in their own box, as the original has them ---
    [['ผู้บันทึก', recorderFull(d)], ['เด็กที่บาดเจ็บ', d.ChildName]].forEach(function (r) {
      var nm2 = splitName(r[1]);
      frame(ctx, L, y, w, 46);
      text(ctx, r[0], L + 10, y + 31, { size: 17, weight: 700 });
      text(ctx, 'ชื่อ', L + 150, y + 31, { size: 17 });
      fill(ctx, nm2[0], L + 186, y + 31, 320);
      text(ctx, 'นามสกุล', L + 520, y + 31, { size: 17 });
      fill(ctx, nm2[1], L + 600, y + 31, R - L - 610);
      y += 46;
    });

    // --- sex / age / education ---
    // The sex cell only ever holds two tick boxes; it used to be 340pt wide and starved the
    // "เรียนชั้น" blank at the far right, so a class name did not fit on its own line.
    var h3 = 46, s1 = L + 90, s2 = L + 270, s3 = L + 560;
    frame(ctx, L, y, w, h3); [s1, s2, s3].forEach(function (v) { vline(ctx, v, y, y + h3); });
    text(ctx, 'เพศ', L + 10, y + 31, { size: 17, weight: 700 });
    var sx = tick(ctx, s1 + 14, y + 31, String(d.Sex || '').toUpperCase() === 'M');
    text(ctx, 'ชาย', sx, y + 31, { size: 17 });
    sx = tick(ctx, sx + 60, y + 31, String(d.Sex || '').toUpperCase() === 'F');
    text(ctx, 'หญิง', sx, y + 31, { size: 17 });
    text(ctx, 'อายุ', s2 + 12, y + 31, { size: 17 });
    fill(ctx, d.AgeYears, s2 + 58, y + 31, 60); text(ctx, 'ปี', s2 + 124, y + 31, { size: 17 });
    fill(ctx, d.AgeMonths, s2 + 150, y + 31, 60); text(ctx, 'เดือน', s2 + 216, y + 31, { size: 17 });
    text(ctx, 'การศึกษา', s3 + 12, y + 31, { size: 17 });
    var ex = tick(ctx, s3 + 100, y + 31, String(d.EduStatus || '') === 'none');
    text(ctx, 'ไม่ได้เรียน', ex, y + 31, { size: 17 });
    ex = tick(ctx, ex + 106, y + 31, String(d.EduStatus || '') === 'grade');
    text(ctx, 'เรียนชั้น', ex, y + 31, { size: 17 });
    fill(ctx, d.EduGrade || '', ex + 76, y + 31, R - ex - 90);
    y += h3;

    // --- narrative | cause + witness ---
    var h4 = 210, mid = L + 640;
    frame(ctx, L, y, w, h4); vline(ctx, mid, y, y + h4);
    text(ctx, 'เหตุนำและเหตุการณ์ของการบาดเจ็บ', L + 160, y + 28, { size: 17, weight: 700 });
    ctx.strokeStyle = '#000'; hline(ctx, L + 160, y + 34, L + 470);
    text(ctx, '(ให้บันทึกเหตุการณ์ก่อนและขณะเกิดการบาดเจ็บ เช่น เดินเข้าห้องครัว ปีนโต๊ะแล้วตกลงมา)', L + 20, y + 54, { size: 13, color: '#333' });
    var ny = y + 84;
    ny = wrap(ctx, d.Narrative || '', L + 20, ny, mid - L - 40, 26, 4);
    for (var i = 0; i < 4; i++) hline(ctx, L + 20, y + 84 + i * 26 + 6, mid - 20);
    text(ctx, 'สิ่งของที่เกี่ยวข้องและเป็น', mid + (R - mid) / 2, y + 28, { size: 16, weight: 700, align: 'center' });
    text(ctx, 'สาเหตุหลักการบาดเจ็บ', mid + (R - mid) / 2, y + 52, { size: 16, weight: 700, align: 'center' });
    hline(ctx, mid + 30, y + 58, R - 30);
    text(ctx, 'เช่น โต๊ะ เก้าอี้ ชิงช้า พื้น เสามีด', mid + 16, y + 82, { size: 14, color: '#333' });
    text(ctx, 'ดินสอ', mid + 16, y + 106, { size: 15 });
    fill(ctx, d.CauseObject || '', mid + 66, y + 106, R - mid - 86, { size: 15 });
    text(ctx, 'มีผู้พบเห็นเหตุการณ์โดยตรง', mid + (R - mid) / 2, y + 142, { size: 16, weight: 700, align: 'center' });
    text(ctx, 'ขณะเกิดเหตุ', mid + (R - mid) / 2, y + 166, { size: 16, weight: 700, align: 'center' });
    hline(ctx, mid + 30, y + 172, R - 30);
    var wit = String(d.Witness || ''), wx = mid + 16;
    wx = tick(ctx, wx, y + 200, wit === 'yes'); text(ctx, 'มี', wx, y + 200, { size: 16 });
    wx = tick(ctx, wx + 36, y + 200, wit === 'no'); text(ctx, 'ไม่มี', wx, y + 200, { size: 16 });
    wx = tick(ctx, wx + 54, y + 200, wit === 'unsure'); text(ctx, 'ไม่แน่ใจ', wx, y + 200, { size: 16 });
    y += h4;

    // --- place ---
    var h5 = 96;
    frame(ctx, L, y, w, h5);
    text(ctx, 'สถานที่เกิดเหตุ', W / 2, y + 28, { size: 17, weight: 700, align: 'center' });
    hline(ctx, W / 2 - 80, y + 34, W / 2 + 80);
    var pl = String(d.Place || ''), px = L + 16, py = y + 62;
    INJ_PLACES.forEach(function (p, i) {
      if (i === 3) { px = L + 16; py = y + 88; }
      px = tick(ctx, px, py, pl === p[0]);
      text(ctx, p[1], px, py, { size: 16 });
      ctx.font = font(16, 400); px += ctx.measureText(p[1]).width + 26;
      if (p[0] === 'other') fill(ctx, pl === 'other' ? d.PlaceOther : '', px, py, R - px - 20, { size: 15 });
    });
    y += h5;

    /* --- injury types: 1-8 left, 9-17 right, exactly as printed ---
     * The list is SIZED TO ITS FRAME. It used to be drawn at a fixed 14.5pt with a hard 3-line cap:
     * the long entries (11 in particular) were both cut off and pushed past the border, which on an
     * official form reads as a different document. The type size is stepped down until the taller
     * column fits, so every entry is printed in full and nothing crosses the box. */
    var picked = injTypeList(d.InjuryTypes), h6 = H - 96 - y;
    var splitX = L + 620;
    frame(ctx, L, y, w, h6); vline(ctx, splitX, y, y + h6);
    text(ctx, 'ชนิดการบาดเจ็บ  ใส่ / ที่ช่อง [ ]', L + 12, y + 26, { size: 17, weight: 700 });
    var cxs = [L + 12, splitX + 12], colRight = [splitX - 10, R - 10];
    var top6 = y + 54, avail = h6 - (top6 - y) - 12;
    var size6 = 15, lineH6, textW = [0, 0], gap = 5;
    function colHeight(c, size, lh) {
      var from = c ? 8 : 0, to = c ? 17 : 8, tot = 0;
      for (var i = from; i < to; i++) tot += Math.max(1, wrapLines(ctx, INJ_TYPES_TH[i], textW[c], size).length) * lh + gap;
      return tot;
    }
    for (;;) {
      lineH6 = Math.round(size6 * 1.45);
      textW = [colRight[0] - (cxs[0] + 54), colRight[1] - (cxs[1] + 54)];
      if (Math.max(colHeight(0, size6, lineH6), colHeight(1, size6, lineH6)) <= avail || size6 <= 10) break;
      size6 -= 0.5;
    }
    var ty = top6, col = 0;
    for (var k = 0; k < 17; k++) {
      if (k === 8) { col = 1; ty = top6; }
      var on = picked.indexOf(String(k + 1)) >= 0;
      var bx2 = cxs[col];
      text(ctx, (k + 1) + '.', bx2, ty, { size: size6 });
      var tx = tick(ctx, bx2 + 34, ty, on, 14);
      var lines = wrapLines(ctx, INJ_TYPES_TH[k], textW[col], size6);
      ctx.font = font(size6, 400); ctx.fillStyle = '#000';
      for (var li = 0; li < lines.length; li++) ctx.fillText(lines[li], tx, ty + li * lineH6);
      ty += Math.max(1, lines.length) * lineH6 + gap;
    }
    text(ctx, '| ๙๖ |', W / 2, H - 46, { size: 15, align: 'center' });
  }

  function drawInjuryPage2(ctx, d) {
    var x = 90, w = W - 180, y = 110;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    var boxH = 470;
    frame(ctx, x, y, w, boxH);
    text(ctx, 'ตำแหน่งการบาดเจ็บ', x + 16, y + 34, { size: 18, weight: 700 });
    // four figures — front, front, back, side, as on the printed sheet
    var fx = x + 90, fy = y + 70, fh = 300;
    for (var i = 0; i < 4; i++) bodyOutline(ctx, fx + i * ((w - 180) / 3.4), fy, fh, i === 3 || i === 0);
    text(ctx, 'ระบายตำแหน่งที่มีการบาดเจ็บทั้งหมด พร้อมระบุหมายเลขบาดแผล เพื่อบันทึกในช่องต่อไป',
      x + 16, y + boxH - 22, { size: 15 });
    y += boxH;

    // wound table + characteristics legend
    var tH = 430, c1 = x + 230, c2 = x + 640;
    frame(ctx, x, y, w, tH); vline(ctx, c1, y, y + tH); vline(ctx, c2, y, y + tH);
    text(ctx, 'หมายเลขบาดแผลตามรูป', x + 16, y + 30, { size: 15 });
    text(ctx, 'รายละเอียดการบาดเจ็บของบาดแผล', c1 + 12, y + 30, { size: 15 });
    text(ctx, '(ระบุเลข ๑-๑๔ ตามตารางซ้ายมือสุด)', c1 + 12, y + 52, { size: 12, color: '#333' });
    text(ctx, 'รายละเอียดลักษณะการบาดเจ็บ', c2 + 12, y + 30, { size: 15 });
    var ry = y + 68, wounds = injWoundList(d);
    hline(ctx, x, ry, c2);
    for (var r2 = 0; r2 < 8; r2++) {
      var rowY = ry + r2 * 40, wnd = wounds[r2];
      text(ctx, 'บาดแผลหมายเลข ' + '๑๒๓๔๕๖๗๘'.charAt(r2), x + 16, rowY + 28, { size: 15 });
      if (wnd) {
        // the number from the legend on the right is what the form asks for; the position the
        // teacher recorded follows it, because the body diagram is marked by hand
        var lbl = (wnd.char ? String(wnd.char) : '') + (wnd.char && wnd.pos ? ' · ' : '') + (wnd.pos || '');
        clipText(ctx, lbl, c1 + 12, rowY + 28, c2 - c1 - 24, { size: 15 });
      }
      if (r2 < 7) hline(ctx, x, rowY + 40, c2);
    }
    var ly = y + 56;
    INJ_CHAR_TH.forEach(function (s, i) {
      text(ctx, (i + 1) + '. ' + s, c2 + 12, ly, { size: 13.5 });
      ly += 24;
    });
    y += tH;

    // help given
    var hH = H - 96 - y, c3 = x + 640;
    frame(ctx, x, y, w, hH); vline(ctx, c3, y, y + hH);
    text(ctx, 'การช่วยเหลือการบาดเจ็บ', x + 200, y + 34, { size: 17, weight: 700 });
    hline(ctx, x + 200, y + 40, x + 480);
    var tType = String((d && d.TreatmentType) || ''), tPlaces = injCodeList(d && d.TreatmentPlaces);
    var gx = tick(ctx, x + 16, y + 82, tType === 'none');
    text(ctx, 'ไม่ต้องรับการรักษาใดๆ', gx, y + 82, { size: 15 });
    gx = tick(ctx, x + 250, y + 82, tType === 'treated');
    text(ctx, 'ได้รับการรักษาพยาบาล ที่', gx, y + 82, { size: 15 });
    fill(ctx, (d && d.TreatmentBy) || '', x + 480, y + 82, c3 - x - 500, { size: 14 });
    var places = [['nurse', 'ห้องพยาบาลของโรงเรียน'], ['health', 'ศูนย์บริการสาธารณสุข\nสถานีอนามัย'], ['clinic', 'คลินิก'],
      ['hosp_gov', 'โรงพยาบาลรัฐบาล'], ['hosp_pri', 'โรงพยาบาลเอกชน'], ['dentist', 'ทันตแพทย์'], ['other', 'อื่นๆ']];
    var hy = y + 34;
    places.forEach(function (p) {
      var lines = p[1].split('\n');
      var px2 = tick(ctx, c3 + 14, hy, tPlaces.indexOf(p[0]) >= 0, 14);
      text(ctx, lines[0], px2, hy, { size: 14 });
      if (p[0] === 'other') fill(ctx, (d && d.TreatmentPlaceOther) || '', px2 + 46, hy, x + w - px2 - 60, { size: 13 });
      hy += 22;
      if (lines[1]) { text(ctx, lines[1], px2, hy, { size: 14 }); hy += 22; }
    });
    text(ctx, '| ๙๗ |', W / 2, H - 46, { size: 15, align: 'center' });
  }

  /** A plain line-art body, front (with a face line) or back. Enough to mark a wound position on. */
  function bodyOutline(ctx, cx, top, h, front) {
    var u = h / 8;                                  // one "head" tall ≈ 1/8 of the figure
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.6; ctx.beginPath();
    ctx.ellipse(cx, top + u * 0.55, u * 0.36, u * 0.55, 0, 0, Math.PI * 2); ctx.stroke();   // head
    ctx.beginPath();
    ctx.moveTo(cx - u * 0.16, top + u * 1.1); ctx.lineTo(cx - u * 0.9, top + u * 1.6);       // shoulders
    ctx.lineTo(cx - u * 1.05, top + u * 3.9);                                                // left arm
    ctx.lineTo(cx - u * 0.78, top + u * 3.95); ctx.lineTo(cx - u * 0.62, top + u * 2.2);
    ctx.lineTo(cx - u * 0.62, top + u * 4.2);                                                // waist/hip
    ctx.lineTo(cx - u * 0.58, top + u * 7.8); ctx.lineTo(cx - u * 0.16, top + u * 7.85);
    ctx.lineTo(cx, top + u * 4.6);                                                           // crotch
    ctx.lineTo(cx + u * 0.16, top + u * 7.85); ctx.lineTo(cx + u * 0.58, top + u * 7.8);
    ctx.lineTo(cx + u * 0.62, top + u * 4.2); ctx.lineTo(cx + u * 0.62, top + u * 2.2);
    ctx.lineTo(cx + u * 0.78, top + u * 3.95); ctx.lineTo(cx + u * 1.05, top + u * 3.9);
    ctx.lineTo(cx + u * 0.9, top + u * 1.6); ctx.lineTo(cx + u * 0.16, top + u * 1.1);
    ctx.closePath(); ctx.stroke();
    if (front) {                                     // a hint of a face, so front/back read apart
      ctx.lineWidth = 1.2; ctx.beginPath();
      ctx.moveTo(cx - u * 0.16, top + u * 0.5); ctx.lineTo(cx - u * 0.08, top + u * 0.5);
      ctx.moveTo(cx + u * 0.08, top + u * 0.5); ctx.lineTo(cx + u * 0.16, top + u * 0.5);
      ctx.stroke();
    }
  }

  function renderInjury(d) {
    return (document.fonts && document.fonts.ready ? Promise.race([document.fonts.ready, new Promise(function (r) { setTimeout(r, 1500); })]) : Promise.resolve())
      .then(function () {
        return [drawInjuryPage1, drawInjuryPage2].map(function (fn) {
          var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
          var ctx = cv.getContext('2d'); fn(ctx, d || {});
          return { dataUrl: cv.toDataURL('image/jpeg', 0.94), width: W, height: H };
        });
      })
      .then(function (pages) { return { pages: pages, pageCount: pages.length }; });
  }

  window.AtomReportCard = {
    render: render,
    renderInjury: renderInjury,
    /** The official injury form, filled in, as a 2-page A4 PDF. Built here; nothing is uploaded. */
    saveInjury: function (d, kind) {
      return renderInjury(d).then(function (r) {
        var who = String((d && (d.ChildName || d.nick)) || '').replace(/[\\/:*?"<>|\s]+/g, '_');
        var base = 'แบบบันทึกการบาดเจ็บ_' + (who || 'เด็ก') + '_' + String((d && d.Date) || '').slice(0, 10);
        if (kind === 'jpg') {
          r.pages.forEach(function (p, i) { download(p.dataUrl, base + '_' + (i + 1) + 'of' + r.pageCount + '.jpg'); });
        } else {
          var sheets = r.pages.map(function (p) { return { bytes: b64ToBytes(p.dataUrl.split(',')[1]), w: p.width, h: p.height }; });
          download(buildPdf(sheets), base + '.pdf', 'application/pdf');
        }
        return r;
      });
    },
    renderMenu: renderMenu,
    renderTable: renderTable,
    saveTable: saveTable,
    /** A4 food menu → PDF (one file) or image(s). Built here, never uploaded. */
    saveMenu: function (d, kind) {
      return renderMenu(d).then(function (r) {
        var base = 'เมนูอาหาร_' + String(d.className || '').replace(/[\\/:*?"<>|\s]+/g, '_') + '_' + (d.month || '');
        if (kind === 'pdf') {
          var sheets = r.pages.map(function (p) { return { bytes: b64ToBytes(p.dataUrl.split(',')[1]), w: p.width, h: p.height }; });
          download(buildPdf(sheets), base + '.pdf', 'application/pdf');
        } else {
          r.pages.forEach(function (p, i) {
            download(p.dataUrl, base + (r.pageCount > 1 ? '_' + (i + 1) + 'of' + r.pageCount : '') + '.jpg');
          });
        }
        return r;
      });
    },
    buildPdf: buildPdf,
    b64ToBytes: b64ToBytes,
    safeName: safeName,
    paginate: paginate,
    /**
     * Save as image(s). A JPEG holds one page, so a report that runs to several sheets downloads as
     * several files, named _1of3 etc. so they cannot be mixed up or silently lost.
     */
    saveJpeg: function (d) {
      return render(d).then(function (r) {
        r.pages.forEach(function (p, i) {
          var suffix = r.pageCount > 1 ? '_' + (i + 1) + 'of' + r.pageCount : '';
          download(p.dataUrl, safeName(d, 'jpg').replace(/\.jpg$/, suffix + '.jpg'));
        });
        return r;
      });
    },
    /** Save every sheet as ONE A4 PDF. Nothing leaves the device. */
    savePdf: function (d) {
      return render(d).then(function (r) {
        var sheets = r.pages.map(function (p) {
          return { bytes: b64ToBytes(p.dataUrl.split(',')[1]), w: p.width, h: p.height };
        });
        download(buildPdf(sheets), safeName(d, 'pdf'), 'application/pdf');
        return r;
      });
    }
  };
})();
