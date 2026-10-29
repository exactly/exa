# end-to-end tests (`e2e`)

- **stack**: maestro 2.12.0, built from source with `patches/*.patch` into `build/` by `pnpm nx maestro e2e`. scripts run on graaljs, bundled from `src/script/` into `dist/`.
- **flows**: `flows/*.yaml` are the entry points, shared by every platform. web runs pass `--platform web -e APP_ID=http://localhost:8081` (`platform.patch`). bodies and shared steps live in `subflows/`.
- **legs**: each row of the `e2e` matrix in `.github/workflows/test.yaml` runs one web flow as its own job, with its own signer and screen size, through its signer's target: `e2e:webauthn`, `e2e:metamask` or `e2e:brave`. `package.json` defines them: each waits for the stack and runs the flow with every flag the leg needs, once `brave` or `metamask` has fetched its browser. a leg replays from the nx cache while nothing it runs against changed (this project, the app, the server, the contracts and common), and ci passes `--skip-nx-cache` so every leg runs and reports coverage. eas runs `flows/local.yaml` (tag `critical`), which chains the bodies native covers, on ios and android.
- **environment**: `pnpm nx e2e:web:release mobile` starts the server's e2e stack (anvil, the contracts and the server, with third parties mocked from `server/test`) and serves the web build on port 8081.
- **camera**: `camera.ts` writes `generated/<flow>.y4m` on install, a still frame of the qr code that leg scans. the signer targets play it through chrome's fake camera on flows that have one, so each leg scans a single code.

## principles

- **as real as possible**: test the app users run, with real signers: passkeys on a virtual authenticator, metamask in chrome for testing and brave's built-in wallet. add no test-only app paths, shims or injected wallets.
- **no seeds**: web legs sign with a new passkey or a wallet created in the browser. no web leg imports a seed.
- **mock only third parties**: mocks live in `server/test` and behave like the service they replace. they complete immediately, so flows never wait on artificial delays.
- **never bend the app to a test**: do not change app behavior or add aria labels or hooks only to make a flow pass. change the app when users benefit too.
- **no test ids**: never add test ids (`testID`) to the app. flows select what users see or hear: text, or an aria label that serves screen readers too.
- **exercise real ui paths**: reach screens the way users do (tabs, buttons, pickers), not through deep links.
- **prove the outcome**: check the result onchain or through a script (the deposit event, the exact amount and receiver of a transfer), not a ui total that could also pass when the action failed.
- **assert settled states**: never assert intermediate states users are not guaranteed to see, like spinners or pending toasts.

## latency

- **the longest leg cannot go up**: no change may raise the slowest leg's time. keep it in budget by speeding up or moving steps, never by dropping coverage.
- **coverage may cost time, duplicates may not**: new coverage can raise the total sequential time of the legs and the native runs when it checks a user path no other step checks. measure what each added step costs, keep it to the minimum the check needs, and state the cost and what it buys in the pr.
- **happy paths pay nothing for edge cases**: handling a special case (an optional sheet, a fallback, an error path) adds no time to a run that doesn't hit it. a saving elsewhere never pays for it.
- **measure per step**: read step durations from `commands.json` in maestro's test output (`~/.maestro/tests`, uploaded with each leg's artifacts) or from `maestro.log`, and compare flow and step times on the same base. job and run totals swing by tens of seconds with install and cache times, so never infer a cost or a saving from them.
- **legs have a fixed cost**: a web leg spends about 3.5 min on setup before maestro starts, so a new leg costs far more than a few steps in an existing one.
- **native runs in sequence**: `flows/local.yaml` chains its bodies on each platform, so a step added to one of them adds native time too.
- **compare like with like**: a local run takes about 1.2x the ci time. compare local with local and ci with ci.

## maestro timing

