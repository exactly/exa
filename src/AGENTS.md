# app (`src`)

react native and expo for ios, android and web, styled with tamagui, with every piece of data in tanstack query.

## components

- **screens hold the logic**: a screen fetches, keeps state and runs the flow's logic. screens live in `src/components/<feature>/`, re-exported by the route files in `src/app/`.
- **colocate logic by flow**: one user journey (send, borrow, repay, a settings screen) keeps all its logic in one place, however big it gets: easier to reason about, no prop drilling, fewer re-renders. split only flows that could exist on their own.
- **reusable ui stays dumb**: buttons, inputs and cards take data and callbacks through props and know nothing of app state. they live in `src/components/shared/` or next to the screens that use them. the colocation rule is about logic, not markup.
- **composition**: build big screens from small single-purpose components, never one component with dozens of props.
- **props**: minimal. pass the fields a component uses, not whole objects. booleans name the positive condition (`open`, never `notOpen`).

## data

- **tanstack query is the single source of truth**, ui state included (`["settings", "sensitive"]`). keys are arrays that start with the domain: `["activity"]`, never `"user-details"`.
- **no `useEffect` for data**: effects only for setup, cleanup and third-party sdk init.
- **mutations** invalidate what they change in `onSuccess` and `onError`, and give the user feedback.

## styling

- **tamagui tokens only**: `padding="$4"`, `color="$color.text.brand"`, never `16` or `"#ff0000"`. exceptions are tolerated until the v2 migration.
- `XStack` and `YStack` instead of `View`, shorthands (`p="$4"`, `f={1}`) over long props.
- platform styles go through `$platform-web`, `$platform-ios` and media queries. no manual light or dark mode switching.

## navigation

- routes are the files in `src/app` (expo router), and `_layout.tsx` holds a segment's shared ui and logic.
- typed routes are on: `router.push("/send-funds")` is checked at compile time, so routes are literals, never concatenated or template strings.

## commands

- `pnpm nx start mobile` for the dev server, `pnpm nx android mobile`, `pnpm nx ios mobile` or `pnpm nx web mobile` for a platform.
