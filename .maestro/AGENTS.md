# e2e (`.maestro`)

maestro flows that drive the app on web, ios and android against a local stack: the server, postgres, redis and anvil with the contracts deployed.

## flows

- **layout**: journeys live in `subflows/`. `flows/` holds thin entrypoints that chain them: one per journey for github's web matrix (`credit`, `onboarding`, `swap`, `transfer`), `local.yaml` with every journey (tagged `critical`, run by eas on native) and `production.yaml` (tagged `production`). `flows/web/` wraps each entrypoint with a top-level `url:`, which is what makes maestro open the browser. `src/script/` holds the flows' scripts, bundled to `dist/`. `patches/` holds our changes to maestro, which `pnpm nx maestro e2e` builds from source into `build/bin/maestro`.
- **no branching**: no flags or env switches that pick a path inside a flow. a variant gets its own entrypoint, sharing subflows.
- **real app**: flows drive the app users run, with every test double outside it. a failure a real user could hit gets fixed in the app, never worked around in the flow.
- **fresh stack per flow**: entrypoints share one test account, so each one runs on a new stack.

## running

github runs each web entrypoint like this, at the screen size its `test.yaml` matrix entry sets:

```sh
pnpm nx maestro e2e
CHAIN_ID=31337 APP_DOMAIN=localhost EXPO_PUBLIC_ENV=e2e NX_DAEMON=false pnpm nx e2e:web:release mobile > server.log 2>&1 &
until curl -fs localhost:3000/api/auth/authentication > /dev/null && curl -fs localhost:8081 > /dev/null; do sleep 1; done
.maestro/build/bin/maestro test .maestro/flows/web/credit.yaml --headless --screen-size 1920x1080 --browser-args=--force-prefers-reduced-motion
curl -X POST localhost:3000/e2e/shutdown
```

it needs jdk 17 (maestro's gradle toolchain), chromium, foundry and redis (`REDISMS_SYSTEM_BINARY=/usr/bin/redis-server`). native flows run on eas for pull requests (`.eas/workflows/local.yaml`).
