import { type FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";

import { requireClubRole } from "../lib/auth/rbac.js";
import { createNotFoundError, createValidationError } from "../lib/errors.js";
import {
  createInvite,
  listInvites,
  createJoinRequest,
  listJoinRequests,
  processJoinRequest
} from "../services/invites.js";

/**
 * Register invite and join request routes
 */
export async function registerInviteRoutes(app: FastifyInstance): Promise<void> {
  // POST /clubs/:clubId/invites - Create an invite for a specific email
  app.post<{ Params: { clubId: string }; Body: { email: string; role?: string } }>(
    "/clubs/:clubId/invites",
    {
      preHandler: [
        async (request, reply) => {
          if (!request.user) {
            return reply.status(401).send({ error: "Unauthorized", message: "Authentication required" });
          }
          await requireClubRole(request, reply, ["owner", "admin"]);
        }
      ]
    },
    async (request, reply) => {
      const db = app.db;
      const { email, role = "member" } = request.body;
      const { clubId } = request.params;

      try {
        const result = await createInvite(db, {
          email,
          role,
          clubId,
          invitedByUserId: request.user!.id
        });
        return reply.status(201).send(result);
      } catch (error) {
        if (error instanceof Error) {
          if (error.message.startsWith("role must be one of:")) {
            return reply.status(400).send({
              error: "ValidationError",
              message: error.message
            });
          }
          if (error.message === "A pending invite already exists for this email") {
            return reply.status(409).send({
              error: "ConflictError",
              message: error.message
            });
          }
        }
        throw error;
      }
    }
  );

  // GET /clubs/:clubId/invites - List invites for a club
  app.get<{ Params: { clubId: string } }>(
    "/clubs/:clubId/invites",
    {
      preHandler: [
        async (request, reply) => {
          if (!request.user) {
            return reply.status(401).send({ error: "Unauthorized", message: "Authentication required" });
          }
          await requireClubRole(request, reply, ["owner", "admin"]);
        }
      ]
    },
    async (request, reply) => {
      const db = app.db;
      const { clubId } = request.params;

      return await listInvites(db, { clubId });
    }
  );

  // POST /clubs/:clubId/join-requests - Create a join request
  app.post<{ Params: { clubId: string }; Body: { message?: string } }>(
    "/clubs/:clubId/join-requests",
    {
      preHandler: [
        async (request, reply) => {
          if (!request.user) {
            return reply.status(401).send({ error: "Unauthorized", message: "Authentication required" });
          }
        }
      ]
    },
    async (request, reply) => {
      const db = app.db;
      const { clubId } = request.params;
      const { message } = request.body;

      try {
        const result = await createJoinRequest(db, {
          clubId,
          userId: request.user!.id,
          message
        });
        return reply.status(201).send({ joinRequest: result });
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === "You are already a member of this club" || 
              error.message === "A pending join request already exists") {
            return reply.status(409).send({
              error: "ConflictError",
              message: error.message
            });
          }
        }
        throw error;
      }
    }
  );

  // GET /clubs/:clubId/join-requests - List join requests for a club
  app.get<{ Params: { clubId: string } }>(
    "/clubs/:clubId/join-requests",
    {
      preHandler: [
        async (request, reply) => {
          if (!request.user) {
            return reply.status(401).send({ error: "Unauthorized", message: "Authentication required" });
          }
          await requireClubRole(request, reply, ["owner", "admin"]);
        }
      ]
    },
    async (request, reply) => {
      const db = app.db;
      const { clubId } = request.params;

      return await listJoinRequests(db, { clubId });
    }
  );

  // PUT /clubs/:clubId/join-requests/:id - Accept or reject a join request
  app.put<{ Params: { clubId: string; id: string }; Body: { action: "accept" | "reject"; playerId?: string } }>(
    "/clubs/:clubId/join-requests/:id",
    {
      preHandler: [
        async (request, reply) => {
          if (!request.user) {
            return reply.status(401).send({ error: "Unauthorized", message: "Authentication required" });
          }
          await requireClubRole(request, reply, ["owner", "admin"]);
        }
      ]
    },
    async (request, reply) => {
      const db = app.db;
      const { clubId, id } = request.params;
      const { action, playerId } = request.body;

      try {
        const result = await processJoinRequest(db, {
          clubId,
          id,
          action,
          playerId,
          decidedByUserId: request.user!.id
        });
        return reply.status(200).send(result);
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === "action must be 'accept' or 'reject'" ||
              error.message === "playerId is required when accepting a join request") {
            return reply.status(400).send({
              error: "ValidationError",
              message: error.message
            });
          }
          if (error.message === "Join request not found") {
            throw createNotFoundError(error.message);
          }
          if (error.message === "Join request has already been processed" ||
              error.message === "Player not found in this club" ||
              error.message === "Player is already linked to another user") {
            return reply.status(409).send({
              error: "ConflictError",
              message: error.message
            });
          }
        }
        throw error;
      }
    }
  );
}
