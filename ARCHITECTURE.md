# Chess Club Web Architecture

This repository contains a TypeScript web application for chess club management. The application provides a REST API and React web interface for managing players, tournaments, and ratings (Elo and Glicko-2). A legacy Python CLI application remains in place during migration as a behavioral reference.

## Monorepo Layout

- `apps/api` - Fastify API server. Contains rating calculation logic (Elo, Glicko-2) in `src/lib/ratings/`.
- `apps/web` - React + Vite frontend shell.
- `packages/config` - shared environment validation.
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

## Rating Calculation

Rating calculation logic is centralized in `apps/api/src/lib/ratings/` with Elo and Glicko-2 implementations. `applyRatedMatch` is the single source of truth for per-match updates; `recomputeRatings` performs a full rebuild from scratch.

**Rating Updates**
- When setting a match result: calculates new ratings using `applyRatedMatch` and stores "before" and "after" values in the match audit fields. Increments `games_played` and updates `last_game_date` for both players.
- When undoing a match result (setting to null): reverts player ratings to stored "before" values from that match, decrements `games_played`, and restores `last_game_date` to the next-most-recent real match. No recomputation of subsequent matches.
- Only the player's LAST game can be updated - prevents updating earlier games without rewinding game by game.
- Only one tournament can be ongoing at a time for a club (status `draft` or `active`).
- Nuclear option: full club recompute via `POST /clubs/:clubId/recompute-ratings` if the rating algorithm changes.

**Bye Matches (excluded from rating math)**
Virtual matches for byes are stored with `black_player_id = NULL` and `result = 1`. They count for tournament standings (1 point) but are invisible to rating math:
- `applyRatedMatch` short-circuits when `black === null` - no ELO/Glicko change, no `games_played` increment, no `last_game_date` update.
- `recomputeRatings` and all rating queries filter `black_player_id IS NOT NULL`.
- Consequence: a player returning after a long absence and getting a bye still has their full RD inflation applied on their next real game.

**Match completion**
Match completion is derived from `result IS NOT NULL`. There is no separate `status` column on matches (removed in migration `0004`).

**Rating Audit Fields**
Matches store rating audit data for reversion:
- `white_elo_before`, `white_elo_after`, `black_elo_before`, `black_elo_after`
- `white_glicko_rating_before`, `white_glicko_rating_after`, etc.
- Bye matches leave all audit fields `NULL`.
- Cleared when match result is undone.

## Swiss Pairings

The Swiss pairing engine in `apps/api/src/lib/swiss-pairing.ts` implements the FIDE Dutch System:

- **Round 1**: players ordered by ELO (or randomly per tournament setting); split into S1/S2 halves; S1[i] paired with S2[i]; colors alternate by board to balance starts.
- **Subsequent rounds**: master ranking by `points → Buchholz → Sonneborn-Berger → ELO`. Players grouped by points; each score group is split S1 vs S2 and paired top-to-bottom.
- **Backtracking**: transposition (permute S2) then exchange (swap S1↔S2 boundary) when a candidate pair has already played or would violate color rules.
- **Downfloaters**: odd score groups float their lowest-ranked player down to the next group.
- **Color allocation**: per-round color history is reconstructed from real games only (byes excluded). Preferences: absolute (no 3 in a row, max |diff| 2) → strong (|diff| = 1) → mild (alternate from last) → board-alternation.
- **Byes**: round 1 = lowest seed; later rounds = lowest score-group tiebreaks among players without a prior bye.

## Standings & Tiebreakers

Standings are computed on-read (not stored) via `GET /tournaments/:id` and `GET /tournaments/:id/standings`. Sort order:

1. **Points** (1 / 0.5 / 0 per game; bye = 1)
2. **Buchholz** - sum of opponents' points
3. **Sonneborn-Berger** - sum of opponents' points weighted by your result (full for win, half for draw)
4. **Wins** (then ELO as final fallback)

Buchholz/SB exclude bye opponents (no opponent points to sum).

## Data Import

`packages/db/scripts/import-sqlite.ts` imports existing SQLite databases into PostgreSQL:

- Creates one initial club from environment variables
- Creates one initial owner/admin user
- Imports players, tournaments, registrations, and matches
- Maps legacy `player1_id` to `white_player_id`
- Maps legacy `player2_id` to `black_player_id`
- Preserves legacy IDs for traceability
- Recomputes rating state using the rating logic in apps/api/src/lib/ratings/

Historical colors are inferred from the old player1/player2 columns because the legacy system did not track real white/black colors.

## Runtime

Local development is containerized with Docker Compose:

