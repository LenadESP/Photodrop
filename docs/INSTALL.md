# Installation & deployment

The [README Quickstart](../README.md#quickstart-docker) gets you running standalone in a
few commands. This is the full version, covering both deployment paths:

- **(a) Standalone** — publish a port, reach it on `localhost`. Good for a quick trial
  or a single-box setup.
- **(b) Behind a reverse proxy** — no published ports, joins an external Docker network,
  TLS terminated upstream. Production shape.

Both share the same base `compose.yaml`. Path (b) adds a small, gitignored
`compose.override.yaml` for the infra specifics — the base file is never edited.

## Requirements

- Docker + Docker Compose (v2).
- For path (b): a TLS-terminating reverse proxy on a shared Docker network.
- Disk for persistent data (default `./data` next to `compose.yaml`; relocatable).

## 1. Configuration (both paths)

```bash
cp .env.example .env
```

Generate the three secrets and paste each into `.env`:

```bash
openssl rand -base64 48   # → JWT_SECRET
openssl rand -base64 48   # → CSRF_SECRET
openssl rand -base64 48   # → COOKIE_SECRET
```

Then set `ADMIN_PASSWORD` to something strong and `PUBLIC_ORIGIN` to the URL you'll open
the app at (used for share links and Secure-cookie scoping). Lock the file down:

```bash
chmod 600 .env
```

Production boot **fails** if any secret still holds a `CHANGE_ME` placeholder.
See the [README config table](../README.md#configuration) for every variable.

## Path (a) — Standalone

No reverse proxy. Publish the port and use a `localhost` origin.

1. In `compose.yaml`, uncomment the port mapping:

   ```yaml
       ports:
         - "3000:3000"
   ```

2. In `.env`, set a plain-HTTP origin:

   ```bash
   PUBLIC_ORIGIN=http://localhost:3000
   ```

   > Secure cookies require HTTPS. The base image sets `NODE_ENV=production`, which keeps
   > the `Secure` flag on cookies — over plain HTTP the browser will drop them and login
   > won't stick. For local HTTP testing, also set `NODE_ENV=development` in `.env`
   > (cookies drop `Secure` when `NODE_ENV` isn't `production`). Do **not** run
   > `development` on a public origin.

3. Data lives in `./data` by default — Compose creates it (owned by uid 1000). To put it
   elsewhere, set `DATA_DIR=/abs/host/path` in `.env`; the container path stays `/data`.

4. Build and run:

   ```bash
   docker compose build
   docker compose up -d
   docker compose logs -f          # watch first boot: migrations + admin seed
   ```

Open `http://localhost:3000`.

## Path (b) — Behind a reverse proxy

No published ports. The app joins an external network your proxy also sits on and is
reached at `apps-photodrop:3000`; the proxy terminates TLS.

1. Create the override from the template:

   ```bash
   cp compose.override.example.yaml compose.override.yaml
   ```

   Edit it to match your infra — the shipped example:

   ```yaml
   services:
     photodrop:
       volumes:
         - /srv/photodrop:/data     # absolute host data path
       networks:
         - proxy

   networks:
     proxy:
       name: proxy                  # your reverse proxy's network
       external: true
   ```

   `compose.override.yaml` is gitignored; Compose auto-merges it on top of
   `compose.yaml`, so leave the base untouched.

2. Prepare the data directory (container runs as uid 1000, `node`):

   ```bash
   sudo mkdir -p /srv/photodrop/{data,albums,tmp}
   sudo chown -R 1000:1000 /srv/photodrop
   ```

3. Create the network if it doesn't exist, then build and run:

   ```bash
   docker network create proxy
   docker compose build
   docker compose up -d
   ```

4. Point your proxy at the container and set `PUBLIC_ORIGIN` in `.env` to the public URL.
   The app trusts one proxy hop by default (`TRUST_PROXY_HOPS=1`), so `X-Forwarded-For`
   gives it the real client IP — make sure your proxy sets it; raise the value if you
   stack another trusted proxy in front. Example Caddy site block:

   ```
   photos.example.org {
       reverse_proxy apps-photodrop:3000
   }
   ```

Confirm the merged result before starting: `docker compose config` prints the effective
base + override configuration.

> **Author's setup.** The public path fronts this with a Cloudflare Tunnel and CrowdSec;
> that's infrastructure outside this repo and not required to run photodrop.

## First login (both paths)

Open `PUBLIC_ORIGIN` and log in with the seeded admin credentials. You'll be forced to
enroll TOTP (scan the QR with an authenticator app, confirm a code) before a session is
issued. **Save the TOTP seed** — V1 has no backup codes.

The admin is seeded on first boot only, when the users table is empty.

**Lost your TOTP device?** Clear the enrolment from the box so the next login re-enrols:

```bash
docker exec apps-photodrop node dist/scripts/reset-totp.js <username>
```

## Upgrades

```bash
git pull
docker compose build
docker compose up -d
```

Migrations under `backend/src/db/migrations/` run automatically at startup and are
tracked in a `_migrations` table, so they apply exactly once. Back up your data
directory (DB + photo files) before a major upgrade.

## Backup

Everything stateful is under the data directory (`./data`, or wherever `DATA_DIR` /
your override points):

- `data/photodrop.db` (+ `-wal` / `-shm`) — accounts, albums, photo metadata.
- `albums/<uid>/` — the actual image files.

Snapshot the whole tree. SQLite in WAL mode is best backed up with the container stopped,
or via `sqlite3 .backup`.
