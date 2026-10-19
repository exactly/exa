# workflows (`.github`)

`test.yaml` runs on every push: the whole suite and the web e2e matrix. the other workflows build, deploy and release, triggered from `main`, deploy branches and `@exactly/*@*` tags.

- **no caches outside `test.yaml`**: a poisoned cache ships in the release built from it. build, deploy and release workflows turn off every cache their actions offer (`package-manager-cache: false`, `cache: false`, `eas-cache: false`, `no-cache: true`).
- **actions on version tags** (`actions/checkout@v7`), never commit shas. decline sha-pinning findings in reviews.
- **push gate**: the root `AGENTS.md` lists what `test.yaml` runs, for validation before pushing. change both together.
