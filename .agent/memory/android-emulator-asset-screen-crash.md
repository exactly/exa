# asset selection screen rendering crash — app-side analysis

this file documents everything known about what the app is doing at the exact moment the android
emulator dies. intended for debugging the app-side rendering pipeline.

## the trigger: asset selection screen in sendAsset flow

the crash occurs every time maestro navigates to the asset selection screen during the
`sendAsset.yaml` flow. the sequence is:

1. maestro taps "send" → enters receiver address → taps "next"
2. app navigates to `src/app/(main)/send-funds/asset.tsx`
3. this screen renders `AssetSelector` (`src/components/shared/AssetSelector.tsx`)
4. `AssetSelector` renders a list of assets, each with a 32×32 circular logo
5. logos are loaded from remote SVG urls via `AssetLogo` (styled `expo-image`)
6. **the emulator dies during or immediately after this rendering**

the crash is 100% reproducible at this exact screen transition across all ci runs.

## rendering pipeline (component → native)

```text
AssetSelector.tsx (lines 70-142)
  → renders ToggleGroup.Item per asset
  → each item includes <AssetLogo source={{ uri }} width={32} height={32} />

AssetLogo.tsx (lines 1-17)
  → styled(Image) from expo-image
  → cachePolicy: "memory-disk"
  → contentFit: "contain"
  → borderRadius: "$r_0" (circular)

expo-image (native layer)
  → on android: uses Glide under the hood
  → downloads SVG from url
  → decodes image via android's ImageDecoder / BitmapFactory
  → renders via OpenGLRenderer (hardware-accelerated canvas)

OpenGLRenderer (android framework)
  → in CI: backed by SwiftShader (software GL, runs on host CPU)
  → SwiftShader runs through gfxstream pipe transport to emulator
```

## what the logcat shows at the crash moment

### image decoder failures (12+ occurrences)

```text
OpenGLRenderer: Failed to create image decoder with message 'unimplemented'
```

this appears every time an SVG-derived bitmap is decoded. the error comes from android's
`ImageDecoder` api when the underlying codec doesn't support the format. in the emulator with
swiftshader, this likely means the software renderer can't handle whatever image format expo-image
/ glide produces from the SVG.

### media extractor failures (3 occurrences)

```text
StagefrightMetadataRetriever: Failed to instantiate a MediaExtractor
```

this suggests the native layer is also trying to decode something via the media pipeline (possibly
animated content or video thumbnails). could be expo-image attempting multiple decode strategies.

### glide loading USDC.svg

the last app-level logcat line before death shows glide actively loading `USDC.svg`. this confirms
the crash happens during SVG image loading, not after rendering completes.

### frame time degradation

```text
before asset screen: ~58ms frame times (normal for swiftshader)
during asset screen:  ~500ms frame times
then: instant death (log stops mid-line)
```

the 10× frame time increase indicates the rendering pipeline is overwhelmed before it dies.

## asset logo urls (all SVGs)

protocol assets use hardcoded SVG urls from `src/utils/assetLogos.ts`:

```text
USDC    → https://app.exact.ly/img/assets/USDC.svg
ETH     → https://app.exact.ly/img/assets/WETH.svg
wstETH  → https://app.exact.ly/img/assets/wstETH.svg
OP      → https://app.exact.ly/img/assets/OP.svg
WBTC    → https://app.exact.ly/img/assets/WBTC.svg
DAI     → https://app.exact.ly/img/assets/DAI.svg
USDC.e  → https://app.exact.ly/img/assets/USDC.e.svg
```

external assets use `logoURI` from lifi sdk (also often SVGs or PNGs from various cdns).

the asset selection screen can render **all of these simultaneously** — 7+ protocol assets plus any
external assets with balances. each triggers a separate image download + decode + render cycle.

## data fetching at screen mount

`useAccountAssets()` (`src/utils/useAccountAssets.ts`) fetches:

1. **protocol assets**: `useReadPreviewerExactly()` — on-chain read via rpc
2. **external assets**: `getTokenBalances()` → `@lifi/sdk` api call

both are tanstack query hooks, so data may already be cached from the home screen. but the image
loading happens fresh if this is the first time the asset selection screen renders these logos (expo-image has memory-disk cache, but first render in the flow still triggers decode).

## why this crashes the emulator

the working hypothesis is that rendering 7+ SVG-sourced images simultaneously through
swiftshader causes either:

1. **swiftshader crash**: a bug in the software opengl implementation when handling multiple
   concurrent image decode + texture upload operations. swiftshader runs on the host cpu inside
   the qemu process — a segfault kills the entire emulator.

