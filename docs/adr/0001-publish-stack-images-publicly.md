# publish stack images publicly

server images remain chain-specific because contract addresses and related code are generated per chain. each stack therefore publishes its canonical commit tag to a public ghcr package, and its google cloud runtime pulls through a stack-scoped artifact registry remote repository. cached artifacts older than one day are deleted because ghcr remains the source of truth.

public visibility is irreversible, so image publication is isolated from long-lived secrets: public build configuration is hardcoded in callers and workflow defaults, the reusable build workflow receives no deployment secrets, and sentry release credentials stay in the deploy workflow. this deliberately avoids permanent ghcr read credentials and duplicated native artifact registry storage; publication remains automatic without a pre-push scan or anonymous-pull gate.
