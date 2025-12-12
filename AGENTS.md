<!-- markdownlint-disable MD025 -->

# context: project rules & conventions

## core philosophy

- **strictness**: high. follow linter/formatter (eslint, prettier, solhint) strictly. no `any` type.
- **environment**: zero config local dev. no `.env` files. mock all external services.
- **prose style**: **all internal documentation and commit messages must be lowercase**.
- **git**: `gitmoji` required. format: `<emoji> <scope>: <message>`. scopes: `app`, `server`, `contracts`, `common`, `docs`. see @[node_modules/gitmojis/dist/index.cjs] for full list.

## naming philosophy ("long names are long")

we follow bob nystrom's "long names are long" philosophy. names must be clear and precise. any additional characters are dead weight.

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

## stack-specific rules

### mobile (`app`)

- **stack**: react native, expo, tamagui, tanstack query.
- **architecture**: smart components (screens, perform fetching) vs dumb components (ui only).
- **styling**: `tamagui` tokens only. no inline styles. no manual dark mode logic.
- **data**: tanstack query is the source of truth. **no `useEffect` for data fetching**.

### server (`server`)

- **stack**: hono, node.js, drizzle orm, postgres.
- **api**: schema-first (openapi via hono). validation via `valibot` middleware.
- **db**: drizzle schema is truth. migrations required. no direct db access in handlers (use `c.var.db`).
- **auth**: passkeys/webauthn primary. logic in middleware.

### contracts (`contracts`)

- **stack**: solidity, foundry.
- **modern practices**: use **custom errors** `error MyError();` instead of strings `require(..., "msg")`.
- **security**: checks-effects-interactions pattern mandatory. reentrancy guards on ALL state-changing external functions.
- **formatting**: named mappings required `mapping(address user => uint256 balance)`.
- **testing**: fuzzing required for inputs. gas snapshots mandatory.

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
