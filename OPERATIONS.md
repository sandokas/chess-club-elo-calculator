# Chess Club Development Operations

This document outlines operational rules and conventions for the Chess Club project to ensure consistency across development workflows.

## Package Management

**Rule**: Always use `pnpm` for package management - never use `npm`.

**Commands**:
- `pnpm install` - Install dependencies
- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm test` - Run tests
- `pnpm typecheck` - Run TypeScript type checking

**Monorepo Structure**: This is a pnpm workspace monorepo. Use `pnpm --filter <package>` for package-specific commands:
- `pnpm --filter @chess-club/api dev`
- `pnpm --filter @chess-club/web dev`

## Running Services

**Rule**: Use Docker Compose to run all services - do not run individual dev servers outside Docker.

**Commands**:
- `docker compose up -d` - Start all services in background
- `docker compose down` - Stop all services
- `docker compose logs -f` - View logs
- `docker compose restart` - Restart services

**Services**:
- `postgres` - PostgreSQL database on port 5432
- `api` - Node/TypeScript API on port 4000
- `web` - React web app on port 5173

**Why Docker Compose**: Ensures consistent environment, handles dependencies (postgres health checks), and matches production setup.

## API Conventions

**Rule**: Follow REST naming conventions for API endpoints.

**Top-level resources**: Use `:id` parameter
- `/players/:id` - Player detail
- `/tournaments/:id` - Tournament detail

**Nested resources**: Use descriptive parameter names
- `/clubs/:clubId/players` - Players in a club
- `/clubs/:clubId/tournaments` - Tournaments in a club
- `/clubs/:clubId/leaderboard` - Leaderboard for a club

**Rationale**: `:id` is standard for standalone resources. Descriptive names prevent ambiguity in nested routes.

## Project Architecture

**Stack**:
- **Node/TypeScript API**: `apps/api/` - REST API server
- **React Web App**: `apps/web/` - User interface
- **Database**: PostgreSQL via Docker
- **Legacy Python CLI**: `src/chess_club/` - Being migrated (reference only)

**Packages**:
- `@chess-club/config` - Shared configuration
- `@chess-club/core` - Core business logic (Elo, Glicko-2 ratings)
- `@chess-club/db` - Database schema and migrations

**Database Access**:
- API uses direct PostgreSQL queries via connection pooling
- Schema defined in `packages/db/drizzle/`

## Development Workflow

1. Start services: `docker compose up -d`
2. API available at: `http://localhost:4000`
3. Web app available at: `http://localhost:5173`
4. View logs: `docker compose logs -f`
5. Stop when done: `docker compose down`

## Code Style

**TypeScript**:
- Use existing patterns in `apps/api/src/app.ts`
- Follow React Router patterns in `apps/web/src/App.tsx`
- Use TypeScript types for all API responses
- Follow React component conventions (see ARCHITECTURE.md)

**Legacy Python**: See `docs/legacy-python/STYLEGUIDE.md` (reference only during migration)

## Database Operations

**Generate migrations** (after schema changes in `packages/db/src/schema.ts`):
```bash
pnpm db:generate
```
This creates a new SQL migration file with your schema changes.

**Apply migrations** (auto-runs on docker compose up, or run manually):
```bash
pnpm db:migrate
```
This applies pending migrations to the database. Safe to run multiple times - skips already-applied migrations.

**Backups**: Store all database dumps in the gitignored `backups/` folder at the repo root. Use a descriptive filename including a timestamp, e.g. `backups/uuidv7_recovery_YYYYMMDD_HHMMSS.sql`.

Dump (data only, excluding drizzle's bookkeeping schema):
```bash
docker compose exec -T postgres pg_dump -U chess_club --data-only --disable-triggers --exclude-schema=drizzle chess_club > backups/<name>_$(date +%Y%m%d_%H%M%S).sql
```

Restore into a freshly-migrated empty DB:
```bash
docker compose exec -T postgres psql -U chess_club -d chess_club -v ON_ERROR_STOP=1 < backups/<file>.sql
```

Do not create alternate dump folders (`.dumps/`, `tmp/`, etc.) — keep all dumps in `backups/`.

## Testing

**TypeScript**: `pnpm test` (Vitest)
**Python**: `pytest` (see `docs/legacy-python/TESTS.md` - reference only)
