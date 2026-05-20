// Plain ESM JavaScript — runs under `node` directly, no TS transformer.
// Loads .env via the shared loader, then hands off to drizzle-kit generate.
// drizzle.config.ts reads DATABASE_URL from process.env which we populate
// here. drizzle-kit generate does NOT connect to the DB — the credentials
// satisfy the config's runtime guard but no network round-trip happens.
// The diff is computed by comparing `schema.ts` against `drizzle/meta/_journal.json`.

import { spawnSync } from "node:child_process";
import { loadRepoEnv } from "@chess-club/config";

loadRepoEnv();

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Configure .env at the repo root."
  );
}

// Forward any extra CLI args (e.g. --name=add_club_join_requests).
const extraArgs = process.argv.slice(2);

const result = spawnSync("drizzle-kit", ["generate", ...extraArgs], {
  stdio: "inherit",
  shell: true
});
process.exit(result.status ?? 1);
