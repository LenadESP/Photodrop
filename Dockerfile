# syntax=docker/dockerfile:1
ARG NODE_VERSION=22

# ── 1. Build the frontend (Vite → static assets) ─────────────────────────────
FROM node:${NODE_VERSION}-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build                         # → /app/frontend/dist

# ── 2. Build the backend (tsc → dist) + prod deps with native prebuilds ──────
FROM node:${NODE_VERSION}-slim AS backend
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci                                # native prebuilds: better-sqlite3, sharp, argon2
COPY backend/ ./
RUN npm run build && npm prune --omit=dev # tsc → dist; drop dev deps, keep native runtime deps

# ── 3. Runtime ───────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-slim AS runtime
# exiftool-vendored ships the exiftool Perl script but relies on a perl interpreter.
# Installed in THIS image only — never on the host.
RUN apt-get update \
    && apt-get install -y --no-install-recommends perl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=backend  /app/backend/node_modules ./node_modules
COPY --from=backend  /app/backend/dist         ./dist
COPY --from=backend  /app/backend/package.json ./package.json
COPY --from=frontend /app/frontend/dist        ./public
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
