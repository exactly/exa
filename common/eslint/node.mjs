import vitest from "@vitest/eslint-plugin";
import { defineConfig } from "eslint/config";
import node from "eslint-plugin-n";

export default defineConfig([
  node.configs["flat/recommended"],
  { files: ["test/**"], plugins: { vitest }, rules: { ...vitest.configs.recommended.rules } },
]);
