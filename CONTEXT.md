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
the single alchemy address activity webhook in a stack that delivers account activity.
_Avoid_: activity endpoint, activity module

**activity endpoint**:
the stable public url targeted by a stack's activity webhook. its routing can change without changing the webhook url.
_Avoid_: activity webhook, activity module

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
