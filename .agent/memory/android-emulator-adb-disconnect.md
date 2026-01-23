# android emulator adb disconnection in eas e2e tests

## problem statement

the android e2e tests on eas ci (`linux-large-nested-virtualization`, 4 vcpus, 32 gb ram) fail
consistently because the adb transport between the host and the android emulator drops ~1-2 minutes
into the maestro test execution. once dropped, maestro can never reconnect (120s
`DEADLINE_EXCEEDED`), and the test fails.

the emulator process itself never crashes — it keeps running. but the guest becomes permanently
unresponsive (the guest kernel hangs). teardown commands like `adb logcat -d` and `adb bugreport`
hang indefinitely, confirming the emulator is completely dead, not just temporarily unresponsive.

## environment

- **ci machine**: `linux-large-nested-virtualization` (eas)
- **resources**: 4 vcpus, 32 gb ram
- **virtualization**: nested kvm (vm inside vm)
- **emulator**: android emulator 36.3.10.0, api 34 (`google_apis;x86_64`)
- **gpu**: `swiftshader_indirect` (software rendering)
- **test framework**: maestro 2.1.0
- **app**: react native + expo, uses ml kit barcode scanning, onesignal push

## failure pattern (consistent across all attempts)

### timeline

1. emulator boots successfully (~46-53s)
2. `sys.boot_completed` fires, package manager becomes available
3. app is installed, maestro starts the test
4. **~55-120s into the test**, logcat stops producing output
5. maestro gets `UNAVAILABLE: Network closed for unknown reason` (grpc)
6. maestro gets `UNAVAILABLE: Keepalive failed. The connection is likely gone`
7. maestro waits 120s, gets `DEADLINE_EXCEEDED`
8. test fails; emulator is permanently unresponsive

### last logcat entries before death

every single run shows the same pattern at the moment of death — gms background services
performing heavy operations:

- `PhenotypeConfigurationUpdateListener` — configuration sync
- `NamespaceManager` — package namespace resolution
- `PTCommittedOperation` — phenotype transaction commits
- `NetworkScheduler` — background task scheduling
- `ChimeraConfigurator` — **downloading ml kit modules** (barcode, tflite)
- `SearchServiceCore` — icing search index operations
- `GmsSyncPolicyEngine` — sync policy evaluation

### error chain

```text
maestro → grpc (port forward via adb) → adb server (host:5037) → adb transport → emulator
  qemu process (host) → goldfish pipe / virtio → adbd (guest) → guest kernel
```

the failure point is the guest kernel becoming unresponsive, which causes adbd to stop responding,
which causes the adb transport to die, which kills the grpc port forward, which kills maestro's
connection.

## root cause analysis

### confirmed: not a simple adb timeout

- the emulator is **permanently dead** after the disconnect (teardown hangs for 9+ minutes)
- this is a guest kernel hang, not a transient transport issue
- the emulator process keeps running fine (no crash in `emulator-process.log`)

### confirmed: triggered by app + gms combination

in the final attempt, we proved that the gms storm is **app-triggered**:

1. stability gate passed (device was responsive for 30s after boot)
2. maestro launched the app at `13:32:43`
3. connection died at `13:33:38` — exactly 55s after app launch
4. last logcat shows `ChimeraConfigurator: Detected pending changes for urgent request:
   [mlkit.barcode.ui]`

when the app starts, react native loads all native modules including ml kit. ml kit requests
barcode scanning models from gms. gms's `ChimeraConfigurator` starts downloading `mlkit.barcode.ui`,
`vision.barcode`, and `tflite_dynamite` modules. this download causes massive i/o in the nested
virtualization environment, hanging the guest kernel.

### why nested virtualization makes this fatal

each disk write in the guest goes through:

```text
guest filesystem → guest block layer → virtio → qemu (host) → host filesystem
  → host block layer → nested vm's virtual disk driver → actual storage
```

two layers of virtualization means each i/o operation has ~10x the latency of bare metal. when gms
performs heavy sqlite writes (phenotype configs) + module downloads simultaneously, the guest
kernel's i/o scheduler becomes overwhelmed, and the kernel hangs.

### why `adb shell true` doesn't detect the problem

`adb shell true` is nearly zero-cost — it doesn't exercise the guest's i/o subsystem. the transport
dies only under sustained heavy traffic (like the view hierarchy dumps maestro performs). this is why
our stability gate passed every time but maestro still failed.

