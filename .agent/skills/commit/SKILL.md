---
name: commit
description: "create git commits and changesets following the project's gitmoji conventions. MUST be force-activated before every commit. handles: (1) smart staging — review and stage files if nothing is staged, (2) gitmoji selection — present all relevant gitmojis for the developer to choose, (3) commit message drafting — generate 9 concise message options, (4) changeset creation — create .changeset files when the change has user-facing impact. use this skill whenever the user asks to commit, requests /commit, or when you are about to create a git commit for any reason."
---

<!-- cspell:ignore uall -->

# commit

this project uses [gitmoji](https://gitmoji.dev). the conventional commits specification is **not** used.

## commit message format

`<emoji> <scope>: <message>`

- **emoji**: a single, appropriate gitmoji unicode character from the [official list](node_modules/gitmojis/dist/index.mjs) (never `:code:` shortcodes). **only canonical gitmojis from the official list are allowed** — never invent or use emojis not in the list
- **scope**: mandatory, lowercase, from allowed list
- **message**: lowercase, imperative verb first, concise, no filler words, no trailing punctuation

### allowed scopes

| scope | meaning |
| --- | --- |
| app | react native application (`@exactly/mobile`) |
| server | backend api (`@exactly/server`) |
| contracts | solidity smart contracts (`@exactly/plugin`) |
| common | shared utilities (`@exactly/common`) |
| substreams | substreams package (`@exactly/substreams`) |
| docs | documentation-only changes |
| dependencies | dependency changes |
| github | github actions or ci workflows |
| eas | expo application services (eas builds, updates, submit) |
| global | repository-wide changes that don't fit other scopes |
| e2e | end-to-end tests (`.maestro/`) |
| agents | agent-related changes (`.agent/`) |

config changes use the subproject scope when specific to a subproject (e.g., `server` for server tsconfig). for global config, use the tool/platform name as scope (e.g., `eslint`, `prettier`, `nx`).

### message style

the start of the commit message is prime real estate. git UIs (github, gitlab, `git log --oneline`) truncate long subjects. front-load the most important information.

- front-load keywords (most important word first)
- remove filler words (a, the, for, with, etc.)
- start with an imperative verb (add, fix, implement, update, remove, refactor, etc.)
- be keyword-driven: details belong in the commit body, not the subject
- no periods, no capitalization

### examples

```bash
# ✅ good — direct and keyword-focused
🐛 app: fix card activation crash
✨ server: add user auth endpoint
🩹 app: mirror session cookie as header in auth flow
🥅 server: fallback session delivery via response header
📈 server: fingerprint validator errors by code
♻️ server: flatten ramp providers response
🌐 app: add missing translation keys for onboarding
🍱 app: update card background assets

# ❌ bad — verbose and buries context
🐛 app: fix a crash that happens when a user tries to activate their card
```

### gitmoji usage notes

- 🧑‍💻 `technologist` — improve developer experience. always use for ai/agent related changes (skills, rules, prompts, agent config).
- 🎉 `tada` — begin a project. use only for starting new subprojects.
- 🚧 `construction` — work in progress. use for features not yet ready. these commits are reworded later via rebase. should never be merged to main.
- ⚗️ `alembic` — experiments. use for temporary commits needed to test something on the server, debug, or special instrumentation. should never be merged to main.

## changeset format

file: `.changeset/<random-name>.md`

```markdown
---
"@exactly/<package>": patch
---

<emoji> <message>
```

- **no scope prefix** in changeset description (unlike commit messages)
- **semver level**: almost always `patch`. use `minor` or `major` only when explicitly requested
- **description**: a lowercase sentence in the imperative present tense. same as commit message but without `<scope>:` prefix (unless developer explicitly customizes)
- **publishable packages**: app (`@exactly/mobile`), server (`@exactly/server`), common (`@exactly/common`), contracts (`@exactly/plugin`), substreams (`@exactly/substreams`)

### when a changeset is needed

a changeset is needed when the change has **user-facing impact** — where "user" means **package consumer**:

- for `app`: the end user of the mobile app
- for `server`: anything consuming the api
- for `common`: any package importing from common
- for `contracts`: anything interacting with the contracts
- for `substreams`: anything consuming the substreams

### when a changeset is NOT needed

the guiding principle: if no package consumer could ever notice the difference, there's no changeset. changesets exist so users can trace when behavior changed — if behavior didn't change, there's nothing to trace.

concrete cases that never need a changeset:

- **tests, mocks, snapshots** (✅, 🧪, 🤡, 📸) — internal quality tooling, invisible to consumers
- **type-only changes** (🏷️) — no runtime impact, only affects compile time
- **pure refactors** (♻️) — same inputs, same outputs, different internals
- **non-publishable scopes** — `docs`, `github`, `eas`, `global`, `e2e`, `agents`, `dependencies` don't produce versioned packages

the gray area is refactors. most don't need a changeset, but some do. ask: "if this introduces a bug, would a user benefit from knowing this version is where it started?" if yes, add a changeset — it becomes a breadcrumb for future debugging.

### changeset examples

```markdown
---
"@exactly/server": patch
---

🥅 fallback session delivery via response header
```

```markdown
---
"@exactly/mobile": patch
---

🩹 mirror session cookie as header in auth flow
```

## workflow

execute these steps in order. the developer makes every decision — never auto-commit.

### step 1: smart staging

1. run `git status` (never use `-uall`) and `git diff --staged --stat`
2. if files are already staged, show the staged summary and proceed to step 2
3. if nothing is staged, show the full status and ask the developer what to stage
4. stage the requested files with `git add <specific files>` (never `git add -A` or `git add .`)

### step 2: analyze the diff

1. run `git diff --staged` to read the full staged diff
2. identify: which packages are affected, what changed semantically, whether the change is user-facing

### step 3: gitmoji selection

1. read the full gitmoji list from `node_modules/gitmojis/dist/index.mjs`
2. use `AskUserQuestion` with `multiSelect: true` to present all possibly relevant gitmojis — no count limit, be extensive. each option:
   - **label**: `<emoji> <name>` — some emojis are multi-codepoint: they contain a zero-width joiner (ZWJ, U+200D) or a variation selector (VS16, U+FE0F). terminals often render these as two visible glyphs instead of one. append `*` to the label of any such emoji so the developer isn't confused (e.g., 🧑‍💻\*, ⚗️\*, ♻️\*, 🏷️\*, 🏗️\*, ✏️\*)
   - **description**: a short argument for why this gitmoji fits the change
   - if any option in the list has `*`, append to the question text: `(* may display as two emojis — it's one)`
3. the developer picks 1 or 2 gitmojis

### step 4: scope resolution

determine the scope from staged files:

- files in `server/` → `server`
- files in `src/` or root app files → `app`
- files in `contracts/` → `contracts`
- files in `common/` → `common`
- files in `substreams/` → `substreams`
- files in `docs/` → `docs`
- files in `.github/` → `github`
- files in `.maestro/` → `e2e`
- files in `.agent/` → `agents`
- eas config files (`eas.json`, etc.) → `eas`
- dependency-only changes → `dependencies`
- config files → use the subproject scope if specific to one, otherwise use the tool/platform name (e.g., `eslint`, `prettier`, `nx`)
- everything else → `global`

if files span multiple scopes, suggest splitting into separate commits. if the developer prefers a single commit, let them pick the primary scope.

### step 5: message options

present exactly **9** commit message options — always 9, no less — using the gitmojis the developer chose. number them 1–9. **do NOT use `AskUserQuestion` for this step** — it only supports 4 options. output the 9 options as plain numbered text and let the developer reply with their choice.

format: `<emoji> <scope>: <message>`

rules for messages:

- all lowercase
- start with an imperative verb (add, fix, implement, update, remove, refactor, replace, extract, etc.)
- front-load keywords — most important word first after the verb
- remove filler words (a, the, for, with, of, etc.)
- no trailing punctuation
- be keyword-driven — details belong in the commit body, not the subject
- concise — aim for under 50 characters total

if the scope is obvious (one clear scope from the diff), use it for all 9 options. if ambiguous, use 2-3 different scopes across the options, but this is rare.

the developer picks one option (or writes their own).

### step 6: changeset decision

determine if a changeset is needed using the rules above.

if a changeset is needed:

1. generate a random changeset filename (`<adj>-<animal>-<verb>.md`)
2. the changeset description = the commit message without the `<scope>:` prefix (unless developer explicitly requests a different description)
3. semver level = `patch` (unless explicitly requested otherwise)
4. write the `.changeset/<name>.md` file

### step 7: commit

1. run the `git commit` command with the chosen message using a HEREDOC:

   ```bash
   git commit -m "$(cat <<'EOF'
   <emoji> <scope>: <message>
   EOF
   )"
   ```

2. show the result to the developer
3. do NOT push unless explicitly asked

## important

- never amend a previous commit unless the developer explicitly requests it
- never skip git hooks (no `--no-verify`)
- never push without being asked
- if a pre-commit hook fails, fix the issue and create a NEW commit
- the developer always has final say on every choice
