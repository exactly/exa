# infra (`infra`)

## infra is code

- **change it in code**: every gcp resource is declared in this package. a change that needs a new one declares it in the same pr as the code that uses it, and pulumi applies it. hand-run cloud commands are never the answer.
- **read the preview**: every infra pr runs `infra/preview`, which shows what each stack would change. read it before asking anyone to apply anything.
- **names come from code**: read the declarations before naming a resource. never guess one.

## secrets

- **no secrets in env vars**: no real secret reaches a gcp container through an env var. a module lists its secrets in `utils/modules.ts`, its service account gets read access to each one, and its bin reads them from secret manager at startup. env vars carry plain config only, from the stack files, which `rejectSecrets` keeps free of secrets. the one exception is `SENTRY_DSN`, which sentry needs before anything else runs and which isn't really secret.

@../common/AGENTS.md
