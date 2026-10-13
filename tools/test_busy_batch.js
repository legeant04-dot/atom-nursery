/**
 * tools/test_busy_batch.js — a read must not fail for the company it keeps.
 *   node tools/test_busy_batch.js
 *
 * 🔴 WHERE THIS CAME FROM. The 07–13/10 speed report, FAILING section:
 *
 *     staffSelf            BUSYx8
 *     journalStatus        BUSYx7
 *     studentAlerts        BUSYx7
 *     classList            BUSYx7
 *     myAttendanceToday    BUSYx7   … and five more, all the same
 *
 * Every one of those is a pure READ, and reads do not take the write lock — withWriteLock_ is only
 * armed when something in the request can write. So on the face of it those rows cannot exist.
 *
 * They exist because the lock is decided for the WHOLE BATCH. api.js sends every call made in one
 * tick as a single request; one mutating call anywhere in it arms the lock for all of them, and
 * when the lock could not be taken within 25 seconds the whole batch was answered BUSY. Nine reads
 * that needed no lock died with the one write that did, and a teacher's entire home screen went red
 * because somebody else in the school was saving.
 *
 * This is the same lesson as the Observer rule, which was learned the same way (an Observer's home
 * screen failing entirely because one flagged call was refused) and which is fixed the same way:
 * refuse the calls that are actually refused, per call, and let the rest answer.
 *
 * WHAT MUST NOT CHANGE: no write may run without the lock. That is the guarantee the 2026-07-09
 * student wipe bought, and the whole point of the lock.
 */
const path = require('path'), fs = require('fs');
const harness = require('./gas_test_harness');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '\n         got =' + JSON.stringify(got) + '\n         want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

/** @param free  can the lock be taken? false = somebody else is holding it. */
function boot(free) {
  const { g } = harness(['Config', 'Db', 'Audit', 'Line', 'Auth', 'GasEngine', 'Engine', 'Code', 'Setup', 'Dspm_Seed']);
  const ran = [];
  let acquired = 0, held = false;
  g.LockService = {
    getScriptLock: () => ({
      tryLock: () => { if (!free) return false; acquired++; held = true; return true; },
      releaseLock: () => { held = false; }
    })
  };
  g.__run(function () { _configCache = null; setupAll(); _configCache = null; });
  // two reads and one write, named so the regexes in isMutatingAction_ classify them correctly
  g.ROUTES.readThing = function () { ran.push('readThing'); return { v: 'read ok' }; };
  g.ROUTES.readOther = function () { ran.push('readOther'); return { v: 'other ok' }; };
  g.ROUTES.saveThing = function () { ran.push('saveThing'); return { v: 'written' }; };
  return { g, ran, lockHeld: () => held, acquired: () => acquired };
}

const HOME = { calls: [{ action: 'readThing', payload: {} }, { action: 'saveThing', payload: {} }, { action: 'readOther', payload: {} }] };

// ============================================================================
console.log('\n1) 🔴 ล็อกว่าง — ทุกอย่างทำงานตามปกติ');
{
  const { g, ran, acquired } = boot(true);
  const out = JSON.parse(g.dispatch_('batch', JSON.parse(JSON.stringify(HOME))).getContent());
  ok_('ทั้งชุดสำเร็จ', out.ok === true);
  eq('ตอบกลับครบ 3 ช่อง ตามลำดับเดิม', out.data.map(r => r.ok), [true, true, true]);
  eq('ทั้งสามตัวได้รัน', ran, ['readThing', 'saveThing', 'readOther']);
  ok_('ล็อกถูกจับจริง (ไม่ได้ผ่านเพราะบังเอิญ)', acquired() === 1);
}

