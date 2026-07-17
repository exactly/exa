# alchemy custom webhook management api

<!-- cspell:ignore alchemyapi alchemypreview graphqlquery openapi pkce trpc -->

## answer

alchemy has replaced the removed notify-token query reader in its dashboard, but no server-authenticated replacement
was found. the current dashboard reads a custom webhook query through
`webhooks.getWebhookGraphQLQuery` on `https://app-api.alchemy.com/trpc`; that client sends a dashboard oauth bearer
token and browser credentials. the same procedure returns `401` when called with a valid notify
`X-Alchemy-Token`, both in that header and as a bearer token. the transport and auth construction are visible in the
[current dashboard application bundle](https://assets.alchemy.com/index-B60ZwVjJ.js), while the exact procedure input
`{ webhookId }` is visible in the
[current webhook hook bundle](https://assets.alchemy.com/useWebhooks-DrATw-FR.js).

an additional undocumented procedure, `webhooks.getWebhook`, exists. unauthenticated procedure probing distinguishes
it from fabricated names: it returns a structured `401` with its procedure path, while a nonexistent procedure returns
`404`. it is not called by any of the 162 javascript chunks referenced by the current dashboard release, so its
response shape is unknown without a dashboard session. it is nevertheless not a server solution: a valid notify token
also receives `401` from it.

no query-update route was found. every plausible tRPC update, set, replace, upsert, clone, copy, and duplicate procedure
name returned `404`. the current dashboard still mutates webhooks through the rest endpoints in the
[current endpoint bundle](https://assets.alchemy.com/endpoints-BW_rnoxa.js), and its webhook pages send only name,
active-status, and url updates. no current frontend chunk sends a graphql query to an update operation. see the
[webhook list bundle](https://assets.alchemy.com/RootPage-BcvRfu6O.js),
[webhook detail bundle](https://assets.alchemy.com/index-CG-HQ0Zw.js), and
[webhook status bundle](https://assets.alchemy.com/WebhookStatus-BzR4SRw2.js).

the useful confidence statements are:

- **high confidence:** no notify-token read route for the full custom webhook query is exposed by the current public
  api, official clients, or observable dashboard backend;
- **high confidence:** `PUT /api/update-webhook` does not recognize `graphql_query` as an update field;
- **high confidence:** the dashboard replacement is tied to dashboard oauth/session authentication;
- **medium-high confidence:** no alternative undocumented query mutation exists on the currently deployed tRPC
  router; procedure-name probing cannot rule out a route whose name was not guessed;
- **medium confidence:** the hidden `webhooks.getWebhook` may return a fuller object to dashboard users, but its notify
  token rejection makes its response shape irrelevant to unattended server use.

the investigation made no change to a real webhook. the only mutation-shaped probe used a guaranteed nonexistent
webhook id and returned validation failure before object lookup.

## public api surface

the current notify openapi document contains these relevant operations:

- `GET /team-webhooks` returns webhook metadata;
- `POST /create-webhook` accepts `graphql_query` for a new graphql webhook;
- `PUT /update-webhook` accepts `webhook_id`, `is_active`, and `name`;
- address and nft filters have separate read and update endpoints;
- custom webhook variables have separate create, read, update, and delete endpoints.

there is no full-query read route and no query field in the update schema. see the immutable
[notify openapi specification](https://github.com/alchemyplatform/docs/blob/d3d05c75cdb28ab455513c527cbc2ad0e2edab75/src/openapi/notify/notify.yaml#L104-L283)
and its
[create and update schemas](https://github.com/alchemyplatform/docs/blob/d3d05c75cdb28ab455513c527cbc2ad0e2edab75/src/openapi/notify/notify.yaml#L344-L494).

the official current example client is stricter than the openapi prose. its team-webhook parser accepts only the
documented webhook object, its create parser accepts a graphql query, and its update client exposes status, address,
nft-filter, and custom-variable operations but no query read or query update. see the
[official lab webhook client](https://github.com/alchemyplatform/lab/blob/f9f8dc462f02e7a1902fbd03d03747f8f2740997/webhooks/utils/sdk/index.ts)
and its
[strict team-webhook response schema](https://github.com/alchemyplatform/lab/blob/f9f8dc462f02e7a1902fbd03d03747f8f2740997/webhooks/utils/schemas/api/get-all-webhooks.ts).

the current cli forwards arbitrary json to `PUT /update-webhook`, so it is not by itself proof of the accepted fields.
it has list, create, update, delete, address, and nft-filter commands, but no query-export command. see the
[official cli implementation](https://github.com/alchemyplatform/alchemy-cli/blob/165dee6436ae0da37d5a41bd2e1e02d5793c1bce/src/commands/webhooks.ts).
the official bruno collection contains the same operation set and no query reader; see its
[webhook collection](https://github.com/alchemyplatform/collections/tree/4eb0064608ff278fcd12e7e1e3e9740cdde09d99/alchemy/webhooks).

## legacy contract

alchemy's archived javascript sdk implemented `getGraphqlQuery` with:

```text
GET https://dashboard.alchemy.com/api/dashboard-webhook-graphql-query
    ?webhook_id=<id>
X-Alchemy-Token: <notify token>
```

the implementation is preserved in the
[final sdk source](https://github.com/alchemyplatform/alchemy-sdk-js/blob/374385c1f2d5b5fb7dd45ea5b13430207fa863a3/src/api/notify-namespace.ts#L127-L159).
that same sdk explicitly states that a custom webhook's graphql query is immutable and restricts custom-webhook updates
to status changes. see the
[update contract](https://github.com/alchemyplatform/alchemy-sdk-js/blob/374385c1f2d5b5fb7dd45ea5b13430207fa863a3/src/api/notify-namespace.ts#L233-L243)
and
[update type](https://github.com/alchemyplatform/alchemy-sdk-js/blob/374385c1f2d5b5fb7dd45ea5b13430207fa863a3/src/types/types.ts#L1446-L1450).

the old route now returns a route-level html `404` even with a valid notify token. this is consistent with its absence
from the current openapi, cli, collection, example client, and dashboard assets.

## deployed-api probes

these probes were performed on 2026-08-10. credential values and query contents were never printed.

| target | auth or input | result | conclusion |
| --- | --- | --- | --- |
| `/api/dashboard-webhook-graphql-query` | valid notify token | `404` html | old route is removed |
| `app-api /trpc/webhooks.getWebhookGraphQLQuery` | valid notify token in either auth header | `401` json | dashboard query reader does not accept notify auth |
| `app-api /trpc/webhooks.getWebhook` | valid notify token | `401` json | hidden single-webhook reader does not accept notify auth |
| `app-api /trpc/webhooks.thisProcedureDoesNotExist` | no auth | `404` json | control for the tRPC existence oracle |
| `manage.g.alchemy.com/api/team-webhooks` | valid notify token | `401` with empty body | management gateway does not accept notify auth |
| `manage.g.alchemy.com/api/dashboard-webhook-graphql-query` | notify token as either auth header | `401` with empty body | old route is not recoverable through the management gateway |
| `/api/team-webhooks` | valid notify token | `200` json | notify token itself is valid |
| `/api/team-webhooks?include=graphql_query` | valid notify token | `200`, unchanged keys | no hidden include expansion |
| `/api/team-webhooks?expand=graphql_query` | valid notify token | `200`, unchanged keys | no hidden expand expansion |
| `/api/team-webhooks?include_graphql_query=true` | valid notify token | `200`, unchanged keys | no boolean query expansion |
| `PUT /api/update-webhook` | nonexistent id plus `graphql_query` only | `400 ValidationError: Missing required fields` | query is not recognized as an update field |
| `PUT /api/update-webhook` | nonexistent id plus `graphqlQuery` or `query` | `400 ValidationError: Missing required fields` | common field aliases are not recognized |
| `PATCH` or `POST /api/update-webhook` | nonexistent id plus `graphql_query` | `405` | no alternate mutation method accepts the query |
| `POST /api/dashboard-webhook-graphql-query` | valid notify token | `404` html | the old route has no surviving post form |
| `dashboard.alchemyapi.io/api/dashboard-webhook-graphql-query` | valid notify token | `404` html | the legacy official host has no surviving route |
| `dashboard.alchemyapi.io/api/team-webhooks` | valid notify token | `200` json | control proving legacy-host auth still works |
| `/api/graphql/query/<webhook-id>` | valid notify token | `404` html | no structured graphql query alias |

the raw team-webhook object contained only `id`, `name`, `network`, `networks`, `webhook_type`, `webhook_url`,
`is_active`, `time_created`, `signing_key`, `version`, and `deactivation_reason`. no query, config, filter, or opaque
definition field was present.

route-existence probing also eliminated the obvious rest aliases, including `/api/get-webhook`,
`/api/webhook-graphql-query`, `/api/get-webhook-graphql-query`, `/api/custom-webhook-query`, and structured
`/api/graphql/webhooks/<id>` variants. the real `/api/team-webhooks` control returned json `401` for an invalid token;
the guesses returned route-level html `404`.

## remaining possibilities

### dashboard oauth token

a dashboard oauth access token can call `webhooks.getWebhookGraphQLQuery`; this is the mechanism the dashboard uses.
the dashboard obtains the token with an authorization-code pkce flow for `client_id=dashboard`, stores it in browser
storage, sends it as `Authorization: Bearer`, and includes browser credentials. there is no client-credentials exchange
or notify-token exchange in the current frontend. alchemy's
[oauth discovery document](https://auth.alchemy.com/.well-known/openid-configuration) advertises device authorization
but no client-credentials grant. initiating device authorization returns human verification fields, not a service
credential; this investigation did not complete that human authorization. using either a copied dashboard token or a
device-authorized human token in infrastructure would therefore add a human-session credential and depend on a private
contract. it is technically callable, but it is not an unattended service-auth replacement.

### hidden `webhooks.getWebhook`

this procedure is the only promising hidden read name found. authenticated dashboard inspection could reveal whether
it returns the full query, but it already fails the requirement that the existing notify token authenticate the
request. it becomes relevant only if alchemy later enables service auth or documents a non-human oauth grant.

### query mutation under an unknown name

no current asset calls one, and broad procedure-name probing returned `404` for every plausible update, set, replace,
upsert, configure, edit, save, clone, copy, and duplicate variant. this cannot prove that no unguessable private name
exists. the public backend's validation behavior, the current dashboard's read-only query display, and the legacy sdk's
immutable-query contract all point in the same direction.

### custom webhook variables

the supported variable api can mutate address and topic sets referenced by a query. it cannot retrieve or alter the
query structure, and adopting it requires changing the existing query once. it is an alternative data model, not a
replacement query-management endpoint. see the
[official custom-webhook reference](https://github.com/alchemyplatform/skills/blob/546e264b73549c10a6dd6820cb7ffddf1f1f0f45/skills/alchemy-api/references/webhooks-custom-webhooks.md)
and the variable operations in the current notify openapi specification.

## implication for exa

the prior algorithm depended on alchemy as the readable source of the applied query: read current query, merge newly
required addresses, create a replacement only when the result changed, then delete the old webhook. the dashboard can
still perform the read for a human session, but the existing server credential cannot.

an undocumented endpoint does not currently restore that algorithm. preserving unattended deployment now requires at
least one of these contracts to change:

- alchemy restores notify-token query reads;
- alchemy adds query replacement to the notify api;
- exa records or reconstructs the applied configuration outside alchemy;
- the query is manually converted once to use supported custom webhook variables.

the first two are upstream fixes. the last two change exa's state model and should be evaluated as architecture, not
presented as discovered api replacements.
