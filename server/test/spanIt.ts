import { startSpan } from "@sentry/node";
import { test, type RunnerTaskBase } from "vitest";

export default test.extend({
  span: [
    async ({ task }, use) => startSpan({ name: getPath(task).join(" > "), op: "test.test" }, (span) => use(span)),
    { auto: true },
  ],
});

function getPath({ name, suite }: RunnerTaskBase): string[] {
  return suite ? [...getPath(suite), name] : [name];
}
