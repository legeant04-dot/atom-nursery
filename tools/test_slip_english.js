/**
 * tools/test_slip_english.js — the payslip in English, written rather than substituted.
 *   node tools/test_slip_english.js
 *
 * Reported 2026-09-02 by a school with foreign staff who cannot read Thai: the English payslip said
 * "สลิปBase salary", "ชื่อStaff", "งวดBase salary", "รวมDeductions", "เงินnetที่Transferบัญชี",
 * "Incomeตามจำนวนเด็ก", "DiligenceCalculateจากการมาทำงาน…".
 *
 * None of that was a bad translation. i18n_tr.js translates whatever Thai is LEFT in the DOM by
 * SUBSTRING substitution — 'เงินเดือน'→'Base salary' fires inside 'สลิปเงินเดือน' and inside
 * 'งวดเงินเดือน' — and openOrDownload ran the same pass over the printed document as one long HTML
 * string. That is a reasonable trick for ordinary UI copy and it is the wrong tool for a document
 * about somebody's pay, where half a translation is worse than none: it is unreadable in BOTH
 * languages, and the reader cannot tell which words are the school's and which are the machine's.
 *
 * So the slip states both languages where the sentence is written (E), and opts out of the
 * substitution pass entirely. The rule this suite defends: no Thai literal may reach the payslip
 * renderer without an English one beside it.
 */
const path = require('path'), fs = require('fs');
let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), tr = R('webapp/i18n_tr.js');

// the three functions the payslip is made of
const cut = (from, to) => { const a = app.indexOf(from); const b = app.indexOf(to, a);
  return (a < 0 || b < 0) ? '' : app.slice(a, b); };
const breakdown = cut('function slipBreakdown(r){', '\n  function payslipCard');
const card      = cut('function payslipCard(r,month){', '\n  // ================= ADMIN');
const doc       = cut('function buildSlipsHTML(rows,month){', 'let pages=\'\';');
const THAI = /[฀-๿]/;

console.log('\n1) THE PIECES ARE THERE AT ALL');
{
  ok_('slipBreakdown found', breakdown.length > 500);
  ok_('payslipCard found', card.length > 500);
  ok_('the printed document found', doc.length > 500);
}

