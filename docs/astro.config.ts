import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://exactly.github.io/exa",
  base: "exa",
  integrations: [
    starlight({
      title: "Exa Docs",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/exactly/exa" }],
    }),
  ],
});
