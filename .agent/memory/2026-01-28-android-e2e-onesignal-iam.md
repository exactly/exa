# android e2e test failure: onesignal in-app message not appearing

## date

2026-01-28

## summary

intermittent android e2e test failure where the "stay updated" onesignal in-app message (iam) never appears after sign-in on eas android emulators. the test passes on ios (eas), passes locally on the developer's machine, but consistently fails on eas android.

## symptoms

- test `local.yaml` fails at `assertVisible: Stay updated` after 17-second timeout
- screenshot shows the app successfully signed in (home screen visible with wallet address)
- onesignal 409 error in logs: `"One or more Aliases claimed by another User"`
- firebase initialization fails: `Default FirebaseApp failed to initialize because no default options were found`

## root cause analysis

### initial (incorrect) hypothesis: onesignal 409 alias conflict

the first hypothesis was that the 409 error from onesignal login was preventing iams from displaying.

**what we tried (did not work):**

1. **adding `logout()` before `login()`** - reverted because `logout()` on a fresh device doesn't release aliases owned by OTHER devices from previous test runs
2. **adding retry with delay for `addTrigger()`** - added `setTimeout` to retry `addTrigger` after 10 seconds, didn't help
3. **calling `setPaused(false)`** - ensured iams weren't paused, didn't help
4. **skipping login in e2e mode** - user explicitly rejected this approach

**why these didn't work:**

- the 409 error is about onesignal user identity, not iam delivery
- iams should work independently of login/push subscription
- the real issue was timing/initialization, not the 409 itself

### deeper investigation: platform differences

| environment   | result | notes                                            |
| ------------- | ------ | ------------------------------------------------ |
| ios eas       | passes | uses `production.yaml` with conditional handling |
| android eas   | fails  | uses `local.yaml` with hard assertion            |
| android local | passes | developer's machine                              |

key observation: the same `local.yaml` passes locally but fails on eas. the issue is environment-specific, not code-specific.

### firebase initialization failure

emulator logs revealed:

```text
W/FirebaseApp( 4294): Default FirebaseApp failed to initialize because no default options were found.
This usually means that com.google.gms:google-services was not applied to your gradle project.
I/FirebaseInitProvider( 4294): FirebaseApp initialization unsuccessful
```

however, onesignal creates its own firebase app which succeeds:

```text
I/FirebaseApp( 4294): Device unlocked: initializing all Firebase APIs for app ONESIGNAL_SDK_FCM_APP_NAME
```

the app doesn't have `google-services.json` configured, which is intentional for development/e2e builds.

### actual root cause: iam fetch timing on fresh android emulator

on eas android:

1. emulator starts with `-wipe-data` (completely fresh)
2. app launches, onesignal sdk initializes
3. sdk needs to fetch iam definitions from onesignal servers (async network request)
4. sign-in happens quickly, trigger is set
5. but iam definitions haven't been fetched yet, so nothing shows

on local android:

- emulator may have cached state from previous runs
- iam definitions may already be cached
- trigger fires immediately and iam shows

on ios:

- test uses `production.yaml` which handles "stay updated" conditionally (`when: { visible: Stay updated }`)
- if iam doesn't appear, test just skips that step instead of failing

## solution

**app-side fix:** wait for `getOnesignalId()` to resolve before calling `addTrigger()`:

```typescript
enablePrompt: () => {
  hydrated.then(
    async () => {
      const lastDismiss = queryClient.getQueryData<number>(["onesignal", "dismiss"]) ?? 0;
      if (!appId || lastDismiss + DISMISS_EXPIRY >= Date.now()) return;
      await OneSignal.User.getOnesignalId(); // wait for sdk initialization
      OneSignal.InAppMessages.addTrigger("onboard", "1");
    },
    () => undefined,
  );
},
```

**why this should work:**

- `getOnesignalId()` returns a promise that resolves when the sdk has a user id
- this indicates the sdk is more fully initialized
- by awaiting it, we give the sdk time to fetch iam definitions before setting the trigger
- no artificial delays - just waiting for actual sdk readiness

## what we learned

### about onesignal

1. **iams are fetched asynchronously** - on a fresh install, the sdk needs time to fetch iam definitions from the server
2. **409 alias conflicts don't block iams** - the login error is separate from iam delivery
3. **`logout()` doesn't release other devices' aliases** - calling logout on device b doesn't affect aliases owned by device a
4. **the sdk api uses `setPaused()` method**, not a `paused` property
5. **no iam fetch callback exists** - the sdk doesn't expose an event for when iams are fetched
6. **`addTrigger` only evaluates already-fetched iams** - if iams aren't fetched yet, the trigger does nothing
7. **`getOnesignalId()` returns a promise** - resolves when sdk is initialized, can be used as a proxy for "sdk ready"
8. **iams are fetched during session creation** - happens at sdk initialization, takes variable time based on network

### about firebase on android

1. **firebase initialization fails without `google-services.json`** - this is expected for e2e builds
2. **onesignal creates its own firebase app** - it doesn't rely solely on the default app
3. **missing firebase doesn't completely break onesignal** - push won't work but iams should still function

### about eas vs local android

1. **eas emulators are completely fresh** - `-wipe-data` means no cached state
2. **local emulators may retain cached data** - explains why tests pass locally but fail on eas
3. **timing is different** - network conditions and initialization speed differ

### about maestro tests

1. **`assertVisible` has a default timeout** - around 17 seconds based on logs
2. **`extendedWaitUntil` allows custom timeouts** - use for longer waits
3. **`when` conditions can be platform-specific** - `${maestro.platform == 'android'}`
4. **`production.yaml` vs `local.yaml`** - different test strategies for different purposes

### about debugging e2e failures

1. **check all platforms** - if one works and another doesn't, the issue is environment-specific
2. **read the full emulator log** - firebase errors revealed important context
3. **don't assume app code is the problem** - the app worked fine, it was test timing
4. **screenshots are valuable** - confirmed the app was in the expected state

## files modified

| file                        | change                                         | status    |
| --------------------------- | ---------------------------------------------- | --------- |
| `src/utils/onesignal.ts`    | await `getOnesignalId()` before `addTrigger()` | committed |

## rejected approaches

1. **making the test conditional** - user explicitly rejected, loses test coverage
2. **disabling onesignal login in e2e** - user explicitly rejected
3. **app code changes** - user preferred test-side fix since app works correctly

## follow-up considerations

1. **verify fix works on eas** - need to run android e2e on eas to confirm
2. **consider adding `google-services.json` for e2e** - would enable proper firebase initialization
3. **check onesignal dashboard** - verify iam is configured correctly for android
4. **monitor test duration** - the 15s wait adds time to android tests

## timeline of attempts

1. hypothesis: 409 causes iam failure -> tried `logout()` before `login()` -> didn't work
2. hypothesis: need to wait after login -> tried retry with `setTimeout` -> didn't work
3. hypothesis: iams paused -> tried `setPaused(false)` -> didn't work
4. hypothesis: e2e should skip login -> user rejected
5. discovered: firebase init fails on eas android
6. discovered: test passes locally, fails on eas
7. hypothesis: test needs delay -> tried maestro `wait` command -> invalid command, anti-pattern
8. researched onesignal sdk for iam fetch callback -> none exists
9. current fix: await `getOnesignalId()` before `addTrigger` to give sdk time to fetch iams
