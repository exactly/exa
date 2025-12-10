/** @satisfies {import("esbuild").BuildOptions} */
module.exports = {
  bundle: true,
  outdir: "dist",
  platform: "neutral",
  external: ["isows"],
  mainFields: ["module", "main"],
  inject: ["src/polyfill.ts"],
};
