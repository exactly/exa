const path = require("node:path");

/** @satisfies {import("esbuild").BuildOptions} */
module.exports = {
  bundle: true,
  outdir: "dist",
  platform: "neutral",
  external: ["isows"],
  mainFields: ["module", "main"],
  inject: ["src/polyfill.ts"],
  absWorkingDir: __dirname,
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
