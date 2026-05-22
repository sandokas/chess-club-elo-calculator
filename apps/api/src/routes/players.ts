import { type FastifyInstance } from "fastify";

import {
  parsePaginationParams,
  parseSortParams,
  parseStringFilter,
  escapeLikePattern,
  parseBooleanFilter,
  parseNumberFilter,
  parseDateFilter
} from "../lib/validators.js";
import { createNotFoundError, createValidationError } from "../lib/errors.js";
import { playersSortColumnMap } from "../lib/query-helpers.js";
import {
  createPlayer,
  deletePlayer,
  listPlayers,
  getPlayerById,
  updatePlayer
} from "../services/players.js";

type ClubParams = {
  clubId: string;
};

type PlayerParams = {
  id: string;
};

type ClubPlayerParams = {
  clubId: string;
  playerId: string;
};

type PlayersQuerystring = {
  page?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: string;
  name?: string;
  active?: string;
  eloMin?: string;
  eloMax?: string;
  glickoMin?: string;
  glickoMax?: string;
  gamesPlayedMin?: string;
  gamesPlayedMax?: string;
  lastGameDateAfter?: string;
  lastGameDateBefore?: string;
};

type UpdatePlayerBody = {
  displayName?: string;
  active?: boolean;
};

type CreatePlayerBody = {
  displayName: string;
};

/**
 * Registers player routes
 */
export async function registerPlayerRoutes(app: FastifyInstance): Promise<void> {
  const allowedSortColumns = Object.keys(playersSortColumnMap);

  app.post<{ Params: ClubParams; Body: CreatePlayerBody }>(
    "/clubs/:clubId/players",
    async (request, reply) => {
      const db = app.db;
      const { displayName } = request.body;

      if (!displayName || displayName.trim() === "") {
        throw createValidationError("displayName is required");
      }

      try {
        const player = await createPlayer(db, request.params.clubId, displayName);
        return reply.status(201).send({ player });
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === "Player with this name already exists in this club") {
            throw createValidationError(error.message);
          }
        }
        throw error;
      }
    }
  );

  app.delete<{ Params: ClubPlayerParams }>(
    "/clubs/:clubId/players/:playerId",
    async (request, reply) => {
      const db = app.db;

      try {
        await deletePlayer(db, request.params.clubId, request.params.playerId);
        return reply.status(204).send();
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === "Player not found in this club") {
            throw createNotFoundError(error.message);
          }
          if (error.message === "Cannot delete player with match history") {
            throw createValidationError(error.message);
          }
        }
        throw error;
      }
    }
  );

  app.get<{ Params: ClubParams; Querystring: PlayersQuerystring }>(
    "/clubs/:clubId/players",
    async (request, reply) => {
      const db = app.db;

      try {
        const result = await listPlayers(db, request.params.clubId, request.query);
        return result;
      } catch (error) {
        if (error instanceof Error && error.message === "Page exceeds total pages") {
          return reply.status(404).send({
            error: "NotFound",
            message: error.message
          });
        }
        throw error;
      }
    }
  );

  app.get<{ Params: PlayerParams }>("/players/:id", async (request) => {
    const db = app.db;

    try {
      return await getPlayerById(db, request.params.id);
    } catch (error) {
      if (error instanceof Error && error.message === "Player not found") {
        throw createNotFoundError(error.message);
      }
      throw error;
    }
  });

  app.put<{ Params: PlayerParams; Body: UpdatePlayerBody }>(
    "/players/:id",
    async (request, reply) => {
      const db = app.db;
      const { displayName, active } = request.body;

      if (displayName !== undefined && displayName.trim() === "") {
        throw createValidationError("displayName cannot be empty");
      }

      try {
        const player = await updatePlayer(db, request.params.id, { displayName, active });
        return reply.status(200).send({ player });
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === "Player not found") {
            throw createNotFoundError(error.message);
          }
          if (error.message === "displayName cannot be empty" || error.message === "No fields to update") {
            throw createValidationError(error.message);
          }
        }
        throw error;
      }
    }
  );
}
