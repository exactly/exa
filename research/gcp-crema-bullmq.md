# gcp crema with bullmq

<!-- cspell:ignore cloudscheduler deques hlen llen parametermanager rediss vcpu workerpools zcard -->

## answer

crema can scale the five existing worker pools from zero without replacing bullmq, but stock crema is safe here only with a continuously polling crema controller and more than one redis trigger per queue.

the practical first version is:

- keep the current five worker pools and their separate runtime accounts;
- set every worker pool to zero initially;
- run one private crema controller with a ten-second polling interval;
- configure `wait`, `active`, `delayed`, and `prioritized` redis triggers for every bullmq queue;
- cap every pool at one instance initially;
- use a conservative scale-down stabilization window, such as fifteen minutes.

this removes the fixed cost of the worker pools, but not all continuously running compute: the published crema deployment is itself one continuously running cloud run service. one crema controller can manage every pool, although that centralizes powerful control-plane permissions.

the scheduler-driven, scale-to-zero crema mode is not a safe first production configuration for these financial workers. it has a one-minute polling floor, its stabilization history is process memory, and stock redis triggers do not atomically measure all bullmq states.

## how it works

crema is a cloud run service containing keda metric readers and a scaler. on every poll it:

1. reads redis;
2. calculates an instance count;
3. patches `scaling.manualInstanceCount` on each worker pool through the cloud run admin api.

