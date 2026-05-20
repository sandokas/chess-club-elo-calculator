
import type { Db } from "@chess-club/db";
import { users, sessions, clubMemberships, clubs } from "@chess-club/db";
import { eq, and, gt } from "drizzle-orm";
import { generateSessionToken, hashSessionToken } from "./cookies.js";

/** Session lifetime: 30 days (sliding) */
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

function newSessionExpiry(): Date {
  return new Date(Date.now() + SESSION_DURATION_MS);
}

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
export async function createSession(db: Db, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const tokenHash = await hashSessionToken(token);
  const expiresAt = newSessionExpiry();

  await db.insert(sessions).values({
    userId,
    tokenHash,
    expiresAt
  });

  return { token, expiresAt };
}

/**
 * Load a session by token and return user data with memberships
 */
export async function loadSession(db: Db, token: string): Promise<SessionData | null> {
  const tokenHash = await hashSessionToken(token);

  const [session] = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
      email: users.email,
      name: users.name
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!session) {
    return null;
  }

  const userId = session.userId;

  // Load memberships (role type inferred from clubRoleEnum)
  const memberships = await db
    .select({
      clubId: clubMemberships.clubId,
      role: clubMemberships.role,
      clubName: clubs.name
    })
    .from(clubMemberships)
    .innerJoin(clubs, eq(clubs.id, clubMemberships.clubId))
    .where(eq(clubMemberships.userId, userId));

  return {
    sessionId: session.id,
    id: userId,
    email: session.email,
    name: session.name,
    memberships,
    expiresAt: session.expiresAt
  };
}

/**
 * Revoke a session by token
 */
export async function revokeSession(db: Db, token: string): Promise<void> {
  const tokenHash = await hashSessionToken(token);
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

/**
 * Revoke all sessions for a user
 */
export async function revokeAllUserSessions(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/**
 * Touch a session to extend its expiry (sliding session)
 */
export async function touchSession(db: Db, sessionId: string): Promise<void> {
  await db.update(sessions).set({ expiresAt: newSessionExpiry() }).where(eq(sessions.id, sessionId));
}
