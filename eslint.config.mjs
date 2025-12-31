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
    languageOptions: { parserOptions: { projectService: { allowDefaultProject: ["*.config.{ts,js,cjs,mjs}"] } } },
    rules: {
      "@nx/enforce-module-boundaries": ["error", { allow: ["@exactly/server/api/*"] }],
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "wagmi", importNames: ["useAccount"], message: "Use `useAccount` from utils." }] },
      ],
      "unicorn/no-array-sort": "off", // unsupported in react-native
      "unicorn/prefer-global-this": "off", // unsupported in react-native
      "unicorn/prefer-top-level-await": "off", // unsupported in react-native
    },
  },
]);
