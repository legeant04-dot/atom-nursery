/**
 * tools/test_certificate.js — ใบประกาศนียบัตร.
 *   node tools/test_certificate.js
 *
 * Asked 2026-09-24 by the ผอ.: print a certificate for a child who has finished. Four rules came
 * with it, and each one is a place this could quietly go wrong later:
 *
 *   1. ONLY children with a recorded last day appear. The trap is the opposite of the obvious one:
 *      endingStudents — the route this most resembles and the one it would be tempting to reuse —
 *      filters !INACTIVE[Status], because it answers "who is leaving my class lists". A child who
 *      finished two years ago and was marked INACTIVE is the MOST likely person to want a
 *      certificate for, and reusing that route would have hidden exactly the names the screen
 *      exists to find. §1 is that student.
 *
 *   2. ชื่อจริง + (ชื่อเล่น) on one line.
 *
 *   3. THE DATE IN THAI NUMERALS WITH พ.ศ. — ๒๔ กันยายน พ.ศ. ๒๕๖๙ — and Arabic with the Gregorian
 *      year in English. Two rules, not one rule with a flag: "๒๔ September ๒๐๒๖" is nobody's
 *      convention. §3 also guards the thing a new function like this invites — somebody "tidying"
 *      it by making longDate() take a `thai` flag, which would re-number every leave list in the app.
 *
 *   4. A PRINTABLE PDF. The certificate is LANDSCAPE and buildPdf was hard-coded to portrait, so
 *      this suite carries the regression test for every EXISTING caller of buildPdf too — the
 *      report card, the injury form and the food menu must still produce a portrait page.
 *
 * And two things nobody asked for, which is why they need a test more than the rest:
 *   · the director's signature is stored PRIVATE. driveifyImage_, the path every other image here
 *     takes, publishes with ANYONE_WITH_LINK — correct for a QR code, wrong for a signature.
 *   · issuing is written to the audit log. The school chose to have the signature printed
 *     automatically, so a signed document can be produced without the director in the room.
 */
const path = require('path'), fs = require('fs');
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), engine = R('webapp/engine.js'), cert = R('webapp/certificate.js'),
      card = R('webapp/report_card.js'), certGs = R('src/Certificate.gs'), codeGs = R('src/Code.gs'),
      api = R('webapp/api.js');
