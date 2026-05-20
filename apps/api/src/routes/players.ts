import { type FastifyInstance } from "fastify";
import { eq, and, desc, asc, sql, count, type SQL } from "drizzle-orm";

import { ratingConfig } from "@chess-club/config";
import {
  parsePaginationParams,
  parseSortParams,
  parseStringFilter,
  parseBooleanFilter,
  parseNumberFilter,
  parseDateFilter
} from "../lib/validators.js";
import { createNotFoundError, createValidationError } from "../lib/errors.js";
import { playersSortColumnMap, buildWhereClause } from "../lib/query-helpers.js";
import {
  players,
  playerRatings,
  clubs,
  matches
} from "@chess-club/db";

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

      // Check if player with same name already exists in club
      const existingPlayer = await db
        .select({ id: players.id })
        .from(players)
        .where(
          and(
            eq(players.clubId, request.params.clubId),
            eq(players.displayName, displayName.trim())
          )
        );

      if (existingPlayer.length > 0) {
        throw createValidationError("Player with this name already exists in this club");
      }

      const result = await db
        .insert(players)
        .values({
          clubId: request.params.clubId,
          displayName: displayName.trim(),
          active: true
        })
        .returning({
          id: players.id,
          displayName: players.displayName,
          active: players.active,
          legacyId: players.legacyId,
          createdAt: players.createdAt,
          clubId: players.clubId
        });

      const player = result[0]!;

      // Create player ratings record using the single rating config source of truth.
      await db.insert(playerRatings).values({
        playerId: player.id,
        clubId: request.params.clubId,
        elo: ratingConfig.defaultElo,
        glickoRating: ratingConfig.g2DefaultRating,
        glickoRd: ratingConfig.g2DefaultRd,
        glickoVol: ratingConfig.g2DefaultVol,
        gamesPlayed: 0
      });

      return reply.status(201).send({ player });
    }
  );

  app.delete<{ Params: ClubPlayerParams }>(
    "/clubs/:clubId/players/:playerId",
    async (request, reply) => {
      const db = app.db;

      // Check if player belongs to club
      const playerResult = await db
        .select({ id: players.id })
        .from(players)
        .where(
          and(
            eq(players.id, request.params.playerId),
            eq(players.clubId, request.params.clubId)
          )
        );

      if (playerResult.length === 0) {
        throw createNotFoundError("Player not found in this club");
      }

      // Check if player has any matches
      const matchesResult = await db
        .select({ id: matches.id })
        .from(matches)
        .where(
          sql`${matches.whitePlayerId} = ${request.params.playerId} OR ${matches.blackPlayerId} = ${request.params.playerId}`
        )
        .limit(1);

      if (matchesResult.length > 0) {
        throw createValidationError("Cannot delete player with match history");
      }

      // Delete player ratings
      await db
        .delete(playerRatings)
        .where(eq(playerRatings.playerId, request.params.playerId));

      // Delete player
      await db.delete(players).where(eq(players.id, request.params.playerId));

      return reply.status(204).send();
    }
  );

  app.get<{ Params: ClubParams; Querystring: PlayersQuerystring }>(
    "/clubs/:clubId/players",
    async (request, reply) => {
      const db = app.db;
      const { page, limit } = parsePaginationParams(request.query);
      const { sortBy, sortOrder } = parseSortParams(request.query, allowedSortColumns);

      // Build filter conditions
      const conditions: (SQL | undefined)[] = [eq(players.clubId, request.params.clubId)];

      const name = parseStringFilter(request.query.name);
      if (name) {
        conditions.push(sql`${players.displayName} LIKE ${"%" + name + "%"}`);
      }

      const active = parseBooleanFilter(request.query.active);
      if (active !== undefined) {
        conditions.push(eq(players.active, active));
      }

      const eloMin = parseNumberFilter(request.query.eloMin);
      if (eloMin !== undefined) {
        conditions.push(sql`${playerRatings.elo} >= ${eloMin}`);
      }

      const eloMax = parseNumberFilter(request.query.eloMax);
      if (eloMax !== undefined) {
        conditions.push(sql`${playerRatings.elo} <= ${eloMax}`);
      }

      const glickoMin = parseNumberFilter(request.query.glickoMin);
      if (glickoMin !== undefined) {
        conditions.push(sql`${playerRatings.glickoRating} >= ${glickoMin}`);
      }

      const glickoMax = parseNumberFilter(request.query.glickoMax);
      if (glickoMax !== undefined) {
        conditions.push(sql`${playerRatings.glickoRating} <= ${glickoMax}`);
      }

      const gamesPlayedMin = parseNumberFilter(request.query.gamesPlayedMin);
      if (gamesPlayedMin !== undefined) {
        conditions.push(sql`${playerRatings.gamesPlayed} >= ${gamesPlayedMin}`);
      }

      const gamesPlayedMax = parseNumberFilter(request.query.gamesPlayedMax);
      if (gamesPlayedMax !== undefined) {
        conditions.push(sql`${playerRatings.gamesPlayed} <= ${gamesPlayedMax}`);
      }

      const lastGameDateAfter = parseDateFilter(request.query.lastGameDateAfter);
      if (lastGameDateAfter) {
        conditions.push(sql`${playerRatings.lastGameDate} >= ${lastGameDateAfter}`);
      }

      const lastGameDateBefore = parseDateFilter(request.query.lastGameDateBefore);
      if (lastGameDateBefore) {
        conditions.push(sql`${playerRatings.lastGameDate} <= ${lastGameDateBefore}`);
      }

      const whereClause = buildWhereClause(conditions);

      // Get total count
      const countResult = await db
        .select({ total: count() })
        .from(players)
        .innerJoin(playerRatings, eq(playerRatings.playerId, players.id))
        .where(whereClause);
      const total = countResult[0]!.total;
      const totalPages = Math.ceil(total / limit);

      if (page > totalPages && totalPages > 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Page exceeds total pages"
        });
      }

      const offset = (page - 1) * limit;
      const sortColumn = playersSortColumnMap[sortBy]!;
      const orderBy = sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);

      const result = await db
        .select({
          id: players.id,
          displayName: players.displayName,
          active: players.active,
          legacyId: players.legacyId,
          elo: playerRatings.elo,
          glickoRating: playerRatings.glickoRating,
          glickoRd: playerRatings.glickoRd,
          glickoVol: playerRatings.glickoVol,
          gamesPlayed: playerRatings.gamesPlayed,
          lastGameDate: playerRatings.lastGameDate
        })
        .from(players)
        .innerJoin(playerRatings, eq(playerRatings.playerId, players.id))
        .where(whereClause)
        .orderBy(orderBy, asc(players.displayName))
        .limit(limit)
        .offset(offset);

      return {
        players: result,
        pagination: {
          page,
          limit,
          total,
          totalPages
        }
      };
    }
  );

  app.get<{ Params: PlayerParams }>("/players/:id", async (request) => {
    const db = app.db;

    const playerResult = await db
      .select({
        id: players.id,
        displayName: players.displayName,
        active: players.active,
        legacyId: players.legacyId,
        createdAt: players.createdAt,
        clubId: players.clubId,
        clubName: clubs.name,
        elo: playerRatings.elo,
        glickoRating: playerRatings.glickoRating,
        glickoRd: playerRatings.glickoRd,
        glickoVol: playerRatings.glickoVol,
        gamesPlayed: playerRatings.gamesPlayed,
        lastGameDate: playerRatings.lastGameDate
      })
      .from(players)
      .innerJoin(clubs, eq(clubs.id, players.clubId))
      .innerJoin(playerRatings, eq(playerRatings.playerId, players.id))
      .where(eq(players.id, request.params.id));

    if (playerResult.length === 0) {
      throw createNotFoundError("Player not found");
    }

    const player = playerResult[0]!;

    // Using sql`` template tag for CASE expressions to keep the query clear and efficient
    // Decomposing into two queries would require merging in JS and is less performant
    const matchesResult = await db.execute(
      sql`
        SELECT
          m.id,
          m.white_player_id AS "whitePlayerId",
          wp.display_name AS "whitePlayerName",
          m.black_player_id AS "blackPlayerId",
          bp.display_name AS "blackPlayerName",
          m.result,
          m.played_on AS "playedOn",
          m.tournament_id AS "tournamentId",
          t.name AS "tournamentName",
          CASE
            WHEN m.white_player_id = ${request.params.id} THEN m.white_elo_before
            ELSE m.black_elo_before
          END AS "eloBefore",
          CASE
            WHEN m.white_player_id = ${request.params.id} THEN m.white_elo_after
            ELSE m.black_elo_after
          END AS "eloAfter",
          CASE
            WHEN m.white_player_id = ${request.params.id} THEN m.white_glicko_rating_before
            ELSE m.black_glicko_rating_before
          END AS "glickoRatingBefore",
          CASE
            WHEN m.white_player_id = ${request.params.id} THEN m.white_glicko_rating_after
            ELSE m.black_glicko_rating_after
          END AS "glickoRatingAfter"
        FROM matches m
        JOIN players wp ON wp.id = m.white_player_id
        JOIN players bp ON bp.id = m.black_player_id
        JOIN tournaments t ON t.id = m.tournament_id
        WHERE (m.white_player_id = ${request.params.id} OR m.black_player_id = ${request.params.id})
          AND m.result IS NOT NULL
        ORDER BY m.played_on DESC, m.id DESC
        LIMIT 20
      `
    );

    return {
      player,
      matches: matchesResult.rows
    };
  });

  app.put<{ Params: PlayerParams; Body: UpdatePlayerBody }>(
    "/players/:id",
    async (request, reply) => {
      const db = app.db;
      const { displayName, active } = request.body;

      if (displayName !== undefined && displayName.trim() === "") {
        throw createValidationError("displayName cannot be empty");
      }

      const updates: Record<string, any> = {};

      if (displayName !== undefined) {
        updates.displayName = displayName.trim();
      }

      if (active !== undefined) {
        updates.active = active;
      }

      if (Object.keys(updates).length === 0) {
        throw createValidationError("No fields to update");
      }

      updates.updatedAt = new Date();

      const result = await db
        .update(players)
        .set(updates)
        .where(eq(players.id, request.params.id))
        .returning({
          id: players.id,
          displayName: players.displayName,
          active: players.active,
          legacyId: players.legacyId,
          createdAt: players.createdAt,
          clubId: players.clubId
        });

      if (result.length === 0) {
        throw createNotFoundError("Player not found");
      }

      return reply.status(200).send({ player: result[0]! });
    }
  );
}
