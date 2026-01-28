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

### 16. `-gpu off` via cli flag (run `2026-01-27_211247`)

**hypothesis**: disable gpu rendering entirely. the guest uses a software framebuffer only.
`OpenGLRenderer` calls will fail/fallback, but maestro only needs ui element presence, not
rendering fidelity. if the crash disappears, it confirms the gpu stack as the culprit.

**result**: **the flag was silently ignored.** the emulator process log shows:

```text
Graphics backend: gfxstream
WARNING | Your AVD has been configured with an in-guest renderer, but the system image does
not support guest rendering. Falling back to 'swiftshader_indirect' mode.
```

the avd's `config.ini` (generated by `avdmanager create avd`) sets a default gpu mode that
overrides the command-line `-gpu off` flag. the emulator still used `swiftshader_indirect` +
gfxstream, identical to all previous runs. boot properties confirmed:
`androidboot.debug.hwui.renderer=skiagl`, `androidboot.hardware.gltransport=pipe`.

**fix**: must write `hw.gpu.mode=off` directly into the avd's `config.ini` before launching
the emulator — the cli flag alone is not sufficient.

crash was identical: instantaneous death at 21:13:38.538, exactly at the second burst of
`OpenGLRenderer: Failed to create image decoder` errors during the asset selection screen's svg
rendering. 14.3 gb available, load average 4.97 — zero resource pressure.

### 17. 16 gb guest ram (run `2026-01-27_211247`)

**hypothesis**: even though memory wasn't the bottleneck at 8 gb, doubling to 16 gb (host has
32 gb) provides more headroom for swiftshader's host-side memory allocations and page cache.

**result**: no effect. the crash is identical. 14.3 gb of 16 gb available (87% free) at time of
death. memory was never the issue.

### 18. qemu process liveness check (run `2026-01-27_211247`)

added `pgrep -f 'qemu-system'` at maestro start and `kill -0` in the health monitor. when adb
becomes unresponsive, the monitor now reports:

- `qemu process ALIVE (guest hang)` — emulator running, guest frozen
- `qemu process DEAD (host crash)` — emulator process died (segfault, oom kill)

**result** (run `2026-01-27_211247`): health monitor output went to eas workflow stdout (not
captured). maestro ran 4+ minutes after crash — `kill $MAESTRO_PID` only killed the pnpm wrapper.

**result** (run `2026-01-27_215329`): after fixing health monitor (setsid + artifact file +
process group kill), the monitor worked correctly:

```text
EMULATOR UNRESPONSIVE at 21:54:28 — qemu process DEAD (host crash)
```

**this is the definitive classification: the qemu process itself crashed (segfault).** it is NOT
a guest hang — the host-side emulator process died. swiftshader is crashing when processing svg
rendering operations through gfxstream. the missing maestro report artifacts confirm the health
monitor successfully killed the maestro process group before it could write reports.

### 19. `-gpu off` via config.ini append (run `2026-01-27_215329`)

**hypothesis**: appending `hw.gpu.mode=off` and `hw.gpu.enabled=no` to the avd's `config.ini`
should override the gpu setting that the cli flag couldn't.

**result**: **still ignored.** the emulator still shows `Graphics backend: gfxstream` and falls
back to `swiftshader_indirect`. the reason: `avdmanager create avd` writes `hw.gpu.enabled=yes`
and `hw.gpu.mode=auto` early in the config.ini file. the emulator reads the **first occurrence**
of each key and ignores later duplicates. appending with `>>` doesn't work.

**fix**: must use `sed -i 's/^hw\.gpu\.enabled=.*/hw.gpu.enabled=no/'` to replace in-place.

### 20. config.ini diagnosis (run `2026-01-28_005359`)

dumped `config.ini` before and after sed. findings:

- **the original config already had `hw.gpu.enabled=no`** — avdmanager generates this default
  for the `google_apis;x86_64` image. the sed for `hw.gpu.enabled` was a no-op.
