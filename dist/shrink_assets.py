"""One-off Phase-1 asset shrink.

Originals are copied to dist/assets_original/ (gitignored) so re-running never compounds the
loss. The authoritative originals are in git history: `git show d133896:webapp/assets/logo.png`.

Sizing rationale (largest place each image is actually drawn):
  logo.png          header 42px, login 132px, print ~34px  -> 320px wide is 2.4x the biggest use
  logo-icon.png     manifest icon, declared 192 AND 512     -> must stay 512
  logo-maskable.png manifest maskable, declared 512         -> must stay 512, must stay opaque (iOS)
  qr_*.png          QR modal 210px, zoom up to ~92vw        -> 900px long side keeps modules crisp
"""
import os
import shutil

from PIL import Image

SRC = "webapp/assets/"
BAK = "dist/assets_original/"
os.makedirs(BAK, exist_ok=True)

# The logos stay PNG: Safari only accepts PNG for apple-touch-icon, and PNG keeps the alpha
# channel the header needs. The QR posters are opaque photos, so they became JPEG instead —
# palette PNG left them at ~200KB while JPEG q88 hits 90KB at the same measured quality
# (PSNR ~50 dB against the original at the 210px the modal draws them).
JOBS = [
    # (file, max_long_side or None to keep, keep_alpha, out_ext or None to keep)
    ("logo.png", 320, True, None),
    ("logo-icon.png", 512, True, None),
    ("logo-maskable.png", 512, False, None),
    ("qr_scb.png", 1100, False, ".jpg"),
    ("qr_ktb.png", 1100, False, ".jpg"),
]


def shrink(name, long_side, keep_alpha, out_ext):
    src = SRC + name
    if not os.path.exists(BAK + name):
        shutil.copy2(src, BAK + name)
    before = os.path.getsize(BAK + name)  # always measure against the pristine original
    # always work from the pristine original so re-running never compounds the loss
    im = Image.open(BAK + name)
    w, h = im.size
    if long_side and max(w, h) > long_side:
        sc = long_side / max(w, h)
        im = im.resize((max(1, round(w * sc)), max(1, round(h * sc))), Image.LANCZOS)

    if out_ext == ".jpg":
        dst = SRC + os.path.splitext(name)[0] + ".jpg"
        im.convert("RGB").save(dst, "JPEG", quality=88, subsampling=0, optimize=True)
        if os.path.exists(src):
            os.remove(src)  # referenced as .jpg now (see mockdata.js QRCode_Monthly / QRCode_OT)
    else:
        dst = src
        if keep_alpha:
            # FASTOCTREE is the one Pillow quantizer that preserves the alpha channel
            out = im.convert("RGBA").quantize(colors=256, method=Image.FASTOCTREE)
        else:
            out = im.convert("RGB").quantize(colors=256, method=Image.MEDIANCUT)
        out.save(dst, "PNG", optimize=True)

    after = os.path.getsize(dst)
    print(
        f"{name:22s} {w}x{h} -> {im.size[0]}x{im.size[1]:<5} "
        f"{before/1024:8.1f} KB -> {after/1024:7.1f} KB  ({100 - after*100//before:.0f}% smaller)"
    )
    return before, after


tb = ta = 0
for name, ls, alpha, ext in JOBS:
    b, a = shrink(name, ls, alpha, ext)
    tb += b
    ta += a
print(f"\n{'TOTAL':22s} {tb/1024:29.1f} KB -> {ta/1024:7.1f} KB   saved {(tb-ta)/1024:.1f} KB")
