# translations (`server`)

- **ux first**: a push notification is ux on a locked screen. it reads right in the user's language and says what happened in one glance.
- **no regional variants**: push notifications are localized by language only (onesignal's two-letter codes), so the server has `en`, `es` and `pt` and no `es-AR`. voseo users get the `es` copy. <!-- cspell:ignore voseo -->
- **every language at once**: `t` returns `{ en, es, pt }`, ready for onesignal's `headings` and `contents`. values can be such maps too (`f` for amounts, a nested `t` for decline reasons), and each language picks its own.
