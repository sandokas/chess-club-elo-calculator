import { type FastifyInstance } from "fastify";
import { createPool } from "@chess-club/db";
import {
  parsePaginationParams,
  parseSortParams,
  parseStringFilter,
  parseBooleanFilter,
  parseNumberFilter,
  parseDateFilter
} from "../lib/validators.js";
import { createNotFoundError, createValidationError } from "../lib/errors.js";

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
  const allowedSortColumns = ["displayName", "elo", "glickoRating", "gamesPlayed", "lastGameDate", "active"];
  const sortColumnMap: Record<string, string> = {
    displayName: "p.display_name",
    elo: "pr.elo",
    glickoRating: "pr.glicko_rating",
    gamesPlayed: "pr.games_played",
    lastGameDate: "pr.last_game_date",
    active: "p.active"
  };

  app.post<{ Params: ClubParams; Body: CreatePlayerBody }>(
    "/clubs/:clubId/players",
    async (request, reply) => {
      const pool = createPool();
      try {
        const { displayName } = request.body;

        if (!displayName || displayName.trim() === "") {
          throw createValidationError("displayName is required");
        }

        // Check if player with same name already exists in club
        const existingResult = await pool.query(
          `SELECT id FROM players WHERE club_id = $1 AND display_name = $2`,
          [request.params.clubId, displayName.trim()]
        );

        if (existingResult.rows.length > 0) {
          throw createValidationError("Player with this name already exists in this club");
        }

        const result = await pool.query(
          `
            INSERT INTO players (club_id, display_name, active)
            VALUES ($1, $2, true)
            RETURNING
              id,
              display_name AS "displayName",
              active,
              legacy_id AS "legacyId",
              created_at AS "createdAt",
              club_id AS "clubId"
          `,
          [request.params.clubId, displayName.trim()]
        );

        // Create player ratings record
        await pool.query(
          `
            INSERT INTO player_ratings (player_id, club_id, elo, glicko_rating, glicko_rd, glicko_vol, games_played)
            VALUES ($1, $2, 1200, 1500, 350, 0.06, 0)
          `,
          [result.rows[0].id, request.params.clubId]
        );

        return reply.status(201).send({ player: result.rows[0] });
      } finally {
        await pool.end();
      }
    }
  );

  app.delete<{ Params: ClubPlayerParams }>(
    "/clubs/:clubId/players/:playerId",
    async (request, reply) => {
      const pool = createPool();
      try {
        // Check if player belongs to club
        const playerResult = await pool.query(
          `SELECT id FROM players WHERE id = $1 AND club_id = $2`,
          [request.params.playerId, request.params.clubId]
        );

        if (playerResult.rows.length === 0) {
          throw createNotFoundError("Player not found in this club");
        }

        // Check if player has any matches
        const matchesResult = await pool.query(
          `SELECT id FROM matches WHERE white_player_id = $1 OR black_player_id = $2 LIMIT 1`,
          [request.params.playerId, request.params.playerId]
        );

        if (matchesResult.rows.length > 0) {
          throw createValidationError("Cannot delete player with match history");
        }

        // Delete player ratings
        await pool.query(
          `DELETE FROM player_ratings WHERE player_id = $1`,
          [request.params.playerId]
        );

        // Delete player
        await pool.query(
          `DELETE FROM players WHERE id = $1`,
          [request.params.playerId]
        );

        return reply.status(204).send();
      } finally {
        await pool.end();
      }
    }
  );

  app.get<{ Params: ClubParams; Querystring: PlayersQuerystring }>(
    "/clubs/:clubId/players",
    async (request, reply) => {
      const pool = createPool();
      try {
        const { page, limit } = parsePaginationParams(request.query);
        const { sortBy, sortOrder } = parseSortParams(request.query, allowedSortColumns);

        const filters: string[] = [];
        const params: any[] = [request.params.clubId];
        let paramIndex = 2;

        const name = parseStringFilter(request.query.name);
        if (name) {
          filters.push(`p.display_name LIKE $${paramIndex}`);
          params.push(`%${name}%`);
          paramIndex++;
        }

        const active = parseBooleanFilter(request.query.active);
        if (active !== undefined) {
          filters.push(`p.active = $${paramIndex}`);
          params.push(active);
          paramIndex++;
        }

        const eloMin = parseNumberFilter(request.query.eloMin);
        if (eloMin !== undefined) {
          filters.push(`pr.elo >= $${paramIndex}`);
          params.push(eloMin);
          paramIndex++;
        }

        const eloMax = parseNumberFilter(request.query.eloMax);
        if (eloMax !== undefined) {
          filters.push(`pr.elo <= $${paramIndex}`);
          params.push(eloMax);
          paramIndex++;
        }

        const glickoMin = parseNumberFilter(request.query.glickoMin);
        if (glickoMin !== undefined) {
          filters.push(`pr.glicko_rating >= $${paramIndex}`);
          params.push(glickoMin);
          paramIndex++;
        }

        const glickoMax = parseNumberFilter(request.query.glickoMax);
        if (glickoMax !== undefined) {
          filters.push(`pr.glicko_rating <= $${paramIndex}`);
          params.push(glickoMax);
          paramIndex++;
        }

        const gamesPlayedMin = parseNumberFilter(request.query.gamesPlayedMin);
        if (gamesPlayedMin !== undefined) {
          filters.push(`pr.games_played >= $${paramIndex}`);
          params.push(gamesPlayedMin);
          paramIndex++;
        }

        const gamesPlayedMax = parseNumberFilter(request.query.gamesPlayedMax);
        if (gamesPlayedMax !== undefined) {
          filters.push(`pr.games_played <= $${paramIndex}`);
          params.push(gamesPlayedMax);
          paramIndex++;
        }

        const lastGameDateAfter = parseDateFilter(request.query.lastGameDateAfter);
        if (lastGameDateAfter) {
          filters.push(`pr.last_game_date >= $${paramIndex}`);
          params.push(lastGameDateAfter);
          paramIndex++;
        }

        const lastGameDateBefore = parseDateFilter(request.query.lastGameDateBefore);
        if (lastGameDateBefore) {
          filters.push(`pr.last_game_date <= $${paramIndex}`);
          params.push(lastGameDateBefore);
          paramIndex++;
        }

        const whereClause = filters.length > 0 ? `AND ${filters.join(" AND ")}` : "";
        const dbSortColumn = sortColumnMap[sortBy];

        const countResult = await pool.query(
          `SELECT COUNT(*) AS total FROM players p JOIN player_ratings pr ON pr.player_id = p.id WHERE p.club_id = $1 ${whereClause}`,
          params
        );
        const total = parseInt(countResult.rows[0].total, 10);
        const totalPages = Math.ceil(total / limit);

        if (page > totalPages && totalPages > 0) {
          return reply.status(404).send({
            error: "NotFound",
            message: "Page exceeds total pages"
          });
        }

        const offset = (page - 1) * limit;

        params.push(limit, offset);

        const result = await pool.query(
          `
            SELECT
              p.id,
              p.display_name AS "displayName",
              p.active,
              p.legacy_id AS "legacyId",
              pr.elo,
              pr.glicko_rating AS "glickoRating",
              pr.glicko_rd AS "glickoRd",
              pr.glicko_vol AS "glickoVol",
              pr.games_played AS "gamesPlayed",
              pr.last_game_date AS "lastGameDate"
            FROM players p
            JOIN player_ratings pr ON pr.player_id = p.id
            WHERE p.club_id = $1 ${whereClause}
            ORDER BY ${dbSortColumn} ${sortOrder.toUpperCase()}, p.display_name ASC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
          `,
          params
        );

        return {
          players: result.rows,
          pagination: {
            page,
            limit,
            total,
            totalPages
          }
        };
      } finally {
        await pool.end();
      }
    }
  );

  app.get<{ Params: PlayerParams }>("/players/:id", async (request) => {
    const pool = createPool();
    try {
      const playerResult = await pool.query(
        `
          SELECT
            p.id,
            p.display_name AS "displayName",
            p.active,
            p.legacy_id AS "legacyId",
            p.created_at AS "createdAt",
            p.club_id AS "clubId",
            c.name AS "clubName",
            pr.elo,
            pr.glicko_rating AS "glickoRating",
            pr.glicko_rd AS "glickoRd",
            pr.glicko_vol AS "glickoVol",
            pr.games_played AS "gamesPlayed",
            pr.last_game_date AS "lastGameDate"
          FROM players p
          JOIN clubs c ON c.id = p.club_id
          JOIN player_ratings pr ON pr.player_id = p.id
          WHERE p.id = $1
        `,
        [request.params.id]
      );

      if (playerResult.rows.length === 0) {
        throw createNotFoundError("Player not found");
      }

      const player = playerResult.rows[0];

      const matchesResult = await pool.query(
        `
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
              WHEN m.white_player_id = $1 THEN m.white_elo_before
              ELSE m.black_elo_before
            END AS "eloBefore",
            CASE
              WHEN m.white_player_id = $1 THEN m.white_elo_after
              ELSE m.black_elo_after
            END AS "eloAfter",
            CASE
              WHEN m.white_player_id = $1 THEN m.white_glicko_rating_before
              ELSE m.black_glicko_rating_before
            END AS "glickoRatingBefore",
            CASE
              WHEN m.white_player_id = $1 THEN m.white_glicko_rating_after
              ELSE m.black_glicko_rating_after
            END AS "glickoRatingAfter"
          FROM matches m
          JOIN players wp ON wp.id = m.white_player_id
          JOIN players bp ON bp.id = m.black_player_id
          JOIN tournaments t ON t.id = m.tournament_id
          WHERE (m.white_player_id = $1 OR m.black_player_id = $1)
            AND m.status = 'completed'
            AND m.result IS NOT NULL
          ORDER BY m.played_on DESC, m.id DESC
          LIMIT 20
        `,
        [request.params.id]
      );

      return {
        player,
        matches: matchesResult.rows
      };
    } finally {
      await pool.end();
    }
  });

  app.put<{ Params: PlayerParams; Body: UpdatePlayerBody }>(
    "/players/:id",
    async (request, reply) => {
      const pool = createPool();
      try {
        const { displayName, active } = request.body;

        if (displayName !== undefined && displayName.trim() === "") {
          throw createValidationError("displayName cannot be empty");
        }

        const updates: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (displayName !== undefined) {
          updates.push(`display_name = $${paramIndex}`);
          values.push(displayName.trim());
          paramIndex++;
        }

        if (active !== undefined) {
          updates.push(`active = $${paramIndex}`);
          values.push(active);
          paramIndex++;
        }

        if (updates.length === 0) {
          throw createValidationError("No fields to update");
        }

        updates.push(`updated_at = NOW()`);
        values.push(request.params.id);

        const result = await pool.query(
          `
            UPDATE players
            SET ${updates.join(", ")}
            WHERE id = $${paramIndex}
            RETURNING
              id,
              display_name AS "displayName",
              active,
              legacy_id AS "legacyId",
              created_at AS "createdAt",
              club_id AS "clubId"
          `,
          values
        );

        if (result.rows.length === 0) {
          throw createNotFoundError("Player not found");
        }

        return reply.status(200).send({ player: result.rows[0] });
      } finally {
        await pool.end();
      }
    }
  );
}
