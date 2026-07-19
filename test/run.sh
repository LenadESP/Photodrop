#!/usr/bin/env bash
#
# Run the verification harnesses against a built photodrop image.
#
#   ./test/run.sh                      # against homelab/photodrop:<version from compose>
#   ./test/run.sh homelab/photodrop:1.5.0
#   ./test/run.sh homelab/photodrop:1.5.0 video   # just one
#
# Each harness boots the real app from the image's dist/ and drives real routes
# through fastify's inject(), so there is no network and no server to wait on.
#
# Why a container at all: there is no node on this host, and the harnesses need
# the image's compiled dist/ plus its native modules (better-sqlite3, sharp,
# argon2) and ffmpeg. They must NOT run against the live container — they create
# albums, lock accounts and insert a second admin, so they need a throwaway DB.
#
# Every run is `docker run --rm` and one-shot: the container lives only for the
# seconds the harness runs, then removes itself. Nothing is left behind to strand
# (an earlier `-d ... sleep 900` pattern is how a stray container got orphaned)
# and nothing lingers in the monitoring dashboard.
set -uo pipefail

cd "$(dirname "$0")/.."

IMAGE="${1:-}"
if [ -z "$IMAGE" ]; then
  IMAGE="homelab/photodrop:$(grep -oP 'image:\s*homelab/photodrop:\K[0-9.]+' compose.yaml | head -1)"
fi
ONLY="${2:-}"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "image not found: $IMAGE" >&2
  echo "build it first: docker compose build" >&2
  exit 1
fi

# Fake values. They only ever reach a throwaway container with a tmpfs database,
# and the production guard's 32-char minimum is prod-gated, so these are long
# enough to boot in development mode.
COMMON_ENV=(
  -e NODE_ENV=development
  -e DATA_DIR=/data
  -e PUBLIC_ORIGIN=http://localhost:3000
  -e JWT_SECRET=test-jwt-secret-for-the-harness-0123456789abcdef
  -e CSRF_SECRET=test-csrf-secret-for-the-harness-0123456789abcde
  -e COOKIE_SECRET=test-cookie-secret-for-the-harness-0123456789ab
  -e ADMIN_USERNAME=harness
  -e ADMIN_PASSWORD=harness-admin-password-not-a-real-one
)

run_one() {
  local name="$1" file="$2"
  shift 2
  echo
  echo "══════ $name ($file) ══════"
  # --user 0 so the harness can write the tmpfs data dir; --tmpfs (not a bind)
  # keeps every run's database isolated and disposable. The harness is mounted
  # INSIDE /app or its bare imports (otplib, sharp) cannot resolve.
  # --no-healthcheck is belt-and-braces: this image defines none today, so a
  # throwaway run never reports a health state either way.
  # Named so it is identifiable if you happen to catch it in `docker ps` or the
  # monitoring dashboard, rather than showing up as a random `silly_hertz`. A
  # name collision means a run is already in flight, which is worth failing on.
  docker run --rm \
    --name "photodrop-test-${file%.mjs}" \
    --user 0 \
    --no-healthcheck \
    --tmpfs /data:exec,mode=777 \
    -v "$PWD/test/$file:/app/harness.mjs:ro" \
    "${COMMON_ENV[@]}" "$@" \
    --entrypoint node "$IMAGE" /app/harness.mjs 2>&1 | grep -vE '^\{"level"'
  return "${PIPESTATUS[0]}"
}

rc=0
if [ -z "$ONLY" ] || [ "$ONLY" = "auth" ]; then
  run_one "auth hardening" auth.mjs || rc=1
fi
if [ -z "$ONLY" ] || [ "$ONLY" = "upload" ]; then
  # A solid-colour test JPEG compresses to ~22KB, so the default 8MiB part size
  # would only ever produce one part and the chunking would go untested.
  run_one "resumable upload" upload.mjs -e UPLOAD_PART_BYTES=4096 || rc=1
fi
if [ -z "$ONLY" ] || [ "$ONLY" = "video" ]; then
  run_one "video pipeline" video.mjs || rc=1
fi

echo
if [ "$rc" -eq 0 ]; then
  echo "══════ all harnesses passed against $IMAGE ══════"
else
  echo "══════ FAILURES against $IMAGE ══════"
fi
exit "$rc"
