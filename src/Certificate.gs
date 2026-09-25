/**
 * Certificate.gs — the artwork and the wording behind ใบประกาศนียบัตร.
 * ================================================================================================
 * Asked 2026-09-24 by the ผอ.: a certificate for children who have finished, printable at high
 * quality. The list of children and the wording live in the engine (certStudents / certText); the
 * two things that cannot — reading and writing files — live here.
 *
 * THE CERTIFICATE ITSELF IS NEVER BUILT ON THIS SERVER. The school's blank artwork and the
 * director's signature come down to the browser, which composites the child's name onto them and
 * writes the PDF locally (webapp/certificate.js, reusing report_card.js). So a document carrying a
 * named child never exists anywhere except on the machine of the admin who asked for it — the same
 * rule the report card already follows, and the reason neither needs a PDPA retention answer.
 *
 * WHY THE BYTES COME BACK AS base64 RATHER THAN A DRIVE LINK, which is how photos work here:
 *
 *   1. A canvas that has drawn a cross-origin image is TAINTED, and toDataURL() on it throws.
 *      drive.google.com sends no CORS header, so the obvious implementation — draw the background
 *      from its thumbnail URL — produces a certificate that renders on screen and cannot be
 *      exported. A `data:` URL taints nothing.
 *   2. driveifyImage_ publishes what it stores as ANYONE_WITH_LINK. That is fine for a QR code.
 *      It is NOT fine for the director's signature, which is the one image here that a person could
 *      misuse, so these two files are left private and served only through this route — which means
 *      only a signed-in admin can ever fetch them.
 */

/**
 * The three uploaded files, and nothing else, live under these keys in SCHOOL_CONFIG.
 *
 * `font` was added 2026-09-25 because naming a font in CSS cannot make it exist. The school's
 * template is set in **TH Sarabun New Bold**, which is one of Thailand's national fonts — free to
 * use, but not on Google Fonts and therefore not something the app can ship. Naming it first in the
 * stack only helps a machine that already has it installed, and the machine doing the rendering
 * did not: every certificate was quietly coming out in Sarabun instead, which is the same
 * designer's later redraw and visibly not the same letterforms next to the template's own text.
 *
 * So the school uploads the font it actually uses, exactly as it uploads its artwork and its
 * signature. That makes the output identical on every machine — an admin's laptop, the ผอ.'s
 * desktop, a phone — instead of depending on what happens to be installed, and it keeps the
 * licensing where it belongs: with the school's own copy of its own font.
 */
var CERT_ASSET_KEYS_ = { bg: 'CertBgFileId', sig: 'CertSigFileId', font: 'CertFontFileId' };

/** Font files that a browser can register through the FontFace API. */
var CERT_FONT_MIME_ = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };

/* An upload has to survive a POST body, and Apps Script starts refusing somewhere around the
 * low megabytes. The client already downscales to A4-landscape at 150 dpi before sending; this is
 * the backstop that turns "the save silently did nothing" into a sentence the admin can act on. */
var CERT_MAX_ASSET_BYTES_ = 3 * 1024 * 1024;

