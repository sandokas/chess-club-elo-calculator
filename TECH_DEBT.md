# Technical Debt Register

This document tracks intentional shortcuts, deferred production-readiness work, and follow-up tasks discovered during the Python-to-Node migration.

## How to Use This File

Add new items under `Open Items` when work is deliberately postponed. Each item should include:

- **Context**: why the debt exists.
- **Risk**: what can go wrong if it remains unresolved.
- **Future fix**: the intended direction.
- **Trigger**: when the team should prioritize it.
- **Status**: `open`, `in-progress`, or `resolved`.

## Open Items

### Production-ready Docker images

- **Status**: open
- **Context**: The current `docker-compose.yml` is optimized for local development. It bind-mounts the repository, runs `pnpm install` at container startup, runs Vite/Fastify dev servers, and uses the shared source tree as the working directory.
- **Risk**: This is convenient for development but not appropriate for production. Startup is slower, dependency installation can drift at runtime, source files are mutable inside containers, and dev servers are not hardened production processes.
- **Future fix**: Add production Dockerfiles that build immutable images for the API and web app. The images should install dependencies during build with a frozen lockfile, run build steps ahead of time, copy only runtime artifacts into final images, and run as non-root users.
- **Trigger**: Before deploying the Node web app beyond local development or before putting it behind nginx/a real domain.

#### Proposed production migration plan

1. Add `apps/api/Dockerfile` using a multi-stage Node build.
2. Add `apps/web/Dockerfile` using a multi-stage Vite build that outputs static assets.
3. Serve the web build through nginx, Caddy, or a minimal static server image.
4. Remove runtime `pnpm install` from production containers.
5. Use `pnpm install --frozen-lockfile` during image builds.
6. Copy only required workspace packages and built artifacts into final runtime stages.
7. Run final containers as non-root users.
8. Separate development Compose from production Compose, for example:
   - `docker-compose.yml` for local development
   - `docker-compose.prod.yml` for production-like runtime
9. Add production healthchecks and restart policies.
10. Document deployment environment variables and secret management.

### Development containers write into bind-mounted source

- **Status**: open
- **Context**: Local development Compose still bind-mounts the repository into Node containers so dev servers can hot-reload source changes.
- **Risk**: Tooling can create cache/temp files inside the repository. This has already happened with Vite cache directories.
- **Future fix**: Keep Node services running as the built-in `node` user and keep package-manager cache/store paths under `/home/node`. Consider moving Vite cache/temp output outside bind-mounted `node_modules` if this remains noisy.
- **Trigger**: If root-owned or container-owned generated files reappear, or if local/host builds continue to conflict with container-generated caches.

### Python CLI and documentation cleanup

- **Status**: open
- **Context**: The Python CLI application in `src/chess_club/` and its documentation in `docs/legacy-python/` remain in the repository as a reference during migration. Once the Node.js/TypeScript application has feature parity, these should be removed.
- **Risk**: Keeping unused code and documentation creates confusion about what is current vs legacy, adds maintenance burden, and may lead to accidental use of deprecated code paths.
- **Future fix**: Delete `src/chess_club/`, `docs/legacy-python/`, `tests/` (Python tests), and remove Python dependencies from `pyproject.toml` once migration is complete. Update all documentation to remove Python references.
- **Trigger**: After Phase 3 (Admin Workflows) of the migration is complete and all features are verified to work in the Node.js/TypeScript application. See `MIGRATION.md` for migration phases.

## Resolved Items

Add resolved technical debt here with a short note and date when items are completed.
