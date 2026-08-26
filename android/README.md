# android/ — the Atom Nursery Android app (.apk)

A **Trusted Web Activity**: a real Android app, with its own icon and no address bar, that renders
`https://legeant04-dot.github.io/atom-nursery/` using the phone's Chrome engine. There is no second
copy of the app in here — no HTML, no JavaScript, no business logic. Publishing the web app still
publishes to Android; this shell only has to be rebuilt when something in *this folder* changes.

## Why a TWA and not a WebView wrapper

A plain WebView wrapper is the obvious way to do this, and it would have been better in one respect:
a WebView keeps its **own** permission store, so location would start from a clean slate instead of
inheriting whatever the parent's browser already decided (see `webapp/app.js` → `GEO_STATE`).

It is not an option here. **Login is LIFF-only** (`app.js` → `LIFF_LOGIN` → `liff.login()`), and LINE
does not permit its OAuth screen to run inside an embedded WebView. The result would be a good
looking app that nobody can sign in to.

A TWA runs *in Chrome*, so LINE login behaves exactly as it does today.

## What this does and does not fix

**Does:** everybody lands in the same engine. No LINE in-app browser, no manufacturer browser, no
address bar, an icon on the home screen. That is the browser zoo problem, solved.

**Does not:** a TWA shares Chrome's profile, so it also shares Chrome's **site settings**. A parent
who has already blocked location for this origin in Chrome is still blocked inside the app. The
in-app guidance added in v285 is what handles those; it is not made redundant by this.

## Files

| file | why it exists |
|---|---|
| `app/build.gradle` | pins the toolchain and reads the signing key from env |
| `app/src/main/AndroidManifest.xml` | the TWA launcher, and the origin it is allowed to own |
| `res/values/strings.xml` | `asset_statements` — the app's half of the domain handshake |
| `res/values/styles.xml`, `colors.xml` | splash screen, matched to the web app's theme colour |

## The two-sided handshake

Full screen with no address bar only happens when the app and the website **both** vouch for each
other. Either half missing and Chrome falls back to showing a URL bar — the app still works, it just
looks like a browser again, which is the thing we were trying to get rid of.

- the app's half: `asset_statements` in `strings.xml` (points at the origin)
- the site's half: `https://legeant04-dot.github.io/.well-known/assetlinks.json`, which must name
  this app's package id **and the SHA-256 of the key it was signed with**

That fingerprint is why the signing key is not a formality here: change the key and the handshake
breaks *and* every parent has to uninstall before they can update. See `tools/android_keystore.sh`.

## Building

Not on this machine — it needs JDK 17 and the Android SDK. `.github/workflows/android.yml` builds it
on GitHub Actions and attaches the APK to a Release. See `docs/ANDROID_APK.md` for the whole path
from key to download link.
