# android e2e test failure: onesignal in-app message not appearing

## date

2026-01-28

## summary

android e2e test failure where the "stay updated" onesignal in-app message (iam) never appears after sign-in on eas android emulators. the test passes on ios (eas), passes locally on the developer's machine, but consistently fails on eas android.

## symptoms

- test `local.yaml` fails at `assertVisible: Stay updated` after 17-second timeout
- screenshot shows the app successfully signed in (home screen visible with wallet address)
- onesignal 409 error in logs: `"One or more Aliases claimed by another User"`
- firebase initialization fails: `Default FirebaseApp failed to initialize because no default options were found`

## key observations

| environment   | result | notes                                            |
| ------------- | ------ | ------------------------------------------------ |
| ios eas       | passes | uses `production.yaml` with conditional handling |
| android eas   | fails  | uses `local.yaml` with hard assertion            |
| android local | passes | developer's machine                              |

the same `local.yaml` passes locally but fails on eas. the 409 error only happens on eas because each run creates a new anonymous onesignal user that tries to claim an external_id already owned by a previous run's user.

## failed approaches (timing-based)

these were based on the hypothesis that the issue was iam fetch timing:

1. **awaiting `getOnesignalId()` before `addTrigger()`** - didn't help
2. **polling for `onesignalId` with retries** - didn't help
3. **event listener for user state changes** - didn't help
4. **adding delays before `addTrigger()`** - didn't help
5. **calling `addTrigger()` immediately without waiting** - didn't help

## root cause (confirmed)

race condition: onesignal sdk uses wallet address as `external_id` before our `login()` function is called.

emulator log evidence (line 34700):
```
W/OneSignal: HttpClient: Got Response = PATCH - STATUS: 409 - Body: {"errors":[{"code":"user-2","title":"One or more Aliases claimed by another User","meta":{"external_id":"0x6ee5f6AE868475BadAF473e63229Ec473013dEA8"}}]}
```

the 409 error corrupts the sdk's iam state, preventing iams from displaying.

on eas:
- fresh emulator = new anonymous onesignal user each run
- sdk internally tries to claim wallet address before our login() is called
- 409 error breaks iam functionality

on local:
- emulator retains state, same onesignal user persists
- login succeeds, no 409
- iams work

## previous attempt (failed)

use a random external_id for onesignal login in e2e mode to avoid the 409:

```typescript
login: (userId: string) => {
  if (appId) OneSignal.login(process.env.EXPO_PUBLIC_ENV === "e2e" ? Math.random().toString(36) : userId);
},
```

**status: failed** - race condition. onesignal sdk uses wallet address as `external_id` before our `login()` is called.

## previous attempt 2 (partial success)

generate random id at module load time and login immediately after `initialize()` to prevent race:

```typescript
const testUserId = process.env.EXPO_PUBLIC_ENV === "e2e" ? Math.random().toString(36) : undefined;
if (appId) {
  OneSignal.initialize(appId);
  if (testUserId) OneSignal.login(testUserId);
}
```

**status: partial** - fixed the 409 error, but iams still don't appear sometimes. calling `login()` immediately after `initialize()` likely disrupts the iam fetch process.

## previous attempt 3 (success but complex)

immediate login + delay before iam trigger:

```typescript
// at module load
const testUserId = process.env.EXPO_PUBLIC_ENV === "e2e" ? Math.random().toString(36) : undefined;
if (appId) {
  OneSignal.initialize(appId);
  if (testUserId) OneSignal.login(testUserId);
}

// in enablePrompt
enablePrompt: () => {
  hydrated.then(async () => {
    // ...
    if (testUserId) await new Promise((resolve) => setTimeout(resolve, 3000));
    OneSignal.InAppMessages.addTrigger("onboard", "1");
  });
},
```

**status: worked** - but the delay alone might be sufficient, making the random id unnecessary.

## previous attempt 4 (failed)

simplified: delay only, no random id. let normal login flow happen.

```typescript
const isE2E = process.env.EXPO_PUBLIC_ENV === "e2e";
if (appId) OneSignal.initialize(appId);

// in enablePrompt
if (isE2E) await new Promise((resolve) => setTimeout(resolve, 3000));
OneSignal.InAppMessages.addTrigger("onboard", "1");
```

**status: failed** - random id is necessary to prevent 409.

## current fix (2026-01-29)

random id + await sdk readiness (no arbitrary timeout):

```typescript
const testUserId = process.env.EXPO_PUBLIC_ENV === "e2e" ? Math.random().toString(36) : undefined;
if (appId) {
  OneSignal.initialize(appId);
  if (testUserId) OneSignal.login(testUserId);
}

// in enablePrompt
enablePrompt: () => {
  hydrated.then(async () => {
    // ...
    // wait for sdk to be ready before triggering iam
    if (testUserId) await OneSignal.User.getOnesignalId();
    OneSignal.InAppMessages.addTrigger("onboard", "1");
  });
},

login: (userId: string) => {
  if (appId && !testUserId) OneSignal.login(userId);
},
```

**status: testing** - uses `getOnesignalId()` as sdk readiness signal instead of arbitrary timeout.

## 2026-01-30 update: listener-first approach

### previous attempt (failed)

the commit `1d45a182` tried to fix the race by checking `getOnesignalId()` first:

```typescript
OneSignal.User.getOnesignalId().then(async (currentId) => {
  if (currentId) { /* already ready */ }
  else { /* attach listener */ }
});
```

this still fails because:
1. `getOnesignalId()` is async - it starts an async operation
2. while waiting for that promise, the `change` event may fire
3. when `getOnesignalId()` resolves with `undefined`, we attach listener too late
4. the event already fired, listener never triggers

### correct fix: attach listener FIRST

```typescript
new Promise<void>((resolve) => {
  let resolved = false;
  const complete = () => { /* idempotent completion */ };
  const listener = (event) => { if (event.current.onesignalId) complete(); };
  // 1. attach listener SYNCHRONOUSLY
  OneSignal.User.addEventListener("change", listener);
  // 2. then check if already ready
  OneSignal.User.getOnesignalId().then((id) => { if (id) complete(); });
});
```

this works because:
- listener attachment is synchronous (no async gap)
- `getOnesignalId()` check catches the case where sdk was already initialized
- no event can be missed between the two operations

## rejected approaches

1. **making the test conditional** - loses test coverage
2. **increasing test timeout** - doesn't address root cause
3. **skipping onesignal login entirely in e2e** - disables feature
