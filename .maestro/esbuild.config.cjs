const path = require("node:path");

/** @satisfies {import("esbuild").BuildOptions} */
module.exports = {
  bundle: true,
  platform: "neutral",
  external: ["isows"],
  mainFields: ["module", "main"],
  outdir: path.join(__dirname, "dist"),
  inject: [path.join(__dirname, "src/polyfill.ts")],
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
