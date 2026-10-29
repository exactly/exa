# maestro patches (`e2e`)

- **build**: the `maestro` script in `../package.json` fetches maestro at the tag it pins, applies `*.patch` in name order and installs the cli into `../build/`. a patch may build on one before it (`windows.patch` and `world.patch` do). the ios driver ships prebuilt and the build skips it, so a patch to its sources has no effect.
- **maestro gaps only**: patch maestro for a maestro bug or a missing capability, never to work around the app or a flow.
- **fit for upstream**: each patch could land upstream as a pr: no app-specific code, no code comments, nothing that drifts further from upstream.
- **wait for the real signal**: patched commands wait for the event they depend on. no retries, no sleeps.
- **one change per patch**: one `git format-patch` file per change on that tag, with an upstream-style `fix:` or `feat:` subject and a body that says what breaks and how the change fixes it.
- **editing**: apply the series with `git am` on a maestro clone at the tag, amend the one commit, and write it back with `git -c core.abbrev=7 format-patch -1`, keeping `base-commit:` only where the file had it.
- **upgrades**: rebase the series onto the new tag and recheck each patch against upstream's changes: drop what upstream fixed, and adapt the rest to new internals instead of only resolving conflicts.
- **cache cost**: ci and eas cache `../build/` by the hash of the `maestro` script and the patches, so any patch change rebuilds maestro in every job until the new key is saved.