function certFolder_() {
  var name = getConfig_('CertFolderName', 'AtomNursery_Certificates');
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

/** admin-only: the twelve wording lines, defaults filled in. Shadows the engine route. */
function handleCertText() {
  var cfg = getAllConfig_(), out = {}, i;
  var keys = ['CertHeadTH', 'CertHeadEN', 'CertLine1TH', 'CertLine1EN', 'CertLine2TH', 'CertLine2EN',
    'CertDatePrefixTH', 'CertDatePrefixEN', 'CertSignerTitleTH', 'CertSignerTitleEN',
    'CertSignerNameTH', 'CertSignerNameEN', 'CertBgHasText'];
  var dflt = {
    CertLine1TH: 'ขอมอบเกียรติบัตรฉบับนี้ให้ไว้เพื่อแสดงว่า', CertLine1EN: 'This certificate is proudly presented to',
    CertLine2TH: 'ได้เข้าเรียนและผ่านการประเมินจาก', CertLine2EN: 'for attending and completing the programme at',
    CertDatePrefixTH: 'วันที่', CertDatePrefixEN: '',
    CertSignerTitleTH: 'ครูผู้อำนวยการ', CertSignerTitleEN: 'Director', CertBgHasText: 'false' };
  /* A VALUE THIS PROJECT ITSELF WROTE, AND HAS TO TAKE BACK. v400 defaulted the date prefix to
   * 'ให้ไว้ ณ วันที่' assuming a blank frame; the school's template already prints "ให้ไว้ ณ", so the
   * first sheet read "ให้ไว้ ณ ให้ไว้ ณ วันที่ ๒๕ …". Changing the default in v401 fixed nothing —
   * the admin had opened settings to upload the artwork, the box was pre-filled with that default,
   * and Save stored it. So the exact string that default used is read as "never set". Exact match
   * only, and read-side: the sheet is not rewritten, so there is nothing to undo. Kept identical to
   * CERT_LEGACY_ in webapp/engine.js — tools/test_certificate.js asserts the two agree. */
  var legacy = { CertDatePrefixTH: 'ให้ไว้ ณ วันที่', CertDatePrefixEN: 'Given on' };
  for (i = 0; i < keys.length; i++) {
    var v = cfg[keys[i]];
    v = (v === undefined || v === null) ? '' : String(v);
    /* ONLY WHEN THE ARTWORK CARRIES THE LEAD-IN. With a blank frame the app writes "ให้ไว้ ณ"
     * itself, so 'ให้ไว้ ณ วันที่' is exactly right there and must survive. */
    if (v !== '' && legacy[keys[i]] === v && String(cfg.CertBgHasText || 'true') !== 'false') v = '';
    out[keys[i]] = v !== '' ? v : (dflt[keys[i]] || '');
  }
  out.hasBg = !!getConfig_(CERT_ASSET_KEYS_.bg, '');
  out.hasSig = !!getConfig_(CERT_ASSET_KEYS_.sig, '');
  out.hasFont = !!getConfig_(CERT_ASSET_KEYS_.font, '');
  out.schoolName = getConfig_('SchoolName', '');
  return out;
}

/** admin-only: save all twelve at once — see the engine's note on why this is not twelve writes. */
function handleSaveCertText(p) {
  p = p || {};
  var keys = ['CertHeadTH', 'CertHeadEN', 'CertLine1TH', 'CertLine1EN', 'CertLine2TH', 'CertLine2EN',
    'CertDatePrefixTH', 'CertDatePrefixEN', 'CertSignerTitleTH', 'CertSignerTitleEN',
    'CertSignerNameTH', 'CertSignerNameEN', 'CertBgHasText'];
  var wrote = 0;
  for (var i = 0; i < keys.length; i++) {
    if (p[keys[i]] === undefined) continue;
    // 300 chars is far more than any line on a certificate and far less than the cell limit
    setConfigValue_(keys[i], String(p[keys[i]] == null ? '' : p[keys[i]]).slice(0, 300));
    wrote++;
  }
  try { logAudit(p.adminId || 'admin', 'CERT_TEXT', 'SCHOOL_CONFIG', wrote + ' lines'); } catch (e) {}
  return handleCertText();
}

/**
 * admin-only: replace (or clear) the background artwork or the signature.
 *
 * p.which = 'bg' | 'sig' · p.dataUrl = 'data:image/...;base64,...' · p.clear = true to remove.
 *
 * THE OLD FILE IS TRASHED, NOT ORPHANED. Uploading a new signature six times should not leave five
 * forgotten copies of a director's signature sitting in Drive — each of which is a separate thing
 * that has to be remembered on the day the school leaves the platform.
 */
function handleSaveCertAsset(p) {
  p = p || {};
  var which = String(p.which || '');
  var key = CERT_ASSET_KEYS_[which];
  if (!key) throw apiError_('BAD_INPUT', 'ไม่รู้จักไฟล์ที่จะบันทึก: ' + which);

  var prev = getConfig_(key, '');
  var trashPrev = function () {
    if (!prev) return;
    try { DriveApp.getFileById(prev).setTrashed(true); } catch (e) {}
  };

  if (p.clear) {
    trashPrev();
    setConfigValue_(key, '');
    try { logAudit(p.adminId || 'admin', 'CERT_ASSET', which, 'cleared'); } catch (e) {}
    return handleCertText();
  }

  var url = String(p.dataUrl || '');
  var isFont = which === 'font';
  if (url.indexOf('data:') !== 0) throw apiError_('BAD_INPUT', 'ไฟล์ไม่ถูกต้อง');
  if (!isFont && url.indexOf('data:image/') !== 0) throw apiError_('BAD_INPUT', 'ต้องเป็นไฟล์รูปภาพ');
  var comma = url.indexOf(',');
  var b64 = comma >= 0 ? url.slice(comma + 1) : '';
  if (!b64) throw apiError_('BAD_INPUT', 'ไฟล์ว่าง');
  // base64 is 4 chars per 3 bytes — check before decoding, so an oversized upload is refused
  // rather than being decoded into memory first
  if (b64.length * 3 / 4 > CERT_MAX_ASSET_BYTES_)
    throw apiError_('BAD_INPUT', isFont ? 'ไฟล์ฟอนต์ใหญ่เกินไป' : 'ไฟล์ใหญ่เกินไป — ย่อรูปให้เล็กลงแล้วลองใหม่');

  var mime, ext;
  if (isFont) {
    /* THE EXTENSION DECIDES, NOT THE BROWSER'S GUESS. Windows hands .ttf up as
     * application/octet-stream as often as font/ttf, so trusting the data: URL's own mime would
     * reject the most ordinary upload there is. `ext` comes from the filename the client sends. */
    ext = String(p.ext || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!CERT_FONT_MIME_[ext]) throw apiError_('BAD_INPUT', 'รองรับเฉพาะไฟล์ .ttf .otf .woff .woff2');
    mime = CERT_FONT_MIME_[ext];
    ext = '.' + ext;
  } else {
    mime = url.slice(5, url.indexOf(';') > 0 ? url.indexOf(';') : url.indexOf(','));
    if (mime !== 'image/png' && mime !== 'image/jpeg') mime = 'image/png';
    ext = mime === 'image/jpeg' ? '.jpg' : '.png';
  }
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, 'cert-' + which + '-' + Date.now() + ext);
  // NOT shared. See the header: the signature must not be reachable by URL.
  var file = certFolder_().createFile(blob);
  trashPrev();
  setConfigValue_(key, file.getId());
  try { logAudit(p.adminId || 'admin', 'CERT_ASSET', which, 'uploaded ' + Math.round(b64.length * 3 / 4 / 1024) + ' KB'); } catch (e) {}
  return handleCertText();
}

