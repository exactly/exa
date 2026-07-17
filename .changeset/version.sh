#!/usr/bin/env bash
set -eo pipefail

pnpm changeset version
pnpm install --lockfile-only
git -c user.name=exa-version -c user.email=exa-version commit --all --amend --no-edit
