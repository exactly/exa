# infra (`infra`)

infra is where mistakes reach real users and funds. every change here is a production change, even when it only touches a staging stack.

## programs

- **stack**: pulumi with the gcp provider, typescript run directly by node (no build step). `index.ts` is the program of the deploy stacks (`production`, `base`, `base-sepolia`, `sandbox`), and `meta.ts` drives the `meta` stack through the automation api.
- **modules**: `utils/modules.ts` is the single list of server modules: the api and hook services, the worker pools, and each one's env, secrets and signers. both programs read it, so a module, secret or signer is added there and nowhere else.
- **module names**: a module's name is its entrypoint (`dist/workers/<name>/bin.cjs`, `dist/hooks/bin/<name>.cjs`), its queue (crema scales each pool on `bull:<name>:*`), its service account and the prefix of its secrets (`<stack>-<name>-<secret>`). the secrets a bin reads at startup must match the ones its module lists, or it can't start.
- **one process per module**: every service and pool runs at most one instance, with its own service account, its own kms signer per role and only the secrets it lists. never share an identity, a signer or a secret between modules to save a step.
- **startup checks**: each pool gets a `<name>-check` job that runs the new image with `--check` on every rollout before the pool updates, so a worker that can't start fails the deploy instead of the pool.

## config and secrets

- **stack config**: per stack values live in `Pulumi.<stack>.yaml` under `exa:` and are read with `config.require` or `config.get` (`<module>Minimum`, `<module>Resources`, `<module>Timeout`, `<signer>Version`). `serverImage` and `rollout` come from the deploy workflow, never from the stack files.
- **no pulumi secrets**: stack files hold plain values only, and `rejectSecrets` fails any run that finds a `secure` one. secret values live in secret manager: `meta` creates each secret empty, its value is set by hand, and modules read it at startup.

## state and deploys

- **meta stack**: `meta` owns what a deploy needs before it can run: the state bucket, workload identity, the github and module service accounts, custom roles, kms keys and empty secrets. its state is `gs://exa-pulumi-state/meta`, every resource it declares is protected, and it runs by hand for one target stack at a time (`pnpm nx meta infra preview <stack>`, then `up`).
- **deploys**: deploy stacks change only through `server-deploy.yaml` (`pulumi up --refresh`): `base`, `base-sepolia` and `sandbox` on every push to their branches, `production` on `@exactly/server@*` tags. the workload identity trusts only that workflow on those refs. never push to those branches, create a server tag, or run `up` or `meta` yourself.
- **protected resources**: the egress address and everything in `meta` are protected, and kms keys are kept on delete. a change that would replace or delete one fails the run. never unprotect, delete or edit state to get past it: stop and ask.
- **stable names**: a resource's logical name is its urn. renaming it, or moving it under another parent, replaces the resource, so keep names stable or add an alias.

## checks

- **local checks**: `pnpm nx test infra` runs eslint and typescript only. nothing runs a program before it deploys, so check every resource argument against the provider docs and think through what a refresh and update do to the live resource.

@../common/AGENTS.md
