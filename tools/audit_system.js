/**
 * tools/audit_system.js — ตัวตรวจระบบ. The auditor that hunts the bug CLASSES this project keeps
 * rediscovering, rather than the bugs it has already fixed.
 *
 *   node tools/audit_system.js                    ตรวจโค้ด (ทุกกฎ)
 *   node tools/audit_system.js --strict           ...และ exit 1 ถ้ามีข้อ 🔴
 *   node tools/audit_system.js --rule R1          ตรวจเฉพาะกฎเดียว
 *   node tools/audit_system.js --data "<export.xlsx>"   ตรวจข้อมูลของโรงเรียนหนึ่งโรง
 *   node tools/audit_system.js --json             ผลลัพธ์แบบเครื่องอ่าน (สำหรับ console ภายหลัง)
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 ทำไมต้องมีไฟล์นี้ ทั้งที่มีเทสต์ 185 ชุดแล้ว
 *
 * เทสต์ตอบคำถามว่า "โค้ดที่เขียนไว้ ยังทำงานเหมือนเดิมไหม" — ตอบได้ดีมาก และตอบได้เฉพาะเรื่องที่
 * เคยมีคนนึกถึงแล้วเท่านั้น ทุกบั๊กใหญ่ของโปรเจกต์นี้ในสองเดือนที่ผ่านมา ไม่ได้หลุดเพราะเทสต์ผิด
 * แต่หลุดเพราะ **ไม่มีใครรู้ว่าต้องเขียนเทสต์ข้อนั้น** — จนกระทั่งมันพังที่โรงเรียนจริง
 *
 * และทุกครั้ง มันคือ "รูปแบบ" เดิมในที่ใหม่ ไม่ใช่เรื่องใหม่:
 *
 *   ช่องวันที่จากชีตถูกเทียบแบบสตริง        → ด่าน 6 ด่านไม่เคยทำงานเลย (2026-10-20)
 *   route ที่บังหน้า engine แล้วตกกฎไปข้อหนึ่ง → เด็กที่จบแล้วยังลงเวลาได้ (ครั้งที่ 4)
 *   การเขียนข้อมูลที่ระบบไม่นับว่าเป็นการเขียน → เขียนโดยไม่มี write lock (backfillConfig)
 *   เส้นทางที่ไม่มีประตู                      → listParents คืนข้อมูลผู้ปกครองทั้งโรงเรียนให้ใครก็ได้
 *
 * ไฟล์นี้จึงไม่ได้ตรวจ "บั๊กที่แก้ไปแล้ว" — มันตรวจ **ที่ที่รูปแบบเดิมจะโผล่ครั้งต่อไป**
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🏫 และทำไมมันสำคัญกว่าเดิมมาก เมื่อเราดูแลหลายโรงเรียน
 *
 * วันนี้มีโรงเรียนเดียว ผอ. เป็นคนเจอบั๊กให้เรา — ท่านเปิดหน้าจอทุกวันและบอกเราได้ว่าอะไรผิด
 * พอมี 20 โรงเรียน **จะไม่มีใครทำหน้าที่นั้นอีกแล้ว** ความหลากหลายของข้อมูลจะมากขึ้น
 * (โรงเรียนที่ไม่มีรถรับส่ง · ที่จ่ายครูเป็นรายชั่วโมง · ที่เปิดเสาร์ · ที่ไม่ใช้ LINE)
 * และเงื่อนไขที่เราไม่เคยเจอจะกลายเป็นบั๊กที่ไม่มีใครรายงาน
 *
 * `--data` จึงมีไว้ตรวจ **ข้อมูลจริงของแต่ละโรงเรียน** จากไฟล์สำรองที่โรงเรียนกดเอง —
 * ไม่ต้องเข้าถึงระบบของเขา ไม่ต้องขอรหัสผ่าน และไม่มีข้อมูลส่วนบุคคลออกมาทางหน้าจอ
 *
 * 🔴 กฎข้อแรกของไฟล์นี้: **รายงานที่ร้องหมาป่า คือรายงานที่ไม่มีใครอ่าน** (บทเรียน 2026-10-15)
 * ทุกกฎต้องอธิบายได้ว่า "ถ้าไม่แก้ จะเกิดอะไรกับโรงเรียน" และต้องมี CONTROL ใน
 * tools/test_audit_rules.js ที่พิสูจน์ว่ามันจับของจริงได้ และไม่จับของที่ถูกอยู่แล้ว
 */
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..');
const R = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n'); } catch (e) { return ''; } };
const ARG = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const HAS = n => process.argv.indexOf(n) >= 0;

/* ── ที่ที่ผลลัพธ์ไปรวมกัน ────────────────────────────────────────────────────────────────────── */
const findings = [];
/** @param sev '🔴'|'⚠️'|'ℹ️' */
function add(rule, sev, title, where, why) { findings.push({ rule, sev, title, where, why }); }

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ส่วนที่ 1 — ตรวจโค้ด
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

