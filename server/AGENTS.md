# server (`server`)

hono on node, drizzle on postgres, valibot validation, openapi generated from the routes.

## api

- **schema-first**: every route has `describeRoute()` (`hono-openapi`) and validates its input in middleware: `hono-openapi/valibot` for documented routes, `@hono/valibot-validator` for internal hooks and webhooks. no manual validation in handlers.
- **validated input**: handlers read headers, body, params and cookies through `c.req.valid()`.
- **typed responses**: `return c.json({ id, name } satisfies InferOutput<typeof UserResponse>)`.
- **status codes**: use http fully. expected failures return `c.json({ code: "..." }, status)`, and 500 is for what shouldn't happen (type guards). new code omits the deprecated `legacy` field.
- **one handler per flow**: a handler owns its endpoint's whole flow, however long (200 lines for one flow is fine). extract only code shared by several routes, or wrappers for remote apis (sardine, panda, persona) with their own auth, retries and error mapping.
- **layout**: routes in `server/api/`, grouped by `index.ts` and mounted in `server/index.ts`. blockchain events and third-party webhooks in `server/hooks/`. small pure helpers in `server/utils/`.

## database

- `server/database/schema.ts` is the truth, relations included. change it and apply it with `pnpm nx db:push server`. there are no migration files, and the schema is never edited by hand.
- the drizzle query builder, raw sql only when unavoidable.
- import the singleton (`import database from "../database"`), never open connections in handlers.

## auth

- passkeys first. auth lives in middleware, and handlers read the session from `c.req.valid("cookie").credentialId`, loading the rest from the database.

## runtime

- environment variables come from `node:env` and are validated at import time, so a missing one fails at startup, not on first use.
- no long synchronous work on the event loop.

## tests

- `pnpm nx test:vi server` runs vitest with coverage. tests live in `server/test/`, one file per route or module, related assertions in one `describe`.
- **full branch coverage** of every new or changed line: each `if`/`else`, ternary, `??`, `||`, `&&`, early return and `catch` gets a test. check the coverage report before committing.
- **assert everything observable**: status, body, database state, headers and error codes, with `toStrictEqual` over `toMatchObject`.
- **assert monitoring**: `captureException` calls with their exact fingerprints, levels and context, external service spies (notifications, risk, analytics), span names, ops and attributes. untested tracking is broken tracking.
- **assert the negative**: `not.toHaveBeenCalled()` on everything that must stay silent.

## commands

- `pnpm nx dev server` (hot reload with `tsx`), `pnpm nx generate:openapi server` to update the openapi spec.
