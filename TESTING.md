# Testing conventions

**Tests are part of definition of done.** A feature isn't merged until tests prove it works.

This repo has one consistent test convention. There is no separate "integration" suite — everything runs against a real Postgres database, isolated between tests with `TRUNCATE`. Pure-logic helpers (no I/O) are the only thing tested without a database.

---

## Tiers

| Where | What | Database |
|---|---|---|
| `apps/api/test/lib/**` (pure-logic subfolders only, e.g. `swiss-pairing.test.ts`, `validators.test.ts`, `errors.test.ts`) | Pure functions: Elo math, Glicko, Swiss pairing, validators, error formatters. No I/O. | None |
| `apps/api/test/lib/auth/**`, `apps/api/test/routes/**`, `apps/api/test/*.test.ts` | Everything that touches DB, HTTP, cookies, sessions, RBAC, routes. Route handlers are organized in `src/routes/` by domain. | Real `chess_club_test` Postgres |

If your code reads or writes the database, **your test runs against real Postgres**. No mocks.

---

## Running tests

```bash
docker compose up -d postgres          # one-time per workstation
pnpm --filter @chess-club/api test     # auto-bootstraps chess_club_test via the `pretest` hook
```

`pnpm test` from a clean clone is expected to work. If it doesn't, that's a bug.

Run a single file:

```bash
pnpm --filter @chess-club/api exec vitest run test/routes/auth.test.ts
```

---

## Isolation: TRUNCATE between tests

The global `beforeEach` in `apps/api/test/setup.ts` calls `truncateAll(adminPool)` which executes a single `TRUNCATE TABLE … RESTART IDENTITY CASCADE` over every table exported from `@chess-club/db`'s schema. Cost: ~30 ms per test.

### Why TRUNCATE and not transactional rollback?

Transactional rollback (wrap each test in `BEGIN ... ROLLBACK`) is faster (~1 ms per test) and is the long-term target. Two reasons we're not there yet:

1. **Request-scoped transactions are not wired yet.** Routes use `app.db`, but the app does not yet provide a per-request transaction context that every Drizzle query automatically joins. TRUNCATE keeps isolation independent of request lifecycle plumbing.
2. **Simplicity.** TRUNCATE is one line and has no edge cases around nested transactions, savepoints, deferred constraints, or connection pinning.

If test runtime becomes a bottleneck, migrate to transactional rollback by adding a request-scoped transaction context. See `TECH_DEBT.md`.

### Why not Testcontainers?

Spinning a fresh Postgres per test (or per file) is bulletproof but adds 2–5 s of cold-start per run and a Docker dependency for every contributor. We already have a long-running Postgres in `docker compose`. Reserve Testcontainers for CI if/when we hit isolation issues TRUNCATE can't solve.

---

## Helpers

All in `apps/api/test/helpers/`:

- **`app.ts`** — `createTestApp()` returns `{ app, pool, db }`. Use in `beforeAll`, close in `afterAll`. One Fastify app per test file. Each `createTestApp` instantiates its own pool, so `app.close()` ends only that pool (the file-level seeding pool stays alive).
- **`db.ts`** — `truncateAll(pool)`. Wipes all tables exported from `@chess-club/db` schema. Used by the global `beforeEach`.
- **`seed.ts`** — small typed builders: `seedUser`, `seedClub`, `seedMembership`, `seedSession`, `seedPlayer`, `seedTournament`, `seedAuthenticatedOwner`. No factory magic; defaults satisfy NOT NULLs; overrides spread last.

Pattern:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp, type TestApp } from "./helpers/app.js";
import { seedAuthenticatedOwner } from "./helpers/seed.js";

describe("...", () => {
  let testApp: TestApp;
  beforeAll(async () => { testApp = await createTestApp(); });
  afterAll(async () => { await testApp.app.close(); });

  it("does the thing", async () => {
    const { session } = await seedAuthenticatedOwner(testApp.db);
    const res = await testApp.app.inject({
      method: "POST",
      url: "/some/route",
      cookies: { sid: session.token },
      payload: { /* ... */ }
    });
    expect(res.statusCode).toBe(201);
    // Then assert against testApp.db to verify persistence.
  });
});
```

---

## Forbidden patterns

The CI grep check enforces these. Don't introduce them.

### ❌ Mocking `pg`, `drizzle-orm`, or `@chess-club/db`

```ts
vi.mock("pg");                         // ❌
vi.mock("drizzle-orm");                // ❌
vi.mock("@chess-club/db");             // ❌
```

Mocks of database drivers/ORMs give false confidence — they don't catch SQL errors, schema drift, constraint violations, enum mismatches, or transaction edge cases. If the code touches the DB, the test exercises real Postgres. Period.

### ❌ Asserting `expect(500) // Database error` to dodge real assertions

```ts
expect(response.statusCode).toBe(500); // Database error  ❌
```

This is not a test. It asserts that the database isn't reachable, not that the code is correct. Replace with real CRUD: seed input data, hit the route, assert the actual outcome (status code, response body, and the persisted state via `db.select(...)`).

### ❌ Hardcoded UUIDs that "happen to not exist"

OK only for explicit 404 / not-found tests where the point is "no row with this id". Use `00000000-0000-0000-0000-000000000000` so intent is obvious.

---

## Allowed mocks

There is **exactly one allowed mock category**: third-party SDKs whose underlying behavior involves network calls we don't own.

Currently only `google-auth-library` (OAuth2 token exchange + ID-token verification), mocked at the `OAuth2Client` class boundary in `apps/api/test/routes/auth.test.ts`. Pattern:

```ts
const { mockGetToken, mockVerifyIdToken, mockGenerateAuthUrl } = vi.hoisted(() => ({
  mockGetToken: vi.fn(),
  mockVerifyIdToken: vi.fn(),
  mockGenerateAuthUrl: vi.fn()
}));

vi.mock("google-auth-library", () => {
  class MockOAuth2Client {
    getToken = mockGetToken;
    verifyIdToken = mockVerifyIdToken;
    generateAuthUrl = mockGenerateAuthUrl;
  }
  return { OAuth2Client: MockOAuth2Client };
});
```

`vi.hoisted` is required because `vi.mock` is itself hoisted above all `import` statements; the mock factory needs its closed-over refs to exist by the time the mocked module is first imported.

Everything below the third-party boundary (DB writes, cookies, session creation, redirect URLs) is exercised for real.

---

## Vitest config

`apps/api/vitest.config.ts` sets `fileParallelism: false`. Tests share one Postgres DB; running two files in parallel would have one file's TRUNCATE wipe the other's seeded rows. Sequential file execution keeps total runtime under ~15 s on a developer laptop and eliminates the failure mode.

---

## When tests need a new table

1. Edit `packages/db/src/schema.ts`.
2. Run `pnpm --filter @chess-club/db db:generate -- --name=descriptive_name`.
3. Review the generated SQL in `packages/db/drizzle/00NN_*.sql`. Drizzle sometimes emits unrelated drift fixes (e.g. for migrations that used `IF EXISTS`) — trim if needed.
4. Commit both the schema change and the migration.
5. `pnpm test` automatically applies pending migrations via the `pretest` hook.

Never use `db:push` for the test DB — that bypasses the migration history and lets drift accumulate.
