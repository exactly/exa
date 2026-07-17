# cloud run worker cold start

<!-- cspell:ignore workerpool workerpools vcpu -->

## answer

the realistic way to get the account-deployment path under five seconds is to stop cold-starting `poke`. keep one `poke` worker-pool instance running and leave every other worker at zero unless it has the same latency requirement.

trying to tune the current scale-from-zero path below five seconds is not a credible target. a worker pool has no native demand autoscaling: an external controller must first notice work and patch `scaling.manualInstanceCount`, after which cloud run asynchronously reconciles capacity. changing the instance count avoids a new revision, but google publishes no completion-time objective for that reconciliation. worker pools also run only in the second-generation execution environment, which google says can have longer cold starts than first generation. [worker-pool scaling](https://docs.cloud.google.com/run/docs/configuring/workerpools/manual-scaling), [worker-pool api](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.workerPools), [execution environments](https://docs.cloud.google.com/run/docs/configuring/execution-environments)

the measured test makes that boundary concrete:

- crema noticed the queued work about 4.5 seconds after the funding transaction;
- cloud run took about another 18.2 seconds to report the worker started;
- deployment landed about 36 seconds after funding.

even eliminating crema's entire detection interval would therefore leave the cloud run startup alone well above the budget. the five-second design must remove both crema polling and worker provisioning from the request path.

## recommended configuration

set this in each stack where account deployment needs low latency:

```yaml
exa:pokeMinimum: 1
```

the existing infrastructure feeds that value into crema's `minReplicaCount` for `poke`, while retaining `maxReplicaCount: 1`. once reconciled, the bullmq worker remains subscribed to redis and receives a new job directly instead of waiting for crema's two-second polling loop and a cloud run admin-api scale operation. the underlying worker pool is manually scaled; google documents that a count of one starts and keeps one worker active, while zero disables it. [local infrastructure](../infra/index.ts), [worker-pool overview](https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run), [manual scaling](https://docs.cloud.google.com/run/docs/configuring/workerpools/manual-scaling)

at the current default of one vcpu and 512 mib in `us-west1`, one continuously running worker costs about $31.17 per 730-hour month before free tier or commitments. the complete calculation already lives in the [worker cost estimate](./gcp-worker-costs.md). google bills every manually requested worker-pool instance as active even while idle. [cloud run pricing](https://cloud.google.com/run/pricing), [manual-scaling billing](https://docs.cloud.google.com/run/docs/configuring/workerpools/manual-scaling#billing_considerations_when_using_manual_scaling)

this is a per-stack cost. keeping only `poke` warm preserves scale-to-zero savings for `allow`, `credit`, `refund`, and `subscribe`.

## what five seconds can mean

with a warm worker, less than five seconds is plausible as a performance target from webhook receipt to transaction broadcast on a fast l2. it is not a reliable cross-chain target from the source transfer's inclusion to the deployment transaction's inclusion.

alchemy says address-activity events are streamed as blocks confirm, but it gives no numeric webhook-delivery objective. [alchemy webhooks](https://www.alchemy.com/docs/docs/reference/notify-api-quickstart)

after delivery, the target transaction still waits for the target chain. optimism documents a two-second l2 block time, already consuming much of a five-second budget. ethereum uses twelve-second slots, so a confirmed deployment on ethereum cannot generally satisfy a five-second target regardless of cloud run performance. [op stack block time](https://docs.optimism.io/op-stack/reference/glossary#block-time), [ethereum block time](https://ethereum.org/developers/docs/blocks/#block-time)

the service-level objective should therefore be split into:

- source block to webhook receipt;
- webhook receipt to job activation;
- job activation to transaction broadcast;
- broadcast to target-chain inclusion.

for fast l2s, target less than five seconds at p95 from webhook receipt to broadcast, then report chain inclusion separately. for every production chain, the only portable sub-five-second milestone is broadcast or provider acceptance, not mined account code.

## cloud run tuning that is worth testing

these are secondary measurements, not substitutes for a warm worker:

1. profile process start, redis readiness, kms account construction, job activation, signing, broadcast, and inclusion as separate timestamps. with `poke` warm, only the last four remain on the event path.
2. keep the image repository and worker pool in the same region. cross-region product placement can add latency and transfer cost; the current server image and worker pool are already both in `us-west1`. [cloud run locations](https://docs.cloud.google.com/run/docs/deploying#cloud-run-locations)
3. reduce synchronous node module loading and start the process with `node` rather than through a package-manager wrapper. google explicitly identifies dynamic dependency imports as node startup cost. this helps restarts and deployments, but does not improve a normally warm event path. [node startup guidance](https://docs.cloud.google.com/run/docs/tips/nodejs), [general startup guidance](https://docs.cloud.google.com/run/docs/tips/general#start_containers_quickly)
4. test more cpu only after profiling proves startup or job execution is cpu-bound. google warns that a single-threaded application might not use more than one vcpu; increasing cpu otherwise only raises the continuously warm cost. [worker-pool cpu limits](https://docs.cloud.google.com/run/docs/configuring/workerpools/cpu)
5. use the startup probe to report genuine redis, kms, and bullmq readiness. shortening its period can improve health detection after a failed attempt, but probes do not provision capacity or make initialization faster. worker-pool probe periods can be as low as one second. [worker-pool health checks](https://docs.cloud.google.com/run/docs/configuring/workerpools/healthchecks)

shrinking the container image is not a cloud run startup optimization by itself. google says image streaming makes image size irrelevant to container startup time, although a minimal image still improves security and build/deployment handling. application dependency loading remains relevant. [container image guidance](https://docs.cloud.google.com/run/docs/tips/general#build-minimal-container-images)

startup cpu boost is not currently an actionable worker-pool control. google documents and exposes `--cpu-boost` for cloud run services, but the current worker-pool cli and pulumi `WorkerPool` resource do not expose an equivalent setting. [service deploy flags](https://docs.cloud.google.com/sdk/gcloud/reference/run/deploy), [worker-pool deploy flags](https://docs.cloud.google.com/sdk/gcloud/reference/run/worker-pools/deploy), [pulumi worker pool](https://www.pulumi.com/registry/packages/gcp/api-docs/cloudrunv2/workerpool/)

## zero-idle-cost alternative

if keeping one worker warm is unacceptable, the serious alternative is an architectural change: make `poke` request-driven and invoke a cloud run service directly from a durable push queue. that removes crema's polling and control-plane patch from activation, and a service can use the faster first-generation environment. it requires replacing the current bullmq pull-consumer boundary for this worker and preserving retries, authentication, idempotency, and kms permissions in the new request path. it can improve scale-from-zero latency, but cloud run still gives no sub-five-second cold-start guarantee. [execution environments](https://docs.cloud.google.com/run/docs/configuring/execution-environments), [cloud run resource model](https://docs.cloud.google.com/run/docs/resource-model)

do not replace the worker pool merely to avoid roughly $31 per stack without first measuring the warm path. the smallest, lowest-risk experiment is one warm `poke` instance on `base-sepolia`, repeat the same funding test several times after it is ready, and use the four latency segments above to decide whether any remaining work belongs in webhook delivery, kms/rpc execution, or chain inclusion.
