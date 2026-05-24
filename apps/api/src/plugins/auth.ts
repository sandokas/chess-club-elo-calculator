import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  requireAuth as requireAuthImpl,
  requireClubRole as requireClubRoleImpl,
  requireTournamentClubRole as requireTournamentClubRoleImpl,
  requirePlayerClubRole as requirePlayerClubRoleImpl,
  requireMatchClubRole as requireMatchClubRoleImpl,
  requireRoundClubRole as requireRoundClubRoleImpl,
  type ClubRole
} from "../lib/auth/rbac.js";

export interface AuthPluginOptions {}

export default fp<AuthPluginOptions>(async (app) => {
  const requireAuth = requireAuthImpl;
  const requireClubRole = (role: ClubRole) =>
    (request: FastifyRequest, reply: FastifyReply) => requireClubRoleImpl(request, reply, role);
  const requireTournamentClubRole = (role: ClubRole) =>
    (request: FastifyRequest, reply: FastifyReply) => requireTournamentClubRoleImpl(request, reply, role);
  const requirePlayerClubRole = (role: ClubRole) =>
    (request: FastifyRequest, reply: FastifyReply) => requirePlayerClubRoleImpl(request, reply, role);
  const requireMatchClubRole = (role: ClubRole) =>
    (request: FastifyRequest, reply: FastifyReply) => requireMatchClubRoleImpl(request, reply, role);
  const requireRoundClubRole = (role: ClubRole) =>
    (request: FastifyRequest, reply: FastifyReply) => requireRoundClubRoleImpl(request, reply, role);

  app.decorate("auth", {
    requireAuth,
    requireClubRole,
    requireTournamentClubRole,
    requirePlayerClubRole,
    requireMatchClubRole,
    requireRoundClubRole
  });
}, {
  name: "auth"
});
