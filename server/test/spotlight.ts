import { $, ExecaError } from "execa";
import { mkdir, rm } from "node:fs/promises";

const cwd = "node_modules/@exactly/.spotlight";

export default async function setup() {
  await rm(cwd, { recursive: true, force: true });
  await mkdir(cwd, { recursive: true });
  const subprocess = $({ cwd, env: { SPOTLIGHT_CAPTURE: "1" }, forceKillAfterDelay: 33_333 })`spotlight`;

  return async function teardown() {
    const killed = subprocess.kill();
    await subprocess.catch((error: unknown) => {
      if (
        killed &&
        error instanceof ExecaError &&
        (error.isCanceled || error.isTerminated || error.signal === "SIGKILL" || error.signal === "SIGTERM")
      ) {
        return;
      }
      throw error;
    });
  };
}
