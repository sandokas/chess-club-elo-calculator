import { createPool, createDb, type Db } from "@chess-club/db";
import type pg from "pg";
import { createApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";

export type TestApp = {
  app: FastifyInstance;
  pool: pg.Pool;
  db: Db;
};

/**
 * Build a Fastify app wired to a fresh pool against the test Postgres database.
 * Use one instance per test file: create in `beforeAll`, close in `afterAll`.
 * Between tests, isolation is handled by the global `beforeEach(truncateAll)`
 * in `test/setup.ts`.
 */
export async function createTestApp(): Promise<TestApp> {
  const pool = createPool();
  const db = createDb(pool);
  const app = await createApp({ pool, db });
  return { app, pool, db };
}

/**
 * Close the Fastify app and ensure the pool is drained. Idempotent — safe to
 * call multiple times. Fastify's `onClose` hook in `plugins/db.ts` ends the
 * pool once.
 */
export async function closeTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
}
