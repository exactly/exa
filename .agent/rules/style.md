---
always_on: true
alwaysApply: true
applyTo: "**"
paths: "**"
trigger: always_on
---

# style guide

## guiding principles

- **simplicity and clarity**: write code that is easy to read, understand, and maintain. avoid cleverness for its own sake. prefer explicit over implicit.
- **consistency**: consistency is more important than personal preference. adhere to the established patterns in the codebase.
- **type safety first**: leverage typescript, valibot, and solidity types to catch errors at compile time, not run time. `any` is forbidden.
- **automation and tooling**: rely on tools (eslint, prettier, forge fmt, markdownlint) to enforce style. do not argue with the linter.
- **obsessive attention to detail**: every line of code, every comment, and every commit message reflects the quality of the project.

## naming philosophy

this project's naming conventions are heavily influenced by bob nystrom's article "[long names are long](mdc:https:/journal.stuffwithstuff.com/2016/06/16/long-names-are-long)". the goal is to choose names that are clear and precise, but no longer. every character should earn its place.

- **omit redundant type names**: do not include the type in a variable's name. let the static type system do its job.
  - ✅ `const user: User`
  - ❌ `const userObject: User`
  - ✅ `const holidays: Date[]`
  - ❌ `const holidayDateList: Date[]`

- **omit contextual names**: do not repeat the name of a class or module within its members. the context is already known.
  - ✅ `class User { getProfile() { ... } }`
  - ❌ `class User { getUserProfile() { ... } }`

- **omit meaningless words**: avoid fluff words that carry no meaningful information. usual suspects include `data`, `state`, `manager`, `engine`, `object`, `entity`, and `instance`.
  - ✅ `function getProfile(user: User)`
  - ❌ `function getUserProfileData(userData: User)`

- **use plurals for collections**: for collections, use a plural noun describing the contents, not a singular noun describing the collection itself.
  - ✅ `const users: User[]`
  - ❌ `const userList: User[]`

## functions

- **prefer function declarations**: use function declarations for all multi-line functions. use function expressions or arrow functions only if the implementation fits on a single line.
  - ✅ `function getStatus(user) { ... }`
  - ✅ `const isActive = (user) => user.active;`
  - ❌ `const getStatus = (user) => { ... };`

## global conventions

### capitalization

a core principle is specific capitalization for different contexts. this must be followed with obsessive precision.

- **internal documentation prose (`.mdc` files, `readme.md`):** all narrative text (headings, paragraphs, list items, proper nouns, brand names) must be **lowercase**. there are no exceptions.
  - ✅ `...built with astro and the starlight theme.`
  - ❌ `...built with Astro and the Starlight theme.`
- **referring to code in prose:** when discussing a code concept (like a variable or function name) in a sentence, use regular lowercase words. the correctly-cased identifier itself must only appear inside backticks.
  - ✅ `for boolean props, the name should indicate a positive condition (e.g., \`isActive\`).`
  - ❌ `for boolean props, the name should be isActive.`
- **code examples:** any identifier inside backticks (`` ` ``) or a code fence (` ``` `) is considered code, not prose. it must strictly follow the casing rules defined in this file.
- **code comments:** all code comments must be lowercase.
- **user-facing documentation (`docs/`):** use proper sentence case.
- **changeset summaries:** use a lowercase sentence in the imperative present tense. (e.g., `implement x feature for y.`).
- **git commit messages**: must be lowercase.

### naming

- **files and directories**: directories and public expo router routes must use `kebab-case`. all other files must be named identically to their `default` export. if a file has multiple exports, it should be `camelCase`, with a strong preference for a single word.
  - ✅ `src/components/user-profile/` (directory)
  - ✅ `app/(app)/add-funds.tsx` (route)
  - ✅ `UserProfile.tsx` (for `export default function UserProfile`)
  - ✅ `useUserProfile.ts` (for `export default function useUserProfile`)
  - ✅ `colors.ts` (for `export const red = ...; export const blue = ...;`)
  - ❌ `src/components/UserProfile/` (directory)
  - ❌ `user-profile.tsx` (for `export default function UserProfile`)
  - ❌ `Colors.ts` (for a file with multiple exports)
