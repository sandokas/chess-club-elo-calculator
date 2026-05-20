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

- Docker and Docker Compose
- A Google Cloud OAuth 2.0 Client ID (for authentication) — see [Auth setup](#auth-setup) below

### Running the Application

```bash
# Copy the example env file and fill in real values
cp .env.example .env
# Edit .env: set SESSION_COOKIE_SECRET, Google OAuth credentials, etc.

# Start all services (PostgreSQL, API, Web)
docker compose up -d

# View logs
docker compose logs -f

# Stop services
docker compose down
```

The application will be available at:
- **Web UI**: http://localhost:5173
- **API** (also reachable via Vite proxy at `http://localhost:5173/api/*`): http://localhost:4000

### Auth setup

1. Create an OAuth 2.0 Client ID in [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → "Web application"
2. Add `http://localhost:5173/api/auth/google/callback` as an **Authorized redirect URI**
3. Set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `OAUTH_REDIRECT_URL=http://localhost:5173/api/auth/google/callback` in `.env`
4. (Optional) Set `BOOTSTRAP_OWNER_EMAIL` to your Google account email — the first user with this email to log in is auto-promoted to owner of all existing clubs

### Development notes

- The web app proxies `/api/*` to the API container (see `apps/web/vite.config.ts`), so frontend and backend share the same origin in dev. This avoids CORS/cookie issues.
- Code changes to the web app hot-reload via Vite. **API changes currently require `docker compose restart api`** (no file watcher — see `TECH_DEBT.md`).

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

### Ratings

- `POST /clubs/:clubId/recompute-ratings` - Full recompute of all player ratings from scratch (excludes byes)

See `ARCHITECTURE.md` for full architecture details.

## Configuration

- Runtime configuration: `.env` (see `.env.example`)
- Import configuration: `.env.import` (see `.env.import.example`)
- Business configuration: `configs/business_config.json`
