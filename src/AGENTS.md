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
  - **smart components (screens)**: handle data fetching, state management, and business logic. connected to hooks (`useQuery`).
  - **dumb components (ui)**: receive data and callbacks via props. no knowledge of application state.
- **props**:
  - keep prop interfaces minimal.
  - do not pass entire objects if only a few fields are needed. pass only what's required.
- **inputs in sheets**: on native, `ModalSheet` content gets its owner's updates one commit late, so on ios a controlled input whose state lives in the sheet's owner can drop typed keys. keep that state in a component inside the sheet. the sheet unmounts its content after it closes, so the next open starts empty without a reset or a `key`.
- **inline prop types**: always define component props inline with destructuring. never extract to separate type definitions.
  - ✅ `function Card({ title, isActive }: { title: string; isActive: boolean })`
  - ❌ `type CardProps = { title: string; isActive: boolean }; function Card({ title, isActive }: CardProps)`

## file structure

- **colocation**: place related files together. for a component, this means `component.tsx` and any related hooks or types are in the same directory.
- **feature-based directories**: group files by feature, not by type.
  - ✅ `src/components/send-funds/ContactSheet.tsx`
  - ❌ `src/components/sheets/ContactSheet.tsx`

## state management (tanstack query)

- **single source of truth**: use for all server state and ui state that needs to persist across components.
- **query keys**: must be an array. start with a string identifying the domain, followed by dynamic parameters.
  - ✅ `["activity"]`
  - ✅ `["settings", "sensitive"]`
  - ❌ `'user-details'` (not an array)
- **mutations**: prefer handling `onSuccess` and `onError` to invalidate relevant queries and provide user feedback.

## transactions

- **owner calls**: every call the owner's wallet sends itself goes through `sendOwnerCalls` (`src/utils/accountClient.ts`). it tries `wallet_sendCalls` and, only with `experimental_fallback`, falls back to one transaction per call, each after the previous one succeeded. it never sends again after a failed send (a lost response can hide a broadcast) and appends only the `dataSuffix` a call brings: a `dataSuffix` capability is dropped on fallback.

## styling (tamagui)

- **design tokens only**: all styling must use predefined tokens from `tamagui.config.ts`. never use hardcoded values. a token missing from its scale is dropped silently (dev logs only the first one per session). `space` only has `s*` keys and `radius` only `r*`, so padding, margins and gaps take `$s4`, never `$4`. width and height read `size`, where `$4` resolves to tamagui's 44, not 16.
  - ✅ `padding="$s4"`
  - ✅ `color="$color.text.brand"`
  - ❌ `padding: 16`
  - ❌ `color: '#ff0000'`
- **active states**: tamagui paints a checked checkbox with `$backgroundActive`, which the theme lacks, over its plain `backgroundColor`, and an active toggle with it on hover and focus. style those states through `activeStyle`, as the shared `Checkbox` does, or use `unstyled`.
- **no justified links**: never set `textAlign="justify"` on text with pressable spans. android's hit test ignores justification, so taps miss the link.
- **stacks over views**: use `XStack` and `YStack` for layout instead of react native's `View`.
- **responsive styles**: use platform selectors (`$platform-web`, `$platform-ios`) and media queries for platform-specific styles.

## navigation (expo router)

- **file-based routing**: all routes are defined by the file structure in `src/app`. adhere strictly.
- **typed routes**: expo-router's `typedRoutes` is enabled. string literals like `router.push("/send-funds")` ARE type-checked at compile time - this is not a code smell. do not construct routes via concatenation or template literals.
- **going home**: route to `/(main)/(home)`, or `/(auth)` when signed out, never to `/`: outside the `(main)` group (e.g. `+not-found`) it resolves to the auth index, and `Stack.Protected` silently drops navigation to a guarded screen.
- **ending a flow**: the screen that ends a flow closes in one tap, with an x and no back arrow.
- **layouts**: use `_layout.tsx` files to define shared ui and logic for a route segment.
- **route files**: public expo router routes use `kebab-case`.

## prohibited patterns

- **`useEffect` for data fetching**: forbidden. all data fetching must use tanstack query. useEffect is acceptable only for setup, cleanup, and third-party sdk initialization.
- **manual theme/color logic**: do not write components that manually switch between light/dark mode colors.

## expo fingerprint

- **leave it unchanged**: a fingerprint change forces a new native build and a `minor` release, so make one only when asked.
- **prove it**: after `pnpm install --frozen-lockfile`, run `APP_DOMAIN=localhost pnpm exec fingerprint fingerprint:generate --platform ios`, then `android`, before and after the change, and name changed sources with `fingerprint:diff`. `APP_DOMAIN` is hashed too, and `localhost` reproduces the hash of the e2e workflow on eas.
- **what counts**: `eas.json` is hashed whole. `package.json` and `patches/*` are not hashed as files (`fingerprint.config.cjs`), but the expo config still reads `package.json` (e.g. `description`) and autolinking reads `node_modules`, so patching a js-only package is safe, while patching a package with native code, or changing its peer resolution, renames its store directory and changes the hash.

## development workflow

- **start dev server**: `pnpm nx start mobile`
- **run on platform**: `pnpm nx android mobile`, `pnpm nx ios mobile`, `pnpm nx web mobile`

@../common/AGENTS.md