- **typescript variables & functions**: `camelCase`.
- **typescript types & interfaces**: `PascalCase`.
- **react components**: `PascalCase`.
- **css-in-js properties (tamagui)**: `camelCase`.
- **database columns**: `snake_case`. (drizzle handles the mapping to `camelCase` in the orm).
- **solidity variables & functions**: `camelCase`.
- **solidity contracts & structs**: `PascalCase`.

### variables

- **prefer `const`**: use `const` for all variable declarations by default. only use `let` if the variable's value will be reassigned. this practice helps prevent accidental mutations and signals the programmer's intent.
- **one declaration per variable**: declare each variable on its own line with its own `const` or `let` keyword.
  - ✅ `const user = {};`
  - ✅ `const items = [];`
  - ❌ `const user = {}, items = [];`

### file structure

- **colocation**: place related files together. for a component, this means `component.tsx`, `component.test.tsx`, and any related hooks or types are in the same directory.
- **`index.ts` barrels**: use `index.ts` files to re-export modules from a directory, simplifying import paths.
- **feature-based directories**: group files by feature, not by type.
  - ✅ `src/features/authentication/components/login-button.tsx`
  - ❌ `src/components/authentication/login-button.tsx`

### code formatting (prettier)

- **maximum compactness**: the project enforces a maximally compact code style. do not introduce line breaks inside objects, arrays, or function arguments voluntarily. let `prettier` break lines automatically only when a line exceeds the `printWidth`.

### imports

- **relative paths**: always use relative paths for imports within the project. avoid tsconfig path aliases.
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

### modern code practices (enforced by eslint-plugin-unicorn)

the `plugin:unicorn/recommended` ruleset is enabled globally, enforcing a strict set of modern javascript best practices. these are not optional. key rules include:

- **use destructuring**: use object and array destructuring to access and use properties. it avoids creating temporary references and makes code more concise.
  - ✅ `const { id, name } = user;`
  - ❌ `const id = user.id; const name = user.name;`
- **use object method shorthand**: when a function is a property of an object, use the shorthand syntax.
  - ✅ `const user = { getName() { ... } };`
  - ❌ `const user = { getName: function() { ... } };`
- **prefer modern syntax**:
  - `?.` for optional chaining.
  - `??` for nullish coalescing.
  - `...` for object and array spreading.
  - `for...of` loops instead of traditional `for` loops with an index variable.
- **no abbreviations** (with exceptions): the `unicorn/prevent-abbreviations` rule is active but has an allowlist for framework conventions and common terms.
  - ✅ `error`, `parameters`, `request`
  - ❌ `err`, `params`, `req`
  - **allowed exceptions**: `args`, `db`, `e2e`, `params`, `ref`, `Ref`, `utils` (framework conventions that earn their place through ubiquity)
- **explicit `Number.parseInt()`**: when parsing numbers, `Number.parseInt()` must be used instead of the global `parseInt()` to avoid subtle bugs with different radices.
- **no useless constructs**: avoid `undefined`, returning `undefined` from a function, and unnecessary `if` statement nesting.
- **consistent casing for `new`**: all classes called with `new` must be `PascalCase`.
- **`Buffer` from `Buffer.from()`**: `new Buffer()` is deprecated and unsafe; always use `Buffer.from()`, `Buffer.alloc()`, or `Buffer.allocUnsafe()`.

### linting & static analysis

the project employs a highly strict and comprehensive eslint configuration to automatically enforce code quality, style, and correctness. the configuration is not a generic baseline; it is a core part of the development process and is considered non-negotiable.

- **strict by default**: the configuration is built upon `eslint:recommended`, `plugin:@typescript-eslint/strict-type-checked`, and the highly opinionated `plugin:unicorn/recommended`. this enforces the highest level of type safety and modern code practices.
- **suppressing errors**: the use of `@ts-ignore` is strictly forbidden. if you must suppress a type error, use `@ts-expect-error`. it must be followed by a concise, single-line comment on the same line explaining why the error is expected. do not use separators like `-` or `:`.
  - ✅ `// @ts-expect-error incorrect type is expected by third-party library`
  - ❌ `// @ts-ignore`
  - ❌ `// @ts-expect-error: incorrect type`
  - ❌ `// @ts-expect-error - incorrect type`
  - ❌ `// @ts-expect-error` (missing explanation)
