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
import { hash } from "node:crypto";

import modules from "./utils/modules.ts";
import rejectSecrets from "./utils/rejectSecrets.ts";

import type { types } from "@pulumi/gcp";

const stack = getStack();
await rejectSecrets(stack, await automation.LocalWorkspace.create({ workDir: import.meta.dirname }));

const config = new Config();
const project = new Config("gcp").require("project");
const location = config.get("location") ?? "us-west1";
const run = new projects.Service("run", { service: "run.googleapis.com" });
const registry = new projects.Service("artifactregistry", { service: "artifactregistry.googleapis.com" });
const parameterManager = new projects.Service("parametermanager", { service: "parametermanager.googleapis.com" });

const image = interpolate`${
  new artifactregistry.Repository(
    "ghcr",
    {
      location,
      format: "DOCKER",
      mode: "REMOTE_REPOSITORY",
      repositoryId: `${stack}-ghcr`,
      remoteRepositoryConfig: { commonRepository: { uri: "https://ghcr.io" } },
      cleanupPolicies: [{ action: "DELETE", condition: { olderThan: "1d" }, id: "delete-cached" }],
    },
    { dependsOn: registry },
  ).registryUri
}/exactly/exa-${stack}:${config.require("serverImage")}`;

function module(
  name: string,
  {
    env,
    secrets,
    signers,
  }: {
    [Modules in "services" | "workers"]: (typeof modules)[Modules][keyof (typeof modules)[Modules]];
  }["services" | "workers"],
  kind: "api" | "hook" | "worker",
) {
  const account = serviceaccount.getAccountOutput({
    accountId: `${stack}-${name}${kind === "api" ? "" : `-${kind}`}`,
  });
  return {
    name,
    template: {
      serviceAccount: account.email,
      containers: [
        {
          image,
          resources: config.getObject<types.input.cloudrunv2.JobTemplateTemplateContainerResources>(`${name}Resources`),
          args: [
            {
              api: "dist/api/bin.cjs",
              hook: `dist/hooks/bin/${name}.cjs`,
              worker: `dist/workers/${name}/bin.cjs`,
            }[kind],
          ],
          envs: [
            { name: "APP_DOMAIN", value: config.get("domain") ?? `${stack}.exactly.app` },
            { name: "DEBUG", value: "exa:*" },
            { name: "NODE_ENV", value: "production" },
            { name: "SENTRY_DSN", valueSource: { secretKeyRef: { secret: `${stack}-sentry-dsn`, version: "latest" } } },
            ...(signers.length > 0
              ? [
                  { name: "GCP_KMS_LOCATION", value: location },
                  ...signers.map((signer) => ({
                    name: `GCP_KMS_KEY_VERSION_${signer.toUpperCase()}`,
                    value: config.get(`${signer}Version`),
                  })),
                ]
              : []),
            ...Object.entries(env).map(([variable, key]) => ({ name: variable, value: config.require(key) })),
          ],
        },
      ],
    },
    dependencies: [
      ...secrets.map(
        (secret) =>
          new secretmanager.SecretIamMember(`${name}${kind === "api" ? "" : `-${kind}`}-${secret}-access`, {
            member: interpolate`serviceAccount:${account.email}`,
            role: "roles/secretmanager.secretAccessor",
            secretId: `projects/${project}/secrets/${stack}-${secret}`,
          }),
      ),
      ...signers.map(
        (signer) =>
          new kms.CryptoKeyIAMMember(`${name}${kind === "api" ? "" : `-${kind}`}-${signer}-signer`, {
            cryptoKeyId: `projects/${project}/locations/${location}/keyRings/${stack}-signers/cryptoKeys/${stack}-${signer}`,
            member: interpolate`serviceAccount:${account.email}`,
            role: "roles/cloudkms.signerVerifier",
          }),
      ),
    ],
  };
}

