/* build_engine.js — copy webapp/engine.js -> src/Engine.gs so the engine has ONE source of truth.
   Run after editing webapp/engine.js:  node tools/build_engine.js
   engine.js is environment-agnostic (no window/DOM); the trailing module.exports line is guarded and
   simply ignored under GAS (where `module` is undefined). */
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../webapp/engine.js', 'utf8');
const header =
  '/** Engine.gs — AUTO-GENERATED from webapp/engine.js by tools/build_engine.js — DO NOT EDIT HERE.\n' +
  ' *  Shared business logic (all api handlers). GasEngine.gs hydrates M from Sheets, calls\n' +
  ' *  createAtomAPI(M, GROWTH_STD).H[action](payload), then persists the changes back.\n' +
  ' */\n';
fs.writeFileSync(__dirname + '/../src/Engine.gs', header + src);
console.log('src/Engine.gs written (' + (header.length + src.length) + ' bytes)');
