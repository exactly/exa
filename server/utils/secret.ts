import stack from "@exactly/common/stack";

import type { SecretManagerServiceClient } from "@google-cloud/secret-manager";

export default async function secret(name: string, secrets: SecretManagerServiceClient) {
  const [version] = await secrets.accessSecretVersion({
    name: `projects/${await secrets.getProjectId()}/secrets/${stack}-${name}/versions/latest`,
  });
  const data = version.payload?.data;
  if (!data) throw new Error(`missing secret ${name}`);
  return Buffer.from(data).toString("utf8");
}
