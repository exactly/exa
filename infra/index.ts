import { cloudrunv2, projects, secretmanager, serviceaccount } from "@pulumi/gcp";
import { Config, getStack, interpolate } from "@pulumi/pulumi";

const stack = getStack();
const config = new Config();
const location = config.get("location") ?? "us-west1";
const iam = new projects.Service("iam", { service: "iam.googleapis.com" });
const run = new projects.Service("run", { service: "run.googleapis.com" });
const secretManager = new projects.Service("secretmanager", { service: "secretmanager.googleapis.com" });

const subscribe = new serviceaccount.Account(
  "subscribe-worker",
  { accountId: `${stack}-subscribe` },
  { dependsOn: iam },
);
const secrets = (<const S extends readonly string[]>(names: S) =>
  Object.fromEntries(
    names.map((secret) => [
      secret,
      new secretmanager.Secret(
        secret,
        { secretId: `${stack}-${secret}`, replication: { auto: {} } },
        { dependsOn: secretManager },
      ),
    ]),
  ) as Record<S[number], secretmanager.Secret>)(["account-alchemy-webhooks-key", "redis-url", "sentry-dsn"]);

new cloudrunv2.WorkerPool(
  "subscribe",
  {
    location,
    name: `${stack}-subscribe`,
    scaling: { manualInstanceCount: config.getNumber("subscribeWorkers") ?? 1 },
    template: {
      serviceAccount: subscribe.email,
      containers: [
        {
          image: config.require("serverImage"),
          resources: config.getObject("subscribeResources"),
          args: ["dist/workers/subscribe/worker.cjs"],
          envs: [
            { name: "ALCHEMY_ACTIVITY_ID", value: config.require("alchemyActivityId") },
            { name: "APP_STACK", value: stack },
            { name: "DEBUG", value: "exa:*" },
            { name: "NODE_ENV", value: "production" },
            { name: "SENTRY_DSN", valueSource: { secretKeyRef: { secret: `${stack}-sentry-dsn`, version: "latest" } } },
          ],
        },
      ],
    },
  },
  {
    dependsOn: [
      run,
      ...(["account-alchemy-webhooks-key", "redis-url", "sentry-dsn"] as const).map(
        (secret) =>
          new secretmanager.SecretIamMember(`${secret}-access`, {
            member: interpolate`serviceAccount:${subscribe.email}`,
            role: "roles/secretmanager.secretAccessor",
            secretId: secrets[secret].id,
          }),
      ),
    ],
  },
);
