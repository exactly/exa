import { defineConfig } from "eslint/config";
// @ts-expect-error missing types
import universe from "eslint-config-universe/flat/node.js";

import baseConfig from "@exactly/common/eslint/base.mjs";
import nodeConfig from "@exactly/common/eslint/node.mjs";

export default defineConfig([
  universe,
  baseConfig,
  nodeConfig,
  {
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      "no-new": "off",
    },
  },
]);
