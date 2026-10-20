# syntax=docker/dockerfile:1
# AIC backend for Render: NestJS API (public $PORT) + document/dossier/intake workers (one process)
# + Python AI service (loopback 127.0.0.1:8100 only), in ONE container. They must share one private
# filesystem: the API writes each PDF to AIC_STORAGE_DIR/cache and passes only that key to the AI service.
# Canonical PDF bytes live in PostgreSQL; the cache is disposable, so no persistent disk is needed.
# Build context: repository root.

FROM node:22-bookworm-slim AS node

# ---------------------------------------------------------------- build the API (TypeScript -> dist)
FROM node AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=1
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter @fintech/api
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @fintech/api build

# ---------------------------------------------------------------- runtime: Python 3.11 + Node 22
FROM python:3.11-slim-bookworm AS runtime
COPY --from=node /usr/local/bin/node /usr/local/bin/node
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONIOENCODING=utf-8 \
    PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
# Only the parent belongs in the image. The supervisor creates private/cache and ledger
# in the writable layer BEFORE services pin directory identities (OverlayFS copy-up).
RUN useradd --create-home --uid 10001 aic \
 && install -d -m 0700 -o aic -g aic /var/lib/aic
WORKDIR /app
COPY services/ai services/ai
RUN pip install -e ./services/ai
COPY packages packages
COPY docs/implementation/policies docs/implementation/policies
COPY package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api apps/api
COPY deploy deploy
USER aic
ENV NODE_ENV=production
CMD ["node", "deploy/backend/start.cjs"]