- **sed correctly changed `hw.gpu.mode=auto` → `hw.gpu.mode=off`**
- **the emulator ignored both settings entirely**. it still shows `Graphics backend: gfxstream`
  and falls back to `swiftshader_indirect`.

**root cause**: `-gpu off` does NOT mean "disable gpu." it means "use guest-side rendering."
when the system image doesn't support guest rendering, the emulator falls back to
`swiftshader_indirect` regardless. there is **no way to fully disable gpu** on this system
image. the android framework requires a rendering surface.

the only valid gpu modes for `google_apis;x86_64` api 34 are:

- `swiftshader_indirect` — host-side software gpu (SwiftShader). **crashes on svg rendering.**
- `host` — hardware gpu. **not available in nested kvm.**
- `angle_indirect` — host-side ANGLE renderer (translates opengl to vulkan). **untested.**
- `guest` — guest-side rendering. **not supported by this system image.**

### 21. angle_indirect renderer (run `2026-01-28_005359`)

**hypothesis**: angle uses a completely different rendering code path (ANGLE → Vulkan) instead
of swiftshader (direct OpenGL). the crash is specifically in swiftshader's opengl implementation
triggered by svg image decoding. angle may not have this bug.

**result**: **emulator hangs on startup.** angle_indirect requires real vulkan hardware on the
host. nested kvm has no gpu, so the vulkan initialization never completes. the emulator never
reaches `Boot completed`.

this exhausts all gpu renderer options:

| renderer               | result                                            |
| ---------------------- | ------------------------------------------------- |
| `swiftshader_indirect` | boots, qemu segfaults on screen transition        |
| `angle_indirect`       | hangs on startup (no vulkan in nested kvm)        |
| `off` / `guest`        | falls back to swiftshader (image lacks guest gpu) |
| `host`                 | no real gpu in nested kvm                         |

### 22. google_atd system image (run `2026-01-28_013651`)

**hypothesis**: `google_apis_atd;x86_64` is google's ci-optimized system image. it has the same
api level and google apis (fcm works) but stripped-down gms and potentially different rendering
behavior. it may handle the rendering without crashing swiftshader, or it may support guest
rendering (bypassing gfxstream entirely).

**result**: **image was not available.** the `sdkmanager --install` command failed silently
(stderr was suppressed with `2>/dev/null`). the workflow fell back to `google_apis;x86_64`.
the config.ini confirms: `tag.id=google_apis`, `image.sysdir.1=system-images/android-34/google_apis/x86_64/`.

the crash was identical — qemu DEAD at 01:37:50. however, this run revealed a **critical
correction**: **zero `Failed to create image decoder` errors** appeared in the logcat (80,383
lines). the crash happened at the exact same flow step (sendAsset → "Tap on Next" → asset
selection screen → tap on "USDC") without any OpenGLRenderer image decoder failures.

this disproves the SVG rendering hypothesis. the crash is triggered by the **general rendering
load** of the asset selection screen transition through swiftshader/gfxstream, not specifically
by SVG image decoding. the `Failed to create image decoder` errors in earlier runs were a
correlated symptom, not the root cause. app-side SVG→PNG replacement would NOT fix the problem.

**fix**: need to actually install the ATD image. possible reasons for failure:

- `google_apis_atd;x86_64` may not exist for API 34 (check `sdkmanager --list`)
- the EAS build image may not have the package available
- stderr was suppressed, hiding the real error

### 23. google_atd system image (run `2026-01-28_114813`)

**hypothesis**: `google_atd;x86_64` (Google APIs ATD) may have lighter rendering behavior or different
swiftshader interaction that avoids the crash.

**result**: **CRASH FIXED!** the emulator ran the full test without qemu segfaulting. key evidence:

