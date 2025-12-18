---
always_on: true
alwaysApply: true
applyTo: "**"
trigger: always_on
---
# exa development environment rules

## philosophy

- **developer experience is paramount**: the project is designed to work out-of-the-box with no environment variables for local development. use mock services and sensible defaults.
- **strict automation**: rely on `pnpm` scripts for all tasks. all setup, testing, and generation is automated.
- **monorepo integrity**: all commands must run from the repository root. never operate from within a sub-directory. never use `npm` or `yarn`.

## initial setup

- **to install dependencies**: instruct the user to run `pnpm install`.
- **to prepare the environment**: instruct the user to run `pnpm prepare`. this command is comprehensive and handles git hooks, code generation (`wagmi`), and versioning.

## workspace structure & commands

- **monorepo packages**: the project is a `pnpm` workspace with the following packages:
  - `.` (root): the react native mobile app (`@exactly/mobile`).
  - `server`: the node.js backend api (`@exactly/server`).
  - `contracts`: the solidity smart contracts (`@exactly/plugin`).
  - `common`: shared utilities (`@exactly/common`).
  - `docs`: astro-based documentation (`@exactly/docs`).
- **running scripts**: always use `pnpm --filter <package_name> <script>` to run a script in a specific package.
  - example: `pnpm --filter server dev`
- **never use npx**: use the pnpm-provided binaries instead.
  - ✅ `pnpm eslint .`
  - ❌ `npx eslint .`

## development workflows

### mobile app (`@exactly/mobile`)

- **stack**: react native, expo, tamagui (ui), expo router (navigation), tanstack query (state).
- **start dev server**: `pnpm start`
- **run on platform**: `pnpm android`, `pnpm ios`, `pnpm web`

### server (`@exactly/server`)

- **stack**: hono (framework), node.js, drizzle orm (database), postgresql.
- **start dev server**: `pnpm --filter server dev` (uses `tsx` for hot-reload).
- **api generation**: the server uses `hono-openapi` to generate an openapi spec from the code. to update it, run `pnpm --filter server openapi`.

### smart contracts (`@exactly/plugin`)

- **stack**: solidity, foundry (`forge`).
- **core concepts**: account abstraction (`modular-account`) and passkeys (`webauthn-sol`).
- **build contracts**: `pnpm --filter plugin build`
- **run tests**: `pnpm --filter plugin test`
- **check formatting**: `pnpm --filter plugin test:fmt`

## testing

- **run all tests**: `pnpm test`. this is the primary command and runs a comprehensive suite.
- **test suite includes**:
  - typescript compilation (`test:ts:*`)
  - eslint (`test:eslint` with zero warnings)
  - spell checking (`test:spell`)
  - markdown linting (`test:markdown`)
  - contract tests (`foundry`)
- **environment**: all tests are designed to run without any `.env` files or external services.

## file management

- **no binary files**: never commit `png`, `jpeg`, `gif`, or large `svg` files.
- **prefer generated diagrams**: use mermaid, plantuml, or other code-based diagramming tools.
- **generated directories**: do not manually edit files in these directories:
  - `src/generated/`
  - `server/generated/`
  - `contracts/broadcast/`
  - `contracts/cache/`
- **ignored files**: do not interact with standard ignored files like `node_modules`, `.expo`, `dist`, or `.env*`.
