#!/bin/sh
# Runs the Redis-backed tests (the score script in server/store.ts and the
# maintenance scripts) against a disposable Redis container. Use this when
# `redis-server` isn't installed; when it is, `npm test` runs them directly.
# No existing container or Redis is touched.
set -eu
cd "$(dirname "$0")/.."
container_name="quizzlet-store-redis-$(node -e 'process.stdout.write(require("crypto").randomBytes(6).toString("hex"))')"
cleanup() { docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM

docker run -d --rm --name "$container_name" -p 127.0.0.1::6379 redis:7.4.2-alpine >/dev/null
ready=0
for unused in $(seq 1 40); do
  if docker exec "$container_name" redis-cli ping >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then printf '%s\n' 'Redis did not become ready' >&2; exit 1; fi
port=$(docker port "$container_name" 6379/tcp | awk -F: 'NR==1 { print $NF }')
QUIZZLET_TEST_REDIS="127.0.0.1:$port" npm test -- server/store.test.ts scripts/maintenance.test.ts
