/* xlsx_min.js — tiny, dependency-free .xlsx writer (works offline).
   Builds a store-only (uncompressed) ZIP of minimal Office-Open-XML parts with
   inline strings, so a single worksheet can be downloaded as a real .xlsx.
   Used by Admin "Export student". GAS deployment will instead use native APIs.
   API: window.XLSXMin.download(filename, rows[, sheetName])
        window.XLSXMin.blob(rows[, sheetName]) -> Blob
   rows = array of arrays; cells are strings or numbers. */
(function () {
  // ---- CRC32 ----
  var CRC = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
  function crc32(buf) { var c = 0xFFFFFFFF; for (var i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  function utf8(str) {
    var s = unescape(encodeURIComponent(str)), a = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function colName(n) { var s = ''; n++; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26 | 0; } return s; }

  function sheetXml(rows, sheetName) {
    var body = '';
    rows.forEach(function (row, r) {
      var cells = '';
      row.forEach(function (v, c) {
        var ref = colName(c) + (r + 1);
        if (typeof v === 'number' && isFinite(v)) cells += '<c r="' + ref + '"><v>' + v + '</v></c>';
        else cells += '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
      });
      body += '<row r="' + (r + 1) + '">' + cells + '</row>';
    });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData>' + body + '</sheetData></worksheet>';
  }

  function parts(rows, sheetName) {
    sheetName = (sheetName || 'Sheet1').slice(0, 31);
    return [
      ['[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '</Types>'],
      ['_rels/.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'],
      ['xl/workbook.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="' + esc(sheetName) + '" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '</Relationships>'],
      ['xl/worksheets/sheet1.xml', sheetXml(rows, sheetName)]
    ];
  }

  // ---- store-only ZIP ----
  function zip(files) {
    var chunks = [], central = [], offset = 0;
    function u16(n) { return [n & 0xFF, (n >>> 8) & 0xFF]; }
    function u32(n) { return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]; }
    files.forEach(function (f) {
      var nameB = utf8(f[0]), data = utf8(f[1]), crc = crc32(data);
      var local = [].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0));
      chunks.push(new Uint8Array(local), nameB, data);
      central.push({ name: nameB, crc: crc, size: data.length, offset: offset });
      offset += local.length + nameB.length + data.length;
    });
    var cstart = offset, cdir = [];
    central.forEach(function (c) {
      var rec = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(c.crc), u32(c.size), u32(c.size), u16(c.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.offset));
      cdir.push(new Uint8Array(rec), c.name);
      offset += rec.length + c.name.length;
    });
    var end = [].concat(u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
      u32(offset - cstart), u32(cstart), u16(0));
    return new Blob(chunks.concat(cdir, [new Uint8Array(end)]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  window.XLSXMin = {
    blob: function (rows, sheetName) { return zip(parts(rows, sheetName)); },
    download: function (filename, rows, sheetName) {
      var url = URL.createObjectURL(zip(parts(rows, sheetName)));
      var a = document.createElement('a'); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    },
    // parse a previously exported .xlsx (inlineStr/number cells) back to rows[][]
    parse: function (file) {
      return file.arrayBuffer().then(function (buf) { return rowsFromXlsx(new Uint8Array(buf)); });
    }
  };

  // ---- minimal reader (store-only zip -> sheet1 inline strings/numbers) ----
  function rowsFromXlsx(bytes) {
    // find sheet1.xml in the store-only zip by scanning local file headers
    var dec = new TextDecoder('utf-8'), i = 0, target = null;
    function r16(o) { return bytes[o] | (bytes[o + 1] << 8); }
    function r32(o) { return (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0; }
    while (i + 4 <= bytes.length && r32(i) === 0x04034b50) {
      var nameLen = r16(i + 26), extra = r16(i + 28), size = r32(i + 18);
      var name = dec.decode(bytes.subarray(i + 30, i + 30 + nameLen));
      var dataStart = i + 30 + nameLen + extra;
      if (name === 'xl/worksheets/sheet1.xml') { target = dec.decode(bytes.subarray(dataStart, dataStart + size)); break; }
      i = dataStart + size;
    }
    if (!target) return [];
    var rows = [], rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g, m;
    while ((m = rowRe.exec(target))) {
      var cells = [], cRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g, cm;
      while ((cm = cRe.exec(m[1]))) {
        var attrs = cm[1], inner = cm[2];
        if (/t="inlineStr"/.test(attrs)) { var t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner); cells.push(t ? unesc(t[1]) : ''); }
        else { var v = /<v>([\s\S]*?)<\/v>/.exec(inner); cells.push(v ? +v[1] : ''); }
      }
      rows.push(cells);
    }
    return rows;
  }
  function unesc(s) { return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'); }
})();
