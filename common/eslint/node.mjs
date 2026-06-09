import vitest from "@vitest/eslint-plugin";
import { defineConfig } from "eslint/config";
import node from "eslint-plugin-n";
import security from "eslint-plugin-security";

export default defineConfig([
  {
    name: node.configs["flat/recommended"].name,
    languageOptions: node.configs["flat/recommended"].languageOptions,
    rules: node.configs["flat/recommended"].rules,
  },
  // @ts-expect-error -- bad types
  security.configs.recommended,
  { rules: { "security/detect-object-injection": "off" } },
  {
    files: ["test/**"],
    plugins: { vitest },
    settings: { vitest: { typecheck: true } },
    languageOptions: { globals: vitest.environments.env.globals },
    rules: { ...vitest.configs.recommended.rules },
  },
]);
