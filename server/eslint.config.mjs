import { fixupPluginRules } from "@eslint/compat";
import baseConfig from "@exactly/common/eslint/base.mjs";
import nodeConfig from "@exactly/common/eslint/node.mjs";
import { defineConfig } from "eslint/config";
// @ts-expect-error missing types
import universe from "eslint-config-universe/flat/node.js";
// @ts-expect-error missing types
import * as drizzle from "eslint-plugin-drizzle";

export default defineConfig([
  universe,
  baseConfig,
  nodeConfig,
  {
    languageOptions: { parserOptions: { projectService: true } },
    plugins: { drizzle: fixupPluginRules(drizzle) }, // eslint-disable-line @typescript-eslint/no-unsafe-argument -- missing types
    rules: {
      "n/no-missing-import": "off", // handled by bundler
      "unicorn/prefer-top-level-await": "off", // unsupported in cjs
    },
  },
]);
