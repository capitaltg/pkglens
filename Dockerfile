# ---- deps ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ---- build ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# TanStack Start (Vinxi) → .output/
RUN npm run build

# Bundle the BullMQ worker (TypeScript → ESM, node_modules stay external)
RUN node_modules/.bin/esbuild worker/index.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --packages=external \
    --outfile=dist-worker/index.mjs

# Bundle the migration runner
RUN node_modules/.bin/esbuild scripts/migrate.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --packages=external \
    --outfile=dist-migrate/index.mjs

# ---- production ----
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/.output        ./.output
COPY --from=builder /app/dist-worker    ./dist-worker
COPY --from=builder /app/dist-migrate   ./dist-migrate
COPY --from=builder /app/drizzle        ./drizzle

EXPOSE 3000

# Default: web server.
# ECS worker service overrides this with:
#   ["node", "dist-worker/index.mjs"]
# ECS migrate task overrides this with:
#   ["node", "dist-migrate/index.mjs"]
CMD ["node", ".output/server/index.mjs"]
