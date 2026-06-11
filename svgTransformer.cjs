const { getExpoTransformer, getReactNativeTransformer } = require("react-native-svg-transformer");
const reactNativeSvgTransformer = require("react-native-svg-transformer/expo");

const rawTransformer = getExpoTransformer() ?? getReactNativeTransformer();

const themeable = /\b(fill|stroke)="#([0-9a-f]{6})"/g;

/** @param {{ filename: string; src: string }} args */
module.exports.transform = function transform(args) {
  if (args.filename.endsWith(".svg") && args.src.includes(' data-themed=""')) {
    const themed = args.src.replaceAll(' data-themed=""', "").replaceAll(themeable, '$1="var(--s$2,#$2)"');
    return rawTransformer.transform({ ...args, src: `module.exports = ${JSON.stringify(themed)};` });
  }
  return reactNativeSvgTransformer.transform(args);
};
