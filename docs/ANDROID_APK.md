# The Android app (.apk)

Parents are on every brand, model and browser there is, and the browser is where the trouble comes
from — LINE's in-app browser, manufacturer browsers, address bars, and permission state nobody can
see. The APK removes the variable: one engine, one icon, no address bar.

**The link to give parents — it never changes:**

```
https://github.com/legeant04-dot/atom-nursery/releases/latest/download/atom-nursery.apk
```

`releases/latest/download/…` always redirects to the newest build with that filename, so a QR code
printed from it stays correct for ever. Parents do not have to be given that URL at all, though:
on an Android phone the login screen shows a **📱 ติดตั้งแอป Atom Nursery** card with a download
button and the install walkthrough. iPhones do not see it — they cannot install an APK.

---

## What it is, and what it is not

It is a **Trusted Web Activity**: a real Android app that renders the live website with the phone's
Chrome engine. There is no second copy of the app inside it. **Publishing the web app publishes to
Android** — the shell only needs rebuilding when something in `android/` changes.

### Why not a WebView wrapper

A WebView keeps its **own** permission store, so location would have started from a clean slate
instead of inheriting whatever the parent's browser already decided. That is genuinely better, and
it is not available to us: **login is LIFF-only** (`webapp/app.js` → `LIFF_LOGIN`), and LINE does
not permit its OAuth screen to run inside an embedded WebView. The result would be a good-looking
app that nobody can sign in to.

### What the APK does not fix

A TWA shares Chrome's profile, and therefore Chrome's **site settings**. A parent who has already
blocked location for this origin in Chrome is *still blocked inside the app*. What it does remove is
the LINE in-app browser and the OEM browsers, which is where most of the trouble actually came from.
The in-app guidance added in v285 (`GEO_blocked`) is still the answer for the rest.

---

## Setting it up — once, ever

### 1. Create the signing key

```bash
bash tools/android_keystore.sh
```

It asks for a password, creates the key **outside** the repository, uploads both secrets to GitHub
encrypted, and publishes `assetlinks.json` to the domain-root repository.

> **Back up `~/atom-nursery-keystore/atom-release.p12` and its password.**
> Android identifies an app by its signing key. Rebuild with a different one and every parent who
> already installed it *cannot update* — they get a signature-mismatch error and have to uninstall
> first. This is the one step in the whole system that cannot be redone quietly.

Needs `openssl` and `gh`. It does **not** need a JDK.

### 2. Build

```bash
gh workflow run android.yml --repo legeant04-dot/atom-nursery
```

GitHub Actions has JDK 17 and the Android SDK; this machine has neither, which is why the build does
not run locally. It builds, checks the APK really is signed, compares the signing fingerprint with
the one the website publishes, and attaches `atom-nursery.apk` to a Release.

It is **manual on purpose**. The shell wraps the live site, so a web release already reaches every
phone; rebuilding the APK for a web change would produce a stream of identical releases and train
everyone to ignore them.

---

## The handshake, and how it fails

Full screen with no address bar happens only when **both** sides vouch for each other:

| side | where | what it says |
|---|---|---|
| app | `android/…/res/values/strings.xml` → `asset_statements` | "I belong to `legeant04-dot.github.io`" |
| site | `https://legeant04-dot.github.io/.well-known/assetlinks.json` | "package `th.ac.atomnursery.app`, signed with `<SHA-256>`, may speak for me" |

Break either half and **the app still runs — with a URL bar**. Nothing errors, nothing is logged on
the phone, and it looks like the browser we were trying to escape. That is why the build compares
the two fingerprints and warns; the CI log is the only place that would ever mention it.

The site half must be at the **origin root**, which is why
[`legeant04-dot/legeant04-dot.github.io`](https://github.com/legeant04-dot/legeant04-dot.github.io)
exists — this repository is served under `/atom-nursery/` and cannot host it.

---

## What parents will see

Two warnings, both unavoidable for any app not distributed through Google Play, both described in
the app *before* the download starts (see `APK_GET` in `webapp/app.js`):

1. **"ไม่ได้รับอนุญาตให้ติดตั้งแอปที่ไม่รู้จัก"** → Settings → allow from this source → Back.
2. **Play Protect: "ไม่รู้จักแอปนี้"** → รายละเอียดเพิ่มเติม → ติดตั้งต่อไป.

Being surprised by a security warning is what makes people distrust an app; being told to expect one
does the opposite. Do not remove those steps to make the screen shorter.

---

## Things that will bite

- **The signing key is the whole ballgame.** Lost key = every parent uninstalls and reinstalls.
- **This repository is PUBLIC.** Workflow artifacts and logs are world-readable, which is why the
  key is never uploaded as an artifact, never echoed, and written outside the workspace at build time.
- **`versionCode` must only ever increase.** It is taken from `APP_VERSION`, which already does.
- **The deep link is scoped to `/atom-nursery`.** Without the path prefix the app would offer to
  open every URL on `legeant04-dot.github.io`, including anything unrelated published there later.
- **Colours are duplicated** in `res/values/colors.xml` because an APK cannot read `manifest.json` at
  build time. `tools/test_android_apk.js` fails if the two drift apart.
