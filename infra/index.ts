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
const allow = new serviceaccount.Account("allow-worker", { accountId: `${stack}-allower` }, { dependsOn: iam });
const credit = new serviceaccount.Account("credit-worker", { accountId: `${stack}-credit` }, { dependsOn: iam });
const poke = new serviceaccount.Account("poke-worker", { accountId: `${stack}-poke` }, { dependsOn: iam });
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
  "credit-onesignal-api-key",
  "credit-postgres-url",
  "panda-api-url",
  "poke-onesignal-api-key",
  "poke-segment-write-key",
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
  "allow",
  {
    location,
    name: `${stack}-allow`,
    scaling: { manualInstanceCount: config.getNumber("allowWorkers") ?? 1 },
    template: {
      serviceAccount: allow.email,
      containers: [
        {
          image: serverImage,
          resources: config.getObject("allowResources"),
          args: ["dist/workers/allow/worker.cjs"],
          envs: [
            { name: "APP_STACK", value: stack },
            { name: "DEBUG", value: "exa:*" },
            { name: "GCP_KMS_KEY_RING", value: keyRing.name },
            { name: "GCP_KMS_KEY_VERSION", value: config.get("allowerVersion") ?? "1" },
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
      new kms.CryptoKeyIAMMember("allow-signer", {
        cryptoKeyId: new kms.CryptoKey(
          "allower",
          {
            name: `${stack}-allower`,
            purpose: "ASYMMETRIC_SIGN",
            versionTemplate: { algorithm: "EC_SIGN_SECP256K1_SHA256", protectionLevel: "HSM" },
            keyRing: keyRing.id,
          },
          { protect: true, retainOnDelete: true },
        ).id,
        member: interpolate`serviceAccount:${allow.email}`,
        role: "roles/cloudkms.signerVerifier",
      }),
      ...(["redis-url", "sentry-dsn"] as const).map(
        (secret) =>
          new secretmanager.SecretIamMember(`allow-${secret}-access`, {
            member: interpolate`serviceAccount:${allow.email}`,
            role: "roles/secretmanager.secretAccessor",
            secretId: secrets[secret].id,
          }),
      ),
    ],
  },
);

new cloudrunv2.WorkerPool(
  "credit",
  {
    location,
    name: `${stack}-credit`,
    scaling: { manualInstanceCount: config.getNumber("creditWorkers") ?? 1 },
    template: {
      serviceAccount: credit.email,
      containers: [
        {
          image: serverImage,
          resources: config.getObject("creditResources"),
          args: ["dist/workers/credit/worker.cjs"],
          envs: [
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
      ...(["credit-onesignal-api-key", "credit-postgres-url", "redis-url", "sentry-dsn"] as const).map(
        (secret) =>
          new secretmanager.SecretIamMember(`credit-${secret}-access`, {
            member: interpolate`serviceAccount:${credit.email}`,
            role: "roles/secretmanager.secretAccessor",
            secretId: secrets[secret].id,
          }),
      ),
    ],
  },
);

new cloudrunv2.WorkerPool(
  "poke",
  {
    location,
    name: `${stack}-poke`,
    scaling: { manualInstanceCount: config.getNumber("pokeWorkers") ?? 1 },
    template: {
      serviceAccount: poke.email,
      containers: [
        {
          image: serverImage,
          resources: config.getObject("pokeResources"),
          args: ["dist/workers/poke/worker.cjs"],
          envs: [
            { name: "APP_STACK", value: stack },
            { name: "DEBUG", value: "exa:*" },
            { name: "GCP_KMS_KEY_RING", value: keyRing.name },
            { name: "GCP_KMS_KEY_VERSION", value: config.get("pokerVersion") ?? "1" },
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
      new kms.CryptoKeyIAMMember("poke-signer", {
        cryptoKeyId: new kms.CryptoKey(
          "poker",
          {
            name: `${stack}-poker`,
            purpose: "ASYMMETRIC_SIGN",
            versionTemplate: { algorithm: "EC_SIGN_SECP256K1_SHA256", protectionLevel: "HSM" },
            keyRing: keyRing.id,
          },
          { protect: true, retainOnDelete: true },
        ).id,
        member: interpolate`serviceAccount:${poke.email}`,
        role: "roles/cloudkms.signerVerifier",
      }),
      ...(["poke-onesignal-api-key", "poke-segment-write-key", "redis-url", "sentry-dsn"] as const).map(
        (secret) =>
          new secretmanager.SecretIamMember(`poke-${secret}-access`, {
            member: interpolate`serviceAccount:${poke.email}`,
            role: "roles/secretmanager.secretAccessor",
            secretId: secrets[secret].id,
          }),
      ),
    ],
  },
);

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
