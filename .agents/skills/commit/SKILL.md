---
name: commit
description: "MANDATORY for ALL git commits. this skill MUST be invoked before running `git commit` — never commit without it. triggers: /commit, 'commit this', 'commit', 'let's commit', 'save this', or any intent to create a git commit. also triggers when you are about to commit on behalf of the user after completing a task. covers commit messages (gitmoji format), staging, signing, and changeset creation."
---

<!-- cspell:ignore substreams uall -->

# commit

this project uses [gitmoji](https://gitmoji.dev), never conventional commits.

## commit message format

`<emoji> <scope>: <message>`

- **emoji**: one gitmoji from the [official list](node_modules/gitmojis/dist/index.mjs), as its unicode character copied exactly, variation selector included (`🚑️`, not `🚑`). never `:code:` shortcodes, never an emoji outside the list.
- **scope**: mandatory, from the table below.
- **message**: lowercase, an imperative verb first and the most important keyword next, since git uis truncate long subjects. no filler words (a, the, for, with), no trailing punctuation. details go in the body.

### allowed scopes

| scope | covers |
| --- | --- |
| app | `src/` and root app files (`@exactly/mobile`) |
| server | `server/` (`@exactly/server`) |
| contracts | `contracts/` (`@exactly/plugin`) |
| common | `common/` (`@exactly/common`) |
| docs | `docs/` (`@exactly/docs`) |
| infra | `infra/` (`@exactly/infra`) |
| e2e | `.maestro/` |
| github | `.github/` |
| eas | `.eas/`, `eas.json` |
| agents | `AGENTS.md` files, `.agents/` |
| dependencies | dependency upgrades, pins and audit fixes (`⬆️ dependencies: upgrade vulnerable shell-quote and sharp`) |
| global | repository-wide changes that fit no other scope |

- dependency additions and removals take the package that gets or loses them (`➕ app: install @scure/base`).
- config takes its package's scope (`server` for the server's tsconfig), or the tool's name when it's global (`eslint`, `prettier`, `nx`).

### examples

every example below is a real commit from this repository. find the row that matches the change and follow its shape.

| change | example |
| --- | --- |
| bug users hit | `🐛 app: sign in on the app chain` |
| small non-critical fix | `🩹 app: fix premature copy toast` |
| critical hotfix | `🚑️ server: require user verification on authentication` |
| feature | `✨ server: support multiple frontend origins` |
| ui | `💄 app: restyle deposit detail rows` |
| ux | `🚸 app: add market hours notice to swaps` |
| copy | `💬 app: update onboarding carousel copy` |
| translations | `🌐 app: add missing translations` |
| assets | `🍱 app: add ramp assets` |
| animations | `💫 app: improve carousel transitions` |
| accessibility | `♿️ app: respect reduced motion in spinner` |
| performance | `⚡️ app: stream balances per chain` |
| race condition | `🧵 app: fix onesignal init race condition` |
| error handling | `🥅 server: retry trace on resource not found` |
| safety checks | `🦺 server: require keeper role on refund startup` |
| security | `🔒️ server: restrict bridge access by country` |
| business rule | `👔 app: extend installments benefit` |
| feature flag | `🚩 server: restrict miniapp discovery to base` |
| monitoring | `📈 server: identify hook traces by cloud run service` |
| refactor | `♻️ app: centralize stock trading hours` |
| structure, formatting | `🎨 app: sort i18n keys alphabetically` |
| lint fix | `🚨 app: fix lint warning in swaps` |
| move, rename | `🚚 server: move openapi spec to generated` |
| feature removal | `🔥 app: drop support for legacy repay` |
| package removal | `🔥 substreams: remove package` |
| dead code | `⚰️ server: remove unused panda detection` |
| db schema | `🗃️ server: drop passkey counter column` |
| server tests, race fixes | `✅ server: fix poke mint race` |
| e2e (always ✅, speedups too) | `✅ e2e: unlock hooked proposals immediately` |
| mocks | `🤡 server: mock all persona methods for e2e` |
| github workflows | `👷 github: cache metro transforms` |
| eas workflows | `👷 eas: speed up e2e workflow` |
| ci fix | `💚 eas: relax e2e health check timeout` |
| nx config | `🔧 nx: key builds on generated chain and e2e env` |
| build scripts, targets | `🔨 nx: set anvil chain id for test targets` |
| contract scripts | `🔨 contracts: deploy business tenant via createx` |
| contract config | `🔧 contracts: allowlist btcb on bnb` |
| add dependency | `➕ app: install @scure/base` |
| upgrade dependency | `⬆️ app: upgrade tanstack query` |
| audit fix | `⬆️ dependencies: upgrade vulnerable shell-quote and sharp` |
| accepted vulnerability | `🔧 dependencies: ignore braces vulnerability` |
| dependency patch | `🐛 dependencies: patch wagmi-charts cursor gesture` |
| shared code | `✨ common: export app stack identifier` |
| infra | `🧱 infra: route crema through production vpc` |
| docs | `📝 docs: add configuration resources` |
| ignored files | `🙈 global: ignore nvm config` |
| agent config | `🧑‍💻 agents: drop tool-specific rule sections` |

