import type { FastifyInstance } from "fastify";
import { createClubSchema, updateClubSchema } from "../lib/schemas/club.js";
import { parseBody } from "../lib/validate.js";
import {
  createClub,
  deleteClub,
  listClubsForUser,
  recomputeClubRatings,
  updateClub
} from "../services/clubs.js";

type ClubParams = {
  clubId: string;
};

export async function registerClubsRoutes(app: FastifyInstance) {
  app.get("/clubs", { preHandler: [app.auth.requireAuth] }, async (request) => {
    const result = await listClubsForUser(app.db, request.user!.id);
    app.log.info({ msg: "GET /clubs query successful", count: result.length });
    return { clubs: result };
  });

  app.post<{ Body: { name: string; description?: string; city?: string; country?: string } }>("/clubs", { preHandler: [app.auth.requireAuth] }, async (request, reply) => {
    const body = parseBody(createClubSchema, request.body);

    try {
      const club = await createClub(app.db, body, request.user!.id);
      return reply.status(201).send({ club });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "name must contain valid characters") {
          return reply.status(400).send({ error: "ValidationError", message: error.message });
        }
        if (error.message === "A club with this slug already exists") {
          return reply.status(409).send({ error: "ConflictError", message: error.message });
        }
        if (error.message === "Failed to create club") {
          return reply.status(500).send({ error: "InternalError", message: error.message });
        }
      }
      throw error;
    }
  });

  app.patch<{ Params: ClubParams; Body: { name?: string; description?: string; city?: string; country?: string } }>("/clubs/:clubId", { preHandler: [app.auth.requireClubRole("organizer")] }, async (request, reply) => {
    const body = parseBody(updateClubSchema, request.body);
    const club = await updateClub(app.db, request.params.clubId, body);
    return reply.status(200).send({ club });
  });

  app.delete<{ Params: ClubParams }>("/clubs/:clubId", { preHandler: [app.auth.requireClubRole("owner")] }, async (request, reply) => {
    await deleteClub(app.db, request.params.clubId);
    return reply.status(204).send();
  });

  app.post<{ Params: ClubParams }>("/clubs/:clubId/ratings/recompute", { preHandler: [app.auth.requireClubRole("admin")] }, async (request, reply) => {
    const result = await recomputeClubRatings(app.db, request.params.clubId);
    if (result.playersUpdated === 0) {
      return reply.status(200).send({
        message: result.message,
        playersUpdated: 0
      });
    }

    return reply.status(200).send({
      message: result.message,
      playersUpdated: result.playersUpdated
    });
  });
}
