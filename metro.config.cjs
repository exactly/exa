const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const path = require("node:path");

const config = getSentryExpoConfig(__dirname, { annotateReactComponents: true });

/** @type {import('metro-config').InputConfigT} */
module.exports = {
  ...config,
  resolver: {
    ...config.resolver,
    extraNodeModules: { crypto: require.resolve("react-native-quick-crypto") },
    assetExts: config.resolver?.assetExts?.filter((extension) => extension !== "svg"),
    sourceExts: [...(config.resolver?.sourceExts ?? []), "svg"],
    blockList: [
      ...((config.resolver?.blockList &&
        (Array.isArray(config.resolver.blockList) ? config.resolver.blockList : [config.resolver.blockList])) ??
        []),
      new RegExp(path.join(__dirname, String.raw`\.\w+/`)),
      new RegExp(path.join(__dirname, "android/")),
      new RegExp(path.join(__dirname, "contracts/")),
      new RegExp(path.join(__dirname, "build/")),
      new RegExp(path.join(__dirname, "dist/")),
      new RegExp(path.join(__dirname, "ios/")),
      new RegExp(path.join(__dirname, "public/")),
      new RegExp(path.join(__dirname, "server/")),
    ],
  },
  transformer: {
    ...config.transformer,
    babelTransformerPath: require.resolve("react-native-svg-transformer/expo"),
  },
};
