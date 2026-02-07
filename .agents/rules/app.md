---
always_on: false
alwaysApply: false
applyTo: "src/**/*"
globs: "src/**/*"
paths: ["src/**/*"]
trigger: glob
---

# mobile app (`app`)

- **stack**: react native, expo, tamagui, tanstack query.
- **architecture**: smart components (screens) vs dumb components (ui only). complex logic in one place is preferred - easier to reason about the whole thing.
- **styling**: tamagui tokens preferred. exceptions tolerated until v2 migration. no manual dark mode logic.
- **data**: tanstack query is the single source of truth - including ui state (e.g., `["settings", "sensitive"]`). **no `useEffect` for data fetching**. side effects like navigation setup, cleanup, and third-party sdk init are acceptable.

## component design

- **composition over configuration**: build complex uis by composing smaller, single-purpose components. avoid monolithic components with dozens of props.
- **colocate logic by flow**: when a screen represents a single user journey or state machine, keep all its logic in one place - even if the screen is complex. this applies to onchain operations (send, borrow, repay), settings screens, or any cohesive flow. benefits: easier to reason about the whole picture, avoids prop drilling, simpler debugging, fewer re-renders. split only when combining distinct flows that could exist independently.
- **dumb components are still encouraged**: colocating logic doesn't mean abandoning composition. extract reusable ui (buttons, inputs, cards) as dumb components. the rule is about *logic*, not *markup*.
- **smart vs. dumb components**:
  - **smart components (screens)**: handle data fetching, state management, and business logic. connected to hooks (`useQuery`). location: `src/app/**`.
  - **dumb components (ui)**: receive data and callbacks via props. no knowledge of application state. location: `src/components/**`.
- **props**:
  - keep prop interfaces minimal.
  - do not pass entire objects if only a few fields are needed. destructure and pass only what's required.
  - for boolean props, the name should indicate the positive condition (e.g., `isActive`, `isLoading`). do not use negative names like `isNotActive`.

## state management (tanstack query)

- **single source of truth**: use for all server state and ui state that needs to persist across components.
- **query keys**: must be an array. start with a string identifying the domain, followed by dynamic parameters.
  - ✅ `["activity"]`
  - ✅ `["settings", "sensitive"]`
  - ❌ `'user-details'` (not an array)
- **mutations**: prefer handling `onSuccess` and `onError` to invalidate relevant queries and provide user feedback.

## styling (tamagui)

- **design tokens only**: all styling must use predefined tokens from `tamagui.config.ts`. never use hardcoded values.
  - ✅ `padding="$4"`
  - ✅ `color="$color.text.brand"`
  - ❌ `padding: 16`
  - ❌ `color: '#ff0000'`
- **stacks over views**: use `XStack` and `YStack` for layout instead of react native's `View`.
- **shorthand props**: prefer shorthand for brevity.
  - ✅ `p="$4"`, `m="$2"`, `f={1}`
  - ❌ `paddingLeft="$4"`, `marginRight="$2"`
- **responsive styles**: use platform selectors (`$platform-web`, `$platform-ios`) and media queries for platform-specific styles.

## navigation (expo router)

- **file-based routing**: all routes are defined by the file structure in `src/app`. adhere strictly.
- **typed routes**: expo-router's `typedRoutes` is enabled. string literals like `router.push("/send-funds")` ARE type-checked at compile time - this is not a code smell. do not construct routes via concatenation or template literals.
- **layouts**: use `_layout.tsx` files to define shared ui and logic for a route segment.

## prohibited patterns

- **`useEffect` for data fetching**: forbidden. all data fetching must use tanstack query. useEffect is acceptable only for setup, cleanup, and third-party sdk initialization.
- **manual theme/color logic**: do not write components that manually switch between light/dark mode colors.
- **`any` type**: strictly forbidden. use `unknown` and perform type checking if a type is truly unknown.

## development workflow

- **start dev server**: `pnpm start`
- **run on platform**: `pnpm android`, `pnpm ios`, `pnpm web`
