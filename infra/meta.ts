import { iam, kms, orgpolicy, projects, Provider, secretmanager, serviceaccount, storage } from "@pulumi/gcp";
import { automation, interpolate, runtime } from "@pulumi/pulumi";
import { readdir } from "node:fs/promises";
import process, { argv, stdout } from "node:process";
import { array, object, optional, parse, picklist, string } from "valibot";

import modules from "./utils/modules.ts";
import rejectSecrets from "./utils/rejectSecrets.ts";

if (argv[2] !== "preview" && argv[2] !== "up") throw new Error("expected preview or up");
if (argv[3] === undefined) throw new Error("expected stack");

const workspace = await automation.LocalWorkspace.create({ workDir: import.meta.dirname });
const meta = await rejectSecrets("meta", workspace);
const disabled: unknown = meta.config?.["pulumi:disable-default-providers"];
if (!Array.isArray(disabled) || disabled.length !== 1 || disabled[0] !== "*") throw new Error("invalid meta config");
const files = await readdir(import.meta.dirname); // eslint-disable-line security/detect-non-literal-fs-filename -- module directory
const stacks = await Promise.all(
  files
    .map((file) => /^Pulumi\.(.+)\.yaml$/.exec(file)?.[1])
    .filter((stack): stack is string => stack !== undefined && stack !== "meta")
    .map(async (name) => {
      const settings = await workspace.stackSettings(name);
      const disabledModules = parse(
        optional(
          array(picklist(Object.keys({ ...modules.services, ...modules.workers }), `unknown module in ${name}`)),
          [],
        ),
        settings.config?.["exa:disabled"],
      );
      const location: unknown = settings.config?.["exa:location"] ?? "us-west1";
      const project: unknown = settings.config?.["gcp:project"];
      if (typeof location !== "string" || location.length === 0) throw new Error(`invalid exa:location in ${name}`);
      if (typeof project !== "string" || project.length === 0) throw new Error(`missing gcp:project in ${name}`);
      return {
        location,
        name,
        project,
        services: Object.fromEntries(
          Object.entries(modules.services).filter(([key]) => !disabledModules.includes(key)),
        ),
        workers: Object.fromEntries(Object.entries(modules.workers).filter(([key]) => !disabledModules.includes(key))),
      };
    }),
);
const target = stacks.find(({ name }) => name === argv[3]);
if (!target) throw new Error(`unknown stack ${argv[3]}`);
const selected = await automation.LocalWorkspace.selectStack(
  {
    projectName: "exa",
    stackName: "meta",
    program() {
      runtime.registerStackTransformation(({ opts, props }) => ({
        opts: { ...opts, protect: opts.protect ?? true },
        props,
      }));
      const stateProvider = new Provider("state", {
        project: "eexxxaa",
        billingProject: "eexxxaa",
        userProjectOverride: true,
      });
      const stateServices = ["iam", "iamcredentials", "sts", "storage"].map(
        (api) =>
          new projects.Service(`state-${api}`, { service: `${api}.googleapis.com` }, { provider: stateProvider }),
      );
      const stateBucket = new storage.Bucket(
        "state",
        {
          location: "US",
          name: "exa-pulumi-state",
          publicAccessPrevention: "enforced",
          uniformBucketLevelAccess: true,
        },
        { dependsOn: stateServices, provider: stateProvider },
      );
      const objects = new projects.IAMCustomRole(
        "state-objects",
        {
          permissions: ["create", "delete", "get", "update"].map((permission) => `storage.objects.${permission}`),
          roleId: "pulumiState",
          title: "pulumi state objects",
        },
        { dependsOn: stateServices, provider: stateProvider },
      );
      const list = new projects.IAMCustomRole(
        "state-list",
        { permissions: ["storage.objects.list"], roleId: "pulumiStateList", title: "pulumi state list" },
        { dependsOn: stateServices, provider: stateProvider },
      );
      const pool = new iam.WorkloadIdentityPool(
        "github",
        { workloadIdentityPoolId: "github" },
        { dependsOn: stateServices, provider: stateProvider },
      );
      const federation = new iam.WorkloadIdentityPoolProvider(
        "github",
        {
          attributeCondition: `assertion.job_workflow_ref == 'exactly/exa/.github/workflows/server-deploy.yaml@' + assertion.ref && (assertion.environment == 'production' ? assertion.ref.startsWith('refs/tags/@exactly/server@') : assertion.ref == 'refs/heads/' + assertion.environment) && assertion.repository_id == '715321557' && assertion.repository_owner_id == '83888950'`,
          attributeMapping: { "attribute.environment": "assertion.environment", "google.subject": "assertion.sub" },
          oidc: { issuerUri: "https://token.actions.githubusercontent.com" },
          workloadIdentityPoolId: pool.workloadIdentityPoolId,
          workloadIdentityPoolProviderId: "github",
        },
        { dependsOn: stateServices, provider: stateProvider },
      );
      const read = new projects.IAMCustomRole(
        "state-read",
        { permissions: ["storage.objects.get"], roleId: "pulumiStateRead", title: "pulumi state read" },
        { dependsOn: stateServices, provider: stateProvider },
      );
      const previewPool = new iam.WorkloadIdentityPool(
        "github-preview",
        { workloadIdentityPoolId: "github-preview" },
        { dependsOn: stateServices, provider: stateProvider },
      );
      const previewFederation = new iam.WorkloadIdentityPoolProvider(
        "github-preview",
        {
          attributeCondition: `assertion.workflow_ref.startsWith('exactly/exa/.github/workflows/infra-preview.yaml@refs/pull/') && assertion.event_name == 'pull_request' && assertion.repository_id == '715321557' && assertion.repository_owner_id == '83888950'`,
          attributeMapping: { "google.subject": "assertion.sub" },
          oidc: { issuerUri: "https://token.actions.githubusercontent.com" },
          workloadIdentityPoolId: previewPool.workloadIdentityPoolId,
          workloadIdentityPoolProviderId: "github",
        },
        { dependsOn: stateServices, provider: stateProvider },
      );
      for (const [project, projectStacks] of Map.groupBy(stacks, (stack) => stack.project)) {
        const provider = new Provider(project, { project, billingProject: "eexxxaa", userProjectOverride: true });
        const cloudKms = new projects.Service(
          `${project}-cloudkms`,
          { service: "cloudkms.googleapis.com" },
          { provider },
        );
        const service = new projects.Service(`${project}-iam`, { service: "iam.googleapis.com" }, { provider });
        const secretManager = new projects.Service(
          `${project}-secretmanager`,
          { service: "secretmanager.googleapis.com" },
          { provider },
        );
        const orgPolicy = new projects.Service(
          `${project}-orgpolicy`,
          { service: "orgpolicy.googleapis.com" },
          { provider },
        );
        new orgpolicy.Policy(
          `${project}-default-accounts`,
          {
            name: `projects/${project}/policies/iam.automaticIamGrantsForDefaultServiceAccounts`,
            parent: `projects/${project}`,
            spec: { rules: [{ enforce: "TRUE" }] },
          },
          { dependsOn: orgPolicy, provider },
        );
        new projects.IAMCustomRole(
          `${project}-crema-scaler`,
          {
            permissions: ["run.operations.get", "run.workerpools.get", "run.workerpools.update"],
            roleId: "cremaScaler",
            title: "crema scaler",
          },
          { dependsOn: service, provider },
        );
        const secretAccess = new projects.IAMCustomRole(
          `${project}-secrets`,
          {
            permissions: "get getIamPolicy list setIamPolicy"
              .split(" ")
              .map((permission) => `secretmanager.secrets.${permission}`),
            roleId: "pulumiSecrets",
            title: "pulumi secret access",
          },
          { dependsOn: service, provider },
        );
        const signerAccess = new projects.IAMCustomRole(
          `${project}-signers`,
          {
            permissions: ["getIamPolicy", "setIamPolicy"].map((permission) => `cloudkms.cryptoKeys.${permission}`),
            roleId: "pulumiSigners",
            title: "pulumi signer access",
          },
          { dependsOn: service, provider },
        );
        const deployment = new projects.IAMCustomRole(
          `${project}-deployment`,
          {
            permissions: [
              ...["delete", "get", "update"].map((permission) => `parametermanager.parameters.${permission}`),
              ...["create", "delete", "get", "update"].map(
                (permission) => `parametermanager.parameterVersions.${permission}`,
              ),
            ],
            roleId: "pulumiDeployment",
            title: "pulumi deployment",
          },
          { dependsOn: service, provider },
        );
        const workerPools = new projects.IAMCustomRole(
          `${project}-worker-pools`,
          {
            permissions: ["getIamPolicy", "setIamPolicy"].map((permission) => `run.workerpools.${permission}`),
            roleId: "pulumiWorkerPools",
            title: "pulumi worker pools",
          },
          { dependsOn: service, provider },
        );
        const parameters = new projects.IAMCustomRole(
          `${project}-parameters`,
          {
            permissions: ["parametermanager.parameters.create"],
            roleId: "pulumiParameters",
            title: "pulumi parameter creation",
          },
          { dependsOn: service, provider },
        );
        const services = new projects.IAMCustomRole(
          `${project}-services`,
          {
            permissions: ["getIamPolicy", "setIamPolicy"].map((permission) => `run.services.${permission}`),
            roleId: "pulumiServices",
            title: "pulumi services",
          },
          { dependsOn: service, provider },
        );
        const preview = new projects.IAMCustomRole(
          `${project}-preview`,
          { permissions: ["iam.serviceAccounts.get"], roleId: "pulumiPreview", title: "pulumi preview" },
          { dependsOn: service, provider },
        );
        for (const stack of projectStacks.filter(({ name }) => name === target.name)) {
          const keyRing = new kms.KeyRing(
            `${stack.name}-signers`,
            { location: stack.location, name: `${stack.name}-signers` },
            { dependsOn: cloudKms, provider },
          );
          for (const key of new Set(
            [...Object.values(modules.services), ...Object.values(modules.workers)].flatMap(({ signers }) => signers),
          )) {
            new kms.CryptoKey(
              `${stack.name}-${key}`,
              {
                keyRing: keyRing.id,
                name: `${stack.name}-${key}`,
                purpose: "ASYMMETRIC_SIGN",
                versionTemplate: { algorithm: "EC_SIGN_SECP256K1_SHA256", protectionLevel: "HSM" },
              },
              { provider, retainOnDelete: true },
            );
          }
          const cremaSecrets: readonly string[] = modules.crema;
          for (const secret of new Set([
            ...cremaSecrets,
            ...Object.values(stack.services).flatMap((fields) => fields.secrets),
            ...Object.values(stack.workers).flatMap((worker) => worker.secrets),
          ])) {
            new secretmanager.Secret(
              `${stack.name}-${secret}`,
              { secretId: `${stack.name}-${secret}`, replication: { auto: {} } },
              { dependsOn: secretManager, protect: cremaSecrets.includes(secret), provider },
            );
          }
          const github = new serviceaccount.Account(
            stack.name,
            { accountId: `github-${stack.name}` },
            { dependsOn: service, provider },
          );
          const member = interpolate`serviceAccount:${github.email}`;
          const crema = new serviceaccount.Account(
            `${stack.name}-crema`,
            { accountId: `${stack.name}-crema` },
            { dependsOn: service, provider },
          );
          const cremaMember = interpolate`serviceAccount:${crema.email}`;
          new serviceaccount.IAMMember(
            `${stack.name}-identity`,
            {
              member: interpolate`principalSet://iam.googleapis.com/${pool.name}/attribute.environment/${stack.name}`,
              role: "roles/iam.workloadIdentityUser",
              serviceAccountId: github.name,
            },
            { provider },
          );
          new serviceaccount.IAMMember(
            `${stack.name}-crema`,
            { member, role: "roles/iam.serviceAccountUser", serviceAccountId: crema.name },
            { provider },
          );
          new projects.IAMMember(
            `${stack.name}-crema-config`,
            {
              condition: {
                expression: `resource.name.startsWith("projects/${project}/locations/global/parameters/${stack.name}-crema/versions/")`,
                title: `${stack.name} crema config`,
              },
              member: cremaMember,
              project,
              role: "roles/parametermanager.parameterViewer",
            },
            { provider },
          );
          for (const name of Object.keys(stack.services)) {
            const identity = `${stack.name}-${name === "api" ? name : `${name}-hook`}`;
            const account = new serviceaccount.Account(
              identity,
              { accountId: identity },
              { dependsOn: service, protect: false, provider },
            );
            new serviceaccount.IAMMember(
              identity,
              { member, role: "roles/iam.serviceAccountUser", serviceAccountId: account.name },
              { protect: false, provider },
            );
          }
          for (const name of Object.keys(stack.workers)) {
            const identity = `${stack.name}-${name}-worker`;
            const account = new serviceaccount.Account(
              identity,
              { accountId: identity },
              { dependsOn: service, protect: false, provider },
            );
            for (const [suffix, principal] of [
              ["", member],
              ["-crema", cremaMember],
            ] as const) {
              new serviceaccount.IAMMember(
                `${identity}${suffix}`,
                { member: principal, role: "roles/iam.serviceAccountUser", serviceAccountId: account.name },
                { protect: false, provider },
              );
            }
          }
          for (const [name, role] of [
            ["artifact-registry", "roles/artifactregistry.editor"],
            ["compute-network", "roles/compute.networkAdmin"],
            ["run", "roles/run.developer"],
            ["service-usage", "roles/serviceusage.serviceUsageAdmin"],
          ] as const) {
            new projects.IAMMember(`${stack.name}-${name}`, { member, project, role }, { provider });
          }
          new projects.IAMMember(
            `${stack.name}-signers`,
            {
              condition: {
                expression: `resource.type == "cloudkms.googleapis.com/CryptoKey" && resource.name.extract("/keyRings/{keyRing}/") == "${stack.name}-signers"`,
                title: `${stack.name} signers`,
              },
              member,
              project,
              role: signerAccess.name,
            },
            { provider },
          );
          new projects.IAMMember(
            `${stack.name}-secrets`,
            {
              condition: {
                expression: `resource.type != "secretmanager.googleapis.com/Secret" || resource.name.extract("/secrets/{secret}").startsWith("${stack.name}-")`,
                title: `${stack.name} secrets`,
              },
              member,
              project,
              role: secretAccess.name,
            },
            { provider },
          );
          new projects.IAMMember(
            `${stack.name}-deployment`,
            {
              condition: {
                expression: `resource.type == "cloud.googleapis.com/Location" || resource.name == "projects/${project}/locations/global/parameters/${stack.name}-crema" || resource.name.startsWith("projects/${project}/locations/global/parameters/${stack.name}-crema/versions/")`,
                title: `${stack.name} deployment`,
              },
              member,
              project,
              role: deployment.name,
            },
            { provider },
          );
          new projects.IAMMember(`${stack.name}-parameters`, { member, project, role: parameters.name }, { provider });
          new projects.IAMMember(`${stack.name}-services`, { member, project, role: services.name }, { provider });
          new projects.IAMMember(
            `${stack.name}-worker-pools`,
            { member, project, role: workerPools.name },
            { provider },
          );
          new storage.BucketIAMMember(
            `${stack.name}-state`,
            {
              bucket: stateBucket.name,
              condition: {
                expression: `resource.name.startsWith("projects/_/buckets/exa-pulumi-state/objects/${stack.name}/")`,
                title: `${stack.name} state`,
              },
              member,
              role: objects.name,
            },
            { provider: stateProvider },
          );
          new storage.BucketIAMMember(
            `${stack.name}-list`,
            { bucket: stateBucket.name, member, role: list.name },
            { provider: stateProvider },
          );
          const previewer = new serviceaccount.Account(
            `${stack.name}-preview`,
            { accountId: `preview-${stack.name}` },
            { dependsOn: service, provider },
          );
          const previewMember = interpolate`serviceAccount:${previewer.email}`;
          new serviceaccount.IAMMember(
            `${stack.name}-preview`,
            {
              member: interpolate`principalSet://iam.googleapis.com/${previewPool.name}/*`,
              role: "roles/iam.workloadIdentityUser",
              serviceAccountId: previewer.name,
            },
            { provider },
          );
          new projects.IAMMember(
            `${stack.name}-preview`,
            { member: previewMember, project, role: preview.name },
            { provider },
          );
          new storage.BucketIAMMember(
            `${stack.name}-preview-state`,
            {
              bucket: stateBucket.name,
              condition: {
                expression: `resource.name.startsWith("projects/_/buckets/exa-pulumi-state/objects/${stack.name}/") || resource.name.startsWith("projects/_/buckets/exa-pulumi-state/objects/meta/")`,
                title: `${stack.name} preview state`,
              },
              member: previewMember,
              role: read.name,
            },
            { provider: stateProvider },
          );
          new storage.BucketIAMMember(
            `${stack.name}-preview-list`,
            { bucket: stateBucket.name, member: previewMember, role: list.name },
            { provider: stateProvider },
          );
        }
      }
      return Promise.resolve({ preview: previewFederation.name, provider: federation.name });
    },
  },
  {
    envVars: { PULUMI_BACKEND_URL: "gs://exa-pulumi-state/meta", PULUMI_CONFIG_PASSPHRASE: "" },
    workDir: import.meta.dirname,
  },
);
const owners = stacks.map(({ name }) => name).toSorted((a, b) => b.length - a.length);
const state = await selected.exportStack();
const { resources } = parse(object({ resources: optional(array(object({ urn: string() })), []) }), state.deployment);
try {
  await selected[argv[2]]({
    exclude: resources
      .map(({ urn }) => urn)
      .filter((urn) => {
        const name = urn.slice(urn.lastIndexOf("::") + 2);
        const owner = owners.find((stack) => name === stack || name.startsWith(`${stack}-`));
        return owner !== undefined && owner !== target.name;
      }),
    ...(argv[4] === "--json"
      ? { onEvent: (event: automation.EngineEvent) => stdout.write(`${JSON.stringify(event)}\n`) }
      : { onOutput: (output: string) => stdout.write(output) }),
  });
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : error); // eslint-disable-line no-console
  process.exitCode = 1;
}
