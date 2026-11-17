#!/bin/sh
# Runs the actual account SQL against a disposable local PostgreSQL service.
# Never uses DATABASE_URL; no existing container or database is modified.
set -eu
cd "$(dirname "$0")/.."
container_name="quizzlet-foundation-pg-$(node -e 'process.stdout.write(require("crypto").randomBytes(6).toString("hex"))')"
cleanup() { docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM

docker run -d --rm --name "$container_name" -e POSTGRES_PASSWORD=local-test-only -e POSTGRES_DB=quizzlet_test -p 127.0.0.1::5432 postgres:16-bookworm >/dev/null
ready=0
for unused in $(seq 1 40); do
  if docker exec "$container_name" pg_isready -U postgres -d quizzlet_test >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then printf '%s\n' 'PostgreSQL did not become ready' >&2; exit 1; fi
port=$(docker port "$container_name" 5432/tcp | awk -F: 'NR==1 { print $NF }')
QUIZZLET_DISPOSABLE_PG=1 QUIZZLET_TEST_PG_URL="postgresql://postgres:local-test-only@127.0.0.1:$port/quizzlet_test" npm test -- server/accounts.pg.test.ts
