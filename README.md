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

### Health
- `GET /health` - Health check
- `GET /health/db` - Database health check

### Club Management
- `GET /clubs` - List clubs
- `POST /clubs` - Create club
- `PATCH /clubs/:clubId` - Update club details
- `DELETE /clubs/:clubId` - Delete club

### Player Management
- `GET /clubs/:clubId/players` - List players (with filtering, sorting, pagination)
- `POST /clubs/:clubId/players` - Create new player in club
- `DELETE /clubs/:clubId/players/:playerId` - Delete player from club (only if no match history)
- `GET /players/:id` - Player detail (match history, rating history)
- `PUT /players/:id` - Update player details

### Tournament Management

- `GET /clubs/:clubId/tournaments` - List tournaments (with filtering, sorting, pagination)
- `POST /clubs/:clubId/tournaments` - Create tournament
- `PUT /tournaments/:id` - Update tournament details
- `DELETE /tournaments/:id` - Delete tournament (draft only)
- `GET /tournaments/:id` - Tournament detail (matches, standings)

### Roster Management

- `GET /tournaments/:id/players` - Get tournament roster
- `POST /tournaments/:id/players` - Add existing player to tournament
- `POST /tournaments/:id/players/new` - Create new player and add to tournament
- `DELETE /tournaments/:id/players/:playerId` - Remove player from tournament
- `PUT /tournaments/:id/players/:playerId/dropout` - Mark player as dropped out

### Round Management

- `POST /tournaments/:id/rounds` - Generate next round pairings (FIDE Dutch Swiss)
- `GET /tournaments/:id/rounds` - Get tournament rounds
- `PUT /rounds/:id/starts-on` - Update round start time
- `DELETE /rounds/:id` - Delete a round (only if no real-game results have been entered; bye matches are ignored)
- `GET /rounds/:id/matches` - Get matches for a round

### Match Management

- `PUT /matches/:id/result` - Update or undo a match result. Bye matches (virtual, `black_player_id = NULL`) are auto-completed with `result = 1` at round generation and never affect ELO/Glicko or `games_played`.

### Standings

- `GET /tournaments/:id` - Tournament detail including standings (points + Buchholz + Sonneborn-Berger)
- `GET /tournaments/:id/standings` - Standings with full Swiss tiebreakers (sorted: points → Buchholz → Sonneborn-Berger → wins)

### Leaderboard

- `GET /clubs/:clubId/leaderboard` - Club leaderboard (with optional active filter)

### Ratings

- `POST /clubs/:clubId/ratings/recompute` - Full recompute of all player ratings from scratch (excludes byes)

See `ARCHITECTURE.md` for full architecture details.

## Configuration

- Runtime configuration: `.env` (see `.env.example`)
- Import configuration: `.env.import` (see `.env.import.example`)
- Business configuration: `configs/business_config.json`
