/** @type {import('@babel/core').ConfigFunction} */
module.exports = function config(api) {
  /** @type {(ever: boolean) => void} */ (/** @type {unknown} */ (api.cache))(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      [
        "module-resolver",
        {
          alias: {
            "@farcaster/quick-auth/decodeJwt": "@farcaster/quick-auth/dist/decodeJwt",
            "@farcaster/quick-auth/light": "@farcaster/quick-auth/dist/lightClient",
            "@reown/appkit(-controllers|-scaffold-ui|-ui|-wallet)?(/[\\w-]+)?$": String.raw`@reown/appkit\1/dist/esm/exports\2`,
            "@phosphor-icons/webcomponents/(\\w+)$": String.raw`@phosphor-icons/webcomponents/dist/icons/\1.mjs`, // cspell:ignore webcomponents
            "@wagmi/core/codegen": "@wagmi/core/dist/esm/exports/codegen",
            "hono/client": "hono/dist/client",
            "jose/jwt/decode": "jose/dist/browser/util/decode_jwt",
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
