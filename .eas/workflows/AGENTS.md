# eas workflows (`eas`)

- **ux first**: users feel releases as builds that never ship a broken flow.
- **size limit**: a workflow file stays under 16384 characters. eas rejects a bigger one, and on github triggers it does so silently, with no run and no commit status. only a manual run prints the error.
- **job env**: eas rejects booleans in a job's `env`, so its values are strings (`"true"`).
- **bench**: `bench.yaml` runs by hand (`eas workflow:run bench.yaml`). it times `.maestro/bench/android.yaml`, a settings-app flow that needs no app build or server, on this branch's maestro and then main's, once each on one emulator, so a driver change shows its per-command cost in minutes.