google lists the keda redis scaler as verified for crema. the preferred image is currently `us-central1-docker.pkg.dev/cloud-run-oss-images/crema-v1/autoscaler:1.2`, which uses keda 2.20. images published before 29 april 2026 have a known connection leak. [crema readme](https://github.com/GoogleCloudPlatform/cloud-run-external-metrics-autoscaling/blob/2418f8217ff346566163f05a8e1595efabd72b2a/README.md#compatibility)

with `pollingInterval: 10`, crema polls inside its process. google's published deployment keeps one crema instance running with cpu available. if `pollingInterval` is omitted, crema only checks metrics when its private http endpoint receives a `POST`. [crema configuration](https://github.com/GoogleCloudPlatform/cloud-run-external-metrics-autoscaling/blob/2418f8217ff346566163f05a8e1595efabd72b2a/metric-provider/api/README.md#invocation), [polling implementation](https://github.com/GoogleCloudPlatform/cloud-run-external-metrics-autoscaling/blob/2418f8217ff346566163f05a8e1595efabd72b2a/metric-provider/server/server.go#L113-L141)

## bullmq keys that must be watched

bullmq 5.71.1 uses these default keys:

| state | redis key | redis type | needed |
| --- | --- | --- | --- |
| waiting work | `bull:<queue>:wait` | list | wakes a pool for normal jobs |
| running work | `bull:<queue>:active` | list | prevents shutdown during a job |
| retry backoff | `bull:<queue>:delayed` | sorted set | keeps a worker available to promote the retry |
| priority work | `bull:<queue>:prioritized` | sorted set | prevents priority jobs from being stranded |

the exact names come from bullmq's queue-key source, and its getters use `LLEN` for `wait` and `active` and `ZCARD` for `delayed` and `prioritized`. [bullmq queue keys](https://github.com/taskforcesh/bullmq/blob/60f645a472102336a6294e66f2b0a801a5a5207d/src/classes/queue-keys.ts), [bullmq getters](https://github.com/taskforcesh/bullmq/blob/60f645a472102336a6294e66f2b0a801a5a5207d/src/classes/queue-getters.ts#L20-L41)

keda 2.20's redis scaler accepts lists, sorted sets, sets, and hashes, despite its `redis lists` name. it chooses `LLEN`, `ZCARD`, `SCARD`, or `HLEN` from the runtime key type. [keda redis scaler source](https://github.com/kedacore/keda/blob/5322ecb9c19fb37e59344afbb388471d40efc0d8/pkg/scalers/redis_scaler.go#L90-L107)

watching only `wait` is unsafe. bullmq atomically moves a claimed job from `wait` to `active`; the waiting count then becomes zero while the job is still executing. [bullmq move-to-active script](https://github.com/taskforcesh/bullmq/blob/60f645a472102336a6294e66f2b0a801a5a5207d/src/commands/moveToActive-11.lua#L70-L89)

watching only `wait` and `active` is also incomplete. this repository gives every job ten attempts with exponential backoff from one second. failed jobs therefore enter the `delayed` sorted set. a bullmq worker promotes due delayed jobs while fetching its next job; with no worker and no delayed trigger, a retry can remain stranded until unrelated work wakes the pool. [queue configuration](../server/workers/queue.ts), [bullmq delayed promotion](https://github.com/taskforcesh/bullmq/blob/60f645a472102336a6294e66f2b0a801a5a5207d/src/commands/includes/promoteDelayedJobs.lua)

the tradeoff is that a delayed trigger counts every delayed job, not only one whose timestamp is due. the pool consequently remains running throughout a retry backoff. the current maximum single backoff is about 512 seconds, so this is bounded for the existing configuration.

the repository does not currently create priority jobs, but adding the `prioritized` trigger avoids a future trap at negligible complexity.

## configuration shape

each queue needs four redis triggers. the following is the shape for `allow`; the other queues change only the target and queue name:

```yaml
apiVersion: crema/v1
kind: CremaConfig
metadata:
  name: workers
spec:
  pollingInterval: 10
  triggerAuthentications:
    - metadata:
        name: redis
      spec:
        gcpSecretManager:
          secrets:
            - parameter: address
              id: sandbox-redis-address
              version: latest
            - parameter: password
              id: sandbox-redis-password
              version: latest
            - parameter: username
              id: sandbox-redis-username
              version: latest
  scaledObjects:
    - spec:
        scaleTargetRef:
          name: projects/exa/locations/us-west1/workerpools/sandbox-allow
        minReplicaCount: 0
        maxReplicaCount: 1
        advanced:
          horizontalPodAutoscalerConfig:
            behavior:
              scaleDown:
                stabilizationWindowSeconds: 900
        triggers:
          - type: redis
            name: wait
            metadata:
              enableTLS: "true"
              listLength: "1"
              listName: bull:allow:wait
            authenticationRef:
              name: redis
          - type: redis
            name: active
            metadata:
              enableTLS: "true"
              listLength: "1"
              listName: bull:allow:active
            authenticationRef:
              name: redis
          - type: redis
            name: delayed
            metadata:
              enableTLS: "true"
              listLength: "1"
              listName: bull:allow:delayed
            authenticationRef:
              name: redis
          - type: redis
            name: prioritized
            metadata:
              enableTLS: "true"
              listLength: "1"
              listName: bull:allow:prioritized
            authenticationRef:
              name: redis
```

keda expects `address` as `host:port`, with username and password supplied separately. the repository's single `redis-url` secret is therefore not directly reusable when it contains a `rediss://user:password@host:port` url. infra should add separate crema-only redis connection secrets or change the secret contract for all consumers. [keda redis configuration](https://keda.sh/docs/2.20/scalers/redis-lists/)

the four trigger reads are concurrent, not one atomic bullmq count. a transition can theoretically be sampled as zero in both `wait` and `active`. the stabilization window is required to cover that race and transient metric failures. crema keeps its recommendation history in in-memory deques, so a controller restart can extend or otherwise change the scale-down timing. [crema state collection](https://github.com/GoogleCloudPlatform/cloud-run-external-metrics-autoscaling/blob/2418f8217ff346566163f05a8e1595efabd72b2a/metric-provider/internal/scaling/state_provider.go#L54-L105), [crema stabilization state](https://github.com/GoogleCloudPlatform/cloud-run-external-metrics-autoscaling/blob/2418f8217ff346566163f05a8e1595efabd72b2a/scaler/src/main/java/com/google/cloud/run/crema/ScalingStabilizer.java#L83-L92)

cloud run gives a worker pool only ten seconds between `SIGTERM` and `SIGKILL`. the repository already catches `SIGTERM` and closes bullmq gracefully, but a long active job cannot necessarily finish in ten seconds. preventing an incorrect scale-down matters more than graceful shutdown here. [cloud run container contract](https://docs.cloud.google.com/run/docs/container-contract#shutdown)

## pulumi resources

this belongs in `infra/index.ts`. pulumi can provision every required resource:

- `gcp.parametermanager.Parameter` and `ParameterVersion` for the crema yaml;
- `gcp.cloudrunv2.Service` for the private crema controller;
- `gcp.cloudrunv2.WorkerPoolIamMember` for target-level `roles/run.developer`;
- secret access for only the redis connection fields;
- worker pools with `manualInstanceCount: 0`;
- optionally `gcp.cloudscheduler.Job` and a private service invoker account for request mode.

the repository's `@pulumi/gcp` 9.31 line contains these resources. [parameter version](https://www.pulumi.com/registry/packages/gcp/api-docs/parametermanager/parameterversion/), [worker-pool iam](https://www.pulumi.com/registry/packages/gcp/api-docs/cloudrunv2/workerpooliammember/), [scheduler job](https://www.pulumi.com/registry/packages/gcp/api-docs/cloudscheduler/job/)

the repeated setup should be generated from the existing worker definitions rather than maintaining handwritten yaml.

## privilege impact

worker runtime segmentation remains: `allow`, `poke`, and `refund` still run under different accounts with different hsm keys, and the other workers retain their current secret grants.

the crema account is a new privileged control-plane identity. google instructs operators to grant it `roles/run.developer` on each target worker pool and `roles/iam.serviceAccountUser` on the worker identity. `run.developer` contains `run.workerpools.update`, not a field-restricted `set instance count` permission. a compromised shared crema controller can therefore attempt broader worker-pool updates, not merely change the number zero to one. [google crema iam setup](https://docs.cloud.google.com/run/docs/configuring/workerpools/crema-autoscaling#grant_additional_permissions_to_your_service_account), [cloud run permissions](https://docs.cloud.google.com/iam/docs/roles-permissions/run)

the choices are:

- one crema for every stack and worker: preserves the current control-plane segmentation but creates twenty crema services;
- one crema per stack: a compromise crosses the five privileges in that stack;
- one crema for everything: lowest cost and resource count, but one controller can modify all twenty pools.

all grants should be resource-scoped. never grant `run.developer` or service-account user at project level.

## request-only crema

omitting `pollingInterval` lets the crema service scale to zero. cloud scheduler can send the required authenticated `POST`, but its cron format has one-minute resolution. detection latency is then up to roughly one minute plus crema startup, the worker-pool update, and worker startup. [crema scheduler example](https://github.com/GoogleCloudPlatform/cloud-run-external-metrics-autoscaling/blob/2418f8217ff346566163f05a8e1595efabd72b2a/metric-provider/api/README.md#appendix-setting-up-cloud-scheduler-to-invoke-crema), [cloud scheduler cron format](https://docs.cloud.google.com/scheduler/docs/configuring/cron-job-schedules#cron_job_format)

request mode is inexpensive, but is not recommended for the first rollout:

- separate state reads can briefly report zero during `wait` to `active`;
- the safety window is process memory and can reset between requests;
- delayed retries require the delayed trigger, which wakes or keeps the pool running for the whole backoff;
- scale-down timing becomes dependent on whether cloud run reused the same crema instance.

an on-demand design would become robust with one atomic metric equal to `wait + active + delayed + prioritized`. stock crema's redis scaler does not provide that aggregation. achieving it requires a small upstream change or fork, or a custom metrics reader that runs bullmq's atomic multi-state count.

## cost

the continuous design replaces twenty running workers with one running crema controller plus workers that run only during bursts and the stabilization tail.

at the published default of one vcpu and 512 mib, one continuous crema service in `us-west1` is roughly $50 per month gross before the cloud run service free tier or discounts. each worker burst also pays for startup, processing, retry waits, shutdown, and the configured fifteen-minute scale-down tail. cloud run bills running worker-pool instances even while idle. [cloud run pricing](https://cloud.google.com/run/pricing), [worker-pool manual scaling](https://docs.cloud.google.com/run/docs/configuring/workerpools/manual-scaling#billing_considerations_when_using_manual_scaling)

request-only crema has no idle compute bill. one scheduler job is free while the billing account remains within its three-job free tier, then costs $0.10 per month. [cloud scheduler pricing](https://cloud.google.com/scheduler/pricing)

## tests

the existing unit and e2e tests remain valid because application code, bullmq, redis, retry behavior, and the worker entrypoints do not change. the current e2e test starts the same five workers in-process against `redis-memory-server`.

those tests cannot verify crema or cloud run scaling. add:

- a deterministic test for the generated crema configuration, including all four keys per queue;
- a pulumi preview/type check through the existing nx targets;
- one deployed-stack smoke test that starts at zero, enqueues a job, observes the pool reach one, observes the bullmq job complete, and observes the pool return to zero;
- a retry smoke test proving a delayed job is eventually promoted and processed.

## recommendation

go for a limited production experiment with one continuously polling crema controller, `maxReplicaCount: 1`, all four bullmq state triggers, and a long scale-down window. measure wake latency, job duration, retry frequency, and controller cost before expanding it across four stacks.

do not ship scheduler-driven scale-to-zero crema with stock redis triggers for these signing and payment workers. first add an atomic outstanding-job metric if removing the final continuously running controller is a hard requirement.
