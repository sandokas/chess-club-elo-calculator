
import type { Db } from "@chess-club/db";
import { clubs, clubMemberships, tournaments, players, matches, rounds } from "@chess-club/db";
import { eq, and } from "drizzle-orm";
import type { SessionData } from "./sessions.js";
import type { FastifyRequest, FastifyReply } from "fastify";

export type ClubRole = "owner" | "admin" | "organizer" | "member";
export const clubRoles = ["owner", "admin", "organizer", "member"] as const satisfies readonly ClubRole[];

export const clubRoleRank = {
  member: 0,
  organizer: 1,
  admin: 2,
  owner: 3
} as const satisfies Record<ClubRole, number>;

export function hasClubRoleAtLeast(actual: ClubRole, required: ClubRole): boolean {
  return clubRoleRank[actual] >= clubRoleRank[required];
}

export function isClubRole(value: string): value is ClubRole {
  return clubRoles.includes(value as ClubRole);
}

function requiredRoleMessage(required: ClubRole): string {
  return `Required role: ${required} or higher`;
}

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
 * Require a minimum club role - returns 403 if user doesn't have required role
 */
export async function requireClubRoleAtLeast(
  request: FastifyRequest,
  reply: FastifyReply,
  requiredRole: ClubRole
) {
  if (!request.user) {
    return reply.status(401).send({
      error: "Unauthorized",
      message: "Authentication required"
    });
  }

  const { clubId } = request.params as { clubId?: string };
  if (!clubId) {
    return reply.status(400).send({
      error: "BadRequest",
      message: "clubId parameter required"
    });
  }

  const membership = request.user.memberships.find(m => m.clubId === clubId);
  if (!membership) {
    const [club] = await request.server.db
      .select({ id: clubs.id })
      .from(clubs)
      .where(eq(clubs.id, clubId))
      .limit(1);
    if (!club) {
      return reply.status(404).send({
        error: "NotFound",
        message: "Club not found"
      });
    }

    return reply.status(403).send({
      error: "Forbidden",
      message: "You are not a member of this club"
    });
  }

  if (!hasClubRoleAtLeast(membership.role, requiredRole)) {
    return reply.status(403).send({
      error: "Forbidden",
      message: requiredRoleMessage(requiredRole)
    });
  }
}

export const requireClubRole = requireClubRoleAtLeast;

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

export async function resolveClubIdFromRound(db: Db, roundId: string): Promise<string | null> {
  const [row] = await db
    .select({ clubId: tournaments.clubId })
    .from(rounds)
    .innerJoin(tournaments, eq(tournaments.id, rounds.tournamentId))
    .where(eq(rounds.id, roundId))
    .limit(1);

  return row?.clubId ?? null;
}

export async function resolveClubIdFromMatch(db: Db, matchId: string): Promise<string | null> {
  const [row] = await db
    .select({ clubId: matches.clubId })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);

  return row?.clubId ?? null;
}

async function requireResolvedClubRole(
  request: FastifyRequest,
  reply: FastifyReply,
  requiredRole: ClubRole,
  clubId: string | null,
  notFoundMessage: string
) {
  if (!request.user) {
    return reply.status(401).send({
      error: "Unauthorized",
      message: "Authentication required"
    });
  }

  if (!clubId) {
    return reply.status(404).send({
      error: "NotFound",
      message: notFoundMessage
    });
  }

  const membership = request.user.memberships.find(m => m.clubId === clubId);
  if (!membership) {
    return reply.status(403).send({
      error: "Forbidden",
      message: "You are not a member of this club"
    });
  }

  if (!hasClubRoleAtLeast(membership.role, requiredRole)) {
    return reply.status(403).send({
      error: "Forbidden",
      message: requiredRoleMessage(requiredRole)
    });
  }
}

/**
 * Guard that resolves club ID from tournament and checks role
 */
export async function requireTournamentClubRole(
  request: FastifyRequest,
  reply: FastifyReply,
  requiredRole: ClubRole
) {
  const db = request.server.db;
  const { id: tournamentId } = request.params as { id: string };
  const clubId = await resolveClubIdFromTournament(db, tournamentId);
  return requireResolvedClubRole(request, reply, requiredRole, clubId, "Tournament not found");
}

/**
 * Guard that resolves club ID from player and checks role
 */
export async function requirePlayerClubRole(
  request: FastifyRequest,
  reply: FastifyReply,
  requiredRole: ClubRole
) {
  const db = request.server.db;
  const { id: playerId } = request.params as { id: string };
  const clubId = await resolveClubIdFromPlayer(db, playerId);
  return requireResolvedClubRole(request, reply, requiredRole, clubId, "Player not found");
}

export async function requireRoundClubRole(
  request: FastifyRequest,
  reply: FastifyReply,
  requiredRole: ClubRole
) {
  const db = request.server.db;
  const { id: roundId } = request.params as { id: string };
  const clubId = await resolveClubIdFromRound(db, roundId);
  return requireResolvedClubRole(request, reply, requiredRole, clubId, "Round not found");
}

export async function requireMatchClubRole(
  request: FastifyRequest,
  reply: FastifyReply,
  requiredRole: ClubRole
) {
  const db = request.server.db;
  const { id: matchId } = request.params as { id: string };
  const clubId = await resolveClubIdFromMatch(db, matchId);
  return requireResolvedClubRole(request, reply, requiredRole, clubId, "Match not found");
}

// Extend FastifyRequest type to include user
declare module "fastify" {
  interface FastifyRequest {
    user: SessionData | null;
  }
}