const GS_FILES = fs.readdirSync(path.join(ROOT, 'src')).filter(f => /\.gs$/.test(f))
  // Engine.gs ถูกสร้างจาก webapp/engine.js และอ่านชีตผ่าน decodeCell_ แล้ว — GasEngine.gs คือชั้นที่แปลงเอง
  .filter(f => f !== 'Engine.gs' && f !== 'GasEngine.gs');

/* ── R1 · ช่องวันที่จากชีต ถูกเทียบแบบสตริง ──────────────────────────────────────────────────────
 *
 * เหตุการณ์จริง 2026-10-20: Sheets แปลง "2026-10-20" เป็น "ช่องวันที่" ตอนเขียน อ่านกลับมาเป็น
 * Date object และ String(...).slice(0,10) ได้ "Tue Oct 20" ซึ่งไม่ตรงกับอะไรเลย
 * ผลคือด่าน 6 ด่านไม่เคยทำงาน รวมถึง "ลาชั่วคราวแบบไม่รับเงินเดือน" ที่จ่ายเงินเดือนเต็ม
 *
 * 🔴 ด่านที่ไม่เคยทำงาน หน้าตาเหมือนด่านที่ผ่านทุกประการ — นี่คือเหตุผลที่กฎนี้เป็นข้อแรก */
const DATE_COLS = 'Date|StartDate|EndDate|EnrollDate|PauseFrom|PauseTo|IssueDate|PaidDate|WithdrawDate|CreatedDate|From|To';
function ruleR1() {
  GS_FILES.forEach(f => {
    R('src/' + f).split('\n').forEach((ln, i) => {
      if (/^\s*[*/]/.test(ln)) return;                               // บรรทัดคอมเมนต์
      if (/decodeCell_|ymdCell_/.test(ln)) return;                   // แปลงค่าแล้ว
      const re = new RegExp('String\\([^)]*\\.(?:' + DATE_COLS + ')[^)]*\\)[^;]*\\.slice\\(0,\\s*10\\)');
      if (re.test(ln)) {
        add('R1', '🔴', 'เทียบ/ตัดช่องวันที่จากชีตแบบสตริง — ต้องใช้ ymdCell_',
          'src/' + f + ':' + (i + 1),
          'ถ้าช่องนั้นเป็น Date object ค่าที่ได้คือ "Tue Oct 20" → ด่านนี้จะไม่ทำงานเลย และจะดูเหมือนผ่าน');
      }
    });
  });
}

