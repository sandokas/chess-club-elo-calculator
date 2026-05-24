import type { Db } from "@chess-club/db";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { ClubRole } from "../lib/auth/rbac.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    auth: {
      requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
      requireClubRole: (role: ClubRole) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
      requireTournamentClubRole: (role: ClubRole) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
      requirePlayerClubRole: (role: ClubRole) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
      requireMatchClubRole: (role: ClubRole) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
      requireRoundClubRole: (role: ClubRole) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    };
  }
}
