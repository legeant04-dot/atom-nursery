/**
 * Slips.gs — Salary Slip print (HTML, 3 slips per A4 landscape)
 * ------------------------------------------------------------------
 * Served via the Web App:  <exec-url>?view=slips&month=YYYY-MM[&staffId=STF-1]
 * Layout matches the Slip Form: รายได้ / รายการหัก / โอนเข้า SCB, with
 * เบี้ยขยัน & รายได้อื่นๆ footnotes. Print = 3 slips per A4 sheet
 * (landscape) with dashed cut lines between them.
 * ------------------------------------------------------------------
 */
function fmtBaht_(n) {
  var v = Number(n) || 0;
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

/** PAYROLL rows for a month (optionally one staff) joined with STAFF. */
function getPayrollForMonth_(month, staffId) {
  var staffById = {};
  readObjects_(sheet_(getHrSpreadsheet_(), 'STAFF')).forEach(function (s) { staffById[String(s.StaffID)] = s; });
  return readObjects_(sheet_(getHrSpreadsheet_(), 'PAYROLL'))
    // same 'YYYY-MM' date-coercion trap as Payroll.gs — compare the first 7 characters
    .filter(function (r) { return String(r.Month).slice(0, 7) === String(month).slice(0, 7) && (!staffId || String(r.StaffID) === String(staffId)); })
    .map(function (r) { r._staff = staffById[String(r.StaffID)] || {}; return r; });
}

/** One slip card. */
function slipCard_(p) {
  var s = p._staff || {};
  var school = esc_(getConfig_('SchoolName', 'อะตอม เนอสเซอรี่'));
  return '' +
  '<div class="slip">' +
    '<div class="hd">' +
      '<span class="conf">CONFIDENTIAL</span>' +
      '<span class="school">' + school + '</span>' +
      '<span class="period">งวด ' + esc_(p.Month) + '</span>' +
    '</div>' +
    '<div class="meta">' +
      '<span>ชื่อพนักงาน: <b>' + esc_(s.Name || p.StaffID) + '</b></span>' +
      '<span>รหัส: ' + esc_(p.StaffID) + '</span>' +
      '<span>ตำแหน่ง: ' + esc_(s.Position || '') + '</span>' +
      '<span>พิมพ์: ' + esc_(dateStr_(new Date())) + '</span>' +
    '</div>' +
    '<table class="grid"><thead><tr>' +
      '<th colspan="2">รายได้</th><th colspan="2">รายการหัก</th><th>โอนเข้าบัญชี ' + esc_(p.BankAccount || 'SCB') + '</th>' +
    '</tr></thead><tbody>' +
      '<tr>' +
        '<td>เงินเดือน</td><td class="n">' + fmtBaht_(p.BaseSalary) + '</td>' +
        '<td>ประกันสังคม</td><td class="n">' + fmtBaht_(p.SocialSecurity) + '</td>' +
        '<td rowspan="3" class="net">' + fmtBaht_(p.NetPay) + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td>เบี้ยขยัน<sup>1</sup></td><td class="n">' + fmtBaht_(p.DiligenceTotal) + '</td>' +
        '<td>เงินสมทบ</td><td class="n">' + fmtBaht_(p.Contribution) + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td>อื่นๆ<sup>2</sup></td><td class="n">' + fmtBaht_(p.OtherIncome) + '</td>' +
        '<td>อื่นๆ</td><td class="n">' + fmtBaht_(p.OtherDeductions) + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td>ค่าสวงเวลาตอนเย็น</td><td class="n">' + fmtBaht_(p.OTEvening) + '</td>' +
        '<td class="lbl">รวมหัก</td><td class="n">' + fmtBaht_(p.TotalDeductions) + '</td>' +
        '<td class="lbl">สุทธิ</td>' +
      '</tr>' +
      '<tr>' +
        '<td>เงินพิเศษวันพักผ่อนปี 68</td><td class="n">' + fmtBaht_(p.HolidayBonus) + '</td>' +
        '<td class="lbl">รวมรายได้</td><td class="n">' + fmtBaht_(p.GrossIncome) + '</td>' +
        '<td></td>' +
      '</tr>' +
    '</tbody></table>' +
    '<div class="fn"><sup>1</sup> มาทำงานครบ ไม่ลา ไม่สาย (500) + โพสต์รูป Facebook (500) &nbsp;&nbsp;' +
      '<sup>2</sup> เด็กคนที่ 31+ (300/คน) + ใบประกาศอบรม (100/ใบ, สูงสุด 2)</div>' +
  '</div>';
}

/** Full printable HTML for all matching slips, 3 per A4 landscape page. */
function buildSlipsHtml_(month, staffId) {
  var rows = getPayrollForMonth_(month, staffId);
  var body;
  if (!rows.length) {
    body = '<p style="font-family:sans-serif">ไม่พบสลิปเงินเดือนของงวด ' + esc_(month) + ' (รัน computePayroll ก่อน)</p>';
  } else {
    var pages = [];
    for (var i = 0; i < rows.length; i += 3) {
      pages.push('<div class="sheet">' + rows.slice(i, i + 3).map(slipCard_).join('<div class="cut"></div>') + '</div>');
    }
    body = pages.join('');
  }
  var css =
    '@page{size:A4 landscape;margin:6mm;}' +
    '*{box-sizing:border-box;}' +
    'body{font-family:"Sarabun","TH Sarabun New",sans-serif;margin:0;color:#111;}' +
    '.toolbar{padding:8px;text-align:center;background:#f0f0f0;}' +
    '.toolbar button{padding:6px 16px;font-size:14px;cursor:pointer;}' +
    '.sheet{width:285mm;height:198mm;display:flex;flex-direction:column;justify-content:space-between;page-break-after:always;padding:2mm;}' +
    '.slip{border:1px solid #1565C0;border-radius:4px;padding:4mm;height:62mm;overflow:hidden;}' +
    '.cut{border-top:1px dashed #999;margin:1mm 0;position:relative;}' +
    '.cut::before{content:"\\2702";position:absolute;left:4mm;top:-9px;color:#999;font-size:12px;}' +
    '.hd{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #1565C0;padding-bottom:2px;}' +
    '.conf{color:#c00;font-weight:bold;border:1px solid #c00;padding:0 4px;font-size:11px;}' +
    '.school{font-weight:bold;font-size:16px;}.period{font-size:12px;}' +
    '.meta{display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px;font-size:12px;margin:3px 0;}' +
    '.grid{width:100%;border-collapse:collapse;font-size:12px;}' +
    '.grid th,.grid td{border:1px solid #bbb;padding:2px 5px;}' +
    '.grid th{background:#1565C0;color:#fff;text-align:center;}' +
    '.grid td.n{text-align:right;font-variant-numeric:tabular-nums;}' +
    '.grid td.lbl{text-align:right;font-weight:bold;background:#f3f6fb;}' +
    '.grid td.net{text-align:center;font-size:18px;font-weight:bold;color:#1565C0;vertical-align:middle;}' +
    '.fn{font-size:10px;color:#555;margin-top:3px;}' +
    '@media print{.toolbar{display:none;}}';
  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<link href="https://fonts.googleapis.com/css2?family=Sarabun&display=swap" rel="stylesheet">' +
    '<style>' + css + '</style></head><body>' +
    '<div class="toolbar"><button onclick="window.print()">🖨️ พิมพ์ (3 สลิป/แผ่น A4)</button></div>' +
    body + '</body></html>';
}

/** Called from doGet when ?view=slips */
function serveSlips_(e) {
  var p = (e && e.parameter) || {};
  return HtmlService.createHtmlOutput(buildSlipsHtml_(p.month || monthOf_(new Date()), p.staffId))
    .setTitle('Salary Slips').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
