# gcp hybrid privilege topology

<!-- cspell:ignore bullmq cloudtasks eventarc pubsub -->

## conclusion

the scalable security boundary is a cloud run service or job with its own runtime service account, not an always-on
worker pool. cloud run assigns the configured service identity to the running service revision or job, and google
recommends a user-managed account with only the permissions the workload needs. secret manager access is likewise
granted to that runtime identity. the identity that invokes the workload is separate and only needs
`roles/run.invoker` on the target. see the [cloud run service identity overview][service-identity], the
[service identity configuration][service-account], and the [secret configuration][service-secrets].

therefore, a single path-dispatching cloud run service cannot preserve per-hook runtime privilege isolation: every
route in that service executes as the same configured service identity. this is an inference from cloud run's
identity model. hooks can share one service only when they intentionally share one trust boundary, meaning the same
google cloud permissions and secrets. otherwise, keep separate services or jobs; unlike worker pools, idle services
scale to zero by default, so the resource count does not create an always-on compute bill. see the
[cloud run autoscaling documentation][autoscaling] and [request-based billing rules][run-pricing].

the strongest practical combination is:

- use cloud tasks for point-to-point command jobs such as the current bullmq hook queues;
- use pub/sub or eventarc for facts that must fan out to multiple independent hooks;
- retain at most one unprivileged pull bridge per stack only during migration or for a source that cannot push.

## topology 1: cloud tasks to private cloud run services

this is the best fit for a command where exactly one hook owns the work:

```text
producer -> hook-specific cloud tasks queue -> private hook cloud run service
                                                    |
                                                    +-> hook runtime service account
                                                    +-> hook-specific secrets and resources
```

create one queue and one private service per security boundary. configure fixed queue-level routing and an oidc
identity on the queue; cloud tasks then pushes an authenticated https request to the service. grant that invoker
identity `roles/run.invoker` only on the matching service, while the service runs as a different, minimally
privileged account. google explicitly documents cloud tasks as a secure asynchronous trigger for private cloud run
services and recommends oidc for cloud run targets. see [cloud run with cloud tasks][run-tasks],
[http-target authentication][task-auth], and [queue routing][task-routing].

grant each producer `roles/cloudtasks.enqueuer` on only the queues it may address. cloud tasks supports queue-level
iam, including limiting an enqueuer to one queue. fixed queue-level routing overrides task-level routing, preventing
a producer from selecting another hook endpoint through that queue. see [cloud tasks iam][task-iam] and
[single-queue access][task-queue-iam].

this replaces the worker's permanent cpu allocation with request-driven service instances that scale to zero.
separate queues isolate backlog, retry, dispatch-rate, and pause controls; separate services isolate deploys,
instances, maximum scale, runtime identities, and secrets. cloud tasks supports configurable delivery rates,
schedules, retries, and task deduplication, which maps closely to the current queue behavior. it persists a task
until success or retry exhaustion. see [cloud tasks concepts][tasks].

the caveats are:

- delivery is at least once, so handlers must be idempotent;
- an http target must finish and return success within the cloud tasks deadline, whose maximum is 30 minutes;
- a service at zero instances has cold-start latency;
- task-name deduplication is bounded: cloud tasks remembers a deleted task name for up to 24 hours;
- runtime tasks are application data created with the cloud tasks api, not pulumi resources; the queue, iam,
  service, service account, and secret bindings are infrastructure resources.

cloud tasks charges per api operation and delivery attempt, with the first one million monthly operations free.
see [cloud tasks pricing][task-pricing].

## topology 2: one unprivileged pull bridge per stack

if producers cannot be moved off bullmq immediately, keep only one worker pool per stack:

```text
bullmq -> stack bridge worker pool -> hook-specific cloud tasks queues -> private hook services
```

the bridge consumes all legacy queues and performs no privileged hook logic. its identity can read the shared redis
credential and enqueue only into that stack's queues; it receives no hsm signing, database, third-party api, or
hook-secret permissions. privileged execution remains in the separately identified cloud run services described
above. after cloud tasks accepts the handoff, its managed queue owns retry and delivery. cloud run describes worker
pools as the resource for always-on pull consumers and services as request-driven endpoints, which is the reason to
keep the pool only at the unavoidable pull edge. see the [cloud run resource model][run-model].

