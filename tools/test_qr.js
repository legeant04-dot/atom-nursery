/**
 * tools/test_qr.js — the QR really does go where the poster says it goes.
 *   node tools/test_qr.js
 *
 * A QR code that encodes the wrong URL looks EXACTLY like one that encodes the right one. Nobody
 * proof-reads a square of noise, and the first person to find out would be a parent standing in the
 * lobby with a camera pointed at a poster on the wall.
 *
 * So the generated PNGs are decoded again — pixels back to text, with a different library from the
 * one that wrote them — and compared with the URLs they are supposed to carry. That is the only
 * check here that means anything; everything else is about the sheet around it.
 */
const fs = require('fs'), path = require('path');
const { PNG } = require('pngjs');
const jsQR = require('jsqr');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const ROOT = path.join(__dirname, '..');
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

const SITE = 'https://legeant04-dot.github.io/atom-nursery/';
const APK  = 'https://github.com/legeant04-dot/atom-nursery/releases/latest/download/atom-nursery.apk';

/** decode a PNG the way a phone camera would: pixels in, text out */
function scan(file) {
  const p = PNG.sync.read(fs.readFileSync(path.join(ROOT, file)));
  const r = jsQR(new Uint8ClampedArray(p.data), p.width, p.height);
  return r ? r.data : null;
}

console.log('\n1) the codes decode — and to the right place');
{
  ok_('the poster code exists', fs.existsSync(path.join(ROOT, 'dist/Atom_Nursery_QR.png')));
  eq('scanning it gives the school’s app', scan('dist/Atom_Nursery_QR.png'), SITE);
  eq('...and the direct one gives the .apk', scan('dist/Atom_Nursery_APK_QR.png'), APK);
  /* THE MAIN CODE IS DELIBERATELY NOT THE .apk. A scanner sent straight to the file downloads it
   * with no explanation, and on an iPhone downloads something that cannot be installed at all —
   * half the school handed a dead end. The site answers both platforms, and it is where the install
   * walkthrough (with the two Play Protect warnings named in advance) already lives. */
  ok_('the poster does NOT send everyone to a file iPhones cannot open', scan('dist/Atom_Nursery_QR.png') !== APK);
}

console.log('\n2) it survives a wall');
{
  const gen = R('tools/make_qr.js');
  /* Sunlight, fingerprints, a curling corner, a camera held at an angle. 'H' recovers from about
   * 30% of the code being unreadable, and the only cost is a denser image, which does not matter
   * at poster size. */
  ok_('highest error correction', /errorCorrectionLevel: 'H'/.test(gen));
  ok_('...on the poster code too', /type: 'svg', errorCorrectionLevel: 'H'/.test(gen));
  const p = PNG.sync.read(fs.readFileSync(path.join(ROOT, 'dist/Atom_Nursery_QR.png')));
  ok_('big enough to reprint at any size', p.width >= 1000 && p.height >= 1000);
  ok_('...with a quiet margin, or a camera cannot find its edges', /margin: 2/.test(gen));
}

console.log('\n3) the printed sheet says what a parent has to do');
{
  const svg = R('dist/Atom_Nursery_QR_Poster.svg');
  ok_('A4-shaped', /width="595" height="842"/.test(svg));
  /* SVG, not a bitmap: Thai stays real text at any size, so it prints crisply on whatever the
   * school owns and nobody has to have a Thai font baked into an image. */
  ok_('Thai is text, not pixels', /<text/.test(svg) && /สแกนเพื่อติดตั้งแอป/.test(svg));
  ok_('...with a Thai font stack, not just a default', /Noto Sans Thai/.test(svg));
  ok_('the link is printed as well, for anyone whose camera will not scan', /legeant04-dot\.github\.io\/atom-nursery/.test(svg));
  // both platforms are answered on the sheet — an iPhone parent must not be left wondering
  ok_('Android is told about the green button', /เครื่อง Android/.test(svg) && /ติดตั้งแอป/.test(svg));
  ok_('...and warned about the two prompts, in advance', /เตือน 2 ครั้ง เป็นเรื่องปกติ/.test(svg));
  ok_('...with the reason, so it does not read as "this app is unsafe"', /ไม่ได้ผ่าน Play Store/.test(svg));
  ok_('iPhone is answered too', /iPhone \/ iPad/.test(svg) && /เพิ่มลงในหน้าจอโฮม/.test(svg));
  ok_('and it says how to sign in', /LINE/.test(svg));
  ok_('...and who to ask when it goes wrong', /แจ้งคุณครู/.test(svg));
  // the code on the sheet must be the SAME code that was decoded above
  ok_('the sheet embeds the code rather than linking to it', /<g transform="translate/.test(svg) && /<path/.test(svg));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
