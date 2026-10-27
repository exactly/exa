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
| docs | documentation-only changes |
| dependencies | dependency changes across projects |
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

✨, 🐛, 🔥, ♻️ and 🔧 are fallbacks: when a more specific gitmoji fits, it wins. neighbors are grouped together so the difference shows.

```bash
# behavior
✨ server: add user auth endpoint
👔 contracts: prevent zero amount proposals
🚸 app: route unsupported tokens to support
🚩 server: restrict miniapp discovery to base
🛂 server: allow cross-origin for frontend assets
🗃️ server: store kyc name and email
✈️ app: show cached balances while offline

# ui and copy
💄 app: align close buttons to start
💫 app: animate card component
📱 app: improve web media queries
♿️ app: respect reduced motion in spinner
💬 app: reword passkeys action button copy
🔍️ app: update meta description
🌐 app: add missing translation keys for onboarding
🍱 app: update card background assets

# fixes
🐛 app: fix card activation crash
🩹 app: mirror session cookie as header in auth flow
🚑️ server: require user verification on authentication
🥅 server: fallback session delivery via response header
🦺 server: validate public key algorithm
🧵 server: prevent concurrent authorizations
🔒️ app: drop secrets from card details query
👽️ server: migrate to new simplewebauthn interface
🦖 app: upgrade plugins from any version
🚨 server: remove unnecessary eslint annotations
✏️ app: fix typos

# code shape
♻️ server: flatten ramp providers response
🎨 contracts: reorder account functions
🏗️ server: use ioredis instead of vercel
🚚 server: move address derivation to common
🏷️ server: add tx hash to alchemy activity type
⚡️ app: stream balances per chain

# removals
🔥 app: remove connection indicator
⚰️ app: remove unused calculation
🗑️ server: deprecate passkey metadata api
💥 server: remove deprecated passkey metadata api

# observability
📈 server: fingerprint validator errors by code
🔊 server: log authorization rejections
🔇 server: remove colored debug logs

# tests
✅ e2e: wait for queued proposals
🤡 server: mock alchemy and sardine on e2e
📸 contracts: update gas snapshot for foundry v1.2

# dependencies
⬆️ dependencies: upgrade viem and wagmi
⬇️ app: downgrade tanstack query
➕ server: add redis-memory-server
➖ server: remove noble curves
📌 contracts: pin openzeppelin-contracts version

# tooling
🔧 nx: refine cache invalidation inputs
🔨 wagmi: generate proposal manager definitions
🧑‍💻 agents: escalate mcp failures to user
👷 eas: share maestro build across runs
🧱 server: skip redis install on docker
🙈 global: ignore local pnpm store
🔐 app: add intercom test workspace keys
📝 docs: document server webhooks

# bad — verbose and buries context
🐛 app: fix a crash that happens when a user tries to activate their card

# bad — generic gitmoji where a specific one fits (🌐, ⚰️)
🐛 app: fix missing send usdc translation
🔥 app: drop unused provider discovery listener

# bad — no imperative verb
🔒️ server: constant-time signature verification
```

### gitmoji usage notes

- 🧑‍💻 `technologist` — improve developer experience. always use for ai/agent related changes (skills, rules, prompts, agent config).
- 🦖 `t-rex` — add backwards compatibility. allowed even though the installed list predates it.
- 💚 `green-heart` — fix ci build. only for a change that exists solely because something external broke ci. our own ci fixes are 👷.
- 🎉 `tada` — begin a project. use only for starting new subprojects.
- 🚧 `construction` — work in progress. use for features not yet ready. these commits are reworded later via rebase. should never be merged to main.
- ⚗️ `alembic` — experiments. use for temporary commits needed to test something on the server, debug, or special instrumentation. should never be merged to main.
- 🧪 `test_tube` — add a failing test. this is for tdd workflows only. this project does not use it — use ✅ `white_check_mark` instead.

## authorship and signing

every commit belongs to the developer operating the agent. they are its author, and the agent leaves no trace of itself: no agent or company name as author, committer, co-author, or anywhere else in the commit.

