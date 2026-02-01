---
always_on: false
alwaysApply: false
applyTo: "**/*.ts,**/*.tsx,**/*.js,**/*.jsx,**/*.mjs,**/*.cjs"
globs: "**/*.ts,**/*.tsx,**/*.js,**/*.jsx,**/*.mjs,**/*.cjs"
paths: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"]
trigger: glob
---

# typescript style guide

## naming

- **variables & functions**: `camelCase`.
- **types & interfaces**: `PascalCase`. prefer `type` over `interface`.
- **react components**: `PascalCase`.
- **database columns**: `snake_case` (drizzle maps to `camelCase` in the orm).
- **css-in-js properties (tamagui)**: `camelCase`.

## functions

- **prefer function declarations**: use function declarations for all multi-line functions. use function expressions or arrow functions only if the implementation fits on a single line.
  - ✅ `function getStatus(user) { ... }`
  - ✅ `const isActive = (user) => user.active;`
  - ❌ `const getStatus = (user) => { ... };`

## variables

- **prefer `const`**: use `const` by default. only use `let` if the value will be reassigned.
- **one declaration per variable**: declare each variable on its own line.
  - ✅ `const user = {};`
  - ✅ `const items = [];`
  - ❌ `const user = {}, items = [];`

## imports

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

## type patterns

- **inline prop types**: always define component props inline with destructuring. never extract to separate type definitions.
  - ✅ `function Card({ title, isActive }: { title: string; isActive: boolean })`
  - ❌ `type CardProps = { title: string; isActive: boolean }; function Card({ title, isActive }: CardProps)`
- **inline everything**: avoid intermediate variables for single use. don't create abstractions for one-time operations.
- **satisfies for responses**: always use `satisfies InferOutput<typeof Schema>` on server responses for compile-time validation.
  - ✅ `return c.json({ id, name } satisfies InferOutput<typeof UserResponse>);`
  - ❌ `return c.json({ id, name });`
- **boolean naming**: prefer naked adjectives (`hidden`, `open`, `allowed`). use `is*` prefix only when ambiguous (`isActive`, `isLast`).
- **type inference**: rely heavily on inference. only annotate when necessary for clarity or to catch errors.

## validation (valibot)

- **single source of truth**: use valibot for all runtime validation (api inputs, environment variables, etc.).
- **infer types from schemas**: define schemas once and derive typescript types.
  - ✅ `type User = v.InferOutput<typeof UserSchema>;`
  - ❌ `interface User { ... }` (manually defined)

## modern practices (eslint-plugin-unicorn)

the `plugin:unicorn/recommended` ruleset enforces strict modern javascript best practices:

- **use destructuring**: `const { id, name } = user;` not `const id = user.id;`
- **use object method shorthand**: `{ getName() { ... } }` not `{ getName: function() { ... } }`
- **prefer modern syntax**: `?.`, `??`, `...`, `for...of`
- **no abbreviations** (with exceptions): `error` not `err`, `parameters` not `params`
  - **allowed**: `args`, `db`, `e2e`, `params`, `ref`, `Ref`, `utils`
- **explicit `Number.parseInt()`**: avoid global `parseInt()`
- **`Buffer.from()`**: never `new Buffer()`

## linting & static analysis

- **strict by default**: `eslint:recommended` + `@typescript-eslint/strict-type-checked` + `unicorn/recommended`
- **suppressing errors**: never use `@ts-ignore`. use `@ts-expect-error` with concise explanation.
  - ✅ `// @ts-expect-error third-party lib expects wrong type`
  - ❌ `// @ts-ignore`
  - ❌ `// @ts-expect-error: incorrect type`
  - ❌ `// @ts-expect-error` (missing explanation)
- **eslint suppressions**: use `-- reason` separator only when required by the tool.
  - ✅ `// eslint-disable-next-line no-console -- debug output for ci`
