# onchain layer lazy initialization

## summary

the app startup was blocking on heavy module evaluation from the onchain layer (`@account-kit/infra`, `@aa-sdk/core`, `@peculiar/asn1-*`, `@simplewebauthn/browser`). this work defers all of it via dynamic `import()`, so these modules only load on first rpc call or first passkey authentication — not at app boot.

## motivation

the module dependency graph before this work:

```text
_layout.tsx
  → wagmi/exa.ts (module-level createConfig)
    → publicClient.ts (module-level createAlchemyPublicRpcClient)
      → @account-kit/infra (HEAVY — parsed at startup)
    → alchemyConnector.ts
      → accountClient.ts (static imports: @aa-sdk/core, @peculiar/asn1-*, @simplewebauthn)
```

all of these executed synchronously at app boot, adding significant parse/init time before the splash screen could even begin to hide.

## architecture after this work

```text
_layout.tsx
  → wagmi/exa.ts (createConfig with async custom transport)
    → publicClient.ts (lazy factory, creates client on first RPC call)
      → @account-kit/infra (DEFERRED via import())
    → alchemyConnector.ts (dynamic import("./accountClient") on first auth)
      → accountClient.ts (DEFERRED — only loads when user authenticates)
```

## files changed

### `src/utils/publicClient.ts`

**before:** module-level `createAlchemyPublicRpcClient()` call — the client existed as a static default export.

**after:** a lazy factory function using the singleton-promise pattern:

```typescript
const clients = new Map<number, Promise<ClientWithAlchemyMethods>>();

export default function getPublicClient(target: Chain = chain): Promise<ClientWithAlchemyMethods> {
  let client = clients.get(target.id);
  if (!client) {
    client = (async () => {
      const { alchemy, createAlchemyPublicRpcClient } = await import("@account-kit/infra");
      const { http } = await import("viem");
      return createAlchemyPublicRpcClient({ ... });
    })();
    clients.set(target.id, client);
  }
  return client;
}
```

key design decisions:

- **singleton-promise pattern**: the Map stores `Promise<Client>`, not `Client`. this ensures that concurrent callers before resolution all get the same in-flight promise — no duplicate client creation.
- **`import()` instead of `require()`**: the user preferred this. it's standard es module syntax and doesn't need `eslint-disable` for `unicorn/prefer-module`. trade-off: the function returns a `Promise`, so all callers must `await`.
- **multi-chain ready**: the Map is keyed by `chain.id`, so adding base or other chains later is trivial.
- **type imports are static**: `import type { ClientWithAlchemyMethods }` doesn't cause module evaluation — only the runtime `import()` inside the function body does.

### `src/utils/wagmi/exa.ts`

**before:** `transports: { [chain.id]: custom(publicClient) }` — eager.

**after:** async custom transport that lazily delegates:

```typescript
transports: {
  [chain.id]: custom({
    async request(args) {
      const client = await getPublicClient(chain);
      return client.request(args as never);
    },
  }),
},
```

the `custom()` transport accepts any object with a `request` method. since `request` can return a `Promise`, the async handler works naturally. the `as never` cast is needed because wagmi's internal request type differs from viem's client request type.

### `src/utils/wagmi/owner.ts`

same pattern as `exa.ts` — replaced static `publicClient` import with lazy `getPublicClient()` in the custom transport's request handler. the ternary `c.id === chain.id ? custom(...) : http()` is preserved for non-alchemy chains.

### `src/utils/alchemyConnector.ts`

**three changes:**

1. **dynamic `accountClient` import**: replaced `import createAccountClient from "./accountClient"` with `await import("./accountClient")` inside the async methods (`getAccounts`, `connect`). this removes the heaviest dependency subtree from the startup parse chain entirely.

2. **multi-chain readiness**: replaced exact equality checks (`chainId !== chain.id`) with array membership (`!chains.some(c => c.id === chainId)`). the `chains` array is `[chain] as const` for now — adding more chains is a one-line change.

3. **lazy `getPublicClient`**: `getProvider` returns `await getPublicClient()` as fallback when no `accountClient` exists.

### `src/utils/accountClient.ts`

**two changes:**

1. **`chain` parameter**: the function now accepts an optional second argument (`chain = defaultChain`). the import was renamed to `defaultChain` to allow the parameter to use the natural name `chain` without typescript self-reference errors.

