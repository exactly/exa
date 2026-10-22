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

- **database columns**: `snake_case` (drizzle maps to `camelCase` in the orm).

## functions

- **prefer function declarations**: use function declarations for all multi-line functions. use function expressions or arrow functions only if the implementation fits on a single line.
  - ✅ `function getStatus(user) { ... }`
  - ✅ `const isActive = (user) => user.active;`
  - ❌ `const getStatus = (user) => { ... };`

## variables

- **one declaration per variable**: declare each variable on its own line.
  - ✅ `const user = {};`
  - ✅ `const items = [];`
  - ❌ `const user = {}, items = [];`
- **use destructuring**: `const { id, name } = user;` not `const id = user.id;`

## imports

- **relative paths**: always use relative paths. avoid tsconfig path aliases.
  - ✅ `import { logger } from '../../../utils/logger';`
  - ❌ `import { logger } from '~/utils/logger';`

## type patterns

- **inline prop types**: always define component props inline with destructuring. never extract to separate type definitions.
  - ✅ `function Card({ title, isActive }: { title: string; isActive: boolean })`
  - ❌ `type CardProps = { title: string; isActive: boolean }; function Card({ title, isActive }: CardProps)`
- **boolean naming**: prefer naked adjectives (`hidden`, `open`, `allowed`). use `is*` prefix only when ambiguous (`isActive`, `isLast`).
- **type inference**: rely heavily on inference. only annotate when necessary for clarity or to catch errors.
  - avoid explicit return types on functions; let typescript infer them.

## validation (valibot)

- **single source of truth**: use valibot for all runtime validation (api inputs, environment variables, etc.).
- **infer types from schemas**: define schemas once and derive typescript types.
  - ✅ `type User = v.InferOutput<typeof UserSchema>;`
  - ❌ `interface User { ... }` (manually defined)
