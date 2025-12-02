/** @type {import('svgo').Config} */
export default {
  plugins: [
    {
      name: "preset-default",
      params: { overrides: { removeViewBox: false } },
    },
    "removeDimensions",
  ],
};
