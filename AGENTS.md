# AGENTS.md — Rules for Anyone (Human or AI) Editing This Repo

## ⚠️ THE ONE RULE

# **NO DUPLICATED LOGIC. THERE MUST BE EXACTLY ONE SOURCE OF TRUTH.**

This is non-negotiable. If you find yourself about to copy a value, a helper, a default, or a piece of logic that lives somewhere else, **STOP** and refactor it into a single shared location instead.

---

## What this means in practice

### Configuration values

- All rating defaults (initial Elo, Glicko rating/RD/vol, K-factor thresholds, decimals, etc.) live in **`configs/business_config.json`** and are loaded by **`@chess-club/config`** via `loadRatingConfig()` / the `ratingConfig` singleton.
- API code, the SQLite import script, and any future tool **MUST** import `ratingConfig` from `@chess-club/config`. Do NOT hardcode `1000`, `1200`, `1500`, `350`, `0.06`, K-factor values, etc. anywhere else.
- DB column defaults are intentionally **not** used for these values — defaults belong in code/config so a JSON change actually takes effect.

### Helper functions

- If two files need the same helper, extract it to a shared package (`packages/config`, `packages/core`, `packages/db`). Never copy-paste.
- Re-export from a single canonical module rather than maintaining mirrors.

### Defaults

- Schema defaults, code defaults, and JSON config defaults must not silently diverge.
- When in doubt: code/config wins, schema follows.

### Constants and magic numbers

- Magic numbers in SQL strings or app code that exist elsewhere are a bug. Parameterize them and read from the single source.

---

## When debugging rating/ELO inconsistencies

**First suspect a duplicated / diverged constant or fallback, not the math.**

Concrete examples that have bitten us before:
- Hardcoded `elo=1200, glicko_rating=1500` in `INSERT` statements while `defaultRatingConfig.defaultElo = 1000`. New players started at 1200; recompute reset them to 1000; ratings diverged silently.
- Fallback `|| { elo: 1200, ... }` objects in the per-match update path that didn't match the config.

Audit for these by searching the repo for the literal numbers (`1200`, `1500`, `350`, `0.06`) any time you touch rating code.

---

## How to add a new rating-related config value

1. Add it to `configs/business_config.json`.
2. Add the field to `RatingConfig` and `defaultRatingConfig` in `packages/config/src/index.ts`.
3. Map the JSON key inside `loadRatingConfig()`.
4. Import `ratingConfig` from `@chess-club/config` wherever you need it.

Do not add the value anywhere else.

---

## Other project conventions

- **Package manager:** pnpm only. Never npm or yarn.
- **Dependency installation:** Prefer explicit dependency installation (`pnpm add`) over one-off execution tools like `pnpm dlx` or `npx`. Use `pnpm exec` for running binaries to ensure all executed code is versioned, reviewable, and reproducible via lockfiles.
- **Services:** run via `docker compose up -d`. Don't run `pnpm --filter web build` while compose is up (breaks volume-mounted `node_modules`).
- **DB access:** API uses direct PostgreSQL queries via a connection pool from `@chess-club/db`.
- **Backups:** Postgres dumps go in the gitignored `backups/` folder with timestamped filenames. See `OPERATIONS.md`.
- **API routing:** top-level resources use `/players/:id`; nested resources use descriptive names like `/clubs/:clubId/players`.

---

## Testing

**Tests are part of definition of done.** A feature is not "done" until tests prove it works. See **[TESTING.md](./TESTING.md)** for the full convention.

Quick summary:

- Real Postgres for every DB-touching test. No mocks of `pg`, `drizzle-orm`, or `@chess-club/db`.
- TRUNCATE between tests (global `beforeEach` in `apps/api/test/setup.ts`).
- Pure-logic tests (Elo, Swiss pairing, validators) live in `apps/api/test/lib/**` and have no DB.
- The only allowed third-party SDK mock is `google-auth-library` (network boundary).
- `expect(500) // Database error` as a substitute for real assertions is forbidden.
- Schema changes require a generated migration (`pnpm --filter @chess-club/db db:generate`), never `db:push` in test environments.

---

If you're about to edit this file because the rule is inconvenient: don't. Refactor the duplication instead.
