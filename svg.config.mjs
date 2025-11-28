import transformer from "@expo/metro-config/build/babel-transformer.js";
import { resolveConfig, transform as svgr } from "@svgr/core";

/** @param {import('metro-babel-transformer').BabelTransformerArgs} args */
export async function transform({ src, filename, ...rest }) {
  return /** @type {import('metro-babel-transformer').BabelTransformer} */ (transformer).transform({
    src: filename.endsWith(".svg") ? await svgr(src, (await resolveConfig()) ?? {}, { filePath: filename }) : src,
    filename,
    ...rest,
  });
}

export const getCacheKey = /** @type {import('metro-babel-transformer').BabelTransformer} */ (transformer).getCacheKey;
