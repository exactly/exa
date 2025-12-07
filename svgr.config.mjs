import path from "node:path";

import svgoConfig from "./svgo.config.mjs";

/** @satisfies {import('@svgr/core').Config} */
export default {
  svgoConfig: {
    ...svgoConfig,
    plugins: [
      ...svgoConfig.plugins,
      {
        name: "prefixIds",
        params: {
          /**
           * @param {unknown} _
           * @param {import('svgo').Config} config
           */
          prefix(_, config) {
            if (config.path) return path.basename(config.path, ".svg");
            return "";
          },
        },
      },
    ],
  },
};
