# docs (`docs`)

astro with the starlight theme. these pages are user-facing, so they use sentence case, headings included: the internal lowercase rule doesn't apply here.

- pages are markdown in `docs/src/content/docs/`, entry `index.md`, grouped in subdirectories. each one starts with front matter holding `title` and `description`.
- starlight components only where they help: `<Tabs>` and `<TabItem>` for platform-specific content, `:::note`, `:::tip`, `:::warning` and `:::caution` asides. default theme only: no custom colors, html or css.
- the `/api` pages are generated from the server's openapi spec. never edit them: run `pnpm nx generate:openapi server`.
- no images: diagrams are mermaid.
- `pnpm nx dev docs` to preview, `pnpm nx build docs` to build, `pnpm nx test:markdown mobile` to lint.