this cuts the fixed worker-pool count from hooks times stacks to stacks, while retaining runtime privilege
segmentation behind the bridge. the compromise is availability rather than privilege: a failed bridge delays every
hook in its stack, and a compromised bridge can submit work to every queue it is allowed to enqueue into. it still
cannot use the downstream runtime identities or read their secrets. keep the original bullmq job unacknowledged
until cloud tasks confirms creation, and make the handoff idempotent.

this topology should be treated as a migration or protocol-adapter layer. once all producers can create cloud tasks
directly, remove the bridge and its remaining fixed compute.

## topology 3: pub/sub or eventarc fan-out to services and jobs

for an event that several hooks must independently observe:

```text
publisher -> topic or event bus
               |-> filtered subscription or enrollment -> private hook service
               |-> filtered subscription or enrollment -> private hook service
               +-> eventarc advanced pipeline -> hook cloud run job
```

a pub/sub topic can have multiple subscriptions with different attribute filters. a push subscription works with
autoscaling cloud run, can send a signed jwt, and redelivers when the endpoint does not acknowledge the request.
give each subscription an invocation identity with `roles/run.invoker` on only its destination. configure retry
and a dead-letter topic per subscription so one failed hook accumulates its own backlog rather than blocking the
others. see [subscription filtering][pubsub-filter], [push delivery][pubsub-push],
[authenticated push][pubsub-auth], and [dead-letter topics][pubsub-dead-letter].

use a cloud run service for short or frequent event handling. use a cloud run job for finite, infrequent, or
long-running work: a job runs tasks to completion and exits instead of listening for requests, can use its own
service identity and secrets, and supports a task timeout up to seven days. eventarc advanced can route matching
bus events directly to cloud run jobs; its pipeline must transform the event into a cloud run admin api job-run
request. see [cloud run jobs][run-jobs], [job identity][job-identity], [job secrets][job-secrets], and
[eventarc advanced job delivery][eventarc-job].

the caveats are:

- pub/sub and eventarc use at-least-once delivery, so consumers remain idempotent;
- pub/sub filters inspect message attributes, not the message body, and a subscription filter is immutable;
- dead-letter delivery counts are approximate and require the documented service-agent iam grants;
- each eventarc advanced pipeline has one destination, and each project-region is limited to one bus, 100
  enrollments, and 100 pipelines;
- invoking a job with payload-derived overrides requires
  `roles/run.jobsExecutorWithOverrides` or `roles/run.developer`, scoped to the specific job; plain
  `roles/run.invoker` is sufficient only without overrides;
- one job execution per small, frequent event has more startup and orchestration overhead than a cloud run
  service;
- eventarc advanced is usage-priced at $1 per million bus messages, $0.50 per million pipeline messages, and
  $0.40 per million transformation operations, before destination charges.

see the [eventarc overview][eventarc-overview], [eventarc quotas][eventarc-quotas],
[job execution permissions][job-execute], and [eventarc pricing][eventarc-pricing].

## repository-specific recommendation

the existing five worker pools are already five useful privilege domains. preserve those runtime accounts and move
the handler behind a private, scale-to-zero service; do not combine handlers merely because they use the same image.
the target matrix is:

| command | allowed producer | fixed queue target | runtime identity keeps | runtime identity may enqueue |
| --- | --- | --- | --- | --- |
| allow | persona hook | private allow service | allower hsm key | poke queue |
| poke | activity hook and allow service | private poke service | poker hsm key, onesignal and segment secrets | credit queue |
| credit | card api and poke service | private credit service | postgres and onesignal secrets | none |
| refund | panda hook | private refund service | refunder hsm key and panda api secret | none |
| subscribe | credential creation path | private subscribe service | alchemy webhook administration secret | none |

redis and sentry access in `infra/index.ts` are transport and observability concerns rather than business
privileges. redis leaves each row after its bullmq queue is migrated. sentry can remain a narrowly scoped common
configuration secret if it must be secret at all.

each row has three distinct identities:

1. the producer runtime account receives `roles/cloudtasks.enqueuer` on only the named queue;
2. a queue-specific oidc account receives `roles/run.invoker` on only the matching private service, while the cloud
   tasks service agent receives token-creation permission on that account;
3. the service runtime account receives only the secrets, hsm key, and downstream queue grants in the table.

set the private services to internal ingress and require iam. cloud tasks in the same project is recognized as an
internal cloud run source, so network ingress and oidc iam can be applied together. see [cloud run ingress][run-ingress].
external webhook receivers necessarily remain internet-reachable and must authenticate the provider signature in
application code. give each receiver only its verification secret and the exact queue-enqueuer grants it needs.

