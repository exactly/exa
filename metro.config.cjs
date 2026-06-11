const { getExpoTransformer, getReactNativeTransformer } = require("react-native-svg-transformer");
const reactNativeSvgTransformer = require("react-native-svg-transformer/expo");

const path = require("node:path");

const rawTransformer = getExpoTransformer() ?? getReactNativeTransformer();
const themeable = /\b(fill|stroke)="#([0-9a-f]{6})"/g;

module.exports = function config() {
  const { getSentryExpoConfig } = require("@sentry/react-native/metro");
  const base = getSentryExpoConfig(__dirname, { annotateReactComponents: true });
  /** @type {import('metro-config').InputConfigT} */
  const merged = {
    ...base,
    resolver: {
      ...base.resolver,
      extraNodeModules: { crypto: require.resolve("react-native-quick-crypto") },
      assetExts: base.resolver?.assetExts?.filter((extension) => extension !== "svg"),
      sourceExts: [...(base.resolver?.sourceExts ?? []), "svg"],
      blockList: [
        ...((base.resolver?.blockList &&
          (Array.isArray(base.resolver.blockList) ? base.resolver.blockList : [base.resolver.blockList])) ??
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
      resolveRequest: (context, moduleName, platform) => {
        if (moduleName === "tslib") return context.resolveRequest(context, "tslib/tslib.es6.js", platform);
        if (
          /date-fns\/locale\.(?:js|cjs|mjs)$/.test(context.originModulePath) &&
          moduleName.startsWith("./locale/") &&
          !/^(?:en|es|pt)(?:-|$)/.test(moduleName.slice("./locale/".length).replace(/\.js$/, ""))
        ) {
          return { type: "empty" };
        }
        try {
          return context.resolveRequest(context, moduleName, platform);
        } catch (error) {
          if (moduleName.endsWith(".js")) return context.resolveRequest(context, moduleName.slice(0, -3), platform);
          throw error;
        }
      },
    },
    transformer: { ...base.transformer, babelTransformerPath: require.resolve("./metro.config.cjs") },
  };
  return merged;
};

/** @param {{ filename: string; src: string }} args */
module.exports.transform = function transform(args) {
  if (args.filename.endsWith(".svg") && args.src.includes(' data-themed=""')) {
    const themed = args.src.replaceAll(' data-themed=""', "").replaceAll(themeable, '$1="var(--s$2,#$2)"');
    return rawTransformer.transform({ ...args, src: `module.exports = ${JSON.stringify(themed)};` });
  }
  return reactNativeSvgTransformer.transform(args);
};

if (process.argv.includes("export")) {
  const { setInterval, setTimeout } = require("node:timers");
  // @ts-expect-error implicit any is fine in shim
  // eslint-disable-next-line jsdoc/require-jsdoc
  function wrap(timer) {
    // @ts-expect-error implicit any is fine in shim
    return (...args) => {
      const id = timer(...args); // eslint-disable-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      id.unref(); // eslint-disable-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      return id; // eslint-disable-line @typescript-eslint/no-unsafe-return
    };
  }
  global.setTimeout = Object.assign(wrap(setTimeout), { __promisify__: setTimeout.__promisify__ });
  global.setInterval = wrap(setInterval);
}
