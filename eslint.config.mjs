import baseConfig from "@exactly/common/eslint/base.mjs";
import reactConfig from "@exactly/common/eslint/react.mjs";
import { defineConfig, globalIgnores } from "eslint/config";
import universe from "eslint-config-universe/flat/native.js";

export default defineConfig(
  globalIgnores(["**/*"]),
  universe, // eslint-disable-line @typescript-eslint/no-unsafe-argument
  baseConfig,
  reactConfig,
  {
    languageOptions: { parserOptions: { project: ["tsconfig.json", "tsconfig.node.json"] } },
    rules: {},
  },
);
