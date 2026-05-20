import { loadRepoEnv } from "@chess-club/config";

// Layered env loading for tests:
//   1. `.env.test.local` (gitignored) — test-specific values: separate test
//      DB, host-reachable hostname, etc. Wins for any key it defines.
//   2. `.env` — shared dev defaults. Fills in keys not set by .env.test.local.
//
// First-loaded wins under standard dotenv semantics, so this gives tests
// their own canonical config without resorting to env-var overrides.
loadRepoEnv(".env.test.local");
loadRepoEnv(".env");
