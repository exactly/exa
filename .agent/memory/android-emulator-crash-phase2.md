# android emulator crash — phase 2 investigation (instrumented runs)

this file documents new findings from instrumenting the ci workflow with diagnostic streams.
it builds on `.agent/memory/android-emulator-adb-disconnect.md` and **corrects several assumptions**
from that earlier analysis.

## critical correction: the i/o hypothesis was wrong

the original analysis blamed nested-virt i/o pressure from gms module downloads. instrumented data
from two runs disproves this entirely:

- **memory**: 6.3 gb of 8 gb available (78% free) 3 seconds before death. `OomAdjuster` logged
  "Not killing cached processes" repeatedly.
- **cpu**: ~30% busy, load average *decreasing* (9.6 → 6.3 over 50s). no cpu saturation.
- **i/o**: 1.2% iowait. `/proc/pressure/io` reported no stall information.
- **gms downloads**: ml kit module downloads (`vision.ocr`, `barcode`, `face`) **failed and were
  throttled** — the system survived 33-40s after those failures. they are not the trigger.

the death is **instantaneous** with zero preceding resource degradation. this rules out any
gradual-pressure hypothesis (i/o storm, memory exhaustion, cpu saturation).

## precise crash trigger identified

the crash occurs at a **deterministic app screen transition**, identical in both instrumented runs:

1. maestro navigates through the app for ~55s without issues
2. taps "next" in the `sendAsset.yaml` flow
3. app navigates to the asset selection screen
4. `OpenGLRenderer: Failed to create image decoder with message 'unimplemented'` appears 12+ times
5. `StagefrightMetadataRetriever: Failed to instantiate a MediaExtractor` appears 3x
6. glide starts loading `USDC.svg`
7. frame times degrade: 58ms → 500ms
8. log cuts off instantly mid-view-hierarchy-traversal (maestro was mid-dump)
9. ~2 minutes later maestro reports "Timeout while fetching view hierarchy"
10. then "UNAVAILABLE: Keepalive failed. The connection is likely gone"

the asset selection screen renders multiple SVG token icons via glide. the image decoder failures
suggest swiftshader cannot handle whatever rendering operation the screen triggers.

## key finding: image decoder errors happen twice

the `OpenGLRenderer: Failed to create image decoder` error appears in two bursts:

- **first burst** at ~T+37s — system survives
- **second burst** at ~T+55s — system dies immediately after

this suggests cumulative state corruption or a specific rendering operation on the second screen
that pushes past a threshold.

## `-gpu guest` silently falls back to swiftshader

the `google_apis;x86_64` system image for api 34 does not support guest rendering. when launched
with `-gpu guest`, the emulator logs:

```text
WARNING | Your AVD has been configured with an in-guest renderer, but the system image does not
support guest rendering. Falling back to 'swiftshader_indirect' mode.
```

both instrumented runs used identical rendering backends. the `-gpu guest` attempt provided no new
information about the gpu hypothesis.

## revised hypothesis: swiftshader/qemu crash

the evidence points to the emulator's gpu rendering stack (swiftshader + gfxstream pipe transport)
as the crash trigger, not i/o pressure:

- crash is instantaneous (no gradual degradation)
- crash occurs at a specific rendering-heavy screen transition
- `OpenGLRenderer` errors precede every crash
- no resource pressure of any kind at time of death
- frame time degradation (58ms → 500ms) suggests rendering pipeline breakdown

the qemu process may be crashing (segfault in swiftshader or gfxstream), or the gfxstream pipe
between host and guest may be corrupting, causing the guest to hang waiting on a pipe read that
will never complete.

## instrumentation setup

### what works

- **live logcat stream** (`adb logcat -v threadtime > file &`): captures everything up to the exact
  moment of death. this is the most valuable artifact — 82,517 lines in the first run.
- **stats sampler** (single `adb shell` call every 10s): provides cpu/mem/load timeline. must use a
  single compound `adb shell '...'` command, not multiple concurrent calls.
- **qemu process liveness check** (`pgrep -f 'qemu-system'` + `kill -0`): distinguishes guest hang
  (qemu alive) from host crash (qemu dead). added in latest commit, results pending.

### what doesn't work

