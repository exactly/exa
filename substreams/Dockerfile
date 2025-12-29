FROM node:24.12.0-slim AS build
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# cspell:ignore libc tlsv
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y ca-certificates curl gcc git jq libc6-dev rsync unzip --no-install-recommends && \
  rm -rf /var/lib/apt/lists/* && \
  curl -fsSL https://get.pnpm.io/install.sh | env PNPM_VERSION=9.15.9 bash && \
  curl -fsSL https://foundry.paradigm.xyz | bash && \
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- --profile minimal --default-toolchain none -y
ENV PATH="$PATH:/root/.local/share/pnpm:/root/.foundry/bin:/root/.cargo/bin"
RUN foundryup -i v1.3.6
WORKDIR /usr/local/bin
RUN curl -L "$(curl -s https://api.github.com/repos/streamingfast/substreams/releases/latest | jq --arg arch "$(uname -m | sed 's/aarch64/arm64/')" -r '.assets[] | select(.browser_download_url | test("linux_" + $arch)) | .browser_download_url')" | tar zxf -
WORKDIR /usr/src/app
COPY . .
ENV NX_DAEMON=false
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
RUN pnpm nx build substreams

FROM ghcr.io/streamingfast/substreams-sink-sql:v4.11.3 AS substreams
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y dumb-init --no-install-recommends && \
  rm -rf /var/lib/apt/lists/* && \
  adduser --group --system substreams
WORKDIR /app
COPY --from=build --chown=substreams:substreams /usr/src/app/substreams/proto proto
COPY --from=build --chown=substreams:substreams /usr/src/app/substreams/substreams.yaml .
COPY --from=build --chown=substreams:substreams /usr/src/app/substreams/target/wasm32-unknown-unknown/release/substreams.wasm target/wasm32-unknown-unknown/release/substreams.wasm
COPY --from=build --chown=substreams:substreams /usr/src/app/server/generated/schema.sql ../server/generated/schema.sql
USER substreams
# cspell:ignore sslmode
ENTRYPOINT ["dumb-init", "/app/substreams-sink-sql", "run"]
CMD ["postgres://host.docker.internal:5432/postgres?sslmode=disable&schemaName=substreams", "substreams.yaml"]
