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

/** Both assets, and nothing else, live under this key prefix in SCHOOL_CONFIG. */
var CERT_ASSET_KEYS_ = { bg: 'CertBgFileId', sig: 'CertSigFileId' };

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
    'CertSignerNameTH', 'CertSignerNameEN'];
  var dflt = {
    CertLine1TH: 'ขอมอบเกียรติบัตรฉบับนี้ให้ไว้เพื่อแสดงว่า', CertLine1EN: 'This certificate is proudly presented to',
    CertLine2TH: 'ได้เข้าเรียนและผ่านการประเมินจาก', CertLine2EN: 'for attending and completing the programme at',
    CertDatePrefixTH: 'ให้ไว้ ณ วันที่', CertDatePrefixEN: 'Given on',
    CertSignerTitleTH: 'ครูผู้อำนวยการ', CertSignerTitleEN: 'Director' };
  for (i = 0; i < keys.length; i++) {
    var v = cfg[keys[i]];
    v = (v === undefined || v === null) ? '' : String(v);
    out[keys[i]] = v !== '' ? v : (dflt[keys[i]] || '');
  }
  out.hasBg = !!getConfig_(CERT_ASSET_KEYS_.bg, '');
  out.hasSig = !!getConfig_(CERT_ASSET_KEYS_.sig, '');
  out.schoolName = getConfig_('SchoolName', '');
  return out;
}

/** admin-only: save all twelve at once — see the engine's note on why this is not twelve writes. */
function handleSaveCertText(p) {
  p = p || {};
  var keys = ['CertHeadTH', 'CertHeadEN', 'CertLine1TH', 'CertLine1EN', 'CertLine2TH', 'CertLine2EN',
    'CertDatePrefixTH', 'CertDatePrefixEN', 'CertSignerTitleTH', 'CertSignerTitleEN',
    'CertSignerNameTH', 'CertSignerNameEN'];
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
  if (url.indexOf('data:image/') !== 0) throw apiError_('BAD_INPUT', 'ต้องเป็นไฟล์รูปภาพ');
  var comma = url.indexOf(',');
  var b64 = comma >= 0 ? url.slice(comma + 1) : '';
  if (!b64) throw apiError_('BAD_INPUT', 'ไฟล์ว่าง');
  // base64 is 4 chars per 3 bytes — check before decoding, so an oversized upload is refused
  // rather than being decoded into memory first
  if (b64.length * 3 / 4 > CERT_MAX_ASSET_BYTES_)
    throw apiError_('BAD_INPUT', 'ไฟล์ใหญ่เกินไป — ย่อรูปให้เล็กลงแล้วลองใหม่');

  var mime = url.slice(5, url.indexOf(';') > 0 ? url.indexOf(';') : url.indexOf(','));
  if (mime !== 'image/png' && mime !== 'image/jpeg') mime = 'image/png';
  var ext = mime === 'image/jpeg' ? '.jpg' : '.png';
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
  return { bg: read(CERT_ASSET_KEYS_.bg), sig: read(CERT_ASSET_KEYS_.sig) };
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
