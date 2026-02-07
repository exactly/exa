---
always_on: false
alwaysApply: false
applyTo: "**/*.yaml,**/*.yml"
globs: "**/*.yaml,**/*.yml"
paths: ["**/*.yaml", "**/*.yml"]
trigger: glob
---

# yaml

these rules apply to all yaml files in the repository.

## file naming

- **extension**: prefer `.yaml` over `.yml`.
- **filenames**: use `kebab-case`, lowercase.
  - ✅ `mobile-beta.yaml`
  - ❌ `mobileBeta.yaml`

## formatting

- **indentation**: 2 spaces, no tabs.
- **trailing commas**: not applicable in yaml.
- **blank lines**: use sparingly to separate logical sections. no multiple consecutive blank lines.

## scalars

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

## collections

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

## multi-line strings

- **literal blocks**: use pipe `|` to preserve newlines (for scripts, commands).

  ```yaml
  run: |
    echo "line 1"
    echo "line 2"
  ```

- **folded blocks**: use `>` sparingly. prefer `|` for clarity.

## anchors & aliases

- **use sparingly**: only when duplication creates a maintenance burden.
- **naming**: use descriptive anchor names.

  ```yaml
  "@aa-sdk/core": &aaSDK ^4.82.1
  "@account-kit/infra": *aaSDK
  ```

## comments

- **sparse comments**: yaml should be self-documenting. avoid unnecessary comments.
- **cspell directives**: use `# cspell:ignore <word>` for technical terms.
- **conditional directives**: tools may use special comment syntax (e.g., `# @if`).
