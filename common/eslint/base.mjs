import js from "@eslint/js";
// @ts-expect-error -- missing types
import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import nx from "@nx/eslint-plugin";
// import vitest from "@vitest/eslint-plugin";
import { defineConfig, globalIgnores } from "eslint/config";
// import universe from "eslint-config-universe/flat/default.js";
import { flatConfigs as importPlugin } from "eslint-plugin-import";
// import node from "eslint-plugin-n";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import ts from "typescript-eslint";

export default defineConfig([
  globalIgnores(["**/build/", "**/cache/", "**/coverage/", "**/dist/", "**/generated/", "**/out/"]),
  comments.recommended, // eslint-disable-line @typescript-eslint/no-unsafe-member-access
  js.configs.recommended,
  ts.configs.strictTypeChecked, // eslint-disable-line import/no-named-as-default-member
  ts.configs.stylisticTypeChecked, // eslint-disable-line import/no-named-as-default-member
  importPlugin.recommended,
  importPlugin.typescript,
  unicorn.configs.recommended,
  nx.configs["flat/base"],
  nx.configs["flat/javascript"],
  nx.configs["flat/typescript"],
  {
    languageOptions: { globals: globals.builtin, parserOptions: { project: ["tsconfig.json"] } },
    settings: { "import/resolver": { typescript: true } },
    linterOptions: { reportUnusedDisableDirectives: "error", reportUnusedInlineConfigs: "error" },
    rules: {
      "@eslint-community/eslint-comments/no-unused-disable": "error",
      "@nx/dependency-checks": "error",
      "@nx/enforce-module-boundaries": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/no-redeclare": "off", // checked by typescript
      "@typescript-eslint/no-shadow": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "import/prefer-default-export": "error",
      "no-console": "warn",
      "no-shadow": "off", // @typescript-eslint/no-shadow
      "unicorn/filename-case": "off", // use default export name
      "unicorn/no-array-reduce": "off",
      "unicorn/no-nested-ternary": "off", // no expression alternatives
      "unicorn/no-null": "off", // part of multiple apis
      "unicorn/no-useless-undefined": ["error", { checkArrowFunctionBody: false }], // @typescript-eslint/no-empty-function
      "unicorn/number-literal-case": "off", // incompatible with prettier
      "unicorn/prevent-abbreviations": ["error", { allowList: { args: true, e2e: true, params: true, utils: true } }],
      "unicorn/switch-case-braces": ["error", "avoid"], // consistently avoid braces
    },
  },
  {
    files: ["**/*.js", "**/*.cjs"],
    languageOptions: { globals: { ...globals.commonjs, process: globals.node.process } },
    rules: { "@typescript-eslint/no-require-imports": "off", "unicorn/prefer-module": "off" },
  },
]);
