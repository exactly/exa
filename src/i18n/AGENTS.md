# translations (`app`)

- **stack**: i18next, set up in `src/app/_layout.tsx` with `en`, `es`, `pt` and `es-AR`.
- **dynamic keys**: some keys reach `t` only through a variable, like ramp methods (`t(method)`) or i18next contexts (`Send_home` from `t("Send", { context: "home" })`), so search for those before calling a key unused.
- **voseo**: spanish speakers in the voseo regions `fallbackLng` lists read `es-AR.json`, which falls back to `es.json`. every string they see must read right in voseo. <!-- cspell:ignore voseo -->
- **only what differs**: an `es-AR` entry exists only when its wording differs from `es`: voseo verbs, `vos` for `tú`, and local usage (`alcanzaste` over `has alcanzado`). never copy a string that reads the same, since the fallback already serves it. <!-- cspell:ignore alcanzaste alcanzado -->
- **check every spanish change**: a missing `es-AR` entry silently shows the `tú` form, so check each new or changed `es` string that addresses the user. imperatives, presents and subjunctives all change (`cuando pagues` is `cuando pagués`). keep an existing entry in step with its `es` string, and remove it once both read the same. <!-- cspell:ignore cuando pagues pagués -->
- **voseo spelling**: the spanish dictionary lacks most voseo forms, so they go in the words of the `es-AR.json` override.
- **native strings**: `native/*.json` hold the ios permission prompts, set through `locales` in `app.config.ts`. they ship with native builds, not updates, and have no `es-AR`.
