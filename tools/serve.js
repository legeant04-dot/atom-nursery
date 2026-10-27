/* Tiny static file server for the prototype. Usage: node tools/serve.js [port] [dir]
   dir defaults to webapp/ — pass dist_pages to check the minified build that CI publishes. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', process.argv[3] || process.env.SERVE_DIR || 'webapp');
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 8080;
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.jpg':'image/jpeg', '.png':'image/png', '.svg':'image/svg+xml', '.json':'application/json' };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, path.normalize(p).replace(/^(\.\.[\/\\])+/, ''));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    /* 🔴 no-store — ไม่ใช่การจูนความเร็ว แต่กันการวัดผิด
     *
     * เซิร์ฟเวอร์นี้ไม่เคยส่งหัว cache เลย เบราว์เซอร์จึงเดาเอง และ index.html เรียกไฟล์เป็น
     * app.js?v=473 ซึ่งไม่เปลี่ยนระหว่างที่เรากำลังแก้โค้ด → **โหลดใหม่ก็ยังได้ไฟล์เก่า**
     *
     * เรื่องนี้เคยทำให้สรุปผิดมาแล้วอย่างน้อยสองครั้ง (ปุ่ม Google ที่ "ยังขาวในโหมดมืด" ทั้งที่แก้
     * ไปแล้ว และกล่องอีเมลที่วัดได้ว่าสีไม่เปลี่ยน) — หน้าจอที่กำลังวัดอยู่ไม่ใช่โค้ดที่เพิ่งเขียน
     * คือความผิดพลาดที่ดูเหมือนบั๊กของโค้ดเป๊ะ ๆ และเสียเวลาไล่หาทุกครั้ง */
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store, must-revalidate' });
    res.end(data);
  });
}).listen(PORT, () => console.log('Atom Nursery prototype: http://localhost:' + PORT));
