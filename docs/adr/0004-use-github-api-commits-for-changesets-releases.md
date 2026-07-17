# use github api commits for changesets releases

the changesets release workflow uses an installation token from the private `exa-version` github app owned by
`exactly`, installed only on `exactly/exa`, and granted only repository contents and pull-request write access.
its private key is stored only as `EXA_VERSION_KEY` in the main-restricted `version` github environment.
`commitMode: github-api`
allows github to sign its commits and tags without `RELEASE_GITHUB_TOKEN` or `GPG_PRIVATE_KEY`. github rulesets permit
the app to create only `@exactly/*@*` package tags and do not let it update or delete an existing tag. the app-created
tag pushes trigger the existing package workflows normally, preserving exact tag refs without a dispatch event or
central fan-out. mobile and server tags drive their production workflows; a substreams tag may build its image, but
that build has no automatic deployment or other consumer until substreams is explicitly wired. the existing version
script still amends its commit, the action still force-updates the release branch, and release pull requests still
enter `main` through the existing rebase-only process. production automation exposes neither `workflow_dispatch` nor
`repository_dispatch`: an operator cannot initiate a release by selecting a ref or supplying a payload. rerunning an
existing version run remains valid recovery and may recreate only releases derived from that run's original release
commit.
