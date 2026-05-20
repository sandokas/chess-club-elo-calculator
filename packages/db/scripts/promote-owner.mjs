// Plain ESM JavaScript — runs under `node` directly, no TS transformer.
// Admin script: promotes a user to owner of a club. Loads env via the shared
// loader, opens its own pool, exits when done.
//
// Usage: pnpm --filter @chess-club/db db:promote-owner <clubId> <userEmail>

import pg from "pg";
import { loadRepoEnv } from "@chess-club/config";

loadRepoEnv();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Configure .env at the repo root.");
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error("Usage: pnpm --filter @chess-club/db db:promote-owner <clubId> <userEmail>");
  console.error("Example: pnpm --filter @chess-club/db db:promote-owner 123e4567-e89b-12d3-a456-426614174000 user@example.com");
  process.exit(1);
}

const [clubId, userEmail] = args;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  console.log(`Promoting user ${userEmail} to owner of club ${clubId}...`);

  const userResult = await pool.query(
    `SELECT id FROM users WHERE email = $1`,
    [userEmail]
  );
  if (userResult.rows.length === 0) {
    console.error(`User with email ${userEmail} not found`);
    process.exit(1);
  }
  const userId = userResult.rows[0].id;

  const clubResult = await pool.query(
    `SELECT id FROM clubs WHERE id = $1`,
    [clubId]
  );
  if (clubResult.rows.length === 0) {
    console.error(`Club with ID ${clubId} not found`);
    process.exit(1);
  }

  const membershipResult = await pool.query(
    `SELECT role FROM club_memberships WHERE club_id = $1 AND user_id = $2`,
    [clubId, userId]
  );

  if (membershipResult.rows.length > 0) {
    const currentRole = membershipResult.rows[0].role;
    if (currentRole === "owner") {
      console.log(`User ${userEmail} is already owner of club ${clubId}`);
    } else {
      await pool.query(
        `UPDATE club_memberships SET role = 'owner' WHERE club_id = $1 AND user_id = $2`,
        [clubId, userId]
      );
      console.log(`Updated ${userEmail} from ${currentRole} to owner of club ${clubId}`);
    }
  } else {
    await pool.query(
      `INSERT INTO club_memberships (club_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [clubId, userId]
    );
    console.log(`Created owner membership for ${userEmail} in club ${clubId}`);
  }

  console.log("Done!");
} catch (error) {
  console.error("Error promoting owner:", error);
  process.exit(1);
} finally {
  await pool.end();
}
