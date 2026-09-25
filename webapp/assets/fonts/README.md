# THSarabunNew-Bold.ttf

**TH Sarabun New**, by Suppakit Chalermlarp — one of Thailand's thirteen national fonts
(ฟอนต์แห่งชาติ), commissioned by SIPA and the Department of Intellectual Property and released
for free public use, including commercial use and redistribution.

It is here because **naming a font in CSS cannot make it exist.** `webapp/certificate.js` spent
three versions asking for `"TH Sarabun New"` at the head of its font stack, which only ever reached
a machine that already had it installed — and most do not. Certificates were silently coming out in
Sarabun, the same designer's later redraw of the same design, which looks almost right and is not.

**Only `webapp/certificate.js` fetches it**, and that module is itself loaded on demand, so a parent
opening the app or a teacher taking a register never downloads it. An admin exporting certificates
pays for it once, and the browser caches it after that.

A school can upload its own font instead (ตั้งค่า → พื้นหลัง & ลายเซ็น → ไฟล์ฟอนต์), which
overrides this one — the next school on the platform may set its frame in something else.

Only the **Bold** weight is here: the certificate is set entirely in bold, so the other three
weights would be bytes nobody asks for.
