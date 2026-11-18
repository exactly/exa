# infra (`infra`)

## stacks

- **one file per stack**: `Pulumi.<stack>.yaml` holds plain config for `production`, `base`, `base-sepolia` and `sandbox`. testnet stacks live in the `exa-dev` gcp project.
- **deploys**: `server-deploy.yaml` runs `pulumi up --refresh` with the commit's server image. a push to `sandbox` deploys `sandbox` and `base-sepolia`, and a server release tag deploys `production` and `base`.
- **meta**: `meta.ts` (`pnpm meta`) owns what every stack needs before its first deploy: state bucket, github identity, service accounts, kms signer keys and empty secrets. everything in it is protected. it reads every stack file, so a stack setting it doesn't accept breaks it for all stacks.
- **modules**: `utils/modules.ts` declares every service, worker and feature, and the indexer. `exa:disabled` in a stack file turns any of them off on that stack.

## names

- **derive, never guess**: every gcp resource name comes from code. read `index.ts`, `meta.ts` and `utils/modules.ts` before naming a resource in a command.
- **secrets**: a module's own secret is `<stack>-<module>-<secret>` (`sandbox-subscribe-postgres-url`), a shared one is `<stack>-<secret>` (`sandbox-redis-url`), and the indexer's is `<stack>-indexer-postgres-url`. there is no stack-wide `postgres-url`.
- **service accounts**: `<stack>-api`, `<stack>-<module>-hook`, `<stack>-<module>-worker`, `<stack>-indexer`.

## rollout

- **checks gate pools**: each worker has a `<stack>-<worker>-check` job that runs its bin with `--check` on every rollout. a failing check fails the deploy before the pool changes.
- **egress**: every stack leaves through one static ip (`<stack>-egress`). allowlists outside gcp use it.
- **alerts**: alert policies post to the stack's `exa:alertChannel`.

## indexer

- **one pool per image**: each deploy creates a `<stack>-indexer-sha-<commit>` worker pool that indexes into a schema of the same name. the `indexer-promote` job waits until it is ready, points the `indexer` views at it and drops older schemas.
- **failed deploys leak pools**: only a successful `pulumi up` deletes the previous pools. a deploy that fails after creating its pool leaves it running, and it keeps alerting until a deploy goes green.
- **one indexer per database**: promote drops every other ponder schema in its database, so stacks that share a database run a single indexer. the testnet stacks share one, and `base-sepolia` disables its indexer.

## secrets

- **no secrets in env vars**: no real secret reaches a gcp container through an env var. a module lists its secrets in `utils/modules.ts`, its service account gets read access to each one, and its bin reads them from secret manager at startup. env vars carry plain config only, from the stack files, which `rejectSecrets` keeps free of secrets. the one exception is `SENTRY_DSN`, which sentry needs before anything else runs and which isn't really secret.

@../common/AGENTS.md
