/**
 * tools/test_slipok_branch.js — the admin can point the app at the right SlipOK branch.
 *   node tools/test_slipok_branch.js
 *
 * The failure this closes: SlipOK issues a NEW branch id when a school renews by opening a new
 * branch. The id lived only in the code defaults, so every slip came back "package expired" and
 * nobody on site could do anything about it. Two things therefore have to hold — the value must be
 * editable from the admin screen, and saving it must be followed by a REAL probe, so "did that fix
 * it?" is answered on the spot rather than guessed at.
 */
const path = require('path'), fs = require('fs'), vm = require('vm');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function eq(label, got, want) {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log((good ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (good ? '' : ' want=' + JSON.stringify(want)));
  good ? pass++ : fail++;
}
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = R('webapp/app.js'), eng = R('webapp/engine.js'), staff = R('src/Staff.gs'), code = R('src/Code.gs'), gasEng = R('src/Engine.gs');

// ---- run the real GAS handler against a fake Sheets layer ----------------------------------
function runGas(payload, startCfg) {
  const cfg = Object.assign({ SlipOK_Url: 'https://api.slipok.com/api/line/apikey/69307', SlipOK_ApiKey: 'SLIPOKOLD1234' }, startCfg || {});
  const audit = [];
  const ctx = {
    getConfig_: (k, d) => (cfg[k] !== undefined ? cfg[k] : d),
    setConfigValue_: (k, v) => { cfg[k] = v; },
    apiError_: (c, m) => Object.assign(new Error(m), { code: c }),
    logAudit: (...a) => audit.push(a),
    handleSlipDiag: () => ({ __diag: true, branch: String(cfg.SlipOK_Url).split('/').pop() }),
    console
  };
  vm.createContext(ctx);
  const i = staff.indexOf('function handleSaveSlipOk(');
  let depth = 0, j = staff.indexOf('{', i), end = j;
  for (let k = j; k < staff.length; k++) { if (staff[k] === '{') depth++; else if (staff[k] === '}') { depth--; if (!depth) { end = k; break; } } }
  vm.runInContext(staff.slice(i, end + 1), ctx);
  let out = null, thrown = null;
  try { out = ctx.handleSaveSlipOk(payload); } catch (e) { thrown = e; }
  return { out, thrown, cfg, audit };
}

console.log('\n1) Saving a branch actually changes where slips are sent');
{
  const r = runGas({ branch: '81234', adminId: 'ST-1' });
  eq('the URL follows the new branch', r.cfg.SlipOK_Url, 'https://api.slipok.com/api/line/apikey/81234');
  ok_('no error', !r.thrown);
  ok_('the change is written to the audit log', r.audit.length === 1 && /81234/.test(String(r.audit[0])));
}
{
  // pasting the whole dashboard URL is the likeliest thing a hurried admin does
  const r = runGas({ branch: 'https://api.slipok.com/api/line/apikey/81234/' });
  eq('a pasted full URL is reduced to the branch', r.cfg.SlipOK_Url, 'https://api.slipok.com/api/line/apikey/81234');
}
{
  const r = runGas({ branch: '  81234  ' });
  eq('surrounding spaces are trimmed', r.cfg.SlipOK_Url, 'https://api.slipok.com/api/line/apikey/81234');
}

console.log('\n2) The API key is optional — fixing the branch must not require re-typing the key');
{
  const r = runGas({ branch: '81234' });
  eq('a blank key leaves the existing one alone', r.cfg.SlipOK_ApiKey, 'SLIPOKOLD1234');
  const r2 = runGas({ branch: '81234', apiKey: 'SLIPOKNEW9999' });
  eq('a supplied key replaces it', r2.cfg.SlipOK_ApiKey, 'SLIPOKNEW9999');
  const r3 = runGas({ branch: '81234', apiKey: '   ' });
  eq('whitespace is not a key', r3.cfg.SlipOK_ApiKey, 'SLIPOKOLD1234');
}

console.log('\n3) Garbage is refused rather than silently breaking verification');
{
  ['', '   ', 'abc def', '../../etc', 'x?y=1', '69307 (สาขาใหม่)'].forEach(b => {
    const r = runGas({ branch: b });
    ok_('rejected: ' + JSON.stringify(b), !!r.thrown);
  });
  const r = runGas({ branch: '' });
  eq('...and nothing was written', r.cfg.SlipOK_Url, 'https://api.slipok.com/api/line/apikey/69307');
  ok_('the refusal says where to find the right value', r.thrown && /SlipOK/.test(r.thrown.message));
}

console.log('\n4) Saving answers with a LIVE probe, not just "saved"');
{
  const r = runGas({ branch: '81234' });
  ok_('the handler returns the diagnostic', r.out && r.out.__diag === true);
  ok_('...computed AFTER the write, so it reflects the new branch', r.out && r.out.branch === '81234');
  ok_('the GAS handler delegates to handleSlipDiag', /handleSaveSlipOk[\s\S]{0,1400}return handleSlipDiag\(p\)/.test(staff));
}

console.log('\n5) Wiring: the route exists, is admin-only, and takes the write lock');
{
  ok_('routed in Code.gs', /saveSlipOk:\s*function/.test(code));
  ok_('admin-only', /saveSlipOk: 1/.test(code));
  // an action matching neither mutation regex writes with no lock and no cache bust
  const MUT_S = /^(submit|save|add|remove|delete|set|register|pay|upload|confirm|reject|issue|generate|move|import|compute|cancel|prepay|link|notify|request|mark|approve|edit|rename|update|change|seed|recompute|restore|bind|provision)/i;
  const MUT_C = /^(submit|save|add|remove|delete|set|register|pay|upload|confirm|reject|issue|generate|move|export|import|compute|cancel|prepay|link|notify|request|mark|approve|edit|rename|update|change|seed|dedup|reindex)/i;
  ok_('the server treats it as a write', MUT_S.test('saveSlipOk'));
  ok_('the client busts its cache on it', MUT_C.test('saveSlipOk'));
}

console.log('\n6) The engine mirrors it (mock mode must not diverge from live)');
{
  ok_('engine has saveSlipOk', /saveSlipOk:\s*p\s*=>/.test(eng));
  ok_('engine enforces admin', /saveSlipOk[\s\S]{0,200}NO_PERMISSION/.test(eng));
  ok_('engine validates the same way', /saveSlipOk[\s\S]{0,400}\[A-Za-z0-9_-\]\+/.test(eng));
  ok_('engine re-probes after saving', /saveSlipOk[\s\S]{0,700}H\.slipDiag\(p\)/.test(eng));
  ok_('slipDiag now reports the branch in mock too', /slipDiag[\s\S]{0,1800}branch:url/.test(eng));
  ok_('the built Engine.gs carries it (build_engine was run)', /saveSlipOk/.test(gasEng));
}

console.log('\n7) The admin can reach it — on the screen that told them something was wrong');
{
  ok_('the branch field is on the diagnostic modal', /id="sokBranch"/.test(app));
  ok_('so is the key field', /id="sokKey"/.test(app));
  ok_('the branch box is pre-filled with what is in use, not blank', /id="sokBranch"[^>]*value="\$\{esc\(lv\.branch/.test(app));
  ok_('the key box is NOT pre-filled with the secret', !/id="sokKey"[^>]*value="\$\{esc\(lv\.key/.test(app));
  ok_('...and says that blank keeps the current key', /เว้นว่างไว้ = ใช้คีย์เดิม/.test(app));
  ok_('there is a save button', /A_slipOkSave\(this\)/.test(app));
  ok_('saving redraws with the fresh probe rather than just closing', /A_slipOkSave[\s\S]{0,600}A_slipDiagShow\(d\)/.test(app));
  ok_('and says plainly whether it worked', /A_slipOkSave[\s\S]{0,900}d\.working\?/.test(app));
  ok_('an empty branch is stopped before a round-trip', /A_slipOkSave[\s\S]{0,300}if\(!b\)/.test(app));
  ok_('the render is reusable, not welded to the fetch', /window\.A_slipDiagShow=/.test(app));
  ok_('the original entry point still works', /window\.A_slipDiag=async/.test(app) && /A_slipDiagShow\(await api\('slipDiag'/.test(app));
}

console.log('\n8) The speed report can leave the phone');
{
  ok_('there is a copy button', /A_perfCopy\(this\)/.test(app));
  ok_('the report data is kept for it', /window\._PERF=d/.test(app));
  ok_('it copies to the clipboard', /A_perfCopy[\s\S]{0,1800}clipboard\.writeText/.test(app));
  ok_('with a fallback for browsers that block the clipboard', /A_perfCopy[\s\S]{0,2400}<textarea readonly/.test(app));
  ['SLOWEST', 'SCREENS', 'PROBLEMS', 'FAILING', 'DEVICES', 'BOOT'].forEach(k =>
    ok_('the text includes ' + k, new RegExp("A_perfCopy[\\s\\S]{0,2200}'" + k).test(app)));
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' : 'ALL PASS ') + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
