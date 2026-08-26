/**
 * tools/test_android_apk.js — the .apk, and the two ways it can silently stop being an app.
 *   node tools/test_android_apk.js
 *
 * ASKED 2026-08-26: "ผู้ปกครองใช้มือถือหลายยี่ห้อ หลายรุ่น หลาย Model หลาย Browser มากๆ และยังเข้า
 * ใช้งานผ่าน Browser เราจะ Take Action กับกลุ่มนี้ก่อน โดยเข้า Link > .apk > ลงเครื่อง > ใช้งานได้เลย".
 *
 * WHY A TWA AND NOT A WebView WRAPPER. A WebView keeps its own permission store, which would have
 * fixed the location problem outright — and it cannot be used, because login here is LIFF-only and
 * LINE does not permit its OAuth screen inside an embedded WebView. The result would be an app
 * nobody can sign in to. That constraint is checked below, because "just wrap it in a WebView" is
 * the obvious idea and it will be suggested again.
 *
 * THE TWO SILENT FAILURES this file exists for — neither produces an error, both produce something
 * that looks fine and is not:
 *
 *  1. THE HANDSHAKE. Full screen with no address bar happens only when the app names the site
 *     (asset_statements) AND the site names the app's package + signing fingerprint
 *     (/.well-known/assetlinks.json). Break either half and the app still runs — with a URL bar,
 *     i.e. as the browser we were trying to get away from.
 *  2. THE SIGNING KEY. A release built with a different key cannot update an installed app; Android
 *     refuses with a signature mismatch and the parent must uninstall first. So the key is a
 *     one-time secret, it lives outside a PUBLIC repository, and an unsigned build must FAIL rather
 *     than produce a download that installs once and can never be updated.
 */
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const ROOT = path.join(__dirname, '..');
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const has = f => fs.existsSync(path.join(ROOT, f));

const app = R('webapp/app.js');
const manifest = JSON.parse(R('webapp/manifest.json'));
const amanifest = R('android/app/src/main/AndroidManifest.xml');
const strings = R('android/app/src/main/res/values/strings.xml');
const colors = R('android/app/src/main/res/values/colors.xml');
const gradle = R('android/app/build.gradle');
const wf = R('.github/workflows/android.yml');
const ks = R('tools/android_keystore.sh');
const gitignore = R('.gitignore');

const ORIGIN = 'https://legeant04-dot.github.io';
const PKG = 'th.ac.atomnursery.app';

