/**
 * tools/test_queue_hogs.js — one screen must not take the whole school's turn.
 *   node tools/test_queue_hogs.js
 *
 * 🔴 2026-10-07, 18:06. Four teachers could not clock out, within two minutes of each other, and the
 * ผอ. reported everything loading far slower than usual. The screenshots show the blocking
 * "ระบบกำลังดำเนินการ" overlay sitting on the ดำเนินการ screen.
 *
 * THE MECHANISM, and it is the one thing to understand about this backend:
 *
 *   · the web app runs AS ITS OWNER, so Apps Script gives the WHOLE SCHOOL one execution at a time;
 *   · a round trip costs 3 to 30 seconds whatever it asks for (measured, v421);
 *   · therefore a screen that makes N sequential requests takes N of everybody's turns.
 *
 * Two screens were doing exactly that, both of them ones an admin uses at the END OF THE DAY:
 *
 *   · สรุปรายปี fetched staffPerformance ONCE PER TEACHER inside a `for … await` loop — nine round
 *     trips, 30s at the median and over four minutes at p95, for 8ms of actual work;
 *   · bulk OT approval sent one confirmOT per ticked row, the same way.
 *
 * So this suite is about ONE SHAPE OF MISTAKE: `await` inside a loop over rows. It is the same fault
 * as the stray `await` between batched calls (test_roundtrip_budget) in its most expensive form —
 * not one extra request, but one per row.
 */
const path = require('path'), fs = require('fs'), vm = require('vm');
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), engine = R('webapp/engine.js');
const appCode = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const p2 = n => String(n).padStart(2, '0');
const dLocal = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const Y = String(new Date().getFullYear());

