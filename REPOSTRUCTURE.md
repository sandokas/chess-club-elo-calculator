# Chess Club Repository Structure

This document maps the repository structure and key files for the Chess Club project.

## Root Level

```
chess-club/
├── apps/
│   ├── api/                 # Node/TypeScript REST API
│   └── web/                 # React web application
├── packages/
│   ├── config/              # Shared configuration
│   └── db/                  # Database schema and migrations
├── configs/                 # Business and operational configs
├── specs/                   # Spec Driven Development plans
├── docker-compose.yml       # Docker services orchestration
├── pnpm-workspace.yaml       # pnpm workspace configuration
├── ARCHITECTURE.md          # Architecture documentation
├── OPERATIONS.md            # Development operations rules
├── REPOSTRUCTURE.md         # Repository structure
└── TECH_DEBT.md             # Technical debt tracking
```

## Node/TypeScript API (`apps/api/`)

**Purpose**: REST API server for web application

**Key Files**:
- `src/app.ts` - Fastify application setup, plugin registration, and route module registration
- `src/server.ts` - Server entry point
- `package.json` - Dependencies and scripts

**Route Organization**: Route handlers are organized in `src/routes/` by domain:
- `routes/tournaments.ts` - Tournament CRUD operations
- `routes/tournament-players.ts` - Tournament player management
- `routes/tournament-rounds.ts` - Tournament rounds and match operations
- `routes/clubs.ts` - Club management
- `routes/leaderboard.ts` - Leaderboard endpoint
- `routes/players.ts` - Player endpoints
- `routes/invites.ts` - Club invitation endpoints
- `routes/auth.ts` - Authentication endpoints
- `routes/health.ts` - Health check endpoints

**Business Logic**: Service layer in `src/services/`:
- `services/tournaments.ts` - Tournament business logic
- `services/players.ts` - Player business logic
- `services/clubs.ts` - Club business logic
- `services/invites.ts` - Invitation business logic

**Validation**: Request validation in `src/lib/`:
- `lib/schemas/` - Zod validation schemas (tournament, club, player, etc.)
- `lib/validate.ts` - Request body/query validation utilities

**Plugins**: Fastify plugins in `src/plugins/`:
- `plugins/auth.ts` - Authentication/authorization plugin with current `REQUIRE_AUTH` compatibility
- `plugins/db.ts` - Database connection plugin

**API Endpoints**:
- `GET /health` - Health check
- `GET /health/db` - Database health check
- `GET /clubs` - List clubs (planned to become authenticated "my clubs" only; see `specs/spec-1-authenticated-club-access.md`)
- `POST /clubs` - Create club
- `PATCH /clubs/:clubId` - Update club
- `DELETE /clubs/:clubId` - Delete club
- `GET /clubs/:clubId/players` - List players in club
- `GET /clubs/:clubId/tournaments` - List tournaments in club
- `POST /clubs/:clubId/tournaments` - Create tournament
- `GET /clubs/:clubId/leaderboard` - Club leaderboard
- `POST /clubs/:clubId/ratings/recompute` - Recompute ratings
- `GET /tournaments/:id` - Tournament detail
- `PUT /tournaments/:id` - Update tournament
- `DELETE /tournaments/:id` - Delete tournament
- `GET /tournaments/:id/standings` - Tournament standings
- `GET /tournaments/:id/players` - Tournament roster
- `POST /tournaments/:id/players` - Add existing player
- `POST /tournaments/:id/players/new` - Create new player
- `DELETE /tournaments/:id/players/:playerId` - Remove player
- `PUT /tournaments/:id/players/:playerId/dropout` - Mark dropout
- `POST /tournaments/:id/rounds` - Generate round pairings
- `GET /tournaments/:id/rounds` - List rounds
- `DELETE /rounds/:id` - Delete round
- `PUT /rounds/:id/starts-on` - Update round start time
- `GET /rounds/:id/matches` - List matches
- `PUT /matches/:id/result` - Update match result
- `GET /players/:id` - Player detail
- `GET /auth/me` - Current user info
- `GET /auth/google/start` - Start Google OAuth flow
- `GET /auth/google/callback` - OAuth callback