the provider-facing hooks are not all equally asynchronous. the panda `transaction.requested` path returns an
authorization decision synchronously, so it should remain a request handler with a dedicated runtime identity;
only its follow-up work should be queued. activity, persona, bridge, manteca, and non-decision panda events can
validate, durably enqueue, and acknowledge. the block hook cannot move unchanged: its process-local mutexes,
`setTimeout` calls, and redis sorted sets assume a long-lived single process.

initially set maximum instances and request concurrency to one on the signer services. that preserves the current
one-worker serialization while still scaling to zero. increasing either limit later requires application-level
idempotency and a distributed lock or nonce discipline; cloud tasks does not guarantee dispatch order. see the
[cloud tasks limitations][task-limitations].

## bullmq payload and retry migration

the current queue defaults are ten attempts, exponential backoff from one second, and a ten-per-second worker
limit. configure the corresponding queue-level cloud tasks retry and rate settings first. cloud tasks offers
bounded attempts and backoff, but after retry exhaustion it deletes the task rather than moving it to a native
dead-letter queue. the final attempt must therefore write a durable failure record or publish a failure event in
addition to sentry reporting. see [cloud tasks retry configuration][task-retries].

move each bullmq `Job` shape into a versioned http command envelope containing `commandId`, `type`, `version`,
`payload`, `sentryTrace`, and `sentryBaggage`. map the current job id to a task name only after normalizing or hashing
it to the cloud tasks name grammar. do not treat the task name as the sole business idempotency mechanism: cloud
tasks retains a deleted name for up to 24 hours, while the current account-derived bullmq ids have different
lifetime semantics. persist the command id or provider event id with the business side effect and make duplicate
delivery return success. see [cloud tasks quotas and deduplication][task-quotas].

the current `allow -> poke -> credit` chain maps directly to downstream queue grants in the matrix. acknowledge the
upstream request only after downstream task creation succeeds. `poke` currently uses `job.updateData` to retain the
assets still pending between retries; an http task handler cannot mutate its task body, so store that progress
under the command id or create a new continuation task with a new id before returning success.

for the block hook, replace each redis sorted-set item and timer with a scheduled task and keep the proposal id as
the durable idempotency key. cloud tasks can schedule at most 30 days ahead and does not order tasks, so work beyond
that horizon needs a database outbox plus a periodic scheduler, and per-account proposal execution needs a
distributed lock or contract-nonce guard. the subscribe worker also relies on an in-memory `webhookId`; persist or
resolve that id before separating the activity and subscribe processes.

for the transitional bridge, deserialize the old bullmq payload, create the exact new command envelope, and mark
the bullmq job complete only after cloud tasks confirms creation. treat an already-existing task name as a
successful handoff only when it represents the same command. never let bullmq and cloud tasks execute the same
command concurrently; migrate one queue at a time behind a producer feature flag, drain it, and then switch its
producer.

## migration sequence

1. build one pulumi component that creates a runtime account, private cloud run service, queue-specific oidc
   account, fixed-target queue, invocation iam, per-secret grants, and optional hsm grant;
2. extract each worker's business `process(data)` function from its bullmq wrapper and add a small authenticated
   http adapter using the versioned command envelope;
3. migrate credit first, then refund and subscribe, because they have no downstream worker chain; migrate allow,
   poke, and their downstream grants together;
4. use the unprivileged bullmq bridge only where a producer cannot switch directly, and delete it after every queue
   drains;
5. replace the block hook's timers and process-local locks before deploying it to a scale-to-zero service;
6. split public hook receivers by verification-secret boundary, keeping panda's authorization decision synchronous
   and queueing only follow-up side effects;
7. remove redis grants and the five worker pools after queue depth, retry, duplicate, latency, and terminal-failure
   metrics are verified for a full retry window.

## pulumi coverage

the infrastructure in all three topologies has first-class pulumi gcp resources:

