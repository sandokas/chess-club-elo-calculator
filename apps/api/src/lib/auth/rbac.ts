
import type { Pool } from "pg";
import type { SessionData } from "./sessions.js";
import type { FastifyRequest, FastifyReply } from "fastify";

export type ClubRole = "owner" | "admin" | "organizer" | "member";

/**
 * Attach the current user to the request object
 */
export async function attachUser(request: FastifyRequest, reply: FastifyReply) {
  const { loadSession } = await import("./sessions.js");
  const token = request.cookies.sid;

  if (!token) {
    request.user = null;
    return;
  }

  const pool = request.server.pg;
  const session = await loadSession(pool, token);
  if (!session) {
    request.user = null;
    return;
  }

  request.user = session;
}

/**
 * Require authentication - returns 401 if not authenticated
 */
export function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) {
    return reply.status(401).send({
      error: "Unauthorized",
      message: "Authentication required"
    });
  }
}

/**
 * Require specific club roles - returns 403 if user doesn't have required role
 */
export async function requireClubRole(
  request: FastifyRequest,
  reply: FastifyReply,
  roles: ClubRole[]
) {
  if (!request.user) {
    return reply.status(401).send({
      error: "Unauthorized",
      message: "Authentication required"
    });
  }

  const clubId = request.params.clubId as string;
  if (!clubId) {
    return reply.status(400).send({
      error: "BadRequest",
      message: "clubId parameter required"
    });
  }

  const membership = request.user.memberships.find(m => m.clubId === clubId);
  if (!membership) {
    return reply.status(403).send({
      error: "Forbidden",
      message: "You are not a member of this club"
    });
  }

  if (!roles.includes(membership.role)) {
    return reply.status(403).send({
      error: "Forbidden",
      message: `Required role: ${roles.join(" or ")}`
    });
  }
}

/**
 * Get membership for a specific club
 */
export async function getMembership(pool: Pool, userId: string, clubId: string): Promise<ClubRole | null> {
  const result = await pool.query(
    `SELECT role FROM club_memberships WHERE user_id = $1 AND club_id = $2`,
    [userId, clubId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0].role as ClubRole;
}

/**
 * Resolve club ID from tournament ID
 */
export async function resolveClubIdFromTournament(pool: Pool, tournamentId: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT club_id FROM tournaments WHERE id = $1`,
    [tournamentId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0].club_id;
}

/**
 * Resolve club ID from player ID
 */
export async function resolveClubIdFromPlayer(pool: Pool, playerId: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT club_id FROM players WHERE id = $1`,
    [playerId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0].club_id;
}

/**
 * Guard that resolves club ID from tournament and checks role
 */
export async function requireTournamentClubRole(
  request: FastifyRequest,
  reply: FastifyReply,
  roles: ClubRole[]
) {
  if (!request.user) {
    return reply.status(401).send({
      error: "Unauthorized",
      message: "Authentication required"
    });
  }

  const pool = request.server.pg;
  const tournamentId = request.params.id as string;
  const clubId = await resolveClubIdFromTournament(pool, tournamentId);

  if (!clubId) {
    return reply.status(404).send({
      error: "NotFound",
      message: "Tournament not found"
    });
  }

  const membership = request.user.memberships.find(m => m.clubId === clubId);
  if (!membership) {
    return reply.status(403).send({
      error: "Forbidden",
      message: "You are not a member of this club"
    });
  }

  if (!roles.includes(membership.role)) {
    return reply.status(403).send({
      error: "Forbidden",
      message: `Required role: ${roles.join(" or ")}`
    });
  }
}

/**
 * Guard that resolves club ID from player and checks role
 */
export async function requirePlayerClubRole(
  request: FastifyRequest,
  reply: FastifyReply,
  roles: ClubRole[]
) {
  if (!request.user) {
    return reply.status(401).send({
      error: "Unauthorized",
      message: "Authentication required"
    });
  }

  const pool = request.server.pg;
  const playerId = request.params.id as string;
  const clubId = await resolveClubIdFromPlayer(pool, playerId);

  if (!clubId) {
    return reply.status(404).send({
      error: "NotFound",
      message: "Player not found"
    });
  }

  const membership = request.user.memberships.find(m => m.clubId === clubId);
  if (!membership) {
    return reply.status(403).send({
      error: "Forbidden",
      message: "You are not a member of this club"
    });
  }

  if (!roles.includes(membership.role)) {
    return reply.status(403).send({
      error: "Forbidden",
      message: `Required role: ${roles.join(" or ")}`
    });
  }
}

// Extend FastifyRequest type to include user
declare module "fastify" {
  interface FastifyRequest {
    user: SessionData | null;
  }
}
