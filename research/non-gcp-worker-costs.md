# non-gcp worker cost comparison

<!-- cspell:ignore allupfront appplatform containerapp digitalocean fargate fips graviton interruptible keyvault ngroup no-upfront overprovisioned permissioned savingsplans secg secp256k1 vcpu -->

this comparison uses the repository at 2026-07-28, usd list prices, and 730 hours per average month. it compares
alternatives with the existing free-tier-adjusted gcp baseline of **$158.32 per month** from
[`gcp-worker-costs.md`](./gcp-worker-costs.md). usage-driven logging, outbound data, and signing operations are
excluded consistently.

## answer

aws ecs fargate is the only non-gcp option that preserves the important service boundaries: five independently
deployed, continuously running non-http containers; managed desired-count replacement and rolling deployments;
per-worker workload identity; managed secrets and logs; three hsm-backed secp256k1 signers; and official pulumi
resources for both the runtime and its commitment.

on demand, aws is not cheaper. with an aws compute savings plan, it can be:

| aws fargate model | effective monthly total | change from $158.32 |
| --- | ---: | ---: |
| x86 on demand | $201.45 | $43.13 more, 27.2% |
| x86 one-year all upfront | $152.80 | $5.52 less, 3.5% |
| x86 three-year no upfront | $120.36 | $37.96 less, 24.0% |
| x86 three-year all upfront | $107.75 | $50.57 less, 31.9% |
| arm on demand | $165.43 | $7.10 more, 4.5% |
| arm one-year all upfront | $127.17 | $31.15 less, 19.7% |
| arm three-year no upfront | $99.10 | $59.22 less, 37.4% |
| arm three-year all upfront | $91.88 | $66.44 less, 42.0% |

the maximum strict saving without changing cpu architecture is therefore **$50.57 per month, or 31.9%**, with a
three-year all-upfront aws commitment. arm raises the potential saving to **$66.44 per month, or 42.0%**, but the
current build workflow produces the runner's default amd64 image and does not specify a multi-architecture
`platforms` value. arm is a migration candidate only after the image and native dependencies are validated. see
[`.github/workflows/server-build.yaml`](../.github/workflows/server-build.yaml).