console.log('\n2) EVERY THAI LINE HAS AN ENGLISH ONE BESIDE IT');
{
  /* The check that would have caught the original bug: a Thai string LITERAL in the payslip that is
   * not an argument to E()/EN(). Anything left bare is a string the substring translator used to
   * mangle — and now, with translate="no", would simply stay Thai in front of a reader who cannot
   * read it. Both failures are silent, which is why this is mechanical rather than by eye. */
  /* Strip every paired construct — E(en, th) and the older EN()?en:th — then look for Thai in what
   * is LEFT. Scanning for "Thai next to English" directly cannot work: these are template literals
   * with the pairs nested inside `${...}`, so the outer string always contains Thai. Removing the
   * pairs first is what makes the remainder mean "unpaired". */
  const stripPairs = src => {
    let code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    for (;;) {
      const i = code.search(/\bE\(/);
      if (i < 0) break;
      // match to the closing paren, respecting nesting and quotes
      let d = 0, j = i + 1, q = null;
      for (; j < code.length; j++) {
        const c = code[j];
        if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
        if (c === "'" || c === '"' || c === '`') { q = c; continue; }
        if (c === '(') d++;
        else if (c === ')') { d--; if (!d) { j++; break; } }
      }
      code = code.slice(0, i) + '«E»' + code.slice(j);
    }
    // the older two-branch form, still used in a few places and equally paired
    return code.replace(/EN\(\)\s*\?[^:]{0,200}:\s*(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g, '«EN»');
  };
  const bareThai = src => {
    const code = stripPairs(src), out = [];
    const re = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g; let m;
    while ((m = re.exec(code))) if (THAI.test(m[2])) out.push(m[2].replace(/\s+/g, ' ').trim().slice(0, 40));
    return out;
  };
  eq('no bare Thai left in slipBreakdown', bareThai(breakdown), []);
  eq('no bare Thai left in the payslip card', bareThai(card), []);
  /* The printed document is ONE long template literal, so "which literal contains Thai" says nothing
   * useful about it — read the Thai RUNS out of what is left after the pairs are removed instead.
   * Exactly one survives on purpose: the school's own name is a proper noun and is not translated,
   * the same rule staff names and group names already follow (translate="no" in i18n_tr.js). */
  const thaiRuns = src => [...new Set((stripPairs(src).match(/[฀-๿][฀-๿ ]*/g) || [])
    .map(x => x.trim()).filter(Boolean))];
  eq('the printed document keeps only the school’s own name', thaiRuns(doc), ['อะตอม เนอสเซอรี่']);
  eq('...and the two on-screen pieces keep none at all', [thaiRuns(breakdown), thaiRuns(card)], [[], []]);
}

console.log('\n3) THE SUBSTITUTION PASS IS KEPT OFF IT');
{
  /* Two doors, because the slip is rendered twice: as a card inside the app (translateTree walks the
   * DOM) and as a standalone document (openOrDownload ran trPhrase over the HTML string). */
  ok_('the card is marked translate="no"', /return `<div class="card" translate="no"><h3>\$\{E\('Payslip'/.test(card));
  ok_('...which is the attribute the DOM walker already skips', /var SKIP = '\[translate="no"\],\[data-notr\]';/.test(tr));
  ok_('the printed document opts out too', /function openOrDownload\(html, filename, raw\)\{\n\s*if\(window\.trPhrase && !raw\) html=trPhrase\(html\);/.test(app));
  ok_('...at both call sites', (app.match(/buildSlipsHTML\(\[[a-z]+\],\s*m(?:onth)?\),\s*'payslip-/g) || []).length === 2 &&
    (app.match(/'payslip-'\+[A-Za-z.]+\+'-'\+m(?:onth)?\+'\.html', ?true\)/g) || []).length === 2);
  ok_('and the reason is written where the trick was used', /trPhrase over a whole HTML STRING is what produced/.test(app));
}

console.log('\n4) THE WORDS THEMSELVES');
{
  // the exact lines that came out mangled, now stated in full
  const wants = [
    ["E('Payslip','สลิป')", 'the card heading'],
    ["E('Pay Slip','สลิปเงินเดือน')", 'the document heading'],
    ["E('Employee','ชื่อพนักงาน')", 'employee name'],
    ["E('Pay period','งวดเงินเดือน')", 'pay period'],
    ["E('Gross income','รวมรายได้')", 'gross'],
    ["E('Total deductions','รวมรายการหัก')", 'total deductions'],
    ["E('Net pay transferred','เงินสุทธิที่โอนเข้าบัญชี')", 'net pay'],
    ["E('Base salary','เงินเดือน')", 'base salary'],
    ["E('Social security','ประกันสังคม')", 'social security'],
    ["E('Provident fund (employee share)','เงินสมทบกองทุน (ส่วนพนักงาน)')", 'provident fund'],
    ["E('Employee signature','ลงชื่อผู้รับเงิน')", 'signature line']
  ];
  wants.forEach(function (w) { ok_(w[1] + ' is stated in both languages', app.indexOf(w[0]) >= 0); });
  ok_('E() exists and says why', /const E = \(en, th\) => EN\(\) \? en : th;/.test(app) &&
    /PICK THE LANGUAGE AT THE SOURCE/.test(app));
  /* The working under each figure matters as much as the label: a line on somebody's pay that they
   * have to ask about is a line they cannot check. */
  ok_('the social-security working is bilingual', /E\('capped at','เพดานสูงสุด'\)|EN\(\)\?'capped at':'เพดานสูงสุด'/.test(app));
  ok_('...and the temporary-leave explanation rides on the salary line',
    /E\('temporary leave','ลาชั่วคราว'\)/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
