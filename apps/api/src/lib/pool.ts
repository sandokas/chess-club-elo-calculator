import { createPool } from "@chess-club/db";

/**
 * Creates a database pool connection
 */
export function getPool() {
  return createPool();
}

/**
 * Pings the database to verify connectivity
 */
export async function pingDatabase(): Promise<void> {
  const pool = getPool();
  try {
    await pool.query("SELECT 1");
  } finally {
    await pool.end();
  }
}