export default Object.fromEntries(
  Object.entries(modules.services).map(([name, fields]) => {
    const service = module(name, fields, name === "api" ? "api" : "hook");
    const target = new cloudrunv2.Service(
      name,
      {
        location,
        name: `${stack}-${name}`,
        scaling: { minInstanceCount: config.getNumber(`${name}Minimum`), maxInstanceCount: 1 },
        template: {
          ...service.template,
          containers: service.template.containers.map((container) => ({
            ...container,
            ports: { containerPort: 3000 },
          })),
        },
      },
      { dependsOn: [run, ...service.dependencies] },
    );
    new cloudrunv2.ServiceIamMember(`${name}-invoker`, {
      location,
      member: "allUsers",
      role: "roles/run.invoker",
      name: target.name,
    });
    return [name, target.uri];
  }),
);

const workers = Object.entries(modules.workers).map(([name, w]) => module(name, w, "worker"));
const pools = workers.map(({ dependencies, name, template }) => {
  const check = new cloudrunv2.Job(
    `${name}-check`,
    {
      deletionProtection: false,
      location,
      name: `${stack}-${name}-check`,
      runExecutionToken: hash("sha256", `${config.require("serverImage")}:${config.require("rollout")}`).slice(0, 16),
      template: {
        template: {
          ...template,
          containers: template.containers.map((container) => ({
            ...container,
            args: [...container.args, "--check"],
          })),
          maxRetries: 0,
          timeout: "60s",
        },
      },
    },
    { dependsOn: [run, ...dependencies] },
  );
  return {
    name,
    target: new cloudrunv2.WorkerPool(
      name,
      { location, name: `${stack}-${name}`, scaling: { manualInstanceCount: 0 }, template },
      { dependsOn: [run, ...dependencies, check], ignoreChanges: ["scaling.manualInstanceCount"] },
    ),
  };
});

const crema = serviceaccount.getAccountOutput({ accountId: `${stack}-crema` });
const cremaConfig = JSON.stringify({
  apiVersion: "crema/v1",
  kind: "CremaConfig",
  spec: {
    pollingInterval: 2,
    triggerAuthentications: [
      {
        metadata: { name: "redis" },
        spec: {
          gcpSecretManager: {
            secrets: [
              { parameter: "address", id: `${stack}-redis-address` },
              { parameter: "password", id: `${stack}-redis-password` },
              { parameter: "username", id: `${stack}-redis-username` },
            ],
          },
        },
      },
    ],
    scaledObjects: workers.map(({ name }) => ({
      spec: {
        scaleTargetRef: { name: `projects/${project}/locations/${location}/workerpools/${stack}-${name}` },
        minReplicaCount: config.getNumber(`${name}Minimum`),
        maxReplicaCount: 1,
        advanced: { horizontalPodAutoscalerConfig: { behavior: { scaleDown: { stabilizationWindowSeconds: 900 } } } },
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
    location,
    name: `${stack}-crema`,
    scaling: { scalingMode: "MANUAL", manualInstanceCount: 1 },
    ingress: "INGRESS_TRAFFIC_INTERNAL_ONLY",
    template: {
      serviceAccount: crema.email,
      containers: [
        {
          envs: [
            {
              name: "CREMA_CONFIG",
              value: new parametermanager.ParameterVersion("crema", {
                parameter: new parametermanager.Parameter(
                  "crema",
                  { format: "JSON", parameterId: `${stack}-crema` },
                  { dependsOn: parameterManager },
                ).id,
                parameterData: cremaConfig,
                parameterVersionId: hash("sha256", cremaConfig).slice(0, 16),
              }).name,
            },
          ],
          image: "us-central1-docker.pkg.dev/cloud-run-oss-images/crema-v1/autoscaler:1.2",
          baseImageUri: "us-central1-docker.pkg.dev/serverless-runtimes/google-24/runtimes/java25",
          resources: { cpuIdle: false },
        },
      ],
    },
  },
  {
    dependsOn: [
      run,
      ...pools.map(
        ({ name, target }) =>
          new cloudrunv2.WorkerPoolIamMember(`crema-${name}`, {
            location,
            name: target.name,
            member: interpolate`serviceAccount:${crema.email}`,
            role: `projects/${project}/roles/cremaScaler`,
          }),
      ),
      ...modules.crema.map(
        (secret) =>
          new secretmanager.SecretIamMember(`crema-${secret}-access`, {
            secretId: `projects/${project}/secrets/${stack}-${secret}`,
            member: interpolate`serviceAccount:${crema.email}`,
            role: "roles/secretmanager.secretAccessor",
          }),
      ),
    ],
  },
);
