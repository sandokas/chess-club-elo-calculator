// Plain ESM JavaScript — runs under `node` directly, no TS transformer.
// Loads .env via the shared loader, then hands off to drizzle-kit migrate.
// drizzle.config.ts reads DATABASE_URL from process.env which we populate
// here.

import { spawnSync } from "node:child_process";
import { loadRepoEnv } from "@chess-club/config";

loadRepoEnv();

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Configure .env at the repo root."
  );
}

const result = spawnSync("drizzle-kit", ["migrate"], {
  stdio: "inherit",
  shell: true
});
process.exit(result.status ?? 1);