## approaches tried and results

### 1. switch to `default` system image (no gms)

**result**: not viable — push notifications require gms (fcm). the app uses onesignal which
depends on firebase cloud messaging.

### 2. reduce emulator cores (4 → 2)

**hypothesis**: leave host cores for emulator management threads (grpc, adb handler).

**result**: failed. the guest kernel still hung. with fewer cores, gms takes longer to finish,
prolonging the danger window. and the failure is i/o-driven, not cpu-driven.

### 3. increase emulator ram (4 gb → 8 gb)

**hypothesis**: more ram means more page cache, less disk i/o pressure.

**result**: no effect on the failure. the issue is i/o latency in nested virt, not memory pressure.

### 4. `-netfast` emulator flag

**hypothesis**: reduces network emulation overhead.

**result**: no effect. the problem is disk i/o, not network throttling.

### 5. `adb kill-server && adb start-server` before emulator

**hypothesis**: clean adb daemon state prevents stale connections.

**result**: no effect on the core failure. useful for avoiding "cannot connect to daemon" warnings.

### 6. timeout guards on boot waits

**result**: prevents infinite hangs during setup. good practice but doesn't fix the test failure.

### 7. `adb devices -l` health check

**result**: useful for debugging (confirms device is connected at setup time). no effect on failure.

### 8. background adb keep-alive with reconnect

```bash
setsid sh -c 'while true; do adb shell true 2>/dev/null || adb reconnect 2>/dev/null;
  sleep 2; done' > /dev/null 2>&1 &
```

**hypothesis**: periodic pings keep the transport alive; reconnect recovers from drops.

**result**: failed. the issue isn't transport inactivity or a recoverable disconnect. the guest
kernel hangs permanently — no amount of reconnection helps because there's nothing to reconnect to.

### 9. `renice` inside the guest (boost adbd, deprioritize gms)

```bash
adb root && adb wait-for-device
adb shell 'renice -n -20 $(pidof adbd)'
adb shell 'renice -n 19 $(pidof com.google.android.gms)'
```

**issues encountered**:

- android toybox `renice` requires `-n` flag (not gnu syntax)
- `renice -- -20` doesn't work (toybox doesn't support `--`)
- negative nice requires root
- `adb root` restarts adbd, causing gms to restart with new pids
- renice targets stale pids; new gms processes run at default priority

**result**: failed. even if applied correctly, the issue is i/o-driven kernel hang, not cpu
scheduling.

### 10. doze mode (`dumpsys deviceidle force-idle`)

**hypothesis**: defers gms background work including module downloads.

**result**: no effect. either the command failed silently (no log output), or
`ChimeraConfigurator` module downloads are exempt from doze (classified as "urgent" by gms — the
log says "Detected pending changes for **urgent** request").

### 11. remove streaming `adb logcat` (collect with `adb logcat -d` in teardown)

**hypothesis**: the continuous logcat stream (~500 lines/sec, ~50k lines in 2 min) saturates the
adb transport. removing it reduces transport load.

**result**: failed. the failure still occurs. the transport dies from maestro's grpc traffic alone
when combined with the guest kernel hang. however, this IS a good practice — streaming logcat adds
unnecessary load.

### 12. stability gate with `adb shell true`

```bash
stable=0
while [ $stable -lt 15 ]; do
  if adb shell true 2>/dev/null; then stable=$((stable + 1))
  else stable=0; adb kill-server; adb start-server; adb wait-for-device; fi
  sleep 2
done
```

**result**: the gate passed every time, but maestro still failed afterward. `adb shell true` is too
lightweight — it doesn't detect i/o pressure.

### 13. pre-launch app + stability gate with `uiautomator dump`

**hypothesis**: launch the app before the gate to trigger gms module downloads, then use a heavier
stability check (`uiautomator dump`) that exercises the guest similarly to maestro.

**result**: failed. the combination of app + gms module downloads still causes the guest kernel to
hang, and the `uiautomator dump` check either passed before the storm hit or itself contributed to
the hang.

## key learnings

### the failure is a guest kernel hang, not a transport timeout

every mitigation that assumed "adb just needs to be kept alive" failed. the guest kernel itself
becomes permanently unresponsive under i/o pressure from nested virtualization.

### the storm is app-triggered

gms module downloads are triggered by the app's ml kit dependency at startup. this isn't random
background activity — it's a deterministic response to the app requesting barcode scanning
capabilities.

