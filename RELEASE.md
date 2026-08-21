# Releasing Atom Nursery

Four commands. Nothing here has to be remembered — each step refuses to do the wrong thing.

```bash
node tools/test_all.js                       # every suite + the engine rebuild + version check
node tools/release.js                        # 255 -> 256, in all three files
node tools/build_web.js                      # dist_pages/, with the version stamped in
cd src && npx clasp push -f && npx clasp deploy -i AKfycb…WPBsx-7d -d "v256: what changed"
git add -A && git commit && git push         # GitHub Pages serves dist_pages/
```

Then wait ~95 s and check the live build actually moved:

```bash
curl -s "https://legeant04-dot.github.io/atom-nursery/app.js?x=$RANDOM" | grep -o "Version 1\.[0-9]*"
```

---

## Why each step exists

**`test_all.js`** — 69 suites in about half a minute. It rebuilds `src/Engine.gs` first, because that
file is GENERATED from `webapp/engine.js`: a stale copy means the suites pass against code the server
will not run. It also fails a suite that prints **no summary** — `test_notify_parent.js` threw before
its first assertion for six releases and the old shell loop, which looked for the word FAIL, called
it clean the whole time.

**`release.js`** — the version lives in ONE place (`APP_VERSION` in `webapp/app.js`); this writes the
`?v=NN` in `index.html` and the `CACHE` in `sw.js` to match. Missing one used to be invisible: a
browser serving last week's `app.js` beside this week's `index.html` until the cache expired.
`node tools/release.js --check` verifies without changing anything.

**`build_web.js`** — stamps the version into the OUTPUT from the same source, so the deployed copy is
coherent whatever state the sources are left in. It refuses to build if it cannot find
`APP_VERSION`.

**The deployment id never changes.** `clasp deploy -i AKfycb…WPBsx-7d` updates the URL the school is
already using. A new deployment would be a new URL that nobody has.

---

## Things that will bite

- **Apps Script caps a project at 200 versions.** When `clasp deploy` says so, delete old versions in
  the editor (⏱️ Project history) before deploying. Check with `npx clasp versions | head -1`.
- **`dist_pages/` is minified with local names mangled.** Verify a deploy by a global, a literal
  string, or behaviour — never by a private function name.
- **`webapp/api.js` must be `MODE:'gas', DEMO_MODE:false`** when you deploy. Local testing flips it
  to `mock`; flipping it back is not optional.
- **A new write action** has to be named in `WRITES_ACTIONS_` (`src/Code.gs`) *and* `WRITES`
  (`webapp/api.js`) if its name does not start with a mutating verb — and in `READ_ONLY` on both
  sides if it merely *sounds* like one (`staffMissingCheckout` contains "Checkout").
- **A new column** goes at the END of its list in `src/Config.gs`. `collectionHeaders_` tops up a
  live sheet on the next write; inserting mid-schema shifts every existing row.

---

## The two standing checks

`tools/test_one_rule.js` is a registry of every rule that must exist in exactly one place, with the
shapes that mean somebody has written a second copy. Nearly every expensive bug in this app has been
two copies of one rule drifting apart — a holiday that one screen honoured and another did not, a
lateness rule with five copies, a timezone read two ways. **A new shared rule is a new row in that
file.**

The speed report prints **calls per visit** for each screen against a budget in `SCREEN_BUDGET_`
(`src/Perf.gs`). Every request queues behind the last one, so a screen quietly growing from four
round trips to nine is twice the wait with no single call getting slower. Raising a budget is a
decision taken once, with a reason — not something that happens by itself over six releases.
