import { defineConfig } from "eslint/config";
// @ts-expect-error missing types
import universe from "eslint-config-universe/flat/default.js";

import baseConfig from "./eslint/base.mjs";

export default defineConfig([universe, baseConfig, { languageOptions: { parserOptions: { projectService: true } } }]);
