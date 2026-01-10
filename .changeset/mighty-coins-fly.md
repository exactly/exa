---
"@exactly/common": patch
---

⬆️ centralize eslint flat config, upgrade account-kit

- new shared eslint flat configs in `eslint/`:
  - `base.mjs`: core config with typescript-eslint strict-type-checked, unicorn, regexp, import, nx, prettier, jsdoc/tsdoc
  - `node.mjs`: node.js config with eslint-plugin-n, security, vitest
  - `react.mjs`: react config with @eslint-react strict-type-checked, tanstack-query, jsx-a11y
