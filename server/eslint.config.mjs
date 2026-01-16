import { fixupPluginRules } from "@eslint/compat";
import { defineConfig } from "eslint/config";
// @ts-expect-error missing types
import universe from "eslint-config-universe/flat/node.js";
// @ts-expect-error missing types
import * as drizzle from "eslint-plugin-drizzle";

import baseConfig from "@exactly/common/eslint/base.mjs";
import nodeConfig from "@exactly/common/eslint/node.mjs";

export default defineConfig([
  universe,
  baseConfig,
  nodeConfig,
  {
    languageOptions: { parserOptions: { projectService: true } },
    plugins: { drizzle: fixupPluginRules(drizzle) }, // eslint-disable-line @typescript-eslint/no-unsafe-argument -- missing types
    rules: {
      "drizzle/enforce-delete-with-where": ["error", { drizzleObjectName: "database" }],
      "drizzle/enforce-update-with-where": ["error", { drizzleObjectName: "database" }],
      "n/no-missing-import": "off", // handled by bundler
      "unicorn/prefer-top-level-await": "off", // unsupported in cjs
    },
  },
  {
    files: ["api/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "hono/utils/http-status",
              importNames: ["UnofficialStatusCode"],
              message: "It breaks client types because its type is -1.",
            },
          ],
        },
      ],
    },
  },
]);
