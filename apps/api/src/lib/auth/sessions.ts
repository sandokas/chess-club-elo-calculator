
import type { Pool } from "pg";
import { generateSessionToken, hashSessionToken, getCookieConfig } from "./cookies.js";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  memberships: Array<{
    clubId: string;
    clubName: string;
    role: "owner" | "admin" | "organizer" | "member";
  }>;
};

export type SessionData = SessionUser & {
  sessionId: string;
  expiresAt: Date;
};

/**
 * Create a new session for a user
 */
export async function createSession(pool: Pool, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const tokenHash = await hashSessionToken(token);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return { token, expiresAt };
}

/**
 * Load a session by token and return user data with memberships
 */
export async function loadSession(pool: Pool, token: string): Promise<SessionData | null> {
  const tokenHash = await hashSessionToken(token);

  const sessionResult = await pool.query(
    `SELECT s.id, s.user_id, s.expires_at, u.email, u.name
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
    [tokenHash]
  );

  if (sessionResult.rows.length === 0) {
    return null;
  }

  const session = sessionResult.rows[0];
  const userId = session.user_id;

  // Load memberships
  const membershipsResult = await pool.query(
    `SELECT cm.club_id, cm.role, c.name as club_name
     FROM club_memberships cm
     JOIN clubs c ON c.id = cm.club_id
     WHERE cm.user_id = $1`,
    [userId]
  );

  const memberships = membershipsResult.rows.map((row: any) => ({
    clubId: row.club_id,
    clubName: row.club_name,
    role: row.role
  }));

  return {
    sessionId: session.id,
    id: userId,
    email: session.email,
    name: session.name,
    memberships,
    expiresAt: session.expires_at
  };
}

/**
 * Revoke a session by token
 */
export async function revokeSession(pool: Pool, token: string): Promise<void> {
  const tokenHash = await hashSessionToken(token);
  await pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
}

/**
 * Revoke all sessions for a user
 */
export async function revokeAllUserSessions(pool: Pool, userId: string): Promise<void> {
  await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
}

/**
 * Touch a session to extend its expiry (sliding session)
 */
export async function touchSession(pool: Pool, sessionId: string): Promise<void> {
  const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await pool.query(
    `UPDATE sessions SET expires_at = $1 WHERE id = $2`,
    [newExpiresAt, sessionId]
  );
}
