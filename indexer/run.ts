import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { spawn } from "node:child_process";
import { argv, env, exit } from "node:process";

import stack from "@exactly/common/stack.js";

const [command, ...args] = argv.slice(2);
if (!command) throw new Error("usage: node run.ts <command> [...args]");

const url = env.INDEXER_INSTANCE ? undefined : await secret();

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => undefined);
spawn(command, args, { stdio: "inherit", env: url ? { ...env, POSTGRES_URL: url } : env }).on("exit", (code) =>
  exit(code ?? 1),
);

async function secret() {
  const secrets = new SecretManagerServiceClient();
  const [version] = await secrets.accessSecretVersion({
    name: `projects/${await secrets.getProjectId()}/secrets/${stack}-indexer-postgres-url/versions/latest`,
  });
  await secrets.close();
  const data = version.payload?.data;
  if (!data) throw new Error("missing secret indexer-postgres-url");
  return Buffer.from(data).toString("utf8");
}
