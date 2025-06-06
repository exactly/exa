FROM node:22.14.0-slim AS base

ARG APP_DOMAIN="sandbox.exactly.app"
ARG CHAIN_ID="11155420"
ARG EXPO_PUBLIC_DEVTOOLS

FROM base AS build
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y ca-certificates curl git rsync unzip --no-install-recommends && \
  rm -rf /var/lib/apt/lists/* && \
  curl -fsSL https://get.pnpm.io/install.sh | env PNPM_VERSION=9.15.9 bash && \
  curl -fsSL https://foundry.paradigm.xyz | bash
ENV PATH="$PATH:/root/.local/share/pnpm:/root/.foundry/bin"
RUN foundryup -i v1.3.6
WORKDIR /usr/src/app
COPY . .
ENV NX_DAEMON=false
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile
RUN --mount=type=cache,id=nx,target=/usr/src/app/node_modules/.cache/nx \
  npx nx run-many -t build -p server mobile --parallel=2
RUN mv dist server/app && \
  pnpm deploy --filter server --prod --ignore-scripts /prod/server

FROM base AS server
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y dumb-init --no-install-recommends && \
  rm -rf /var/lib/apt/lists/* && \
  adduser --group --system server
WORKDIR /prod/server
COPY --from=build --chown=server:server /prod/server .
USER server
EXPOSE 3000/tcp
ENTRYPOINT ["dumb-init", "node", "--require=./instrument.cjs", "dist/index.cjs"]
