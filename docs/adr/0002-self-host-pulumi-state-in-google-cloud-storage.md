# self-host pulumi state in google cloud storage

pulumi stack state is stored in the dedicated private `exa-pulumi-state` google cloud storage backend instead of
pulumi cloud, github storage, cloud sql, or a persistent runner; the production google cloud project `eexxxaa` owns
the backend and github workload identity federation. the meta stack owns each workload project's `github-<stack>`
deployment service account, four runtime worker service accounts, minimum iam grants scoped to matching github
environments, and default-service-account organization policy, and creates no kms key, application infrastructure, or
secret value. a one-time human-authenticated local update creates these resources
from a temporary checkpoint before an operator explicitly migrates it and existing runtime checkpoints into the
bucket; the meta stack remains in the exa project but every update runs locally through `meta.ts` as
a human-authenticated automation api inline program, while github updates only runtime stacks. disabling the meta
stack's default providers and using an explicit google cloud provider makes ordinary updates through `index.ts` fail
before proposing changes. the `meta` nx target requires exactly `preview` or `up`, rejects missing or unknown commands,
and exposes no destroy command. `Pulumi.meta.yaml` is committed upfront with only the shared encryption salt and the
fail-closed provider setting:

```yaml
encryptionsalt: v1::v1:AAAAAAAAAAAAAAAb:rYjVO7/uF2+Qv1LhWq5c2S0ZR4rZaQ==
config:
  pulumi:disable-default-providers: ["*"]
```

after the one-time migration, the operator copies the provider stack output into
`GCP_WORKLOAD_IDENTITY_PROVIDER`, the sole non-secret repository variable; neither pulumi nor ci stores a github token
for this handoff. deployments read the workload project from the committed stack config, derive the `github-<stack>`
service-account email and stack-prefixed backend from the project and stack, and use the hardcoded bucket name. github
environments are operator-managed and must be protected before their stack is added; meta neither creates nor validates
them.
runtime stacks and workload projects are discovered from `Pulumi.<stack>.yaml` files other than `Pulumi.meta.yaml`.
every stack passed to `server-deploy.yaml` requires a matching file; absence is a deployment error rather than an
opt-out signal. these files are the single source for runtime configuration, identity scope, and github environment
trust.
the immutable numeric repository and owner ids are committed in `meta.ts` for the provider condition, which also
requires `job_workflow_ref` to identify this repository's `server-deploy.yaml` reusable workflow at any ref. each
deployment account permits impersonation only from its matching discovered environment; mutable repository and owner
names are not trust anchors. meta creates a custom deployment role in every workload project that permits stack-prefixed
secret container and iam administration while excluding every secret-version permission, so github automation cannot
read or write application secret payloads. the single bucket contains separate backends under the
`meta` prefix and each discovered runtime stack name. deployment accounts may list object names bucket-wide but may
read, create, update, or delete objects only under their stack's prefix, preventing peer stacks from reading or
corrupting each other's checkpoints. stacks that share a workload project retain project-wide artifact registry, cloud
run, and api enablement permissions, so this state isolation does not claim to isolate their google cloud resources. bucket protection settings remain
unspecified so google cloud service defaults govern soft delete, object versioning, and retention. the bucket explicitly enables uniform bucket-level
access so conditioned iam is its only authorization system and enforces public access prevention.
deployment accounts receive no basic project role such as owner or editor. meta grants artifact registry editor, cloud
run developer, and service usage admin project-wide; grants kms admin only for the stack's signer key ring; grants
service account user on each runtime worker account; and conditions custom secret permissions to the stack prefix. meta
also prevents automatic editor grants to default service accounts. the one-time migration uses explicit pulumi export, stack initialization, and import commands;
stack initialization refuses to overwrite an existing destination. the complete source backend remains untouched as
the read-only pre-migration archive; its history, locks, and backend metadata are not copied, while google cloud
storage starts new history at import:

```sh
root=$(mktemp -d) # cspell:ignore mktemp
export PULUMI_CONFIG_PASSPHRASE=
mkdir -p "$root/meta"
PULUMI_BACKEND_URL="file://$root/meta" pulumi stack init meta --cwd infra
PULUMI_BACKEND_URL="file://$root/meta" pnpm nx meta infra -- up
PULUMI_BACKEND_URL="file://$root/meta" pulumi stack export --stack meta --cwd infra > "$root/meta.json"
PULUMI_BACKEND_URL="file://$HOME" pulumi stack export --stack base-sepolia --cwd infra > "$root/base-sepolia.json"
PULUMI_BACKEND_URL=gs://exa-pulumi-state/meta pulumi stack init meta --cwd infra
PULUMI_BACKEND_URL=gs://exa-pulumi-state/meta pulumi stack import --stack meta --cwd infra < "$root/meta.json"
PULUMI_BACKEND_URL=gs://exa-pulumi-state/base-sepolia pulumi stack init base-sepolia --cwd infra
PULUMI_BACKEND_URL=gs://exa-pulumi-state/base-sepolia pulumi stack import --stack base-sepolia --cwd infra < "$root/base-sepolia.json"
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --repo exactly/exa --body "$(PULUMI_BACKEND_URL=gs://exa-pulumi-state/meta pulumi stack output provider --stack meta --cwd infra)"
```

the runtime export, initialization, and import are repeated for each discovered stack that already has a local
checkpoint.
ordinary `meta.ts` updates use only the meta backend in google cloud storage.
every runtime stack config is committed before initialization with the same existing cspell-safe encryption salt and
no `secure` value. each pulumi program rejects secret values in its selected stack config before declaring resources,
while deployment workflows do not duplicate this validation. all operations explicitly use an empty
`PULUMI_CONFIG_PASSPHRASE` because pulumi state is not a secret store. one stack transformation marks every
meta resource as protected, so deletion requires an explicit update that removes protection before teardown.
