#!/bin/sh
# Bring the database up to date, then hand over.
#
# `migrate deploy` applies pending migrations and does nothing else — it never
# prompts, never resets, and never generates a migration. It is the one Prisma
# command that is safe to run unattended against real data, which is why it and
# not `migrate dev` runs here.
#
# On a fresh volume this creates the database from nothing, so a first `docker
# compose up` needs no setup step. `exec` at the end so the server becomes PID 1
# under dumb-init and receives signals directly.
set -e

if [ -z "$SESSION_SECRET" ]; then
  echo "contour: SESSION_SECRET is not set. Generate one with:" >&2
  echo "         openssl rand -hex 32" >&2
  exit 1
fi

echo "contour: applying database migrations to ${DATABASE_URL}"
./migrator/node_modules/prisma/build/index.js migrate deploy --schema apps/web/prisma/schema.prisma

exec "$@"
