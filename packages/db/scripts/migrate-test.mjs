// Plain ESM JavaScript — runs under `node` directly, no TS transformer.
// Bootstraps the test database (creates it if missing) and runs migrations.
// AGENTS.md: env loading goes through @chess-club/config, no duplication.

import { spawnSync } from "node:child_process";
import pg from "pg";
import { loadRepoEnv } from "@chess-club/config";

// Layered env loading: test-specific values first (win), .env as fallback.
loadRepoEnv(".env.test.local");
loadRepoEnv(".env");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Create .env.test.local at the repo root (see .env.test.example)."
  );
}

const url = new URL(databaseUrl);
const dbName = url.pathname.replace(/^\//, "");
if (!dbName) {
  throw new Error(`DATABASE_URL has no database name: ${databaseUrl}`);
}

// Connect to the cluster's admin DB to create the target DB if missing.
const adminUrl = new URL(url.toString());
adminUrl.pathname = "/postgres";

const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
try {
  const exists = await admin.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [dbName]
  );
  if (exists.rowCount === 0) {
    // Identifier needs to be quoted but cannot be parameterized.
    await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    console.log(`Created database: ${dbName}`);
  } else {
    console.log(`Database already exists: ${dbName}`);
  }
} finally {
  await admin.end();
}

// Hand off to drizzle-kit. It reads DATABASE_URL from process.env, which the
// loadRepoEnv calls above already pointed at the test DB.
const result = spawnSync("drizzle-kit", ["migrate"], {
  stdio: "inherit",
  shell: true
});
process.exit(result.status ?? 1);