rebasing never takes authorship away: each commit keeps its original author. when the developer reworks someone else's commit along the way, the agent may add the developer as co-author.

in a local session, every commit carries the developer's signature (`git commit -S`, never `--no-gpg-sign`). a failed signature means no commit: show the error, let the developer unlock their key, and retry. nothing moves on while a local commit is unsigned.

a cloud session has no access to the developer's key, so signing doesn't apply there: commit without `-S`. authorship always does.

## history

until a commit reaches `main`, it is still open: fixes go into the commit that introduced the change, folded in while rebasing, never stacked on top as new commits.

## changeset format

file: `.changeset/<random-name>.md`

```markdown
---
"@exactly/<package>": patch
---

<emoji> <message>
```

- **no scope prefix** in changeset description (unlike commit messages)
- **semver level**: set by each project's rule below. never commit a `major` changeset without an explicit request
- **description**: a lowercase sentence in the imperative present tense. same as commit message but without `<scope>:` prefix (unless developer explicitly customizes)
- **publishable packages**: app (`@exactly/mobile`), server (`@exactly/server`), common (`@exactly/common`), contracts (`@exactly/plugin`)

### semver levels

- **app** (`@exactly/mobile`) doesn't follow semver. every patch in a minor keeps the same expo fingerprint, so all of them receive the same ota updates. a change that alters the fingerprint (compare `pnpm exec fingerprint fingerprint:generate` before and after) is `minor`, and `minor` is reserved for those
- **contracts** (`@exactly/plugin`) follow strict semver and never break backwards compatibility, so they stay on v1. changes to core contracts are `minor` for new features and `patch` for fixes. the plugin's `VERSION` only changes when the plugin itself does, taking the version that release ships in, so plugin versions can skip. previewers and scripts get no changeset
- **server** (`@exactly/server`) stays on v0 until its api is stable, which is still far off. on v0, almost every change is `patch`
- every other package follows semver

### when a changeset is needed

a changeset is needed when the change has **user-facing impact** — where "user" means **package consumer**:

- for `app`: the end user of the mobile app
- for `server`: anything consuming the api
- for `common`: any package importing from common
- for `contracts`: anything interacting with the contracts

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

organize the work however fits the change; these are the goals. split the changes and pick the gitmoji and message yourself: developers review commits after push, so every pick must hold up to that review. when the developer wants to review before committing, present the choices described below and wait for their picks.

### coherent commits

each commit is one coherent unit of work — every change is necessary for or directly caused by the same single intent. when changes are already staged, they are the commit: show the staged summary. look at the tree with `git status` (never `-uall`) and `git diff --staged --stat`, then read the full diff being committed (`git diff --staged`, or `git diff` before staging): scope, gitmoji, message and changeset all rest on it, never on the stat alone.

stage without asking when all changes form one coherent unit of work.

**split the diff** when it contains incoherent changes. incoherence signals:

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
- every upgrade answering the same audit round, across projects too

coherence must be evaluated at the **hunk level**, not the file level — a single file can contain hunks belonging to different intents. working on multiple changes simultaneously and authoring commits separately is normal workflow.

when the developer reviews before committing, explain which groups of changes were detected, suggest how to split them, and stage only what they confirm.

staging must always be granular (never `git add -A` or `git add .`). when all hunks in a file belong to the same intent, `git add <file>` is acceptable. when a file contains hunks for different intents, stage individual hunks programmatically (e.g., generate a patch for the relevant hunks and apply with `git apply --cached`).

### scope

the scope comes from the staged files:

- files in `server/` → `server`
- files in `src/` or root app files → `app`
- files in `contracts/` → `contracts`
- files in `common/` → `common`
- files in `docs/` → `docs`
- files in `.github/` → `github`
- files in `.maestro/` → `e2e`
- files in `.agents/` → `agents`
- eas config files (`eas.json`, etc.) → `eas`
- dependency changes → the project's scope when they touch one project, `dependencies` when they span several
- config files → use the subproject scope if specific to one, otherwise use the tool/platform name (e.g., `eslint`, `prettier`, `nx`)
- everything else → `global`

