# gcp worker cost estimate

<!-- cspell:ignore autohealing autopilot autokey kubernetes memorystore reauthentication vcpu -->

this estimate is based on the repository at 2026-07-28 and current public google cloud list prices. it uses usd,
730 hours per average month, on-demand pricing, no committed-use discount, and no tax. it estimates the one
checked-in `base-sepolia` stack in project `exa-dev`.

## answer

the predictable direct cost is about **$31.17 per month** for `credit` and `subscribe`, and **$33.67 per month**
for `allow`, `poke`, and `refund`. the latter three each own one hsm elliptic-curve key version that adds $2.50.
these figures are before billing-account free tiers and exclude usage-driven logging, outbound data, and key
operations.

| worker | cloud run | hsm key | direct fixed subtotal |
| --- | ---: | ---: | ---: |
| `allow` | $31.17 | $2.50 | $33.67 |
| `credit` | $31.17 | $0.00 | $31.17 |
| `poke` | $31.17 | $2.50 | $33.67 |
| `refund` | $31.17 | $2.50 | $33.67 |
| `subscribe` | $31.17 | $0.00 | $31.17 |
| all five | $155.86 | $7.50 | $163.36 |

the stack also defines nine shared secret containers. assuming exactly one active version in each, their gross
fixed cost is $0.54 per month. if this billing account has all relevant free tiers unused, cloud run contributes a
$5.22 discount and secret manager contributes a $0.36 discount. the resulting five-worker baseline is therefore
about **$158.32 per month**:

- $150.6401 cloud run after its shared free tier
- $7.50 for three active hsm key versions
- $0.18 for three secret versions beyond the six-version free tier

an arbitrary equal allocation of those two shared discounts produces about **$32.66 each** for `allow`, `poke`,
and `refund`, and **$30.16 each** for `credit` and `subscribe`. that allocation is useful for budgeting, but it is
not how google cloud identifies the shared discount on the invoice. if other projects under the billing account
already consume either free tier, use the direct figures above plus the secret cost instead.

## current configuration

the infrastructure source sets the location to `us-west1` unless overridden, creates five cloud run worker pools,
and defaults every `manualInstanceCount` to one. every resource override is optional and none is present in the
checked-in stack configuration. the deployment workflow supplies only the image tag at deployment time. see
[`infra/index.ts`](../infra/index.ts), [`infra/Pulumi.base-sepolia.yaml`](../infra/Pulumi.base-sepolia.yaml), and
[`.github/workflows/server-deploy.yaml`](../.github/workflows/server-deploy.yaml).