2. **gfxstream pipe deadlock**: the host↔guest gpu communication pipe gets overwhelmed by
   concurrent texture uploads. the guest blocks waiting for pipe responses that never come,
   causing the kernel to appear hung.

3. **memory spike in host-side swiftshader**: each SVG decode may allocate significant host memory
   for texture buffers. 7+ concurrent decodes could spike host-side memory allocation inside the
   qemu process, triggering an oom kill.

the "image decoder unimplemented" errors suggest the native decode path for SVGs is already failing
gracefully at first, but accumulates state corruption that eventually crashes.

## the two-burst pattern

image decoder errors appear in two bursts:

- **first burst at ~T+37s**: app loads the home screen (`AssetList.tsx`), which also renders
  `AssetLogo` for each asset. the system survives — possibly because the home screen renders
  fewer items or the cache absorbs the load.
- **second burst at ~T+55s**: app navigates to asset selection screen (`AssetSelector.tsx`), which
  renders the full asset list. this burst kills the emulator.

this suggests the crash depends on the **total number of concurrent SVG renders**, not any single
one. the home screen's rendering primes some state, and the asset selection screen's rendering
pushes past a threshold.

## potential app-side fixes to investigate

### 1. replace SVG urls with PNG urls for asset logos

the simplest fix. serve pre-rasterized PNGs instead of SVGs. this eliminates the SVG decode path
entirely. android's image pipeline handles PNGs natively without the "unimplemented" decoder issue.

check: can `app.exact.ly` serve PNG variants? or add `?format=png` support?

### 2. use `expo-image` placeholder/blurhash while loading

if the crash is caused by concurrent decode pressure, adding a lightweight placeholder that renders
immediately (before the SVG loads) might stagger the decode operations enough to survive.

### 3. lazy-load off-screen asset logos

if the asset list renders all items immediately (no virtualization), all SVG downloads + decodes
fire at once. using a virtualized list (`FlashList` or similar) that only renders visible items
would reduce concurrent decode pressure.

check: does `AssetSelector` use a scrollable virtualized list or render all items in a flat view?

### 4. pre-cache asset logos at app startup

if logos are cached from a previous screen (home), the asset selection screen reads from cache
instead of triggering fresh decodes. ensure `cachePolicy: "memory-disk"` is working and that the
home screen's logo urls match the asset selection screen's urls exactly.

check: are the same urls used in `AssetList.tsx` (home) and `AssetSelector.tsx`? any query param
differences that would bust the cache?

### 5. bundle asset logos in the apk

for the 7 protocol assets with known urls, bundle the images as local assets in the apk. this
eliminates network download and uses a simpler decode path. external assets would still load from
urls, but protocol assets (the majority) would be instant.

### 6. use `react-native-svg`'s `SvgUri` instead of `expo-image` for SVGs

`expo-image` routes SVGs through glide → android's bitmap pipeline → opengl textures. this is the
path that triggers the "unimplemented" decoder error. `react-native-svg`'s `SvgUri` renders SVGs
as native vector paths, bypassing the bitmap/texture pipeline entirely.

trade-off: `SvgUri` may be slower for complex SVGs but avoids the broken decode path.

check: the codebase already uses `SvgUri` in `VisaSignatureSheet.tsx` — the pattern exists.

### 7. investigate expo-image's android glide integration

expo-image uses glide on android. glide has an SVG decoder extension
(`GlideSvgDecoder`) that may or may not be configured. without it, glide may be trying to decode
SVGs as bitmaps, which fails. check if the expo-image android native code registers an SVG decoder
with glide, or if SVGs are being mishandled.

## key files to examine

| file | what to check |
| ---- | ------------- |
| `src/components/shared/AssetSelector.tsx` | how many items render simultaneously? virtualized? |
| `src/components/shared/AssetLogo.tsx` | expo-image config, error handling behavior |
| `src/utils/assetLogos.ts` | can urls be changed to PNG? |
| `src/components/home/AssetList.tsx` | same logos as AssetSelector? cache priming? |
| `src/utils/useAccountAssets.ts` | how many assets returned in test env? |
| `node_modules/expo-image/android/` | how does expo-image handle SVGs on android? |
| `.maestro/subflows/sendAsset.yaml` | exact flow steps triggering the crash |
| `src/app/(main)/send-funds/asset.tsx` | screen component, what renders on mount |

## maestro flow reference

`.maestro/subflows/sendAsset.yaml` — the subflow that triggers the crash:

- finds asset by regex: `^${asset}, [\s\d,.\xa0]+ available$`
- this pattern matches the `AssetSelector` item text format
- the asset parameter in e2e tests is likely "USDC" or "ETH"

the crash happens between maestro tapping "next" (to open asset selection) and maestro finding
the asset text — the screen never finishes rendering.
