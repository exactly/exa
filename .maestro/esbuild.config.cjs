/** @satisfies {import("esbuild").BuildOptions} */
module.exports = {
  bundle: true,
  outdir: "dist",
  target: "node12",
  platform: "neutral",
  external: ["isows"],
  mainFields: ["module", "main"],
  inject: ["src/polyfill.ts"],
};
