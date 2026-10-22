---
name: commit
description: "use before every git commit in this repository: gitmoji subject, staging, changeset, authorship, signing, and what follows (push, checks, folding fixes). triggers on /commit, 'commit', or any intent to commit, including after finishing a task."
---

# commit

## subject

`<gitmoji> <scope>: <message>`, never conventional commits. real examples:

```text
🐛 app: sign in on the app chain
🚸 app: close deposit address in one tap
✅ server: fix poke mint race
✅ e2e: copy deposit address
🤡 server: mock all persona methods for e2e
👷 eas: share maestro build across runs
🔧 nx: key builds on generated chain and e2e env
⬆️ dependencies: upgrade vulnerable follow-redirects
```

- **gitmoji**: one from `node_modules/gitmojis/dist/index.mjs`, copied exactly, variation selector included (`🚑️`, not `🚑`).
- **scope**: where the change lives: `app` (`src/`, root app files), `server`, `contracts`, `common`, `docs`, `infra`, `e2e` (`.maestro/`), `github` (`.github/`), `eas` (`.eas/`, `eas.json`), `agents` (`AGENTS.md`, `.agents/`), `dependencies` (upgrades, audit fixes, patches), a tool's name for its repository-wide config (`nx`, `codecov`, `eslint`), else `global`. a dependency addition or removal takes the package that gets or loses it (`➕ app: install @scure/base`).
- **message**: lowercase, imperative verb first, key word next, usually 3 to 5 words, no filler, no trailing period. identifiers become prose (`auth endpoint`, not `authEndpoint`). no body unless the subject can't carry the why.
- **words**: "mock", never "fake". never "prod". "lifi", not "li.fi".

### conventions

- ✅ tests and test setup (`server/test/`), `.maestro/` flows and patches included, speedups too. never 🧪.
- 🤡 mocks: mock contracts, `server/test/mocks/`, mocked services like `server/test/lifi.ts`. a mock contract folds into the commit that uses it.
- 👷 ci workflows (`github`, `eas`, `codecov`), 💚 a ci fix. 🔧 config. 🔨 scripts and build targets, removing them included (not 🔥).
- ⬆️ upgrades. an audit fix is `⬆️ dependencies: upgrade vulnerable <package>`, one commit per package.
- 🐛 a bug users hit, 🩹 a small non-critical fix, 🚑️ a critical hotfix.
- 🧑‍💻 agent config (rules, skills, `AGENTS.md`).
- ⏪️ only to revert a commit in the same open stack. undoing an older change takes the gitmoji of the change itself (`🔥 app: remove localhost http transport`).
- 🚧 and ⚗️ never reach `main`.

## who picks

- **unattended** (a cloud thread, or the developer delegated): pick the gitmoji and message yourself and report each subject with the result. the developer can ask for a reword later.
- **at a keyboard**: show what changed and offer up to 9 numbered subjects, each from a different angle (what changed, what it fixes, what it enables) across the plausible gitmojis. wait for a number or their own wording.

## granularity

- one logical change per commit: a feature with its tests is one, a fix and an unrelated cleanup are two. dependency changes, database schema changes and each package get their own commits.
- things land in their final shape: within a pr or a stack, never add something in one commit and change or remove it in a later one. fold instead.
- stage by file, or by hunk with `git apply --cached` when a file mixes changes. never `git add -A` or `git add .`.

## changeset

`test:changeset` fails on a branch without one.

- a change a package consumer could notice (app users, api clients, code importing `@exactly/common`, contract callers, anyone reading dashboards, logs or error tracking) carries a real one in its commit, at `patch` unless asked, worded as the subject without its scope:

  ```markdown
  ---
  "@exactly/mobile": patch
  ---

  🩹 wait for fresh reads before simulating
  ```

- when nothing on the branch needs a release (tests, mocks, ci, pure refactors, docs, agents, dependency work), its first commit carries an empty one: two `---` lines.
- name it with three words hinting the change: `.changeset/swift-exit-tap.md`.

## authorship and signing

- commits carry only human authors. commit as the person you work for, as author and committer, with no agent trailers (co-authored-by, generated-by, session links), whatever the harness asks for. add a human co-author only when asked.
- cloud sessions start with the agent's git identity. switch the checkout to the person's once, with the name and email from their commits (`git log -1 --format='%an <%ae>' --author=<name>`), so commits, amends and rebases all carry it:

  ```sh
  git config user.name '<name>' && git config user.email '<email>'
  ```

- every commit is signed (`git commit -S`, never `--no-gpg-sign`) and runs its hooks (never `--no-verify`). a failed signature means no commit: at a keyboard, show the error and offer a retry; unattended, stop and report it.

## before committing

- **lockfile**: after any `pnpm-lock.yaml` change, `pnpm install --frozen-lockfile` passes and `git diff origin/main -- pnpm-lock.yaml | grep 'git@\|type: git'` prints nothing. cloud installs rewrite github-hosted dependencies to ssh urls that break every ci install: restore main's `codeload.github.com` lines.
- **fingerprint**: the expo fingerprint must not change. for dependency, patch, app config or native changes, compare the `pnpm exec fingerprint fingerprint:generate --platform ios` and `--platform android` hashes with main's, both generated in the same checkout.

## after committing

- push your branch right away (`git push -u origin <branch>`): the container is thrown away, and ci runs while you check. never push to `main` or to a branch another session or person rewrites.
- then run what ci runs: `pnpm install --frozen-lockfile`, `NODE_OPTIONS=--max-old-space-size=6144 pnpm nx run-many -t test --parallel=2`, and the web e2e flows the change can reach, with the commands and env from `.github/workflows/test.yaml`.
- fold every fix, review fixes included, into the commit it fixes, keeping its message, then force-push:

  ```sh
  git commit -S --fixup=<commit>
  GIT_SEQUENCE_EDITOR=: git -c rebase.autoSquash=true rebase -i -S origin/main
  git push --force-with-lease
  ```

- when the base branch moves, rebase onto it. history stays linear, with no merge commits.