this does not beat the best gcp price. the existing worker pools cost about **$114.68** with a one-year gcp
commitment and **$86.63** with a three-year commitment. the three-year gcp result is $21.12 below aws x86 and
$5.25 below aws arm. aws has one pulumi advantage: the irreversible purchase is represented by the first-class
[`aws.savingsplans.SavingsPlan`](https://www.pulumi.com/registry/packages/aws/api-docs/savingsplans/savingsplan/)
resource, while the applicable gcp spend-based commitment is not documented as a first-class pulumi gcp resource.

## equivalence boundary

the current stack defines five cloud run worker pools with one continuously billed instance each. omitted resource
overrides default to one vcpu and 512 mib. three workers have their own hsm-protected secp256k1 signing key, and the
stack defines nine secrets. see [`infra/index.ts`](../infra/index.ts).

an alternative qualifies only when it provides:

- five independent non-http worker deployments with one continuously running instance each;
- at least one dedicated vcpu per worker and at least 512 mib of memory;
- managed replacement, revision rollout, host maintenance, and regional placement;
- a distinct workload identity and least-privilege secret and signing-key access for every worker;
- non-exportable hsm-backed secp256k1 signing;
- official pulumi resources for the runtime, identity, secrets, keys, and any quoted commitment.

this definition allows a provider's next larger resource shape but rejects shared cpu, interruptible capacity,
self-managed vms or kubernetes nodes, static cross-cloud credentials, and an http-service contract added only to
fit the platform.

## aws ecs fargate

fargate requires at least 2 gib of memory with one vcpu, so every replacement is memory-overprovisioned. the
[fargate pricing and supported-size table](https://aws.amazon.com/fargate/pricing/) documents this constraint,
per-second billing, included 20-gb ephemeral storage, and compute savings plan eligibility.

the current official
[us west 2 fargate price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/us-west-2/index.json)
contains these hourly rates:

| architecture | vcpu-hour | gib-hour |
| --- | ---: | ---: |
| x86 | $0.04048 | $0.004445 |
| arm | $0.03238 | $0.00356 |

five x86 tasks therefore cost:

`5 × 730 × ($0.04048 + 2 × $0.004445) = $180.2005`

five arm tasks cost:

`5 × 730 × ($0.03238 + 2 × $0.00356) = $144.175`

each task needs outbound ipv4 connectivity for the stack's current external redis, database, blockchain, and
third-party api endpoints. assigning one public address to each task adds
`5 × 730 × $0.005 = $18.25`; the rate is in the
[amazon vpc pricing table](https://aws.amazon.com/vpc/pricing/). a nat gateway would cost more at this scale.

aws kms supports `ECC_SECG_P256K1`, performs asymmetric operations inside its fips 140-3 level-three hsms, and
charges $1 per key-month. the three signers therefore add $3. see the
[aws kms key specification](https://docs.aws.amazon.com/kms/latest/developerguide/symm-asymm-choose-key-spec.html),
[key-store security model](https://docs.aws.amazon.com/kms/latest/developerguide/key-store-overview.html), and
[kms pricing](https://aws.amazon.com/kms/pricing/). signing operations remain $0.15 per 10,000, the same rate as
the current gcp hsm operations.

the nine static secrets fit standard systems manager secure-string parameters. standard parameters and
standard-throughput api interactions have no additional parameter-store charge; kms calls at task startup are
negligible at this scale. see the
[systems manager pricing table](https://aws.amazon.com/systems-manager/pricing/) and
[secure-string documentation](https://docs.aws.amazon.com/systems-manager/latest/userguide/what-is-a-parameter.html).
using secrets manager instead for its rotation workflow would add $3.60 per month.

the fixed non-compute subtotal is consequently:

`$18.25 public ipv4 + $3.00 kms keys = $21.25`

the on-demand totals are `$180.2005 + $21.25 = $201.4505` for x86 and
`$144.175 + $21.25 = $165.425` for arm.

### aws commitments

the rates below come from the official
[2026-07-27 us west 2 compute savings plan price list](https://pricing.us-east-1.amazonaws.com/savingsPlan/v1.0/aws/AWSComputeSavingsPlan/20260727214449/us-west-2/index.json).
aws documents how to discover current regional savings-plan files through the
[bulk price-list api](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/using-the-aws-price-list-bulk-api-fetching-price-list-files-manually.html).

| architecture and purchase | vcpu-hour | gib-hour | five-task compute |
| --- | ---: | ---: | ---: |
| x86, one-year all upfront | $0.0295504 | $0.00324485 | $131.546365 |
| x86, three-year no upfront | $0.022264 | $0.00244475 | $99.110275 |
| x86, three-year all upfront | $0.0194304 | $0.0021336 | $86.49624 |
| arm, one-year all upfront | $0.0238 | $0.00261 | $105.923 |
| arm, three-year no upfront | $0.01749 | $0.00192 | $77.8545 |
| arm, three-year all upfront | $0.01587 | $0.00174 | $70.6275 |

the answer table adds the unchanged $21.25 ipv4 and key subtotal to each compute figure. an all-upfront total is
an effective monthly cost; the compute portion is paid at purchase rather than monthly. savings plans are
non-cancellable financial commitments, and the committed hourly amount is charged even if the workers stop.

ecs services maintain desired count and replace stopped tasks. a desired count of one preserves the current
single-worker capacity and managed regional rescheduling but does not provide simultaneous multi-zone execution
for that worker. two tasks per service are required for active-active multi-zone coverage, just as any active-active
design would double the current worker capacity. see the
[ecs service behavior](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html) and
[availability-zone rebalancing](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-rebalancing.html).

the official pulumi aws provider covers
[`aws.ecs.Service`](https://www.pulumi.com/registry/packages/aws/api-docs/ecs/service/),
[`aws.ecs.TaskDefinition`](https://www.pulumi.com/registry/packages/aws/api-docs/ecs/taskdefinition/),
[`aws.kms.Key`](https://www.pulumi.com/registry/packages/aws/api-docs/kms/key/),
[`aws.ssm.Parameter`](https://www.pulumi.com/registry/packages/aws/api-docs/ssm/parameter/), iam, logging, and the
savings-plan purchase. this is first-class pulumi coverage for the complete replacement.

## azure

azure container apps is the strongest azure service-model match. it supports ingress-disabled background
containers, minimum replicas, managed identity, revisions, secret references, zone-redundant environments, and the
first-class pulumi
[`azure-native.app.ContainerApp`](https://www.pulumi.com/registry/packages/azure-native/api-docs/app/containerapp/)
resource.

the consumption profile pairs one vcpu with 2 gib. the official
[west us 2 retail-price response](https://prices.azure.com/api/retail/prices?%24filter=serviceName%20eq%20%27Azure%20Container%20Apps%27%20and%20armRegionName%20eq%20%27westus2%27)
prices active cpu at $0.000034 per second and memory at $0.000004 per gib-second. after the monthly grants, five
continuously active replicas cost $544.32. three premium hsm-protected advanced keys add $15, producing
**$559.32 per month**, which is **$401.00 more, or 253.3% above gcp**.

the theoretical idle total is $170.52 including the keys. it applies only while every replica uses at most 0.01
cpu cores and receives at most 1,000 bytes per second. continuously polling and processing queue workers cannot be
budgeted at that floor. the thresholds and grants are documented in the
[container apps billing model](https://learn.microsoft.com/en-us/azure/container-apps/billing).

ordinary azure container instances can reproduce one vcpu and 512 mib for about $155.95 of compute, or $170.95
after the three hsm keys. it lacks the application desired-count controller and managed rolling revision behavior
of cloud run or ecs. its stronger ngroup controller remains preview, so it is not a same-service replacement.

## digitalocean

digitalocean app platform has an exact dedicated 1-vcpu/512-mib worker size at $29 per month, making five workers
**$145 per month**. it supports non-routable background workers and has an official pulumi
[`digitalocean.App`](https://www.pulumi.com/registry/packages/digitalocean/api-docs/app/) resource. see the
[worker documentation](https://docs.digitalocean.com/products/app-platform/how-to/manage-workers/) and
[current plan table](https://docs.digitalocean.com/products/app-platform/details/pricing/).

the raw price is not a complete equivalent:

- app platform documents high availability only for apps with two or more containers, which raises five dedicated
  two-replica workers to $290;
- it does not expose per-container workload identity comparable to gcp service accounts or aws task roles;
- it has no native managed hsm-backed secp256k1 signing service;
- its secrets are encrypted static environment values rather than a separately permissioned secret service.

using aws kms across clouds would produce a superficially attractive `$145 + $3 = $148` total, a $10.32 or 6.5%
saving. it would introduce cross-cloud signing latency and static or externally brokered aws credentials inside
app platform, so it fails the current workload-identity and least-privilege boundary. adding digitalocean's
documented two-container ha raises that hybrid to $293, or 85.1% above the current gcp total. see the
[app platform limits](https://docs.digitalocean.com/products/app-platform/details/limits/).

the $5 shared-cpu plan would be dramatically cheaper, but it has noisy-neighbor capacity, cannot manually scale,
and is not highly available. it is a right-sizing experiment rather than equivalent service.

## recommendation

if every billing commitment must be represented in pulumi, aws fargate is the best non-gcp candidate:

- choose x86 plus a three-year all-upfront compute savings plan for a strict **31.9%** maximum saving without an
  architecture change;
- evaluate a multi-architecture image separately; arm increases the maximum saving to **42.0%**;
- do not migrate for price alone if a gcp commitment may be purchased outside pulumi, because the current worker
  pools remain cheaper at **$86.63 per month** on their three-year rate;
- treat digitalocean and azure container instances as lower-service experiments, not like-for-like replacements.

before any commitment, measure actual worker cpu, queue latency, restart frequency, outbound transfer, log volume,
and monthly signing calls. the commitment covers only fargate compute; ipv4, kms, logs, and data remain variable.
