#!/usr/bin/env bash
# tools/android_smoke.sh — install the APK on a running emulator and OPEN it.
#
#   bash tools/android_smoke.sh [path/to.apk]
#
# WHY THIS EXISTS. v286 shipped an APK that compiled, signed, verified and matched its own
# fingerprint — and died every single time it was opened. Every check was green because not one of
# them ran the app. Compiling is not working.
#
# WHY IT IS A FILE AND NOT INLINE IN THE WORKFLOW. reactivecircus/android-emulator-runner feeds its
# `script:` to `sh` ONE LINE AT A TIME, so a multi-line `if … fi` is split across invocations and
# dies with "Syntax error: end of file unexpected (expecting fi)". Anything with a block in it has
# to live in a file the workflow calls in a single line.
#
# WHAT COUNTS AS FAILURE. A launch crash does not always announce itself the same way, so all three
# shapes are checked: a FATAL EXCEPTION, an activity that gets force-finished, and a process that has
# simply gone by the time we look.
#
# Chrome is not on the emulator image, so the TWA takes its fallback path. That is fine and is not
# what is being tested — the question here is only whether the app SURVIVES BEING OPENED, which is
# exactly what was broken.
set -eu

APK="${1:-atom-nursery.apk}"
PKG="th.ac.atomnursery.app"
ACT="$PKG/com.google.androidbrowserhelper.trusted.LauncherActivity"
WAIT="${SMOKE_WAIT:-12}"

echo "── installing $APK"
adb install -r "$APK"

adb logcat -c
echo "── opening $ACT"
adb shell am start -n "$ACT"
sleep "$WAIT"
adb logcat -d > logcat.txt

fail() {
  echo "::error::$1"
  echo "── last 60 lines mentioning this app ──"
  grep -iE "$PKG|AndroidRuntime|ActivityManager" logcat.txt | tail -60 || true
  exit 1
}

if grep -qE "FATAL EXCEPTION" logcat.txt && grep -q "$PKG" logcat.txt; then
  echo "── the crash ──"
  sed -n '/FATAL EXCEPTION/,/^$/p' logcat.txt | head -60 || true
  fail "The app crashed on launch."
fi

if grep -q "Force finishing activity $PKG" logcat.txt; then
  fail "The launcher activity was force-finished — the app did not survive opening."
fi

PID="$(adb shell pidof "$PKG" 2>/dev/null || true)"
PID="$(printf '%s' "$PID" | tr -d '\r\n ')"
if [ -z "$PID" ]; then
  fail "The app is not running ${WAIT}s after launch — it opened and closed again."
fi

echo "✅ still alive (pid $PID) after ${WAIT}s — the app opened and stayed open"
