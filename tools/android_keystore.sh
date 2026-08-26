#!/usr/bin/env bash
# tools/android_keystore.sh — create the ONE signing key the Android app will ever have.
#
#   bash tools/android_keystore.sh
#
# Run this ONCE, on a machine you trust, and then keep the file it produces. Everything else about
# the Android build is automated; this is the only step that cannot be, because it creates a secret
# and only you should ever hold it.
#
# WHY THIS MATTERS MORE THAN IT LOOKS
#
#   · Android identifies an app by its signing key. Rebuild the APK with a different key and every
#     parent who already installed it CANNOT update — the install fails with a signature mismatch
#     and they have to uninstall first, which is a message you do not want to send to 60 families.
#   · The key's SHA-256 fingerprint is written into assetlinks.json on the website. It is what tells
#     Chrome that this app is allowed to show the school's site full screen with no address bar.
#     Lose the key and that handshake has to be redone along with everybody's install.
#
# WHAT THIS SCRIPT WILL AND WILL NOT TOUCH
#
#   · The keystore is written OUTSIDE the repository. This repository is PUBLIC, and a committed
#     signing key would let anyone build an APK that Android accepts as an update to the school's.
#   · The password is read from the terminal, never echoed, never written to a file, and never
#     passed on a command line (where it would land in your shell history).
#   · Both secrets go to GitHub through `gh secret set`, which encrypts them locally before they are
#     sent. They cannot be read back out afterwards — not by CI logs, not by anyone.
#
# Needs: openssl and gh (both already present). It does NOT need a JDK.
set -euo pipefail

OUT_DIR="${ATOM_KEYSTORE_DIR:-$HOME/atom-nursery-keystore}"
P12="$OUT_DIR/atom-release.p12"
ALIAS="atom"
REPO="legeant04-dot/atom-nursery"
SITE_REPO="legeant04-dot/legeant04-dot.github.io"
PKG="th.ac.atomnursery.app"

say() { printf '%s\n' "$*"; }
die() { printf '\n❌ %s\n' "$*" >&2; exit 1; }

command -v openssl >/dev/null || die "openssl not found."
command -v gh >/dev/null || die "GitHub CLI (gh) not found."
gh auth status >/dev/null 2>&1 || die "gh is not logged in. Run: gh auth login"

say ""
say "🔑 Atom Nursery — Android signing key"
say "─────────────────────────────────────────────────────────────"

if [ -f "$P12" ]; then
  say "A key already exists at:"
  say "   $P12"
  say ""
  say "DO NOT create a second one unless you have decided to make every parent"
  say "uninstall and reinstall. If you are just re-running this to re-upload the"
  say "secrets, answer y."
  printf 'Use the EXISTING key? [y/N] '
  read -r reuse
  case "$reuse" in y|Y) ;; *) die "Stopped. Nothing was changed." ;; esac
else
  mkdir -p "$OUT_DIR"
  chmod 700 "$OUT_DIR" 2>/dev/null || true
fi

# ---- the password ----------------------------------------------------------------------------
# Read twice and compared, because a typo here is not discovered until CI fails to sign, and the
# error it produces at that point says nothing about a password.
if [ ! -f "$P12" ]; then
  say ""
  say "Choose a password for the key. Write it down somewhere you will still have"
  say "it in five years — there is no way to recover it, and no way to re-issue"
  say "the key without breaking everyone's install."
  say ""
  printf 'Password: '      ; read -rs PW1; echo
  printf 'Password again: '; read -rs PW2; echo
  [ -n "$PW1" ] || die "Empty password."
  [ "$PW1" = "$PW2" ] || die "The two passwords do not match. Nothing was created."
  [ "${#PW1}" -ge 8 ] || die "Use at least 8 characters."

  say ""
  say "Generating a 2048-bit key, valid for 30 years…"
  # 30 years: an APK whose certificate expires stops being installable, and a school app should not
  # acquire a cliff edge nobody has written down.
  KEY="$OUT_DIR/.tmp.key.pem"; CRT="$OUT_DIR/.tmp.crt.pem"; CNF="$OUT_DIR/.tmp.req.cnf"
  trap 'rm -f "$KEY" "$CRT" "$CNF"' EXIT
  # The subject goes in a CONFIG FILE rather than -subj "/CN=…". On Git Bash (Windows) MSYS rewrites
  # any argument that looks like a path, and "/CN=Atom Nursery/O=…" looks exactly like one — it
  # arrives at openssl as "C:/Program Files/Git/CN=Atom Nursery/…" and the command fails. A config
  # file has no leading slash and behaves identically on Windows, macOS and Linux.
  cat > "$CNF" <<'CNF_EOF'