2. **`await getPublicClient(chain)`**: replaced the static `publicClient` import with the async getter. the `custom(await getPublicClient(chain))` call resolves the client before creating the transport.

### `src/app/_layout.tsx`

**conditional es translation loading:**

```typescript
const locale = getLocales()[0]?.languageCode;
const resources: Record<string, { translation: object }> = { en: { translation: en } };
if (locale === "es") resources.es = { translation: require("../i18n/es.json") as object };
```

the `require()` here (not `import()`) is intentional — the i18n initialization is synchronous at module level. `import()` would require making the init async, which could cause a flash of untranslated content. the json file (541 lines) only parses for spanish-speaking users.

note: `require()` still needs `// eslint-disable-line unicorn/prefer-module` in this codebase.

### `src/utils/lifi.ts`

**adapted to async `getPublicClient`:**

- `ensureConfig()` became `async` — it awaits `getPublicClient()` once to access `client.transport.alchemyRpcUrl` for the lifi config.
- all callers (already async functions) now `await ensureConfig()`.
- the `getWalletClient` callback returns `getPublicClient()` directly (it already returns a promise).
- `readContract` usage extracts the client to a local variable first (required by `unicorn/no-await-expression-member`).

## lint learnings

### rules encountered and resolved

| rule | issue | solution |
| ---- | ----- | -------- |
| `perfectionist/sort-imports` | value imports must come before type imports | reorder: value first, `import type` second |
| `@typescript-eslint/consistent-type-imports` | `typeof import("...")` annotations forbidden | use `import type * as Namespace` + `as typeof Namespace` for require casts (not needed with `import()`) |
| `unicorn/no-await-expression-member` | can't do `(await expr).member` | extract to local variable: `const x = await expr; x.member` |
| `unicorn/prefer-module` | flags `require()` | use `// eslint-disable-line unicorn/prefer-module` or switch to `import()` |
| `@typescript-eslint/no-shadow` | parameter shadows import | rename the import (e.g., `defaultChain`) to free the name for the parameter |
| `object-shorthand` | `{ chain: chain }` flagged | use shorthand `{ chain }` when property and variable names match |
| `prettier/prettier` | line > 120 chars or unnecessary line breaks | restructure code to match `printWidth: 120` |

### typescript self-reference constraint

`chain: typeof chain = chain` is invalid — typescript error TS2372 "parameter cannot reference itself". the type annotation `typeof chain` resolves to the parameter being declared, not the outer scope. solution: rename the outer import and omit the type annotation (let it be inferred from the default value).

### `require()` vs `import()` in metro

both defer module execution in react native's metro bundler (the module factory only runs when called, not when the bundle loads). differences:

- `require()`: synchronous, returns the module object. needs `eslint-disable` for `unicorn/prefer-module`. callers can use the result directly.
- `import()`: asynchronous (returns `Promise`), standard es syntax, no lint suppression needed. callers must `await`. preferred in this codebase.

note: neither provides true code splitting in metro — the modules are still in the bundle. the benefit is **deferred execution**: the module's initialization code (class definitions, object allocations, global side effects) doesn't run until the first call.

## multi-chain preparation

the architecture now supports multiple chains at the interface level:

- `publicClient.ts`: Map keyed by `chain.id` — one client per chain.
- `alchemyConnector.ts`: `chains` array checked for membership instead of exact equality.
- `accountClient.ts`: accepts `chain` parameter — same passkey/wallet produces the same deterministic address on any chain.
- `wagmi/exa.ts`: adding a chain is just expanding the `chains` array and adding a transport entry.

**not yet done** (separate future work):

- multi-chain address generation in `common/generated/chain.ts`
- activating base in the `chains` array
- per-chain `accountClient` Map in `alchemyConnector` (currently single variable)
- component-level migration: `useChainId()` instead of static `chain` import

## verification

- `pnpm test:ts` — zero type errors
- eslint on all 7 modified files — zero errors, zero warnings
- no behavior change for single-chain usage (all defaults match previous static values)

## commit

```text
⚡️ app: defer onchain layer initialization via dynamic imports
```

changeset: `.changeset/swift-clients-defer.md` (patch)
