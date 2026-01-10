/** @type {import('@babel/core').ConfigFunction} */
module.exports = function config(api) {
  /** @type {(ever: boolean) => void} */ (/** @type {unknown} */ (api.cache))(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    plugins: [
      ...(process.env.EXPO_PUBLIC_ENV === "e2e" ? ["istanbul"] : []),
      [
        "module-resolver",
        {
          alias: {
            "@farcaster/quick-auth/decodeJwt": "@farcaster/quick-auth/dist/decodeJwt",
            "@farcaster/quick-auth/light": "@farcaster/quick-auth/dist/lightClient",
            "@wagmi/core/codegen": "@wagmi/core/dist/esm/exports/codegen",
            "hono/client": "hono/dist/client",
            "jose/jwt/decode": "jose/dist/browser/util/decode_jwt",
            "^jose$": "jose/dist/browser/index.js",
            "^zustand$": "zustand/index.js",
            "zustand/middleware": "zustand/middleware.js",
            "zustand/vanilla": "zustand/vanilla.js",
            "zustand/shallow": "zustand/shallow.js",
            "zustand/traditional": "zustand/traditional.js",
          },
        },
      ],
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
