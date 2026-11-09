/* application_form.js — ใบสมัครฝากดูแลเด็กก่อนเข้าเรียน, FILLED IN, drawn on the admin's own device as A4 PDF.
 * ===============================================================================================
 * Asked 2026-11-09 by the ผอ.: "เปิดเอกสารแล้วปริ้นได้ ออกมาเป็นรูปแบบใบสมัครที่เราสร้างวันนี้" — and
 * chose ก.: built here, every time, from what the family actually entered. NOTHING IS UPLOADED OR KEPT —
 * the same rule as the receipt, the certificate and the report card. The PDF writer is report_card.js's.
 *
 * WHAT is printed comes from the engine (applicationDocument in webapp/engine.js): the answers, the
 * consent rows, the consent text and its version. The signature is the PRIVATE file (applicationDocFile)
 * passed in as a data URL. This file only lays it out, section by section in the order of the school's
 * own form (1 child · 2 parents · 3 collectors · 4 health · 5 documents · 6 declaration · 7 PDPA).
 *
 * A4 portrait at 150 dpi = 1240 × 1754 px. Positions are in MILLIMETRES (mm()), so the layout reads like
 * the paper it becomes. Text flows down the page and a new page starts when it runs out of room.
 */
(function () {
  'use strict';
  var W = 1240, H = 1754, K = W / 210;
  var mm = function (v) { return v * K; };
  var pt = function (v) { return v * 0.3528 * K; };
  var INK = '#1f2937', MUTE = '#6b7280', LINE = '#d9dee7', BRAND = '#1565C0', BAD = '#b42318', SOFT = '#eef4fb';
  var FONT = '"Sarabun", "Noto Sans Thai", "Leelawadee UI", Tahoma, sans-serif';
  var font = function (size, weight) { return (weight || 400) + ' ' + pt(size).toFixed(1) + 'px ' + FONT; };
  var L0 = 14, R0 = 196, TOP = 14, BOTTOM = 280;

  var TH_M = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  var EN_M = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function dateTxt(s, en) { var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(String(s || '')); if (!m) return '–';
    return en ? (+m[3]) + ' ' + EN_M[+m[2] - 1] + ' ' + m[1] + (m[4] ? ' ' + m[4] : '')
      : (+m[3]) + ' ' + TH_M[+m[2] - 1] + ' ' + (+m[1] + 543) + (m[4] ? ' เวลา ' + m[4] + ' น.' : ''); }
  function loadImg(src) { return new Promise(function (res) { if (!src) return res(null);
    var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { res(null); }; i.src = src; }); }
  function fontsReady() {
    if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return Promise.resolve();
    var want = ['400 20px Sarabun', '600 20px Sarabun', '700 20px Sarabun'].map(function (f) { return document.fonts.load(f, 'กขค').catch(function () {}); });
    return Promise.race([Promise.all(want), new Promise(function (r) { setTimeout(r, 3000); })]); }

  // ---- a page that knows where it is up to -------------------------------------------------------
  function Doc(opts) { this.pages = []; this.opts = opts; this.newPage(); }
  Doc.prototype.newPage = function () {
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var c = cv.getContext('2d'); c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H); c.textBaseline = 'alphabetic';
    this.pages.push(cv); this.c = c; this.y = TOP;
    if (this.pages.length > 1) { this.text(this.opts.runHead, L0, this.y + 4, { size: 8, color: MUTE }); this.y += 9; }
  };
  Doc.prototype.need = function (h) { if (this.y + h > BOTTOM) this.newPage(); };
  Doc.prototype.text = function (s, x, y, o) { o = o || {}; var c = this.c;
    c.font = font(o.size || 10, o.weight); c.fillStyle = o.color || INK; c.textAlign = o.align || 'left';
    c.fillText(String(s == null ? '' : s), mm(x), mm(y)); c.textAlign = 'left'; };
  // wrap a run of text inside [x, x+w] mm; returns the height used (mm)
  Doc.prototype.wrap = function (s, x, w, o) { o = o || {}; var c = this.c, self = this; c.font = font(o.size || 10, o.weight);
    var lh = o.lh || (o.size || 10) * 0.5, lines = [], max = mm(w);
    String(s == null ? '' : s).split('\n').forEach(function (para) {
      // Thai has no spaces between words: break on spaces where there are some, otherwise by character
      var tokens = para.indexOf(' ') >= 0 ? para.split(/(\s+)/) : para.split('');
      var cur = '';
      tokens.forEach(function (t) {
        var next = cur + t;
        if (c.measureText(next).width > max && cur) {
          if (c.measureText(t).width > max) { t.split('').forEach(function (ch) { if (c.measureText(cur + ch).width > max) { lines.push(cur); cur = ch; } else cur += ch; }); }
          else { lines.push(cur.replace(/\s+$/, '')); cur = t.replace(/^\s+/, ''); }
        } else cur = next;
      });
      lines.push(cur);
    });
    lines.forEach(function (ln) { self.need(lh + 1); self.text(ln, x, self.y + lh * 0.8, o); self.y += lh; });
    return lines.length * lh; };
  Doc.prototype.rule = function (y) { var c = this.c; c.strokeStyle = LINE; c.lineWidth = 2; c.beginPath(); c.moveTo(mm(L0), mm(y)); c.lineTo(mm(R0), mm(y)); c.stroke(); };
  Doc.prototype.box = function (x, y, on) { var c = this.c, s = mm(3.4); c.strokeStyle = INK; c.lineWidth = 2; c.strokeRect(mm(x), mm(y) - s + mm(0.6), s, s);
    if (on) { c.strokeStyle = BRAND; c.lineWidth = 4; c.beginPath(); c.moveTo(mm(x + 0.6), mm(y - 1.2)); c.lineTo(mm(x + 1.5), mm(y)); c.lineTo(mm(x + 3), mm(y - 2.8)); c.stroke(); } };
  Doc.prototype.section = function (n, title) { this.need(16); this.y += 3;
    var c = this.c; c.fillStyle = SOFT; c.fillRect(mm(L0), mm(this.y), mm(R0 - L0), mm(8));
    c.fillStyle = BRAND; c.fillRect(mm(L0), mm(this.y), mm(9), mm(8));
    this.text(n, L0 + 4.5, this.y + 5.8, { size: 11, weight: 700, color: '#ffffff', align: 'center' });
    this.text(title, L0 + 12, this.y + 5.8, { size: 11, weight: 700, color: BRAND });
    this.y += 11; };
  // a row of label: value pairs across the page, each in its own column
  Doc.prototype.fields = function (pairs, cols) { var self = this; cols = cols || 2; var cw = (R0 - L0) / cols;
    for (var i = 0; i < pairs.length; i += cols) {
      self.need(8); var row = pairs.slice(i, i + cols), h = 0;
      row.forEach(function (p, j) { var x = L0 + j * cw; var y0 = self.y;
        self.text(p[0], x, y0 + 3.6, { size: 8, color: MUTE });
        self.y = y0 + 4.2; var used = self.wrap(p[1] == null || p[1] === '' ? '–' : p[1], x, cw - 3, { size: 10, weight: 600 });
        h = Math.max(h, 4.2 + used); self.y = y0; });
      self.y += h + 1.6;
    } };

  function draw(d, opts) {
    var en = opts.lang === 'en', T = function (th, e) { return en ? e : th; };
    var data = d.data || {}, ch = data.child || {}, fa = data.father || {}, mo = data.mother || {}, he = data.health || {}, wish = data.wish || {};
    var S = d.school || {}, txt = (d.text && (en ? d.text.en : d.text.th)) || {};
    var cons = {}; (d.consents || []).forEach(function (c) { cons[c.item] = c; });
    var yes = function (k) { return cons[k] && cons[k].value === 'YES'; };
    var doc = new Doc({ runHead: (S.DocSchoolName || 'Atom Nursery') + ' · ' + T('ใบสมัคร', 'Application') + ' ' + d.appId + ' · ' + (d.childName || '') });
    var addr = function (a) { a = a || {}; return [a.no && T('เลขที่ ', 'No. ') + a.no, a.village, a.soi && T('ซ.', 'Soi ') + a.soi, a.road && T('ถ.', 'Rd. ') + a.road,
      a.subdistrict, a.district, a.province, a.postcode].filter(Boolean).join(' '); };
    var lbl = { cup: T('แก้ว', 'cup'), bottle: T('ขวดนม', 'milk bottle'), water: T('ขวดน้ำดื่ม', 'water bottle'), habit: T('ฝึกเป็นนิสัยแล้ว', 'already a habit'),
      started: T('เพิ่งเริ่มฝึก', 'just started'), yes: T('ได้', 'yes'), no: T('ไม่ได้', 'no'), often: T('บ่อย ๆ', 'often'), sometimes: T('บางครั้ง', 'sometimes'),
      never: T('ไม่เคย', 'never'), '?': T('ไม่ทราบ', 'unknown'), '+': T('บวก (+)', 'positive (+)'), '-': T('ลบ (−)', 'negative (−)') };
    var v = function (x) { return Array.isArray(x) ? x.map(function (y) { return lbl[y] || y; }).join(', ') : (lbl[x] || x); };

    // ---- header ----
    var c = doc.c;
    if (opts.logo) { try { c.drawImage(opts.logo, mm(L0), mm(TOP), mm(22), mm(22) * opts.logo.height / opts.logo.width); } catch (e) {} }
    doc.text(S.DocSchoolName || 'Atom Nursery', L0 + 26, TOP + 6, { size: 13, weight: 700, color: BRAND });
    doc.text([S.DocAddress1, S.DocAddress2].filter(Boolean).join(' '), L0 + 26, TOP + 11, { size: 8, color: MUTE });
    doc.text(S.DocPhone ? T('โทร ', 'Tel. ') + S.DocPhone : '', L0 + 26, TOP + 15, { size: 8, color: MUTE });
    doc.text(T('ใบสมัครฝากดูแลเด็กก่อนเข้าเรียน', 'Childcare Application Form'), L0 + 26, TOP + 23, { size: 15, weight: 700 });
    // the child's photo, where the paper form has its 1-inch box
    c.strokeStyle = LINE; c.lineWidth = 2; c.strokeRect(mm(R0 - 25), mm(TOP), mm(25), mm(30));
    if (opts.photo) { try { var ph = opts.photo, r = Math.min(mm(25) / ph.width, mm(30) / ph.height);
      c.drawImage(ph, mm(R0 - 25) + (mm(25) - ph.width * r) / 2, mm(TOP) + (mm(30) - ph.height * r) / 2, ph.width * r, ph.height * r); } catch (e) {} }
    else doc.text(T('รูปถ่าย 1 นิ้ว', 'Photo'), R0 - 12.5, TOP + 16, { size: 8, color: MUTE, align: 'center' });
    doc.y = TOP + 33;
    doc.fields([[T('เลขที่ใบสมัคร', 'Application no.'), d.appId], [T('ส่งเมื่อ', 'Submitted'), dateTxt(d.submittedAtRaw || d.submittedAt, en)],
      [T('วันที่ต้องการเริ่มเรียน', 'Preferred start date'), wish.startDate ? dateTxt(wish.startDate, en) : ''], [T('เวลารับกลับโดยประมาณ', 'Pick-up time'), wish.pickupTime || '']], 2);

    // ---- 1 child ----
    doc.section('1', T('ข้อมูลเกี่ยวกับเด็ก', 'Child Information'));
    doc.fields([[T('ชื่อ-นามสกุล', 'Full name'), (/^(ด.ช.|ด.ญ.|เด็กชาย|เด็กหญิง)/.test(String(d.childName || '').trim()) ? '' : d.gender === 'M' ? T('ด.ช. ', 'Master ') : d.gender === 'F' ? T('ด.ญ. ', 'Miss ') : '') + (d.childName || '')],
      [T('ชื่อ-นามสกุล (อังกฤษ)', 'Name in English'), d.childNameEN], [T('ชื่อเล่น', 'Nickname'), [d.nick, d.nickEN].filter(Boolean).join(' / ')],
      [T('วันเกิด', 'Date of birth'), dateTxt(d.dob, en)],
      [d.idType === 'PASSPORT' ? T('เลขหนังสือเดินทาง', 'Passport no.') : T('เลขบัตรประชาชน', 'National ID'), d.idType === 'PASSPORT' ? d.passport : d.nationalId],
      [T('น้ำหนัก / ส่วนสูง', 'Weight / height'), (ch.weight ? ch.weight + T(' กก.', ' kg') : '–') + ' / ' + (ch.height ? ch.height + T(' ซม.', ' cm') : '–')],
      [T('เชื้อชาติ', 'Race'), ch.race], [T('สัญชาติ', 'Nationality'), ch.nationality], [T('ศาสนา', 'Religion'), ch.religion], [T('โทรศัพท์บ้าน', 'Home phone'), ch.homePhone]], 2);
    doc.fields([[T('ที่อยู่ปัจจุบัน', 'Current address'), addr(ch.address)]], 1);

    // ---- 2 parents ----
    doc.section('2', T('ข้อมูลเกี่ยวกับผู้ปกครอง', 'Parents / Guardians'));
    [[T('บิดา', 'Father'), fa], [T('มารดา', 'Mother'), mo]].forEach(function (pp) { var p = pp[1];
      doc.fields([[pp[0], p.name], [T('ชื่อเล่น · อายุ', 'Nickname · age'), [p.nick, p.age ? p.age + T(' ปี', ' yrs') : ''].filter(Boolean).join(' · ')],
        [T('อาชีพ', 'Occupation'), p.occupation], [T('สถานที่ทำงาน', 'Workplace'), p.workplace],
        [T('โทรศัพท์ที่ทำงาน', 'Work phone'), p.workPhone], [T('โทรศัพท์มือถือ', 'Mobile'), p.mobile]], 2); });
    var reg = data.regAddress || {};
    doc.fields([[T('ที่อยู่ตามทะเบียนบ้าน', 'House registration address'), reg.same === 'no' ? addr(reg) : T('ตรงกับที่อยู่ปัจจุบัน', 'Same as current address')]], 1);

    // ---- 3 collectors ----
    doc.section('3', T('ผู้ที่สามารถมารับเด็กแทนบิดา/มารดาได้', 'Persons Authorised to Collect the Child'));
    var pk = (data.pickups || []).filter(function (x) { return x && x.name; });
    if (!pk.length) doc.fields([[T('ผู้รับแทน', 'Collectors'), T('ไม่ได้ระบุ', 'none given')]], 1);
    pk.forEach(function (x, i) { doc.fields([[(i + 1) + '. ' + T('ชื่อ-สกุล', 'Full name'), x.name], [T('เกี่ยวข้องเป็น · โทรศัพท์', 'Relation · phone'), [x.relation, x.phone].filter(Boolean).join(' · ')]], 2); });

    // ---- 4 health ----
    doc.section('4', T('ประวัติสุขภาพ', 'Health History'));
    doc.fields([[T('เริ่มเดิน (เดือน)', 'Walking at (months)'), he.walkAt], [T('เริ่มพูด (เดือน)', 'Talking at (months)'), he.talkAt],
      [T('เริ่มฝึกขับถ่าย (เดือน) · วันละ', 'Toilet training at · per day'), [he.toiletAt, he.toiletPerDay && he.toiletPerDay + T(' ครั้ง', ' times')].filter(Boolean).join(' · ')],
      [T('การฝึกขับถ่าย', 'Toilet training'), v(he.toiletHabit)], [T('คำบอกอุจจาระ / ปัสสาวะ', 'Words for poo / pee'), [he.wordPoo, he.wordPee].filter(Boolean).join(' / ')],
      [T('ทานอาหารเองได้', 'Feeds self'), v(he.selfFeed)], [T('อาหาร เช้า / กลางวัน / เย็น', 'Breakfast / lunch / dinner'), [he.breakfast, he.lunch, he.dinner].filter(Boolean).join(' / ')],
      [T('อาหารว่าง · ไม่ชอบ', 'Snacks · dislikes'), [he.snack, he.dislikes].filter(Boolean).join(' · ')], [T('ดื่มน้ำจาก', 'Drinks from'), v(he.drinkFrom || [])],
      [T('ของเล่นก่อนนอน / ที่ชอบ', 'Bedtime / favourite toy'), [he.toyBed, he.toyFav].filter(Boolean).join(' / ')], [T('เล่นกับกลุ่มเพื่อน', 'Group play'), v(he.peerPlay)],
      [T('รายการทีวี ชอบ / กลัว', 'TV likes / fears'), [he.tvLike, he.tvFear].filter(Boolean).join(' / ')]], 2);
    if (yes('health')) {
      doc.fields([[T('หมู่โลหิต · Rh', 'Blood group · Rh'), [v(he.blood), v(he.rh)].filter(Boolean).join(' · ')], [T('ยาประจำตัว', 'Regular medication'), he.medication],
        [T('โรคติดเชื้อ', 'Infectious diseases'), he.infect], [T('แพ้ (ยา อาหาร พืช สัตว์ ฯลฯ)', 'Allergies'), he.allergy], [T('โรคประจำตัวอื่น ๆ', 'Other chronic conditions'), he.chronic]], 2);
    } else {
      doc.need(8); doc.text(T('ผู้ปกครองไม่ยินยอมข้อ 7.3-1 — ระบบไม่เก็บหมู่โลหิต อาการแพ้ ประวัติการเจ็บป่วย และยาประจำตัว',
        'The family declined item 7.3-1 — blood group, allergies, illness and medication are not recorded.'), L0, doc.y + 4, { size: 9, color: BAD }); doc.y += 7;
    }

    // ---- 5 documents ----
    doc.section('5', T('เอกสารประกอบ', 'Supporting Documents'));
    var have = {}; (d.docs || []).forEach(function (x) { have[x.type] = 1; });
    var dl = [['birth', 'สูติบัตร', 'Birth certificate'], ['parentId', 'สำเนาบัตรประชาชนบิดา-มารดา', 'Copies of the parents’ ID cards'], ['vaccine', 'สำเนาสมุดวัคซีนของเด็ก', 'Copy of the vaccination record'],
      ['house', 'สำเนาทะเบียนบ้าน บิดา-มารดา และเด็ก', 'Copies of the house registration'], ['photos', 'รูปถ่ายเด็ก และบิดา-มารดา/ผู้ปกครอง', 'Photos of the child and parents']];
    var dWay = data.docs || {};
    dl.forEach(function (x) { doc.need(7); doc.box(L0, doc.y + 4.2, !!have[x[0]]);
      var how = have[x[0]] ? T('แนบในระบบแล้ว', 'attached in the system') : dWay[x[0]] === 'visit' ? T('นำมาวันเยี่ยมชม', 'brought on the visit day') : dWay[x[0]] === 'later' ? T('ส่งภายหลัง', 'to follow') : dWay[x[0]] === 'app' ? T('จะแนบในแอป', 'to attach in the app') : '';
      doc.text(T(x[1], x[2]) + (how ? '  — ' + how : ''), L0 + 6, doc.y + 4, { size: 10 }); doc.y += 6.5; });

    // ---- 6 declaration ----
    doc.section('6', T('คำรับรอง', 'Declaration'));
    var truth = cons.truth && cons.truth.value === 'YES';
    doc.need(8); doc.box(L0, doc.y + 4.2, truth); doc.y += 0; var keepY = doc.y;
    doc.wrap(txt.truth || '', L0 + 6, R0 - L0 - 6, { size: 10 }); doc.y = Math.max(doc.y, keepY + 6) + 2;
    signBlock(doc, d, opts, T, en);

    // ---- 7 PDPA ----
    doc.section('7', T('การคุ้มครองข้อมูลส่วนบุคคล (PDPA)', 'Personal Data Protection (PDPA)'));
    if (en) { doc.wrap('This English version is provided for convenience. If it differs from the Thai version, the Thai version prevails.', L0, R0 - L0, { size: 8, color: MUTE }); doc.y += 1; }
    doc.need(8); doc.box(L0, doc.y + 4.2, cons.pdpa && cons.pdpa.value === 'YES');
    doc.text(T('7.1–7.2 ข้าพเจ้าได้อ่านและยินยอม', '7.1–7.2 I have read and consent'), L0 + 6, doc.y + 4, { size: 10, weight: 700 }); doc.y += 7;
    (txt.pdpa || []).forEach(function (p) { doc.wrap(p, L0, R0 - L0, { size: 8.6 }); doc.y += 0.8; });
    doc.y += 2; doc.need(10); doc.text(T('7.3 การขอความยินยอมแยกต่างหาก', '7.3 Separate consent'), L0, doc.y + 4, { size: 10, weight: 700 }); doc.y += 6;
    doc.wrap(txt.itemsIntro || '', L0, R0 - L0, { size: 8.6 }); doc.y += 1;
    ['health', 'daily', 'photoJournal', 'photoPublic'].forEach(function (k, i) {
      var y0 = doc.y; doc.need(14);
      doc.wrap((i + 1) + '. ' + ((txt.items || {})[k] || ''), L0, R0 - L0 - 58, { size: 9 });
      var yb = (doc.y < y0 ? TOP + 9 : y0) + 4.2;   // a page break inside the item restarts at the top
      doc.box(R0 - 54, yb, yes(k)); doc.text(T('ยินยอม', 'I consent'), R0 - 49, yb, { size: 9 });
      doc.box(R0 - 26, yb, cons[k] && cons[k].value === 'NO'); doc.text(T('ไม่ยินยอม', 'I do not'), R0 - 21, yb, { size: 9 });
      doc.y += 1.5; });
    doc.y += 1; doc.wrap(txt.withdraw || '', L0, R0 - L0, { size: 8.6 }); doc.y += 1;
    doc.wrap(txt.final || '', L0, R0 - L0, { size: 8.6, weight: 600 }); doc.y += 2;
    signBlock(doc, d, opts, T, en);

    // ---- for school use ----
    doc.need(26); doc.y += 3; doc.rule(doc.y); doc.y += 2;
    doc.text(T('สำหรับเจ้าหน้าที่', 'For school use only'), L0, doc.y + 4, { size: 9, weight: 700, color: MUTE }); doc.y += 6;
    var st = { SUBMITTED: T('รอพิจารณา', 'under review'), VISIT: T('นัดเยี่ยมชมแล้ว', 'visit booked'), ACCEPTED: T('รับเข้าแล้ว', 'accepted'), REJECTED: T('ไม่รับ', 'not accepted'), WITHDRAWN: T('ยกเลิก', 'withdrawn') }[d.status] || d.status;
    doc.fields([[T('สถานะ', 'Status'), st], [T('ชั้นเรียน · วันเริ่มเรียน', 'Class · first day'), [d.className, d.startDate && dateTxt(d.startDate, en)].filter(Boolean).join(' · ')],
      [T('เอกสาร', 'Documents'), d.docsStatus === 'COMPLETE' ? T('ครบ', 'complete') : T('ยังค้าง', 'pending')], [T('รหัสนักเรียน', 'Student ID'), d.studentId]], 2);

    // ---- footer on every page ----
    var n = doc.pages.length;
    doc.pages.forEach(function (cv, i) { var cc = cv.getContext('2d'); cc.font = font(7.4); cc.fillStyle = MUTE; cc.textAlign = 'left';
      cc.fillText(T('พิมพ์จากข้อมูลที่ผู้ปกครองยืนยันผ่านระบบ · ', 'Printed from what the family confirmed in the system · ') + d.appId + ' · ' + (d.consentVersion || ''), mm(L0), mm(290));
      cc.textAlign = 'right'; cc.fillText(T('หน้า ', 'Page ') + (i + 1) + '/' + n, mm(R0), mm(290)); cc.textAlign = 'left'; });
    return doc.pages;
  }
  // the signature as the system holds it: the typed name, the finger signature if any, when, and how
  function signBlock(doc, d, opts, T, en) {
    doc.need(30); var y = doc.y, x = R0 - 80;
    if (opts.sig) { try { var s = opts.sig, r = Math.min(mm(60) / s.width, mm(16) / s.height); doc.c.drawImage(s, mm(x + 10), mm(y), s.width * r, s.height * r); } catch (e) {} }
    doc.c.strokeStyle = INK; doc.c.lineWidth = 2; doc.c.beginPath(); doc.c.moveTo(mm(x), mm(y + 17)); doc.c.lineTo(mm(R0), mm(y + 17)); doc.c.stroke();
    doc.text('( ' + (d.signName || '') + ' )', x + 40, y + 21.5, { size: 10, align: 'center' });
    doc.text(T('บิดา / มารดา / ผู้ปกครอง', 'Father / Mother / Guardian'), x + 40, y + 25.5, { size: 8.5, color: MUTE, align: 'center' });
    var at = (d.consents || []).filter(function (c) { return c.item === 'truth' || c.item === 'pdpa'; })[0];
    doc.text(T('ยืนยันผ่านระบบด้วยบัญชี LINE เมื่อ ', 'Confirmed in the app with LINE on ') + dateTxt((at && at.at) || d.submittedAtRaw, en), L0, y + 21.5, { size: 8.5, color: MUTE });
    doc.text(T('ฉบับข้อความความยินยอม ', 'Consent text version ') + (d.consentVersion || '–'), L0, y + 25.5, { size: 8.5, color: MUTE });
    doc.y = y + 29;
  }

  function render(d, opts) {
    opts = opts || {};
    return Promise.all([fontsReady(), loadImg(opts.logo), loadImg(opts.sig), loadImg(d.photo || '')]).then(function (r) {
      var pages = draw(d, { lang: opts.lang, logo: r[1], sig: r[2], photo: r[3] });
      return { pages: pages.map(function (cv) { return { dataUrl: cv.toDataURL('image/jpeg', 0.92), width: W, height: H }; }) };
    });
  }
  function fileName(d) { return 'ใบสมัคร_' + String(d.appId || '') + '_' + String(d.childName || '').replace(/[\\/:*?"<>|\s]+/g, '_') + '.pdf'; }
  // same hand-over as the receipt: the share sheet where a phone cannot just download
  function save(d, r) {
    var k = window.AtomReportCard;
    var bytes = k.buildPdf(r.pages.map(function (p) { return { bytes: k.b64ToBytes(p.dataUrl.split(',')[1]), w: p.width, h: p.height }; }));
    var name = fileName(d), ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '', file = null;
    try { file = new File([bytes], name, { type: 'application/pdf' }); } catch (e) {}
    if (file && /iPhone|iPad|iPod|Line\//i.test(ua) && navigator.canShare && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], title: name }).then(function () { return { shared: true, name: name }; },
        function (e) { if (e && e.name === 'AbortError') return { cancelled: true, name: name }; k.download(bytes, name, 'application/pdf'); return { name: name }; });
    }
    k.download(bytes, name, 'application/pdf');
    return Promise.resolve({ name: name });
  }
  window.AtomAppForm = { render: render, save: save, fileName: fileName };
})();