not `🐛 app: fix a crash that happens when a user tries to activate their card`: the subject names the change, the body explains it.

### gitmoji usage notes

- 🧑‍💻 developer experience, and every agent change (rules, skills, prompts).
- 🎉 only to start a new package.
- 🚧 work in progress and ⚗️ experiments (debugging, temporary instrumentation) never reach `main`. 🚧 commits get reworded by rebase first.
- ✅ for tests, never 🧪, which means a failing tdd test.

## authorship

commits carry only human authors. an agent commits as the person it works for, as both author and committer, and adds no co-author, generated-by or session trailers. when the machine's git identity is someone else, pass `--author` and set `GIT_COMMITTER_NAME` and `GIT_COMMITTER_EMAIL`.

## commit signing

every commit is signed: always `git commit -S`, never `--no-gpg-sign`, never an unsigned fallback.

when signing fails (an expired gpg-agent cache, a locked ssh-agent, a hardware key not touched in time), the commit doesn't exist. show the error, suggest unlocking the key, ask whether to retry or abort, and retry the exact same command for as long as the developer wants. never retry silently or drop `-S`. unattended, nobody can unlock the key: stop and report the error.

## changeset format

`.changeset/<adjective>-<animal>-<verb>.md`, at `patch` unless asked otherwise, described by the commit message without its scope (unless the developer words it differently):

```markdown
---
"@exactly/server": patch
---

🥅 fallback session delivery via response header
```

### when a changeset is needed

when a consumer of a versioned package could notice the change: app users (`@exactly/mobile`), api clients (`@exactly/server`), packages importing `@exactly/common`, anything calling the contracts (`@exactly/plugin`), docs readers (`@exactly/docs`), services on the infra (`@exactly/infra`). monitoring counts: a change to what an analyst sees in dashboards, logs or error tracking needs one.

none for tests, mocks and snapshots (✅, 🤡, 📸), type-only changes (🏷️), pure refactors (♻️) or unversioned scopes (`github`, `eas`, `global`, `e2e`, `agents`, `dependencies`). for a refactor, ask: if it introduced a bug, would a user want to know which version started it? if so, add one.

a branch that touches any package (the app is the repository root) needs at least one changeset, or `test:changeset` fails. when nothing needs a release, add an empty one with `pnpm changeset add --empty`.

## workflow

execute these steps in order. in an attended session the developer makes every decision — never auto-commit.

in an unattended session (nobody can answer, or the developer delegated the picks) you make the decisions: split incoherent changes into separate commits, pick the gitmoji and the message following the examples, commit, and report each commit's picks with it.

steps 1 to 4 run in a general-purpose subagent when the tool has one, so the diff stays out of the main context, and it returns only the summary from step 4. steps 5 to 8 run in the main agent, with the developer.

