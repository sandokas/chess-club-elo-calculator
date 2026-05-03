# Chess Club Web Architecture

This repository is moving from a Python CLI application to a TypeScript web product. The Python package remains in place during the migration as the behavioral reference for ratings and import validation.

## Monorepo Layout

- `apps/api` - Fastify API server.
- `apps/web` - React + Vite frontend shell.
- `packages/config` - shared environment validation.
- `packages/core` - pure chess domain logic: Elo, Glicko-2, rating recompute, and future Swiss pairing logic.
- `packages/db` - Drizzle schema, PostgreSQL client, migrations, and SQLite import scripts.

## Database Direction

PostgreSQL is the production database. Drizzle schema files are the TypeScript source of truth and Drizzle Kit SQL migrations are the versioned database change mechanism.

The first schema is multi-club from the start:

- `users`, `auth_identities`, `sessions`
- `clubs`, `club_memberships`, `club_invites`
- `players`, `player_ratings`
- `tournaments`, `tournament_players`, `rounds`, `matches`

Players are separate from users. A player can exist without a login, and an admin can later link a user to a player within a club. Ratings are scoped to club-owned player profiles.

## Access Rules

Unauthenticated users can only see safe club metadata. Real names, rosters, tournaments, matches, and leaderboards require authenticated club membership. Mutations are reserved for owner, admin, and organizer roles.

## Migration Strategy

`packages/db/scripts/import-sqlite.ts` imports the existing `chessclub.db` into PostgreSQL:

- creates one initial club from environment variables
- creates one initial owner/admin user
- imports players, tournaments, registrations, and matches
- maps legacy `player1_id` to `white_player_id`
- maps legacy `player2_id` to `black_player_id`
- preserves legacy IDs for traceability
- recomputes rating state using the TypeScript core package

Historical colors are inferred from the old player1/player2 columns because the CLI did not track real white/black colors.

## Runtime

Local development is containerized with Docker Compose:

- PostgreSQL
- API dev server
- Web dev server

Use `.env.example` as the starting point for local environment values.
