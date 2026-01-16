import { defineConfig, globalIgnores } from "eslint/config";
// @ts-expect-error missing types
import universe from "eslint-config-universe/flat/node.js";
import { configs as astro } from "eslint-plugin-astro";

import baseConfig from "@exactly/common/eslint/base.mjs";
import nodeConfig from "@exactly/common/eslint/node.mjs";

export default defineConfig([
  globalIgnores(["**/.astro/"]),
  universe,
  baseConfig,
  nodeConfig,
  astro.recommended,
  {
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      "import/no-unresolved": ["error", { ignore: ["astro:*"] }],
      "n/no-missing-import": "off", // handled by bundler
    },
  },
]);
