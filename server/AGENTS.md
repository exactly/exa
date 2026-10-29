# server (`server`)

- **stack**: hono, node.js, drizzle orm, postgres.
- **api**: schema-first (openapi via `hono-openapi`). validation via valibot middleware. always use `satisfies InferOutput<typeof Schema>` on responses for compile-time validation.
- **validators**: use `hono-openapi/valibot` for api routes with openapi docs. use `@hono/valibot-validator` for internal webhooks/hooks without openapi.
- **db**: drizzle schema is truth. the client is created once at startup and passed in.
- **auth**: passkeys/webauthn primary. logic in middleware.
- **http codes**: use http to the fullest. non-200 codes for expected cases. 500 is fine for situations that shouldn't happen (type guards, etc.).
- **legacy field**: the `{ code, legacy }` error response pattern is deprecated. new code should omit `legacy`.

## api design (hono)

- **routes as functions**: treat each route as a self-contained unit. handlers may delegate to utility/service functions but should remain the single entry point for their endpoint.
- **`c.req.valid()` for context**: access validated data (headers, body, params, cookies) via `c.req.valid()`. middleware adds validated data that route handlers consume.
- **validation with middleware**: all request validation (headers, body, params) must be handled by validator middleware. no manual validation inside route handlers.
- **openapi generation**: all routes must use `describeRoute()` with `hono-openapi` to define their openapi specification. essential for automated documentation and client generation.
- **error handling**: for expected errors, return `c.json({ code: "..." }, status)` with appropriate http status codes. unhandled errors are caught and logged automatically.

## database (drizzle orm)

- **schema-first**: the database schema is defined in `server/database/schema.ts`. this is the single source of truth.
- **database columns**: `snake_case` (drizzle maps to `camelCase` in the orm).
- **schema changes**: there are no migration files. `pnpm nx db:push server` pushes the schema directly. never edit the database schema manually.
- **query syntax**: use the drizzle orm query builder. do not write raw sql queries unless absolutely unavoidable.
- **relations**: define relations explicitly in the schema file. this enables typed query results with related entities.
- **database client**: created once at startup and passed into route and hook factories as `database`, like every other client.

## authentication & authorization

- **middleware-driven**: all auth logic must be implemented in hono middleware.
- **session data**: access the authenticated session via `c.req.valid("cookie").credentialId`. routes fetch additional user data from the database as needed.
- **passkeys first**: the primary authentication mechanism is webauthn/passkeys.

## code structure

- **api routes**: all api route definitions are in `server/api/`. use `index.ts` to group related routes into a single hono app instance, mounted in `server/index.ts`.
- **hooks**: `server/hooks/` contains logic for responding to external events (blockchain events, third-party webhooks).
- **utils**: `server/utils/` contains shared utility functions. keep these small, pure, and well-defined.

## handler size & extraction

- **colocation is preferred**: handlers can be as long as needed for a single flow. all logic for a flow lives together - easier to reason about, debug, and maintain.
- **when to extract**: extract to utility functions only when (1) code is shared by multiple routes, or (2) wrapping remote APIs (sardine, panda, persona, etc.) which have their own auth, retry logic, and error mapping.
- **avoid premature abstraction**: do not extract code just because a handler is "big." a 200-line handler for a single cohesive flow is fine.

## prohibited patterns

- **database instantiation**: do not create new database connections in route handlers. use the client passed in.
- **configuration at startup**: resolve and validate configuration at startup, before the service starts. if anything required is missing, throw immediately. this ensures the app fails fast on startup, not at runtime when a value is first accessed.
- **blocking the event loop**: avoid long-running synchronous operations. use `async/await` correctly and be mindful of cpu-intensive tasks.

## testing

- **branch coverage requirement**: every new or changed line of server code must have 100% branch coverage in the vitest suite. every `if/else`, ternary, `??`, `||`, `&&`, early return, and `catch` path must be exercised by a test. no exceptions.
- **run tests**: `pnpm nx test:vi server`. coverage is collected automatically via `@vitest/coverage-v8`.
- **verify before committing**: after writing or modifying tests, confirm that the coverage report shows no uncovered branches in the affected files. use `pnpm nx test:vi server` and inspect the output.
- **test structure**: tests live in `server/test/`. each test file targets a specific route or module. colocate related assertions in a single `describe` block.
- **what to test**: test every conditional outcome — success paths, expected error codes, validation rejections, edge cases, and fallback branches. if a handler returns different responses based on a condition, each branch gets its own test case.
- **assert aggressively**: every test must assert as much observable behavior as possible — response status, response body, database state, headers, and error codes. a test that only checks one field when five are available is incomplete. prefer `toStrictEqual` over `toMatchObject` to catch unexpected extra fields or missing properties.
- **assert on monitoring and tracking**: always verify observability side effects. assert `captureException` calls with their exact fingerprints, severity levels, and context objects. assert calls to external service spies (notifications, risk scoring, analytics). assert span/trace metadata (`name`, `op`, `attributes`). monitoring behavior is production behavior — untested tracking is broken tracking.
- **assert the negative**: explicitly verify that things that should not happen did not happen. assert `not.toHaveBeenCalled()` on spies that must stay silent in a given scenario — no unexpected exceptions captured, no notifications sent, no side effects triggered. a test that only asserts what happened is half a test.
- **shared infra**: like the deployed services, every test file runs in parallel against one postgres, one redis and one anvil from the global setup. never isolate a test's database, redis or queues, never mock a queue and never drain or obliterate a shared one. scope assertions to the test's own rows, jobs and accounts, and never insert rows the code would reject. some older files still drain, obliterate or mock queues: never copy them.
- **jobs**: listen for a job's outcome (`finished` in `test/redis.ts`) before adding it, and keep the job options the code uses. a test never changes behavior to pass.
- **real chain state**: build positions onchain (create the account, mint, poke) instead of mocking chain reads, and stub a read only to inject a failure on the test's own account. local deploys live in forge scripts (`contracts/test/mocks/*.s.sol`), which `test/anvil.ts` runs and reads addresses from.
- **writes**: wait for a test's write with `waitForTransactionReceipt({ hash: await client.writeContract(...) })`, not the `*Sync` actions.
- **e2e harness**: `test/e2e.ts` serves the e2e stack. its routes hand flows what the app can't reach (`/e2e/credential`, `/e2e/platinum`), never a wait for the server or the chain: flows wait for what users see or read the chain from a script.
- **explain failures**: find the cause of every failure before changing anything. flaky is not a cause. a known one: anvil 1.7.1 can run a `latest` read on a new block's state with the previous block's timestamp, which breaks a market's accrual math (panic `0x11`).

## development workflow

- **start dev server**: `pnpm nx dev server` (uses `tsx` for hot-reload).
- **api generation**: `pnpm nx generate:openapi server` to update the openapi spec.

@../common/AGENTS.md
