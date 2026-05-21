FROM node:25-alpine

# Host UID/GID for the in-container `node` user. Defaults to 1000, which is:
#  - the UID/GID of the stock `node` user in node:*-alpine images,
#  - the default first-user UID on most Linux desktops,
#  - irrelevant on Windows/macOS Docker Desktop (the VM abstracts ownership).
# Linux hosts with a different UID/GID override at build time:
#   UID=$(id -u) GID=$(id -g) docker compose build
ARG UID=1000
ARG GID=1000

# `libc6-compat` provides glibc symbols on musl-based Alpine. Required by the
# older esbuild prebuilt binaries (<=0.19) that some transitive deps still pull
# in; newer prebuilts (rollup, tailwindcss oxide, lightningcss, esbuild >=0.20)
# ship native musl variants and don't depend on it.
#
# Native compile tools (make, g++) intentionally NOT installed: we have no
# packages that build at install time (project moved off better-sqlite3 to
# pg, which is pure JS). Saves ~150 MB in the image.
#
# We also re-create the `node` user with the requested UID/GID when it differs
# from the stock 1000:1000 so the container's writes to bind-mounted files land
# with the host user's perms.
RUN apk add --no-cache libc6-compat \
 && if [ "$UID" != "1000" ] || [ "$GID" != "1000" ]; then \
      deluser node \
      && addgroup -g "$GID" node \
      && adduser -u "$UID" -G node -s /bin/sh -D node; \
    fi

# pnpm globally.
RUN npm install -g pnpm@11.0.8

WORKDIR /workspace

# Pre-create the workspace's node_modules trees with node-user ownership.
# Anonymous volumes declared in docker-compose.yml will inherit these perms,
# so the container can write to its own node_modules without root access and
# without colliding with the host's (Windows-binary) node_modules under the
# bind mount.
RUN mkdir -p \
      /workspace/node_modules \
      /workspace/apps/api/node_modules \
      /workspace/apps/web/node_modules \
      /workspace/packages/db/node_modules \
      /workspace/packages/config/node_modules \
    && chown -R node:node /workspace

USER node

# Install dependencies at IMAGE BUILD TIME, not at container start. We copy
# only the package manifests + lockfile first so this layer is cached unless
# dependencies actually change. Container start is then instant.
COPY --chown=node:node pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY --chown=node:node apps/api/package.json apps/api/
COPY --chown=node:node apps/web/package.json apps/web/
COPY --chown=node:node packages/db/package.json packages/db/
COPY --chown=node:node packages/config/package.json packages/config/

RUN pnpm install --frozen-lockfile

# Source code is mounted at runtime via the bind mount in docker-compose.yml.
# node_modules dirs are masked by anonymous volumes so the bind mount cannot
# overwrite the install we just did.

