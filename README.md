# Chess Club Manager

A web application for chess club management with player ratings (Elo and Glicko-2), tournaments, and match tracking.

## Tech Stack

- **Backend**: Node.js 25+, TypeScript, Fastify
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui
- **Database**: PostgreSQL with Drizzle ORM
- **Package Manager**: pnpm (workspace monorepo)
- **Runtime**: Docker Compose

## Quick Start

### Prerequisites

- Node.js 25+
- pnpm
- Docker and Docker Compose

### Installation

```bash
# Install dependencies
pnpm install
```

### Running the Application

```bash
# Start all services (PostgreSQL, API, Web)
docker compose up -d

# View logs
docker compose logs -f

# Stop services
docker compose down
```

The application will be available at:
- **API**: http://localhost:4000
- **Web**: http://localhost:5173

## Project Structure

```
chess-club/
├── apps/
│   ├── api/          # Fastify REST API
│   └── web/          # React web application
├── packages/
│   ├── config/       # Shared environment validation
│   ├── core/         # Rating logic (Elo, Glicko-2)
│   └── db/           # Database schema and migrations
├── src/chess_club/   # Legacy Python CLI (being migrated)
└── docs/
    └── legacy-python/ # Python documentation (reference only)
```

## Development Commands

```bash
# Type checking
pnpm typecheck

# Run tests
pnpm test

# Generate database migrations (after schema changes)
pnpm db:generate

# Apply database migrations (auto-runs on docker compose up)
pnpm db:migrate
```

## API Endpoints

- `GET /health` - Health check
- `GET /health/db` - Database health check
- `GET /clubs` - List clubs
- `GET /clubs/:clubId/players` - List players (with filtering, sorting, pagination)
- `GET /clubs/:clubId/tournaments` - List tournaments
- `GET /clubs/:clubId/leaderboard` - Club leaderboard
- `GET /tournaments/:id` - Tournament detail (matches, standings)
- `GET /players/:id` - Player detail (match history, rating history)

### Tournament Management

- `POST /clubs/:clubId/tournaments` - Create tournament
- `PUT /tournaments/:id` - Update tournament details
- `DELETE /tournaments/:id` - Delete tournament (draft only)

### Roster Management

- `GET /tournaments/:id/players` - Get tournament roster
- `POST /tournaments/:id/players` - Add existing player to tournament
- `POST /tournaments/:id/players/new` - Create new player and add to tournament
- `DELETE /tournaments/:id/players/:playerId` - Remove player from tournament
- `PUT /tournaments/:id/players/:playerId/dropout` - Mark player as dropped out

### Round Management

- `POST /tournaments/:id/rounds` - Generate next round pairings
- `GET /tournaments/:id/rounds` - Get tournament rounds
- `PUT /rounds/:id/starts-on` - Update round start time
- `PUT /rounds/:id/status` - Update round status
- `GET /rounds/:id/matches` - Get matches for a round

### Match Management

- `PUT /matches/:id/result` - Update match result

### Standings

- `GET /tournaments/:id/standings` - Get tournament standings with Swiss tiebreakers (Buchholz, Sonneborn-Berger)

See `ARCHITECTURE.md` for full architecture details.

## Migration Status

The project is migrating from a Python CLI to a TypeScript web application. See `MIGRATION.md` for current implementation status and remaining work.

## Configuration

- Runtime configuration: `.env` (see `.env.example`)
- Import configuration: `.env.import` (see `.env.import.example`)
- Business configuration: `configs/business_config.json`

## Legacy Python CLI

A Python CLI application remains in `src/chess_club/` during migration as a behavioral reference for rating calculations. See `docs/legacy-python/` for Python-specific documentation.
