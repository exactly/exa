import path from "node:path";

/** @type {import('@svgr/core').Config} */
export default {
  svgoConfig: {
    plugins: [
      { name: "preset-default" },
      {
        name: "prefixIds",
        params: {
          prefix: (_, info) => {
            if (info.path) return path.basename(info.path, ".svg");
            return "";
          },
        },
      },
    ],
  },
};
