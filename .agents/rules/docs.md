---
always_on: false
alwaysApply: false
applyTo: "docs/**/*"
globs: "docs/**/*"
paths: ["docs/**/*"]
trigger: glob
---

# documentation (`docs`)

- **stack**: astro, starlight theme.
- **single source of truth**: all documentation content resides within the `docs/` directory and is versioned in git.
- **linting**: all markdown files must adhere to `.markdownlint.json`. always run `pnpm nx test:markdown mobile` to verify.

## linting

the documentation's eslint configuration enforces:

- **`plugin:astro/recommended`**: best practices for `.astro` files and components.

## content authoring

### file structure

- all user-facing documentation pages are markdown files (`.md`) located in `docs/src/content/docs/`.
- the main entry point is `docs/src/content/docs/index.md`.
- use subdirectories for logical grouping (e.g., `getting-started/`, `architecture/`).

### page metadata (front-matter)

- every page must start with yaml front-matter. required: `title`, `description`.

### starlight components & syntax

- use starlight components for rich content when necessary. do not overuse them.
- **tabs**: use `<Tabs>` and `<TabItem>` for platform-specific or context-specific information.
- **callouts (asides)**: use `:::` blocks for tips, notes, and warnings.
  - `:::note`
  - `:::tip`
  - `:::warning`
  - `:::caution`
- **do not use custom colors or complex styling.** adhere to the default starlight theme.

## automated content

- **api reference**: the api documentation at the `/api` route is auto-generated.
- **source**: the generation source is the openapi specification from the `server` package.
- **rule**: do not edit the api documentation pages directly.
- **update command**: run `pnpm nx generate:openapi server` to regenerate.

## writing style

- **capitalization**: user-facing documentation follows standard english capitalization rules (title case for headings, sentence case for prose). the internal lowercase convention does not apply here.

## prohibited actions

- **do not** add binary files like images (`.png`, `.jpg`) to the `docs/` directory. use code-based diagrams (mermaid).
- **do not** introduce complex html or custom css. stick to standard markdown and starlight components.

## development workflow

- **preview documentation**: `pnpm nx dev docs`
- **build documentation**: `pnpm nx build docs`
