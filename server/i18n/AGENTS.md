# translations (`server`)

- **no regional variants**: push notifications are localized by language only (onesignal's two-letter codes), so the server has `en`, `es` and `pt` and no `es-AR`. voseo users get the `es` copy. <!-- cspell:ignore voseo -->
- **every language at once**: `t` returns `{ en, es, pt }`, ready for onesignal's `headings` and `contents`. values can be such maps too (`f` for amounts, a nested `t` for decline reasons), and each language picks its own.
