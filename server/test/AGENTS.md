# server tests (`server/test`)

these tests run the server the way it runs when deployed: every file in parallel against one postgres, one redis and the same networks, with only third-party services mocked. a test that passes against something production never sees proves nothing.

## setup

- **global setup**: `vitest.config.mts` starts two anvils (`test/anvil.ts`, deployed by forge scripts), one embedded postgres with the drizzle schema pushed (`test/database.ts`), one redis (`test/redis.ts`) and spotlight before any file runs, and sets every env value the code reads. there is no `.env` and nothing to start by hand.
- **run**: `pnpm nx test:vi server`, or one file with `pnpm nx test:vi server -- test/api/card.test.ts`. to hunt races between files, shuffle them under several seeds: `pnpm nx test:vi server --skip-nx-cache --exclude-task-dependencies -- --sequence.shuffle.files --sequence.seed=<n>`.
- **mocks**: only third-party services are mocked, each once in `test/mocks/` (panda, persona, bridge, manteca, pax, sardine, onesignal, segment, alchemy). never add a mock of our own code: the wallet, chain clients, queues, workers or the database. the older auth and trace client mocks are no model to copy. `mocks/wallet.ts` keeps the real wallet client and only gives each file its own keeper key, like each deployed module has its own signer.
- **seeded data**: the global setup seeds one credential, `bob`, with a real onchain account that every file can read. no test writes to it: a test that changes a credential creates its own.
- **timeouts**: tests and hooks get 36.666 seconds. never raise a timeout or add a sleep to get green: wait for the event the code produces, like a receipt or a job's outcome.

## assertions

- **what to test**: test every conditional outcome — success paths, expected error codes, validation rejections, edge cases, and fallback branches. if a handler returns different responses based on a condition, each branch gets its own test case.
- **assert aggressively**: every test must assert as much observable behavior as possible — response status, response body, database state, headers, and error codes. a test that only checks one field when five are available is incomplete. prefer `toStrictEqual` over `toMatchObject` to catch unexpected extra fields or missing properties.
- **assert on monitoring and tracking**: always verify observability side effects. assert `captureException` calls with their exact fingerprints, severity levels, and context objects. assert calls to external service spies (notifications, risk scoring, analytics). assert span/trace metadata (`name`, `op`, `attributes`). monitoring behavior is production behavior — untested tracking is broken tracking.
- **assert the negative**: explicitly verify that things that should not happen did not happen. assert `not.toHaveBeenCalled()` on spies that must stay silent in a given scenario — no unexpected exceptions captured, no notifications sent, no side effects triggered. a test that only asserts what happened is half a test.
- **coverage**: every run writes `coverage/lcov.info`, which ci uploads under the codecov `server` flag. a change never lowers it, including when a test is removed or rewritten.

## shared infra

- **shared infra**: like the deployed services, every test file runs in parallel against one postgres, one redis and the anvils from the global setup. never isolate a test's database, redis or queues, never mock a queue and never drain or obliterate a shared one. scope assertions to the test's own rows, jobs and accounts, and never insert rows the code would reject. some older files still drain, obliterate or mock queues: never copy them.
- **jobs**: listen for a job's outcome (`finished` in `test/redis.ts`) before adding it, and keep the job options the code uses. a test never changes behavior to pass.
- **networks**: every run has two networks, like a deployed stack. `Anvil` plays optimism, with the plain auditor and markets and no firewall, and `Anvil2` plays base, with the verified auditor and markets and the firewall. code that spans networks is tested on both, never with a mocked client for either.
- **real chain state**: build positions onchain (create the account, mint, poke) instead of mocking chain reads, and stub a read only to inject a failure on the test's own account. local deploys live in forge scripts (`contracts/test/mocks/*.s.sol`), which `test/anvil.ts` runs and reads addresses from.
- **writes**: wait for a test's write with `waitForTransactionReceipt({ hash: await client.writeContract(...) })`, not the `*Sync` actions.

## e2e

- **e2e mode**: `pnpm nx e2e server` runs the same config with `NODE_ENV=e2e`: only `test/e2e.ts`, with both anvils on the next ports, alchemy-shaped rpc proxies, and otterscan with sourcify through docker when it runs outside ci. the app's web and maestro flows run against it, so it stays as close to a deployed stack as the server tests are.
- **e2e harness**: `test/e2e.ts` serves the e2e stack. its routes hand flows what the app can't reach (`/e2e/credential`, `/e2e/platinum`), never a wait for the server or the chain: flows wait for what users see or read the chain from a script.

## failures

- **explain failures**: find the cause of every failure before changing anything. flaky is not a cause. a known one: anvil 1.7.1 can run a `latest` read on a new block's state with the previous block's timestamp, which breaks a market's accrual math (panic `0x11`).
- **no reruns**: never rerun a failure until it passes. one that shows only sometimes is a race or a leak between files: report it with the seed and the cause.
