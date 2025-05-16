import type { UserConfig } from "vite";
import dts from "vite-plugin-dts";

import { name } from "./package.json";

export default {
  plugins: [dts({ rollupTypes: true, bundledPackages: ["@exactly/server"] })],
  build: {
    lib: { name, entry: "src/index.ts" },
    minify: false,
    sourcemap: true,
    emptyOutDir: true,
  },
} satisfies UserConfig;
