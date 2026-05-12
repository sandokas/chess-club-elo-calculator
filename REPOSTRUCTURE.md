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
│   ├── core/                # Core business logic
│   └── db/                  # Database schema and migrations
├── configs/                 # Business and operational configs
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
- `src/app.ts` - Fastify application with API endpoints
- `src/server.ts` - Server entry point
- `package.json` - Dependencies and scripts

**API Endpoints**:
- `GET /health` - Health check
- `GET /health/db` - Database health check
- `GET /clubs` - List clubs
- `GET /clubs/:clubId/players` - List players in club
- `GET /clubs/:clubId/tournaments` - List tournaments in club
- `GET /clubs/:clubId/leaderboard` - Club leaderboard
- `GET /tournaments/:id` - Tournament detail (matches, standings)
- `GET /players/:id` - Player detail (info, recent matches, rating history)

**Database Access**: Direct PostgreSQL queries via connection pooling

**Dependencies**:
- Fastify - Web framework
- @fastify/cors - CORS support
- @chess-club/db - Database client
- pg - PostgreSQL client

## React Web App (`apps/web/`)

**Purpose**: User interface for chess club management

**Key Files**:
- `src/App.tsx` - Main application with routes and pages
- `src/main.tsx` - React entry point
- `src/styles.css` - Global styles
- `package.json` - Dependencies and scripts

**Pages**:
- `/` - Admin overview (leaderboard, tournaments)
- `/tournaments/:id` - Tournament detail (standings, matches)
- `/players/:id` - Player detail (info, ratings, match history)

**Dependencies**:
- React - UI framework
- React Router - Routing
- Vite - Build tool

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
- Database path
- Runtime settings

## Docker Services

**Postgres**: PostgreSQL 16-alpine
- Port: 5432
- Database: chess_club
- User: chess_club

**API**: Node 22-alpine
- Port: 4000
- Command: Migrate DB + start dev server
- Depends on: postgres

**Web**: Node 22-alpine
- Port: 5173
- Command: Start dev server with Vite
- Depends on: api

## Development Workflow

1. Start services: `docker compose up -d`
2. API: http://localhost:4000
3. Web: http://localhost:5173
4. Stop: `docker compose down`