google documents a default of one vcpu and 512 mib for a worker-pool instance when limits are omitted. see the
[worker-pool cpu documentation](https://docs.cloud.google.com/run/docs/configuring/workerpools/cpu) and
[worker-pool memory documentation](https://docs.cloud.google.com/run/docs/configuring/workerpools/memory-limits).

manual scaling bills every requested instance as active even when it is idle. see the
[worker-pool manual-scaling documentation](https://docs.cloud.google.com/run/docs/configuring/workerpools/manual-scaling).
there is no request-based charge and no scale-to-zero behavior in this configuration.

## cloud run calculation

`us-west1` is a tier-one region. current on-demand worker-pool prices are $0.000011244 per vcpu-second and
$0.000001235 per gib-second. the billing-account free tier is 384,204 vcpu-seconds and 728,744 gib-seconds per
month. see the [cloud run pricing table](https://cloud.google.com/run/pricing).

the reproducible formula for one pool is:

`hours × 3,600 × instances × (vcpu × $0.000011244 + memory gib × $0.000001235)`

with the checked-in defaults:

`730 × 3,600 × 1 × (1 × $0.000011244 + 0.5 × $0.000001235) = $31.172022`

the hourly rate is $0.0427014, so an exact calendar month varies with its hours. each additional manual instance
adds the same amount. the five pools consume 13,140,000 vcpu-seconds and 6,570,000 gib-seconds in a 730-hour
month, fully exhausting both free caps. the maximum shared discount is:

`384,204 × $0.000011244 + 728,744 × $0.000001235 = $5.219988616`

compute flexible committed-use rates would reduce the gross cloud run portion to $22.44 per pool with the
published one-year rate or $16.83 with the published three-year rate. there is no evidence of a commitment in the
repository, commitments are billing-account resources, and unused versus already-covered commitment capacity
cannot be inferred from code. the hsm, secret, logging, storage, and network charges do not receive this cloud run
compute discount.

## gcp alternatives

an exact replacement must preserve five independently deployed, continuously running, non-http background
consumers; one instance with 1 vcpu and 512 mib for each worker; managed restart and revision rollout behavior;
regional platform redundancy without operating hosts or nodes; and first-class pulumi resources. under that
definition, no other gcp runtime is cheaper. cloud run describes worker pools as the resource designed for
continuous, non-http, pull-based work and manages cloud run region capacity redundantly across zones. see the
[cloud run resource model](https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run) and
[worker-pool deployment documentation](https://docs.cloud.google.com/run/docs/deploy-worker-pools).

the following totals include the same $7.50 hsm key storage and $0.18 secret storage used in the current
free-tier-adjusted baseline. they use 730 hours and assume the relevant cloud run or gke billing-account free tier
is otherwise unused:

| runtime | five-worker monthly total | change from $158.32 | exact replacement |
| --- | ---: | ---: | --- |
| current cloud run worker pools | $158.32 | baseline | yes |
| gke autopilot at 1 vcpu per worker | $188.08 | $29.76 more, 18.8% | no |
| cloud run services with manual scaling | $252.12 | $93.80 more, 59.2% | no |
| cloud run jobs, gcp batch, or spot capacity | workload-dependent | potentially cheaper | no |
| gke standard or compute engine managed instance groups | topology-dependent | potentially cheaper | no |

### gke autopilot

gke autopilot and kubernetes deployments are both first-class pulumi resources through
[`gcp.container.Cluster`](https://www.pulumi.com/registry/packages/gcp/api-docs/container/cluster/) and the
[`kubernetes.apps.v1` module](https://www.pulumi.com/registry/packages/kubernetes/api-docs/apps/v1/). it provides
managed scheduling, restart, rollout, and cluster upgrades, but introduces a kubernetes control plane and workload
configuration surface that worker pools do not require.

autopilot cannot preserve the current resource shape exactly. its general-purpose cpu-to-memory ratio must be
between 1:1 and 1:6.5, so a pod requesting 1 vcpu and 512 mib is raised to 1 gib. explicitly requesting the
10-mib ephemeral-storage minimum avoids the 1-gib default. see the
[autopilot resource-request rules](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/autopilot-resource-requests).
at current `us-west1` list rates, the five-pod compute calculation is:

`730 × 5 × ($0.0445 + 1 × $0.0049225 + 10 / 1,024 × $0.0001389) = $180.397076`

the cluster-management fee is `730 × $0.10 = $73`, but the gke billing-account free tier provides up to $74.40
monthly credit for one autopilot or zonal cluster. this produces the $188.08 total after adding the existing hsm
and secret costs. if another cluster already consumes that credit, the total becomes **$261.08**. the official
rates, management fee, and free-tier rules are in the
[gke pricing table](https://cloud.google.com/kubernetes-engine/pricing).

autopilot becomes cheaper only by reducing the cpu guarantee:

| autopilot request per worker | monthly total | saving | lost capacity |
| --- | ---: | ---: | --- |
| 0.5 vcpu and 512 mib | $97.88 | $60.44, 38.2% | half of each worker's current cpu |
| 0.25 vcpu and 512 mib | $57.27 | $101.05, 63.8% | three quarters of each worker's current cpu |

these totals include 10 mib of ephemeral storage per pod, the existing hsm and secret costs, and the otherwise
unused gke cluster-management credit. they are useful right-sizing candidates only after measured peak cpu and
queue-latency tests; they are not equivalent service levels.

### cloud run services

cloud run services are first-class pulumi resources through
[`gcp.cloudrunv2.Service`](https://www.pulumi.com/registry/packages/gcp/api-docs/cloudrunv2/service/) and can use
manual scaling with instance-based billing. they still require the application to listen on an http port and
create a load-balanced service endpoint, neither of which these workers need. instance-based service prices are
also higher:

`730 × 3,600 × 5 × (1 × $0.000018 + 0.5 × $0.000002) = $249.66`

after the same $5.22 cloud run free-tier discount and $7.68 shared hsm and secret cost, the total is **$252.12**.
the rates and free tier are in the [cloud run pricing table](https://cloud.google.com/run/pricing), while the
[billing documentation](https://docs.cloud.google.com/run/docs/configuring/billing-settings) explains the
continuous cpu behavior.

### vm and task runtimes

compute engine regional managed instance groups have first-class pulumi coverage through
[`gcp.compute.RegionInstanceGroupManager`](https://www.pulumi.com/registry/packages/gcp/api-docs/compute/regioninstancegroupmanager/)
and support autohealing and managed updates. packing all workers onto fewer vms can lower raw compute cost, but it
creates a shared failure domain and makes the team responsible for the host image, container runtime, security
patching, placement, capacity headroom, health endpoint, logging agent, and rollout policy. adding enough
instances across zones for equivalent failure isolation and rollout headroom removes the attractive single-vm
comparison. it is therefore not the same managed service even though the infrastructure resources have excellent
pulumi support.

gke standard has the same node-capacity and node-operations tradeoff plus kubernetes administration. cloud run
jobs and gcp batch execute finite tasks rather than an always-running queue consumer. spot pods and spot vms can
be terminated and therefore reduce availability. app engine flexible and cloud run services require an http
application contract. none meets the exact replacement criteria.

### exact savings without changing the runtime

the only material way to reduce cost while preserving the exact runtime and capacity is a compute flexible
committed-use discount:

| purchase model | monthly total | monthly saving | reduction |
| --- | ---: | ---: | ---: |
| on demand | $158.32 | $0.00 | 0.0% |
| one-year compute flexible commitment | $114.68 | $43.64 | 27.6% |
| three-year compute flexible commitment | $86.63 | $71.69 | 45.3% |

the totals apply the published worker-pool rates, the $5.22 cloud run free-tier discount, and the existing $7.68
hsm and secret cost. compute flexible commitments are billing-account-wide, cover cloud run worker pools, and
cannot be cancelled; the committed hourly spend is charged even if the workers stop. see the
[cloud run commitment documentation](https://docs.cloud.google.com/run/cud).

the runtime remains fully managed by the repository's first-class `cloudrunv2.WorkerPool` resources. the
commitment purchase itself is different: google documents console purchase and preview cloud commerce consumer
procurement api support, but the pulumi gcp provider does not document a first-class spend-based compute flexible
commitment resource. `gcp.compute.RegionCommitment` is a regional, resource-based compute engine commitment and
does not buy this cloud run discount. if every billing action must also be represented by a first-class pulumi
resource, neither compute flexible commitment option meets that stricter infrastructure-as-code requirement.

## cloud kms

`allow`, `poke`, and `refund` each create a protected, retained hsm key using
`EC_SIGN_SECP256K1_SHA256`. each also defaults to key version `1`. see
[`infra/index.ts`](../infra/index.ts) and [`server/utils/wallet.ts`](../server/utils/wallet.ts).

google prices an active hsm elliptic-curve key version below the first 2,000 account-months at $0.003424658 per
hour, or $2.50 over 730 hours. these keys are created explicitly rather than through autokey, so the autokey-only
free version and operation allowances do not apply. protected and retained keys continue to cost money even if a
worker is scaled to zero. additional enabled, disabled, or scheduled-for-destruction versions would each add
another $2.50 per average month. see the
[cloud kms pricing table](https://cloud.google.com/kms/pricing).

hsm secp256k1 signing operations cost $0.15 per 10,000 operations, or $0.000015 each. public-key retrieval costs
$0.03 per 10,000 operations, or $0.000003 each. every transaction signature by `allow`, `poke`, or `refund`
therefore adds at least $0.000015. wallet construction can also retrieve the public key, and retries can repeat
both wallet construction and signing. a useful workload formula is:

`$0.000003 × public-key operations + $0.000015 × signature operations`

`allow` and `refund` normally sign one transaction for a successful job. `poke` can sign one account-creation
transaction plus one transaction for each positive asset balance, so its per-job operation count is workload
dependent. job retry limits are ten in all three cases. admin operations are free.

## secret manager

the stack defines nine automatically replicated secrets. automatic replication counts as one billable location.
assuming one active version per secret, gross storage is `9 × $0.06 = $0.54` per month. the first six active
versions and first 10,000 access operations are free per billing account, leaving $0.18 if those allowances are
otherwise unused. additional active historical versions add $0.06 each. see the
[secret manager pricing table](https://cloud.google.com/secret-manager/pricing).

the workers read these values when their process starts:

| worker | application reads | cloud run secret reference | estimated accesses per start |
| --- | ---: | ---: | ---: |
| `allow` | 1 | 1 | 2 |
| `credit` | 3 | 1 | 4 |
| `poke` | 3 | 1 | 4 |
| `refund` | 3 | 1 | 4 |
| `subscribe` | 2 | 1 | 3 |

the application reads are visible in the five worker `bin.ts` files under
[`server/workers`](../server/workers), and every pool also injects `SENTRY_DSN` from secret manager in
[`infra/index.ts`](../infra/index.ts). one start of every worker is only 17 accesses, well inside an otherwise
unused free tier. beyond the shared 10,000-operation allowance, each access costs $0.000003. deployments,
crashes, and platform restarts can cause more starts, so exact access cost requires the secret manager operation
metric or billing export.

## artifact registry and image transfer

all workers share one `us-west1` remote artifact registry repository that proxies `ghcr.io`. the cleanup policy
deletes cached content older than one day. remote repositories cache upstream artifacts, so the charge depends on
the average cached layer size, not the number of worker pools. see
[`infra/index.ts`](../infra/index.ts) and the
[remote-repository documentation](https://docs.cloud.google.com/artifact-registry/docs/repositories/remote-overview).

artifact registry storage is $0.10 per gib-month after the first 0.5 gib per billing account. a useful formula is
`max(average cached gib - 0.5 shared free gib, 0) × $0.10`. transfer from the repository to cloud run is free
because their locations match. transfer into artifact registry from the upstream is also free from google cloud's
side. see the [artifact registry pricing table](https://cloud.google.com/artifact-registry/pricing).

the repository does not enable container scanning, so scanning is excluded. the workflow deploys an existing
`ghcr.io` image and does not invoke cloud build, so cloud build is also excluded.

## logging, monitoring, and tracing

cloud logging storage is $0.50 per gib after the first 50 gib per project each month; the default 30-day retention
is included. retention beyond 30 days costs $0.01 per gib-month. the formula is
`max(stored log gib - 50 project free gib, 0) × $0.50`, plus any extended-retention charge. see the
[google cloud observability pricing table](https://cloud.google.com/products/observability/pricing).

the infrastructure does not define log exclusions, custom buckets, or longer retention. it does set `DEBUG` to
`exa:*`, while the application also reports fully sampled traces and profiles to sentry. the latter is not cloud
trace, but it can increase outbound data transfer. exact log volume cannot be derived from source because it
depends on failures and runtime output. the 50-gib logging allowance is shared by the entire `exa-dev` project,
not reserved for these workers.

automatically collected google cloud metrics are non-chargeable. the repository defines no custom monitoring
metrics, uptime checks, synthetic monitors, or alerting policies, so no monitoring charge is included. sentry
charges are third-party costs and are outside this gcp estimate.

## outbound data transfer

cloud run uses premium network tier for outbound internet transfer. from `us-west1`, transfer to north america,
europe, and most of asia is $0.12 per gib for the first 1 tib after the applicable first 1 gib free allowance.
destinations in australia, indonesia, korea, south america, and saudi arabia start at $0.19 per gib; other middle
east and african destinations start at $0.15; china starts at $0.23. inbound transfer is free. see the
[google cloud network pricing table](https://cloud.google.com/vpc/network-pricing).

the destination locations and byte volumes are hidden behind secret urls or third-party libraries. all five
workers maintain redis traffic. in addition:

- `allow` uses alchemy rpc and sentry
- `credit` uses alchemy rpc, postgres, onesignal, and sentry
- `poke` uses alchemy rpc, onesignal, segment, and sentry
- `refund` uses alchemy rpc, panda, and sentry
- `subscribe` uses alchemy and sentry

the gcp egress formula must therefore be applied to measured bytes by destination sku. same-region transfer to a
google cloud resource is free, but this infrastructure defines no direct vpc egress, serverless vpc connector,
cloud nat, cloud sql instance, or memorystore instance. if the secret urls point to separately managed gcp
databases, their compute and storage costs are not represented in this repository and must be added from the
owning project. third-party service fees are outside this estimate.

## other shared infrastructure

the pulumi state bucket is a shared `US` multi-region standard-storage bucket in project `eexxxaa`; it is not a
per-worker resource. multi-region standard storage is $0.026 per gib-month, class-a operations are $0.01 per
1,000, and class-b operations are $0.0004 per 1,000. state reads by github actions can also create internet
transfer. see [`infra/meta.ts`](../infra/meta.ts) and the
[cloud storage pricing table](https://cloud.google.com/storage/pricing). state size and deployment frequency are
unknown, so this cost is not allocated to a worker.

service accounts, iam bindings, key rings without active key versions, api enablement, and the cloud run worker
pool control-plane resources have no separate charge in the published pricing model. no gpu or mounted ephemeral
disk is configured. if an ephemeral-disk volume is later mounted, its full provisioned size is billed at
$0.000109589 per gib-hour on demand; see the
[worker-pool ephemeral-disk documentation](https://docs.cloud.google.com/run/docs/configuring/workerpools/ephemeral-disk).

## caveats and verification

- usd list prices can differ from contract prices. a non-usd billing account uses its cloud platform sku prices
  and google's billing conversion, while taxes depend on the billing profile and are not included here. google
  documents tax as an invoice-level charge in the
  [cloud billing report documentation](https://docs.cloud.google.com/billing/docs/how-to/reports/charges-on-invoices).
- free tiers and commitments are shared at billing-account scope, except the 50-gib logging allowance, which is
  project scoped. the marginal cost can therefore differ from the isolated-stack estimate.
- the repository proves desired defaults, not live state. manual console changes, additional active key or secret
  versions, different stack configuration, and retained resources require a live inventory or billing export.
  live `gcloud` verification was unavailable because the configured credentials require reauthentication.
- the average 730-hour month is suitable for budgeting. use actual calendar hours for invoice reconciliation.
- the most useful measurements are cloud run billable instance time, cloud kms operation counts, secret manager
  access counts, logging bytes, artifact registry stored bytes, and network bytes grouped by destination sku.
