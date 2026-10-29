# github workflows (`github`)

- **full history**: checkouts in jobs that build or test keep every commit and tag (`fetch-depth: 0`, `fetch-tags: true`), since release and version codegen read git.
- **cache budget**: the repository's caches share 10 GB, and a full budget evicts other branches' entries. keep per-commit entries small, and save the nx cache only on `main`.
- **no noise in summaries**: silence step summaries nobody needs, like the run report nx appends after every top-level command, with an empty `GITHUB_STEP_SUMMARY=` prefix.