- PostgreSQL
- API dev server
- Web dev server

Use `.env.example` as the starting point for local environment values.

## Web Frontend Architecture

### Tech Stack

- **React 19** - UI library
- **TypeScript** - Type safety with ESNext + bundler module resolution (no deprecations)
- **Vite** - Build tool and dev server
- **Tailwind CSS v4** - Utility-first CSS with `@tailwindcss/postcss` (modern, no deprecated features)
- **shadcn/ui** - Component library built on Radix UI primitives
- **Lucide React** - Icon library
- **React Router v7** - Client-side routing
- **@dnd-kit** - Drag-and-drop functionality

### Design System

**Color System**
- CSS variables for semantic colors (background, foreground, primary, secondary, etc.)
- Dark mode support via `dark` class on root element
- 4 configurable color palettes: emerald, blue, violet, rose
- Theme and palette persistence in localStorage

**Component Structure**
```
apps/web/src/
├── components/
│   ├── ui/              # shadcn/ui base components (Button, Card, Table, etc.)
│   ├── layout/          # Layout components (Header, ThemeProvider, etc.)
│   ├── shared/          # Shared components (StatCard, BackButton, EmptyState, etc.)
│   ├── dashboard/       # Page-specific components
│   ├── tournament/      # Tournament-specific components
│   └── player/          # Player-specific components
├── lib/
│   ├── utils.ts         # Utility functions (cn for className merging)
│   └── theme.ts         # Theme utilities (color palettes, localStorage helpers)
├── hooks/
│   └── use-polling.ts   # Custom hooks (real-time polling)
└── App.tsx              # Main app with routing
```

### Coding Conventions

**TypeScript Configuration**
- Use ESNext module with bundler module resolution (avoids deprecation warnings)
- No `baseUrl` - paths configured directly
- Strict mode enabled
- Path alias `@/*` maps to `./src/*`

**Component Conventions**
- Use shadcn/ui components as building blocks
- Prefer composition over creating new components from scratch
- Use the `cn` utility from `@/lib/utils.ts` for className merging
- All components use `.tsx` extension with explicit imports (ESM)
- Relative imports use `.js` extensions (TypeScript requirement for NodeNext/bundler)

**Styling Conventions**
- Use Tailwind utility classes
- Responsive design: mobile-first with `sm:`, `md:`, `lg:` breakpoints
- Use semantic color tokens (e.g., `bg-background`, `text-primary`) not hardcoded colors
- Use semantic spacing tokens (e.g., `p-4`, `gap-4`) not arbitrary values

**Accessibility Conventions**
- Include skip link at top of app
- Use `aria-label` for icon-only buttons
- Use `aria-hidden="true"` for decorative icons
- Use semantic HTML elements
- Maintain focus management for interactive components
- Use proper heading hierarchy

**State Management**
- Use React hooks (useState, useEffect) for local state
- Use custom hooks for reusable logic (e.g., usePolling)
- Theme state managed via ThemeProvider context
- No global state library currently (add if needed)

### When to Use What

**shadcn/ui Components**
- Button - all button interactions
- Card - content containers with headers
- Badge - status indicators and labels
- Table - tabular data display
- Skeleton - loading placeholders
- DropdownMenu - action menus

**Custom Components**
- StatCard - display single metric with label
- StatusCard - loading/error states with icon
- BackButton - navigation back button
- EmptyState - empty content with CTAs
- DraggableTable - sortable table rows

**Hooks**
- usePolling - periodic data fetching with visibility awareness
- Create new hooks for reusable stateful logic

### Build Configuration

**Tailwind CSS v4**
- Uses `@import "tailwindcss"` directive (v4 syntax)
- PostCSS plugin: `@tailwindcss/postcss` (not `tailwindcss`)
- CSS variables for theming in `src/styles.css`

**Vite**
- Path alias `@` configured in `vite.config.ts`
- Dev server port: `WEB_PORT` env var or 5173

**TypeScript**
- Extends `tsconfig.base.json`
- Additional options: jsx, allowImportingTsExtensions, noEmit, paths

### Real-time Updates

Use the `usePolling` hook for periodic data fetching:
- Configurable interval (default 30s)
- Pauses when tab is hidden (visibility API)
- Resumes when tab becomes visible
- Provides `data`, `isLoading`, `error`, `refetch`

### Future Considerations

- Add state management (Zustand, Jotai, or React Query) if needed
- Add form library (react-hook-form) for complex forms
- Add toast notifications for user feedback
- Consider WebSockets for true real-time updates if polling is insufficient
