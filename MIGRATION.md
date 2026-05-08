# Python to Node.js Migration Progress

This document tracks the migration of the Chess Club Manager from a Python CLI application to a Node.js/TypeScript web application.

## Migration Overview

**Source**: Python CLI (`src/chess_club/`) - Legacy
**Target**: Node.js/TypeScript web app (`apps/api/`, `apps/web/`) - Current
**Database**: SQLite → PostgreSQL via Drizzle ORM
**Status**: Foundation phase complete, read-only features working

## Current Implementation Status

### ✅ Completed (Foundation Phase)

**API Endpoints (apps/api/src/app.ts):**
- ✅ `GET /health` - Health check
- ✅ `GET /health/db` - Database health check
- ✅ `GET /clubs` - List clubs (database-backed)
- ✅ `GET /clubs/:clubId/players` - List players with pagination, filtering, sorting
- ✅ `GET /clubs/:clubId/tournaments` - List tournaments
- ✅ `GET /clubs/:clubId/leaderboard` - Club leaderboard
- ✅ `GET /tournaments/:id` - Tournament detail with matches and standings
- ✅ `GET /players/:id` - Player detail with match history

**Web Pages (apps/web/src/App.tsx):**
- ✅ Admin overview page (leaderboard, tournaments, stats)
- ✅ Players list page (filtering, sorting, pagination)
- ✅ Tournament detail page (matches, standings)
- ✅ Player detail page (info, match history, rating history)

**Infrastructure:**
- ✅ pnpm workspace monorepo structure
- ✅ Docker Compose for local development
- ✅ PostgreSQL database schema (Drizzle)
- ✅ TypeScript core package (Elo, Glicko-2 rating logic)
- ✅ SQLite import script

### ❌ Not Implemented

**API:**
- ❌ Authentication endpoints (email/password, Google OAuth, sessions, invites)
- ❌ Club access guards/authorization
- ❌ Mutation endpoints (POST/PUT/DELETE):
  - Create/update/delete clubs
  - Create/update/delete players
  - Create/update/delete tournaments
  - Create/update/delete matches
  - Record match results
- ❌ Admin workflow endpoints (tournament creation, match recording, player management)

**Web:**
- ❌ Authentication UI (login, signup, OAuth)
- ❌ Club management UI (create club, settings, member management)
- ❌ Tournament creation UI
- ❌ Match recording UI
- ❌ Player management UI (add/edit/deactivate players)

**Infrastructure (needs verification):**
- ❓ Drizzle migration reconciliation (needs verification against generated output)
- ❓ SQLite importer validation (needs to be run and validated)

## Migration Phases

### Phase 1: Foundation Verification (High Priority)
**Goal**: Ensure current foundation is solid before adding auth and mutations.

- [ ] Verify Drizzle migration consistency
  - Run `pnpm db:generate`
  - Reconcile generated migration with committed `packages/db/drizzle/0000_initial_foundation.sql`
- [ ] Run SQLite importer and validate
  - Ensure `.env.import` is configured
  - Run `pnpm import:sqlite`
  - Validate import report (player count, tournament count, match count)
- [ ] Verify all read-only endpoints work with imported data
  - Test all GET endpoints with real data
  - Verify ratings calculations match Python outputs

### Phase 2: Authentication (High Priority)
**Goal**: Implement authentication and authorization system.

**API:**
- [ ] Implement email/password authentication
  - POST /auth/register
  - POST /auth/login
  - POST /auth/logout
- [ ] Implement Google OAuth
  - GET /auth/google
  - GET /auth/google/callback
- [ ] Implement session management
  - Session creation, validation, expiration
- [ ] Implement club invitations
  - POST /clubs/:clubId/invites
  - GET /clubs/:clubId/invites
  - POST /invites/:id/accept
  - POST /invites/:id/decline
- [ ] Implement club access guards
  - Protect endpoints based on club membership
  - Role-based access (owner, admin, organizer, member)

**Web:**
- [ ] Build login page
- [ ] Build signup page
- [ ] Build OAuth integration
- [ ] Build invitation acceptance flow
- [ ] Add auth state management

### Phase 3: Admin Workflows (Medium Priority)
**Goal**: Implement full CRUD operations for club management.

**API:**
- [ ] Club mutations
  - POST /clubs
  - PUT /clubs/:id
  - DELETE /clubs/:id
- [ ] Player mutations
  - POST /clubs/:clubId/players
  - PUT /players/:id
  - DELETE /players/:id
  - PATCH /players/:id/deactivate
- [ ] Tournament mutations
  - POST /clubs/:clubId/tournaments
  - PUT /tournaments/:id
  - DELETE /tournaments/:id
  - POST /tournaments/:id/players (add participant)
  - DELETE /tournaments/:id/players/:playerId (remove participant)
- [ ] Match mutations
  - POST /tournaments/:id/matches (schedule match)
  - PUT /matches/:id (update result)
  - DELETE /matches/:id

**Web:**
- [ ] Build club creation/edit UI
- [ ] Build player management UI (add, edit, deactivate)
- [ ] Build tournament creation UI
- [ ] Build match recording UI
- [ ] Build tournament participant management UI

### Phase 4: Python Deletion (Low Priority)
**Goal**: Remove all Python code and documentation after migration is complete.

- [ ] Delete Python CLI source code (`src/chess_club/`)
- [ ] Delete legacy Python documentation (`docs/legacy-python/`)
- [ ] Remove Python dependencies from `pyproject.toml`
- [ ] Remove Python test files (`tests/`)
- [ ] Update all documentation to remove Python references

## Legacy Documentation

During migration, Python-specific documentation is kept in `docs/legacy-python/`:
- `STYLEGUIDE.md` - Python code style guide
- `TESTS.md` - Python testing instructions

These documents should only be referenced when working on the migration plan or verifying Python behavior. Do not use them for new development.

## Quick Reference

**Start services:**
```bash
docker compose up -d
```

**Stop services:**
```bash
docker compose down
```

**Generate Drizzle migration:**
```bash
pnpm db:generate
```

**Import SQLite data:**
```bash
pnpm import:sqlite
```

**TypeScript checks:**
```bash
pnpm typecheck
pnpm test
```

**API:** http://localhost:4000
**Web:** http://localhost:5173