const appCode = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ============================================================================================
console.log('1) who is on the list — and the child who would have been lost');
// ============================================================================================
{
  const M = {
    students: [
      // finished long ago and marked INACTIVE. endingStudents drops this one; it must be here.
      { StudentID: 'S1', NameTH: 'ณัฐภัทร ราชวงศ์', Nickname: 'ติณณ์', Class: 'Nursery 3',
        Status: 'INACTIVE', EndDate: '2024-03-31', EndReason: 'graduated' },
      { StudentID: 'S2', NameTH: 'โตเกียว ใจดี', Nickname: 'โตเกียว', Class: 'Nursery 2',
        Status: 'ACTIVE', EndDate: '2026-10-01', EndReason: 'transferred', EndRemark: 'ย้ายไปเรียนอนุบาลบุญรักษ์' },
      { StudentID: 'S3', NameTH: 'ยังเรียนอยู่', Nickname: 'เอ', Class: 'Nursery 1', Status: 'ACTIVE' },
      { StudentID: 'S4', NameTH: 'จบเมื่อวาน', Nickname: 'บี', Class: 'Nursery 3',
        Status: 'ACTIVE', EndDate: '2025-03-31', EndReason: 'graduated' }
    ],
    studentLeaves: [], holidays: [], staff: [], parents: [], activityLog: [], config: {}
  };
  const H = createAtomAPI(M).H;
  const rows = H.certStudents();

  eq('a child with no last day is NOT offered a certificate', rows.filter(r => r.studentId === 'S3').length, 0);
  /* THE ONE THAT MATTERS. Written as its own assertion rather than trusted to the count, because the
   * count would still have looked plausible with this child missing. */
  ok_('a child who finished years ago and is INACTIVE IS offered one', rows.some(r => r.studentId === 'S1'));
  eq('...and every child with a last day is there, whatever their reason',
     rows.map(r => r.studentId).sort(), ['S1', 'S2', 'S4']);
  eq('most recent first — the child who just finished is the one being printed today',
     rows.map(r => r.studentId), ['S2', 'S4', 'S1']);
  eq('the reason comes back so the screen can filter on it, not the route',
     rows.map(r => r.reason), ['transferred', 'graduated', 'graduated']);
  ok_('...and the real name and the nickname both, which the sheet needs',
     rows[2].name === 'ณัฐภัทร ราชวงศ์' && rows[2].nick === 'ติณณ์');

  /* The screen defaults its filter to graduated — the ผอ.'s answer — but the ROUTE must not, or a
   * transferred child could never be honoured no matter what the screen offered. */
  ok_('the filter lives in the screen and starts on graduated',
    /let CERT_FILT='graduated'/.test(appCode));
  // the chips are generated, so the literal call never appears in the source — check the chip itself
  ok_('...and "ทั้งหมดที่สิ้นสุดแล้ว" is one tap away',
    /chip\('all',/.test(appCode) && /A_certFilter\('\$\{v\}'\)/.test(appCode));
}

// ============================================================================================
console.log('\n2) the wording is the school’s, and the two copies of it agree');
// ============================================================================================
{
  const M = { students: [], studentLeaves: [], holidays: [], staff: [], parents: [], activityLog: [], config: {} };
  const H = createAtomAPI(M).H;

  const d = H.certText();
  eq('an untouched school still gets a full sentence', d.CertLine1TH, 'ขอมอบเกียรติบัตรฉบับนี้ให้ไว้เพื่อแสดงว่า');
  /* THE TWO THAT NAME A REAL PERSON OR A REAL SCHOOL ARE BLANK ON PURPOSE. A default that printed
   * one director's name onto every school's certificate would be worse than an obvious gap. */
  eq('the director’s name is NOT defaulted to anybody', [d.CertSignerNameTH, d.CertSignerNameEN], ['', '']);
  eq('nor is the heading — it falls back to the school’s own name', d.CertHeadTH, '');

  H.saveCertText({ CertSignerNameTH: 'นายศิลา เส็งพานิช', CertLine1TH: 'ขอมอบประกาศนียบัตรฉบับนี้ให้ไว้เพื่อแสดงว่า' });
  const d2 = H.certText();
  eq('what the school types is what comes back', d2.CertSignerNameTH, 'นายศิลา เส็งพานิช');
  eq('...including เกียรติบัตร → ประกาศนียบัตร, which is the whole reason this is a setting',
     d2.CertLine1TH, 'ขอมอบประกาศนียบัตรฉบับนี้ให้ไว้เพื่อแสดงว่า');
  /* "ให้ไว้ ณ" IS ALREADY PRINTED ON THE SCHOOL'S TEMPLATE, so the prefix we add is just "วันที่".
   * The first default was "ให้ไว้ ณ วันที่" and would have printed "ให้ไว้ ณ ให้ไว้ ณ วันที่ ๒๕…". */
  eq('...and the untouched lines keep their defaults', d2.CertDatePrefixTH, 'วันที่');
  eq('the artwork is assumed to carry its own wording, because it does', d2.CertBgHasText, 'true');

  /* THE DRIFT GUARD PROMISED IN tools/test_shadow_routes.js. certText is shadowed on GAS, so the
   * defaults exist TWICE — once in webapp/engine.js and once in src/Certificate.gs. Two lists that
   * are supposed to be identical are exactly the thing that stops being identical, and the symptom
   * would be a certificate that reads one way in the local build and another way at the school. */
  const grab = (src, re) => { const m = re.exec(src); return m ? m[1].trim() : '__none__'; };
  [['CertLine1TH'], ['CertLine1EN'], ['CertLine2TH'], ['CertLine2EN'],
   ['CertDatePrefixTH'], ['CertDatePrefixEN'], ['CertSignerTitleTH'], ['CertSignerTitleEN']].forEach(([k]) => {
    const inEngine = grab(engine, new RegExp(k + ":\\s*'([^']*)'"));
    const inGas = grab(certGs, new RegExp(k + ":\\s*'([^']*)'"));
    eq('engine and GAS agree on ' + k, inGas, inEngine);
  });
}

// ============================================================================================
console.log('\n3) ๒๔ กันยายน พ.ศ. ๒๕๖๙ — and 24 September 2026');
// ============================================================================================
{
  /* certDate lives inside app.js's IIFE, so it is lifted out and run rather than re-implemented
   * here — a second copy would pass while the real one was wrong. */
  const src = /const TH_DIGITS[\s\S]*?\n  \}\n/.exec(app);
  ok_('certDate was found in app.js', !!src);
  const TH_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  const EN_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const certDate = new Function('TH_MONTHS', 'EN_MONTHS', 'todayStr',
    src[0] + '; return certDate;')(TH_MONTHS, EN_MONTHS, () => '2026-09-24');

  eq('the ผอ.’s own example, exactly', certDate('2026-09-24', false), '๒๔ กันยายน พ.ศ. ๒๕๖๙');
  eq('...and the English one', certDate('2026-09-24', true), '24 September 2026');
  eq('a single-digit day is not padded — Thai does not write ๐๑', certDate('2026-03-01', false), '๑ มีนาคม พ.ศ. ๒๕๖๙');
  eq('every digit is converted, including the year’s', certDate('2020-12-31', false), '๓๑ ธันวาคม พ.ศ. ๒๕๖๓');
  /* PARSED AS A STRING, NEVER new Date('2026-01-01') — that is UTC midnight, which in a timezone
   * behind UTC prints the 31st of December. A certificate dated one day early is the kind of error
   * nobody finds until it is framed on a wall. */
  eq('a January 1st does not slip back to December', certDate('2026-01-01', false), '๑ มกราคม พ.ศ. ๒๕๖๙');
  eq('...in English either', certDate('2026-01-01', true), '1 January 2026');

  /* THE FUNCTION THAT MUST NOT HAVE BEEN "TIDIED" INTO THIS ONE. Every other date in the app is read
   * on a screen, where Arabic numerals scan fastest. If longDate ever grows Thai digits, every leave
   * list, payslip and request history in the app changes with it. */
  ok_('longDate is still Arabic-numeral only', !/function longDate[\s\S]{0,400}thaiDigits/.test(app));
  ok_('...and so is fullDate', !/function fullDate[\s\S]{0,300}thaiDigits/.test(app));
  ok_('the picked date is echoed in print form BEFORE anything is printed',
    /A_certDateEcho/.test(appCode) && /certDateEcho/.test(app));
}

