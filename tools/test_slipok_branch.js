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
  ok_('engine validates the same way', /saveSlipOk[\s\S]{0,900}\[A-Za-z0-9_-\]\+/.test(eng));
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

console.log('\n8) Undo — the key box overwrites the only copy the app holds');
{
  // this is not hypothetical: the notification reference (slipok-<uuid>) was pasted into the key box,
  // and because the key is never displayed there was nothing to read back off the screen.
  const r = runGas({ branch: '70537', apiKey: 'slipok-311a005e-614e-4932-bf60-eee786032e79' });
  eq('the overwritten key is kept', r.cfg.SlipOK_ApiKeyPrev, 'SLIPOKOLD1234');
  eq('...and the new one is in use', r.cfg.SlipOK_ApiKey, 'slipok-311a005e-614e-4932-bf60-eee786032e79');

  // restoring runs against the state the mistake left behind
  const back = runGas({ restorePrev: true }, { SlipOK_ApiKey: 'slipok-311a005e', SlipOK_ApiKeyPrev: 'SLIPOKOLD1234' });
  eq('undo puts the old key back', back.cfg.SlipOK_ApiKey, 'SLIPOKOLD1234');
  eq('...and does not leave a stale undo behind', back.cfg.SlipOK_ApiKeyPrev, '');
  ok_('undo re-probes too', back.out && back.out.__diag === true);
  ok_('undo is refused when there is nothing to undo', !!runGas({ restorePrev: true }, { SlipOK_ApiKeyPrev: '' }).thrown);

  const same = runGas({ branch: '70537', apiKey: 'SLIPOKOLD1234' });
  eq('re-saving the SAME key does not destroy the undo', same.cfg.SlipOK_ApiKeyPrev, undefined);
  const bo = runGas({ branch: '70537' }, { SlipOK_ApiKeyPrev: 'KEEPME' });
  eq('changing only the branch leaves the undo intact', bo.cfg.SlipOK_ApiKeyPrev, 'KEEPME');
  // the diagnostic reads the key in order to USE it — what must never happen is handing it back
  const diag = R('src/PaySlips.gs').split('function handleSlipDiag')[1] || '';
  ok_('the key is never handed back to the browser', !/\bkey: key\b/.test(diag) && !/apiKey:/.test(diag));
  ok_('...only a masked tail is', /keyTail: key\.length > 4/.test(diag));
  ok_('only WHETHER an undo exists is reported', /hasPrevKey: !!getConfig_/.test(R('src/PaySlips.gs')));
  ok_('the undo button only shows when there is something to undo', /d\.hasPrevKey\?/.test(app));
  ok_('...and is wired up', /A_slipOkUndo\(this\)/.test(app) && /window\.A_slipOkUndo=/.test(app));
  ok_('engine mirrors the undo', /restorePrev[\s\S]{0,200}SlipOK_ApiKeyPrev/.test(eng));
}

console.log('\n9) The probe asks SlipOK the question the school actually has');
{
  const ps = R('src/PaySlips.gs');
  // Slice the actual function rather than allowing N characters after its name — a distance bound
  // silently breaks on a comment edit or a CRLF checkout, and then reports a fault that is not there.
  const dg = ps.slice(ps.indexOf('function handleSlipDiag'));
  // /quota costs nothing and returns the expiry date + slips remaining; a dummy-slip POST returns
  // neither, and cannot tell a wrong branch from a wrong key from an unpaid package.
  ok_('it calls the quota endpoint', /\+ '\/quota'/.test(dg));
  ok_('...with GET', /method: 'get'/.test(dg));
  ok_('it reports how many slips are left', /quota: \(q\.quota/.test(ps));
  ok_('it reports when the package expires', /endDate: String\(q\.endDate/.test(ps));
  ok_('1001 is identified as a wrong BRANCH', /badBranch: code === 1001/.test(ps));
  ok_('1002 as a wrong KEY', /badKey: code === 1002/.test(ps));
  ok_('1003\/1004\/1015 as a package problem', /expired: code === 1003 \|\| code === 1004 \|\| code === 1015/.test(ps));
  // the three answers are useless unless they reach the person who has to act
  ok_('the screen says which one is wrong — branch', /lv\.badBranch\?/.test(app));
  ok_('— key', /lv\.badKey\?/.test(app));
  ok_('— package', /lv\.expired\?/.test(app));
  ok_('and warns that the notification reference is not the API key', /slipok-xxxx[\s\S]{0,40}ไม่ใช่<\/b> API key/.test(app));
  ok_('expiry and quota are shown when healthy', /โควตาคงเหลือ/.test(app) && /ใช้ได้ถึง/.test(app));
}

console.log('\n10) The speed report can leave the phone');
{
  ok_('there is a copy button', /A_perfCopy\(this\)/.test(app));
  ok_('the report data is kept for it', /window\._PERF=d/.test(app));
  // the windows grew with the report itself (v255 added WINDOW and REFUSED); what is being pinned is
  // that both paths are still inside A_perfCopy, not how many characters it takes to reach them
  ok_('it copies to the clipboard', /A_perfCopy[\s\S]{0,2600}clipboard\.writeText/.test(app));
  ok_('with a fallback for browsers that block the clipboard', /A_perfCopy[\s\S]{0,3200}<textarea readonly/.test(app));
  // v255: two lines that stop the report lying to us
  ok_('it says when the window is shorter than it claims', /A_perfCopy[\s\S]{0,1200}'WINDOW: capped at '/.test(app));
  ok_('...and separates refusals from failures', /A_perfCopy[\s\S]{0,1600}'REFUSED \(working as intended\): '/.test(app));
  ['SLOWEST', 'SCREENS', 'PROBLEMS', 'FAILING', 'DEVICES', 'BOOT'].forEach(k =>
    ok_('the text includes ' + k, new RegExp("A_perfCopy[\\s\\S]{0,2200}'" + k).test(app)));
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' : 'ALL PASS ') + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
