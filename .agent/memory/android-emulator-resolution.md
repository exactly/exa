# android emulator e2e — resolution

## the fix

**use android-32 google_apis instead of android-34 google_apis.**

```yaml
avdmanager -s create avd -n e2e -k "system-images;android-32;google_apis;x86_64" --force
```

## why android-34 crashes

android-34 google_apis with `swiftshader_indirect` crashes (qemu segfault) when rendering the
asset selection screen. the crash occurs in gfxstream/swiftshader code during OpenGL operations.
android-32 google_apis does not have this issue.

## why ATD images don't work for screenshots

ATD (automated test device) images are headless by design:
- `hw.gpu.enabled=no` by default
- no framebuffer for `adb screencap`
- screenshots return completely black
- tests pass but visual verification impossible

Xvfb does NOT help because `adb screencap` captures from android's internal framebuffer,
not the host X display.

## available images on EAS

from the error output when requesting unavailable images:

```
system-images;android-30;google_apis;x86_64
system-images;android-32;google_apis;x86_64
system-images;android-34;google_apis;x86_64
system-images;android-35;google_apis;x86_64
```

android-33 is NOT available.

## configuration that works

```yaml
- name: start emulator
  run: |
    adb kill-server && adb start-server
    avdmanager -s create avd -n e2e -k "system-images;android-32;google_apis;x86_64" --force
    printf '%s\n' "hw.ramSize=8192" "vm.heapSize=1024" ... >> $HOME/.android/avd/e2e.avd/config.ini
    setsid $ANDROID_HOME/emulator/emulator -avd e2e -no-snapshot -no-snapshot-save -no-window \
      -no-audio -no-boot-anim -gpu swiftshader_indirect -netfast -no-metrics \
      -memory 8192 -cores 2 -partition-size 4096 -wipe-data > emulator-process.log 2>&1 &
    ...
```

key flags:
- `-gpu swiftshader_indirect` — software rendering (required for nested virtualization)
- `-no-window` — headless (fine for google_apis, screenshots still work)
- `setsid` — detaches emulator from shell session

## related investigation

see `.agent/memory/android-emulator-crash-phase2.md` and
`.agent/memory/android-emulator-screenshot-phase3.md` for detailed investigation history.