/* ── ตัวอ่านโครงสร้างของ Code.gs ที่กฎข้างล่างใช้ร่วมกัน ──────────────────────────────────────── */
const codeGs = R('src/Code.gs');
function blockAfter(src, startMark) {
  const i = src.indexOf(startMark); if (i < 0) return '';
  let depth = 0, j = src.indexOf('{', i);
  if (j < 0) return '';
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(j, k + 1); }
  }
  return '';
}
const keysOf = block => {
  const out = {};
  // บรรทัดคอมเมนต์ถูกตัดก่อน เพราะชื่อ action ถูกพูดถึงในคอมเมนต์เต็มไปหมด
  block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    .replace(/(^|[{,\s])([A-Za-z_$][\w$]*)\s*:/g, (m, a, k) => { out[k] = 1; return m; });
  return out;
};
const ROUTES = keysOf(blockAfter(codeGs, 'var ROUTES = {'));
const ADMIN_ONLY = keysOf(blockAfter(codeGs, 'var ADMIN_ONLY = {'));
const READ_ONLY_GS = keysOf(blockAfter(codeGs, 'var READ_ONLY_ACTIONS_ = {'));
const WRITES_GS = keysOf(blockAfter(codeGs, 'var WRITES_ACTIONS_ = {'));
const READ_ONLY_JS = keysOf(blockAfter(R('webapp/api.js'), 'const READ_ONLY = {'));
const MUT_RE = (() => { const m = codeGs.match(/var MUTATING_RE = (\/[^\n]*\/i);/); return m ? eval(m[1]) : /^$/; })();
/* 🔴 คัดลอกมาจาก isMutatingAction_ ใน src/Code.gs ตรงๆ — ถ้าสองอันนี้ไม่ตรงกัน ตัวตรวจจะโกหก
 * ทั้งสองทาง (ทั้งรายงานของที่ไม่ผิด และเงียบใส่ของที่ผิดจริง) · test_audit_rules.js ตรึงไว้ว่า
 * บรรทัดนี้ต้องเหมือนกับของจริงเป๊ะ */
const EXTRA_WRITE_RE = /check(in|out)|absence|^dedup|^reindex|payOT$|^orgMove|^unlink|^claim|^recompute/i;
const isWriteAction = a => !READ_ONLY_GS[a] && (WRITES_GS[a] || MUT_RE.test(a) || EXTRA_WRITE_RE.test(a));

/** ตัวโค้ดของ handler ที่ route หนึ่งเรียก (หาในทุกไฟล์ .gs) */
const GS_ALL = {}; GS_FILES.forEach(f => { GS_ALL[f] = R('src/' + f); });
function handlerBodyFor(action) {
  // ROUTES เขียนว่า  action: function (p) { return handleXxx(p); },
  const m = codeGs.match(new RegExp('(?:^|[\\s,{])' + action + ':\\s*function\\s*\\([^)]*\\)\\s*\\{([^}]*)\\}'));
  const inline = m ? m[1] : '';
  const call = inline.match(/\b(handle[A-Za-z0-9_]+|[a-zA-Z0-9_]+Write_)\s*\(/);
  if (!call) return { body: inline, where: 'src/Code.gs (inline)' };
  for (const f of Object.keys(GS_ALL)) {
    const b = blockAfter(GS_ALL[f], 'function ' + call[1] + '(');
    if (b) return { body: b, where: 'src/' + f + ' · ' + call[1] + '()' };
  }
  return { body: inline, where: 'src/Code.gs (inline)' };
}

/* ── R2 · เส้นทางที่เขียนข้อมูล แต่ไม่มีประตู ────────────────────────────────────────────────────
 *
 * เหตุการณ์จริง 2026-10-15: `listParents` คืนทั้งตาราง PARENTS — เลขบัตรประชาชน ที่อยู่ เบอร์โทร
 * LINE UID ของทุกครอบครัว — และไม่ได้อยู่ใน ADMIN_ONLY เลย ใครที่ล็อกอินได้ก็เรียกได้
 *
 * 🔴 ด่านที่ "ไม่มี" ไม่ใช่ด่านที่ "ปฏิเสธ" */
const DOOR_EXEMPT = {
  // ทุกชื่อในนี้ต้องมีเหตุผลเขียนกำกับ — รายการที่ไม่มีเหตุผล คือรายการที่ไม่มีใครตรวจซ้ำได้
  auth: 'คือตัวล็อกอินเอง', lineExchange: 'คือตัวล็อกอินเอง', lineLoginReady: 'บอกแค่ว่าเปิดใช้ไหม',
  googleLink: 'ผูกบัญชีของผู้เรียกเอง · applyIdentity_ ล้าง payload ทิ้งก่อน',
  registerParent: 'ผู้สมัครใหม่ยังไม่มีสิทธิ์อะไรเลย', registerNew: 'ผู้สมัครใหม่',
  addChildNew: 'ผู้สมัครใหม่', linkExisting: 'ผู้สมัครใหม่', claimParent: 'ผู้สมัครใหม่',
  perfLog: 'เขียนได้เฉพาะชีต PERF_LOG · กรองทุกช่อง', ping: 'ไม่แตะข้อมูล',
  signOutEverywhere: 'ปิดเซสชันของตัวเอง', changePassword: 'ของตัวเอง',
  submitLeave: 'ของตัวเอง · applyIdentity_ ปักหมุด staffId', submitTimeRequest: 'ของตัวเอง',
  staffCheckin: 'ของตัวเอง', staffCheckout: 'ของตัวเอง', parentCheckin: 'ของลูกตัวเอง',
  studentAbsence: 'ของลูกตัวเอง', uploadSlip: 'ของครอบครัวตัวเอง', saveProfile: 'ของตัวเอง',
  submitJournal: 'ครูประจำชั้น · ตรวจสิทธิ์ในตัว handler', submitInjury: 'ครู · ตรวจในตัว handler',
  markInboxRead: 'ของตัวเอง', markNotifsRead: 'ของตัวเอง', saveParentComment: 'ของลูกตัวเอง'
};
/* 🔴 ความแม่นยำของกฎนี้อยู่ตรงนี้: applyIdentity_ "ปักหมุด" ตัวตนให้บาง id อยู่แล้ว
 *
 *   เซสชันครู     → payload.staffId ถูกเขียนทับด้วย sess.linkedId · payload.uid ก็เช่นกัน
 *   เซสชันผู้ปกครอง → payload.parentId ถูกเขียนทับ และ payload.studentId ถูกตรวจว่าเป็นลูกตัวเอง
 *
 * 🔴 แต่ "ครู" ไม่ได้ถูกปักหมุด parentId หรือ studentId เลย — ส่งอะไรไปก็ได้
 *
 * ดังนั้น handler ที่ทำงานกับ staffId/uid เท่านั้น = ปลอดภัยโดยโครงสร้าง ไม่ต้องตรวจเอง
 * ส่วน handler ที่รับ id ของ "คนอื่น" (parentId, studentId, targetId, …) โดยไม่ตรวจผู้เรียก
 * = ครูคนใดก็ได้ที่ล็อกอินอยู่ สั่งการกับข้อมูลของใครก็ได้ — รูปแบบเดียวกับ listParents (2026-10-15) */
const PINNED_IDS = { staffId: 1, uid: 1, lineUid: 1, role: 1 };
function ruleR2() {
  Object.keys(ROUTES).forEach(a => {
    if (!isWriteAction(a) || ADMIN_ONLY[a] || DOOR_EXEMPT[a]) return;
    const h = handlerBodyFor(a);
    /* 🔴 ตามเข้าไปในฟังก์ชันที่ handler เรียกอีกชั้นหนึ่งด้วย — ไม่ใช่ดูแค่ตัวมันเอง
     *
     * ครั้งแรกที่เขียนกฎนี้ มันรายงาน payOT/payCharge/payPrepay ว่า "ไม่มีประตู" ทั้งที่การตรวจ
     * parentOwnsStudent_ อยู่ในฟังก์ชันที่มันเรียกต่อ · รายงานที่ร้องหมาป่าแบบนั้นคือรายงานที่
     * ครั้งหน้าไม่มีใครอ่าน — และนั่นอันตรายกว่าการไม่มีรายงานเลย */
    const GUARD_RE = /NO_PERMISSION|NO_ACCESS|adminLike_|arIsAdmin_|arIsLeader_|canOrganize_|headTeacher_|coveredClasses_|parentOwnsStudent_|resolveParent_|__role|__sess|isAdmin_|staffOnDuty_/;
    let guarded = GUARD_RE.test(h.body);
    if (!guarded) {
      const called = new Set((h.body.match(/\b([a-zA-Z][\w]*_)\s*\(/g) || []).map(m => m.replace(/\s*\($/, '')));
      for (const fn of called) {
        if (guarded) break;
        for (const f of Object.keys(GS_ALL)) {
          const b = blockAfter(GS_ALL[f], 'function ' + fn + '(');
          if (b && GUARD_RE.test(b)) { guarded = true; break; }
        }
      }
    }
    if (guarded) return;
    // id ของ "คนอื่น" ที่ handler นี้ทำงานด้วย
    const foreign = {};
    (h.body.match(/\bp(?:ayload)?\.([a-zA-Z][\w]*(?:Id|ID))\b/g) || []).forEach(m => {
      const k = m.split('.')[1]; if (!PINNED_IDS[k]) foreign[k] = 1;
    });
    const ids = Object.keys(foreign);
    if (!ids.length) return;                 // ทำงานกับตัวผู้เรียกเองเท่านั้น → ปลอดภัยโดยโครงสร้าง
    add('R2', '🔴', 'เขียนข้อมูลของคนอื่นได้ โดยไม่มีการตรวจผู้เรียก: ' + a + '  (' + ids.join(', ') + ')', h.where,
      'applyIdentity_ ปักหมุดให้แค่ staffId/uid — เซสชัน "ครู" ส่ง ' + ids[0] + ' ของใครก็ได้ · ใส่ใน ADMIN_ONLY หรือตรวจผู้เรียกในตัว handler');
  });
}

/* ── R3 · การเขียนข้อมูลที่ระบบไม่นับว่าเป็นการเขียน ─────────────────────────────────────────────
 *
 * เหตุการณ์จริง v450: `backfillConfig` เขียนลงชีต SCHOOL_CONFIG แต่ชื่อไม่ตรงกับคำกริยาใดใน
 * MUTATING_RE → ไม่ได้ write lock และไม่ล้าง cache ฝั่งแอป */
/* เขียนจริง แต่ตั้งใจไม่ให้จับ write lock — ต้องมีเหตุผลกำกับทุกตัว */
const LOCKLESS_OK = {
  perfLog: 'โทรมาตรวัดเท่านั้น เขียนได้เฉพาะชีต PERF_LOG ที่แยกออกมา · ที่สำคัญที่สุดคือมันต้อง ' +
           'บันทึกได้แม้ตอนที่ระบบกำลังแย่ — การไปต่อคิว write lock จะทำให้ข้อมูลที่มีค่าที่สุด ' +
           '(ตอนที่ช้าหรือพัง) คือข้อมูลที่หายไปพอดี'
};
function ruleR3() {
  Object.keys(ROUTES).forEach(a => {
    if (isWriteAction(a) || LOCKLESS_OK[a]) return;
    const h = handlerBodyFor(a);
    if (/appendObject_\(|updateRow_\(|deleteRow\(|\.setValues?\(|writeRows_\(|ctx\.persist\(/.test(h.body)) {
      add('R3', '🔴', 'เขียนข้อมูลจริง แต่ระบบถือว่าเป็นการอ่าน: ' + a, h.where,
        'จะไม่ได้ write lock (เขียนชนกันได้) และแอปจะไม่ล้าง cache → หน้าจอโชว์ข้อมูลเก่า · เพิ่มใน WRITES_ACTIONS_ และ WRITES');
    }
  });
}

/* ── R4 · READ_ONLY ต้องตรงกันทั้งสองฝั่ง ────────────────────────────────────────────────────────
 *
 * เหตุการณ์จริง v449: `exportManifest`/`exportTable` ตรงกับคำว่า export ของฝั่งแอป → การสำรองข้อมูล
 * ทุกหน้าล้าง cache ทั้งก้อน · และฝั่งเซิร์ฟเวอร์ถ้าไม่ตรงกันจะไปจับ write lock โดยไม่จำเป็น */
function ruleR4() {
  const a = Object.keys(READ_ONLY_GS), b = Object.keys(READ_ONLY_JS);
  a.filter(k => !READ_ONLY_JS[k]).forEach(k =>
    add('R4', '🔴', 'READ_ONLY มีฝั่งเซิร์ฟเวอร์ แต่ไม่มีฝั่งแอป: ' + k, 'webapp/api.js',
      'แอปจะคิดว่าเป็นการเขียน → ล้าง cache ทั้งหมดทุกครั้งที่เรียก'));
  b.filter(k => !READ_ONLY_GS[k]).forEach(k =>
    add('R4', '🔴', 'READ_ONLY มีฝั่งแอป แต่ไม่มีฝั่งเซิร์ฟเวอร์: ' + k, 'src/Code.gs',
      'เซิร์ฟเวอร์จะจับ write lock ให้การอ่าน → ช้าลงและบล็อกการเขียนจริงที่รออยู่'));
  if (a.length !== b.length) add('R4', 'ℹ️', 'จำนวนไม่เท่ากัน: เซิร์ฟเวอร์ ' + a.length + ' · แอป ' + b.length, '-', '');
}

/* ── R5 · route ที่บังหน้า engine แล้วตกกฎไปข้อหนึ่ง ────────────────────────────────────────────
 *
 * 🔴 นี่คือรูปแบบที่กัดเราบ่อยที่สุด — 4 ครั้งแล้ว
 *
 * เหตุการณ์ล่าสุด v457: engine ปฏิเสธ STUDENT_ENDED มานาน แต่ src/Checkin.gs ซึ่งบังหน้ามันอยู่
 * และเป็นตัวที่รันจริง ไม่เคยรู้จักกฎนั้นเลย → เด็กที่จบแล้วยังลงเวลาได้
 *
 * วิธีตรวจ: เทียบ "รหัสการปฏิเสธ" ที่ engine รู้จัก กับที่ฝั่ง .gs รู้จัก ในฟังก์ชันชื่อเดียวกัน
 * รหัสที่มีใน engine แต่หายไปจากฝั่ง .gs คือกฎที่ไม่ได้ถูกยกมา */
const SHADOW_FUNCS = [
  // [ชื่อฟังก์ชันใน engine, ไฟล์ .gs ที่บังหน้ามัน]  — ประกาศไว้ ไม่ใช่เดาจากชื่อ
  ['assertStudentDayOpen_', 'Checkin.gs'],
];
function ruleR5() {
  const eng = R('webapp/engine.js');
  SHADOW_FUNCS.forEach(([fn, gs]) => {
    const a = blockAfter(eng, 'function ' + fn + '('), b = blockAfter(R('src/' + gs), 'function ' + fn + '(');
    if (!a || !b) { add('R5', 'ℹ️', 'หาคู่เงาไม่เจอ: ' + fn, gs, 'ชื่อฟังก์ชันอาจถูกเปลี่ยน — กฎนี้จะเงียบไปเฉยๆ ถ้าไม่บอก'); return; }
    const codes = s => { const o = {}; (s.match(/(?:apiError_|fail)\(\s*'([A-Z_]+)'/g) || [])
      .forEach(m => { o[m.match(/'([A-Z_]+)'/)[1] = 1] = 1; }); return o; };
    const ca = {}, cb = {};
    (a.match(/(?:apiError_|fail)\(\s*'([A-Z_]+)'/g) || []).forEach(m => ca[m.match(/'([A-Z_]+)'/)[1]] = 1);
    (b.match(/(?:apiError_|fail)\(\s*'([A-Z_]+)'/g) || []).forEach(m => cb[m.match(/'([A-Z_]+)'/)[1]] = 1);
    Object.keys(ca).filter(c => !cb[c]).forEach(c =>
      add('R5', '🔴', 'กฎที่ engine มี แต่ route ที่รันจริงไม่มี: ' + fn + ' → ' + c, 'src/' + gs,
        'เครื่องที่โรงเรียนใช้คือฝั่ง .gs — กฎนี้จึงไม่เคยถูกบังคับใช้จริง ถึงแม้เทสต์ฝั่ง engine จะเขียวหมด'));
  });
}

/* ── R6 · ทุกคีย์ตั้งค่าต้องถูกจัดประเภทไว้สำหรับโรงเรียนใหม่ ───────────────────────────────────
 *
 * ถ้าคีย์ใหม่ไม่ถูกจัดประเภทใน ONBOARD_SCOPE_ โรงเรียนที่สองจะได้ค่าของโรงเรียนแรกติดไปด้วย
 * โดยไม่มีหน้าจอไหนบอก — เหมือนที่ GPS และ SlipOK_ApiKey เคยติดไป (Phase 4.1) */
function ruleR6() {
  const cfg = R('src/Config.gs'), onb = R('src/Onboarding.gs');
  if (!onb) return;
  const block = blockAfter(cfg, 'SCHOOL_CONFIG_DEFAULTS');
  const keys = [];
  (block.match(/\[\s*'([A-Za-z0-9_]+)'\s*,/g) || []).forEach(m => keys.push(m.match(/'([A-Za-z0-9_]+)'/)[1]));
  keys.filter(k => !new RegExp("'" + k + "'").test(onb)).forEach(k =>
    add('R6', '⚠️', 'คีย์ตั้งค่าที่ยังไม่ได้จัดประเภทสำหรับโรงเรียนใหม่: ' + k, 'src/Onboarding.gs',
      'โรงเรียนที่สองจะรับค่าของโรงเรียนแรกไปโดยไม่มีใครรู้ — จัดเป็น BLOCKER/REQUIRED/CONFIRM/UNIVERSAL'));
}

/* ── R7 · เทสต์ที่ผูกกับ "ระยะ" แทนที่จะผูกกับ "ข้อกล่าวอ้าง" ───────────────────────────────────
 *
 * เกิดแล้ว 5 ครั้ง: assertion ที่ตัดซอร์สเป็นช่วงตัวอักษร หรือฝังวันที่ในอนาคตไว้ พังเองโดยที่
 * ไม่มีบั๊กอะไรเลย — และการพังแบบนี้สอนให้คนกด rerun แทนที่จะอ่าน */
function ruleR7() {
  fs.readdirSync(path.join(ROOT, 'tools')).filter(f => /^test_.*\.js$/.test(f)).forEach(f => {
    R('tools/' + f).split('\n').forEach((ln, i) => {
      if (/\.slice\(\s*\w+\s*,\s*\w+\s*\+\s*\d{3,}\s*\)/.test(ln))
        add('R7', '⚠️', 'เทสต์ตัดซอร์สเป็นช่วงตัวอักษร — จะพังเองเมื่อมีคนเติมคอมเมนต์', 'tools/' + f + ':' + (i + 1),
          'เขียนเป็น "ข้อกล่าวอ้าง" แทน เช่น หาบล็อกจริงแล้วตรวจในนั้น');
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ส่วนที่ 2 — ตรวจข้อมูลของโรงเรียนหนึ่งโรง (จากไฟล์สำรองที่โรงเรียนกดเอง)
 *
 * 🔴 ไม่พิมพ์ข้อมูลส่วนบุคคลออกมาแม้แต่ช่องเดียว — รายงานเป็น "จำนวน" และ "รหัส" เท่านั้น
 * ไฟล์นี้มีเด็กทุกคน เบอร์โทรผู้ปกครองทุกคน และเงินเดือนทุกคนอยู่ข้างใน การตรวจไฟล์ PDPA
 * ต้องไม่กลายเป็นตัวที่คัดลอกมันลง terminal เสียเอง (บทเรียนจาก tools/check_export_file.js)
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */
function readXlsx(file) {
  const b = fs.readFileSync(file), E = {};
  for (let i = 0; i < b.length - 3; i++) {
    if (b.readUInt32LE(i) !== 0x04034b50) continue;
    const m = b.readUInt16LE(i + 8), cs = b.readUInt32LE(i + 18), us = b.readUInt32LE(i + 22);
    const nl = b.readUInt16LE(i + 26), el = b.readUInt16LE(i + 28);
    const name = b.slice(i + 30, i + 30 + nl).toString('utf8'), st = i + 30 + nl + el;
    if (!cs && !us) continue;
    let d = b.slice(st, st + (m === 8 ? cs : us));
    if (m === 8) { try { d = zlib.inflateRawSync(d); } catch (e) { continue; } }
    E[name] = d.toString('utf8');
  }
  const unesc = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const wb = E['xl/workbook.xml'] || '';
  const names = (wb.match(/<sheet [^>]*name="([^"]*)"/g) || []).map(s => unesc((s.match(/name="([^"]*)"/) || [])[1]));
  const files = Object.keys(E).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, c) => Number(a.match(/\d+/)[0]) - Number(c.match(/\d+/)[0]));
  const S = {};
  files.forEach((f, i) => {
    const rows = E[f].split(/<row\b/).slice(1).map(r =>
      (r.match(/<c\b[\s\S]*?(?:\/>|<\/c>)/g) || []).map(c => {
        const t = (c.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
        const v = t != null ? t : (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        return unesc(v == null ? '' : v);
      }));
    const h = rows[0] || [];
    S[names[i] || f] = rows.slice(1).map(cs => { const o = {}; h.forEach((k, j) => o[k] = cs[j] == null ? '' : cs[j]); return o; });
  });
  return S;
}
const ymd = v => { const s = String(v == null ? '' : v); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ''; };
const TODAY = (() => { const d = new Date(); const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })();

function auditData(file) {
  const S = readXlsx(file);
  const ST = S.STUDENTS || [], PA = S.PARENTS || [], UL = S.USER_LINKS || [], CS = S.CHECKIN_STAFF || [],
        STF = S.STAFF || [], CFG = S.SCHOOL_CONFIG || [];
  const dcount = (label, n, sev, why, rule) => { if (n > 0) add(rule, sev, label + ' — ' + n + ' รายการ', path.basename(file), why); };

  // D1 · สถานะกับวันสุดท้ายขัดกันเอง (เคสน้องนูรีน: ACTIVE แต่วันสุดท้ายผ่านมาแล้ว)
  dcount('นักเรียนที่สถานะยัง ACTIVE แต่วันสุดท้ายผ่านไปแล้ว',
    ST.filter(s => String(s.Status || '').toUpperCase() === 'ACTIVE' && ymd(s.EndDate) && ymd(s.EndDate) < TODAY).length,
    'ℹ️', 'ถูกต้องได้ (อยู่ในช่วงผ่อนผัน 30 วัน) แต่ถ้าเด็กยังเรียนอยู่จริง แปลว่าวันสุดท้ายถูกกรอกผิด', 'D1');

  // D2 · แถวลงเวลาซ้ำของคนเดียว วันเดียว — บั๊ก 2026-10-20 ทิ้งร่องรอยแบบนี้ไว้
  const seen = {}, dup = {};
  CS.forEach(r => { const k = r.StaffID + '|' + ymd(r.Date); if (!k.endsWith('|')) { if (seen[k]) dup[k] = (dup[k] || 1) + 1; seen[k] = 1; } });
  dcount('แถวลงเวลาพนักงานซ้ำ (คนเดียว วันเดียว หลายแถว)', Object.keys(dup).length, '🔴',
    'ทุกหน้าจออ่านแถวแรก → การแก้เวลาจะเหมือนไม่มีผล · แก้วันนั้นอีกครั้งระบบจะรวมแถวให้เอง', 'D2');

  // D3 · ลิงก์ที่ให้สิทธิ์เข้าถึงเด็ก แต่โยงกลับหาผู้ปกครองไม่ได้
  const uids = {}; PA.forEach(p => { const u = String(p.LineUID || '').trim(); if (u) uids[u] = 1; });
  dcount('ลิงก์กำพร้า (UserUID ไม่ตรงกับผู้ปกครองคนใดเลย)',
    UL.filter(l => { const u = String(l.UserUID || '').trim(); return u && !uids[u]; }).length, '🔴',
    'แถวนี้ยังเปิดดูข้อมูลเด็กได้ แต่ไม่โผล่ในรายชื่อไหนเลย — สิทธิ์เข้าถึงที่ไม่มีใครมองเห็น', 'D3');

  // D4 · ลิงก์ที่ชี้ไปยังเด็กที่ไม่มีอยู่
  const sids = {}; ST.forEach(s => sids[String(s.StudentID)] = 1);
  dcount('ลิงก์ที่ชี้ไปยังรหัสนักเรียนที่ไม่มีในระบบ',
    UL.filter(l => l.StudentID && !sids[String(l.StudentID)]).length, '⚠️',
    'ข้อมูลตกค้างจากการลบ/ย้าย — ไม่อันตราย แต่ทำให้ตัวเลขในรายงานไม่ตรง', 'D4');

  // D5 · ผู้ปกครองที่ไม่ผูกกับเด็กคนไหนเลย
  const linked = {};
  UL.forEach(l => { const u = String(l.UserUID || '').trim(); if (uids[u]) PA.forEach(p => { if (String(p.LineUID || '').trim() === u) linked[p.ParentID] = 1; }); });
  ST.forEach(s => { if (s.ParentID) linked[String(s.ParentID)] = 1; });
  PA.forEach(p => { if (p.StudentID) linked[String(p.ParentID)] = 1; });
  dcount('ผู้ปกครองที่ไม่ได้ผูกกับนักเรียนคนใดเลย', PA.filter(p => !linked[String(p.ParentID)]).length, 'ℹ️',
    'ทำได้แค่เพิ่มข้อมูลนักเรียนเพื่อเชื่อมต่อ — ตัวเลขนี้คือ "มีกี่คนเข้ามาในระบบแต่ไม่ถึงเด็ก"', 'D5');

  // D6 · วันที่ลงเวลาเข้าแล้วไม่เคยลงเวลาออก และวันนั้นผ่านไปแล้ว
  dcount('วันที่พนักงานลงเวลาเข้าแต่ไม่ได้ลงเวลาออก (วันผ่านไปแล้ว)',
    CS.filter(r => r.CheckIn && !r.CheckOut && ymd(r.Date) && ymd(r.Date) < TODAY).length, '⚠️',
    'วันเหล่านี้ไม่มีชั่วโมงทำงานและไม่มี OT — กระทบเงินเดือน ต้องให้แอดมินแก้เวลาหรือให้ครูส่งคำขอ', 'D6');

  // D7 · พนักงานที่สิ้นสุดการทำงานแล้ว แต่สถานะยัง ACTIVE
  dcount('พนักงานที่วันสุดท้ายผ่านไปแล้ว แต่สถานะยัง ACTIVE',
    STF.filter(s => String(s.Status || 'ACTIVE').toUpperCase() === 'ACTIVE' && ymd(s.EndDate) && ymd(s.EndDate) < TODAY).length,
    'ℹ️', 'ระบบปฏิเสธเขาจาก EndDate อยู่แล้ว แต่รายงานที่นับจาก Status จะนับเขารวมอยู่ด้วย', 'D7');

  // D8 · ค่าตั้งค่าที่ยังว่าง ทั้งที่เป็นสิ่งที่ระบบต้องใช้
  const cfgMap = {}; CFG.forEach(r => cfgMap[String(r.Key || '')] = String(r.Value || ''));
  const NEED = ['SchoolName', 'GPS_Lat', 'GPS_Lng'];
  NEED.filter(k => !cfgMap[k]).forEach(k =>
    add('D8', '🔴', 'ค่าตั้งค่าที่จำเป็นยังว่าง: ' + k, path.basename(file),
      k.indexOf('GPS') === 0 ? 'พิกัดว่าง = รั้วโรงเรียนไม่ทำงาน (NaN > radius เป็นเท็จเสมอ) — ใครก็กดรับกลับจากที่ไหนก็ได้'
                             : 'โรงเรียนจะแสดงชื่อผิดในทุกเอกสารที่พิมพ์ออกไป'));

  console.log('\n📦 ' + path.basename(file) + ' · นักเรียน ' + ST.length + ' · ผู้ปกครอง ' + PA.length +
    ' · พนักงาน ' + STF.length + ' · ลิงก์ ' + UL.length + ' · แถวลงเวลา ' + CS.length);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════ */
const RULES = { R1: ruleR1, R2: ruleR2, R3: ruleR3, R4: ruleR4, R5: ruleR5, R6: ruleR6, R7: ruleR7 };
const only = ARG('--rule');
const dataFile = ARG('--data');

if (dataFile) {
  if (!fs.existsSync(dataFile)) { console.error('ไม่พบไฟล์: ' + dataFile); process.exit(2); }
  auditData(dataFile);
} else {
  Object.keys(RULES).filter(r => !only || r === only).forEach(r => RULES[r]());
}

if (HAS('--json')) {
  console.log(JSON.stringify({ at: new Date().toISOString(), findings: findings }, null, 1));
} else {
  const sev = { '🔴': 0, '⚠️': 0, 'ℹ️': 0 };
  findings.forEach(f => sev[f.sev]++);
  console.log('\n══════════ ตรวจระบบ Atom Nursery ══════════');
  if (!findings.length) console.log('\n  ✅ ไม่พบข้อที่ต้องแก้\n');
  ['🔴', '⚠️', 'ℹ️'].forEach(s => {
    const g = findings.filter(f => f.sev === s);
    if (!g.length) return;
    console.log('\n' + s + '  ' + g.length + ' รายการ');
    g.forEach(f => { console.log('  [' + f.rule + '] ' + f.title + '\n       ' + f.where + (f.why ? '\n       → ' + f.why : '')); });
  });
  console.log('\nสรุป: 🔴 ' + sev['🔴'] + ' · ⚠️ ' + sev['⚠️'] + ' · ℹ️ ' + sev['ℹ️'] + '\n');
}
process.exit(HAS('--strict') && findings.some(f => f.sev === '🔴') ? 1 : 0);
