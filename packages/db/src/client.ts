import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { loadEnv } from "@chess-club/config";
import * as schema from "./schema.js";

export function createPool(databaseUrl = loadEnv().DATABASE_URL): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl });
}

export function createDb(pool = createPool()) {
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;
