# exa

shared language for the exa codebase.

## language

**stack**:
a named infrastructure boundary with independent state and configuration. unless qualified as the meta stack, a stack groups the resources for one isolated exa runtime and its name identifies stack-scoped resources and secrets.
_Avoid_: deployment, environment, domain

**app stack**:
the explicit runtime identity that carries the current stack name into an exa runtime. stack-scoped runtime boundaries read this value when they need to identify their stack.
_Avoid_: domain, pulumi stack

**meta stack**:
the unique non-runtime infrastructure boundary that owns the shared control plane required to operate every other stack.
_Avoid_: bootstrap, environment, foundation

**domain**:
a public host name for reaching an exa surface. a stack can have multiple domains, so a domain is not a stack identifier.
_Avoid_: stack, deployment

**activity webhook**:
the alchemy address activity webhook through which a stack receives account activity for one activity network. a stack has one activity webhook per activity network.
_Avoid_: activity endpoint, activity module

**activity endpoint**:
the stable public url targeted by a stack's activity webhooks. its routing can change without changing the webhook urls.
_Avoid_: activity webhook, activity module

**activity network**:
a network from which a stack receives account activity. an anvil stack uses only anvil; every other stack uses each alchemy-supported network whose testnet classification matches the stack's chain.
_Avoid_: supported network, webhook network

**activity subscription**:
the inclusion of an account in every activity webhook belonging to its stack.
_Avoid_: webhook address, network subscription

**subscription backfill**:
the reconciliation that adds every existing account to a newly introduced activity network for future activity. it does not recover historical transfers.
_Avoid_: historical backfill, event backfill

**subscription reconciliation**:
the additive process that converges every persisted account into every activity webhook. it repairs partial subscriptions without removing unknown addresses or delaying account creation.
_Avoid_: subscription migration, historical backfill

**subscription controller**:
the sole runtime allowed to create activity webhooks or change their account subscriptions. it adopts exactly one active activity webhook for each activity network and stops when provider state is ambiguous or an existing webhook is inactive.
_Avoid_: activity consumer, subscription worker

**activity consumer**:
a runtime that validates and processes deliveries from activity webhooks. it matches each delivery's webhook and network against configuration discovered from alchemy and never changes that configuration.
_Avoid_: activity webhook, activity endpoint, subscription controller

**collection**:
the onchain charge against an exa account for a card spend, using debit or credit collection according to the card mode.
_Avoid_: aggregation, settlement

**block webhook**:
the single alchemy custom webhook in a stack that delivers proposal logs from every still-relevant exa plugin and proposal manager contract.
_Avoid_: block module, block endpoint

**block endpoint**:
the stable public url targeted by a stack's block webhook. its routing can change without changing the webhook url.
_Avoid_: block webhook, block module

**block consumer**:
a runtime capable of validating and processing deliveries from a block webhook. a stack has one active block consumer even when other consumers run in parallel.
_Avoid_: block webhook, block endpoint

**account factory**:
a contract that creates exa accounts and selects their exa plugin generation. each credential records the account factory used for its account.
_Avoid_: exa plugin, proposal manager
