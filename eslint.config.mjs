import baseConfig from "@exactly/common/eslint/base.mjs";
import reactConfig from "@exactly/common/eslint/react.mjs";
import { defineConfig, globalIgnores } from "eslint/config";
import universe from "eslint-config-universe/flat/native.js";

export default defineConfig([
  globalIgnores(["*/", "!src/", "expo-env.d.ts"]),
  universe,
  baseConfig,
  reactConfig,
  {
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      "unicorn/prefer-global-this": "off", // incompatible with react-native
      "unicorn/prefer-top-level-await": "off", // unsupported in cjs
    },
  },
]);
