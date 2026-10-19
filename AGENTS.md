# context: project rules & conventions

## core philosophy

this codebase will outlive you. every shortcut becomes someone else's burden, and the patterns you leave get copied. fight entropy: leave the code better than you found it.

- **simplicity**: code that is easy to read, understand and maintain. no cleverness for its own sake. explicit over implicit.
- **consistency**: the established patterns win over personal preference.
- **strictness**: follow eslint, prettier, forge fmt, solhint and markdownlint exactly, and never argue with them. no `any`.
- **type safety**: catch errors at compile time with typescript, valibot and solidity types.
- **environment**: zero-config local dev: no `.env` files, every external service mocked. keys that ship in builds anyway are hardcoded defaults. production secrets are runtime environment variables, never files.
- **diff-friendliness**: diffs get read. add list items in sorted or middle positions, never by appending. trailing commas everywhere. minimal, reviewable changes.
- **attention to detail**: every line, comment and commit message reflects on the project.

## naming

code is read far more often than it is written, and ugly code invites more ugly code. when two approaches work the same, pick the one that looks better on screen.

- **single words**: the most elegant identifier is one precise word. look for it before reaching for a compound.
- **casing**: `camelCase` for values, functions and modules, `PascalCase` for types, components and events, `kebab-case` for directories, routes and anything else. no `snake_case` unless a third-party contract or the language (rust, python, sql) imposes it, like database columns.
- **long names are long**: no type in the name (`user: User`, not `userObject`), plurals for collections (`users`, not `userList`), no context the scope already gives (`User.getProfile`, not `getUserProfile`), no filler (`data`, `state`, `manager`, `engine`, `object`, `entity`, `instance`). shorter scope, shorter name.
- **framework abbreviations**: `c` (hono context), `t` (i18n), `db`, `ref`.

## capitalization

- **lowercase**: all prose in internal docs (`AGENTS.md` files, skills, `README.md`), code comments, commit messages and changeset summaries, proper nouns and brand names included: `built with astro and starlight`.
- **identifiers**: code names appear only inside backticks, cased as in code. in prose, use plain words: "for boolean props, name the positive condition (`open`)".
- **user-facing docs** (`docs/`): sentence case.
- **changesets**: an imperative present-tense sentence, like `implement x feature for y`.

## files

- **names**: directories and public expo router routes are `kebab-case` (`src/components/send-funds/`, `src/app/(main)/add-funds/add-crypto.tsx`). other files take their default export's name (`SendFunds.tsx`, `useAuth.ts`). files with several exports get a `camelCase` name, preferably one word (`currencies.ts`).
- **colocation**: a component's tests, hooks and types live next to it.
- **barrels**: an `index.ts` re-exports its directory.
- **by feature**: group by feature, not by type: `src/components/send-funds/Amount.tsx`, not `src/components/inputs/SendAmount.tsx`.

## formatting

- **compact**: no voluntary line breaks inside objects, arrays or arguments. prettier breaks lines only past `printWidth`.
- **file order**: the default export, the reason the file exists, goes first. extracted functions, internal constants and types go at the bottom. declarations at the same level go most important first.

## comments

no comments: code that needs one gets rewritten. the only exceptions:

- **static analysis annotations**: same-line form when the tool has one, a lowercase reason, `--` only where the tool requires it: `// eslint-disable-line no-console -- debug output for ci`, `// @ts-expect-error third-party lib expects wrong type` (never `@ts-ignore`).
- **`cspell:ignore`**: on the line of the word: `const rpc = "https://satanco.io"; // cspell:ignore satanco`. `cspell.json` only takes real project terms used broadly (protocols, libraries, domain words) or words in files without comments (json).
- **`TODO`, `HACK`, `FIXME`**: sparingly. uppercase tag, one space, no colon, lowercase text: `// TODO implement retry logic`.

## extraction

extracting a variable and extracting a function are the same impulse: both add indirection and widen the diff. only reuse justifies them, never tidiness or naming for its own sake.

- **single use stays inline**: a value used once stays where it's used, and a function called once stays at the call site.
- **destructuring is extraction**: unpacking fields only to pass them on duplicates every name: `db.insert(accounts).values({ id: crypto.randomUUID(), email: c.req.valid("json").email })`, without a `const { email } = c.req.valid("json")` first.
- **a second use earns a name**: not readability, not documenting intent.
- **foot-guns**: the only other reason to wrap a call is an easy-to-forget invariant the whole project must keep.
- **raw library apis**: call `queryClient.setQueryData()` directly instead of wrapping it in a single-use `useSetUserData()`.

## typescript style guide

### naming

- **variables & functions**: `camelCase`.
- **types & interfaces**: `PascalCase`. prefer `type` over `interface`.
- **react components**: `PascalCase`.
- **database columns**: `snake_case` (drizzle maps to `camelCase` in the orm).
- **css-in-js properties (tamagui)**: `camelCase`.

### functions

- **prefer function declarations**: use function declarations for all multi-line functions. use function expressions or arrow functions only if the implementation fits on a single line.
  - ✅ `function getStatus(user) { ... }`
  - ✅ `const isActive = (user) => user.active;`
  - ❌ `const getStatus = (user) => { ... };`

