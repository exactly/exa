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

## aesthetics

code is read far more often than it is written. visual harmony is not vanity — it directly affects readability, cognitive load, and the willingness of developers to maintain a codebase with care. ugly code invites more ugly code. beautiful code raises the bar.

aesthetics cannot be fully codified into rules. it is a sensibility — a reflex that recoils at visual noise and reaches for elegance. cultivate it. when two approaches are functionally equivalent, pick the one that looks better on screen.

- **prefer single words**: the most elegant identifier is a single word. it needs no separator, obeys every casing convention at once, and is always the shortest option. before reaching for a compound name, ask whether a more precise single word exists.
- **`snake_case` is prohibited by default**: this project uses `camelCase` for variables, functions, and modules, `PascalCase` for types, components, and events, and `kebab-case` for files, directories, and anything else. `snake_case` is visually noisy and breaks the rhythm of the codebase. never use it for any identifier, event name, key, or label where you have the freedom to choose. the only acceptable exceptions are external boundaries you cannot control:
  - adopting a third-party api contract that uses `snake_case` fields
  - writing in a language where `snake_case` is the dominant idiom (rust, python, sql)

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

- **internal documentation prose (`.agents/rules/*.md` files, `README.md`)**: all narrative text (headings, paragraphs, list items, proper nouns, brand names) must be **lowercase**. there are no exceptions.
  - ✅ `...built with astro and the starlight theme.`
  - ❌ `...built with Astro and the Starlight theme.`
- **referring to code in prose**: when discussing a code concept (like a variable or function name) in a sentence, use regular lowercase words. the correctly-cased identifier itself must only appear inside backticks.
  - ✅ `for boolean props, the name should indicate a positive condition (e.g., \`isActive\`).`
  - ❌ `for boolean props, the name should be isActive.`
- **code examples**: any identifier inside backticks (`` ` ``) or a code fence (` ``` `) is considered code, not prose. it must strictly follow the casing rules for that language.
- **code comments**: all code comments must be lowercase.
- **user-facing documentation (`docs/`)**: use proper sentence case.
- **changeset summaries**: use a lowercase sentence in the imperative present tense (e.g., `implement x feature for y`).
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
- **file ordering**: the top of a file is prime real estate. the default export — the thing the file exists for — goes first. standalone function declarations only exist because they were extracted for reuse or genuine complexity — they are supporting details and belong at the bottom alongside internal constants and types. when multiple declarations exist at the same level, order them by relevance, most important first.

## comments

this codebase does not use comments. the only exception is static analysis annotations (`@ts-expect-error`, `eslint-disable`, `slither-disable`, `solhint-disable`, `cspell:ignore`) and `TODO`/`HACK`/`FIXME` markers. everything else—jsdoc, explanatory prose, region markers, inline labels—is noise that masks unclear code. if code needs explanation, rewrite it until it doesn't.

- **static analysis annotations only**: suppress lint/type errors with the tool's disable comment (`eslint-disable-line`, `@ts-expect-error`, `solhint-disable`, etc.) and `cspell:ignore`. always use same-line form; use next-line or block only when the tool has no same-line variant. use `@ts-expect-error` (never `@ts-ignore`). explanations must be brutally concise, lowercase, and use `--` only when required by the tool.
  - ✅ `console.log("debug"); // eslint-disable-line no-console -- debug output for ci`
  - ✅ `// @ts-expect-error third-party lib expects wrong type`
  - ❌ `// @ts-expect-error: incorrect type`
  - ❌ `// @ts-expect-error - incorrect type`
- **`cspell:ignore`**: place the annotation on the same line as the unknown word. only add words to `cspell.json` when the term is a real project-relevant word that appears broadly (e.g., a protocol name, a library, a domain term) or when the file format has no comment syntax (json). one-off occurrences (variable names, company names, urls, hashes, identifiers) stay as inline `cspell:ignore` — never pollute the global dictionary with them.
  - ✅ `const rpc = "https://satanco.io"; // cspell:ignore satanco`
  - ❌ adding `satanco` to `cspell.json`
- **TODO/HACK/FIXME**: use sparingly. uppercase tag, single space, no colon, lowercase explanation.
  - ✅ `// TODO implement retry logic`
  - ❌ `// TODO: implement retry logic`
  - ❌ `// todo: implement retry logic`

## extraction and abstraction

extracting a value into a variable and extracting logic into a function are the same impulse at different scales. both add a layer of indirection. both widen the diff. both are justified only by reuse — never by tidiness, readability theatre, or a desire to name things.

- **single-use = inline**: a value consumed once stays at the point of consumption. a function called once stays at the call site. no exceptions for "clarity" — the call site is already clear.
- **destructuring is extraction**: unpacking fields into named bindings only to pass them individually is a net negative. it duplicates every name and inflates the diff.
  - ✅ `await db.insert(accounts).values({ id: crypto.randomUUID(), email: c.req.valid("json").email })`
  - ❌ `const { email } = c.req.valid("json"); await db.insert(accounts).values({ id: crypto.randomUUID(), email })`
