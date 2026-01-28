# android emulator screenshot — phase 3 investigation

this file documents the investigation into black screenshots on ATD images and the
"next button not found" issue after keyboard dismissal. it builds on
`.agent/memory/android-emulator-crash-phase2.md`.

## summary of phase 2 resolution

the qemu segfault was **fixed** by switching from `google_apis` to `google_atd` image.
the crash was caused by swiftshader/gfxstream rendering the asset selection screen on
`google_apis`. ATD images have different (lighter) rendering internals that avoid the crash.

## new issue: black screenshots on ATD

after fixing the crash, two new issues appeared:

1. **"next" button not found** after keyboard dismissal
2. **screenshots are completely black**

## keyboard dismissal race condition

### symptom

maestro flow fails at `sendAsset.yaml` line 8 — cannot find "Next" button after hiding keyboard.

### root cause

the original flow used `hideKeyboard` which ATD's IME service cancelled:

```text
ImeTracker: onCancelled at PHASE_SERVER_SHOULD_HIDE
```

the fix attempted `pressKey: back` instead, but this caused a **race condition**:

1. `inputText` completes
2. react native's TextInput triggers `ORIGIN_CLIENT_HIDE_SOFT_INPUT` (app dismisses keyboard)
3. maestro presses back 100ms later
4. keyboard is already dismissing, so back **navigates back** to previous screen
5. "Next" button doesn't exist on portfolio screen

### evidence from logs

```text
12:39:55.130 ImeTracker: onRequestHide at ORIGIN_CLIENT_HIDE_SOFT_INPUT
12:39:55.231 maestro: "Press Back key" RUNNING
12:39:56.169 maestro: "Press Back key" COMPLETED
12:39:56.169 maestro: "Tap on Next" RUNNING
12:40:13.339 maestro: "Tap on Next" FAILED
```

the logcat showed portfolio screen elements (`You're all set!`, `Latest activity`) being
traversed — confirming navigation occurred.

### solution

tap on a non-interactive element (the "To:" label) to blur the input field. this dismisses
the keyboard naturally without navigation risk:

```yaml
- inputText: ${to}
- tapOn: { text: "To:", waitToSettleTimeoutMs: 0 }
- tapOn: { text: Next, waitToSettleTimeoutMs: 0 }
```

## black screenshots investigation

### fundamental limitation of ATD images

ATD (automated test device) images are **headless by design**. from the
[emulator.wtf blog](https://blog.emulator.wtf/posts/2022-04-15-atd-images/):

> "screenshot tests that depend on hardware rendering currently aren't supported when using ATDs"
> "hardware rendering being disabled"
> "the device doesn't render anything except a solid color"

the ATD image ships with `hw.gpu.enabled=no` in its default config. this disables the
framebuffer that `adb screencap` and UiAutomator rely on.

### approaches tried

| approach | result |
| -------- | ------ |
| `hw.gpu.enabled=yes` via sed | still black — swiftshader_indirect overrides |
| `-gpu swiftshader` instead of `swiftshader_indirect` | emulator ignores, falls back to indirect |
| switch to `google_apis` with vulkan disabled | qemu segfault returned |
| `default` (AOSP) image | user rejected — needs google APIs for FCM |
| Xvfb virtual display | socket creation fails without root |
| `xvfb-run` wrapper | blocks waiting for emulator to finish |
| `nohup xvfb-run ... &` | pending verification |

### why enabling GPU doesn't help

the emulator process log shows:

```text
library_mode swiftshader_indirect gpu mode swiftshader_indirect
```

regardless of `hw.gpu.enabled` setting, the `-gpu swiftshader_indirect` flag forces
host-side software rendering via gfxstream. the framebuffer exists in the host process
but isn't exposed to the guest's screencap mechanism on ATD.

### Xvfb approach (in progress)

the theory: run emulator **without** `-no-window` inside a virtual X display. this gives
the emulator a "real" display to render to, which screencap can capture.

challenges encountered:

1. **xvfb not installed** on EAS — fixed with `sudo apt-get install -y xvfb`
2. **socket creation fails** — `/tmp/.X11-unix` can't be created without root
3. **xvfb-run blocks** — it waits for the wrapped command to complete

current attempt uses `nohup xvfb-run ... &` to properly background the emulator while
xvfb-run manages the virtual display.

## key learnings

### ATD image characteristics

- optimized for CI: 40% faster boot, lower resource usage
- includes google APIs (FCM works)
- **no hardware rendering** — screenshots return black
- `hw.gpu.enabled=no` by default
- stable with swiftshader (no qemu crash)

### google_apis image characteristics

- full google play services
- hardware rendering enabled
- supports screenshots
- **crashes with swiftshader** on rendering-heavy screens (asset selection)
- vulkan disable (`-feature -Vulkan`) doesn't prevent crash

### keyboard dismissal patterns

- `hideKeyboard` — relies on IME service, ATD may cancel
- `pressKey: back` — dangerous, can navigate away if keyboard already dismissed
- **tap to blur** — safest approach, works across all images

### emulator GPU modes

| mode | behavior on EAS |
| ---- | --------------- |
| `swiftshader_indirect` | works, but ATD screenshots black |
| `swiftshader` | falls back to indirect |
| `angle_indirect` | hangs (no vulkan in nested kvm) |
| `host` | no GPU available |
| `off` / `guest` | falls back to swiftshader |

## current workflow state

branch: `android`

configuration:

- image: `google_atd;x86_64` (stable, has google APIs)
- gpu: `swiftshader_indirect`
- `hw.gpu.enabled=yes` (via sed)
- xvfb virtual display (via `nohup xvfb-run`)
- keyboard dismiss: tap "To:" label to blur

## related commits

- `5fa208de` 🐛 app: dismiss keyboard via back key for atd compatibility (wrong approach)
- `56c3466d` 🐛 eas: tap to blur instead of back key, enable gpu for screencap
- `30a50283` ⚗️ eas: google_atd with gpu enabled for screenshots
- `486ace6e` ⚗️ eas: try -gpu swiftshader instead of swiftshader_indirect
- `830692f1` ⚗️ eas: use Xvfb virtual display for proper framebuffer screenshots
- `a91a62be` 🐛 eas: install xvfb before using it
- `044af8e6` 🐛 eas: pass DISPLAY to emulator via env prefix
- `15816f8f` ⚗️ eas: use xvfb-run instead of manual Xvfb
- `86c266fc` 🐛 eas: use nohup to properly background xvfb-run + emulator