| concern | pulumi resource |
| --- | --- |
| service and invocation iam | [`gcp.cloudrunv2.Service`][pulumi-service], [`ServiceIamMember`][pulumi-service-iam] |
| job and invocation iam | [`gcp.cloudrunv2.Job`][pulumi-job], [`JobIamMember`][pulumi-job-iam] |
| runtime and invocation identities | [`gcp.serviceaccount.Account`][pulumi-account] |
| cloud tasks queues and queue iam | [`gcp.cloudtasks.Queue`][pulumi-queue], `QueueIamMember` |
| pub/sub routing | [`gcp.pubsub.Topic` and `Subscription`][pulumi-pubsub] |
| per-secret access | [`gcp.secretmanager.SecretIamMember`][pulumi-secret-iam] |
| eventarc standard and advanced | [`gcp.eventarc.Trigger`, `MessageBus`, `Pipeline`, and `Enrollment`][pulumi-eventarc] |

pulumi manages the topology and iam, while messages, tasks, and job executions remain runtime data. eventarc
advanced resources are first-class in current pulumi gcp releases, but are based on the provider's google-beta
surface. this is a supportability consideration compared with the simpler cloud tasks and pub/sub design.

[autoscaling]: https://docs.cloud.google.com/run/docs/about-instance-autoscaling
[eventarc-job]: https://docs.cloud.google.com/eventarc/advanced/docs/quickstarts/publish-events-cloud-run-job
[eventarc-overview]: https://docs.cloud.google.com/eventarc/docs/overview
[eventarc-pricing]: https://cloud.google.com/eventarc/pricing
[eventarc-quotas]: https://docs.cloud.google.com/eventarc/docs/quotas
[job-execute]: https://docs.cloud.google.com/run/docs/execute/jobs
[job-identity]: https://docs.cloud.google.com/run/docs/configuring/jobs/service-identity
[job-secrets]: https://docs.cloud.google.com/run/docs/configuring/jobs/secrets
[pubsub-auth]: https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions
[pubsub-dead-letter]: https://docs.cloud.google.com/pubsub/docs/handling-failures
[pubsub-filter]: https://docs.cloud.google.com/pubsub/docs/subscription-message-filter
[pubsub-push]: https://docs.cloud.google.com/pubsub/docs/push
[pulumi-account]: https://www.pulumi.com/registry/packages/gcp/api-docs/serviceaccount/account/
[pulumi-eventarc]: https://www.pulumi.com/registry/packages/gcp/api-docs/eventarc/
[pulumi-job]: https://www.pulumi.com/registry/packages/gcp/api-docs/cloudrunv2/job/
[pulumi-job-iam]: https://www.pulumi.com/registry/packages/gcp/api-docs/cloudrunv2/jobiammember/
[pulumi-pubsub]: https://www.pulumi.com/registry/packages/gcp/api-docs/pubsub/
[pulumi-queue]: https://www.pulumi.com/registry/packages/gcp/api-docs/cloudtasks/queue/
[pulumi-secret-iam]: https://www.pulumi.com/registry/packages/gcp/api-docs/secretmanager/secretiammember/
[pulumi-service]: https://www.pulumi.com/registry/packages/gcp/api-docs/cloudrunv2/service/
[pulumi-service-iam]: https://www.pulumi.com/registry/packages/gcp/api-docs/cloudrunv2/serviceiammember/
[run-jobs]: https://docs.cloud.google.com/run/docs/create-jobs
[run-ingress]: https://docs.cloud.google.com/run/docs/securing/ingress
[run-model]: https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run
[run-pricing]: https://cloud.google.com/run/pricing
[run-tasks]: https://docs.cloud.google.com/run/docs/triggering/using-tasks
[service-account]: https://docs.cloud.google.com/run/docs/configuring/services/service-identity
[service-identity]: https://docs.cloud.google.com/run/docs/securing/service-identity
[service-secrets]: https://docs.cloud.google.com/run/docs/configuring/services/secrets
[task-auth]: https://docs.cloud.google.com/tasks/docs/creating-http-target-tasks
[task-iam]: https://docs.cloud.google.com/tasks/docs/access-control
[task-pricing]: https://cloud.google.com/tasks/pricing
[task-queue-iam]: https://docs.cloud.google.com/tasks/docs/secure-queue-configuration
[task-limitations]: https://docs.cloud.google.com/tasks/docs/common-pitfalls
[task-quotas]: https://docs.cloud.google.com/tasks/docs/quotas
[task-retries]: https://docs.cloud.google.com/tasks/docs/configuring-queues
[task-routing]: https://docs.cloud.google.com/tasks/docs/configuring-queues
[tasks]: https://docs.cloud.google.com/tasks/docs/dual-overview
