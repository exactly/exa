import tanstackQuery from "@tanstack/eslint-plugin-query";
import { defineConfig } from "eslint/config";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default defineConfig(
  tanstackQuery.configs["flat/recommended"],
  reactHooks.configs.flat["recommended-latest"],
  // @ts-expect-error -- bad types
  react.configs.flat.recommended,
  jsxA11y.flatConfigs.recommended,
);