console.log('\n1) the project exists and is a shell, not a second copy of the app');
{
  ['android/settings.gradle', 'android/build.gradle', 'android/app/build.gradle',
   'android/app/src/main/AndroidManifest.xml', 'android/app/src/main/res/values/strings.xml',
   'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png',
   'android/app/src/main/res/drawable/splash.png'].forEach(f => ok_(f, has(f)));
  /* NOT ONE LINE OF THE APP MAY BE COPIED IN HERE. The whole value of this approach is that
   * publishing the website publishes to Android; a stray .html or .js under android/ would be a
   * second copy that drifts, and nobody would notice until it disagreed with the live app. */
  const walk = d => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })
    .flatMap(e => e.isDirectory() ? walk(d + '/' + e.name) : [d + '/' + e.name]);
  const files = walk('android');
  eq('no web assets were copied into the shell',
    files.filter(f => /\.(html|js|css|webmanifest)$/i.test(f)), []);
  ok_('...and no Java/Kotlin either — the launcher comes from Google\u2019s library',
    files.filter(f => /\.(java|kt)$/i.test(f)).length === 0);
  ok_('which is the library it comes from',
    /com\.google\.androidbrowserhelper:androidbrowserhelper:/.test(gradle) &&
    /com\.google\.androidbrowserhelper\.trusted\.LauncherActivity/.test(amanifest));
  /* THE TWO DEPENDENCIES THAT LOOK REDUNDANT AND ARE NOT. Both were found by an actual build, not
   * by reading, and both fail at BUILD time rather than producing anything subtle — but a future
   * tidy-up would remove them on sight, so the reason is pinned here as well as in the file.
   *   · appcompat: the splash theme inherits Theme.AppCompat.NoActionBar, which androidbrowserhelper
   *     does not provide → "AAPT: error: resource style/Theme.AppCompat.NoActionBar not found".
   *   · kotlin-bom: appcompat 1.7 wants kotlin-stdlib 1.8.22 while the TWA chain still asks for
   *     kotlin-stdlib-jdk7/jdk8 1.6.21, whose classes 1.8 absorbed → "Duplicate class kotlin.…". */
  ok_('appcompat is present, because the splash theme needs it',
    /androidx\.appcompat:appcompat:/.test(gradle));
  ok_('...and the Kotlin BOM, because those two disagree about Kotlin',
    /platform\('org\.jetbrains\.kotlin:kotlin-bom:/.test(gradle));
  ok_('...each with the build error it prevents written next to it',
    /Theme\.AppCompat\.NoActionBar not found/.test(gradle) && /Duplicate class kotlin/.test(gradle));
}
{
  /* A COMPILE-ONLY RUN. The signing key can only be created once, by a person, and cannot be redone
   * quietly — so the project must be provable BEFORE that ceremony, not after. It builds the debug
   * variant, which is never published. */
  ok_('there is a dry run that needs no key', /dry_run:/.test(wf) && /assembleDebug/.test(wf));
  ok_('...and it publishes nothing', /if: \$\{\{ !inputs\.dry_run \}\}/.test(wf));
  const gated = wf.split('\n').filter(l => /^      - name: /.test(l)).length;
  const guards = (wf.match(/if: \$\{\{ !inputs\.dry_run \}\}/g) || []).length;
  eq('every release step is gated, so a dry run cannot sign or publish', guards, gated - 2); // version read + dry run itself
}

console.log('\n2) it opens the live site — so the web release IS the android release');
{
  const url = (/name="launch_url"[^>]*>([^<]+)</.exec(strings) || [, ''])[1].trim();
  eq('the launch URL is the published app', url, ORIGIN + '/atom-nursery/');
  ok_('...not a localhost or preview address', !/localhost|127\.0\.0\.1|file:/.test(strings));
  /* ONE VERSION NUMBER. APP_VERSION in webapp/app.js is the only one this project has; a second in
   * build.gradle would be a third place to forget on release day. */
  ok_('the APK takes its version from the web app', /-PappVersion=/.test(wf) && /appVersion/.test(gradle));
  ok_('...read with the same regex tools/release.js uses',
    /APP_VERSION\\s\*=\\s\*'Version\\s\+/.test(wf) || wf.indexOf("APP_VERSION\\s*=\\s*'Version\\s+(\\d+)\\.(\\d+)'") >= 0);
  ok_('...and versionCode only ever increases, because the web version does',
    /versionCode vCode/.test(gradle));
}

console.log('\n3) the handshake — both halves, naming the same things');
{
  // the app's half
  ok_('the app declares the site', /"site\\": \\"https:\/\/legeant04-dot\.github\.io\\"/.test(strings) ||
    strings.indexOf('\\"site\\": \\"' + ORIGIN + '\\"') >= 0);
  ok_('...as handle_all_urls, which is what a TWA needs',
    /delegate_permission\/common\.handle_all_urls/.test(strings));
  ok_('...and the manifest points the activity at it', /android:name="asset_statements"/.test(amanifest));
  // the site's half is written by the keystore script, because only it knows the fingerprint
  ok_('the site half is generated with the real fingerprint', /sha256_cert_fingerprints/.test(ks));
  ok_('...naming this exact package', ks.indexOf(PKG) >= 0 && amanifest.indexOf('${applicationId}') >= 0);
  eq('...and the package the gradle file builds', (/applicationId '([^']+)'/.exec(gradle) || [, ''])[1], PKG);
  ok_('...published at the origin root, which is the only place Chrome looks',
    /\.well-known\/assetlinks\.json/.test(ks));
  /* AND .nojekyll BESIDE IT. GitHub Pages runs Jekyll by default and Jekyll publishes NOTHING whose
   * name begins with a dot — so assetlinks.json was committed, pushed, reported as "pushed", and
   * served as a 404. Nothing failed and nothing warned; the app simply kept its address bar.
   * Cost a real run to find (2026-08-26). */
  ok_('...with .nojekyll, or Pages will not serve a dot-directory at all', /\.nojekyll/.test(ks));
  ok_('...and it is committed, not just written', /git add \.well-known\/assetlinks\.json \.nojekyll/.test(ks));
  ok_('...and the operator is told to verify, because a 404 is silent', /a 404 here means/.test(ks));
  /* A MISMATCH IS SILENT — the app runs, with a URL bar, and nothing says why. CI compares the two
   * and warns, because this log is the only place that would ever mention it. */
  ok_('CI compares the APK\u2019s fingerprint with the published one', /Compare with the fingerprint/.test(wf));
  ok_('...and says so when they differ', /Fingerprint mismatch/.test(wf));
  ok_('...and when the site half is missing altogether', /assetlinks\.json is not published/.test(wf));
}

console.log('\n4) the deep link is scoped to our own pages');
{
  ok_('the app offers to open the school\u2019s links', /android:autoVerify="true"/.test(amanifest));
  /* WITHOUT A PATH PREFIX this would claim every URL on legeant04-dot.github.io — including anything
   * unrelated ever published there — and parents would find the nursery app opening for it. */
  ok_('...only under /atom-nursery', /android:pathPrefix="\/atom-nursery"/.test(amanifest));
  ok_('...on the right host', /android:host="legeant04-dot\.github\.io"/.test(amanifest));
}

console.log('\n5) the signing key never touches a public repository');
{
  ok_('the build reads the key from the environment', /System\.getenv\('ATOM_KEYSTORE_PATH'\)/.test(gradle));
  ok_('...and never from a path inside the project', !/storeFile file\('(?!\$)/.test(gradle));
  /* AN UNSIGNED RELEASE MUST FAIL AT INSTALL, NOT LATER. Falling back to a debug key would install
   * happily on the first phone and then be unable to update it, months afterwards, with nothing to
   * point at. */
  ok_('no debug-key fallback is configured', !/signingConfigs\.debug/.test(gradle));
  ok_('CI refuses to build without the secret', /ATOM_KEYSTORE_BASE64 is not set/.test(wf));
  ok_('...and verifies the output really is signed', /apksigner"? verify/.test(wf));
  // the repo is PUBLIC: workflow artifacts and logs are world-readable
  ok_('the key is written outside the workspace', /\$HOME\/\.atomkeys/.test(wf));
  ok_('...and is never uploaded as an artifact', wf.indexOf('upload-artifact') < 0);
  /* Checked against the VALUE, not the name. "ATOM_KEYSTORE_BASE64 is not set" is an error message
   * and must stay allowed; what must never appear is the secret's content on a line that prints. */
  eq('...nor printed anywhere',
    wf.split('\n').filter(l => /(^|\s)(echo|cat|printf|ls -l)\b/.test(l) &&
      /\$KS_B64|\$\{\{ *secrets\.|\.p12\b/.test(l) &&
      // a pipe means it is being FED to something (base64 -d), not written to the log
      !/\|/.test(l)), []);
  ['*.p12', '*.jks', '*.keystore'].forEach(p =>
    ok_(`${p} is gitignored`, gitignore.split('\n').indexOf(p) >= 0));
  eq('and no key is committed today',
    fs.readdirSync(ROOT).filter(f => /\.(p12|jks|keystore)$/.test(f)), []);
}

console.log('\n6) the key is created once, by a person, without a JDK');
{
  ok_('the password is read from the terminal, not an argument', /read -rs PW1/.test(ks));
  ok_('...confirmed, because a typo only shows up as a CI failure later', /read -rs PW2/.test(ks));
  /* THE PASSWORD MAY ONLY EVER BE PIPED. Every line that mentions it must compare it or send it
   * down a pipe — never redirect it into a file, and never hand it to a command as an argument,
   * where it would sit in shell history and in `ps` for anyone else on the machine. */
  {
    const lines = ks.split('\n').filter(l => /\$PW[12]/.test(l) && !/^\s*[#*]/.test(l));
    ok_('the password is actually used, so this is checking something', lines.length >= 4);
    eq('every use is a pipe, a comparison or an unset',
      lines.filter(l => !(/\|\s/.test(l) || /^\s*\[/.test(l) || /=\s*"?\$PW/.test(l) || /^\s*unset /.test(l))), []);
    eq('...and it is never redirected into a file', lines.filter(l => /\$PW1[^|]*>\s*[^&\s]/.test(l)), []);
    ok_('...and it is dropped once the secrets are set', /unset PW1 PW2/.test(ks));
  }
  ok_('it is piped to openssl over stdin, so it stays out of `ps` and history', /-passout stdin/.test(ks));
  ok_('...and to gh the same way', /printf '%s' "\$PW1" \| gh secret set ATOM_KEYSTORE_PASSWORD/.test(ks));
  ok_('the keystore is base64\u2019d straight into gh, never onto disk', /base64[^|]*\| gh secret set ATOM_KEYSTORE_BASE64/.test(ks));
  ok_('it refuses to silently replace an existing key', /Use the EXISTING key\?/.test(ks));
  ok_('...and says what a second key would cost', /uninstall and reinstall/.test(ks));
  /* MSYS ON GIT BASH REWRITES AN ARGUMENT THAT LOOKS LIKE A PATH, and a certificate subject written
   * the usual way — "/CN=Atom Nursery/O=…" — looks exactly like one. It reaches openssl as
   * "C:/Program Files/Git/CN=Atom Nursery/…" and the command fails. This school runs its tooling on
   * Git Bash. A config file has no leading slash and behaves identically on every platform.
   * Asserted on the COMMAND, because the comment beside it necessarily names what it avoids. */
  {
    // the command is written across continuation lines, so take it up to the first line NOT ending
    // in a backslash — stopping at the first newline would miss every flag it is being checked for
    const cmd = (/openssl req(?:[^\n]*\\\n)*[^\n]*\n/.exec(ks) || [''])[0];
    ok_('there is a certificate command to check', /openssl req/.test(cmd));
    ok_('...and its subject comes from a config file', /-config/.test(cmd) && !/-subj/.test(cmd));
    ok_('...which is written right next to it', /distinguished_name = dn/.test(ks) && /^CN = Atom Nursery$/m.test(ks));
  }
  ok_('a 30-year certificate, so it cannot expire quietly', /-days 10950/.test(ks));
  ok_('no JDK is needed — openssl does the work', !/keytool/.test(ks));
}

console.log('\n7) what the parent is shown');
{
  ok_('there is a download card', /function apkCardHTML\(\)\{/.test(app));
  /* ANDROID ONLY. An iPhone cannot install an APK, and a button that cannot work — offered to half
   * the parents on the login screen — is worse than no button. */
  ok_('...offered only on Android', /if\(!isAndroid\(\)\) return '';/.test(app));
  ok_('...on the login screen, above the add-to-home-screen box',
    app.indexOf('${apkCardHTML()}') > 0 && app.indexOf('${apkCardHTML()}') < app.indexOf('${installButtonsHTML()}', app.indexOf('${apkCardHTML()}')));
  /* AND IT HAS TO BE THERE ON THE FIRST VISIT.
   *
   * loginScreen() deliberately does NOT redraw while index.html's static shell is on screen —
   * redrawing an identical card restarted LCP. So a card that lived only in loginScreen() was
   * invisible until something else replaced the shell: a parent reported first seeing it after
   * signing in and out again (2026-08-26). It is in the shell now, and REMOVED for anything that is
   * not Android, so the audience it is for gets it at first paint with no layout shift.
   */
  const idx = R('webapp/index.html');
  ok_('the shell carries the card too, or a first visit never sees it', /id="apkCard"/.test(idx));
  ok_('...above the add-to-home-screen box, same order as loginScreen',
    idx.indexOf('id="apkCard"') < idx.indexOf('class="card instbox"'));
  ok_('...and it opens the same walkthrough', /onclick="window\.APK_GET&&APK_GET\(\)"/.test(idx));
  ok_('...and is taken away on anything that is not Android',
    /if\(!isAndroid\(\)\)\{ const _c=document\.getElementById\('apkCard'\); if\(_c\) _c\.remove\(\); \}/.test(app));
  // the two copies must say the same thing, or the shell and the render disagree on screen
  ['ติดตั้งแอป Atom Nursery', 'ดาวน์โหลดสำหรับ Android', 'เปิดเต็มจอ ไม่มีแถบที่อยู่เว็บ']
    .forEach(s => ok_(`"${s.slice(0, 24)}…" is in both copies`, idx.indexOf(s) >= 0 && app.indexOf(s) >= 0));
  ok_('the link is the "latest" redirect, so it never has to be reprinted',
    /releases\/latest\/download\/atom-nursery\.apk/.test(app));
  eq('...and CI publishes under exactly that name',
    /gh release create "\$TAG" atom-nursery\.apk/.test(wf), true);
}
{
  /* THE TWO WARNINGS. Sideloading makes Android show "unknown apps from this source" and then Play
   * Protect's "ไม่รู้จักแอปนี้". Both are unavoidable off-Play. A parent who meets them unprepared
   * stops — it looks exactly like what they have been warned about — so they are named, in Android's
   * own words, BEFORE the download starts. */
  ok_('the unknown-source warning is described in advance', /ไม่ได้รับอนุญาตให้ติดตั้งแอปที่ไม่รู้จัก/.test(app));
  ok_('...and Play Protect', /ไม่รู้จักแอปนี้/.test(app) && /ติดตั้งต่อไป/.test(app));
  ok_('...with the reason, not just the tap', /ไม่ได้ผ่าน Play Store/.test(app));
  ok_('and that it is a one-time job', /ทำครั้งเดียวจบ/.test(app));
  ok_('the download is a plain link the browser handles', /<a class="btn block" href="\$\{APK_URL\}"/.test(app));
}

console.log('\n8) the shell matches the web app it wraps');
{
  const themeC = (/name="colorPrimary">([^<]+)</.exec(colors) || [, ''])[1].trim().toUpperCase();
  const bgC = (/name="backgroundColor">([^<]+)</.exec(colors) || [, ''])[1].trim().toUpperCase();
  eq('splash/status colours match manifest.json', [themeC, bgC],
    [manifest.theme_color.toUpperCase(), manifest.background_color.toUpperCase()]);
  eq('the web app is still installable as a PWA, which a TWA requires',
    [manifest.display, !!manifest.icons.find(i => i.sizes === '512x512')], ['standalone', true]);
  /* NO LOCATION PERMISSION IS DECLARED, on purpose: the site asks Chrome, exactly as in the browser.
   * Declaring it would add a second prompt at install time and grant the shell nothing it can use.
   * Read off the actual <uses-permission> declarations — the comment above them in the manifest
   * explains the omission and therefore has to name the permission it is not asking for. */
  {
    const perms = [...amanifest.matchAll(/<uses-permission\s+android:name="android\.permission\.([A-Z_]+)"/g)]
      .map(m => m[1]).sort();
    eq('the app asks for INTERNET and nothing else', perms, ['INTERNET']);
  }
}

console.log('\n9) the constraint that ruled out the obvious approach is written down');
{
  const readme = R('android/README.md');
  ok_('a WebView wrapper is documented as impossible, with the reason',
    /WebView/.test(readme) && /LIFF/.test(readme) && /embedded WebView/.test(readme));
  ok_('...and login really is LIFF-only, as claimed', /liff\.login\(\)/.test(app) &&
    app.indexOf('LIFF_ID') > 0);
  ok_('what the APK does NOT fix is stated too', /shares Chrome/.test(readme) && /still blocked/.test(readme));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