- **taps wait to settle**: on web, a tap waits for the view hierarchy to stop changing, polling every 200 ms and giving up after ten tries. a quiet tap costs about 1.5 s on ci, and one that starts a spinner pays the full settle without proving the action finished, so when completion matters, wait for the next expected state. drop taps the outcome does not need.
- **lookups**: `tapOn` and `assertVisible` wait up to 17 s for their element, 7 s when optional.
- **probes share a window**: `when: { visible }` and `when: { notVisible }` wait up to 7 s from the last interaction, so consecutive probes share that window and removing one moves its wait to the next. a probe whose condition is false pays the rest of the window: track state the flow set itself with `output` flags instead. a `true:` condition is checked first, so a false script condition skips the probe.
- **nothing moves forever**: settle compares the bounds of every node, so a continuous animation (carousel, progress bar, looping spinner) makes every tap near it wait the full settle. app animations stop when hidden and respect reduced motion, which ci forces with `--force-prefers-reduced-motion`.
- **positive checks only**: wait for what should appear next, or read chain state from a script. no sleeps, `waitForAnimationToEnd` or negative visibility asserts unless a measurement proves them necessary.
- **scroll only as needed**: `subflows/scrollTo.yaml` wraps `scrollUntilVisible`. pass `center` only when the element can end up behind the floating tab bar: centering costs about one swipe, and at the end of a page it keeps swiping for seconds, so use `offset` there. `copyTextFrom` only reads text and never needs centering.
- **keyboard**: `hideKeyboard` is nearly free on web, and with one swipe it beats a slow `scrollTo` under an open keyboard. `pressKey: enter` works on every platform but costs about 0.4 s on ios, 0.7 s on android and 0.8 s on web, so use it only where `hideKeyboard` fails.
- **scripts are not free**: graaljs takes seconds to run `mnemonicToAccount` (pbkdf2). compute values once and keep them in `output`, as `subflows/getAccount.yaml` does. a plain rpc call beats a deployless read.
- **refresh instead of polling**: pending requests refetch every 30 s, so tap Home to refresh them instead of waiting.

## signers

- **method**: the `method` env picks a leg's signer. empty is the mock wallet (native only), `metamask` is the metamask extension (web only), `brave` is brave's built-in wallet (web only) and `webauthn` is a passkey on the virtual authenticator from `biometrics.patch`.
- **one subflow per interaction**: `subflows/signIn.yaml` holds every sign-in branch, `subflows/sign.yaml` every signature approval and `subflows/logout.yaml` the passkey log out and back in. they switch on `method` and platform so flows never do.
- **callers own the rest**: `signIn.yaml` holds method branches only. the greeting, the notifications prompt and anything else after sign-in belong to the caller (`subflows/launch.yaml`).
- **metamask**: `subflows/metamask.yaml` onboards the extension with a new wallet and basic functionality off, or the connect prompt never shows. the `metamask` script fetches the extension and runs it once with `--platform web` into a chrome profile, again only when the script or the onboarding steps change, and ci caches both. metamask legs start from a copy of that profile, where metamask opens its unlock page on its own and `subflows/launch.yaml` unlocks it before `launchApp`. the wallet starts without funds on every run, so a leg funds `output.credential` before metamask sends a transaction. its legs pass `--screen-info={3840x2160}` so its popups fit any window.
- **brave**: `subflows/brave.yaml` creates a new wallet in `chrome://wallet` before `launchApp`. headless brave rejects every wallet request, so its leg runs headed under `xvfb-run`. its approval panel is browser ui, not a window, and `windows.patch` follows it while it shows. after a transaction the panel stays open on its status until `pressKey: escape` closes it, so `subflows/sign.yaml` presses it when its caller passes `transaction`.

## selectors

- **web text**: on web, an element's text is only its own text nodes, so nested react native `Text` becomes several elements. assert one that holds the whole text.
- **aria labels**: on web, an aria label becomes the element's resource id instead of its text ([maestro#2914](https://github.com/mobile-dev-inc/Maestro/issues/2914)). tap, copy and dismiss labeled elements through `tapAria.yaml`, `copyAria.yaml` and `tapWhileAria.yaml`. `tapAria.yaml` takes an `index` when a label repeats. the resource id comes from the first of the id, aria label, name, title, for and test id attributes.
- **disambiguate**: use `below:` when a text appears twice. typed text matches tap selectors too, so type a part of the name you tap next (`eth`, then tap `WETH`).
- **offscreen elements**: maestro web drops elements outside the viewport or entirely hidden by a scroll container, and trims partly hidden ones to their visible part (`bounds.patch`), so taps land on what users see. scroll before asserting them.
- **yaml**: quote yaml 1.1 booleans like `"On"` and regexes with `?`. check edited flows with `.maestro/build/bin/maestro check-syntax <file>`.

## platforms

- **no platform branches in flows**: a platform difference lives in the one subflow that owns the interaction (`tapAria.yaml`, `sign.yaml`), never in flow bodies. prefer a step every platform can run over a branch.
- **android**: `eraseText` deletes backward from the caret and a tap leaves the caret where it lands, so never tap and erase a prefilled field; amount fields select their text on focus instead. android 13 and later show a clipboard overlay for a few seconds after each copy. a tap right after a sheet opens can race its slide-in.
- **ios**: `hideKeyboard` misses the number pad and can fail on text fields too (the beneficiary form in `NewRecipient.tsx`), so use `pressKey: enter` there. a field under a pinned button counts as visible, so `scrollTo` does not scroll to it. a pressable row reads as one label of its texts joined by commas, so match a row's text as `(.*, )?text(, .*)?`.