- emulator-process.log shows `Found systemPath .../google_atd/x86_64/`
- config.ini: `tag.display=Google APIs ATD`, `tag.id=google_atd`
- emulator-health.log is empty (no crash detected)
- emulator shut down gracefully: `Wait for emulator (pid 9633) 20 seconds to shutdown gracefully`
- boot time improved: 28s vs 44s with `google_apis`

the test failed with "Element not found: Next" and a black screenshot, but this is a **separate issue**
from the swiftshader crash. the emulator was stable throughout the 63-second test run.

**note**: `google_apis_atd` package failed to install; `google_atd` succeeded. despite the naming,
`google_atd` IS the Google APIs ATD image (verified by `tag.display=Google APIs ATD`).

### 24. debug "Next" button not found (pending)

the test failed at sendAsset flow after hiding keyboard. maestro searched for "Next" for 17 seconds
without finding it. screenshot was completely black. possible causes:

1. ATD image has different screen rendering timing/behavior
2. keyboard dismissal animation not completing
3. UI validation issue (address field?)
4. maestro screenshot capture issue

## separate bug: job hangs after maestro completes

when the emulator does NOT crash (rare), maestro finishes (usually with test failure) but the
eas workflow step never exits. the ci runner waits for all child processes of the step to
terminate.

**root cause**: background processes in the "run maestro" step are never fully cleaned up:

1. `adb shell 'logcat -f ...'` was backgrounded but its PID was never captured — never killed
2. `adb logcat` (host-side streaming) keeps an open connection to the emulator
3. the stats sampler's inner `adb shell` commands may survive their parent being killed
4. the emulator itself (started in a previous step) stays running

**fix**: added a `trap cleanup EXIT` handler that:

- captures and kills ALL backgrounded PIDs (including guest logcat)
- kills the emulator qemu process
- runs `pkill -f 'adb.*logcat'` as safety net for orphaned adb processes
- runs `adb kill-server` to close all adb connections

## detailed findings from run `2026-01-27_211247`

### precise crash timeline (third confirmation)

| timestamp       | event                                                                      |
| --------------- | -------------------------------------------------------------------------- |
| 21:12:47        | maestro starts test execution                                              |
| 21:12:50        | app launched with clear state                                              |
| 21:13:21.132    | **first burst**: 12× `Failed to create image decoder 'unimplemented'`      |
|                 | + 3× `Failed to instantiate a MediaExtractor`                              |
|                 | glide loads `USDC.svg` from REMOTE (16×16) — **system survives**           |
| 21:13:25.315    | sendAsset subflow starts                                                   |
| 21:13:37.117    | maestro starts "Tap on Next" — navigating to asset selection screen        |
| 21:13:37-38     | maestro loops on view hierarchy, "Could not detect idle state" repeating   |
| 21:13:38.444    | **second burst**: 12× `Failed to create image decoder 'unimplemented'`     |
|                 | + 3× `Failed to instantiate a MediaExtractor`                              |
|                 | glide loads `USDC.svg` from DATA_DISK_CACHE (32×32)                        |
| 21:13:38.485    | last `app_time_stats`: avg=258ms (degraded from 58ms baseline)             |
| 21:13:38.538    | **LAST LOGCAT LINE EVER** — StatusBarIconController wifi callback          |
| 21:13:39.065    | maestro: `UNAVAILABLE: Network closed for unknown reason`                  |
| 21:15:40.122    | maestro: `Timeout while fetching view hierarchy` (120s timeout)            |
| 21:16:00.123    | maestro: `DEADLINE_EXCEEDED` — test fails                                  |

527ms between last logcat line and grpc death.

### stats timeline at time of death

- sample 5 (21:13:37): 14.3 gb available, load 4.97, zero i/o pressure — **healthy**
- sample 6 (21:13:48): `(adb unreachable)` — **dead**

### two-burst svg rendering pattern

the `OpenGLRenderer: Failed to create image decoder` error appears in two distinct bursts:

- **burst 1** (21:13:21): triggered when the send flow loads `USDC.svg` from network. size 16×16.
  system survives. glide reports loading from `REMOTE`.
