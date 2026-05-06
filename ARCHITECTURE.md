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
