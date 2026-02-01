<!-- markdownlint-disable MD025 -->

# context: project rules & conventions

## core philosophy

this codebase will outlive you. every shortcut becomes someone else's burden. every hack compounds into technical debt that slows the whole team down. you are not just writing code. you are shaping the future of this project. the patterns you establish will be copied. the corners you cut will be cut again. fight entropy. leave the codebase better than you found it.

- **strictness**: high. follow linter/formatter (eslint, prettier, solhint) strictly. no `any` type.
- **environment**: zero config local dev. no `.env` files. mock all external services.
- **prose style**: **all internal documentation and commit messages must be lowercase**.
- **git**: `gitmoji` required. format: `<emoji> <scope>: <message>`. scopes are not exhaustive; common ones include `app`, `server`, `contracts`, `common`, `docs`, `github`, `dependencies`. see @[node_modules/gitmojis/dist/index.cjs] for full list.
- **diff-friendliness**: diffs matter. avoid adding items at the end of json/array lists (add in the middle or sorted position). trailing commas everywhere. structure code so changes are minimal and reviewable.

## naming philosophy ("long names are long")

this project follows bob nystrom's "long names are long" philosophy. names must be clear and precise. any additional characters are dead weight.

- **omit redundant type names**: let the type system explain itself.
  - ✅ `const user: User`
  - ❌ `const userObject: User`
  - ✅ `const holidays: Date[]` (plural for collections)
  - ❌ `const holidayDateList: Date[]`
- **omit contextual names**: don't repeat class/module names in members.
  - ✅ `class User { getProfile() }`
  - ❌ `class User { getUserProfile() }`
  - shorter scope = shorter name.
- **omit meaningless words**: "data", "state", "manager", "engine", "value" often mean nothing. if the name means the same thing without the word, remove it.
- **omit non-disambiguating words**: if `bid` is unambiguous, don't call it `recentlyUpdatedAnnualSalesBid`. only add modifiers if they distinguish between two existing things (e.g., `boss` vs `firstMonster`).
- **framework abbreviations are ok**: when a framework establishes a short convention, use it. examples: `c` for hono context, `t` for i18n translation, `db` for database, `ref` for react refs. these earn their place through ubiquity.

## stack-specific rules

### mobile (`app`)

- **stack**: react native, expo, tamagui, tanstack query.
- **architecture**: smart components (screens) vs dumb components (ui only). complex logic in one place is preferred - easier to reason about the whole thing.
- **styling**: tamagui tokens preferred. exceptions tolerated until v2 migration. no manual dark mode logic.
- **data**: tanstack query is the single source of truth - including ui state (e.g., `["settings", "sensitive"]`). **no `useEffect` for data fetching**. `useEffect` is discouraged generally.

### server (`server`)

- **stack**: hono, node.js, drizzle orm, postgres.
- **api**: schema-first (openapi via `hono-openapi`). validation via valibot middleware. always use `satisfies InferOutput<typeof Schema>` on responses for compile-time validation.
- **validators**: use `hono-openapi/valibot` for api routes with openapi docs. use `@hono/valibot-validator` for internal webhooks/hooks without openapi.
- **db**: drizzle schema is truth. migrations required. no direct db access in handlers (use `c.var.db`).
- **auth**: passkeys/webauthn primary. logic in middleware.
- **http codes**: use http to the fullest. non-200 codes for expected cases. 500 is fine for situations that shouldn't happen (type guards, etc.).
- **legacy field**: the `{ code, legacy }` error response pattern is deprecated. new code should omit `legacy`.

### contracts (`contracts`)

- **stack**: solidity, foundry.
- **custom errors**: use `error MyError();` instead of require strings. prefer parameterless errors for gas savings, but add context parameters (`error Unauthorized(address caller)`) when genuinely useful for debugging.
- **security**: checks-effects-interactions pattern mandatory. reentrancy guards on ALL state-changing external functions.
- **formatting**: named mappings required `mapping(address user => uint256 balance)`.
- **testing**: fuzzing required for inputs. gas snapshots mandatory. test function naming: `test_[function]_[scenario]()`.
- **natspec**: minimal - `@title`, `@author`, `@inheritdoc`. code should be self-documenting.

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- You have access to the Nx MCP server and its tools, use them to help the user
- When answering questions about the repository, use the `nx_workspace` tool first to gain an understanding of the workspace architecture where applicable.
- When working in individual projects, use the `nx_project_details` mcp tool to analyze and understand the specific project structure and dependencies
- For questions around nx configuration, best practices or if you're unsure, use the `nx_docs` tool to get relevant, up-to-date docs. Always use this instead of assuming things about nx configuration
- If the user needs help with an Nx configuration or project graph error, use the `nx_workspace` tool to get any errors

<!-- nx configuration end-->
