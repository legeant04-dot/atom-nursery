/**
 * ocr_dspm.js — OCR the DSPM ministry manual to a verifiable draft.
 *
 * Renders each page's embedded glyphs to a hi-res PNG (pdfjs + canvas),
 * then runs Tesseract (tha+eng). Page images are kept so a human can
 * proofread each page against the OCR text side-by-side.
 *
 * OCR output is a DRAFT — NOT loaded into DSPM_CRITERIA until a person
 * verifies it against the printed manual (clinical data, must be exact).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const { createCanvas } = require('@napi-rs/canvas');

const ROOT = path.resolve(__dirname, '..');
const PDF = path.join(ROOT, 'คู่มือเฝ้าระวังและส่งเสริมพัฒนาการเด็กป.pdf');
const OUT = path.join(ROOT, 'dspm_ocr');
const IMG = path.join(OUT, 'pages');
const TESS = path.join(process.env.LOCALAPPDATA, 'Programs', 'Tesseract-OCR', 'tesseract.exe');
const TESSDATA = path.join(path.dirname(TESS), 'tessdata');
const PDFJS_DIR = path.join(__dirname, 'node_modules', 'pdfjs-dist');
const SCALE = 3.5;            // render scale (hi-res for table accuracy)
const ONLY = process.env.OCR_ONLY ? parseInt(process.env.OCR_ONLY, 10) : 0; // 0 = all pages

function log(m){ console.log('[' + new Date().toISOString() + '] ' + m); }
function dirUrl(p){ return pathToFileURL(p).href + '/'; }

function download(url, dest){
  return new Promise((resolve, reject) => {
    const f = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return download(res.headers.location, dest).then(resolve, reject);
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      res.pipe(f); f.on('finish', () => f.close(() => resolve(dest)));
    }).on('error', reject);
  });
}

(async () => {
  fs.mkdirSync(IMG, { recursive: true });

  const thaPath = path.join(TESSDATA, 'tha.traineddata');
  if (!fs.existsSync(thaPath)) {
    log('downloading Thai best model...');
    await download('https://github.com/tesseract-ocr/tessdata_best/raw/main/tha.traineddata', thaPath);
  }
  log('tha model ready: ' + fs.existsSync(thaPath));

  const pdfjs = await import(pathToFileURL(path.join(PDFJS_DIR, 'legacy', 'build', 'pdf.mjs')).href);
  const data = new Uint8Array(fs.readFileSync(PDF));
  const doc = await pdfjs.getDocument({
    data,
    cMapUrl: dirUrl(path.join(PDFJS_DIR, 'cmaps')),
    cMapPacked: true,
    standardFontDataUrl: dirUrl(path.join(PDFJS_DIR, 'standard_fonts'))
  }).promise;
  const total = ONLY || doc.numPages;
  log('PDF opened: ' + doc.numPages + ' pages, processing ' + total);

  let combined = '';
  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: SCALE });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const png = path.join(IMG, 'page-' + String(i).padStart(3, '0') + '.png');
    fs.writeFileSync(png, canvas.toBuffer('image/png'));

    const base = png.replace(/\.png$/i, '');
    try {
      execFileSync(TESS, [png, base, '-l', 'tha+eng', '--psm', '6'],
        { env: Object.assign({}, process.env, { TESSDATA_PREFIX: TESSDATA }) });
      const txt = fs.readFileSync(base + '.txt', 'utf8');
      combined += '\n\n===== PAGE ' + i + ' / ' + doc.numPages + ' =====\n' + txt;
      log('page ' + i + '/' + total + ' ok (' + txt.length + ' chars)');
    } catch (e) {
      combined += '\n\n===== PAGE ' + i + ' [OCR ERROR] =====\n';
      log('page ' + i + ' OCR FAILED: ' + e.message);
    }
    page.cleanup();
  }
  fs.writeFileSync(path.join(OUT, 'dspm_ocr_raw.txt'), combined, 'utf8');
  log('DONE -> dspm_ocr/dspm_ocr_raw.txt (+ page PNGs & per-page .txt in dspm_ocr/pages)');
})().catch(e => { log('FATAL ' + (e && e.stack || e)); process.exit(1); });
