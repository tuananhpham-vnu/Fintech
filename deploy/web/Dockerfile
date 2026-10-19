# syntax=docker/dockerfile:1
# AIC web (Next.js) for Render. The browser only talks to this service; /api/v2/* is proxied server-side
# to AIC_BACKEND_URL, so session cookies stay on this host. Build context: repository root.
FROM node:22-bookworm-slim
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=1 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web apps/web
RUN pnpm install --frozen-lockfile --filter @fintech/web
RUN pnpm --filter @fintech/web build && chown -R node:node apps/web/.next
ENV NODE_ENV=production
USER node
WORKDIR /app/apps/web
# AIC_FRONTEND_ORIGIN defaults to this service's own public URL (set by Render).
CMD ["sh", "-c", "export AIC_FRONTEND_ORIGIN=\"${AIC_FRONTEND_ORIGIN:-$RENDER_EXTERNAL_URL}\"; exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p \"${PORT:-3000}\""]