- **`dmesg`** (both `dmesg -T` and plain `dmesg`): returns 0 bytes on the `google_apis` emulator
  image. likely requires root, which we don't have without `adb root` (which restarts adbd).
- **guest-side logcat** (`logcat -f /data/local/tmp/logcat.log`): guest is completely dead at
  teardown. `adb pull` returns nothing useful.
- **multiple concurrent `adb shell` calls**: the first stats sampler design used 8 separate
  `adb shell` calls per sample, each with 5s timeout. transport contention caused the sampler to
  die after one iteration. collapsed to a single compound call with 8s timeout.
- **`top -bn1 -o %CPU -q` on android**: outputs cpu percentages without process names in the
  captured format. not useful for identifying which process is consuming resources.

## approaches tried (new, not in phase 1 doc)

### 14. diagnostic instrumentation

added live logcat, stats sampler, dmesg snapshots, guest logcat, and emulator health monitor to the
ci workflow. live logcat proved essential — it captured the exact moment of death. the stats sampler
confirmed no resource pressure.

### 15. `-gpu guest`

**hypothesis**: switch from host-side swiftshader to guest-side gpu rendering to eliminate
gfxstream transport overhead.

**result**: silently fell back to `swiftshader_indirect`. the `google_apis;x86_64` api 34 image
does not support guest rendering. identical crash at identical timing.

### 16. `-gpu off` (pending)

**hypothesis**: disable gpu rendering entirely. the guest uses a software framebuffer only.
`OpenGLRenderer` calls will fail/fallback, but maestro only needs ui element presence, not
rendering fidelity. if the crash disappears, it confirms the gpu stack as the culprit.

### 17. 16 gb guest ram (pending)

**hypothesis**: even though memory wasn't the bottleneck at 8 gb, doubling to 16 gb (host has
32 gb) provides more headroom for swiftshader's host-side memory allocations and page cache.

### 18. qemu process liveness check (pending)

added `pgrep -f 'qemu-system'` at maestro start and `kill -0` in the health monitor. when adb
becomes unresponsive, the monitor now reports:

- `qemu process ALIVE (guest hang)` — emulator running, guest frozen
- `qemu process DEAD (host crash)` — emulator process died (segfault, oom kill)

this will definitively classify the failure.

## updated hypotheses for future investigation

### gpu stack is the primary suspect

if `-gpu off` eliminates the crash:

1. **swiftshader bug**: the specific svg rendering path triggers a crash in swiftshader's software
   opengl implementation. possible fix: upgrade emulator version or use a different system image.
2. **gfxstream pipe corruption**: the host↔guest gpu pipe corrupts under nested kvm, causing the
   guest to block on a pipe read forever. possible fix: use a different gpu transport or disable
   gpu entirely for ci.
3. **svg rendering workaround**: the asset selection screen's svg icons (loaded via glide) could be
   replaced with pre-rasterized pngs for the e2e test build, avoiding the problematic rendering
   path entirely.

### if `-gpu off` doesn't help

the crash may be in the emulator's core (qemu) rather than the gpu stack. the qemu liveness check
will narrow this down. if qemu is dead, check for host-side oom kills (`dmesg` on the eas host,
not the guest). if qemu is alive and the guest is hung, the problem is in the guest kernel's
response to some operation that coincides with but isn't caused by gpu rendering.

## current workflow state

branch: `android` (was `flaky` in phase 1)

emulator config:

- `-gpu off` (disabled)
- `hw.ramSize=16384` / `-memory 16384` (16 gb)
- `-cores 4`
- avd on tmpfs (`/dev/shm/avd`)
- stability gate: `uiautomator dump` × 15 passes

diagnostic streams:

- live logcat (host-side, streaming to file)
- guest logcat (backup, pulled in teardown)
- stats sampler (single adb shell, 10s interval)
- dmesg before/after (likely empty without root)
- qemu process liveness check in health monitor

## related commits

- `18b30705` ⚗️ eas: instrument android e2e with diagnostic streams
- `b59a4b42` ⚗️ eas: switch to guest gpu, fix stats sampler and dmesg
- `4d4c37d7` ⚗️ eas: gpu off, 16gb guest ram, qemu crash detection
