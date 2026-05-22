import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { loadEnv } from "@chess-club/config";
import {
  requireAuth as requireAuthImpl,
  requireClubRole as requireClubRoleImpl,
  requireTournamentClubRole as requireTournamentClubRoleImpl,
  requirePlayerClubRole as requirePlayerClubRoleImpl,
  resolveClubIdFromTournament,
  type ClubRole
} from "../lib/auth/rbac.js";
import { matches } from "@chess-club/db";
import { eq } from "drizzle-orm";

const env = loadEnv();
const requireAuthEnabled = env.REQUIRE_AUTH;

export interface AuthPluginOptions {}

export default fp<AuthPluginOptions>(async (app) => {
  const noopHandler = async (_request: FastifyRequest, _reply: FastifyReply) => {};

  const requireAuth = requireAuthEnabled ? requireAuthImpl : noopHandler;

  const requireClubRole = (roles: ClubRole[]) =>
    requireAuthEnabled ? ((request: FastifyRequest, reply: FastifyReply) => requireClubRoleImpl(request, reply, roles)) : noopHandler;

  const requireTournamentClubRole = (roles: ClubRole[]) =>
    requireAuthEnabled ? ((request: FastifyRequest, reply: FastifyReply) => requireTournamentClubRoleImpl(request, reply, roles)) : noopHandler;

  const requirePlayerClubRole = (roles: ClubRole[]) =>
    requireAuthEnabled ? ((request: FastifyRequest, reply: FastifyReply) => requirePlayerClubRoleImpl(request, reply, roles)) : noopHandler;

  const requireMatchClubRole = (roles: ClubRole[]) =>
    requireAuthEnabled
      ? async (request: FastifyRequest, reply: FastifyReply) => {
          if (!request.user) {
            return reply.status(401).send({
              error: "Unauthorized",
              message: "Authentication required"
            });
          }

          const db = request.server.db;
          const params = request.params as { id: string };
          const matchId = params.id;

          const matchResult = await db.select({ tournamentId: matches.tournamentId }).from(matches).where(eq(matches.id, matchId)).limit(1);
          if (matchResult.length === 0) {
            return reply.status(404).send({
              error: "NotFound",
              message: "Match not found"
            });
          }

          const tournamentId = matchResult[0].tournamentId;
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
      : noopHandler;

  app.decorate("auth", {
    requireAuth,
    requireClubRole,
    requireTournamentClubRole,
    requirePlayerClubRole,
    requireMatchClubRole
  });
}, {
  name: "auth"
});