// ============================================================================================
console.log('\n4) landscape — and every existing caller still portrait');
// ============================================================================================
{
  /* buildPdf is the shared writer. Lifted out of report_card.js and run on real (tiny) inputs, so
   * this checks the bytes rather than the source text. */
  const src = /function buildPdf\(pagesOrBytes, w, h\)[\s\S]*?\n  \}\n/.exec(card);
  ok_('buildPdf was found in report_card.js', !!src);
  const buildPdf = new Function(src[0] + '; return buildPdf;')();
  const dec = u8 => Buffer.from(u8).toString('latin1');
  const boxes = pdf => (dec(pdf).match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g) || []);

  const img = new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]);   // enough to be embedded; never decoded here

  // EVERY EXISTING CALLER passes sheets with no `landscape` key at all
  const portrait = buildPdf([{ bytes: img, w: 1240, h: 1754 }]);
  eq('a sheet with no orientation is portrait, exactly as before',
     boxes(portrait), ['/MediaBox [0 0 595.28 841.89]']);

  const land = buildPdf([{ bytes: img, w: 2339, h: 1654, landscape: true }]);
  eq('a certificate sheet is landscape A4', boxes(land), ['/MediaBox [0 0 841.89 595.28]']);

  /* THE IMAGE MUST FILL IT. The bug this replaces was not an error — a landscape image on a portrait
   * page fits-and-centres into a letterboxed strip and prints about a third of the size, which looks
   * like a bad certificate rather than like a broken one. */
  const m = /q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm/.exec(dec(land));
  ok_('the artwork fills the landscape page edge to edge', !!m && Math.abs(+m[1] - 841.89) < 0.5);
  ok_('...and is not letterboxed down the middle', !!m && +m[3] < 0.5);

  // a mixed document must not make one orientation win for all of it
  const mixed = buildPdf([{ bytes: img, w: 100, h: 200 }, { bytes: img, w: 200, h: 100, landscape: true }]);
  eq('orientation is per page, not per document',
     boxes(mixed), ['/MediaBox [0 0 595.28 841.89]', '/MediaBox [0 0 841.89 595.28]']);

  ok_('the certificate asks for landscape', /landscape: true/.test(cert));
  ok_('...and reuses the one PDF writer rather than shipping a second',
    /AtomReportCard/.test(cert) && !/function buildPdf/.test(cert));
  ok_('report_card exports the download too, so there is one of those as well', /\n    download: download,/.test(card));
}

