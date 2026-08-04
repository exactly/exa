import {
  artifactregistry,
  cloudrunv2,
  kms,
  parametermanager,
  projects,
  secretmanager,
  serviceaccount,
} from "@pulumi/gcp";
import { automation, Config, getStack, interpolate } from "@pulumi/pulumi";
import { createHash } from "node:crypto";

import rejectSecrets from "./utils/rejectSecrets.ts";
import secretIds from "./utils/secrets.ts";

const stack = getStack();
await rejectSecrets(stack, await automation.LocalWorkspace.create({ workDir: import.meta.dirname }));
const config = new Config();
const project = new Config("gcp").require("project");
const location = config.get("location") ?? "us-west1";
const run = new projects.Service("run", { service: "run.googleapis.com" });
const cloudKms = new projects.Service("cloudkms", { service: "cloudkms.googleapis.com" });
const registry = new projects.Service("artifactregistry", { service: "artifactregistry.googleapis.com" });
const parameterManager = new projects.Service("parametermanager", { service: "parametermanager.googleapis.com" });

const keyRing = new kms.KeyRing("signers", { location, name: `${stack}-signers` }, { dependsOn: cloudKms });
const crema = serviceaccount.getAccountOutput({ accountId: `${stack}-crema` });
const refund = serviceaccount.getAccountOutput({ accountId: `${stack}-refund` });
const secrets = Object.fromEntries(
  secretIds.map((secret) => [
    secret,
    secretmanager.Secret.get(secret, `projects/${project}/secrets/${stack}-${secret}`),
  ]),
) as Record<(typeof secretIds)[number], secretmanager.Secret>;

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

const refundPool = new cloudrunv2.WorkerPool(
  "refund",
  {
    location,
    name: `${stack}-refund`,
    scaling: { manualInstanceCount: 1 },
    template: {
      serviceAccount: refund.email,
      containers: [
        {
          image: serverImage,
          resources: config.getObject("refundResources"),
          args: ["dist/workers/refund/bin.cjs"],
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
    ignoreChanges: ["scaling.manualInstanceCount"],
  },
);

const configuration = JSON.stringify({
  apiVersion: "crema/v1",
  kind: "CremaConfig",
  metadata: { name: "workers" },
  spec: {
    pollingInterval: 2,
    triggerAuthentications: [
      {
        metadata: { name: "redis" },
        spec: {
          gcpSecretManager: {
            secrets: [
              { parameter: "address", id: `${stack}-redis-address`, version: "latest" },
              { parameter: "password", id: `${stack}-redis-password`, version: "latest" },
              { parameter: "username", id: `${stack}-redis-username`, version: "latest" },
            ],
          },
        },
      },
    ],
    scaledObjects: [{ minimum: config.getNumber("refundWorkers") ?? 0, name: "refund" }].map(({ minimum, name }) => ({
      spec: {
        scaleTargetRef: { name: `projects/${project}/locations/${location}/workerpools/${stack}-${name}` },
        minReplicaCount: minimum,
        maxReplicaCount: 1,
        advanced: {
          horizontalPodAutoscalerConfig: { behavior: { scaleDown: { stabilizationWindowSeconds: 900 } } },
        },
        triggers: (["wait", "active", "delayed", "prioritized"] as const).map((state) => ({
          type: "redis",
          name: state,
          metadata: { enableTLS: "true", listLength: "1", listName: `bull:${name}:${state}` },
          authenticationRef: { name: "redis" },
        })),
      },
    })),
  },
});
new cloudrunv2.Service(
  "crema",
  {
    ingress: "INGRESS_TRAFFIC_INTERNAL_ONLY",
    labels: { "created-by": "crema" },
    location,
    name: `${stack}-crema`,
    scaling: { manualInstanceCount: 1, scalingMode: "MANUAL" },
    template: {
      serviceAccount: crema.email,
      containers: [
        {
          baseImageUri: "us-central1-docker.pkg.dev/serverless-runtimes/google-24/runtimes/java25",
          envs: [
            {
              name: "CREMA_CONFIG",
              value: new parametermanager.ParameterVersion("crema", {
                parameter: new parametermanager.Parameter(
                  "crema",
                  { format: "JSON", parameterId: `${stack}-crema` },
                  { dependsOn: parameterManager },
                ).id,
                parameterData: configuration,
                parameterVersionId: `v${createHash("sha256").update(configuration).digest("hex").slice(0, 15)}`,
              }).name,
            },
            { name: "ENABLE_CLOUD_LOGGING", value: "false" },
            { name: "OUTPUT_SCALER_METRICS", value: "false" },
          ],
          image: "us-central1-docker.pkg.dev/cloud-run-oss-images/crema-v1/autoscaler:1.2",
          resources: { cpuIdle: false, limits: { cpu: "1", memory: "512Mi" } },
        },
      ],
    },
  },
  {
    dependsOn: [
      run,
      new cloudrunv2.WorkerPoolIamMember("crema-refund", {
        location,
        member: interpolate`serviceAccount:${crema.email}`,
        name: refundPool.name,
        role: `projects/${project}/roles/cremaScaler`,
      }),
      ...(["redis-address", "redis-password", "redis-username"] as const).map(
        (secret) =>
          new secretmanager.SecretIamMember(`crema-${secret}-access`, {
            member: interpolate`serviceAccount:${crema.email}`,
            role: "roles/secretmanager.secretAccessor",
            secretId: secrets[secret].id,
          }),
      ),
    ],
  },
);