### variables

- **prefer `const`**: use `const` by default. only use `let` if the value will be reassigned.
- **one declaration per variable**: declare each variable on its own line.
  - ✅ `const user = {};`
  - ✅ `const items = [];`
  - ❌ `const user = {}, items = [];`

### imports

- **relative paths**: always use relative paths. avoid tsconfig path aliases.
  - ✅ `import { logger } from '../../../utils/logger';`
  - ❌ `import { logger } from '~/utils/logger';`
- **import order**: enforced by `eslint-plugin-perfectionist`. groups in order:
  1. side-effect imports
  2. mocks (files with `/mocks/` or `mock` pattern)
  3. react (`react`, `@react-*`)
  4. expo (`expo`, `@expo/*`)
  5. tamagui (`tamagui`, `@tamagui/*`)
  6. builtin and external packages
  7. internal (`@exactly/*`)
  8. relative paths (`./`, `../`)
  9. type imports
- **type imports**: always use `import type { ... }`. enforced by eslint.

### type patterns

- **inline prop types**: always define component props inline with destructuring. never extract to separate type definitions.
  - ✅ `function Card({ title, isActive }: { title: string; isActive: boolean })`
  - ❌ `type CardProps = { title: string; isActive: boolean }; function Card({ title, isActive }: CardProps)`
- **inline everything**: avoid intermediate variables for single use. don't create abstractions for one-time operations.
- **satisfies for responses**: always use `satisfies InferOutput<typeof Schema>` on server responses for compile-time validation.
  - ✅ `return c.json({ id, name } satisfies InferOutput<typeof UserResponse>);`
  - ❌ `return c.json({ id, name });`
- **boolean naming**: prefer naked adjectives (`hidden`, `open`, `allowed`). use `is*` prefix only when ambiguous (`isActive`, `isLast`).
- **type inference**: rely heavily on inference. only annotate when necessary for clarity or to catch errors.
  - avoid explicit return types on functions; let typescript infer them.

### validation (valibot)

- **single source of truth**: use valibot for all runtime validation (api inputs, environment variables, etc.).
- **infer types from schemas**: define schemas once and derive typescript types.
  - ✅ `type User = v.InferOutput<typeof UserSchema>;`
  - ❌ `interface User { ... }` (manually defined)

### modern practices (eslint-plugin-unicorn)

the `plugin:unicorn/recommended` ruleset enforces strict modern javascript best practices:

- **use destructuring**: `const { id, name } = user;` not `const id = user.id;`
- **use object method shorthand**: `{ getName() { ... } }` not `{ getName: function() { ... } }`
- **prefer modern syntax**: `?.`, `??`, `...`, `for...of`
- **no abbreviations** (with exceptions): `error` not `err`, `parameters` not `params`
  - **allowed**: `args`, `db`, `e2e`, `params`, `ref`, `Ref`, `utils`
- **explicit `Number.parseInt()`**: avoid global `parseInt()`
- **`Buffer.from()`**: never `new Buffer()`

### linting & static analysis

- **strict by default**: `eslint:recommended` + `@typescript-eslint/strict-type-checked` + `unicorn/recommended`
- **suppressing errors**: never use `@ts-ignore`. use `@ts-expect-error` with concise explanation.
  - ✅ `// @ts-expect-error third-party lib expects wrong type`
  - ❌ `// @ts-ignore`
  - ❌ `// @ts-expect-error: incorrect type`
  - ❌ `// @ts-expect-error` (missing explanation)
- **eslint suppressions**: always use same-line disable annotations. use `-- reason` separator only when required by the tool.
  - ✅ `console.log("debug"); // eslint-disable-line no-console -- debug output for ci`

## markdown

these rules apply to all markdown files in the repository.

### headings

- **top-level heading**: each file must start with a single top-level heading (`# heading 1`).
- **sequential order**: headings must be sequential (e.g., `#` -> `##` -> `###`). do not skip levels.
- **punctuation**: do not end headings with punctuation (`.`, `:`, `!`, `?`).

### lists

- **unordered lists**: use a hyphen (`-`) for unordered list items.
- **indentation**: sub-lists must be indented with a two-space offset.
- **prefer bullet points**: always use unordered lists (`-`) instead of numbered lists (`1.`).

### code blocks

- **fenced code blocks**: all code blocks must be fenced with backticks and specify a language identifier.
- **language identifier**: use `sh` or `bash` for shell commands.

### line length & spacing

- **line length**: prefer lines under 120 characters for readability. this is a soft preference, not enforced by the linter. autogenerated files (changelogs, etc.) are exempt.
- **blank lines**: surround all block-level elements (headings, lists, code blocks) with a single blank line. do not add multiple consecutive blank lines.
- **trailing spaces**: no lines should have trailing whitespace.

### links & emphasis

- **emphasis**: use asterisks (`*word*`) for italics and double asterisks (`**word**`) for bold.
- **descriptive links**: provide descriptive titles for links.
  - ✅ `for more information, see the [gitmoji guide](https://gitmoji.dev).`
  - ❌ `click [here](https://gitmoji.dev).`