if files span multiple scopes, split them into separate commits. if the developer prefers a single commit, they pick the primary scope.

### gitmoji

never settle for "the obvious one": weigh every possibly relevant gitmoji from the full list in `node_modules/gitmojis/dist/index.mjs` — be extensive, no count limit — and pick the 1 or 2 that fit best.

gitmojis are how history gets scanned at a glance, so changes to ci, docs, infra or tests keep their own gitmojis (👷, 📝, 🧱, ✅, 🤡, 📸) even when they fix, pin or speed something up. the rest of the list stays with the code the project ships.

when the developer reviews before committing, present the options using whatever interactive selection mechanism is available. the goal is a clear, scannable list where the developer can respond with minimal effort (a number, a click, or a short reply). guidelines:

- **use the best interactive tool available** — if the environment provides a structured selection ui (e.g., a picker widget, a multi-select prompt), use it. if not, fall back to a **numbered list** where each option is on its own line and the developer can reply with a number
- **allow multi-select** (1 or 2 gitmojis) — enable multi-select in the tool if supported, or instruct the developer to reply with multiple numbers
- **each option must include**:
  - **label**: `<emoji> <name>` — some emojis are multi-codepoint: they contain a zero-width joiner (ZWJ, U+200D) or a variation selector (VS16, U+FE0F). terminals often render these as two visible glyphs instead of one. append `*` to the label of any such emoji so the developer isn't confused (e.g., 🧑‍💻\*, ⚗️\*, ♻️\*, 🏷️\*, 🏗️\*, ✏️\*)
  - **description**: a short argument for why this gitmoji fits the change
- **question text**: only if at least one option label ends with `*`, append `(* may display as two emojis — it's one)` to the question. if no option has `*`, do NOT include this footnote
- **scannable formatting** — one option per line, consistent alignment, no walls of text. the developer should be able to scan all options in under 5 seconds

the developer picks 1 or 2 gitmojis. **wait for their response.**

### message

never settle for the first message that comes to mind: write exactly **9** commit message options — always 9, no less — using the chosen gitmojis, then pick the best.

when the developer reviews before committing, number the options 1–9, output them as a **plain numbered list** (one per line) in a regular text message and let the developer reply with their choice. **never use a selection widget for this choice** — most cap below 9 options. plain text is the only reliable format.

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
- **varied perspectives** — the 9 options must not be synonyms of each other. vary the angle: what was done, what it affects, what problem it solves, what it enables. each option should frame the change differently so there is a real choice, not the same sentence said 9 ways

if the scope is obvious (one clear scope from the diff), use it for all 9 options. if ambiguous, use 2-3 different scopes across the options, but this is rare.

when reviewing before committing, the developer picks one option (or writes their own). **wait for their response.**

### changeset

when a changeset is needed (see the rules above), write `.changeset/<name>.md`:

- **filename**: random, `<adj>-<animal>-<verb>.md`
- **description**: the commit message without the `<scope>:` prefix (unless developer explicitly requests a different description)
- **semver level**: by project (see the rules above)

### commit

the commit message format is `<emoji> <scope>: <message>` — do NOT reuse the changeset description (which omits scope). the chosen commit message already has the correct format.

stage the changeset (if any) and commit in a single command:

```bash
git add .changeset/<name>.md && git commit -S -m "$(cat <<'EOF'
<emoji> <scope>: <message>
EOF
)"
```

if no changeset was created, omit the `git add` portion and run only the `git commit -S` command.

show the result to the developer.

## invariants

- **gitmoji selection is always deliberate** — weigh the options even if only one seems to fit. when the developer reviews before committing, they pick
- **message selection is always deliberate** — always write all 9 options before picking. an agent that composes a single message and commits it without weighing alternatives is violating this workflow. when the developer reviews before committing, output all 9 as a plain numbered list in a regular text message, never in a selection widget
- **local signing is mandatory** — never run `git commit` without `-S`, never use `--no-gpg-sign`, never commit unsigned
- never rewrite a commit that is already on `main`
- never push without being asked
- the developer always has final say on every choice
