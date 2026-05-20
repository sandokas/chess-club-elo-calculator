import { loadRepoEnv } from "@chess-club/config";
import { beforeEach, afterAll } from "vitest";
import { createPool } from "@chess-club/db";
import { truncateAll } from "./helpers/db.js";

// Layered env loading for tests:
//   1. `.env.test.local` (gitignored) — test-specific values: separate test
//      DB, host-reachable hostname, etc. Wins for any key it defines.
//   2. `.env` — shared dev defaults. Fills in keys not set by .env.test.local.
//
// First-loaded wins under standard dotenv semantics, so this gives tests
// their own canonical config without resorting to env-var overrides.
loadRepoEnv(".env.test.local");
loadRepoEnv(".env");

// ---------------------------------------------------------------------------
// Test isolation: TRUNCATE every app table before each test.
//
// We use a dedicated, file-scoped admin pool for truncation so that wiping
// data doesn't depend on any particular test's app instance. The pool is
// closed once when the test process exits.
//
// See TESTING.md for why TRUNCATE was chosen over transactional rollback or
// per-test fresh DBs.
// ---------------------------------------------------------------------------
const adminPool = createPool();

beforeEach(async () => {
  await truncateAll(adminPool);
});

afterAll(async () => {
  await adminPool.end();
});
