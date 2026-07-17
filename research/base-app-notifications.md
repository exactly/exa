# base app notifications

researched on 2026-08-05 against first-party base documentation and the farcaster mini app specification.

## conclusion

the base app notification integration is now a server-to-server base dashboard api integration keyed by wallet address. it
is not the farcaster mini app webhook and notification-token flow. after 2026-04-09, the base app treats every app as a
standard web app, does not invoke `addMiniApp`, does not require `/.well-known/farcaster.json`, and does not deliver
notifications sent through legacy farcaster services, fids, or farcaster notification tokens. [base migration guide](https://docs.base.org/apps/guides/migrate-to-standard-web-app)

for base app support, implement the current api described below. retain the legacy flow only if exa separately wants to
notify users in farcaster clients. the canonical base documentation index now places notifications under the standard
apps section, while the older mini app pages remain available as legacy material. [base documentation index](https://docs.base.org/llms.txt)

## current base app contract

### registration and user lifecycle

- create or use a base dashboard project, register the app's primary url, complete the base.dev metadata, and generate a
  project api key under settings. the required metadata includes the name, icon, tagline, description, screenshots,
  category, primary url, and builder code. [base migration guide](https://docs.base.org/apps/guides/migrate-to-standard-web-app)
  [base notification guide](https://docs.base.org/apps/technical-guides/base-notifications)
- application code does not call `addMiniApp`; the base app owns installation. notification eligibility is a separate
  base preference: the user must have pinned the app and opted in to notifications. [base migration guide](https://docs.base.org/apps/guides/migrate-to-standard-web-app)
  [base notification guide](https://docs.base.org/apps/technical-guides/base-notifications)
- use the connected wallet address as the base app user's identity. the migration guide replaces fid context with
  wagmi's `useAccount` and siwe where authentication is required. [base migration guide](https://docs.base.org/apps/guides/migrate-to-standard-web-app)
- the current public contract has no app webhook, add/remove event payload, or per-user notification token. base-owned
  account and address-preference backends replace legacy farcaster webhooks, and the app pulls pin and notification status from
  the dashboard api. [base migration guide](https://docs.base.org/apps/guides/migrate-to-standard-web-app)

the documented api can check a wallet's state, list the app's audience, and send notifications. every request uses the
project api key in `x-api-key`. [base notification guide](https://docs.base.org/apps/technical-guides/base-notifications)

- `POST https://dashboard.base.org/api/v1/notifications/app/user/status` accepts `app_url` and `wallet_address`; it
  returns `appPinned` and `notificationsEnabled`. `notificationsEnabled` is always false when `appPinned` is false.
  addresses are accepted in any case and normalized to eip-55. [base notification guide](https://docs.base.org/apps/technical-guides/base-notifications)
- `GET https://dashboard.base.org/api/v1/notifications/app/users` accepts the required `app_url` plus optional
  `notification_enabled`, `cursor`, and `limit`; the page limit is 500 and `nextCursor` is omitted on the last page.
  each user contains `address` and `notificationsEnabled`. [base notification guide](https://docs.base.org/apps/technical-guides/base-notifications)
- `POST https://dashboard.base.org/api/v1/notifications/send` accepts `app_url`, one to 1,000 `wallet_addresses`, a
  title of at most 30 characters, a message of at most 200 characters, and an optional `target_path` of at most 500
  characters. `target_path` must start with `/`; omitting it opens the registered root url. [base notification guide](https://docs.base.org/apps/technical-guides/base-notifications)
- the send response reports `success`, per-wallet `results`, `sentCount`, and `failedCount`. `success` is true only if
  every target succeeds; documented per-wallet failures are `user has not saved this app` and
  `user has notifications disabled`. [base notification guide](https://docs.base.org/apps/technical-guides/base-notifications)

### limits and failure handling

- the notification endpoints share a limit of 20 requests per minute per source ip and return 429 when exceeded.
  [base notification guide](https://docs.base.org/apps/technical-guides/base-notifications)
- duplicate addresses in one send are collapsed. an identical tuple of app url, wallet address, title, message, and
  target path is also deduplicated for 24 hours and returns success without another push. there is no caller-supplied
  notification id in the current api. [base notification guide](https://docs.base.org/apps/technical-guides/base-notifications)
- 400 covers invalid or oversized input; 401 covers a missing or invalid api key; 403 covers an app url outside the
  project or a project not whitelisted for notifications; 404 covers a missing project; the status endpoint can return
  500; and the send endpoint can return retryable 503. [base notification guide](https://docs.base.org/apps/technical-guides/base-notifications)
- notifications from this api are delivered only by the base app. activity through another client does not make that
  user reachable through this channel. [base notification guide](https://docs.base.org/apps/technical-guides/base-notifications)

## implementation required

- register the production exa web url in base.dev, complete its metadata, obtain notification access or whitelisting,
  and create the dashboard api key. these are external prerequisites, not repository-only changes.
  [base notification guide](https://docs.base.org/apps/technical-guides/base-notifications)
- add a server-only dashboard client authenticated with the runtime api key. exposing `x-api-key` from the browser
  would expose the credential that authorizes the project; keeping this call behind the exa server follows directly
  from the api's project-key authentication model. [base notification guide](https://docs.base.org/apps/technical-guides/base-notifications)
- validate the targeted-send request and response, and preserve per-wallet partial failures instead of treating the
  top-level response as an all-or-nothing result. add the wallet-status operation only for an in-app eligibility cta,
  and add paginated audience retrieval only for broadcasts. [base notification guide](https://docs.base.org/apps/technical-guides/base-notifications)
- connect the existing notification-producing jobs and hooks to a base delivery path keyed by each user's wallet
  address. each notification needs base-sized title and message text plus an exa web route for `target_path`.
  [base notification guide](https://docs.base.org/apps/technical-guides/base-notifications)
- put sends behind the existing job infrastructure or an equivalent limiter so batches stay below 1,000 wallets and
  aggregate traffic stays below 20 requests per minute per ip. retry 429 and 503 deliberately, while accounting for
  the platform's 24-hour content-based deduplication. [base notification guide](https://docs.base.org/apps/technical-guides/base-notifications)
- optionally proxy the single-wallet status call to the web client to decide whether to explain pinning or notification
  opt-in. the current docs mention targeted ctas but document no replacement sdk action that can programmatically pin
  an app or enable notifications. [base notification guide](https://docs.base.org/apps/technical-guides/base-notifications)
  [base migration guide](https://docs.base.org/apps/guides/migrate-to-standard-web-app)
- add mocked contract tests for validation, pagination, batching, partial failure, rate limiting, and retry behavior.
  then run a controlled live smoke test with a registered production url and a wallet that has pinned exa and opted in.
  the documented service host is `dashboard.base.org`; the guide does not describe a separate notification sandbox.
  [base notification guide](https://docs.base.org/apps/technical-guides/base-notifications)

## deployment constraints

- the web app must load in a mobile browser and use the injected wallet through wagmi and viem; siwe is used only when
  authenticated application sessions are needed. [base migration guide](https://docs.base.org/apps/guides/migrate-to-standard-web-app)
- `app_url` must be the url registered to the api key's project, and the project must be whitelisted for notifications,
  or the api returns 403. [base notification guide](https://docs.base.org/apps/technical-guides/base-notifications)
- the old production-domain restriction on `addMiniApp` and its incompatibility with tunnel domains apply only to the
  legacy farcaster flow, not to the current base app flow. [farcaster notification guide](https://miniapps.farcaster.xyz/docs/guides/notifications)

## legacy farcaster contract

this section is relevant only if exa continues to support notification-capable farcaster clients. it must not be used
as the base app implementation after 2026-04-09. [base migration guide](https://docs.base.org/apps/guides/migrate-to-standard-web-app)

- the manifest must expose `webhookUrl` under `miniapp` at `/.well-known/farcaster.json`; a user-approved
  `addMiniApp()` can return `notificationDetails`, and the action works only on the production domain matching the
  manifest. [farcaster notification guide](https://miniapps.farcaster.xyz/docs/guides/notifications)
  [official add action type](https://github.com/farcasterxyz/miniapps/blob/main/packages/miniapp-core/src/actions/AddMiniApp.ts)
- the client posts signed events to the webhook. `miniapp_added` may include `{ url, token }`; `notifications_enabled`
  must include a fresh `{ url, token }`; `miniapp_removed` and `notifications_disabled` invalidate the relevant token.
  the handler verifies the json farcaster signature, persists or invalidates the token, and returns 200 so the client
  does not retry. [farcaster notification guide](https://miniapps.farcaster.xyz/docs/guides/notifications)
  [official event schemas](https://github.com/farcasterxyz/miniapps/blob/main/packages/miniapp-core/src/schemas/events.ts)
- sending means posting to the token's supplied url with `notificationId`, `title`, `body`, `targetUrl`, and up to 100
  `tokens`. the sdk schema caps those strings at 128, 32, 128, and a secure url respectively; `targetUrl` must use the
  registered app's exact hostname. responses separate successful, invalid, rate-limited, and optionally failed tokens.
  [farcaster notification guide](https://miniapps.farcaster.xyz/docs/guides/notifications)
  [official notification schemas](https://github.com/farcasterxyz/miniapps/blob/main/packages/miniapp-core/src/schemas/notifications.ts)
- the documented farcaster-client limits are one notification per token per 30 seconds and 100 per token per day; a stable
  `notificationId` deduplicates per fid for 24 hours. [farcaster notification guide](https://miniapps.farcaster.xyz/docs/guides/notifications)

## external decisions

- confirm which production exa url is registered as the base.dev primary url.
- confirm that the base.dev project is whitelisted for notifications and provision its api key as a server runtime
  secret.
- choose which existing exa notification classes should also reach base app users and map each one to a web route.
- decide whether farcaster-client notifications remain a separate product requirement; they require the legacy
  webhook and token pipeline but still will not reach base app users.
