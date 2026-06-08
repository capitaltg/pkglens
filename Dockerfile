# syntax=docker/dockerfile:1
#
# Cross-arch friendly: lets an arm64 host (e.g. an Apple Silicon / Graviton
# laptop) produce an amd64 image for EKS WITHOUT emulating Node under QEMU.
#
# How: every `RUN` (npm ci, npm run build) executes in a stage pinned to the
# native BUILD platform, so Node runs natively. The only arch-specific dep is
# esbuild's binary, which we cross-select with `npm --cpu/--os`. The final
# runtime stage targets amd64 but only uses COPY/ENV/CMD — no RUN — so QEMU is
# never invoked at build time.
#
# Build for EKS:
#   docker buildx build --platform linux/amd64 -t <ecr>/deplens:latest --push .

ARG NODE_IMAGE=node:22-bookworm-slim

# ─── Build dist/ (runs natively on the build host arch) ──────────────────────
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts skips the `prepare` hook (lefthook install), which has no
# git context in a container. The arm64 esbuild installed here is only used to
# build dist/ and is never shipped.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# ─── Production node_modules for the TARGET arch ─────────────────────────────
# Runs natively on the build host, but --cpu/--os make npm fetch the target
# platform's optional native packages (e.g. @esbuild/linux-x64 for amd64).
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS proddeps
ARG TARGETOS
ARG TARGETARCH
WORKDIR /app
COPY package.json package-lock.json ./
RUN CPU=$(case "$TARGETARCH" in amd64) echo x64;; arm64) echo arm64;; *) echo "$TARGETARCH";; esac) && \
    npm ci --omit=dev --ignore-scripts --cpu="$CPU" --os="$TARGETOS"

# ─── Runtime image (TARGET arch; COPY-only → no emulation) ───────────────────
# One image, two entrypoints:
#   web    → node serve.mjs                       (SSR + server functions; runs migrations)
#   worker → node --import tsx worker/index.ts (BullMQ analysis jobs)
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=proddeps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# package.json is required at runtime: "type":"module" makes the worker load as
# ESM (top-level await) and the "imports" map resolves the worker's #/ aliases.
COPY package.json tsconfig.json serve.mjs migrate.mjs ./
COPY worker ./worker
COPY src ./src
COPY drizzle ./drizzle

# npx (worker) finds the bundled esbuild here instead of downloading it.
ENV PATH="/app/node_modules/.bin:${PATH}"
# Writable caches for the worker's `npm install` / `npx esbuild` as non-root.
ENV npm_config_cache=/tmp/.npm
ENV PORT=3000
ENV HOST=0.0.0.0

USER node
EXPOSE 3000

# Default entrypoint = web server. The worker Deployment overrides `command`.
CMD ["node", "serve.mjs"]
