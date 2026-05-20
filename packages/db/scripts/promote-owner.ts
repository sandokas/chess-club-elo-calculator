import { createPool } from "../src/index.js";
import { loadEnv } from "@chess-club/config";

const env = loadEnv();

async function promoteOwner(clubId: string, userEmail: string) {
  const pool = createPool();

  try {
    console.log(`Promoting user ${userEmail} to owner of club ${clubId}...`);

    // Get user by email
    const userResult = await pool.query(
      `SELECT id FROM users WHERE email = $1`,
      [userEmail]
    );

    if (userResult.rows.length === 0) {
      console.error(`User with email ${userEmail} not found`);
      process.exit(1);
    }

    const userId = userResult.rows[0].id;

    // Check if club exists
    const clubResult = await pool.query(
      `SELECT id FROM clubs WHERE id = $1`,
      [clubId]
    );

    if (clubResult.rows.length === 0) {
      console.error(`Club with ID ${clubId} not found`);
      process.exit(1);
    }

    // Check if user is already a member
    const membershipResult = await pool.query(
      `SELECT role FROM club_memberships WHERE club_id = $1 AND user_id = $2`,
      [clubId, userId]
    );

    if (membershipResult.rows.length > 0) {
      const currentRole = membershipResult.rows[0].role;
      if (currentRole === "owner") {
        console.log(`User ${userEmail} is already owner of club ${clubId}`);
        return;
      }

      // Update to owner
      await pool.query(
        `UPDATE club_memberships SET role = 'owner' WHERE club_id = $1 AND user_id = $2`,
        [clubId, userId]
      );

      console.log(`Updated ${userEmail} from ${currentRole} to owner of club ${clubId}`);
    } else {
      // Create new membership as owner
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
}

// CLI usage: tsx scripts/promote-owner.ts <clubId> <userEmail>
const args = process.argv.slice(2);

if (args.length !== 2) {
  console.error("Usage: tsx scripts/promote-owner.ts <clubId> <userEmail>");
  console.error("Example: tsx scripts/promote-owner.ts 123e4567-e89b-12d3-a456-426614174000 user@example.com");
  process.exit(1);
}

const [clubId, userEmail] = args;

promoteOwner(clubId, userEmail);