- **two or more uses earn a name**: the threshold for extraction is a second call site. not "it makes the code more readable". not "it documents intent". a second use.
- **foot-gun encapsulation is the only other exception**: wrap a call only when it has an invariant (a required argument that's easy to forget) that must be enforced project-wide.
- **prefer raw library apis**: use libraries directly. do not wrap them in project-specific helpers for a single use case.
  - ✅ calling `queryClient.setQueryData()` directly
  - ❌ wrapping it in `useSetUserData()` for a single use case

## development environment

### philosophy

- **developer experience is paramount**: the project is designed to work out-of-the-box with no environment variables for local development. use mock services and sensible defaults.
- **strict automation**: rely on `pnpm nx` for task orchestration. all setup, testing, and generation is automated through nx targets.
- **monorepo integrity**: all commands must run from the repository root. never operate from within a sub-directory. never use `npm` or `yarn`.

### initial setup

- **to install dependencies**: run `pnpm install`. this automatically triggers `prepare` for all packages, which handles code generation (`wagmi`), versioning, and schema exports. no further setup needed.

### workspace structure & commands

- **monorepo packages**: the project is a `pnpm` workspace with the following packages:
  - `.` (root): the react native mobile app (`@exactly/mobile`).
  - `server`: the node.js backend api (`@exactly/server`).
  - `contracts`: the solidity smart contracts (`@exactly/plugin`).
  - `common`: shared utilities (`@exactly/common`).
  - `docs`: astro-based documentation (`@exactly/docs`).
  - `infra`: pulumi gcp infrastructure (`@exactly/infra`).
  - `substreams`: rust blockchain indexer (`@exactly/substreams`).
  - `.maestro`: end-to-end test scripts (`@exactly/e2e`).
- **running tasks**: always use `pnpm nx` — never bare `nx`, `npx`, or `pnpm --filter`.
  - `pnpm nx <target> <project>` — run a target for one project (e.g., `pnpm nx dev server`)
  - `pnpm nx run-many -t <target>` — run across all projects
  - `pnpm nx affected -t <target>` — run for affected projects only
- **nx integration**: the workspace extends `nx/presets/npm.json`, which infers targets from package.json scripts. the `@nx/eslint/plugin` auto-injects `test:eslint` for all projects. nx provides caching, dependency management, and parallel execution.
- **never use**:
  - ❌ `nx test server` — bare `nx` may not resolve; always prefix with `pnpm`
  - ❌ `npx eslint .` — use `pnpm eslint .` for direct binaries
  - ❌ `pnpm --filter server test` — bypasses nx caching and task orchestration
  - ❌ `pnpm tsc`, `npx tsc`, `pnpm typecheck` — nonexistent targets; use `pnpm nx test:ts <project>`

### testing

- **run all workspace tests**: `pnpm nx run-many -t test`. this is the authoritative command.
- **run tests for one project**: `pnpm nx test <project>` (e.g., `pnpm nx test server`).
- **run a specific test target**: `pnpm nx <target> <project>` (e.g., `pnpm nx test:ts server`, `pnpm nx test:vi server`).
- **note**: `pnpm test` at the root only runs `mobile:test`, not all workspace tests. always use `pnpm nx run-many -t test` for the full suite.
- **environment**: all tests run without `.env` files or external services.

**test targets** (`test:ts` and `test:eslint` exist in all ts projects):

- **workspace-wide** (defined in root/mobile): `test:spell`, `test:markdown`, `test:deps`, `test:changeset`
- **mobile**: `test:build`
- **server**: `test:vi`, `test:openapi`
- **contracts**: `test:fmt`, `test:gas`, `test:solhint`, `test:slither`, `test:coverage`, `test:sizes`
- **substreams**: `test:fmt`, `test:clippy`, `test:protolint`

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

stack-specific guidance lives in `.agents/rules/`. these files are glob-triggered and apply only when working in their respective directories.

## ai assistant directives

- **adopt, do not replace**: your primary role is to adopt and enforce the project's established conventions. never replace a core convention (e.g., the `gitmoji` commit format) with a different one (e.g., `conventional commits`), even if you believe it is superior.
- **respect the style guide**: you must follow all rules within the rule files for any code, documentation, or rules you write. this includes meta-rules like the "lowercase prose" convention for all internal documentation, including the rules themselves.
- **understand the intent**: do not interpret rules in the most literal way possible. understand the spirit and goal behind them. for example, a rule for "concise" messages implies front-loading keywords and removing filler words, not just meeting a character count.
- **stop on mcp issues**: any mcp error, misbehavior, or unreachable server is a full stop — ask the user how to proceed. do not retry silently, fall back to another tool, or improvise a workaround.
