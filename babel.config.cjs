/** @type {import('@babel/core').ConfigFunction} */
module.exports = function config(api) {
  /** @type {(ever: boolean) => void} */ (/** @type {unknown} */ (api.cache))(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    plugins: [
      ...(process.env.EXPO_PUBLIC_ENV === "e2e" ? ["istanbul"] : []),
      [
        "@tamagui/babel-plugin",
        {
          config: "tamagui.config.ts",
          components: ["tamagui"],
          disableExtraction: process.env.NODE_ENV !== "production",
          logTimings: true,
        },
      ],
      "react-native-reanimated/plugin",
    ],
  };
};
