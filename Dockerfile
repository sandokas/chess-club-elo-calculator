FROM node:25-alpine

# Build tools for any native node modules.
RUN apk add --no-cache make g++ libc6-compat

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

