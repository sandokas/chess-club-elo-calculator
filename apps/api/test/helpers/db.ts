import type pg from "pg";
import { schema } from "@chess-club/db";
import { getTableName } from "drizzle-orm";

/**
 * Tables declared in the `@chess-club/db` schema export. Adding a new table to
 * the schema automatically participates in test isolation, provided it's
 * exported from `schema`.
 *
 * The `pretest` hook runs `db:migrate:test` before every test run so the test
 * DB always matches schema.ts. If you see "relation does not exist" here,
 * generate + commit a migration (`pnpm --filter @chess-club/db db:generate`).
 */
function schemaTableNames(): string[] {
  return Object.values(schema).map((table) => `"${getTableName(table as any)}"`);
}

/**
 * Wipe every app table. Called from a global `beforeEach` so each test starts
 * with an empty database. ~30 ms on a developer laptop.
 *
 * We use `TRUNCATE ... RESTART IDENTITY CASCADE` so FK ordering and any
 * sequences are handled in one round-trip.
 */
export async function truncateAll(pool: pg.Pool): Promise<void> {
  const tables = schemaTableNames().join(", ");
  await pool.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}