### nested virtualization has ~10x i/o penalty

two layers of virtualization make each disk operation extremely expensive. what works fine on bare
metal or single-layer virt becomes fatal in nested virt.

### `adb shell true` is useless as a stability check

it's too lightweight to detect system stress. only operations that exercise the guest's subsystems
(ui hierarchy dump, package manager queries, etc.) reveal actual instability.

### gms's "urgent" module downloads bypass doze

`ChimeraConfigurator` classifies ml kit modules as urgent, exempting them from doze mode and
battery optimization restrictions.

## current state of the workflow file

the file at `.eas/workflows/local.yaml` currently has these changes from the original:

- `adb kill-server && adb start-server` before emulator creation
- `-netfast` flag on emulator
- `hw.ramSize=8192` and `-memory 8192` (8 gb ram)
- `-cores 4` (unchanged from original)
- timeout guards on boot waits
- no streaming `adb logcat` (dump in teardown instead)
- pre-launch app with `monkey` to trigger gms downloads
- stability gate with `uiautomator dump` (15 consecutive passes)
- `adb devices -l` health check
- `timeout 60` on `adb logcat -d` in teardown (prevents hang)

all of these are reasonable improvements, but none solve the core failure.

## hypotheses for future investigation

### 1. app startup overhead (most promising)

the app may be doing excessive work at startup that, combined with gms module downloads, overwhelms
the nested-virt i/o. investigate via sentry performance traces:

- how long does the app take to become interactive?
- what native modules initialize at startup?
- is ml kit barcode scanner eagerly initialized or lazy?
- are there unnecessary i/o operations at boot (sqlite, filesystem reads)?
- can ml kit be lazy-loaded (only when the barcode screen is opened)?

if ml kit initialization can be deferred, gms won't download modules until the user actually opens
the barcode scanner — which won't happen during the initial e2e flow.

### 2. pre-built ml kit modules (bundle in apk)

ml kit has a "bundled" mode where models are included in the apk instead of downloaded via gms at
runtime. this eliminates the `ChimeraConfigurator` download entirely. trade-off: larger apk size.

check: is the app using `com.google.mlkit:barcode-scanning` (bundled) or
`com.google.android.gms:play-services-mlkit-barcode-scanning` (unbundled/download)?

### 3. android test device (atd) images

google provides atd images (`google_atd`) optimized for ci — they have google apis (fcm works) but
stripped-down gms that doesn't perform heavy background initialization. available for api 30-33;
check if api 34 has one.

### 4. emulator snapshot with pre-warmed gms

boot the emulator once, let gms finish all initialization (including module downloads), save a
snapshot. subsequent runs boot from the snapshot — no fresh initialization needed.
challenge: eas ci is ephemeral, so the snapshot must be rebuilt on each run (or stored as an
artifact). could add ~3-4 min to setup but eliminate the failure entirely.

### 5. block specific gms network endpoints

use iptables inside the guest to block gms's download servers while keeping fcm's persistent
connection alive:

```bash
adb shell iptables -A OUTPUT -d play.googleapis.com -m owner \
  --uid-owner $(stat -c %u /data/data/com.google.android.gms) -j REJECT
```

fcm uses a persistent connection to `mtalk.google.com` which would remain open. module downloads
from `play.googleapis.com` would fail immediately (no i/o storm). ml kit would fall back to
on-device models if available.

### 6. increase ci machine tier

a machine with more vcpus (8+) would reduce contention in nested virtualization. the i/o penalty
per operation remains, but with more parallelism the kernel is less likely to hang. check if eas
offers a larger nested-virt tier.

### 7. fix the actual overhead in the app

if sentry shows the app hanging on startup (loading too many native modules, eager initialization,
heavy i/o), fixing that overhead would:

- reduce the total system load during test startup
- possibly eliminate the ml kit trigger (if lazy-loaded)
- improve production performance as a side benefit
- make the e2e tests more stable across all environments

this is likely the most impactful approach — it fixes the root cause rather than working around it.

## files involved

- `.eas/workflows/local.yaml` — the workflow file with emulator setup
- `.maestro/flows/` — maestro test flows
- app's ml kit integration — triggers gms module downloads
- onesignal integration — requires gms for push notifications

## related commits

- `9474975a4` 💚 eas: improve android emulator stability (prior attempt)
- branch: `flaky` (current work)
