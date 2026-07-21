# Contributing

Small, single-maintainer project. PRs and issues welcome; keep them focused.

## Dev setup

Requires **Node 22+**. The backend and frontend are separate npm packages run as two
dev servers.

```bash
git clone https://github.com/LenadESP/Photodrop.git photodrop
cd photodrop

# Backend
cd backend
npm install
cp ../.env.example .env        # dev secrets can be any non-empty value (see note)
export DATA_DIR=$(pwd)/.devdata # local data dir instead of /data
mkdir -p .devdata/{data,albums,tmp}
npm run dev                     # tsx watch → http://localhost:3000

# Frontend (second terminal)
cd frontend
npm install
npm run dev                     # vite → http://localhost:5173
```

Notes:

- **Secrets in dev.** `env.ts` only rejects `CHANGE_ME` placeholders when
  `NODE_ENV=production`. In dev any non-empty `JWT_SECRET` / `CSRF_SECRET` /
  `COOKIE_SECRET` works, and cookies are issued without the `Secure` flag so they work
  over plain HTTP.
- **DATA_DIR.** Point it at a local directory so you don't need `/data`. The backend
  creates the SQLite DB, runs migrations, and seeds the admin on first boot.
- **The SPA in dev** is served by Vite, not the backend. `app.ts` only serves the built
  SPA when `../public` exists (i.e. inside the Docker image). Configure the Vite dev
  proxy to forward `/api` to `localhost:3000` if you haven't already.
- **First login forces TOTP** in dev too — enroll with any authenticator app.

## Build / checks

There is **no `npm test` and no CI yet**. The type checker is the first gate:

```bash
# Backend: compiles with tsc (strict), copies migrations into dist
cd backend && npm run build

# Frontend: type-checks then builds
cd frontend && npm run build     # tsc --noEmit && vite build
```

Run both before opening a PR — a green `build` in each package is the bar.

There are also **verification harnesses** under [`test/`](test/), run against a built
image by `./test/run.sh [image] [auth|upload|video]`. They boot the real app from the
image's `dist/` and drive real routes in-process (fastify `inject()`), covering auth
hardening, resumable upload and the video pipeline — including the properties that are
easy to regress silently (download serves the original not the preview, metadata is
stripped, a photo thumbnail is processed before a video transcode). Each run is a
one-shot `docker run --rm`. They are not wired to `npm test` and are not automated; run
them by hand when touching those areas, and add assertions when you change that
behaviour.

## Conventions

- **TypeScript, strict.** No `any` escape hatches without a reason.
- **ESM with `.js` import specifiers.** The backend is `"type": "module"` with
  `moduleResolution: NodeNext`; relative imports in `.ts` source carry a `.js`
  extension (e.g. `import { env } from './env.js'`). This is required, not a mistake.
- **Folder structure** (backend): `routes/` for HTTP handlers, `plugins/` for Fastify
  plugins (cross-cutting: auth, csrf, security, db), `lib/` for pure/util logic,
  `schemas/` for TypeBox request validation, `db/` for schema and migrations. Keep
  request validation in `schemas/` and reference it from the route.
- **Validation.** Every route with a body or params gets a TypeBox schema with
  `additionalProperties: false`.
- **Security-sensitive changes** (auth, cookies, CSRF, upload validation, path
  handling) should say in the PR what property they preserve. See [SECURITY.md](SECURITY.md).
- **Migrations are append-only.** Add `NNN_description.sql` under
  `backend/src/db/migrations/`; never edit an already-applied file.
- Match the surrounding style (comment density, naming). No reformatting-only diffs.

## PR flow

1. Branch off `main`.
2. Make the change; keep it scoped to one thing.
3. `npm run build` passes in both `backend/` and `frontend/`.
4. Open a PR describing what changed and why. Link an issue if there is one.
5. Note anything you couldn't verify or any follow-up you're deferring.