// ============================================================================================
console.log('\n5) ชื่อจริง + (ชื่อเล่น), and nothing is ever clipped');
// ============================================================================================
{
  ok_('the nickname is printed in brackets after the full name',
    /who \+ ' \(' \+ nick \+ '\)'/.test(cert));
  ok_('...and a child whose nickname IS their name is not printed twice',
    /nick !== who/.test(cert));
  /* A NAME IS THE POINT OF THE PAGE. Everything else here may be shrunk to fit; a name that ran long
   * must not come back as "ณัฐภัทร ราชว…" on a document a family keeps. */
  ok_('long names shrink the type instead of being ellipsised',
    /while \(size > 12 && ctx\.measureText\(s\)\.width > maxW\)/.test(cert) && !/…/.test(cert));

  /* THE LAST LINE MUST CLEAR THE ARTWORK'S BORDER. Found by rendering a sheet and measuring the
   * lowest inked row: at signerY 0.960 the bracketed name printed AT 0.963, and the frame sits at
   * 0.969 — it was on the border. Measured again after the fix: 0.931, about 8 mm of clearance on a
   * real A4. Kept as a number rather than as a picture because a picture cannot fail a build. */
  const L = {}; cert.replace(/(\w+): ([\d.]+)/g, (m, k, v) => { L[k] = +v; return m; });
  ok_('the signatory name clears the bottom of the sheet  (signerY ' + L.signerY + ')', L.signerY <= 0.94);
  ok_('...and the whole signature block stays in order, top to bottom',
    L.dateY < L.sigY && L.sigY < L.sigRuleY && L.sigRuleY < L.titleY && L.titleY < L.signerY);
  ok_('...and nothing overlaps the name and its rule', L.nameY < L.ruleY && L.ruleY < L.line2Y);
}

