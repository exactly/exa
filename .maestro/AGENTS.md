# end-to-end tests (`e2e`)

- **stack**: maestro 2.11.0, built from source with `patches/*.patch` into `build/` by `pnpm nx maestro e2e`. scripts run on graaljs, bundled from `src/script/` into `dist/`.
- **flows**: `flows/*.yaml` are the entry points. `flows/web/*.yaml` wrap them with `url:`, since maestro only drives a browser when the top-level config has one. bodies and shared steps live in `subflows/`.
- **legs**: each row of the `e2e` matrix in `.github/workflows/test.yaml` runs one web flow as its own job, with its own signer and screen size. eas runs `flows/local.yaml` (tag `critical`), which chains the bodies native covers, on ios and android.
- **environment**: `pnpm nx e2e:web:release mobile` starts the server's e2e stack (anvil, the contracts and the server, with third parties mocked from `server/test`) and serves the web build on port 8081.

## principles

- **as real as possible**: test the app users run, with real signers: passkeys on a virtual authenticator and metamask in chrome for testing. add no test-only app paths, shims or injected wallets.
- **mock only third parties**: mocks live in `server/test` and behave like the service they replace. they complete immediately, so flows never wait on artificial delays.
- **never bend the app to a test**: do not change app behavior or add aria labels or hooks only to make a flow pass. change the app when users benefit too.
- **no test ids**: never add test ids (`testID`) to the app. flows select what users see or hear: text, or an aria label that serves screen readers too.
- **exercise real ui paths**: reach screens the way users do (tabs, buttons, pickers), not through deep links.
- **prove the outcome**: check the result onchain or through a script (the deposit event, the exact amount and receiver of a transfer), not a ui total that could also pass when the action failed.
- **assert settled states**: never assert intermediate states users are not guaranteed to see, like spinners or pending toasts.

## signers

- **method**: the `method` env picks a leg's signer. empty is the mock wallet, `siwe` is metamask (web only) and `webauthn` is a passkey on the virtual authenticator from `biometrics.patch`.
- **one subflow per interaction**: `subflows/signIn.yaml` holds every sign-in branch and `subflows/sign.yaml` every signature approval. they switch on `method` and platform so flows never do.
- **callers own the rest**: `signIn.yaml` holds method branches only. the greeting, the notifications prompt and anything else after sign-in belong to the caller (`subflows/launch.yaml`).
- **metamask**: `subflows/metamask.yaml` onboards the extension before `launchApp`, with basic functionality off, or the connect prompt never shows. ci passes `--screen-info={3840x2160}` so its popups fit any window.

@../common/AGENTS.md