## yaml

these rules apply to all yaml files in the repository.

### file naming

- **extension**: prefer `.yaml` over `.yml`.
- **filenames**: use `kebab-case`, lowercase.
  - ✅ `mobile-beta.yaml`
  - ❌ `mobileBeta.yaml`

### formatting

- **indentation**: 2 spaces, no tabs.
- **trailing commas**: not applicable in yaml.
- **blank lines**: use sparingly to separate logical sections. no multiple consecutive blank lines.

### scalars

- **booleans**: use lowercase `true` and `false`. never `yes`, `no`, `on`, `off`.
  - ✅ `enabled: true`
  - ❌ `enabled: yes`
- **strings**: no quotes for simple strings. use double quotes for variables, special characters, or when the value could be misinterpreted.
  - ✅ `name: test`
  - ✅ `version: "18"` (quoted to prevent numeric coercion)
  - ✅ `value: "${{ secrets.TOKEN }}"`
  - ❌ `name: 'test'`
- **numbers**: unquoted unless string representation is required.
- **nulls**: omit the value entirely or use explicit `null`. prefer omission.

### collections

- **arrays**: use inline `[]` when the array fits on a single line. use block style with `-` for multi-line.
  - ✅ `tags: [e2e, local]`
  - ✅ (block for multi-line):

    ```yaml
    packages:
      - common
      - contracts
      - server
    ```

  - ❌ `tags: ["e2e", "local"]` (unnecessary quotes)
- **objects**: use inline `{}` when the object fits on a single line. use block style for multi-line.
  - ✅ `with: { fetch-depth: 0, fetch-tags: true }`
  - ✅ (block for multi-line):

    ```yaml
    env:
      NODE_ENV: production
      DEBUG: false
    ```

### multi-line strings

- **literal blocks**: use pipe `|` to preserve newlines (for scripts, commands).

  ```yaml
  run: |
    echo "line 1"
    echo "line 2"
  ```

- **folded blocks**: use `>` sparingly. prefer `|` for clarity.

### anchors & aliases

- **use sparingly**: only when duplication creates a maintenance burden.
- **naming**: use descriptive anchor names.

  ```yaml
  "@aa-sdk/core": &aaSDK ^4.82.1
  "@account-kit/infra": *aaSDK
  ```

### comments

- **sparse comments**: yaml should be self-documenting. avoid unnecessary comments.
- **cspell directives**: use `# cspell:ignore <word>` for technical terms.
- **conditional directives**: tools may use special comment syntax (e.g., `# @if`).

## development environment

### philosophy

- **developer experience is paramount**: the project is designed to work out-of-the-box with no environment variables for local development. use mock services and sensible defaults.
- **strict automation**: rely on `pnpm nx` for task orchestration. all setup, testing, and generation is automated through nx targets.
- **monorepo integrity**: all commands must run from the repository root. never operate from within a sub-directory. never use `npm` or `yarn`.

### initial setup

- **to install dependencies**: run `pnpm install`. this automatically triggers `prepare` for all packages, which handles code generation (`wagmi`) and versioning. no further setup needed.

### workspace structure & commands

- **monorepo packages**: the project is a `pnpm` workspace with the following packages:
  - `.` (root): the react native mobile app (`@exactly/mobile`).
  - `server`: the node.js backend api (`@exactly/server`).
  - `contracts`: the solidity smart contracts (`@exactly/plugin`).
  - `common`: shared utilities (`@exactly/common`).
  - `docs`: astro-based documentation (`@exactly/docs`).
  - `infra`: pulumi gcp infrastructure (`@exactly/infra`).
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

### file management

- **no binary files**: never commit `png`, `jpeg`, `gif`, or large `svg` files.
- **prefer generated diagrams**: use mermaid, plantuml, or other code-based diagramming tools.
- **generated directories**: do not manually edit files in these directories:
  - `src/generated/`
  - `server/generated/`
  - `contracts/broadcast/`
  - `contracts/cache/`
- **ignored files**: do not interact with standard ignored files like `node_modules`, `.expo`, `dist`, or `.env*`.

## package rules

package-specific guidance lives in nested `AGENTS.md` files (`src/`, `server/`, `contracts/`, `docs/`). before changing a file, follow every `AGENTS.md` between it and the repository root.

## ai assistant directives

- **adopt, do not replace**: your primary role is to adopt and enforce the project's established conventions. never replace a core convention (e.g., the `gitmoji` commit format) with a different one (e.g., `conventional commits`), even if you believe it is superior.
- **respect the style guide**: you must follow all rules within the rule files for any code, documentation, or rules you write. this includes meta-rules like the "lowercase prose" convention for all internal documentation, including the rules themselves.
- **understand the intent**: do not interpret rules in the most literal way possible. understand the spirit and goal behind them. for example, a rule for "concise" messages implies front-loading keywords and removing filler words, not just meeting a character count.
- **stop on mcp issues**: any mcp error, misbehavior, or unreachable server is a full stop — ask the user how to proceed. do not retry silently, fall back to another tool, or improvise a workaround.
