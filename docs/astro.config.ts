import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";
import { defineConfig } from "astro/config";
import starlightOpenAPI, { openAPISidebarGroups } from "starlight-openapi";

export default defineConfig({
  site: "https://exactly.github.io/exa",
  base: "exa",
  integrations: [
    starlight({
      title: "Exa Docs",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/exactly/exa" }],
      plugins: [
        starlightOpenAPI([
          { base: "api", schema: "node_modules/@exactly/server/generated/openapi.json", sidebar: { collapsed: false } },
        ]),
      ],
      sidebar: openAPISidebarGroups,
    }),
    mermaid(),
  ],
});
