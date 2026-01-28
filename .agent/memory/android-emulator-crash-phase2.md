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

| renderer               | result                                          |
| ---------------------- | ----------------------------------------------- |
| `swiftshader_indirect` | boots, qemu segfaults on svg rendering          |
| `angle_indirect`       | hangs on startup (no vulkan in nested kvm)       |
| `off` / `guest`        | falls back to swiftshader (image lacks guest gpu)|
| `host`                 | no real gpu in nested kvm                        |

### 22. google_atd system image (pending)

**hypothesis**: `google_apis_atd;x86_64` is google's ci-optimized system image. it has the same
api level and google apis (fcm works) but stripped-down gms and potentially different rendering
behavior. it may handle the svg rendering without crashing swiftshader, or it may support guest
rendering (bypassing gfxstream entirely).

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

the health monitor proved **qemu process DEAD (host crash)**. the emulator process itself
segfaults — this is a swiftshader bug triggered by svg rendering through gfxstream. both cli
`-gpu off` and config.ini append were silently ignored; the next attempt uses `sed -i` to replace
the default values in-place.

if `-gpu off` (properly applied) eliminates the crash:

1. **swiftshader bug**: the specific svg rendering path triggers a crash in swiftshader's software
   opengl implementation. possible fix: upgrade emulator version or use a different system image.
2. **gfxstream pipe corruption**: the host↔guest gpu pipe corrupts under nested kvm, causing the
   guest to block on a pipe read forever. possible fix: use a different gpu transport or disable
   gpu entirely for ci.
3. **svg rendering workaround**: the asset selection screen's svg icons (loaded via glide) could be
   replaced with pre-rasterized pngs for the e2e test build, avoiding the problematic rendering
   path entirely.

### if `-gpu off` doesn't help

the crash may be in the emulator's core (qemu) rather than the gpu stack. next steps:

- try `-gpu swiftshader_indirect` with `-no-accel` to rule out kvm interaction
- try `google_atd` images (stripped gms, optimized for ci)
- try emulator snapshot with pre-warmed state (let svg renders complete before starting test)

**do NOT try**: lowering the api level (e.g. api 33, api 30). the app targets api 34 and we must
not downgrade.

## current workflow state

branch: `android`

emulator config:

- `-gpu swiftshader_indirect` (only renderer that boots; angle/off/host all fail)
- system image: `google_apis_atd;x86_64` (ci-optimized, may handle svg differently)
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