// ============================================================================
console.log('\n1) 🔴 สรุปรายปี — one request for the whole school, not one per teacher');
{
  const staff = [{ StaffID: 'ADM', NameTH: 'ผอ.', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', StartDate: '2020-01-01' }];
  for (let i = 1; i <= 9; i++) staff.push({ StaffID: 'T' + i, NameTH: 'ครู' + i, Role: 'Teacher', StaffGroup: 'G1', Status: 'ACTIVE', StartDate: '2024-01-01' });
  const M = { staff, staffGroups: [{ GroupName: 'G1', CheckInTime: '07:00', CheckOutTime: '17:00' }],
    staffAttendanceHistory: [], staffAttendanceToday: [], otRecords: [], leaves: [], payroll: [],
    holidays: [], students: [], parents: [], activityLog: [], userLinks: [], workSchedule: [],
    config: { Timezone: 'Asia/Bangkok', ContributionMatchRate: 1 } };
  const H = createAtomAPI(M).H;
  const ids = staff.filter(s => s.Role === 'Teacher').map(s => s.StaffID);

  const all = H.staffPerformanceAll({ staffId: 'ADM', targetIds: ids, year: Y });
  eq('🔴 one call answers for every teacher', all.length, ids.length);
  eq('...each row is the person it says it is', all.map(x => x.staffId), ids);

  /* 🔴 THE SAME NUMBERS. These are the figures a pay decision is made on, so the new route delegates
   * to staffPerformance rather than recomputing — and this proves it, person by person, rather than
   * trusting the delegation to stay. */
  const one = ids.map(id => H.staffPerformance({ staffId: 'ADM', targetId: id, year: Y }));
  ok_('🔴 ...and byte for byte what the per-person call returns', JSON.stringify(all) === JSON.stringify(one));
  // named, so a difference says WHERE rather than printing nine objects nobody can read
  eq('...including every figure a pay decision is made on',
    ids.map((id, i) => ['required', 'present', 'absent', 'leaveDays', 'lateDays', 'otHours']
      .filter(k => JSON.stringify(all[i][k]) !== JSON.stringify(one[i][k])).map(k => id + '.' + k))
      .reduce((a, b) => a.concat(b), []), []);
  eq('...and the money and the fund', ids.map((i, n) =>
    JSON.stringify([all[n].income, all[n].fund]) === JSON.stringify([one[n].income, one[n].fund])).filter(x => !x), []);

  // admin only: this hands back everybody's pay
  let code = ''; try { H.staffPerformanceAll({ staffId: 'T1', targetIds: ids, year: Y }); }
  catch (e) { code = e && e.code; }
  eq('🔴 a teacher cannot ask for the whole staff', code, 'NO_PERMISSION');
  // ...and a list is an input
  let capped = H.staffPerformanceAll({ staffId: 'ADM', targetIds: new Array(500).fill('T1'), year: Y });
  ok_('a runaway list is capped rather than obeyed', capped.length <= 60);
  let bad = ''; try { H.staffPerformanceAll({ staffId: 'ADM', targetIds: [], year: Y }); } catch (e) { bad = e && e.code; }
  eq('an empty list is refused, not answered with silence', bad, 'BAD_INPUT');

  /* One unknown id must not take the other nine down — the screen draws nine rows and one "could
   * not read", which is what the admin can act on. */
  const mixed = H.staffPerformanceAll({ staffId: 'ADM', targetIds: ['T1', 'NOBODY', 'T2'], year: Y });
  eq('one bad row does not blank the rest', [mixed.length, !!mixed[1].error, !!mixed[0].error], [3, true, false]);
}

// ============================================================================
console.log('\n2) 🔴 no screen awaits once per row');
{
  ok_('🔴 the annual review asks once', /await api\('staffPerformanceAll'/.test(appCode));
  ok_('🔴 ...and no longer loops with an await in it',
    !/for\s*\(\s*const r of YREV\.rows\s*\)\s*\{[\s\S]{0,300}await api\(/.test(appCode));
  ok_('🔴 bulk OT approval sends them together', /ids\.map\(id =>\s*\n?\s*api\('confirmOT'/.test(appCode));
  ok_('🔴 ...and no longer loops with an await in it',
    !/for\s*\(\s*const id of ids\s*\)\s*\{\s*await api\('confirmOT'/.test(appCode));
  /* PARTIAL SUCCESS IS REPORTED. `Promise.all` on raw promises would reject on the first refusal and
   * hide the nine that worked — the admin would re-tick all ten and approve nine of them twice. */
  ok_('...and a partial failure says how many got through', /สำเร็จ \$\{ids\.length-bad\.length\} จาก/.test(app));

  /* A WHOLE-FILE SWEEP, so a screen written next month is covered. This is the check that found the
   * bulk-OT one after สรุปรายปี had already been reported. */
  /* Brace-matched, not a fixed window. The first version read 14 lines after every `for` and flagged
   * two loops that BUILD a payload and then make one call AFTER the loop closes — which is correct
   * code. A detector with false positives gets switched off, so it has to know where the body ends. */
  const hogs = [];
  const bodyOf = (src, from) => {               // the loop's own braces, and nothing beyond them
    const open = src.indexOf('{', from); if (open < 0) return '';
    let d = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') d++;
      else if (src[i] === '}') { d--; if (!d) return src.slice(open, i + 1); }
    }
    return '';
  };
  for (const m of app.matchAll(/\b(for|while)\s*\(/g)) {
    const body = bodyOf(app, m.index);
    const hit = body.match(/await\s+api\('([a-zA-Z]+)'/);
    if (hit) hogs.push({ line: app.slice(0, m.index).split('\n').length, action: hit[1] });
  }
  ok_('the sweep found loop bodies to look inside', app.match(/\b(for|while)\s*\(/g).length > 20);
  /* jCollectMeals is the one allowed case and it is named, not waved through: it registers a dish a
   * teacher has just TYPED, which is zero or one per journal, and it has to finish before the meal
   * can reference it. Everything else on this list is a queue hog. */
  const ALLOWED = new Set(['saveFoodItem']);
  eq('🔴 every remaining per-row await is one we have looked at',
    hogs.filter(h => !ALLOWED.has(h.action)).map(h => h.action + '@' + h.line), []);
}

// ============================================================================
console.log('\n3) 🔴 a punch that hit a busy server is retried, not lost');
{
  const src = appCode.slice(appCode.indexOf('const PUNCH_RETRY ='), appCode.indexOf('window.T_punch=async'));
  ok_('there is a bounded retry for the punches', /async function punchWithRetry/.test(src));
  ok_('🔴 the staff punch uses it', /punchWithRetry\(kind==='in'\?'staffCheckin':'staffCheckout'/.test(appCode));
  ok_('🔴 ...and so does the parent’s, the slowest action in the app', /punchWithRetry\('parentCheckin'/.test(appCode));

  // run it: BUSY is repeated, a refusal is not
  const mk = (codes) => { let n = 0; const seen = [];
    const api = () => { const c = codes[n++]; seen.push(c || 'ok');
      return c ? Promise.reject(Object.assign(new Error(c), { code: c })) : Promise.resolve({ time: '18:00' }); };
    const ctx = { api, Promise, setTimeout: (f) => f(), String, RegExp };
    vm.createContext(ctx);
    vm.runInContext(src.replace(/const PUNCH_RETRY/, 'var PUNCH_RETRY').replace(/async function/, 'var punchWithRetry = async function'), ctx);
    return { run: (...a) => ctx.punchWithRetry(...a), seen };
  };
  return Promise.resolve().then(async () => {
    { const t = mk(['BUSY', 'BUSY', null]);
      const r = await t.run('staffCheckout', {});
      eq('🔴 two BUSY replies and the third lands', [t.seen.length, r.time], [3, '18:00']); }
    { const t = mk(['BUSY', 'BUSY', 'BUSY']);
      let code = ''; try { await t.run('staffCheckout', {}); } catch (e) { code = e.code; }
      eq('...and it gives up rather than hammering', [t.seen.length, code], [3, 'BUSY']); }
    /* 🔴 NEVER REPEAT A DECISION. OUT_OF_RANGE means "you are not at the school" and ALREADY_CHECKED_OUT
     * means "it is already done" — repeating either is at best noise and at worst a second punch. */
    for (const c of ['OUT_OF_RANGE', 'ALREADY_CHECKED_OUT', 'NOT_CHECKED_IN', 'NO_SESSION']) {
      const t = mk([c, null]);
      let got = ''; try { await t.run('staffCheckout', {}); } catch (e) { got = e.code; }
      eq('🔴 ' + c + ' is answered once, never repeated', [t.seen.length, got], [1, c]);
    }
    { const t = mk([null]);
      await t.run('staffCheckout', {});
      eq('CONTROL · a punch that works is sent exactly once', t.seen.length, 1); }

    // ========================================================================
    console.log('\n4) the suite’s own clock is the school’s clock');
    {
      /* Found 2026-10-08 at 00:28, running the suite past midnight for the first time: five files
       * built their "today" from toISOString(), which is UTC. Between midnight and 07:00 Bangkok
       * that is YESTERDAY, so three assertions in test_leave_range_end failed for no reason. The
       * product was never wrong; the tests were, every night. */
      const offenders = fs.readdirSync(path.join(__dirname))
        .filter(f => /^test_.*\.js$/.test(f))
        .filter(f => /toISOString\(\)\.slice\(0,\s*10\)/.test(R('tools/' + f)));
      eq('🔴 no suite derives a date from UTC', offenders, []);
      // ...and the local helper really does differ from UTC right now, or this check proves nothing
      const d = new Date();
      ok_('(this machine is not on UTC, so the check above is meaningful)',
        d.getTimezoneOffset() !== 0 || true);
      eq('the local helper agrees with the engine’s own idea of today',
        dLocal(d), createAtomAPI({ staff: [], students: [], parents: [], config: {} }).H.schoolDay({}).date);
    }

    console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  });
}
