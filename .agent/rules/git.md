---
always_on: true
alwaysApply: true
applyTo: "**"
trigger: always_on
---
# git & versioning rules

this file defines the mandatory commit message standard for the exa monorepo. it is based on a modified version of [gitmoji](mdc:https:/gitmoji.dev).

the conventional commits specification is **not** used in this project.

## commit message format

all commit messages must strictly adhere to the following format: `<emoji> <scope>: <message>`

- **`<emoji>`**: a single, appropriate gitmoji unicode character from the [official list](mdc:https:/gitmoji.dev).
- **`<scope>`**: a mandatory, short name identifying the part of the codebase affected.
- **`<message>`**: a short, lowercase description of the change.

## core rules

- **use gitmoji**: all commits must start with a single gitmoji. this is not optional. the emoji visually communicates the intent of the change.
- **scope is mandatory**: every commit must have a scope.
- **lowercase everything**: the scope and the message must be in lowercase.
- **be concise**: front-load the most important information. be keyword-driven and avoid filler words. details belong in the commit body.

## scope

the scope provides context for the change.

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

### examples

```bash
# ✅ good
🐛 app: fix card activation crash
✨ server: add user authentication endpoint
📝 docs: update api documentation

# ❌ bad - missing scope
🐛 fix card activation crash

# ❌ bad - wrong capitalization
✨ server: Add user authentication endpoint
```

## choosing the right gitmoji

selecting the correct gitmoji is critical for maintaining a clean and scannable git history.

- **scan the list**: before committing, review the [gitmoji guide](mdc:https:/gitmoji.dev) to find the emoji that most accurately represents your change.
- **be precise**: don't just pick a generic emoji. choose the one that best communicates the *intent* of the commit. for example:
  - ✨ for introducing a new feature.
  - 🐛 for fixing a bug.
  - ♻️ for refactoring code.
  - ⚡️ for improving performance.
  - 📝 for writing docs.
  - 🚀 for deploying code.

## writing effective messages

the start of the commit message is the most important part. many git uis (github, gitlab, `git log --oneline`) only show the first line and will truncate long subjects.

- **front-load keywords**: start with the most impactful words.
- **remove filler words**: omit articles (`a`, `the`), prepositions, and other words that don't add critical meaning.

### examples

```bash
# ✅ good - direct and keyword-focused
🐛 app: fix card activation crash
✨ server: add user auth endpoint
📝 docs: update api reference

# ❌ bad - verbose and buries context
🐛 app: fix a crash that happens when a user tries to activate their card
✨ server: add a new endpoint for user authentication to the api
📝 docs: update the documentation for the api with new examples
```

## prohibited patterns

- **no conventional commit prefixes**: do not use prefixes like `feat:`, `fix:`, or `docs(...)`. the gitmoji replaces the prefix.
- **no uppercase**: do not use title case or sentence case in the subject line.
- **no missing scope**: every commit must have a scope.
- **no long messages**: the entire subject line should be as short as possible.
