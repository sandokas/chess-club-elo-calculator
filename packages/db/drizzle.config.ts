import { defineConfig } from "drizzle-kit";

// drizzle-kit loads this config with its own resolver which cannot import
// the @chess-club/config TS package. Env loading is handled by the wrapper
// scripts (scripts/migrate.mjs, scripts/migrate-test.mjs) which populate
// process.env before invoking drizzle-kit.
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Run migrations via `pnpm --filter @chess-club/db db:migrate` (or db:migrate:test) instead of invoking drizzle-kit directly."
  );
}

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL
  },
  verbose: true,
  strict: true
});
