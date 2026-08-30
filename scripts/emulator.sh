#!/usr/bin/env bash
#
# Run the standalone APK on an emulator.
#
# The security review (docs/security-review-2026-08-30.md) could not observe
# the app at runtime, and several of its open questions only a running Android
# can answer: what Auto Backup actually offers up, what the splash icon renders
# at, and what leaves the device when prices refresh. This is that machine.
#
# ONE-TIME SETUP
#
#   1. The SDK pieces, which need no privileges:
#
#        sdkmanager emulator "system-images;android-36;google_apis;x86_64"
#        avdmanager create avd -n contour -d pixel_6 \
#          -k "system-images;android-36;google_apis;x86_64"
#
#      Then set the screen to match the phone the bug reports come from, a
#      Galaxy S24, in ~/.android/avd/contour.avd/config.ini:
#
#        hw.lcd.width=1080  hw.lcd.height=2340  hw.lcd.density=480
#
#      1080/3 = 360dp wide, which is what every dp figure in
#      docs/android-launch.md was measured against.
#
#   2. Hardware acceleration, which does need privileges, once:
#
#        sudo usermod -aG kvm "$USER"      # then log out and back in
#
#      Without it `emulator -accel-check` reports "This user doesn't have
#      permissions to use KVM" and the emulator either refuses or falls back to
#      software emulation, which is too slow to be worth waiting for.
#
# USAGE
#
#   scripts/emulator.sh              # boot, headless, and wait until usable
#   scripts/emulator.sh --install    # ...then install the APK and launch it
#
set -euo pipefail

SDK="${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}"
ADB="$SDK/platform-tools/adb"
AVD="${CONTOUR_AVD:-contour}"
APK="android/app/build/outputs/apk/debug/app-debug.apk"
PKG="app.contour.standalone"

if ! "$SDK/emulator/emulator" -accel-check >/dev/null 2>&1; then
  echo "No KVM access. Run:  sudo usermod -aG kvm $USER   then log out and back in." >&2
  "$SDK/emulator/emulator" -accel-check 2>&1 | head -3 >&2
  exit 1
fi

if ! "$ADB" devices | grep -q emulator; then
  echo "Booting $AVD…"
  # swiftshader_indirect because this runs headless over ssh as often as not,
  # and a host GPU is not something to assume.
  "$SDK/emulator/emulator" -avd "$AVD" -no-window -no-audio -no-boot-anim \
    -gpu swiftshader_indirect -netdelay none -netspeed full \
    > /tmp/contour-emulator.log 2>&1 &
  "$ADB" wait-for-device
  until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
    sleep 2
  done
fi

echo "Android $("$ADB" shell getprop ro.build.version.release | tr -d '\r')" \
     "(API $("$ADB" shell getprop ro.build.version.sdk | tr -d '\r'))," \
     "$("$ADB" shell wm size | tr -d '\r' | sed 's/.*: //')" \
     "at $("$ADB" shell wm density | tr -d '\r' | sed 's/.*: //')dpi"

if [ "${1:-}" = "--install" ]; then
  [ -f "$APK" ] || { echo "No APK at $APK — run npm run android:build first." >&2; exit 1; }
  "$ADB" install -r "$APK"
  "$ADB" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
  echo "Installed and launched $PKG."
fi

cat <<'NEXT'

What this machine is for, from the review's open questions:

  Backup (issue #60) — what Auto Backup actually takes:
    adb shell bmgr enable true
    adb shell bmgr backupnow app.contour.standalone
    adb shell dumpsys backup | sed -n '/app.contour.standalone/,+8p'

  Egress (issue #62) — what leaves when prices refresh. Boot with
    -http-proxy http://10.0.2.2:8080 and point it at a TLS-terminating proxy;
    the app pins nothing, so a user CA in the emulator's store is enough.

  The splash icon (docs/android-launch.md) — the 288dp canvas rule was
    derived from three builds on one phone and never checked on a second
    device. This is the second device.
NEXT