// ============================================================================
console.log('\n2) 🔴 ล็อกไม่ว่าง — การอ่านต้องรอด');
{
  const { g, ran } = boot(false);
  const out = JSON.parse(g.dispatch_('batch', JSON.parse(JSON.stringify(HOME))).getContent());
  ok_('ชุดคำขอไม่ล้มทั้งชุด', out.ok === true);
  /* THE WHOLE POINT. Before this, every entry here was BUSY and the home screen showed nothing. */
  eq('🔴 อ่านได้ · เขียนถูกปฏิเสธ · อ่านได้', out.data.map(r => r.ok), [true, false, true]);
  // read defensively: if the refusal regresses, this must REPORT it, not throw and hide the rest
  const er = (out.data[1] && out.data[1].error) || {};
  eq('รหัสที่ปฏิเสธคือ BUSY', er.code, 'BUSY');
  eq('🔴 ตัวที่เขียนไม่ได้ถูกรัน', ran, ['readThing', 'readOther']);
  ok_('ข้อความเป็นภาษาที่คนอ่านรู้เรื่อง', /กำลังบันทึก/.test(er.message || ''));
  /* The reads must come back with their real answers, not an empty shell that merely says ok. A
   * screen handed `undefined` fails one step later, somewhere that does not mention BUSY at all. */
  const dv = i => (out.data[i] && out.data[i].data || {}).v;
  eq('...และข้อมูลที่อ่านได้เป็นของจริง', [dv(0), dv(2)], ['read ok', 'other ok']);
}

// ============================================================================
console.log('\n3) 🔴 คำขอเดี่ยวที่เขียน — ยังตอบ BUSY เหมือนเดิม');
{
  const { g, ran } = boot(false);
  const out = JSON.parse(g.dispatch_('saveThing', {}).getContent());
  ok_('ถูกปฏิเสธ', out.ok === false);
  eq('ด้วยรหัส BUSY', out.error.code, 'BUSY');
  /* Nothing travelled with it, so there is nothing to rescue — and silently letting it through
   * would be the actual catastrophe. */
  eq('🔴 และไม่ได้ถูกรัน', ran, []);
}

// ============================================================================
console.log('\n4) 🔴 คำขอเดี่ยวที่อ่าน — ไม่เคยแตะล็อกอยู่แล้ว');
{
  const { g, ran, acquired } = boot(false);
  const out = JSON.parse(g.dispatch_('readThing', {}).getContent());
  ok_('อ่านได้แม้ล็อกไม่ว่าง', out.ok === true);
  eq('และได้รัน', ran, ['readThing']);
  eq('ไม่ได้พยายามจับล็อกเลย', acquired(), 0);
}

// ============================================================================
console.log('\n5) 🔴 ชุดที่มีแต่การอ่าน — ล็อกไม่เกี่ยวข้อง');
{
  const { g } = boot(false);
  const out = JSON.parse(g.dispatch_('batch', { calls: [
    { action: 'readThing', payload: {} }, { action: 'readOther', payload: {} }] }).getContent());
  eq('ทั้งสองสำเร็จ', out.data.map(r => r.ok), [true, true]);
}

// ============================================================================
console.log('\n6) 🔒 กติกาที่ห้ามเปลี่ยน — ไม่มีการเขียนลงชีตขณะไม่ถือล็อก');
{
  const gas = R('src/GasEngine.gs'), code = R('src/Code.gs');
  /* persist() only writes collections that differ from the snapshot and every write above was
   * refused, so it would write nothing anyway — but "would write nothing anyway" is a property of
   * the handlers, and the lock exists precisely so that correctness is not a property of the
   * handlers. Skipped outright, so there is no argument left to get wrong. */
  ok_('🔴 ตอนล็อกไม่ว่าง ไม่เรียก persist เลย', /if \(!isBusy\) ctx\.persist\(\)/.test(gas));
  ok_('ตัวปฏิเสธรายข้ออยู่ใน handleBatch', /isBusy && typeof isMutatingAction_/.test(gas));
  ok_('และทางเลี่ยงนี้เปิดให้เฉพาะ batch', /\(action === 'batch'\) \? function \(\)/.test(code));
  ok_('ข้อความ BUSY มีที่มาที่เดียว', /var BUSY_MSG_ =/.test(code));
  /* A new file that re-introduces its own BUSY string would drift from this one. One source. */
  ok_('...และ handleBatch ก็ใช้ตัวเดียวกัน', /BUSY_MSG_ !== 'undefined'/.test(gas));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
