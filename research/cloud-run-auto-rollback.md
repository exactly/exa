# cloud run deployment rejection and rollback

<!-- cspell:ignore autorun clouddeploy healthz rollouts skaffold -->

## answer

for these five worker pools, use a **pulumi cloud run job preflight barrier**. it is smaller and safer than updating
the pools first and trying to roll them back:

1. add a `--check` mode to each existing worker entrypoint. it must execute the real boot path, await
   `queue.waitUntilReady()`, close cleanly, and exit without consuming production jobs;
2. create one `cloudrunv2.Job` per worker with the same candidate image, command and arguments, environment, service
   account, and resources as its pool. add `--check`, set `maxRetries` to `0`, use one task and a short timeout, and
   change `runExecutionToken` for every deployment attempt;
3. make **every** `cloudrunv2.WorkerPool` depend on **all five** preflight jobs. pulumi can run the five checks in
   parallel, but it cannot start any pool update until every check has completed successfully.

cloud run defines a job with `runExecutionToken` as ready only after its execution successfully completes. the
provider used here waits for that cloud run operation and returns its embedded error. pulumi then fails the update and
does not run dependent pool operations. the stable worker-pool revisions are untouched. this gives the useful
digitalocean property—reject an image that cannot boot before replacing the working image—without a rollback state
machine. [pulumi job api](https://www.pulumi.com/registry/packages/gcp/api-docs/cloudrunv2/job/),
[cloud run job api](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs),
[pulumi `dependsOn`](https://www.pulumi.com/docs/iac/concepts/resources/options/dependson/)

cloud run already provides the equivalent boot-failure rejection for **services**, but not for **worker pools**.

- for a cloud run service, the default deployment health check starts an instance and waits for its startup probe. if
  the probe does not pass, cloud run marks the revision unhealthy and does not route traffic to it. the previous
  serving revision remains in place. no rollback controller or explicit blue-green traffic split is needed for this
  class of failure. [cloud run service deployment health check](https://docs.cloud.google.com/run/docs/deploying#disabling_the_deployment_health_check),
  [cloud run service reconciliation](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services)
- for a cloud run worker pool, google explicitly says that a successful deployment does not mean a deployment health
  check ran or that the runtime container was validated. worker pools have no default startup probe. configured
  startup and liveness probes shut down or restart bad containers, but the documentation does not promise that they
  reject the revision or restore the old instance split. [worker pool deployment limitation](https://docs.cloud.google.com/run/docs/deploy-worker-pools),
  [worker pool probes](https://docs.cloud.google.com/run/docs/configuring/workerpools/healthchecks),
  [worker pool container defaults](https://docs.cloud.google.com/run/docs/configuring/workerpools/containers)

this distinction matters here. the shared server image is deployed to five `cloudrunv2.WorkerPool` resources, while
only crema is a `cloudrunv2.Service`. the workers have no probes or listening health endpoint, crema may scale them to
zero, and its configured maximum is one instance. see the [current worker pools and crema configuration](../infra/index.ts),
the [worker readiness promise](../server/workers/worker.ts), and the [supervisor](../server/supervise.ts).

the preflight barrier prevents boot failures. it is not post-deployment health monitoring, a functional canary, or an
automatic rollback for later regressions. cloud deploy can add those properties in a second phase, but it is a new
deployment plane rather than a minimal addition to `infra/index.ts`.

## services already have the boot gate

cloud run service deployments are reconciled before becoming serving state. if reconciliation fails, the service api
keeps `trafficStatuses`, `observedGeneration`, and `latestReadyRevision` on the last serving revision. a traffic target
of type `TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST` points to the latest **ready** revision, not merely the last revision
created. [service api reconciliation and traffic target semantics](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services)

the default service startup probe is tcp and can take up to 240 seconds. tcp proves only that the container opened its
port. an explicit http startup probe is stronger when its endpoint returns success only after required initialization
has completed. cloud run treats the container as immediately ready for traffic once startup passes, so the startup
endpoint must include the real readiness invariant. [service startup probe behavior](https://docs.cloud.google.com/run/docs/configuring/healthchecks#the_default_tcp_startup_probe)

readiness and liveness probes do not add revision rollback. a failed readiness probe temporarily removes one service
instance from new traffic and adds it back after recovery; a failed liveness probe restarts the instance. neither
changes revision traffic allocation. [service readiness and liveness behavior](https://docs.cloud.google.com/run/docs/configuring/healthchecks)

for the crema service, the minimal position is consequently:

- leave `template.healthCheckDisabled` unset or `false`;
- retain the default probe if an open port is enough to define successful startup;
- otherwise add one explicit http startup probe against a health endpoint already owned by the crema image;
- do not add explicit `traffics` or a rollback resource merely to protect against a revision that cannot boot.

manual traffic migration remains useful for functional canaries, but it is not needed for boot rejection. traffic
changes are not instantaneous and in-flight requests can reach either revision during migration.
[cloud run rollouts and rollbacks](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration)

## worker pools stop and restart instead of rolling back

worker pools also create immutable revisions and expose `latestCreatedRevision`, `latestReadyRevision`, and
`instanceSplits`. an omitted instance split assigns 100% of instances to the latest ready revision, and a previous
revision can be restored by assigning it 100%. [worker pool api](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.workerPools),
[worker pool instance splits and rollback](https://docs.cloud.google.com/run/docs/managing/workerpool-instance-splits-rollbacks)

those control-plane fields should not be mistaken for a runtime deployment gate. the worker deployment guide says
runtime health is not validated by a successful deployment. the probe guide specifies only per-container behavior:
a startup failure shuts the container down; a liveness failure kills and restarts it; repeated failures are restart
limited to avoid an uncontrolled crash loop. it does not say that cloud run moves the instance split back to the old
revision. [worker pool deployment limitation](https://docs.cloud.google.com/run/docs/deploy-worker-pools),
[worker pool health checks](https://docs.cloud.google.com/run/docs/configuring/workerpools/healthchecks)

the current workers make this gap sharper:

- each process waits for `queue.waitUntilReady()`, which is a good semantic boundary for successful boot, but it does
  not open an http or tcp health port;
- crema is allowed to keep every pool at zero and caps it at one instance;
- pulumi ignores live `scaling.manualInstanceCount` changes because crema owns that field;
- a revision deployed while its pool is at zero has no candidate instance whose startup can be observed;
- with only one live instance, an old and new revision cannot run as a meaningful simultaneous canary. google's own
  worker-pool example uses four instances so 25% maps to one canary and 75% to three stable instances.
  [cloud run worker pool instance-split example](https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run)

adding a tiny health listener that opens only after `handle.ready`, plus a pulumi `startupProbe`, would still be a
useful hardening step. it would detect missing secrets, redis connection failure, a broken entrypoint, and similar
startup faults. a liveness probe could catch a later deadlock. this should be described as instance recovery and a
health signal, not as automatic rollback.

## preflight jobs are the minimal deployment gate

the job design must preserve each worker's real boot boundary instead of introducing a synthetic image check:

- add `--check` to the existing entrypoint and reuse the same secret loading, client construction, and worker
  construction as production;
- prevent the check worker from consuming a production queue item, for example by constructing it with
  `autorun: false`, then await the existing readiness promise, close it, and exit;
- create five jobs—allow, credit, poke, refund, and subscribe—rather than one privileged union job. each job should
  copy its corresponding pool's candidate image, command and arguments, environment, service account, and resource
  limits;
- set one task, `maxRetries: 0`, and a short bounded task timeout. retrying a deterministic boot failure only delays
  feedback, and the task timeout must remain below the provider operation timeout;
- set `runExecutionToken` to a short digest of the candidate image tag and deployment-attempt token. the job name plus
  token must remain below 63 characters;
- put all five jobs in the `dependsOn` list of all five pools. depending only on the matching job is weaker: a passing
  pool could update while another job fails.

the existing workflow performs one `pulumi up`, so this creates one barrier:

```text
five preflight jobs in parallel -> all succeed -> five worker pools may update
                                -> any fails   -> no worker pool updates
```

`runExecutionToken` is materially different from `startExecutionToken`: the former keeps the job unready until the
execution **successfully completes**, while the latter returns after it merely starts. only `runExecutionToken` is a
gate. the cloud run api also reports failed reconciliation separately from the last succeeded execution.
[cloud run job execution token and reconciliation](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs)

the checked-in lockfile resolves `@pulumi/gcp` `9.32.1`. that release bridges the google beta provider at upstream
commit `574b56a`, whose generated job resource sends `runExecutionToken` on create and update and then waits for the
cloud run long-running operation. its common waiter returns an embedded operation error instead of treating a failed
execution as readiness. this is enough for a failed execution to fail the job resource operation and therefore the
same `pulumi up`. [pulumi gcp `9.32.1` upstream pin](https://github.com/pulumi/pulumi-gcp/tree/v9.32.1/upstream),
[pinned job create and update waiter](https://github.com/hashicorp/terraform-provider-google-beta/blob/574b56a91815ac2203b9d4ac7cf2a6cc5c816611/google-beta/services/cloudrunv2/resource_cloud_run_v2_job.go),
[pinned cloud run operation waiter](https://github.com/hashicorp/terraform-provider-google-beta/blob/574b56a91815ac2203b9d4ac7cf2a6cc5c816611/google-beta/services/cloudrunv2/cloud_run_v2_operation.go),
[pinned common error propagation](https://github.com/hashicorp/terraform-provider-google-beta/blob/574b56a91815ac2203b9d4ac7cf2a6cc5c816611/google-beta/tpgresource/common_operation.go)

the provider contract is clear, but this research did not execute a deliberately failing job in a live project.

### beta and retry caveats

the pulumi registry still labels `runExecutionToken` as beta. `launchStage` is a separate cloud run field: its docs say
preview features can opt into a preview stage, but the upstream beta-provider acceptance sample uses an execution
token without setting `launchStage`. `@pulumi/gcp` already bridges that beta provider. do not claim that
`launchStage: "BETA"` makes this field stable, and do not adopt this design if beta fields are prohibited.
[upstream beta execution-token sample](https://github.com/GoogleCloudPlatform/magic-modules/blob/main/mmv1/templates/terraform/samples/services/cloudrunv2/cloudrunv2_job_run_job.tf.tmpl)

the token must change for every attempt that should execute a check. a short image sha is enough for each new image,
but the deployment workflow uses `--refresh`: after a failed remote mutation, rerunning the same sha can refresh the
job's failed desired state into pulumi without creating a new execution. pass a compact run-attempt suffix for manual
retries, or deliberately change a preflight token. the workflow input can be as small as
`--config "exa:rollout=$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"`. a constant token is unsafe.

keep this as a full pulumi update. a targeted update that selects worker pools without their check jobs can bypass
the barrier.

the barrier is safe only within one pulumi update graph. it does not make the subsequent five pool updates
transactional. once every job passes, the pools can update concurrently; a later cloud run control-plane failure can
still leave a mixed set of successful revisions.

## pulumi does not make the update transactional

the repository currently runs one `pulumi up` that changes the image on all five pools. the preflight dependencies
order those changes, but pulumi explicitly does not automatically roll back completed operations after a later update
error. manual rollback means restoring the old program or configuration and running another update. a failure after
the barrier can therefore still leave different pools on different successful revisions.
[current deployment workflow](../.github/workflows/server-deploy.yaml),
[pulumi automatic rollback faq](https://www.pulumi.com/docs/support/faq/infrastructure/#automatic-rollbacks)

the installed `@pulumi/gcp` provider exposes the primitives needed for orchestration:

- `cloudrunv2.Service` has `startupProbe`, `readinessProbe`, `livenessProbe`, `healthCheckDisabled`, and `traffics`;
- `cloudrunv2.WorkerPool` has `startupProbe`, `livenessProbe`, `instanceSplits`, `latestCreatedRevision`, and
  `latestReadyRevision`;
- neither resource has an automatic rollback policy.

see the [pulumi service api](https://www.pulumi.com/registry/packages/gcp/api-docs/cloudrunv2/service/) and
[pulumi worker pool api](https://www.pulumi.com/registry/packages/gcp/api-docs/cloudrunv2/workerpool/). an external
controller can update a split, but that becomes out-of-band state. pulumi warns that later updates can overwrite such
changes unless the property is ignored and live state is refreshed. [pulumi `ignoreChanges` behavior](https://www.pulumi.com/docs/iac/concepts/resources/options/ignorechanges/)

`replaceOnChanges`, `protect`, and create-before-delete do not solve this. a worker pool update creates an internal
cloud run revision while the pulumi resource identity remains the same; the needed operation is revision promotion or
instance-split rollback after observing runtime health.

## phase two: cloud deploy automatic rollback

cloud deploy is the documented google-native composition when the requirement expands from boot rejection to a real
canary and automatic rollback:

- cloud deploy can deploy cloud run services and worker pools, with one cloud run resource per target;
- a verification task runs a supplied test container after deployment, and a non-zero exit makes the rollout fail;
- an analysis job can watch google cloud observability alert policies for a fixed period, and an alert makes the
  rollout fail;
- a `repairRolloutRule` can retry and then create a new rollout of the most recent successful release.

see [cloud run targets](https://docs.cloud.google.com/deploy/docs/run-targets),
[deployment verification](https://docs.cloud.google.com/deploy/docs/verify-deployment),
[deployment analysis](https://docs.cloud.google.com/deploy/docs/analysis), and
[repair automation](https://docs.cloud.google.com/deploy/docs/automation-rules#configure_a_repairrolloutrule_automation_rule).
pulumi can provision the delivery pipeline, targets, monitoring policies, and automation, including the provider's
[`gcp.clouddeploy.Automation`](https://www.pulumi.com/registry/packages/gcp/api-docs/clouddeploy/automation/).

this is not an additive property on the existing worker resources. cloud deploy renders and applies cloud run
manifests through skaffold and creates releases and rollouts. it would need to become the owner of image revision
deployment, while pulumi continues to own durable infrastructure. letting pulumi and cloud deploy both write the
worker template or instance split would create two reconcilers for one field.

for this repository, cloud deploy means at least five cloud run targets because google permits only one service, job,
or worker pool per target. a multi-target can group five child targets and start their child rollouts in parallel, but
each pool still has its own rollout and repair outcome; this is not an atomic five-pool promotion.
[cloud run target limit](https://docs.cloud.google.com/deploy/docs/run-targets),
[parallel multi-target deployment](https://docs.cloud.google.com/deploy/docs/parallel)

it also needs an actual worker health signal. for these pools, a reliable analysis must force at least one candidate
instance to run despite crema, then observe a startup probe or execute an end-to-end queue smoke test. otherwise a
zero-instance revision can pass a quiet observation window without ever booting. cloud run requires the manual
instance count to be greater than the number of revision splits, so an old/new two-split canary needs at least three
live instances **per pool**. the current zero-or-one policy cannot do that. crema ownership and its maximum would have
to change during rollout, and candidate workers would consume real queue traffic unless the rollout also isolates the
test workload. [worker pool split constraints](https://docs.cloud.google.com/run/docs/managing/workerpool-instance-splits-rollbacks)

the comparison is consequently simple:

| property | five preflight jobs | cloud deploy for five pools |
| --- | --- | --- |
| deployment shape | five jobs and one pulumi dependency barrier | five child targets, manifests and skaffold profiles, delivery pipeline, release workflow, and automation |
| candidate runs before pool mutation | yes | no; canary deploys the actual new revisions |
| boot failure protection | blocks every pool update | failed verification can stop and repair each rollout |
| actual revision and production signal | no | yes, with verification or analysis |
| later regression rollback | no | yes, within the configured observation and repair policy |
| current zero-or-one scaling | works because jobs run independently | incompatible with a meaningful old/new canary |
| ownership | pulumi remains sole writer | cloud deploy must own worker templates and instance splits |

preflight jobs are phase one. cloud deploy canary plus verification or analysis and `repairRolloutRule` is phase two
only when post-startup or service-level objective rollback justifies the additional deployment plane.

## options

| option | bad boot rejected | later regression rollback | change | assessment |
| --- | --- | --- | --- | --- |
| service default deployment health check | yes | no | none for crema | use it |
| five preflight jobs and global dependency barrier | yes, before any pool update | no | one check mode and five job resources | primary worker design |
| worker startup and liveness probes | container is stopped or restarted | no | small app and pulumi change | do for hardening |
| bespoke ci split controller | only if it forces and watches a candidate | possible | custom state machine and pulumi ownership rules | deceptively complex |
| cloud deploy canary, verification or analysis, and repair | yes, on actual revisions | yes, during the analysis window | five targets and a new deployment plane | phase two, not minimal |
| convert pull workers to private services | yes, through the service deployment gate | no | resource migration and health listener | wrong abstraction unless reevaluated broadly |

## recommendation

keep the implementation brutally honest:

- make no rollback addition for the crema service; its default cloud run deployment health check already rejects a
  revision that cannot pass startup;
- add `--check` to the real worker boot path and make it connect, become ready, close, and exit without consuming jobs;
- create one matching preflight job per worker with `runExecutionToken`, one task, `maxRetries: 0`, and a short timeout;
- use a token that changes for every deployment attempt, including manual retries of the same image;
- make all five pools depend on all five jobs, forming one all-or-nothing preflight barrier before pool updates;
- optionally add worker startup and liveness probes afterward for runtime hardening, without calling them rollback;
- do not build an `apply` callback, dynamic pulumi resource, workflow, or function that mutates revision splits;
- adopt cloud deploy canary plus verification or analysis and `repairRolloutRule` only if rollback after successful
  startup becomes a hard requirement. make cloud deploy the sole owner of worker revisions and increase each pool to
  at least three instances during old/new canary phases.

this is preventative rejection, not rollback: if any candidate cannot boot, `pulumi up` fails before changing a pool
and the stable revisions keep running. it deliberately does not promise to detect bad queue logic, incompatible data,
delayed crashes, or business-level regressions. those require cloud deploy verification or analysis, observability,
and an actual rollback policy.