[req]
distinguished_name = dn
prompt = no
x509_extensions = v3
[dn]
CN = Atom Nursery
O  = Atom Nursery
L  = Bangkok
C  = TH
[v3]
basicConstraints = critical,CA:TRUE
subjectKeyIdentifier = hash
CNF_EOF
  openssl req -x509 -newkey rsa:2048 -sha256 -days 10950 -nodes \
    -config "$CNF" -keyout "$KEY" -out "$CRT" >/dev/null 2>&1
  # -passout via stdin, so the password never appears in `ps` output or shell history
  printf '%s' "$PW1" | openssl pkcs12 -export \
    -inkey "$KEY" -in "$CRT" -name "$ALIAS" \
    -out "$P12" -passout stdin >/dev/null 2>&1
  chmod 600 "$P12" 2>/dev/null || true
  rm -f "$KEY" "$CRT" "$CNF"; trap - EXIT
  [ -s "$P12" ] || die "openssl did not produce a keystore. Nothing was uploaded."
  say "✅ Created $P12"
else
  printf 'Password for the existing key: '; read -rs PW1; echo
  printf '%s' "$PW1" | openssl pkcs12 -in "$P12" -nokeys -passin stdin >/dev/null 2>&1 \
    || die "That password does not open the key. Nothing was changed."
fi

# ---- the fingerprint the website has to publish ------------------------------------------------
FP="$(printf '%s' "$PW1" | openssl pkcs12 -in "$P12" -nokeys -passin stdin 2>/dev/null \
      | openssl x509 -noout -fingerprint -sha256 \
      | sed 's/.*=//' | tr 'a-f' 'A-F')"
[ -n "$FP" ] || die "Could not read the certificate fingerprint."

# ---- hand both secrets to GitHub ---------------------------------------------------------------
# base64 goes straight into gh over a pipe: the encoded key is never written to disk, never shown on
# screen, and never reaches the shell history.
say ""
say "Uploading to GitHub (encrypted locally before it is sent)…"
base64 -w0 < "$P12" 2>/dev/null | gh secret set ATOM_KEYSTORE_BASE64 --repo "$REPO" \
  || base64 < "$P12" | tr -d '\n' | gh secret set ATOM_KEYSTORE_BASE64 --repo "$REPO"
printf '%s' "$PW1" | gh secret set ATOM_KEYSTORE_PASSWORD --repo "$REPO"
unset PW1 PW2
say "✅ ATOM_KEYSTORE_BASE64 and ATOM_KEYSTORE_PASSWORD are set on $REPO"

# ---- the site's half of the handshake ----------------------------------------------------------
ASSET_JSON=$(cat <<JSON
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "$PKG",
    "sha256_cert_fingerprints": ["$FP"]
  }
}]
JSON
)

say ""
say "─────────────────────────────────────────────────────────────"
say "SHA-256 fingerprint of the signing key (this is public — it is"
say "meant to be published, and it reveals nothing about the key):"
say ""
say "   $FP"
say ""

TMP="$(mktemp -d)"
if gh repo view "$SITE_REPO" >/dev/null 2>&1; then
  say "Publishing assetlinks.json to $SITE_REPO…"
  git clone -q "https://github.com/$SITE_REPO.git" "$TMP/site"
  mkdir -p "$TMP/site/.well-known"
  printf '%s\n' "$ASSET_JSON" > "$TMP/site/.well-known/assetlinks.json"
  ( cd "$TMP/site"
    git add .well-known/assetlinks.json
    if git diff --cached --quiet; then
      echo "   (already up to date)"
    else
      git commit -q -m "assetlinks: Atom Nursery Android app fingerprint"
      git push -q
      echo "   pushed"
    fi )
  rm -rf "$TMP"
  say ""
  say "✅ Done. GitHub Pages takes a minute or two, then check:"
  say "   https://legeant04-dot.github.io/.well-known/assetlinks.json"
else
  printf '%s\n' "$ASSET_JSON" > "$TMP/assetlinks.json"
  say "⚠️  $SITE_REPO does not exist yet, so assetlinks.json was not published."
  say "   Without it the app still works — it just shows an address bar."
  say "   The file to publish at /.well-known/assetlinks.json is here:"
  say "   $TMP/assetlinks.json"
fi

say ""
say "─────────────────────────────────────────────────────────────"
say "⚠️  BACK UP THIS FILE somewhere that is not this laptop:"
say "      $P12"
say "    …together with the password. Losing either one means every"
say "    parent has to uninstall and reinstall to ever get an update."
say ""
say "Next: build the APK →  gh workflow run android.yml --repo $REPO"
say ""
