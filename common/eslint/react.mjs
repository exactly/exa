import eslintReact from "@eslint-react/eslint-plugin";
import tanstackQuery from "@tanstack/eslint-plugin-query";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import { defineConfig } from "eslint/config";

export default defineConfig([
  // @ts-expect-error -- bad types
  react.configs.flat.recommended,
  jsxA11y.flatConfigs.recommended,
  eslintReact.configs["strict-type-checked"],
  tanstackQuery.configs["flat/recommended"],
]);
