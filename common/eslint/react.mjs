import eslintReact from "@eslint-react/eslint-plugin";
import tanstackQuery from "@tanstack/eslint-plugin-query";
import { defineConfig } from "eslint/config";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";

export default defineConfig([
  // @ts-expect-error -- bad types
  react.configs.flat.recommended,
  jsxA11y.flatConfigs.recommended,
  eslintReact.configs["strict-type-checked"],
  tanstackQuery.configs["flat/recommended"],
]);
