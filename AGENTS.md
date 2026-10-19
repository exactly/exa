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
- **no binaries**: never commit `png`, `jpeg`, `gif` or large `svg` files. diagrams are code (mermaid).
- **hands off**: never edit generated directories (`src/generated/`, `server/generated/`, `contracts/broadcast/`, `contracts/cache/`) or ignored files (`node_modules`, `.expo`, `dist`, `.env*`).

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

## typescript

- **functions**: declarations for anything multi-line, arrows only for one-liners: `const isActive = (user: User) => user.active`.
- **variables**: one declaration per statement.
- **imports**: relative paths, never tsconfig aliases.
- **props**: typed inline in the signature, never a separate props type: `function Card({ title, active }: { title: string; active: boolean })`.
- **booleans**: naked adjectives (`hidden`, `open`, `allowed`). `is*` only when ambiguous (`isLast`).
- **inference**: annotate only what inference can't get or to catch an error. no explicit return types.
- **validation**: valibot for every runtime check (api input, environment variables). types come from schemas: `type CreditActivity = InferOutput<typeof CreditActivity>`.

## markdown

- bullets (`-`), never numbered lists.
- every code fence names its language (`sh` or `bash` for shell).
- link text says where it goes: `see the [gitmoji guide](https://gitmoji.dev)`, never `click [here](https://gitmoji.dev)`.
- lines under 120 characters when possible. not linted, and generated files are exempt.

## yaml

- `.yaml`, never `.yml`, with `kebab-case` file names.
- quotes only when needed (variables, special characters, values yaml would coerce): `name: test`, `version: "18"`, `value: "${{ secrets.TOKEN }}"`.
- flow style when it fits on one line: `tags: [e2e, local]`, `with: { fetch-depth: 0, fetch-tags: true }`.
- `|` for multi-line scripts, `>` rarely. omit null values.
- anchors only when duplication becomes a burden, with descriptive names (`&aaSDK`).

## development

- **pnpm and nx only**: run everything from the repository root through `pnpm nx`. never bare `nx`, `npx`, `npm`, `yarn` or `pnpm --filter` (it bypasses nx caching). binaries without a target run through pnpm: `pnpm eslint .`.
- **setup**: `pnpm install` runs every package's `prepare`, which generates code (wagmi) and versions. no environment variables, nothing else to set up.
- **packages**: `.` the react native app (`@exactly/mobile`), `server` the api (`@exactly/server`), `contracts` (`@exactly/plugin`), `common` shared code (`@exactly/common`), `docs` the astro site (`@exactly/docs`), `infra` pulumi on gcp (`@exactly/infra`), `.maestro` e2e flows (`@exactly/e2e`).
- **tasks**: `pnpm nx <target> <project>` (`pnpm nx dev server`), `pnpm nx run-many -t <target>`, `pnpm nx affected -t <target>`. targets come from each `package.json`, plus `test:eslint` from `@nx/eslint/plugin`.
- **tests**: `pnpm nx run-many -t test` is the whole suite (root `pnpm test` only runs the app's). every ts project has `test:ts` and `test:eslint`; there is no `tsc` or `typecheck` script. the app adds `test:build`, `test:spell`, `test:markdown`, `test:deps` and `test:changeset`; the server `test:vi` and `test:openapi`; contracts `test:fmt`, `test:gas`, `test:solhint`, `test:slither`, `test:coverage` and `test:sizes`. no test needs `.env` files or external services.

## dependencies

- **lockfile**: only dependency changes touch `pnpm-lock.yaml`. check with `pnpm install --frozen-lockfile`: an install that can't fetch github tarballs (sandboxes) rewrites github dependencies to ssh urls that break ci.
- **patches**: patch a dependency only with the verbatim upstream fix, when nothing cleaner exists, and say why in the commit body.
- **audit fixes**: surgical `pnpm.overrides`, with the advisory's vulnerable range as the selector and the latest safe version with `^` as the value: `"axios@>=1 <1.20.0": "^1.20.0"`.

## git

- **commits** go through the commit skill (`.agents/skills/commit/`): gitmoji, signed, one logical change each.
- **linear history**: rebase, never merge, on your own branches. main only takes rebased, signed, linear history.
- **review fixes** fold into the commit they fix, keeping its message, and every branch stacked above gets rebased onto the result.
- **other people's branches** are never rewritten: no rebase, amend or force-push. bring their base in with a merge commit instead.
- **validate before pushing**: everything github runs on a push must pass for you first, so nothing ever fails on github before it fails for you. today that is `pnpm install --frozen-lockfile`, `pnpm nx run-many -t test` and the four web e2e flows (see `.github/workflows/test.yaml`).
- **pushing**: unattended sessions push their own branch once it validates, because their machine is thrown away. attended sessions push when asked. never push to `main` or to someone else's branch.

## nested rules

directory-specific guidance lives in nested `AGENTS.md` files (`src/`, `server/`, `contracts/`, `docs/`, `.maestro/`). before changing a file, follow every `AGENTS.md` between it and the repository root.

## agents

- **adopt, don't replace**: enforce the conventions here even where you'd prefer another. gitmoji stays; conventional commits don't come in.
- **rules apply to rules**: everything you write follows these files, edits to these files included.
- **follow the spirit**: rules state intent, not wording to game. "concise" means front-loaded and free of filler, not a character count.
- **mcp servers**: repair what you can on your own (retry, restart the server, use the matching cli such as `pnpm nx` or `maestro`) and keep going. report real problems to the developer right away, with the exact error: a server the task can't do without, expired credentials, a broken config in this repo.
