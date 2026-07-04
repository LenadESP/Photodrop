# Installation & deployment

The [README Quickstart](../README.md#quickstart-docker) is the short path. This is the
full version, including the reverse-proxy wiring the shipped `compose.yaml` assumes.

## Requirements

- Docker + Docker Compose.
- A TLS-terminating reverse proxy in front (the compose file publishes no ports).
- A host directory for persistent data (default `/var/lib/homelab/photodrop`).

## 1. Configuration

```bash
cp .env.example .env
```

Generate the three secrets and paste each into `.env`:

```bash
openssl rand -base64 48   # → JWT_SECRET
openssl rand -base64 48   # → CSRF_SECRET
openssl rand -base64 48   # → COOKIE_SECRET
```

Then set `ADMIN_PASSWORD` to something strong and `PUBLIC_ORIGIN` to your public URL
(used for share links and Secure-cookie scoping). Lock the file down:

```bash
chmod 600 .env
```

Production boot **fails** if any secret still holds a `CHANGE_ME` placeholder.
See the [README config table](../README.md#configuration) for every variable.

## 2. Data directory

The container runs as uid 1000 (`node`) and mounts the data dir at `/data`:

```bash
sudo mkdir -p /var/lib/homelab/photodrop/{data,albums,tmp}
sudo chown -R 1000:1000 /var/lib/homelab/photodrop
```

To use a different host path, edit the `volumes:` mapping in `compose.yaml`.

## 3. Build and run

```bash
docker compose build
docker compose up -d
docker compose logs -f          # watch first boot: migrations + admin seed
```

On first boot the app creates the SQLite DB, applies migrations, and seeds the single
admin account from `ADMIN_USERNAME` / `ADMIN_PASSWORD` (only if the users table is empty).

## 4. Reverse proxy

`compose.yaml` publishes no ports and joins an external `networking_proxy` Docker
network. Your proxy must be on that network and terminate TLS, forwarding to
`apps-photodrop:3000`. The app trusts exactly one proxy hop (`trustProxy: 1`) so
`X-Forwarded-For` gives it the real client IP — make sure your proxy sets it.

Create the network first if it doesn't exist:

```bash
docker network create networking_proxy
```

Example Caddy site block:

```
photos.example.org {
    reverse_proxy apps-photodrop:3000
}
```

The author's deployment fronts this with a Cloudflare Tunnel and CrowdSec; that's
infrastructure outside this repo and not required to run photodrop.

## 5. First login

Open `PUBLIC_ORIGIN` and log in with the seeded admin credentials. You'll be forced to
enroll TOTP (scan the QR with an authenticator app, confirm a code) before a session is
issued. **Save the TOTP seed** — V1 has no recovery codes.

## Running standalone (no proxy)

For a quick local test without a reverse proxy, add a port mapping and a plain-HTTP
origin. In `compose.yaml`:

```yaml
    ports:
      - "3000:3000"
```

and set `PUBLIC_ORIGIN=http://localhost:3000` in `.env`. Cookies drop the `Secure`
flag automatically when `NODE_ENV` is not `production`, but note the shipped compose
sets `NODE_ENV=production`; for local HTTP testing you may also want to override that.

## Upgrades

```bash
git pull
docker compose build
docker compose up -d
```

Migrations under `backend/src/db/migrations/` run automatically at startup and are
tracked in a `_migrations` table, so they apply exactly once. Back up
`/var/lib/homelab/photodrop/` (DB + photo files) before a major upgrade.

## Backup

Everything stateful is under the data directory:

- `data/photodrop.db` (+ `-wal` / `-shm`) — accounts, albums, photo metadata.
- `albums/<uid>/` — the actual image files.

Snapshot the whole `/var/lib/homelab/photodrop/` tree. SQLite in WAL mode is best
backed up with the container stopped, or via `sqlite3 .backup`.