**Database Access**: Drizzle ORM via the `db` Fastify decorator (app.db). The db plugin in `src/plugins/db.ts` manages a single pg.Pool per process. Raw SQL is permitted only via `app.db.execute(sql`…`)` with parameterized placeholders.

**Dependencies**:
- Fastify - Web framework
- @fastify/cors - CORS support
- @chess-club/db - Database client
- pg - PostgreSQL client
- zod - Schema validation

## React Web App (`apps/web/`)

**Purpose**: User interface for chess club management

**Key Files**:
- `src/App.tsx` - Main application with routing setup
- `src/main.tsx` - React entry point
- `src/styles.css` - Global styles
- `package.json` - Dependencies and scripts

**Page Organization**: Page components are organized in `src/pages/` by feature:
- `pages/admin-overview.tsx` - Admin overview (leaderboard, tournaments)
- `pages/tournaments-list.tsx` - Tournaments list page
- `pages/tournament-detail.tsx` - Tournament detail (standings, matches)
- `pages/player-detail.tsx` - Player detail (info, ratings, match history)
- `pages/players-list.tsx` - Players list page
- `pages/login.tsx` - Login page
- `pages/club-search.tsx` - Current club search/join page, planned for redesign under Spec 1

**Component Organization**: Components are organized in `src/components/`:
- `components/ui/` - shadcn/ui base components
- `components/layout/` - Layout components
- `components/shared/` - Shared components
- `components/dashboard/` - Dashboard-specific components
- `components/tournament/` - Tournament-specific components
- `components/player/` - Player-specific components
- `components/club/` - Club-specific components

**Hooks**: Custom hooks in `src/lib/hooks/`:
- `hooks/use-clubs.ts` - Club data fetching
- `hooks/use-players.ts` - Player data fetching
- `hooks/use-tournaments.ts` - Tournament data fetching
- `hooks/use-invites.ts` - Invitation data fetching

**Routing**: Routes in `src/App.tsx`:
- `/` - Admin overview
- `/tournaments` - Tournaments list
- `/tournaments/:id` - Tournament detail
- `/players` - Players list
- `/players/:id` - Player detail

**Dependencies**:
- React - UI framework
- React Router - Routing
- Vite - Build tool
- Tailwind CSS - Styling
- shadcn/ui - Component library

## Packages

### `@chess-club/config`
**Purpose**: Shared configuration across packages (env validation, rating config single source of truth)

### `@chess-club/db`
**Purpose**: Database schema, migrations, and client

**Key Files**:
- `src/schema.ts` - Drizzle ORM schema
- `src/client.ts` - Database client
- `drizzle/` - SQL migration files
- `drizzle.config.ts` - Drizzle configuration

**Tables**:
- `users` - User accounts
- `auth_identities` - Authentication providers
- `sessions` - User sessions
- `clubs` - Chess clubs
- `club_memberships` - Club membership roles
- `club_invites` - Club invitations
- `players` - Chess players
- `player_ratings` - Player ratings (Elo, Glicko-2)
- `tournaments` - Tournaments
- `tournament_players` - Tournament participants
- `rounds` - Tournament rounds
- `matches` - Match results with rating history

## Configuration

**Business Config** (`configs/business_config.json`):
- Rating system selection
- Elo K-factor thresholds and values
- Rating defaults

**Operational Config** (`configs/operational_config.json`):
- Reserved operational settings

## Docker Services

**Postgres**: PostgreSQL 18-alpine
- Port: 5432
- Database: chess_club
- User: chess_club

**API**: Node 25-alpine
- Port: 4000
- Command: Migrate DB + start dev server
- Depends on: postgres

**Web**: Node 25-alpine
- Port: 5173
- Command: Start dev server with Vite
- Depends on: api

## Development Workflow

1. Start services: `docker compose up -d`
2. API: http://localhost:4000
3. Web: http://localhost:5173
4. Stop: `docker compose down`