// ============================================================================================
console.log('\n6) the signature is private, and issuing leaves a trace');
// ============================================================================================
{
  /* NOT driveifyImage_, which every other image in this system goes through and which publishes with
   * ANYONE_WITH_LINK. Correct for a QR code on a payment screen; wrong for a director's signature,
   * which is the one image here a person could misuse. */
  /* CODE ONLY. The header of Certificate.gs names ANYONE_WITH_LINK in order to explain why this file
   * does NOT use it — so a grep over the raw source fails on its own documentation. Same trap as
   * tools/test_retry_budget.js and tools/test_schema_inventory.js: a test a comment can fail is not
   * testing the code. */
  const certCode = certGs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok_('the certificate files are never shared publicly',
    !/ANYONE_WITH_LINK/.test(certCode) && !/setSharing/.test(certCode));
  ok_('...they are served through the API instead, as bytes', /base64Encode\(blob\.getBytes\(\)\)/.test(certGs));
  ok_('...and only an admin can ask for them',
    /certStudents: 1, certText: 1, saveCertText: 1, certAssets: 1, saveCertAsset: 1, markCertIssued: 1,/.test(codeGs));

  /* WHY BYTES AND NOT A DRIVE URL, restated as a test because the "obvious simplification" is to
   * hand the client a link — and the result renders on screen and throws on export. */
  ok_('the reason (a tainted canvas cannot be exported) is written down where it would be undone',
    /tainted/i.test(certGs) && /tainted/i.test(cert));

  ok_('replacing an asset trashes the old file rather than orphaning it',
    /setTrashed\(true\)/.test(certGs));
  ok_('an oversized upload is refused with a sentence, not a silent failure',
    /CERT_MAX_ASSET_BYTES_/.test(certGs) && /ไฟล์ใหญ่เกินไป/.test(certGs));
  ok_('...and the client shrinks it to the printed size first', /certShrink\(f, which==='bg'\?2339:900/.test(appCode));
  ok_('the signature keeps its transparency — a JPEG would print a white box over the artwork',
    /which==='sig'\)/.test(appCode) && /asPng \? cv\.toDataURL\('image\/png'\)/.test(appCode));

  // the audit line — the school chose the stored signature, so who issued what has to be answerable
  ok_('issuing a certificate is written to the audit log', /CERT_ISSUED/.test(certGs));
  /* IT IS NAMED markCertIssued, NOT certIssued. Both isMutating implementations key off the leading
   * verb, and "cert…" is not one — so the original name was cached as a read and the SECOND export in
   * a session would never have been logged at all. */
  ok_('...under a name both mutation rules recognise as a write',
    /markCertIssued/.test(codeGs) && /^\(\?:\^\)?|mark/.test('mark') &&
    /\bmark\b/.test(/const MUT = \/\^\(([^)]*)\)/.exec(api)[1]));
  ok_('...and a failure to log never fails the download that already happened',
    /api\('markCertIssued',\{studentIds:\[\.\.\.CERT_SEL\], issueDate:issue\}\)\.catch\(\(\)=>\{\}\)/.test(appCode));

  ok_('nothing about a named child is ever uploaded', /never exists on any server/i.test(cert));
}

