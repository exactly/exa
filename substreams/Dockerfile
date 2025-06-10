FROM node:22.14.0-slim AS build
ARG CHAIN_ID="11155420"
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# cspell:ignore libc tlsv
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y ca-certificates curl gcc git jq libc6-dev rsync unzip --no-install-recommends && \
  rm -rf /var/lib/apt/lists/* && \
  curl -fsSL https://get.pnpm.io/install.sh | env PNPM_VERSION=9.15.9 bash && \
  curl -fsSL https://foundry.paradigm.xyz | bash && \
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- --default-toolchain none -y
ENV PATH="$PATH:/root/.local/share/pnpm:/root/.foundry/bin:/root/.cargo/bin"
RUN foundryup
WORKDIR /usr/local/bin
RUN curl -L "$(curl -s https://api.github.com/repos/streamingfast/substreams/releases/latest | jq --arg arch "$(uname -m | sed 's/aarch64/arm64/')" -r '.assets[] | select(.browser_download_url | test("linux_" + $arch)) | .browser_download_url')" | tar zxf -
WORKDIR /usr/src/app
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
RUN pnpm run --filter substreams build

FROM ghcr.io/streamingfast/substreams-sink-sql:v4.6.1 AS substreams
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y dumb-init --no-install-recommends && \
  rm -rf /var/lib/apt/lists/* && \
  adduser --group --system substreams
WORKDIR /app
COPY --from=build --chown=substreams:substreams /usr/src/app/substreams/proto proto
COPY --from=build --chown=substreams:substreams /usr/src/app/substreams/substreams.yaml .
COPY --from=build --chown=substreams:substreams /usr/src/app/substreams/node_modules/@exactly/server/generated/schema.sql node_modules/@exactly/server/generated/schema.sql
COPY --from=build --chown=substreams:substreams /usr/src/app/substreams/target/wasm32-unknown-unknown/release/substreams.wasm target/wasm32-unknown-unknown/release/substreams.wasm
USER substreams
# cspell:ignore sslmode
ENTRYPOINT ["dumb-init", "/app/substreams-sink-sql"]
CMD ["run", "postgres://postgres:postgres@host.docker.internal:5432/postgres?schemaName=substreams&sslmode=disable", "substreams.yaml"]
