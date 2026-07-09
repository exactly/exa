import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

import stack from "@exactly/common/stack";

const client = new SecretManagerServiceClient();

export default async function secret(name: string) {
  const [version] = await client.accessSecretVersion({
    name: `projects/${await client.getProjectId()}/secrets/${stack}-${name}/versions/latest`,
  });
  const data = version.payload?.data;
  if (!data) throw new Error(`missing secret ${name}`);
  return Buffer.from(data).toString("utf8");
}
