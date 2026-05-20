import { type FastifyInstance } from "fastify";
import { eq, and, desc } from "drizzle-orm";

import { randomBytes } from "node:crypto";
import { hashSessionToken } from "../lib/auth/cookies.js";
import { requireClubRole } from "../lib/auth/rbac.js";
import {
  clubInvites,
  clubJoinRequests,
  clubMemberships,
  players,
  users
} from "@chess-club/db";

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

      // Validate role
      const validRoles = ["owner", "admin", "organizer", "member"];
      if (!validRoles.includes(role)) {
        return reply.status(400).send({
          error: "ValidationError",
          message: `role must be one of: ${validRoles.join(", ")}`
        });
      }

      // Generate token
      const token = randomBytes(32).toString("base64url");
      const tokenHash = await hashSessionToken(token);

      // Calculate expiry (7 days)
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // Check for existing pending invite
      const existingInvite = await db
        .select({ id: clubInvites.id })
        .from(clubInvites)
        .where(
          and(
            eq(clubInvites.clubId, clubId),
            eq(clubInvites.email, email),
            eq(clubInvites.status, "pending")
          )
        );

      if (existingInvite.length > 0) {
        return reply.status(409).send({
          error: "ConflictError",
          message: "A pending invite already exists for this email"
        });
      }

      // Create invite
      const result = await db
        .insert(clubInvites)
        .values({
          clubId,
          email,
          role: role as "owner" | "admin" | "organizer" | "member",
          invitedByUserId: request.user!.id,
          tokenHash,
          expiresAt
        })
        .returning({
          id: clubInvites.id,
          clubId: clubInvites.clubId,
          email: clubInvites.email,
          role: clubInvites.role,
          expiresAt: clubInvites.expiresAt
        });

      return reply.status(201).send({
        invite: result[0],
        // Only return the actual token for the first response (for testing/email)
        token
      });
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

      const result = await db
        .select({
          id: clubInvites.id,
          clubId: clubInvites.clubId,
          email: clubInvites.email,
          role: clubInvites.role,
          status: clubInvites.status,
          createdAt: clubInvites.createdAt,
          expiresAt: clubInvites.expiresAt
        })
        .from(clubInvites)
        .where(eq(clubInvites.clubId, clubId))
        .orderBy(desc(clubInvites.createdAt));

      return { invites: result };
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

      // Check if user is already a member
      const existingMembership = await db
        .select({ role: clubMemberships.role })
        .from(clubMemberships)
        .where(
          and(
            eq(clubMemberships.clubId, clubId),
            eq(clubMemberships.userId, request.user!.id)
          )
        );

      if (existingMembership.length > 0) {
        return reply.status(409).send({
          error: "ConflictError",
          message: "You are already a member of this club"
        });
      }

      // Check for existing pending join request
      const existingRequest = await db
        .select({ id: clubJoinRequests.id })
        .from(clubJoinRequests)
        .where(
          and(
            eq(clubJoinRequests.clubId, clubId),
            eq(clubJoinRequests.userId, request.user!.id),
            eq(clubJoinRequests.status, "pending")
          )
        );

      if (existingRequest.length > 0) {
        return reply.status(409).send({
          error: "ConflictError",
          message: "A pending join request already exists"
        });
      }

      // Create join request
      const result = await db
        .insert(clubJoinRequests)
        .values({
          clubId,
          userId: request.user!.id,
          message: message || null
        })
        .returning({
          id: clubJoinRequests.id,
          clubId: clubJoinRequests.clubId,
          userId: clubJoinRequests.userId,
          message: clubJoinRequests.message,
          status: clubJoinRequests.status,
          createdAt: clubJoinRequests.createdAt
        });

      return reply.status(201).send({ joinRequest: result[0]! });
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

      const result = await db
        .select({
          id: clubJoinRequests.id,
          clubId: clubJoinRequests.clubId,
          userId: clubJoinRequests.userId,
          email: users.email,
          name: users.name,
          message: clubJoinRequests.message,
          status: clubJoinRequests.status,
          createdAt: clubJoinRequests.createdAt
        })
        .from(clubJoinRequests)
        .innerJoin(users, eq(users.id, clubJoinRequests.userId))
        .where(eq(clubJoinRequests.clubId, clubId))
        .orderBy(desc(clubJoinRequests.createdAt));

      return { joinRequests: result };
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

      if (action !== "accept" && action !== "reject") {
        return reply.status(400).send({
          error: "ValidationError",
          message: "action must be 'accept' or 'reject'"
        });
      }

      // Get the join request
      const requestResult = await db
        .select({
          id: clubJoinRequests.id,
          userId: clubJoinRequests.userId,
          status: clubJoinRequests.status
        })
        .from(clubJoinRequests)
        .where(
          and(
            eq(clubJoinRequests.id, id),
            eq(clubJoinRequests.clubId, clubId)
          )
        );

      if (requestResult.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Join request not found"
        });
      }

      const joinRequest = requestResult[0]!;

      if (joinRequest.status !== "pending") {
        return reply.status(409).send({
          error: "ConflictError",
          message: "Join request has already been processed"
        });
      }

      if (action === "reject") {
        await db
          .update(clubJoinRequests)
          .set({
            status: "rejected",
            decidedByUserId: request.user!.id,
            decidedAt: new Date()
          })
          .where(eq(clubJoinRequests.id, id));

        return reply.status(200).send({ message: "Join request rejected" });
      }

      if (action === "accept") {
        if (!playerId) {
          return reply.status(400).send({
            error: "ValidationError",
            message: "playerId is required when accepting a join request"
          });
        }

        // Verify player belongs to this club
        const playerResult = await db
          .select({ id: players.id })
          .from(players)
          .where(
            and(
              eq(players.id, playerId),
              eq(players.clubId, clubId)
            )
          );

        if (playerResult.length === 0) {
          return reply.status(404).send({
            error: "NotFound",
            message: "Player not found in this club"
          });
        }

        // Check if player is already linked to another user
        const linkedPlayerResult = await db
          .select({ linkedUserId: players.linkedUserId })
          .from(players)
          .where(eq(players.id, playerId));

        const linkedUserId = linkedPlayerResult[0]!.linkedUserId;
        if (linkedUserId && linkedUserId !== joinRequest.userId) {
          return reply.status(409).send({
            error: "ConflictError",
            message: "Player is already linked to another user"
          });
        }

        // Create membership
        await db.insert(clubMemberships).values({
          clubId,
          userId: joinRequest.userId,
          role: "member"
        });

        // Link player to user
        await db
          .update(players)
          .set({ linkedUserId: joinRequest.userId })
          .where(eq(players.id, playerId));

        // Update join request
        await db
          .update(clubJoinRequests)
          .set({
            status: "accepted",
            decidedByUserId: request.user!.id,
            decidedAt: new Date()
          })
          .where(eq(clubJoinRequests.id, id));

        return reply.status(200).send({ message: "Join request accepted" });
      }

      return reply.status(400).send({
        error: "ValidationError",
        message: "action must be 'accept' or 'reject'"
      });
    }
  );
}
