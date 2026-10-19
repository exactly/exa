# eas workflows (`.eas`)

`e2e:local` (`workflows/local.yaml`) builds the test apps and runs `flows/local.yaml` on an android emulator and an ios simulator, for pushes to `main`, `@exactly/mobile@*` tags and ready pull requests. `e2e:production` (`workflows/production.yaml`) runs the `production` flows when started by hand.

- **release runs build fresh**: `@exactly/mobile@*` tag runs are release runs, so they neither restore nor save the nx cache and reuse no test build (`if: ${{ github.ref_type != 'tag' }}`). other runs reuse builds by fingerprint.
- **builds don't cache**: native builds fetch from package registries only, with no `cache` in `eas.json` and no ccache.
- **superseded runs**: a run started from github cancels the one in progress on the same ref, except on `main`. github's events reach eas late and out of order, so an older commit's run can cancel the head's: a canceled status is no failure, and the head needs a new run only when none of its own is left. check what is running before starting one by hand.
