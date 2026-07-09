import { artifactregistry, cloudrunv2, kms, projects, secretmanager, serviceaccount } from "@pulumi/gcp";
import { Config, getStack, interpolate } from "@pulumi/pulumi";

const stack = getStack();
const config = new Config();
const location = config.get("location") ?? "us-west1";
const iam = new projects.Service("iam", { service: "iam.googleapis.com" });
const run = new projects.Service("run", { service: "run.googleapis.com" });
const cloudKms = new projects.Service("cloudkms", { service: "cloudkms.googleapis.com" });
const registry = new projects.Service("artifactregistry", { service: "artifactregistry.googleapis.com" });
const secretManager = new projects.Service("secretmanager", { service: "secretmanager.googleapis.com" });

const keyRing = new kms.KeyRing("signers", { location, name: `${stack}-signers` }, { dependsOn: cloudKms });
const refund = new serviceaccount.Account("refund-worker", { accountId: `${stack}-refund` }, { dependsOn: iam });
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
  ) as Record<S[number], secretmanager.Secret>)([
  "account-alchemy-webhooks-key",
  "panda-api-url",
  "refund-panda-api-key",
  "redis-url",
  "sentry-dsn",
]);

const serverImage = interpolate`${
  new artifactregistry.Repository(
    "ghcr",
    {
      location,
      format: "DOCKER",
      mode: "REMOTE_REPOSITORY",
      repositoryId: `${stack}-ghcr`,
      remoteRepositoryConfig: { commonRepository: { uri: "https://ghcr.io" }, description: "ghcr.io" },
      cleanupPolicies: [{ action: "DELETE", condition: { olderThan: "1d" }, id: "delete-cached" }],
    },
    { dependsOn: registry },
  ).registryUri
}/exactly/exa-${stack}:${config.require("serverImage")}`;

new cloudrunv2.WorkerPool(
  "refund",
  {
    location,
    name: `${stack}-refund`,
    scaling: { manualInstanceCount: config.getNumber("refundWorkers") ?? 1 },
    template: {
      serviceAccount: refund.email,
      containers: [
        {
          image: serverImage,
          resources: config.getObject("refundResources"),
          args: ["dist/workers/refund/worker.cjs"],
          envs: [
            { name: "APP_STACK", value: stack },
            { name: "DEBUG", value: "exa:*" },
            { name: "GCP_KMS_KEY_RING", value: keyRing.name },
            { name: "GCP_KMS_KEY_VERSION", value: config.get("refunderVersion") ?? "1" },
            { name: "GCP_KMS_LOCATION", value: location },
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
      new kms.CryptoKeyIAMMember("refund-signer", {
        cryptoKeyId: new kms.CryptoKey(
          "refunder",
          {
            name: `${stack}-refunder`,
            purpose: "ASYMMETRIC_SIGN",
            versionTemplate: { algorithm: "EC_SIGN_SECP256K1_SHA256", protectionLevel: "HSM" },
            keyRing: keyRing.id,
          },
          { protect: true, retainOnDelete: true },
        ).id,
        member: interpolate`serviceAccount:${refund.email}`,
        role: "roles/cloudkms.signerVerifier",
      }),
      ...(["panda-api-url", "refund-panda-api-key", "redis-url", "sentry-dsn"] as const).map(
        (secret) =>
          new secretmanager.SecretIamMember(`refund-${secret}-access`, {
            member: interpolate`serviceAccount:${refund.email}`,
            role: "roles/secretmanager.secretAccessor",
            secretId: secrets[secret].id,
          }),
      ),
    ],
  },
);

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
          image: serverImage,
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
