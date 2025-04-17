import type { RunnerTaskBase, RunnerTestSuite } from "vitest";

export default function taskName(task: RunnerTaskBase): string {
  return [...suitePath(task.suite), task.name].join(" > ");
}

function suitePath(suite?: RunnerTestSuite): string[] {
  return suite
    ? [
        ...(suite.suite ? suitePath(suite.suite) : [suite.file.name.replace(/^test\/(.+)\.test\.ts$/, "$1")]),
        suite.name,
      ]
    : [];
}
