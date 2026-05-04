# Session Handoff

Date: 2026-05-03

## Goal

Convert the existing Python CLI chess club manager into a TypeScript web product foundation:

- pnpm monorepo
- Fastify API
- React + Vite frontend shell
- Drizzle ORM + PostgreSQL
- Docker Compose
- SQLite import path from the existing `chessclub.db`
- TypeScript port of rating logic

## What Was Implemented

New root workspace files:

- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `.env.example`
- `docker-compose.yml`
- `ARCHITECTURE.md`

New apps:

- `apps/api`
  - Fastify app
  - `/health`
  - `/health/db`
  - placeholder public `GET /clubs`
  - API health tests
- `apps/web`
  - React/Vite shell
  - calls API `/health`
  - minimal responsive styling

New packages:

- `packages/config`
  - shared env validation with Zod
- `packages/core`
  - TypeScript Elo port
  - TypeScript Glicko-2 port
  - basic rating recompute helper
  - tests anchored to current Python outputs
- `packages/db`
  - Drizzle PostgreSQL schema
  - initial SQL migration
  - database client
  - SQLite import script
  - schema smoke test

The Python CLI app was intentionally not removed.

## Important Design Decisions Captured

- Node.js + TypeScript backend going forward.
- `pnpm` workspaces.
- Fastify API.
- Drizzle ORM/Drizzle Kit rather than Prisma.
- PostgreSQL production DB.
- Players are separate from users.
- Players may exist without login accounts.
- Admins can later link users to players.
- Ratings are per club.
- Public users can only see safe club metadata.
- Club data and real player names require authenticated club membership.
- Mutations will require owner/admin/organizer roles.
- Historical `player1_id` imports as `white_player_id`.
- Historical `player2_id` imports as `black_player_id`.
- Historical match result remains from White/player1 perspective.

## Verification Done

Existing Python test suite still passes:

```bash
.venv/bin/python -m pytest -q
```

Result:

```text
16 passed
```

Manifest sanity checks passed:

- All `package.json` files parse as JSON.
- Drizzle journal JSON parses.

SQLite source data was checked:

```text
Players: 36
Tournaments: 21
TournamentPlayers: 174
Matches: 312
```

## Verification Not Done

This environment did not have the following commands on PATH:

- `node`
- `npm`
- `pnpm`
- `docker`

Because of that, the TypeScript packages, Drizzle generation, Docker Compose runtime, and importer were not executed in this session.

Important: the initial Drizzle SQL migration was written manually because `drizzle-kit generate` could not run here. Once Node/pnpm are available, reconcile generated migration output with the committed migration.

## Recommended Next Steps After Moving/Reopening

1. Install or enable Node.js 22+ and pnpm.

2. From the repo root, install dependencies:

```bash
corepack enable
pnpm install
```

3. Run TypeScript checks/tests:

```bash
pnpm typecheck
pnpm test
```

4. Check Drizzle migration consistency:

```bash
pnpm db:generate
```

Review any generated migration output before keeping it. The committed migration is:

```text
packages/db/drizzle/0000_initial_foundation.sql
```

5. Start local PostgreSQL/API/Web with Docker:

```bash
pnpm docker:up
```

6. In another terminal, run the import after DB migration has applied:

```bash
pnpm import:sqlite
```

7. Verify:

```bash
curl http://localhost:4000/health
curl http://localhost:4000/health/db
```

Open:

```text
http://localhost:5173
```

## Known Follow-Up Work

- Fix any TypeScript compile/runtime issues that appear once Node dependencies are installed.
- Reconcile Drizzle-generated migration metadata.
- Run the SQLite importer against PostgreSQL and validate the report.
- Add real `GET /clubs` database-backed implementation.
- Add auth implementation:
  - email/password
  - Google OAuth
  - sessions
  - invites
- Add club access guards.
- Build admin workflows after import and API foundation are verified.

## Files To Review First On Resume

- `ARCHITECTURE.md`
- `package.json`
- `docker-compose.yml`
- `packages/core/src`
- `packages/db/src/schema.ts`
- `packages/db/scripts/import-sqlite.ts`
- `apps/api/src/app.ts`
- `apps/web/src/App.tsx`

## Environment Separation Update

Runtime environment and SQLite import environment are now separate.

- `.env` and `.env.example` are for normal app runtime only.
- `.env.import` and `.env.import.example` are for the one-off SQLite import job.
- The importer uses `IMPORT_*` variables and does not depend on runtime `DATABASE_URL` or legacy SQLite variables.