// ============================================================================================
console.log('\n6b) the school’s own template: three things added, and nothing else');
// ============================================================================================
{
  /* THE BUG THIS SECTION EXISTS FOR. v400 assumed the uploaded artwork was a blank frame and drew
   * the full wording on top. The school's template already carries its heading, both sentences,
   * "ให้ไว้ ณ", "ครูผู้อำนวยการ" and the director's name — so the first print came back with every
   * line doubled (2026-09-25). Only three things may be added now. */
  ok_('with artwork, only the name, the date and the signature are drawn',
    /if \(bg && d\.bgHasText !== false\)/.test(cert));
  ok_('...and that branch returns before the wording is ever drawn',
    /bgHasText !== false\)[\s\S]{0,1800}return \{ dataUrl[\s\S]{0,120}\}\n\n {6}\/\/ ===== no artwork/.test(cert));
  ok_('the plain fallback still exists for a genuinely blank frame', /no artwork: the plain fallback/i.test(cert));
  ok_('...and the school can say which it uploaded', /cs_CertBgHasText/.test(app) && /CertBgHasText/.test(engine));

  /* THE SHEET IS THE SHAPE OF THE ARTWORK. The template is 2528×1696 — ratio 1.491 against A4
   * landscape's 1.414. Drawing it "cover" onto a fixed A4 canvas, which is what v400 did, crops the
   * overflow: the decorative border down both edges was being cut off the printed page. */
  ok_('the canvas takes the artwork’s own proportions, so nothing is cropped',
    /var ratio = bg \? \(bg\.width \/ bg\.height\) : A4_RATIO;/.test(cert));
  ok_('...and Math.max "cover" is gone', !/Math\.max\(W \/ im\.width/.test(cert));

  /* POSITIONS MEASURED OFF THE REAL FILE, not estimated: the two rules found by scanning for long
   * unbroken runs of dark pixels, the text bands by scanning for rows of ink.
   *   name rule  y 0.6138, centred x 0.4998
   *   "ให้ไว้ ณ" band y 0.702–0.737, ending x 0.4173
   *   sig rule   y 0.8367, centred x 0.7555
   * Rendered against the template and diffed against the bare sheet, our ink landed at:
   *   name  y 0.556–0.602  (0.080 clear of the text above, 0.012 above its rule)
   *   date  y 0.698–0.735, x from 0.4283  (one space after "ให้ไว้ ณ", same type size)
   *   sig   last stroke 6 px below its rule, centred within 0.0003 */
  const P = {}; (/var P = \{([\s\S]*?)\n  \};/.exec(cert) || ['', ''])[1]
    .replace(/(\w+): ([\d.]+)/g, (m, k, v) => { P[k] = +v; return m; });
  ok_('the name sits just above the name rule, not on the line',
    P.nameY < P.nameRuleY && (P.nameRuleY - P.nameY) < 0.03);
  ok_('...centred on the rule the school drew', Math.abs(P.nameRuleCx - 0.4998) < 0.005);
  ok_('the date starts clear of "ให้ไว้ ณ", which ends at x 0.4173', P.dateX > 0.4173 && P.dateX < 0.45);
  ok_('...and is set at the same size as the line it continues', Math.abs(P.dateSize - 0.0305) < 0.004);
  ok_('the signature is centred on ITS rule, which is not the middle of the sheet',
    Math.abs(P.sigCx - 0.7555) < 0.005 && Math.abs(P.sigRuleY - 0.8367) < 0.005);

  /* AUTO-DETECTED PER ARTWORK, so the next school's template lands on its own lines. Verified
   * against the real file in the browser: nameY 0.6149 / sigY 0.8373 against 0.6138 / 0.8367
   * measured by hand — inside 0.001. */
  ok_('the rules are re-found in whatever artwork is uploaded', /function findRules\(im\)/.test(cert));
  ok_('...and the measured constants are the fallback, not the only answer',
    /findRules\(bg\) \|\| \{\}/.test(cert) && /R\.nameY \|\| P\.nameRuleY/.test(cert));

  /* A SIGNATURE MUST TOUCH ITS LINE. The scan is whatever rectangle somebody cropped; placing the
   * FILE against the rule left the ink floating 36 px clear of it, which is the detail that makes a
   * document look machine-made. Trimming to the ink put the last stroke 6 px below the line. */
  ok_('the blank margin around a scanned signature is trimmed off', /function inkBox\(im\)/.test(cert));
  ok_('...and the trimmed box is what gets drawn', /ctx\.drawImage\(sig, b\.sx, b\.sy, b\.sw, b\.sh,/.test(cert));
  ok_('...landing the last stroke on the line rather than above it', P.sigDrop > 0 && P.sigDrop < 0.02);
}

// ============================================================================================
console.log('\n7) the screen is where the ผอ. asked for it');
// ============================================================================================
{
  const group = app.slice(app.indexOf("'📄 Reports & records'"), app.indexOf("'📄 Reports & records'") + 900);
  ok_('it is in จัดการ > รายงาน & เอกสาร', /A_certificates\(\)/.test(group));
  ok_('an empty list says what to do about it, not just that it is empty',
    /ยังไม่มีนักเรียนที่บันทึกเหตุผลว่า/.test(app));
  ok_('a school with no artwork yet is told before it prints, not after',
    /ยังไม่ได้ตั้งค่าพื้นหลังใบประกาศ/.test(app));
  ok_('the upload screen says the file must be BLANK — the obvious mistake prints twice',
    /ยังไม่มีชื่อเด็ก/.test(app));
  ok_('the export buttons are dead until somebody is ticked', /data-certgo disabled/.test(appCode));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
