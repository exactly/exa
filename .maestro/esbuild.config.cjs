const path = require("node:path");

/** @satisfies {import("esbuild").BuildOptions} */
module.exports = {
  bundle: true,
  outdir: ".maestro/dist",
  platform: "neutral",
  external: ["isows"],
  mainFields: ["module", "main"],
  inject: [".maestro/src/polyfill.ts"],
  plugins: [
    {
      name: "fix-tsconfig",
      /** @param {import("esbuild").PluginBuild} build */
      setup(build) {
        build.initialOptions.tsconfig = path.join(__dirname, "tsconfig.json");
      },
    },
  ],
};
