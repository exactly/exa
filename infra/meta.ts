import { iam, orgpolicy, projects, Provider, secretmanager, serviceaccount, storage } from "@pulumi/gcp";
import { automation, interpolate, runtime } from "@pulumi/pulumi";
import { readdir } from "node:fs/promises";

import rejectSecrets from "./utils/rejectSecrets.ts";
import secrets from "./utils/secrets.ts";

const workers = ["refund"] as const;

if (process.argv[2] !== "preview" && process.argv[2] !== "up") throw new Error("expected preview or up");

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
      const project: unknown = settings.config?.["gcp:project"];
      if (typeof project !== "string" || project.length === 0) throw new Error(`missing gcp:project in ${name}`);
      return { name, project };
    }),
);
const selected = await automation.LocalWorkspace.selectStack(
  {
    projectName: "exa",
    stackName: "meta",
    program() {
      runtime.registerStackTransformation(({ opts, props }) => ({ opts: { ...opts, protect: true }, props }));
      const stateProvider = new Provider("state", { project: "eexxxaa" });
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
          attributeCondition: `assertion.job_workflow_ref.startsWith('exactly/exa/.github/workflows/server-deploy.yaml@') && assertion.repository_id == '715321557' && assertion.repository_owner_id == '83888950'`,
          attributeMapping: { "attribute.environment": "assertion.environment", "google.subject": "assertion.sub" },
          oidc: { issuerUri: "https://token.actions.githubusercontent.com" },
          workloadIdentityPoolId: pool.workloadIdentityPoolId,
          workloadIdentityPoolProviderId: "github",
        },
        { dependsOn: stateServices, provider: stateProvider },
      );
      for (const [project, projectStacks] of Map.groupBy(stacks, (stack) => stack.project)) {
        const provider = new Provider(project, { project });
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
        for (const stack of projectStacks) {
          for (const secret of secrets) {
            new secretmanager.Secret(
              `${stack.name}-${secret}`,
              { secretId: `${stack.name}-${secret}`, replication: { auto: {} } },
              { dependsOn: secretManager, provider },
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
          for (const name of workers) {
            const identity = `${stack.name}-${name}`;
            const account = new serviceaccount.Account(
              identity,
              { accountId: identity },
              { dependsOn: service, provider },
            );
            for (const [suffix, principal] of [
              ["", member],
              ["-crema", cremaMember],
            ] as const) {
              new serviceaccount.IAMMember(
                `${identity}${suffix}`,
                { member: principal, role: "roles/iam.serviceAccountUser", serviceAccountId: account.name },
                { provider },
              );
            }
          }
          for (const [name, role] of [
            ["artifact-registry", "roles/artifactregistry.editor"],
            ["run", "roles/run.developer"],
            ["service-usage", "roles/serviceusage.serviceUsageAdmin"],
          ] as const) {
            new projects.IAMMember(`${stack.name}-${name}`, { member, project, role }, { provider });
          }
          new projects.IAMMember(
            `${stack.name}-kms`,
            {
              condition: {
                expression: `resource.type == "cloud.googleapis.com/Location" || resource.name.endsWith("/keyRings/${stack.name}-signers") || resource.name.extract("/keyRings/{keyRing}/") == "${stack.name}-signers"`,
                title: `${stack.name} signers`,
              },
              member,
              project,
              role: "roles/cloudkms.admin",
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
        }
      }
      return Promise.resolve({ provider: federation.name });
    },
  },
  {
    envVars: { PULUMI_BACKEND_URL: "gs://exa-pulumi-state/meta", PULUMI_CONFIG_PASSPHRASE: "" },
    workDir: import.meta.dirname,
  },
);
try {
  await selected[process.argv[2]]({ onOutput: (output) => process.stdout.write(output) });
} catch (error) {
  console.error(error); // eslint-disable-line no-console
  process.exitCode = 1;
}
