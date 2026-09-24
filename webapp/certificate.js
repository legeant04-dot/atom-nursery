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

  /* A4 LANDSCAPE AT 200 dpi — 2339 × 1654.
   * The report card is 150 dpi because it is a dense page of small type that has to be readable and
   * is usually read on screen. This is the opposite: a handful of large words, printed once, framed
   * and kept. 200 dpi is where the curves of Thai letterforms stop showing stair-steps at the size
   * a name is set here. The bitmap costs ~15 MB while it is being drawn, which is why the screen
   * renders one certificate at a time even when a batch is being exported. */
  var W = 2339, H = 1654;

  /* Every position is a FRACTION of the sheet, never a pixel — the school uploads its own artwork
   * and the next school's will not be the same proportions. Tuned against the sample given
   * 2026-09-24; grouped here so they can be nudged without reading the drawing code. */
  var L = {
    headY: 0.335, head: 68,          // school name
    line1Y: 0.410, line1: 40,        // "ขอมอบเกียรติบัตรฉบับนี้ให้ไว้เพื่อแสดงว่า"
    nameY: 0.508, name: 76,          // the child
    ruleY: 0.534, ruleW: 0.52,       // the line under the child's name
    line2Y: 0.605, line2: 40,        // "ได้เข้าเรียนและผ่านการประเมินจาก"
    line3Y: 0.663,                   // ...the school's name, second line of the same sentence
    dateY: 0.722, date: 40,
    sigX: 0.655, sigY: 0.798, sigMaxW: 0.20, sigMaxH: 0.085,   // the signature image sits ON the rule
    sigRuleY: 0.828, sigRuleW: 0.26,
    /* THE LAST LINE HAS TO CLEAR THE ARTWORK'S OWN BORDER. At 0.960 the bracketed name printed ON
     * the frame — found by looking at a rendered sheet, not by reading the numbers, because 0.960
     * "looks like" it is inside the page until the descenders and the border are both drawn. */
    titleY: 0.878, title: 36,
    signerY: 0.928, signer: 36
  };

  var INK = '#1A2130', SOFT = '#3A4356', RULE = '#98A2B3';
  function fontStack() { return '"Sarabun", "Noto Sans Thai", "Leelawadee UI", "Tahoma", sans-serif'; }
  function font(px, weight) { return (weight || 400) + ' ' + Math.round(px) + 'px ' + fontStack(); }

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

  /** Cover the sheet with the artwork, cropping the overflow — the artwork is a full-bleed background
   *  and letterboxing it would print white bands the school did not design. */
  function drawBackground(ctx, im) {
    if (!im) {   // no artwork uploaded yet: a plain sheet with a double border, still printable
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#1565C0'; ctx.lineWidth = 10;
      ctx.strokeRect(52, 52, W - 104, H - 104);
      ctx.strokeStyle = '#C8D6EA'; ctx.lineWidth = 3;
      ctx.strokeRect(78, 78, W - 156, H - 156);
      return;
    }
    var scale = Math.max(W / im.width, H / im.height);
    var iw = im.width * scale, ih = im.height * scale;
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(im, (W - iw) / 2, (H - ih) / 2, iw, ih);
  }

  /**
   * d = { name, nick, head, line1, line2, dateText, signerTitle, signerName, bg, sig }
   * Everything is pre-resolved by the caller — this function chooses no wording and no language.
   */
  function render(d) {
    d = d || {};
    var ready = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    return ready.then(function () {
      return Promise.all([loadImage(d.bg), loadImage(d.sig)]);
    }).then(function (imgs) {
      var bg = imgs[0], sig = imgs[1];
      var cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      var ctx = cv.getContext('2d');
      var cx = W / 2;

      drawBackground(ctx, bg);

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

  window.AtomCertificate = { render: render, savePdf: savePdf, saveJpeg: saveJpeg, W: W, H: H, safe: safe };
})();
