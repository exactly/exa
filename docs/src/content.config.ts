import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection } from "astro:content";

// eslint-disable-next-line import/prefer-default-export -- astro api
export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
