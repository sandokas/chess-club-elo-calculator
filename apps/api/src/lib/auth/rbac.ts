
import type { Db } from "@chess-club/db";
import { clubMemberships, tournaments, players } from "@chess-club/db";
import { eq, and } from "drizzle-orm";
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

  const db = request.server.db;
  const session = await loadSession(db, token);
  if (!session) {
    request.user = null;
    return;
  }

  request.user = session;
}

/**
 * Require authentication - returns 401 if not authenticated.
 *
 * NOTE: this MUST be async. Fastify v5 inspects the function arity to decide
 * whether to await it; an arity-2 non-async preHandler that returns `undefined`
 * (i.e. when the user IS authenticated) causes Fastify to hang waiting for a
 * promise that never resolves. Returning a sent reply (the 401 path) works
 * either way, but the pass-through case requires async.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
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
export async function getMembership(db: Db, userId: string, clubId: string): Promise<ClubRole | null> {
  const [row] = await db
    .select({ role: clubMemberships.role })
    .from(clubMemberships)
    .where(and(eq(clubMemberships.userId, userId), eq(clubMemberships.clubId, clubId)))
    .limit(1);

  return row?.role ?? null;
}

/**
 * Resolve club ID from tournament ID
 */
export async function resolveClubIdFromTournament(db: Db, tournamentId: string): Promise<string | null> {
  const [row] = await db
    .select({ clubId: tournaments.clubId })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  return row?.clubId ?? null;
}

/**
 * Resolve club ID from player ID
 */
export async function resolveClubIdFromPlayer(db: Db, playerId: string): Promise<string | null> {
  const [row] = await db
    .select({ clubId: players.clubId })
    .from(players)
    .where(eq(players.id, playerId))
    .limit(1);

  return row?.clubId ?? null;
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

  const db = request.server.db;
  const tournamentId = request.params.id as string;
  const clubId = await resolveClubIdFromTournament(db, tournamentId);

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

  const db = request.server.db;
  const playerId = request.params.id as string;
  const clubId = await resolveClubIdFromPlayer(db, playerId);

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
