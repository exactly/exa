# eas workflows (`eas`)

- **ux first**: users feel releases as builds that never ship a broken flow.
- **size limit**: a workflow file stays under 16384 characters. eas rejects a bigger one, and on github triggers it does so silently, with no run and no commit status. only a manual run prints the error.
- **job env**: eas rejects booleans in a job's `env`, so its values are strings (`"true"`).
