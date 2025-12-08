import { spawn } from "node:child_process";
import { watch } from "node:fs";

const vitest = spawn("vitest", ["--watch"], {
  stdio: ["ignore", "inherit", "inherit"],
  env: { ...process.env, NODE_ENV: "e2e" },
  detached: true,
});

function stop() {
  fetch("http://localhost:3000/e2e/shutdown", { method: "POST" }).catch(() => null);
  const timeout = setTimeout(() => vitest.kill(), 5000);
  const watcher = watch("coverage", (_, filename) => {
    if (filename === "lcov.info") {
      clearTimeout(timeout);
      watcher.close();
      vitest.kill();
    }
  });
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
vitest.on("exit", (code) => process.exit(code === 143 || !code ? 0 : code)); // eslint-disable-line n/no-process-exit, unicorn/no-process-exit
