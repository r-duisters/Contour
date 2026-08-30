# syntax=docker/dockerfile:1
#
# Contour's web app, as one self-contained image.
#
# Build from the repository root, not from this directory — the build needs the
# workspace packages that live above `apps/web`:
#
#   docker build -f docker/web/Dockerfile -t contour .
#
# Debian rather than Alpine, and that is not a preference. Prisma compiles its
# query engine per libc: the client generated here is
# `libquery_engine-debian-openssl-3.0.x.so.node`, which needs glibc and OpenSSL
# 3. On Alpine it fails at the first query, at runtime, with an error about a
# missing engine rather than anything about the base image.

# ── deps ──────────────────────────────────────────────────────────────────────
# Manifests only, so `npm ci` re-runs when a dependency changes and not when a
# component does. Every workspace manifest has to be here: npm reads the whole
# workspace graph before it will install any of it.
FROM node:22-bookworm-slim AS deps
# OpenSSL, before `npm ci`, and it is not optional.
#
# Prisma picks its engine binary by detecting the OpenSSL version at install
# and generate time. The slim images ship without OpenSSL, so detection fails
# and it silently falls back to `debian-openssl-1.1.x` — engines that will not
# load on Debian 12, which is OpenSSL 3. The failure is a runtime
# "Query engine library not found" naming directories that plainly contain an
# engine, because the one they contain is for the wrong libssl.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json      apps/web/
COPY apps/mobile/package.json   apps/mobile/
COPY packages/core/package.json packages/core/
COPY packages/data/package.json packages/data/
COPY packages/ui/package.json   packages/ui/
RUN npm ci --no-audit --no-fund

# ── build ─────────────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /repo
COPY . .
# The root manifest carries `prisma.schema`, so this needs no --schema flag.
RUN npx prisma generate
# CONTOUR_STANDALONE makes next.config emit a server directory that runs
# without node_modules. Without it the build is the ordinary one and the
# runtime stage below has nothing to copy.
ENV CONTOUR_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── migrator ──────────────────────────────────────────────────────────────────
# The Prisma CLI, installed on its own.
#
# `migrate deploy` is a command, not a module — nothing in the app imports it,
# so Next's dependency trace does not carry it and the runtime image has to get
# it another way.
#
# Copying `node_modules/prisma` and `node_modules/@prisma/engines` out of the
# build stage was the obvious way and it is wrong twice. The CLI's own
# dependencies are hoisted to the workspace root and do not come with it, so it
# dies on `Cannot find module '@prisma/debug'`. And `@prisma/engines` as
# installed for the workspace carried `schema-engine-debian-openssl-1.1.x`,
# while this base image is Debian 12 with OpenSSL 3 — a mismatch that surfaces
# at the first migration rather than at build time.
#
# A clean install in its own prefix fixes both: npm resolves the CLI's
# dependencies beside it, and Prisma's postinstall fetches the engines for the
# platform it is actually being installed on. Pinned to the same major the
# workspace uses; the CLI and the client must agree.
FROM node:22-bookworm-slim AS migrator
# Same reason as the deps stage: without OpenSSL, Prisma's postinstall fetches
# 1.1.x engines that cannot load here.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /cli
RUN npm init -y >/dev/null 2>&1 \
 && npm i --no-audit --no-fund --omit=dev prisma@^6.19.3 \
 && rm -rf /root/.npm

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# `dumb-init` because Next's server does not reap children or forward signals on
# its own; without an init, `docker stop` waits the full ten seconds and then
# kills it, which is a poor way to close a SQLite handle.
RUN apt-get update \
 && apt-get install -y --no-install-recommends dumb-init ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*

# The traced server, and the two things tracing does not carry: the static
# chunks and `public/`. Next documents both as manual copies.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static     ./apps/web/.next/static
COPY --from=build /repo/apps/web/public           ./apps/web/public

# The repository root marker.
#
# `apps/web/src/lib/repo-root.ts` finds the root by climbing from its own
# compiled location until it meets a `package.json` with a `workspaces` field,
# and standalone output does not emit one. Without this file it throws at
# startup — deliberately, rather than silently serving an empty script list and
# a 404 for the APK. The root manifest has no `type` field, so dropping it here
# cannot change how `server.js` is parsed.
COPY package.json ./package.json

# Read at runtime, from the repository root: the bundled PineScripts, and the
# icon cache's directory. `samples/` is small and `.icon-cache/` fills itself.
COPY samples ./samples
RUN mkdir -p .icon-cache

# Prisma's migration path, from the `migrator` stage rather than by copying
# packages out of the build. The schema and the migrations come from the app's
# own tree.
COPY --from=migrator /cli/node_modules ./migrator/node_modules
COPY --from=build /repo/apps/web/prisma ./apps/web/prisma

COPY docker/web/entrypoint.sh /usr/local/bin/contour-entrypoint
RUN chmod +x /usr/local/bin/contour-entrypoint

# `node` exists in the base image as uid 1000. The database lives on a volume,
# so the directory has to be owned before the volume is mounted over it — and
# the compose file mounts it at this path.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

ENV PORT=3000 HOSTNAME=0.0.0.0 DATABASE_URL=file:/data/contour.db
EXPOSE 3000

# `/login` rather than `/`, which redirects, and rather than an API route, which
# would need a secret. It renders for an unauthenticated request, which is
# exactly the question a health check asks.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--", "contour-entrypoint"]
CMD ["node", "apps/web/server.js"]
