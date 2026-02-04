<!-- markdownlint-disable MD025 -->

# context: project rules & conventions

## core philosophy

this codebase will outlive you. every shortcut becomes someone else's burden. every hack compounds into technical debt that slows the whole team down. you are not just writing code. you are shaping the future of this project. the patterns you establish will be copied. the corners you cut will be cut again. fight entropy. leave the codebase better than you found it.

- **simplicity and clarity**: write code that is easy to read, understand, and maintain. avoid cleverness for its own sake. prefer explicit over implicit.
- **consistency**: consistency is more important than personal preference. adhere to the established patterns in the codebase.
- **strictness**: high. follow linter/formatter (eslint, prettier, solhint) strictly. no `any` type.
- **type safety first**: leverage typescript, valibot, and solidity types to catch errors at compile time, not run time.
- **automation and tooling**: rely on tools (eslint, prettier, forge fmt, markdownlint) to enforce style. do not argue with the linter.
- **environment**: zero config local dev. no `.env` files. mock all external services. keys that will be exposed anyway (in builds) are hardcoded as defaults in the code. production secrets are environment variables at runtime only - never in files.
- **prose style**: **all internal documentation and commit messages must be lowercase**.
- **diff-friendliness**: diffs matter. avoid adding items at the end of json/array lists (add in the middle or sorted position). trailing commas everywhere. structure code so changes are minimal and reviewable.
- **obsessive attention to detail**: every line of code, every comment, and every commit message reflects the quality of the project.

## naming philosophy ("long names are long")

this project follows bob nystrom's "long names are long" philosophy. names must be clear and precise. any additional characters are dead weight.

- **omit redundant type names**: do not include the type in a variable's name. let the static type system do its job.
  - ✅ `const user: User`
  - ❌ `const userObject: User`
  - ✅ `const holidays: Date[]`
  - ❌ `const holidayDateList: Date[]`
- **omit contextual names**: do not repeat the name of a class or module within its members. the context is already known.
  - ✅ `class User { getProfile() }`
  - ❌ `class User { getUserProfile() }`
  - shorter scope = shorter name.
- **omit meaningless words**: avoid fluff words that carry no meaningful information. usual suspects include `data`, `state`, `manager`, `engine`, `object`, `entity`, and `instance`.
  - ✅ `function getProfile(user: User)`
  - ❌ `function getUserProfileData(userData: User)`
- **use plurals for collections**: for collections, use a plural noun describing the contents, not a singular noun describing the collection itself.
  - ✅ `const users: User[]`
  - ❌ `const userList: User[]`
- **framework abbreviations are ok**: when a framework establishes a short convention, use it. examples: `c` for hono context, `t` for i18n translation, `db` for database, `ref` for react refs. these earn their place through ubiquity.

## capitalization

a core principle is specific capitalization for different contexts. this must be followed with obsessive precision.

- **internal documentation prose (`.agent/rules/*.md` files, `README.md`):** all narrative text (headings, paragraphs, list items, proper nouns, brand names) must be **lowercase**. there are no exceptions.
  - ✅ `...built with astro and the starlight theme.`
  - ❌ `...built with Astro and the Starlight theme.`
- **referring to code in prose:** when discussing a code concept (like a variable or function name) in a sentence, use regular lowercase words. the correctly-cased identifier itself must only appear inside backticks.
  - ✅ `for boolean props, the name should indicate a positive condition (e.g., \`isActive\`).`
  - ❌ `for boolean props, the name should be isActive.`
- **code examples:** any identifier inside backticks (`` ` ``) or a code fence (` ``` `) is considered code, not prose. it must strictly follow the casing rules for that language.
- **code comments:** all code comments must be lowercase.
- **user-facing documentation (`docs/`):** use proper sentence case.
- **changeset summaries:** use a lowercase sentence in the imperative present tense. (e.g., `implement x feature for y.`).
- **git commit messages**: must be lowercase.

## file naming

- **directories**: always `kebab-case`.
- **route files**: public expo router routes use `kebab-case`.
- **all other files**: named identically to their `default` export.
- **multiple exports**: use `camelCase`, with a strong preference for a single word.
  - ✅ `src/components/user-profile/` (directory)
  - ✅ `app/(app)/add-funds.tsx` (route)
  - ✅ `UserProfile.tsx` (for `export default function UserProfile`)
  - ✅ `useUserProfile.ts` (for `export default function useUserProfile`)
  - ✅ `colors.ts` (for `export const red = ...; export const blue = ...;`)
  - ❌ `src/components/UserProfile/` (directory)
  - ❌ `Colors.ts` (for a file with multiple exports)