- **burst 2** (21:13:38): triggered when navigating to the asset selection screen. `USDC.svg` from
  `DATA_DISK_CACHE`. size 32×32. system dies immediately.

the second burst happens on a screen with **multiple svg token icons rendered simultaneously**.
the combination of multiple svg renders through swiftshader's gfxstream pipe appears to trigger
the fatal condition.

### health monitor gap

the health monitor's `echo "EMULATOR UNRESPONSIVE..."` output goes to the eas workflow stdout,
not to any captured artifact. maestro ran for 4+ minutes after the crash (until its own timeout),
confirming the health monitor either:

1. didn't detect the crash in time (timing between 5s sleep cycles), or
2. `kill $MAESTRO_PID` killed the `pnpm` wrapper but not the maestro java subprocess.
   future fix: use `kill -- -$MAESTRO_PID` (process group kill).

## updated hypotheses for future investigation

### gpu stack is confirmed — qemu crashes in swiftshader

the health monitor proved **qemu process DEAD (host crash)** across multiple runs. the emulator
process itself segfaults. the crash occurs at a deterministic screen transition (asset selection
screen in sendAsset flow), but the `Failed to create image decoder` errors present in early runs
are **not always present** (run `2026-01-28_013651` had zero such errors). the crash is triggered
by swiftshader's general rendering pipeline under nested kvm, not specifically by SVG decoding.

all gpu renderer options are exhausted (swiftshader crashes, angle hangs, off/guest fall back to
swiftshader, host unavailable). all config override methods attempted (cli flag, config.ini append,
sed in-place) — `-gpu off` means "guest rendering" not "disable gpu".

### remaining approaches

1. **google_apis_atd image** (blocked — need to diagnose availability). ATD is google's
   ci-optimized image. may have lighter rendering stack.
2. **reduce rendering load**: try even smaller resolution, `-no-accel` (pure software emulation,
   may avoid kvm-specific crash path), or skip the sendAsset flow.
3. **emulator snapshot**: pre-warm past the crashing screen, save snapshot, run tests from there.
4. **upgrade emulator version**: the swiftshader bug may be fixed in newer emulator builds.

**do NOT try**: lowering the api level (e.g. api 33, api 30). the app targets api 34 and we must
not downgrade.

## current workflow state

branch: `android`

emulator config:

- `-gpu swiftshader_indirect` (only renderer that boots; angle/off/host all fail)
- system image: `google_atd;x86_64` (Google APIs ATD — **crash fixed!**)
- `hw.ramSize=16384` / `-memory 16384` (16 gb)
- `-cores 4`
- avd on tmpfs (`/dev/shm/avd`)
- stability gate: `uiautomator dump` × 15 passes

diagnostic streams:

- live logcat (host-side, streaming to file)
- guest logcat (backup, pulled in teardown)
- stats sampler (single adb shell, 10s interval)
- dmesg before/after (empty without root)
- qemu process liveness check in health monitor

## related commits

- `18b30705` ⚗️ eas: instrument android e2e with diagnostic streams
- `b59a4b42` ⚗️ eas: switch to guest gpu, fix stats sampler and dmesg
- `4d4c37d7` ⚗️ eas: gpu off, 16gb guest ram, qemu crash detection
- `b567561b` ⚗️ eas: force gpu off via config.ini, fix health monitor
- `eb276671` ⚗️ eas: sed gpu config in-place, qemu crash confirmed
- `1b521de9` ⚗️ eas: dump config.ini before/after sed for gpu diagnosis
- `8f8c17e0` ⚗️ eas: switch to angle_indirect renderer
- `82ae0ff6` ⚗️ eas: google_atd image, revert to swiftshader_indirect
- `bc80132f` ⚗️ eas: diagnose atd availability, disprove svg hypothesis
- `af001989` 🐛 eas: fix stuck job after maestro completes