/**
 * admin-only: the two images, as data URLs, for the browser to composite onto.
 * A missing file returns '' rather than throwing — a school that has not uploaded artwork yet still
 * gets a working screen, with the plain fallback layout.
 */
function handleCertAssets() {
  var read = function (key) {
    var id = getConfig_(key, '');
    if (!id) return '';
    try {
      var blob = DriveApp.getFileById(id).getBlob();
      return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
    } catch (e) { return ''; }   // deleted from Drive by hand, or permission lost
  };
  return { bg: read(CERT_ASSET_KEYS_.bg), sig: read(CERT_ASSET_KEYS_.sig),
           font: read(CERT_ASSET_KEYS_.font) };
}

/**
 * admin-only: record that certificates were printed.
 *
 * The school chose to keep the director's signature in the system and have it printed onto the
 * sheet (asked and answered 2026-09-24). That is their call and it saves real time — but it means
 * a signed document can be produced without the director present, so the least we owe them is a
 * line saying which child, by whom, and when. The PDF is still built entirely on the client; this
 * is one small call afterwards, and a failure here never blocks the download.
 */
function handleMarkCertIssued(p) {
  p = p || {};
  var ids = Array.isArray(p.studentIds) ? p.studentIds.slice(0, 200) : [];
  if (!ids.length) return { ok: true, logged: 0 };
  try {
    logAudit(p.adminId || 'admin', 'CERT_ISSUED', ids.join(','),
      ids.length + ' certificate(s), dated ' + String(p.issueDate || ''));
  } catch (e) {}
  return { ok: true, logged: ids.length };
}
