# infra (`infra`)

## secrets

- **no secrets in env vars**: no real secret reaches a gcp container through an env var. a module lists its secrets in `utils/modules.ts`, its service account gets read access to each one, and its bin reads them from secret manager at startup. env vars carry plain config only, from the stack files, which `rejectSecrets` keeps free of secrets. the one exception is `SENTRY_DSN`, which sentry needs before anything else runs and which isn't really secret.

@../common/AGENTS.md