## patches

- **maestro gaps only**: patch maestro for a maestro bug or a missing capability, never to work around the app or a flow.
- **fit for upstream**: each patch could land upstream as a pr: no app-specific code, no code comments, nothing that drifts further from upstream.
- **wait for the real signal**: patched commands wait for the event they depend on. no retries, no sleeps.
- **one change per patch**: one `git format-patch` file per change on tag `cli-2.12.0`, with an upstream-style `fix:` or `feat:` subject.
- **cache cost**: ci and eas cache `build/` by the hash of the `maestro` script and `patches/*.patch`, so any patch change rebuilds maestro in every job until the new key is saved.

## legs

- **one leg per app area**: each web leg covers one area of the app, and legs take similar time. extend an existing leg and its flow before adding a leg.
- **no step on two legs**: each user path runs on one web leg only, setup aside, even when the copy fits in a leg's slack or `flows/local.yaml` doesn't chain it. to cover it with another signer or browser, move the step to that leg or switch an existing leg's `method`, never copy it.
- **a new leg is a new check**: a new or renamed matrix row changes a job name the repository ruleset requires, and codecov waits for one more upload (`after_n_builds` in `.github/codecov.yaml`).

## screen sizes

- **a size per leg**: each web leg runs at a different screen size, together covering ratios from narrow phones to desktop. permute the existing sizes before inventing new ones.
- **limits**: chrome windows are at least 500 px wide, and the headless viewport is the window minus 143 px of height. headed brave's viewport is the window minus 40 px of width and 137 px of height, and maestro applies `--screen-size` only with `--headless`, so the brave row also passes it as `--window-size`.
- **ratios**: a size's ratio is its viewport's width over height. keep ratios spread from about 0.45 to 2, and place a new size where it splits the widest gap evenly (0.78 between 0.61 and 1.0).
- **small screens**: prefer the smallest size that fills a gap, and cover a short portrait and a short landscape viewport, since layouts break there first. the scrolls a short size needs are part of that coverage: they may add sequential time, never raise the longest leg.
- **one desktop size**: at 768 px wide and wider than 9:16, the app renders a 9:16 box sized by the viewport height (`src/app/+html.tsx`). another desktop size only changes the box's dimensions, which the narrower sizes already vary, so keep one. every other size stays under 768 px wide, where the app fills the viewport at any ratio.
- **desktop leg**: the metamask leg takes the desktop size, since extension wallets live on desktop browsers and its onboarding needs the height.
- **assign by scroll cost**: a `scrollTo` costs about 0.4 s when its element is already visible and 2 to 3 s when it really scrolls, and short sizes can need new centered scrolls. give short sizes to legs with few scroll targets and the most slack once open prs land, and measure the leg at the candidate size before assigning it. a leg with no scrolls gains nothing from a tall size.
- **moving a leg**: a leg's size is coverage too. moving it drops the short-screen fixes only that size exercised, and changing a row's size or method renames its required check.
- **final from the start**: a new leg lands at its final size and signer, never changed by a later commit of the same pr.

## failures

- **explain every failure**: find the cause before changing anything. no guess fixes for flakes, and no retries or waits that hide a race.
- **check the surroundings**: compare with sibling legs and with main's run on the same base, and look for cache key changes, network errors while building maestro and duplicate eas runs of one commit.
- **artifacts**: each leg uploads `e2e-<flow>-artifacts` with `chrome.log`, `server.log`, server coverage, maestro's test output and screenshots.
- **coverage**: explain a coverage drop line by line from codecov, and never add steps only to hit lines.

## validation

- **every platform**: a change to a flow, a subflow or the app layout is done only when the web legs pass, and the eas ios and android runs too when `flows/local.yaml` covers it.
- **fingerprint**: e2e changes must not change the expo fingerprint (`pnpm exec fingerprint fingerprint:generate --platform ios`, then `android`).
- **local runs**: one stack serves any number of runs, and one run takes several flows when they share a signer, a screen size and at most one camera feed. run a leg's row through its signer's target, as ci does:

  ```sh
  CI=true NX_DAEMON=false pnpm nx e2e:web:release mobile &
  pnpm nx e2e:webauthn e2e --flow=transfer --screen=760x600
  ```

@../common/AGENTS.md