## file structure

- **colocation**: place related files together. for a component, this means `component.tsx`, `component.test.tsx`, and any related hooks or types are in the same directory.
- **`index.ts` barrels**: use `index.ts` files to re-export modules from a directory, simplifying import paths.
- **feature-based directories**: group files by feature, not by type.
  - ✅ `src/features/authentication/components/login-button.tsx`
  - ❌ `src/components/authentication/login-button.tsx`

## code formatting

- **maximum compactness**: the project enforces a maximally compact code style. do not introduce line breaks inside objects, arrays, or function arguments voluntarily. let prettier break lines automatically only when a line exceeds `printWidth`.

## comments

this codebase does not use comments. the only exception is static analysis annotations (`@ts-expect-error`, `eslint-disable`, `slither-disable`, `solhint-disable`, `cspell:ignore`) and `TODO`/`FIXME` markers. everything else—jsdoc, explanatory prose, region markers, inline labels—is noise that masks unclear code. if code needs explanation, rewrite it until it doesn't.

- **static analysis annotations only**: use `@ts-expect-error` (never `@ts-ignore`), eslint/slither/solhint disable comments, and `cspell:ignore`. explanations must be brutally concise, lowercase, and use `--` only when required by the tool.
  - ✅ `// @ts-expect-error third-party lib expects wrong type`
  - ✅ `// eslint-disable-next-line no-console -- debug output for ci`
  - ❌ `// @ts-expect-error: incorrect type`
  - ❌ `// @ts-expect-error - incorrect type`
- **todo/fixme**: use sparingly. uppercase tag, single space, lowercase explanation.
  - ✅ `// TODO implement retry logic`
  - ❌ `// todo: implement retry logic`

## abstractions

- **avoid premature abstraction**: don't add helpers, utilities, or abstractions for one-time operations. three similar lines of code is better than a premature abstraction. don't design for hypothetical future requirements.
- **when abstraction is acceptable**: encapsulate complexity only when there's a foot-gun - a call that must always have an argument that can be easily forgotten. these are exceptions, not the rule.
- **prefer raw library knowledge**: it's better to use libraries directly and understand their apis than to wrap them in project-specific abstractions.
  - ✅ calling `queryClient.setQueryData()` directly
  - ❌ wrapping it in `useSetUserData()` for a single use case

## git & versioning

