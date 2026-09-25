/* certificate.js — ใบประกาศนียบัตร, composited ENTIRELY on the admin's own device.
 * ===============================================================================================
 * Asked 2026-09-24 by the ผอ.: print a certificate for a child who has finished, at a quality good
 * enough to hand to a family.
 *
 * NOTHING IS UPLOADED AND NOTHING IS STORED. The school's blank artwork and the director's
 * signature come down from src/Certificate.gs as `data:` URLs; the child's name is drawn on top
 * here; the PDF is written here. A document naming a child never exists on any server — the same
 * rule webapp/report_card.js follows, and the reason neither needs a retention policy.
 *
 * THE ARTWORK MUST ARRIVE AS A data: URL, NOT A DRIVE LINK. A canvas that has drawn a cross-origin
 * image is tainted and toDataURL() throws on it — so the version of this that loads the background
 * straight from drive.google.com renders perfectly on screen and cannot be exported. That is why
 * the server sends bytes. See the header of src/Certificate.gs.
 *
 * Loaded on demand (api.js __atomLoadScript), and it needs report_card.js for the PDF writer —
 * one implementation of "make a PDF out of these images", not two.
 */
(function () {
  'use strict';

  /* THE SHEET IS THE SHAPE OF THE ARTWORK, not of A4.
   *
   * The school's template is 2528 × 1696 — ratio 1.491, where A4 landscape is 1.414. The first
   * version drew it "cover" onto a fixed A4 canvas, which crops the overflow: the decorative border
   * down the left and right edges was being cut off. Sizing the canvas to the artwork instead means
   * nothing is cropped and nothing is stretched, and buildPdf fits the whole thing onto the page
   * with two thin white bands top and bottom, which is what a print shop would do with it.
   *
   * 2400 px on the long edge ≈ 200 dpi across an A4 landscape sheet. That is where the curves of
   * Thai letterforms stop showing stair-steps at the size a child's name is set here. With no
   * artwork at all it falls back to A4 landscape at the same density. */
  var LONG_EDGE = 2400, A4_RATIO = 297 / 210;

  /* THE SCHOOL'S TEMPLATE ALREADY CARRIES ITS OWN WORDING — the heading, both sentences, "ให้ไว้ ณ",
   * "ครูผู้อำนวยการ", the director's name and the two rule lines are all printed on it. So the app
   * adds exactly THREE things, which is what was asked for on 2026-09-25 after the first print came
   * out with every line doubled:
   *
   *        the child's name  ·  the date  ·  the signature
   *
   * Positions measured off that file by scanning it for its two horizontal rules and its text bands,
   * not estimated: name rule at y 0.6138 (centred, 0.55 wide), "ให้ไว้ ณ" ending at x 0.4173 on the
   * band y 0.702–0.737, signature rule at y 0.8367 centred on x 0.7555.
   *
   * The two RULES are re-detected in each artwork at render time (findRules) so a school with a
   * different template still lands on its own lines; these are the fallback when none is found. */
  /* TYPE SIZES, SET 2026-09-25 AND MEASURED RATHER THAN CHOSEN.
   *
   * The brief: the child's name 36–48 pt, general text 18–22 pt, in a LOOPED Thai face (TH Sarabun
   * New / Angsana New). Those are point sizes on paper, so they were converted against the sheet as
   * it actually prints: the artwork is 1.491 wide, so on A4 landscape it fits to the 297 mm width
   * and stands 199.2 mm tall. 1 pt = 0.3528 mm, so a fraction of sheet height f = f × 199.2 / 0.3528 pt.
   *
   * The template's own type was measured the same way — by matching the ink-band height of each line
   * against Sarabun rendered at a known size — so the additions sit in the school's own hierarchy
   * rather than next to it:
   *
   *      template heading   0.0412  →  23.3 pt        (on the artwork; we do not draw it)
   *      template body      0.0365  →  20.6 pt
   *      "ให้ไว้ ณ"          0.0360  →  20.3 pt        ← the date continues THIS line
   *
   *      name   0.0744  →  42.0 pt   (middle of 36–48; auto-shrinks for a long name)
   *      date   0.0360  →  20.3 pt   (identical to the line it continues, not merely inside 18–22)
   *
   * v401 had them at 26.5 pt and 17.2 pt — both below the brief, which is what "the name should be
   * the most prominent thing on the page" was telling us.
   */
  var P = {
    /* nameMaxW STAYS INSIDE THE RULE (0.52 against the rule's 0.5506).
     *
     * v402 let the name overhang to hold 42 pt, and the school looked at it and said no: "ชื่อ
     * นักเรียน ย่อให้อยู่ในเส้น" (2026-09-25). So the rule wins and the type gives way — a name that
     * needs more room is shrunk to fit rather than allowed past the line. For the name that prompted
     * this, "วัชชิรวิณณ์ เรืองณรงค์ (โตเกียว)", that is about 33 pt rather than 42.
     *
     * nameSize is therefore a CEILING, not a size: short names still print at the full 42 pt. */
    nameY: 0.5938, nameSize: 0.0744, nameMaxW: 0.52,  // baseline sits just above the name rule
    nameRuleY: 0.6138, nameRuleCx: 0.4998,
    dateX: 0.4280, dateY: 0.7345, dateSize: 0.0360,   // left-aligned, immediately after "ให้ไว้ ณ"
    sigRuleY: 0.8367, sigCx: 0.7555,                  // the signature sits ON the rule, not above it
    sigDrop: 0.004,                                   // the last stroke lands a hair below the line
    sigMaxW: 0.185, sigMaxH: 0.075
  };

  /* The no-artwork fallback: a plain bordered sheet that prints the wording from settings, so a
   * school that has not uploaded anything yet still gets something usable. Unchanged from v400. */
  var L = {
    headY: 0.335, head: 68, line1Y: 0.410, line1: 40,
    nameY: 0.508, name: 76, ruleY: 0.534, ruleW: 0.52,
    line2Y: 0.605, line2: 40, line3Y: 0.663,
    dateY: 0.722, date: 40,
    sigX: 0.655, sigY: 0.798, sigMaxW: 0.20, sigMaxH: 0.085,
    sigRuleY: 0.828, sigRuleW: 0.26,
    titleY: 0.878, title: 36, signerY: 0.928, signer: 36
  };

  /* #121D4A IS THE SCHOOL'S OWN INK, sampled from the heading on their artwork — the navy asked for
   * on 2026-09-25 ("สีกรมท่าหรือสีดำ"). Taking it from the file rather than picking a navy means the
   * name we add and the sentences already printed are the same colour, which is the difference
   * between a filled-in certificate and a certificate with something typed on it. */
  var INK = '#121D4A', SOFT = '#3A4356', RULE = '#98A2B3';
  /**
   * TH SARABUN NEW FIRST, as asked on 2026-09-25.
   *
   * It is the Thai government standard face and is installed on most Thai machines, but it is not
   * on Google Fonts, so it cannot be shipped — naming it first means a machine that HAS it uses it,
   * which is the school's own office and print shop. `Sarabun` behind it is the open-licence cut of
   * the same design by the same designer, served as a webfont, so a machine without it still gets
   * the same letterforms. Everything after that is looped (มีหัว) too. Never add a loopless face.
   */
  function fontStack() {
    return '"TH Sarabun New", "TH SarabunPSK", "Sarabun", "Noto Sans Thai", "Leelawadee UI", "Tahoma", sans-serif';
  }
  /* BOLD IS THE DEFAULT HERE, not 400. Asked for "ทั้งหมดในใบประกาศ วันที่ ชื่อนักเรียน" — both of
   * the things this file draws are set bold, so the weight is the default rather than something each
   * call has to remember to pass. */
  function font(px, weight) { return (weight || 700) + ' ' + Math.round(px) + 'px ' + fontStack(); }

  /**
   * MAKE SURE SARABUN IS ACTUALLY THERE BEFORE ANYTHING IS DRAWN.
   *
   * index.html loads it with `display=optional`, which is right for the app — a screen must not
   * block on a webfont — but it means that on a cold load the browser is entitled to skip the swap
   * for the whole page and render in Tahoma. A screen recovers on the next visit. A certificate is
   * printed once, framed, and the family keeps it, so it cannot be left to that. Asking the CSS Font
   * Loading API for the face directly fetches it regardless of the display descriptor.
   *
   * Never rejects: a school on a slow connection gets the looped fallback, not a failed export.
   */
  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve(false);
    return Promise.all([
      document.fonts.load('400 100px Sarabun'),
      document.fonts.load('700 100px Sarabun')
    ]).then(function () { return document.fonts.ready; })
      .then(function () { return document.fonts.check('700 100px Sarabun'); })
      .catch(function () { return false; });
  }

  /** Draw `s` centred on cx, shrinking the type until it fits `maxW`. Never clipped, never ellipsised
   *  — a child's name is the whole point of the page and must be complete. */
  function centred(ctx, s, cx, y, px, weight, colour, maxW) {
    s = String(s == null ? '' : s).trim();
    if (!s) return;
    var size = px;
    ctx.font = font(size, weight);
    while (size > 12 && ctx.measureText(s).width > maxW) { size -= 2; ctx.font = font(size, weight); }
    ctx.fillStyle = colour || INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, cx, y);
  }

  function rule(ctx, cx, y, w) {
    ctx.strokeStyle = RULE; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx - w / 2, y); ctx.lineTo(cx + w / 2, y); ctx.stroke();
  }

  function loadImage(src) {
    return new Promise(function (resolve) {
      if (!src) return resolve(null);
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { resolve(null); };   // a broken asset must not stop the certificate
      im.src = src;
    });
  }

  /**
   * FIND THE TWO BLANK RULES THE SCHOOL LEFT FOR US. A certificate template has a line to write the
   * child's name on and a line to sign above; landing the text on those lines is the whole job, and
   * a template that is not this school's will put them somewhere else.
   *
   * Scans the middle of the sheet for rows holding one long unbroken run of dark pixels — the runs
   * are the rules; letterforms never produce one. Returns null when it cannot find them, and the
   * measured constants are used instead, so an unusual artwork degrades to "roughly right" rather
   * than to "text in the top-left corner".
   */
  function findRules(im) {
    try {
      var cv = document.createElement('canvas');
      var w = Math.min(im.width, 1200), h = Math.round(im.height * (w / im.width));
      cv.width = w; cv.height = h;
      var c = cv.getContext('2d'); c.drawImage(im, 0, 0, w, h);
      var d = c.getImageData(0, 0, w, h).data;
      var found = [];
      for (var y = Math.round(h * 0.35); y < Math.round(h * 0.95); y++) {
        var run = 0, st = -1, best = 0, bs = -1, be = -1;
        for (var x = 0; x < w; x++) {
          var i = (y * w + x) * 4;
          if (d[i + 3] > 40 && d[i] < 190 && d[i + 1] < 190 && d[i + 2] < 190) {
            if (!run) st = x;
            run++; if (run > best) { best = run; bs = st; be = x; }
          } else run = 0;
        }
        if (best > w * 0.12) {
          var last = found[found.length - 1];
          // rows of the same rule are adjacent; keep one entry per line
          if (last && y - last.y <= 4) { last.y = y; }
          else found.push({ y: y, cx: (bs + be) / 2 / w, wid: best / w });
        }
      }
      if (found.length < 2) return null;
      // the name rule is the wide one, the signature rule the narrow one below it
      var name = found[0], sig = found[found.length - 1];
      if (!(sig.y > name.y) || name.wid < sig.wid) return null;
      return { nameY: name.y / h, nameCx: name.cx, sigY: sig.y / h, sigCx: sig.cx };
    } catch (e) { return null; }
  }

  /** The artwork, drawn at its own proportions — the canvas was sized to it, so this is 1:1. */
  function drawBackground(ctx, im, W, H) {
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
    if (!im) {   // no artwork uploaded yet: a plain sheet with a double border, still printable
      ctx.strokeStyle = '#1565C0'; ctx.lineWidth = 10;
      ctx.strokeRect(52, 52, W - 104, H - 104);
      ctx.strokeStyle = '#C8D6EA'; ctx.lineWidth = 3;
      ctx.strokeRect(78, 78, W - 156, H - 156);
      return;
    }
    ctx.drawImage(im, 0, 0, W, H);
  }

  /**
   * THE BOUNDING BOX OF THE ACTUAL INK IN A SIGNATURE, ignoring transparent or white margin.
   *
   * A scan of a signature is whatever rectangle the person cropped — the sample used to build this
   * had the strokes sitting in the top two thirds of the file. Placing the FILE against the rule
   * left the signature floating 36 px above the line; a signature that hovers over its own line is
   * the one detail that makes a document look generated. Trimming means the school can upload a
   * loose crop and it still sits on the line.
   *
   * Returns null when the image is blank or the scan cannot be read (a cross-origin signature would
   * taint this canvas — it never is, the API sends bytes, but null is the safe answer).
   */
  function inkBox(im) {
    try {
      var w = Math.min(im.width, 600), h = Math.max(1, Math.round(im.height * (w / im.width)));
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      var c = cv.getContext('2d'); c.drawImage(im, 0, 0, w, h);
      var d = c.getImageData(0, 0, w, h).data;
      var x1 = w, y1 = h, x2 = -1, y2 = -1;
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        // ink = opaque enough AND darker than paper. Both tests: a white opaque scan has no alpha
        // to go by, and a transparent PNG has no darkness to go by.
        if (d[i + 3] > 40 && (d[i] < 210 || d[i + 1] < 210 || d[i + 2] < 210)) {
          if (x < x1) x1 = x; if (x > x2) x2 = x;
          if (y < y1) y1 = y; if (y > y2) y2 = y;
        }
      }
      if (x2 < 0) return null;
      var k = im.width / w;   // back to the original image's own pixels
      return { sx: x1 * k, sy: y1 * k, sw: (x2 - x1 + 1) * k, sh: (y2 - y1 + 1) * k };
    } catch (e) { return null; }
  }

  /** Draw `s` left-aligned from x, shrinking to fit maxW. Used for the date, which follows "ให้ไว้ ณ". */
  function leftText(ctx, s, x, y, px, maxW) {
    s = String(s == null ? '' : s).trim(); if (!s) return;
    var size = px; ctx.font = font(size, 700);
    while (size > 10 && ctx.measureText(s).width > maxW) { size -= 1; ctx.font = font(size, 700); }
    ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, x, y);
  }

  /**
   * d = { name, nick, head, line1, line2, dateText, signerTitle, signerName, bg, sig }
   * Everything is pre-resolved by the caller — this function chooses no wording and no language.
   */
  function render(d) {
    d = d || {};
    return fontsReady().then(function () {
      return Promise.all([loadImage(d.bg), loadImage(d.sig)]);
    }).then(function (imgs) {
      var bg = imgs[0], sig = imgs[1];

      // the sheet takes the artwork's own proportions; A4 landscape when there is none
      var ratio = bg ? (bg.width / bg.height) : A4_RATIO;
      var W = ratio >= 1 ? LONG_EDGE : Math.round(LONG_EDGE * ratio);
      var H = ratio >= 1 ? Math.round(LONG_EDGE / ratio) : LONG_EDGE;

      var cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      var ctx = cv.getContext('2d');
      var cx = W / 2;

      drawBackground(ctx, bg, W, H);

      /* ===== THE SCHOOL'S OWN TEMPLATE: add three things and nothing else =====================
       * Asked 2026-09-25 after the first print doubled every line: "ผมต้องการให้เราเพิ่มแค่
       * ชื่อ-นามสกุลนักเรียน (ชื่อเล่น) ... / วันที่ / ลายเซ็น". The heading, both sentences,
       * "ให้ไว้ ณ", "ครูผู้อำนวยการ" and the director's name are already printed on the artwork. */
      if (bg && d.bgHasText !== false) {
        var R = findRules(bg) || {};
        var nameRuleY = R.nameY || P.nameRuleY;
        var nameCx = (R.nameCx || P.nameRuleCx) * W;
        // the baseline sits a fixed gap above whichever rule was found, so the name rests ON the line
        var gap = (P.nameRuleY - P.nameY) * H;
        var who2 = String(d.name || '').trim(), nk2 = String(d.nick || '').trim();
        if (nk2 && nk2 !== who2) who2 = who2 ? who2 + ' (' + nk2 + ')' : nk2;
        centred(ctx, who2, nameCx, nameRuleY * H - gap, H * P.nameSize, 700, INK, W * P.nameMaxW);

        leftText(ctx, d.dateText, W * P.dateX, H * P.dateY, H * P.dateSize, W * (1 - P.dateX - 0.10));

        if (sig && sig.width && sig.height) {
          var sigY = R.sigY || P.sigRuleY;
          var b = inkBox(sig) || { sx: 0, sy: 0, sw: sig.width, sh: sig.height };
          var s2 = Math.min((W * P.sigMaxW) / b.sw, (H * P.sigMaxH) / b.sh);
          var sw2 = b.sw * s2, sh2 = b.sh * s2;
          var scx = (R.sigCx || P.sigCx) * W;
          /* THE INK ENDS ON THE LINE, not above it. `sigDrop` puts the last stroke a hair BELOW the
           * rule, which is how a signature written by hand sits — a signature floating clear of its
           * own line is the detail that makes a document look machine-made. */
          ctx.drawImage(sig, b.sx, b.sy, b.sw, b.sh,
                        scx - sw2 / 2, (sigY + P.sigDrop) * H - sh2, sw2, sh2);
        }
        return { dataUrl: cv.toDataURL('image/jpeg', 0.92), width: W, height: H };
      }

      // ===== no artwork: the plain fallback sheet, which DOES print the wording ==================
      centred(ctx, d.head, cx, H * L.headY, L.head, 700, INK, W * 0.82);
      centred(ctx, d.line1, cx, H * L.line1Y, L.line1, 400, SOFT, W * 0.78);

      /* THE CHILD'S FULL NAME AND THEIR NICKNAME, on one line: "ณัฐภัทร ราชวงศ์ (ติณณ์)".
       * The ผอ. asked for "ชื่อจริง+(ชื่อเล่น)" and meant it literally — at this age the nickname is
       * what the child answers to and what the family will read first, and the legal name is what
       * makes the document a record. Both, or the sheet is either impersonal or not evidence. */
      var who = String(d.name || '').trim();
      var nick = String(d.nick || '').trim();
      if (nick && nick !== who) who = who ? who + ' (' + nick + ')' : nick;
      centred(ctx, who, cx, H * L.nameY, L.name, 700, INK, W * (L.ruleW - 0.02));
      rule(ctx, cx, H * L.ruleY, W * L.ruleW);

      centred(ctx, d.line2, cx, H * L.line2Y, L.line2, 400, SOFT, W * 0.80);
      centred(ctx, d.line3, cx, H * L.line3Y, L.line2, 400, SOFT, W * 0.80);
      centred(ctx, d.dateText, cx, H * L.dateY, L.date, 400, INK, W * 0.70);

      var sx = W * L.sigX;
      if (sig && sig.width && sig.height) {
        var s = Math.min((W * L.sigMaxW) / sig.width, (H * L.sigMaxH) / sig.height);
        var sw = sig.width * s, sh = sig.height * s;
        ctx.drawImage(sig, sx - sw / 2, H * L.sigY - sh / 2, sw, sh);
      }
      rule(ctx, sx, H * L.sigRuleY, W * L.sigRuleW);
      centred(ctx, d.signerTitle, sx, H * L.titleY, L.title, 400, INK, W * L.sigRuleW);
      // the name goes in brackets, which is how every Thai official document sets a signatory
      var nm = String(d.signerName || '').trim();
      centred(ctx, nm ? '(' + nm + ')' : '', sx, H * L.signerY, L.signer, 400, INK, W * L.sigRuleW);

      return { dataUrl: cv.toDataURL('image/jpeg', 0.92), width: W, height: H };
    });
  }

  function kit() {
    var k = window.AtomReportCard;
    if (!k || !k.buildPdf) throw new Error('report_card.js is not loaded');
    return k;
  }

  function safe(s) { return String(s == null ? '' : s).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60); }

  /**
   * One PDF holding one page per child. buildPdf takes `landscape` per sheet (added for this), so a
   * certificate prints on a landscape A4 rather than being letterboxed into a portrait one.
   *
   * RENDERED ONE AT A TIME, on purpose: each sheet is a ~15 MB bitmap, and building thirty of them
   * in parallel is how a phone runs out of memory halfway through a graduation.
   */
  function savePdf(items, filename) {
    var k = kit(), sheets = [];
    return items.reduce(function (chain, d) {
      return chain.then(function () {
        return render(d).then(function (r) {
          sheets.push({ bytes: k.b64ToBytes(r.dataUrl.split(',')[1]), w: r.width, h: r.height, landscape: true });
        });
      });
    }, Promise.resolve()).then(function () {
      k.download(k.buildPdf(sheets), filename || 'certificates.pdf', 'application/pdf');
      return sheets.length;
    });
  }

  /** One JPEG per child, for a school that would rather put it into their own layout. */
  function saveJpeg(items, base) {
    var k = kit();
    return items.reduce(function (chain, d, i) {
      return chain.then(function () {
        return render(d).then(function (r) {
          k.download(r.dataUrl, safe(base || 'certificate') + '_' + safe(d.nick || d.name || (i + 1)) + '.jpg');
        });
      });
    }, Promise.resolve()).then(function () { return items.length; });
  }

  /* findRules is exported so the settings screen can tell the school, at upload time, whether their
   * artwork's lines were recognised — better than finding out from a printed sheet. */
  window.AtomCertificate = { render: render, savePdf: savePdf, saveJpeg: saveJpeg,
                             findRules: findRules, positions: P, longEdge: LONG_EDGE, safe: safe };
})();
