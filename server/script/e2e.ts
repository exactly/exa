import { spawn } from "node:child_process";

const vitest = spawn(
  "node",
  [
    "-e",
    `
const { spawn } = require("node:child_process");

process.on("uncaughtException", () => null);
process.stdout.on("error", () => null);
process.stderr.on("error", () => null);

const v = spawn("vitest", ["--watch"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FORCE_COLOR: "1" } });

v.stdout.pipe(process.stdout);
v.stderr.pipe(process.stderr);
v.on("exit", (code) => process.exit(code));

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  fetch("http://localhost:3000/e2e/shutdown", { method: "POST", headers: { Connection: "close" } }).catch(() => null);
  setTimeout(() => v.kill(), 15_000);
}

process.stdin.resume();
process.stdin.on("end", stop);
process.on("SIGHUP", stop);
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
`,
  ],
  { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "e2e" }, detached: true },
);

vitest.unref();
vitest.stdout.pipe(process.stdout);
vitest.stderr.pipe(process.stderr);

process.on("SIGINT", () => vitest.kill());
process.on("SIGTERM", () => vitest.kill());
vitest.on("exit", (code) => process.exit(code === 143 || !code ? 0 : code)); // eslint-disable-line n/no-process-exit, unicorn/no-process-exit
