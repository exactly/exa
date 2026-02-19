---
name: commit
description: "MANDATORY for ALL git commits. this skill MUST be invoked before running `git commit` — never commit without it. triggers: /commit, 'commit this', 'commit', 'let's commit', 'save this', or any intent to create a git commit. also triggers when you are about to commit on behalf of the user after completing a task. covers commit messages (gitmoji format), staging, signing, and changeset creation."
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
| agents | agent-related changes (`.agents/`) |

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
# good — direct and keyword-focused
🐛 app: fix card activation crash
✨ server: add user auth endpoint
🩹 app: mirror session cookie as header in auth flow
🥅 server: fallback session delivery via response header
📈 server: fingerprint validator errors by code
♻️ server: flatten ramp providers response
🌐 app: add missing translation keys for onboarding
🍱 app: update card background assets

# bad — verbose and buries context
🐛 app: fix a crash that happens when a user tries to activate their card
```

### gitmoji usage notes

- 🧑‍💻 `technologist` — improve developer experience. always use for ai/agent related changes (skills, rules, prompts, agent config).
- 🎉 `tada` — begin a project. use only for starting new subprojects.
- 🚧 `construction` — work in progress. use for features not yet ready. these commits are reworded later via rebase. should never be merged to main.
- ⚗️ `alembic` — experiments. use for temporary commits needed to test something on the server, debug, or special instrumentation. should never be merged to main.
- 🧪 `test_tube` — add a failing test. this is for tdd workflows only. this project does not use it — use ✅ `white_check_mark` instead.

## commit signing

**all commits must be cryptographically signed.** this is non-negotiable.

- always pass `-S` to `git commit`
- never use `--no-gpg-sign`
- never fall back to an unsigned commit under any circumstance

### handling signing failures

signing may fail due to key agent timeouts (e.g., gpg-agent passphrase cache expired, ssh-agent locked, hardware key like yubikey not touched in time). when this happens:

1. **warn the developer**: explain that signing failed (include the error output) and that the commit was not created
2. **ask for acknowledgment**: use `AskUserQuestion` with options like "ready to retry" and "abort commit". do not retry silently
3. **retry with `-S`**: after acknowledgment, run the exact same `git commit -S` command again
4. **repeat if needed**: if signing fails again, go back to step 1. never give up on signing. never strip `-S` to work around the failure

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

"consumers" includes monitoring, instrumentation, logging, and analytics consumers too. if the change alters what an external analyst would see in dashboards, logs, or error tracking, the changeset is definitely required.

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

the workflow is split into a **prep phase** (runs in a `Task` subagent to avoid polluting the main context) and an **interactive phase** (runs in the main agent for user-facing choices).

### prep phase (Task subagent)

launch a `Task` subagent (subagent_type: `general-purpose`). instruct it to perform steps 1–4 below and return **only** the compact summary described in step 4. the subagent must NOT return the full gitmoji list or the full diff — only the summary.

#### step 1: smart staging

1. run `git status` (never use `-uall`) and `git diff --staged --stat`
2. if files are already staged, show the staged summary and proceed to step 2
3. if nothing is staged, run `git diff` to read the full unstaged diff and evaluate **coherence** before staging:

**auto-stage** (no question needed) when all changes form one coherent unit of work — every change is necessary for or directly caused by the same single intent.

**ask the developer** when the diff contains incoherent changes. incoherence signals:

- **different gitmojis** — part of the diff is a fix and another part is a feature
- **drive-by changes** — formatting, typo fixes, import cleanup in files unrelated to the main change
- **independent functional changes** — two unrelated fixes, or a fix + an unrelated improvement, even in the same file
- **formatting mixed with logic** — style/whitespace changes alongside behavioral changes
- **cross-package changes** — server + client changes are separate commits, separate versions, separate deploys
- **dependency changes** — additions/updates in `package.json`/`pnpm-lock.yaml` are always their own commit
- **db schema changes** — migrations or schema modifications are always their own commit, separate from code using the new schema

coherence signals (fine together):

- feature code + its tests within the same package
- implementation + its changeset
- a mechanical refactor applying the same transformation across files (e.g., renaming a symbol, updating an import path, changing a function signature)
- config changes within the same package strictly required by the feature

coherence must be evaluated at the **hunk level**, not the file level — a single file can contain hunks belonging to different intents. working on multiple changes simultaneously and authoring commits separately is normal workflow.

when asking, explain which groups of changes were detected and suggest how to split them. stage only what the developer confirms.

staging must always be granular (never `git add -A` or `git add .`). when all hunks in a file belong to the same intent, `git add <file>` is acceptable. when a file contains hunks for different intents, stage individual hunks programmatically (e.g., generate a patch for the relevant hunks and apply with `git apply --cached`).

#### step 2: analyze the diff

1. run `git diff --staged` to read the full staged diff
2. identify: which packages are affected, what changed semantically, whether the change is user-facing

#### step 3: scope resolution

determine the scope from staged files:

- files in `server/` → `server`
- files in `src/` or root app files → `app`
- files in `contracts/` → `contracts`
- files in `common/` → `common`
- files in `substreams/` → `substreams`
- files in `docs/` → `docs`
- files in `.github/` → `github`
- files in `.maestro/` → `e2e`
- files in `.agents/` → `agents`
- eas config files (`eas.json`, etc.) → `eas`
- dependency-only changes → `dependencies`
- config files → use the subproject scope if specific to one, otherwise use the tool/platform name (e.g., `eslint`, `prettier`, `nx`)
- everything else → `global`

if files span multiple scopes, suggest splitting into separate commits. if the developer prefers a single commit, let them pick the primary scope.

#### step 4: suggest gitmojis and return summary

1. read the full gitmoji list from `node_modules/gitmojis/dist/index.mjs`
2. select all possibly relevant gitmojis for the change — be extensive, no count limit
3. return **only** this compact summary (nothing else):

```text
scope: <resolved scope>
changeset: <yes/no + package name if yes>
summary: <one-line semantic summary of the change>
gitmojis:
- <emoji> <name>: <short reason>
- ...
```

do NOT return the full diff, the full gitmoji list, or any other verbose output.

### interactive phase (main agent)

the main agent receives the compact summary and continues with the developer.

#### step 5: gitmoji selection

**this step is mandatory and interactive.** the developer must explicitly choose the gitmoji — never auto-select, never skip, never pick "the obvious one" on the developer's behalf. even if only one gitmoji seems to fit, present the options and wait for a response.

present the suggested gitmojis using whatever interactive selection mechanism is available. the goal is a clear, scannable list where the developer can respond with minimal effort (a number, a click, or a short reply). guidelines:

- **use the best interactive tool available** — if the environment provides a structured selection ui (e.g., `AskUserQuestion`, a picker widget, a multi-select prompt), use it. if not, fall back to a **numbered list** where each option is on its own line and the developer can reply with a number
- **allow multi-select** (1 or 2 gitmojis) — enable multi-select in the tool if supported, or instruct the developer to reply with multiple numbers
- **each option must include**:
  - **label**: `<emoji> <name>` — some emojis are multi-codepoint: they contain a zero-width joiner (ZWJ, U+200D) or a variation selector (VS16, U+FE0F). terminals often render these as two visible glyphs instead of one. append `*` to the label of any such emoji so the developer isn't confused (e.g., 🧑‍💻\*, ⚗️\*, ♻️\*, 🏷️\*, 🏗️\*, ✏️\*)
  - **description**: a short argument for why this gitmoji fits the change
- **question text**: only if at least one option label ends with `*`, append `(* may display as two emojis — it's one)` to the question. if no option has `*`, do NOT include this footnote
- **scannable formatting** — one option per line, consistent alignment, no walls of text. the developer should be able to scan all options in under 5 seconds

the developer picks 1 or 2 gitmojis. **do not proceed until they respond.**

#### step 6: message options

**this step is mandatory and interactive.** never auto-select a message — always present options and wait for the developer to choose.

present exactly **9** commit message options — always 9, no less — using the gitmojis the developer chose. number them 1–9. output the 9 options as a **plain numbered list** (one per line) and let the developer reply with their choice. do not use a structured selection tool for this step — plain text is intentional because most selection tools cap at 4 options.

format: `<emoji> <scope>: <message>` — **scope is mandatory in every option, never omit it**.

example (given scope `server` and emoji `🐛`):

```text
1. 🐛 server: fix statement data edge cases
2. 🐛 server: handle missing statement entries
3. ...
```

rules for messages:

- **natural prose, not code** — never carry over identifier casing (`camelCase`, `PascalCase`, `snake_case`) from source code. rewrite identifiers as lowercase prose that reads naturally in a sentence. hyphenate compound terms that function as a single modifier:
  - ✅ `auth endpoint` ❌ `authEndpoint`
  - ✅ `validator hook` ❌ `validatorHook`
  - ✅ `session cookie` ❌ `sessionCookie`
  - ✅ `user profile` ❌ `UserProfile` ❌ `user_profile`
  - ✅ `rate-limit middleware` ❌ `rateLimitMiddleware`
- all lowercase, no trailing punctuation
- start with an imperative verb (add, fix, implement, update, remove, refactor, replace, extract, etc.)
- front-load keywords — most important word first after the verb
- prefer single words; use kebab-case only when a compound term is unavoidable
- remove filler words (a, the, for, with, of, etc.)
- be keyword-driven — details belong in the commit body, not the subject
- **concise** — the message (after `<emoji> <scope>:`) should be short. most options 3–5 words, a couple tighter, at most 1–2 slightly longer when extra context genuinely earns its place. if it feels long, cut harder
- **varied perspectives** — the 9 options must not be synonyms of each other. vary the angle: what was done, what it affects, what problem it solves, what it enables. each option should frame the change differently so the developer has a real choice, not the same sentence said 9 ways

if the scope is obvious (one clear scope from the diff), use it for all 9 options. if ambiguous, use 2-3 different scopes across the options, but this is rare.

the developer picks one option (or writes their own). **do not proceed until they respond.**

#### step 7: changeset decision

determine if a changeset is needed using the rules above.

if a changeset is needed:

1. generate a random changeset filename (`<adj>-<animal>-<verb>.md`)
2. the changeset description = the commit message without the `<scope>:` prefix (unless developer explicitly requests a different description)
3. semver level = `patch` (unless explicitly requested otherwise)
4. write the `.changeset/<name>.md` file

#### step 8: signed commit

**every commit must be signed.** the commit message format is `<emoji> <scope>: <message>` — do NOT reuse the changeset description (which omits scope). the commit message chosen in step 6 already has the correct format.

1. stage the changeset (if created in step 7) and commit in a single command:

   ```bash
   git add .changeset/<name>.md && git commit -S -m "$(cat <<'EOF'
   <emoji> <scope>: <message>
   EOF
   )"
   ```

   if no changeset was created, omit the `git add` portion and run only the `git commit -S` command.

2. **if signing succeeds**: show the result to the developer. done.
3. **if signing fails** (exit code non-zero and stderr mentions signing, gpg, ssh, key, timeout, agent, or passphrase):
   1. show the full error output
   2. warn the developer that the commit was **not created** because signing failed — suggest they check their key agent, unlock their hardware key, or re-enter their passphrase
   3. use `AskUserQuestion` with two options: "retry" and "abort"
   4. on "retry": run the exact same `git commit -S` command again and go back to step 2
   5. on "abort": stop the workflow entirely — do **not** fall back to an unsigned commit
   6. there is no retry limit — keep looping through warn → ack → retry as long as the developer chooses to retry
4. do NOT push unless explicitly asked

## invariants

- **gitmoji selection is always interactive** — never auto-select a gitmoji. even if only one seems to fit, present the options and wait for the developer to pick. skipping this step or choosing on behalf of the developer is a workflow violation
- **message selection is always interactive** — never auto-select a commit message. always present all 9 options and wait for the developer to pick or write their own. an agent that composes a message and commits it without presenting options is violating this workflow
- **signing is mandatory** — never run `git commit` without `-S`, never use `--no-gpg-sign`, never commit unsigned
- never amend a previous commit unless the developer explicitly requests it
- never skip git hooks (no `--no-verify`)
- never push without being asked
- if a pre-commit hook fails, fix the issue and create a NEW commit (still signed with `-S`)
- the developer always has final say on every choice
