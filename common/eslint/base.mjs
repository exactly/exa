import js from "@eslint/js";
import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import nx from "@nx/eslint-plugin";
import { defineConfig, globalIgnores } from "eslint/config";
import { flatConfigs as importPlugin } from "eslint-plugin-import";
import jsdoc from "eslint-plugin-jsdoc";
import perfectionist from "eslint-plugin-perfectionist";
import { Alphabet } from "eslint-plugin-perfectionist/alphabet";
import prettier from "eslint-plugin-prettier/recommended";
import { configs as regexp } from "eslint-plugin-regexp";
import tsdoc from "eslint-plugin-tsdoc";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import { configs as ts } from "typescript-eslint";

export default defineConfig([
  globalIgnores(["**/build/", "**/cache/", "**/coverage/", "**/dist/", "**/generated/", "**/out/"]),
  js.configs.recommended,
  ts.strictTypeChecked,
  ts.stylisticTypeChecked,
  importPlugin.recommended,
  importPlugin.typescript,
  unicorn.configs.recommended,
  nx.configs["flat/base"],
  // @ts-expect-error bad config types
  nx.configs["flat/javascript"],
  // @ts-expect-error bad config types
  nx.configs["flat/typescript"],
  regexp["flat/recommended"],
  comments.recommended,
  { ...prettier, plugins: {} }, // prettier should be included by universe
  {
    languageOptions: { globals: globals.builtin },
    settings: { "import/resolver": { typescript: true } },
    linterOptions: { reportUnusedDisableDirectives: "error", reportUnusedInlineConfigs: "error" },
    rules: {
      "@eslint-community/eslint-comments/no-unused-disable": "error",
      "@nx/dependency-checks": "error",
      "@nx/enforce-module-boundaries": "error",
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/no-redeclare": "off", // checked by typescript
      "@typescript-eslint/no-shadow": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "exa/prefer-string": "error",
      "import/order": "off", // handled by perfectionist
      "import/prefer-default-export": "error",
      "no-console": "warn",
      "perfectionist/sort-imports": [
        "error",
        {
          type: "custom",
          alphabet: Alphabet.generateRecommendedAlphabet()
            .sortByNaturalSort()
            .placeCharacterBefore({ characterBefore: "/", characterAfter: "-" })
            .getCharacters(),
          newlinesBetween: 1,
          groups: [
            "side-effect",
            "mocks",
            "react",
            "expo",
            "tamagui",
            ["builtin", "external"],
            "internal",
            ["parent", "sibling", "index"],
            "type",
          ],
          customGroups: [
            { groupName: "mocks", elementNamePattern: String.raw`.*(/mocks/|\bmock\b).*` },
            { groupName: "react", elementNamePattern: "^react(-.*)?$|^@react(-.*)?/.*" },
            { groupName: "expo", elementNamePattern: "^expo(-.*)?$|^@expo/.*" },
            { groupName: "tamagui", elementNamePattern: "^tamagui$|^@tamagui/.*" },
          ],
          internalPattern: ["^@exactly/.*"],
        },
      ],
      "perfectionist/sort-named-imports": ["error", { type: "natural", groups: ["import", "type-import"] }],
      "perfectionist/sort-named-exports": ["error", { type: "natural", groups: ["export", "type-export"] }],
      "perfectionist/sort-interfaces": ["error", { type: "natural", partitionByNewLine: true }],
      "perfectionist/sort-object-types": ["error", { type: "natural", partitionByNewLine: true }],
      "perfectionist/sort-union-types": ["error", { type: "natural" }],
      "perfectionist/sort-intersection-types": ["error", { type: "natural" }],
      "perfectionist/sort-enums": ["error", { type: "natural", partitionByNewLine: true }],
      "no-shadow": "off", // @typescript-eslint/no-shadow
      "unicorn/filename-case": "off", // use default export name
      "unicorn/no-array-reduce": "off",
      "unicorn/no-nested-ternary": "off", // no expression alternatives
      "unicorn/no-null": "off", // part of multiple apis
      "unicorn/no-useless-undefined": ["error", { checkArrowFunctionBody: false }], // @typescript-eslint/no-empty-function
      "unicorn/number-literal-case": "off", // incompatible with prettier
      "unicorn/prevent-abbreviations": [
        "error",
        { allowList: { args: true, db: true, e2e: true, params: true, Ref: true, ref: true, utils: true } },
      ],
      "unicorn/switch-case-braces": ["error", "avoid"], // consistently avoid braces
    },
    plugins: {
      perfectionist,
      exa: {
        rules: {
          "prefer-string": {
            meta: { type: "suggestion", docs: { description: "`String(x)` over `x.toString()`" }, fixable: "code" },
            create: (context) => ({
              CallExpression(node) {
                if (node.callee.type !== "MemberExpression" || node.callee.property.name !== "toString") return; // eslint-disable-line @typescript-eslint/no-unsafe-member-access
                if (node.callee.optional || node.callee.computed || node.arguments.length > 0) return; // eslint-disable-line @typescript-eslint/no-unsafe-member-access
                context.report({
                  node,
                  message: "Use `String(value)` instead of `value.toString()`.",
                  fix: (fixer) =>
                    // @ts-expect-error -- bad types
                    fixer.replaceText(node, `String(${context.sourceCode.getText(node.callee.object)})`), // eslint-disable-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
                });
              },
            }),
          },
        },
      },
    },
  },
  {
    files: ["**/*.js", "**/*.cjs"],
    languageOptions: { globals: { ...globals.commonjs, process: globals.node.process } },
    rules: { "@typescript-eslint/no-require-imports": "off", "unicorn/prefer-module": "off" },
  },
  {
    files: ["**/*.js", "**/*.cjs", "**/*.mjs", "**/*.jsx"],
    ...jsdoc.configs["flat/recommended"],
    rules: {
      ...jsdoc.configs["flat/recommended"].rules,
      "jsdoc/require-param-description": "off",
      "jsdoc/require-returns": "off",
    },
  },
  // @ts-expect-error bad config types
  { files: ["**/*.ts", "**/*.cts", "**/*.mts", "**/*.tsx"], plugins: { tsdoc }, rules: { "tsdoc/syntax": "error" } },
]);
