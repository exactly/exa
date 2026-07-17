# drive pulumi updates from git promotion signals

pulumi runtime stack updates reuse the server promotion signals: base-sepolia builds from `sandbox` after the current
`infra` development period, while base and sandbox build from their matching branches. every image-backed stack
receives `exa:serverImage` at update time as the canonical `sha-${longCommitHash}` tag derived from the checked-out
`git rev-parse HEAD`; deployment assumes the preceding build published that tag and uses no environment variable,
build output, registry lookup, or generated config commit. `server-deploy.yaml` remains the shared deployment boundary
for digitalocean and pulumi on google cloud throughout their coexistence and always runs both providers. every caller
requires a matching `infra/Pulumi.<stack>.yaml`; missing configuration fails deployment instead of silently skipping
google cloud. pulumi automation uses only the repository's `GITHUB_TOKEN`, never
`RELEASE_GITHUB_TOKEN` or a signing key. the reusable workflow runs digitalocean and pulumi as parallel sibling jobs
under one stack-level concurrency boundary, keeps each provider's credentials isolated, and fails unless both
deployments succeed. each sibling references the same github environment independently, accepting separate protected
job approvals in exchange for parallelism, isolated credentials, and environment-bound oidc. the concurrency group
never cancels an active deployment; a newer promotion waits while github
coalesces obsolete pending runs into the latest one. deployment is convergent rather than transactional across
providers: if one sibling fails, the successful deployment remains intact and the failed job is rerun without an
automatic cross-provider rollback. after github environment protection passes, ci performs one `pulumi up --yes`
with its immediate built-in preview; it neither skips the preview nor persists a separate plan for later approval.
every update includes `--refresh`, making the declared program reconcile against live google cloud state instead of
only the previous checkpoint. deployment reads only the workload project needed to derive its service account, while
the authentication action infers its project from that account. ci selects the stack with `--create`, allowing the
required config file to initialize an empty checkpoint without a manual command. the runtime pulumi program rejects
secret stack config before declaring resources. a pulumi backend lock always fails the deployment; automation never
cancels it, and an operator must first
confirm no update is active before clearing a stale lock and rerunning. no scheduled drift workflow exists until
detected drift has an explicit alert owner.