this project uses [gitmoji](https://gitmoji.dev). the conventional commits specification is **not** used.

### commit message format

all commit messages must strictly adhere to the following format: `<emoji> <scope>: <message>`

- **`<emoji>`**: a single, appropriate gitmoji unicode character from the [official list](node_modules/gitmojis/dist/index.mjs).
- **`<scope>`**: a mandatory, short name identifying the part of the codebase affected.
- **`<message>`**: a short, lowercase description of the change.

### core rules

- **use gitmoji**: all commits must start with a single gitmoji. this is not optional.
- **scope is mandatory**: every commit must have a scope.
- **lowercase everything**: the scope and the message must be in lowercase.

### allowed scopes

- `app`: the root react native application.
- `server`: the backend api server.
- `contracts`: the solidity smart contracts.
- `docs`: documentation-only changes.
- `common`: shared utilities and types.
- `dependencies`: changes to dependencies, either cross-project or project-specific.
- `github`: changes to github actions or ci workflows.
- `config`: changes to configuration files (eslint, tsconfig, etc.).
- `repo`: repository-wide changes that don't fit other scopes.

### writing effective messages

the start of the commit message is prime real estate. git uis (github, gitlab, `git log --oneline`) truncate long subjects and render them differently. front-load the most important information.

- **front-load keywords**: start with the most impactful words.
- **remove filler words**: omit articles (`a`, `the`), prepositions, and other words that don't add critical meaning.
- **be keyword-driven**: details belong in the commit body, not the subject.

```bash
# ✅ good - direct and keyword-focused
🐛 app: fix card activation crash
✨ server: add user auth endpoint

# ❌ bad - verbose and buries context
🐛 app: fix a crash that happens when a user tries to activate their card
```

## development environment

### philosophy

- **developer experience is paramount**: the project is designed to work out-of-the-box with no environment variables for local development. use mock services and sensible defaults.
- **strict automation**: rely on `pnpm` scripts for all tasks. all setup, testing, and generation is automated.
- **monorepo integrity**: all commands must run from the repository root. never operate from within a sub-directory. never use `npm` or `yarn`.

### initial setup

- **to install dependencies**: run `pnpm install`.
- **to prepare the environment**: run `pnpm prepare`. this command is comprehensive and handles git hooks, code generation (`wagmi`), and versioning.

### workspace structure & commands

- **monorepo packages**: the project is a `pnpm` workspace with the following packages:
  - `.` (root): the react native mobile app (`@exactly/mobile`).
  - `server`: the node.js backend api (`@exactly/server`).
  - `contracts`: the solidity smart contracts (`@exactly/plugin`).
  - `common`: shared utilities (`@exactly/common`).
  - `docs`: astro-based documentation (`@exactly/docs`).
- **running scripts**: use `pnpm --filter <package_name> <script>` or `pnpm nx <script> <package_name>` to run a script in a specific package.
  - example: `pnpm --filter server dev` or `pnpm nx dev server`
- **nx integration**: the workspace uses `nx/presets/npm.json`, which means nx infers targets from package.json scripts. `pnpm nx <script> <package>` works for any script defined in that package's package.json. prefer nx commands for better caching and task orchestration.
- **never use npx**: use the pnpm-provided binaries instead.
  - ✅ `pnpm eslint .`
  - ❌ `npx eslint .`

### testing

- **run all tests**: `pnpm test`. this is the primary command and runs a comprehensive suite.
- **test suite includes**:
  - typescript compilation (`test:ts:*`)
  - eslint (`test:eslint` with zero warnings)
  - spell checking (`test:spell`)
  - markdown linting (`test:markdown`)
  - contract tests (`foundry`)
- **environment**: all tests are designed to run without any `.env` files or external services.

### file management

- **no binary files**: never commit `png`, `jpeg`, `gif`, or large `svg` files.
- **prefer generated diagrams**: use mermaid, plantuml, or other code-based diagramming tools.
- **generated directories**: do not manually edit files in these directories:
  - `src/generated/`
  - `server/generated/`
  - `contracts/broadcast/`
  - `contracts/cache/`
- **ignored files**: do not interact with standard ignored files like `node_modules`, `.expo`, `dist`, or `.env*`.

## stack-specific rules

stack-specific guidance lives in `.agent/rules/`. these files are glob-triggered and apply only when working in their respective directories.

## ai assistant directives

- **adopt, do not replace**: your primary role is to adopt and enforce the project's established conventions. never replace a core convention (e.g., the `gitmoji` commit format) with a different one (e.g., `conventional commits`), even if you believe it is superior.
- **respect the style guide**: you must follow all rules within the rule files for any code, documentation, or rules you write. this includes meta-rules like the "lowercase prose" convention for all internal documentation, including the rules themselves.
- **understand the intent**: do not interpret rules in the most literal way possible. understand the spirit and goal behind them. for example, a rule for "concise" messages implies front-loading keywords and removing filler words, not just meeting a character count.

## external references

content in this section is adapted from external sources and should be periodically reviewed for updates.

### explanatory output style

<!-- source: https://github.com/anthropics/claude-code/tree/3af8ef2/plugins/explanatory-output-style -->

you are in 'explanatory' output style mode, where you should provide educational insights about the codebase as you help with the user's task.

you should be clear and educational, providing helpful explanations while remaining focused on the task. balance educational content with task completion. when providing insights, you may exceed typical length constraints, but remain focused and relevant.

### insights

in order to encourage learning, before and after writing code, always provide brief educational explanations about implementation choices using (with backticks):
"`★ Insight ─────────────────────────────────────`
[2-3 key educational points]
`─────────────────────────────────────────────────`"

these insights should be included in the conversation, not in the codebase. you should generally focus on interesting insights that are specific to the codebase or the code you just wrote, rather than general programming concepts. do not wait until the end to provide insights. provide them as you write code.

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- You have access to the Nx MCP server and its tools, use them to help the user
- When answering questions about the repository, use the `nx_workspace` tool first to gain an understanding of the workspace architecture where applicable.
- When working in individual projects, use the `nx_project_details` mcp tool to analyze and understand the specific project structure and dependencies
- For questions around nx configuration, best practices or if you're unsure, use the `nx_docs` tool to get relevant, up-to-date docs. Always use this instead of assuming things about nx configuration
- If the user needs help with an Nx configuration or project graph error, use the `nx_workspace` tool to get any errors
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.

<!-- nx configuration end-->
