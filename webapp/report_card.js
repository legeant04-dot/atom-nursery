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
  var MEALS = [['breakfast', 'เช้า'], ['snackAM', 'ว่างเช้า'], ['lunch', 'กลางวัน'], ['snackPM', 'ว่างบ่าย']];

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

    var y = 288, colW = [90, 250, 250, 250, 218];
    var head = ['วันที่', 'เช้า', 'ว่างเช้า', 'กลางวัน', 'ว่างบ่าย'];
    ctx.fillStyle = C.brandSoft; roundRect(ctx, PAD, y, W - PAD * 2, 40, 8); ctx.fill();
    var cx = PAD + 12;
    head.forEach(function (hd, i) { text(ctx, hd, cx, y + 27, { size: 19, weight: 700, color: C.brand }); cx += colW[i]; });
    y += 66;                          // clear of the header pill — the first row used to sit on top of it

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
        if (x.breakfast || x.snackAM || x.lunch || x.snackPM || x.note) filled++;
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

  window.AtomReportCard = {
    render: render,
    renderMenu: renderMenu,
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
