import baseConfig from "@exactly/common/eslint/base.mjs";
import { defineConfig } from "eslint/config";
// @ts-expect-error missing types
import universe from "eslint-config-universe/flat/default.js";

export default defineConfig([
  universe,
  baseConfig,
  {
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
    },
  },
]);
