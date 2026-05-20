import { type FastifyInstance } from "fastify";
import { createPool } from "@chess-club/db";
import { randomBytes } from "node:crypto";
import { hashSessionToken } from "../lib/auth/cookies.js";
import { requireClubRole } from "../lib/auth/rbac.js";

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
      const pool = createPool();
      try {
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
        const existingInvite = await pool.query(
          `SELECT id FROM club_invites WHERE club_id = $1 AND email = $2 AND status = 'pending'`,
          [clubId, email]
        );

        if (existingInvite.rows.length > 0) {
          return reply.status(409).send({
            error: "ConflictError",
            message: "A pending invite already exists for this email"
          });
        }

        // Create invite
        const result = await pool.query(
          `INSERT INTO club_invites (club_id, email, role, invited_by_user_id, token_hash, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, club_id AS "clubId", email, role, expires_at AS "expiresAt"`,
          [clubId, email, role, request.user!.id, tokenHash, expiresAt]
        );

        return reply.status(201).send({
          invite: result.rows[0],
          // Only return the actual token for the first response (for testing/email)
          token: token
        });
      } finally {
        await pool.end();
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
      const pool = createPool();
      try {
        const { clubId } = request.params;

        const result = await pool.query(
          `SELECT id, club_id AS "clubId", email, role, status, created_at AS "createdAt", expires_at AS "expiresAt"
           FROM club_invites
           WHERE club_id = $1
           ORDER BY created_at DESC`,
          [clubId]
        );

        return { invites: result.rows };
      } finally {
        await pool.end();
      }
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
      const pool = createPool();
      try {
        const { clubId } = request.params;
        const { message } = request.body;

        // Check if user is already a member
        const existingMembership = await pool.query(
          `SELECT role FROM club_memberships WHERE club_id = $1 AND user_id = $2`,
          [clubId, request.user!.id]
        );

        if (existingMembership.rows.length > 0) {
          return reply.status(409).send({
            error: "ConflictError",
            message: "You are already a member of this club"
          });
        }

        // Check for existing pending join request
        const existingRequest = await pool.query(
          `SELECT id FROM club_join_requests WHERE club_id = $1 AND user_id = $2 AND status = 'pending'`,
          [clubId, request.user!.id]
        );

        if (existingRequest.rows.length > 0) {
          return reply.status(409).send({
            error: "ConflictError",
            message: "A pending join request already exists"
          });
        }

        // Create join request
        const result = await pool.query(
          `INSERT INTO club_join_requests (club_id, user_id, message)
           VALUES ($1, $2, $3)
           RETURNING id, club_id AS "clubId", user_id AS "userId", message, status, created_at AS "createdAt"`,
          [clubId, request.user!.id, message || null]
        );

        return reply.status(201).send({ joinRequest: result.rows[0] });
      } finally {
        await pool.end();
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
      const pool = createPool();
      try {
        const { clubId } = request.params;

        const result = await pool.query(
          `SELECT jr.id, jr.club_id AS "clubId", jr.user_id AS "userId", u.email, u.name, jr.message, jr.status, jr.created_at AS "createdAt"
           FROM club_join_requests jr
           JOIN users u ON u.id = jr.user_id
           WHERE jr.club_id = $1
           ORDER BY jr.created_at DESC`,
          [clubId]
        );

        return { joinRequests: result.rows };
      } finally {
        await pool.end();
      }
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
      const pool = createPool();
      try {
        const { clubId, id } = request.params;
        const { action, playerId } = request.body;

        // Get the join request
        const requestResult = await pool.query(
          `SELECT jr.id, jr.user_id, jr.status FROM club_join_requests jr WHERE jr.id = $1 AND jr.club_id = $2`,
          [id, clubId]
        );

        if (requestResult.rows.length === 0) {
          return reply.status(404).send({
            error: "NotFound",
            message: "Join request not found"
          });
        }

        const joinRequest = requestResult.rows[0];

        if (joinRequest.status !== "pending") {
          return reply.status(409).send({
            error: "ConflictError",
            message: "Join request has already been processed"
          });
        }

        if (action === "reject") {
          await pool.query(
            `UPDATE club_join_requests SET status = 'rejected', decided_by_user_id = $1, decided_at = NOW() WHERE id = $2`,
            [request.user!.id, id]
          );

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
          const playerResult = await pool.query(
            `SELECT id FROM players WHERE id = $1 AND club_id = $2`,
            [playerId, clubId]
          );

          if (playerResult.rows.length === 0) {
            return reply.status(404).send({
              error: "NotFound",
              message: "Player not found in this club"
            });
          }

          // Check if player is already linked to another user
          const linkedPlayerResult = await pool.query(
            `SELECT linked_user_id FROM players WHERE id = $1`,
            [playerId]
          );

          if (linkedPlayerResult.rows[0].linked_user_id && linkedPlayerResult.rows[0].linked_user_id !== joinRequest.user_id) {
            return reply.status(409).send({
              error: "ConflictError",
              message: "Player is already linked to another user"
            });
          }

          // Create membership
          await pool.query(
            `INSERT INTO club_memberships (club_id, user_id, role) VALUES ($1, $2, 'member')`,
            [clubId, joinRequest.user_id]
          );

          // Link player to user
          await pool.query(
            `UPDATE players SET linked_user_id = $1 WHERE id = $2`,
            [joinRequest.user_id, playerId]
          );

          // Update join request
          await pool.query(
            `UPDATE club_join_requests SET status = 'accepted', decided_by_user_id = $1, decided_at = NOW() WHERE id = $2`,
            [request.user!.id, id]
          );

          return reply.status(200).send({ message: "Join request accepted" });
        }

        return reply.status(400).send({
          error: "ValidationError",
          message: "action must be 'accept' or 'reject'"
        });
      } finally {
        await pool.end();
      }
    }
  );
}
