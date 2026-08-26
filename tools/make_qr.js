/**
 * tools/make_qr.js — the QR code the school hands to parents.
 *   node tools/make_qr.js
 *
 * Produces, into dist/:
 *   Atom_Nursery_QR.png            the code on its own, 1200px, for pasting into anything
 *   Atom_Nursery_QR_Poster.svg     an A4 sheet to print and put on the wall
 *   Atom_Nursery_APK_QR.png        a second code, straight to the .apk (see below)
 *
 * WHICH URL THE MAIN CODE POINTS AT, and why it is not the .apk.
 *
 * Sending a scanner directly to the file downloads it with no explanation — and on an iPhone
 * downloads something that cannot be installed at all, which is the half of the school we would be
 * handing a dead end to. The site already knows how to answer both:
 *   · Android → the green "ติดตั้งแอป" card, and the walkthrough that names the two Play Protect
 *     warnings BEFORE the download starts, which is what stops people abandoning it half way
 *   · iPhone  → add-to-home-screen, which is the best that platform allows
 * One code, printed once, correct for every parent. The direct-to-.apk code is produced as well for
 * the case where somebody is standing next to an Android phone and wants to skip the page.
 *
 * The poster is SVG on purpose: Thai renders as real text at any size (no font baked into a bitmap),
 * it prints crisply on any printer, and it opens in a browser with Ctrl+P.
 *
 * VERIFICATION. A QR that encodes the wrong thing looks exactly like one that does not, so the
 * generated PNG is DECODED again and compared with the URL that went in. See tools/test_qr.js.
 */
const fs = require('fs'), path = require('path');
const QRCode = require('qrcode');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');

const SITE = 'https://legeant04-dot.github.io/atom-nursery/';
const APK  = 'https://github.com/legeant04-dot/atom-nursery/releases/latest/download/atom-nursery.apk';

/* errorCorrectionLevel 'H' — the highest. A poster on a nursery wall gets sunlight, fingerprints,
 * a corner curling up and a phone camera held at an angle; H recovers from about 30% of the code
 * being unreadable. It costs a denser image, which does not matter at this size. */
const OPTS = { errorCorrectionLevel: 'H', margin: 2, width: 1200,
  color: { dark: '#1565C0', light: '#FFFFFF' } };   // the app's own blue

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  await QRCode.toFile(path.join(OUT, 'Atom_Nursery_QR.png'), SITE, OPTS);
  await QRCode.toFile(path.join(OUT, 'Atom_Nursery_APK_QR.png'), APK, OPTS);

  // the poster embeds the code as SVG paths, so the whole sheet stays one resolution-free file
  const qrSvg = await QRCode.toString(SITE, { type: 'svg', errorCorrectionLevel: 'H', margin: 0 });
  const inner = /<path[\s\S]*<\/svg>/.exec(qrSvg)[0].replace('</svg>', '');
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(qrSvg);
  const size = vb ? Number(vb[1]) : 33;

  const T = (x, y, s, txt, opts) => `<text x="${x}" y="${y}" font-size="${s}" text-anchor="middle" ` +
    `font-family="Sarabun, 'Noto Sans Thai', 'Leelawadee UI', Tahoma, sans-serif" ` +
    `fill="${(opts && opts.fill) || '#0F2A47'}"${(opts && opts.bold) ? ' font-weight="700"' : ''}>${txt}</text>`;

  // A4 at 72dpi-ish: 595 × 842
  const W = 595, H = 842, QR = 300, QX = (W - QR) / 2, QY = 250;
  const poster = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#FFFFFF"/>
  <rect x="0" y="0" width="${W}" height="140" fill="#1565C0"/>
  ${T(W / 2, 62, 30, 'Atom Nursery', { fill: '#FFFFFF', bold: true })}
  ${T(W / 2, 100, 17, 'แอปสำหรับผู้ปกครอง', { fill: '#D6E6FA' })}

  ${T(W / 2, 196, 25, 'สแกนเพื่อติดตั้งแอป', { bold: true })}
  ${T(W / 2, 226, 15, 'เปิดกล้องมือถือ แล้วส่องที่รูปสี่เหลี่ยมด้านล่าง', { fill: '#5A6B7D' })}

  <g transform="translate(${QX} ${QY}) scale(${QR / size})">${inner}</g>

  ${T(W / 2, QY + QR + 46, 14, 'หรือพิมพ์ลิงก์นี้ในเบราว์เซอร์', { fill: '#5A6B7D' })}
  ${T(W / 2, QY + QR + 70, 15, 'legeant04-dot.github.io/atom-nursery', { fill: '#1565C0', bold: true })}

  <rect x="60" y="${QY + QR + 96}" width="${W - 120}" height="132" rx="12" fill="#F4F7FB" stroke="#D6E6FA"/>
  ${T(W / 2, QY + QR + 126, 15, '🤖 เครื่อง Android — กดปุ่มสีเขียว "ติดตั้งแอป"', { bold: true })}
  ${T(W / 2, QY + QR + 150, 13, 'ระหว่างติดตั้งเครื่องจะเตือน 2 ครั้ง เป็นเรื่องปกติ', { fill: '#5A6B7D' })}
  ${T(W / 2, QY + QR + 168, 13, 'เพราะโรงเรียนแจกให้โดยตรง ไม่ได้ผ่าน Play Store', { fill: '#5A6B7D' })}
  ${T(W / 2, QY + QR + 196, 15, '🍎 iPhone / iPad — เลือก "เพิ่มลงในหน้าจอโฮม"', { bold: true })}
  ${T(W / 2, QY + QR + 216, 13, 'จะได้ไอคอนแอปเหมือนกัน ใช้งานได้เหมือนกัน', { fill: '#5A6B7D' })}

  ${T(W / 2, H - 44, 13, 'เข้าสู่ระบบด้วย LINE ที่เพิ่มเพื่อน OA ของโรงเรียน', { fill: '#5A6B7D' })}
  ${T(W / 2, H - 24, 12, 'มีปัญหาการติดตั้ง แจ้งคุณครูได้เลยค่ะ', { fill: '#8A97A6' })}
</svg>
`;
  fs.writeFileSync(path.join(OUT, 'Atom_Nursery_QR_Poster.svg'), poster, 'utf8');

  console.log('dist/Atom_Nursery_QR.png          →', SITE);
  console.log('dist/Atom_Nursery_APK_QR.png      →', APK);
  console.log('dist/Atom_Nursery_QR_Poster.svg   → A4, printable');
}
main().catch(e => { console.error(e); process.exit(1); });