- **architectural enforcement**: linting rules are used to enforce architectural boundaries. for example, `no-restricted-imports` is configured to prevent the mobile app from importing directly from the `server` package, ensuring proper separation of concerns.
- **disabled rules**: any eslint rule that is disabled has been done so for a specific, documented reason (e.g., incompatibility with `react-native` or `prettier`). these are not arbitrary choices and should not be changed.

### validation

- **valibot**: use valibot for all runtime validation (api inputs, environment variables, etc.). it is the single source of truth for data schemas.
- **schema definition**: define schemas once and reuse them. infer typescript types from valibot schemas wherever possible.
  - ✅ `type User = v.InferOutput<typeof UserSchema>;`
  - ❌ `interface User { ... }` (manually defined)

### typescript patterns

- **inline prop types**: always define component props inline with destructuring. never extract to separate type definitions.
  - ✅ `function Card({ title, isActive }: { title: string; isActive: boolean })`
  - ❌ `type CardProps = { title: string; isActive: boolean }; function Card({ title, isActive }: CardProps)`
- **inline everything**: avoid declaring intermediate variables for single use. inline as much as possible. don't create abstractions for one-time operations.
- **satisfies for responses**: always use `satisfies InferOutput<typeof Schema>` on server responses to validate return types at compile time.
  - ✅ `return c.json({ id, name } satisfies InferOutput<typeof UserResponse>);`
  - ❌ `return c.json({ id, name });`
- **boolean naming**: prefer naked adjectives for conciseness (`hidden`, `open`, `allowed`). use `is*` prefix only when the adjective alone would be ambiguous (`isActive`, `isLast`).
- **type inference**: rely heavily on inference. let typescript do its job. only annotate when necessary for clarity or to catch errors.

### comments

- **comments are noise**: prefer self-documenting code. good code with clear naming and structure never needs comments. the only acceptable comments are annotations for static analysis tools.
- **static analysis annotations**: these are the only acceptable comment types:
  - `// @ts-expect-error reason` - for expected type errors (never use `@ts-ignore`)
  - `// eslint-disable-next-line rule-name -- reason` - for eslint suppressions
  - `// slither-disable-next-line check-name -- reason` - for slither suppressions
  - `// solhint-disable-next-line rule-name` - for solhint suppressions
- **annotation format**: explanations must be brutally concise. only use `--` separator when strictly required by the tool (varies by tool). no colons, no dashes otherwise.
  - ✅ `// @ts-expect-error third-party lib expects wrong type`
  - ✅ `// eslint-disable-next-line no-console -- debug output for ci`
  - ❌ `// @ts-expect-error: incorrect type`
  - ❌ `// @ts-expect-error - incorrect type`
- **todo/fixme**: use sparingly. uppercase tag, single space, lowercase explanation.
  - ✅ `// TODO implement retry logic`
  - ❌ `// todo: implement retry logic`

### abstractions

- **avoid premature abstraction**: don't add helpers, utilities, or abstractions for one-time operations. three similar lines of code is better than a premature abstraction. don't design for hypothetical future requirements.
- **when abstraction is acceptable**: encapsulate complexity only when there's a foot-gun - a call that must always have an argument that can be easily forgotten. these are exceptions, not the rule.
- **prefer raw library knowledge**: it's better to use libraries directly and understand their apis than to wrap them in project-specific abstractions. the team should know the tools.
  - ✅ calling `queryClient.setQueryData()` directly
  - ❌ wrapping it in `useSetUserData()` for a single use case

## ai assistant directives

- **adopt, do not replace**: your primary role is to adopt and enforce the project's established conventions. never replace a core convention (e.g., the `gitmoji` commit format) with a different one (e.g., `conventional commits`), even if you believe it is superior.
- **respect the style guide**: you must follow all rules within the `.mdc` files for any code, documentation, or rules you write. this includes meta-rules like the "lowercase prose" convention for all internal documentation, including the rules themselves.
- **understand the intent**: do not interpret rules in the most literal way possible. understand the spirit and goal behind them. for example, a rule for "concise" messages implies front-loading keywords and removing filler words, not just meeting a character count.
- **diff-friendliness**: when modifying code, consider the diff. avoid adding items at the end of lists. prefer sorted or middle insertions. structure changes to be minimal and reviewable.
