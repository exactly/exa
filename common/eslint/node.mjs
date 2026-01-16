import vitest from "@vitest/eslint-plugin";
import node from "eslint-plugin-n";
import security from "eslint-plugin-security";
import { defineConfig } from "eslint/config";

export default defineConfig([
  node.configs["flat/recommended"],
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