### step 1: staging

run `git status` (never `-uall`) and `git diff --staged --stat`. if something is staged, use it. otherwise read `git diff` and judge coherence hunk by hunk, since one file can hold several intents:

- **coherent**, staged without asking: every change serves one intent, like a feature with its tests in one package, a change with its changeset, one mechanical refactor across files (a rename, an import path, a signature) or config the change strictly needs.
- **incoherent**, ask the developer how to split, naming the groups you found: changes that would take different gitmojis, drive-by formatting or typo fixes, unrelated fixes even in one file, formatting mixed with logic, several packages (separate versions and deploys), dependency changes (`package.json`, `pnpm-lock.yaml`), and schema changes (`server/database/schema.ts`) apart from the code using them. stage only what they confirm.

stage precisely, never `git add -A` or `git add .`: `git add <file>` when every hunk in it belongs to the commit, otherwise only its hunks (a patch through `git apply --cached`).

### step 2: analysis

read `git diff --staged`: which packages changed, what changed semantically, and whether consumers could notice.

### step 3: scope

resolve it from the staged files with the scope table. files in several scopes mean several commits; if the developer still wants one, they pick the scope.

### step 4: summary

read the gitmoji list (`node_modules/gitmojis/dist/index.mjs`), pick every possibly relevant gitmoji, and return only this, never the diff or the whole list:

```text
scope: <resolved scope>
changeset: <yes/no + package name if yes>
summary: <one-line semantic summary of the change>
gitmojis:
- <emoji> <name>: <short reason>
- ...
```

### step 5: gitmoji

mandatory and interactive: the developer chooses, even when only one gitmoji fits. present the suggestions with the best selection tool available (a picker, a multi-select prompt) or as a numbered list, one option per line, `<emoji> <name>` with a short reason, scannable in five seconds. the developer may pick 1 or 2. append `*` to the label of any emoji with a zero-width joiner or a variation selector (🧑‍💻\*, ⚗️\*, ♻️\*, 🏷️\*), since terminals often draw them as two glyphs, and only then add `(* may display as two emojis — it's one)` to the question. wait for the answer.

### step 6: message

mandatory and interactive: exactly 9 options, numbered, as a plain list in a regular message (selection widgets cap below 9), each `<emoji> <scope>: <message>` with the chosen gitmojis and always the scope:

```text
1. 🐛 server: fix statement data edge cases
2. 🐛 server: handle missing statement entries
3. ...
```

on top of the message rules above:

- identifiers become prose: `auth endpoint`, not `authEndpoint`; `user profile`, not `UserProfile` or `user_profile`. hyphenate compound modifiers (`rate-limit middleware`).
- prefer single words. most options take 3 to 5 words, a couple fewer, one or two more when the context earns it.
- every option takes its own angle (what was done, what it affects, what it fixes, what it enables), never 9 synonyms.
- one scope for all 9 when it's obvious, 2 or 3 across the options in the rare ambiguous case.

the developer picks one or writes their own. wait for the answer.

### step 7: changeset

when one is needed (see changeset format), write `.changeset/<adjective>-<animal>-<verb>.md` with the chosen message minus its scope, at `patch`.

### step 8: signed commit

stage the changeset, if any, and commit in one command, with the message from step 6 (not the changeset description, which has no scope):

```bash
git add .changeset/<name>.md && git commit -S -m "$(cat <<'EOF'
<emoji> <scope>: <message>
EOF
)"
```

show the result to the developer. if signing fails, follow "commit signing" above.

## invariants

- in attended sessions the developer picks the gitmoji (step 5) and the message (step 6) from the options you present. composing a message and committing it on your own is a violation.
- every commit is signed.
- never amend a previous commit unless the developer explicitly requests it, or to fold a review fix into the commit it fixes (root `AGENTS.md`).
- never skip git hooks (`--no-verify`). when a hook fails, fix the cause and make a new signed commit.
- the developer has the final say on every choice.
