import type { Db } from "@chess-club/db";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { ClubRole } from "../lib/auth/rbac.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    auth: {
      requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
      requireClubRole: (roles: ClubRole[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
      requireTournamentClubRole: (roles: ClubRole[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
      requirePlayerClubRole: (roles: ClubRole[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
      requireMatchClubRole: (roles: ClubRole[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    };
  }
}
