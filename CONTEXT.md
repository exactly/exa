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
