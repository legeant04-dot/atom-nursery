/* Convert 25840 logo.jpg (black background) -> webapp/assets/logo.png (transparent). */
const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const src = path.join(__dirname, '..', '25840 logo.jpg');
const dst = path.join(__dirname, '..', 'webapp', 'assets', 'logo.png');

const raw = jpeg.decode(fs.readFileSync(src), { useTArray: true });
const TH = 48; // near-black threshold
function alpha(mx){ return mx <= TH ? 0 : (mx >= TH + 24 ? 255 : Math.round((mx - TH) / 24 * 255)); }

// downscale to ~256px (box average) — 812KB -> small, fixes heavy rendering
const TW = 256, TH2 = Math.round(raw.height / raw.width * TW);
const sx = raw.width / TW, sy = raw.height / TH2;
const png = new PNG({ width: TW, height: TH2 });
for (let y = 0; y < TH2; y++) for (let x = 0; x < TW; x++) {
  let r=0,g=0,b=0,n=0;
  const x0=Math.floor(x*sx),x1=Math.min(raw.width,Math.ceil((x+1)*sx));
  const y0=Math.floor(y*sy),y1=Math.min(raw.height,Math.ceil((y+1)*sy));
  for (let yy=y0; yy<y1; yy++) for (let xx=x0; xx<x1; xx++){ const i=(yy*raw.width+xx)*4; r+=raw.data[i];g+=raw.data[i+1];b+=raw.data[i+2];n++; }
  r=r/n; g=g/n; b=b/n; const o=(y*TW+x)*4;
  png.data[o]=r; png.data[o+1]=g; png.data[o+2]=b; png.data[o+3]=alpha(Math.max(r,g,b));
}
fs.writeFileSync(dst, PNG.sync.write(png));
console.log('Wrote', dst, TW + 'x' + TH2, fs.statSync(dst).size + ' bytes');
