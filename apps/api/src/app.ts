import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { createPool } from "@chess-club/db";
import { registerHealthRoutes, type HealthOptions } from "./routes/health.js";
import { registerPlayerRoutes } from "./routes/players.js";
import { asHttpError, createErrorResponse } from "./lib/errors.js";

export type AppOptions = {
  databasePing?: () => Promise<void>;
};

type ClubParams = {
  clubId: string;
};

type TournamentParams = {
  id: string;
};

export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true
  });

  await app.register(cors, {
    origin: true,
    credentials: true
  });

  app.setErrorHandler((error, _request, reply) => {
    const { statusCode, body } = createErrorResponse(error);
    app.log.error(error);
    return reply.status(statusCode).send(body);
  });

  await registerHealthRoutes(app, {
    databasePing: options.databasePing
  });

  await registerPlayerRoutes(app);

  app.get("/clubs", async () => {
    const pool = createPool();
    try {
      const result = await pool.query(`
        SELECT id, name, slug, description, city, country, created_at AS "createdAt", updated_at AS "updatedAt"
        FROM clubs
        ORDER BY name
      `);
      return { clubs: result.rows };
    } finally {
      await pool.end();
    }
  });

  app.get<{ Params: ClubParams; Querystring: { page?: string; limit?: string; sortBy?: string; sortOrder?: string; name?: string; status?: string } }>("/clubs/:clubId/tournaments", async (request) => {
    const pool = createPool();
    try {
      const page = Math.max(1, parseInt(request.query.page || '1', 10));
      const limit = [10, 20, 50].includes(parseInt(request.query.limit || '20', 10)) ? parseInt(request.query.limit || '20', 10) : 20;
      const allowedSortColumns = ['name', 'startsOn', 'status', 'playerCount', 'matchCount'];
      const sortBy = allowedSortColumns.includes(request.query.sortBy || 'startsOn') ? request.query.sortBy || 'startsOn' : 'startsOn';
      const sortOrder = (request.query.sortOrder === 'asc' || request.query.sortOrder === 'desc') ? request.query.sortOrder : 'desc';

      const filters: string[] = [];
      const params: any[] = [request.params.clubId];
      let paramIndex = 2;

      if (request.query.name) {
        filters.push(`t.name LIKE $${paramIndex}`);
        params.push(`%${request.query.name}%`);
        paramIndex++;
      }

      if (request.query.status) {
        const validStatuses = ['draft', 'active', 'completed'];
        if (validStatuses.includes(request.query.status)) {
          filters.push(`t.status = $${paramIndex}`);
          params.push(request.query.status);
          paramIndex++;
        }
      }

      const whereClause = filters.length > 0 ? `AND ${filters.join(' AND ')}` : '';

      const sortColumnMap: Record<string, string> = {
        name: 't.name',
        startsOn: 't.starts_on',
        status: 't.status',
        playerCount: 'player_count',
        matchCount: 'match_count'
      };
      const dbSortColumn = sortColumnMap[sortBy];

      const countResult = await pool.query(
        `SELECT COUNT(*) AS total FROM tournaments t WHERE t.club_id = $1 ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].total, 10);
      const totalPages = Math.ceil(total / limit);
      const offset = (page - 1) * limit;

      params.push(limit, offset);

      const result = await pool.query(
        `
          SELECT
            t.id,
            t.name,
            t.starts_on AS "startsOn",
            t.format,
            t.status,
            t.legacy_id AS "legacyId",
            COUNT(DISTINCT tp.player_id)::int AS "playerCount",
            COUNT(DISTINCT m.id)::int AS "matchCount"
          FROM tournaments t
          LEFT JOIN tournament_players tp ON tp.tournament_id = t.id
          LEFT JOIN matches m ON m.tournament_id = t.id
          WHERE t.club_id = $1 ${whereClause}
          GROUP BY t.id
          ORDER BY ${dbSortColumn} ${sortOrder.toUpperCase()}, t.name ASC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `,
        params
      );

      return {
        tournaments: result.rows,
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
  });

  app.get<{ Params: ClubParams; Querystring: { activeOnly?: string; limit?: string } }>("/clubs/:clubId/leaderboard", async (request) => {
    const pool = createPool();
    try {
      const activeOnly = request.query.activeOnly !== 'false';
      const limit = Math.min(parseInt(request.query.limit || '10', 10), 100);
      const result = await pool.query(
        `
          SELECT
            p.id,
            p.display_name AS "displayName",
            p.active,
            pr.elo,
            pr.glicko_rating AS "glickoRating",
            pr.games_played AS "gamesPlayed",
            pr.last_game_date AS "lastGameDate",
            COUNT(m.id)::int AS "completedMatches",
            COUNT(CASE WHEN (m.white_player_id = p.id AND m.result = 1) OR (m.black_player_id = p.id AND m.result = 0) THEN 1 END)::int AS wins,
            COUNT(CASE WHEN m.result = 0.5 THEN 1 END)::int AS draws,
            COUNT(CASE WHEN (m.white_player_id = p.id AND m.result = 0) OR (m.black_player_id = p.id AND m.result = 1) THEN 1 END)::int AS losses
          FROM players p
          JOIN player_ratings pr ON pr.player_id = p.id
          LEFT JOIN matches m
            ON m.club_id = p.club_id
           AND m.status = 'completed'
           AND m.result IS NOT NULL
           AND (m.white_player_id = p.id OR m.black_player_id = p.id)
          WHERE p.club_id = $1 ${activeOnly ? 'AND p.active = true' : ''}
          GROUP BY p.id, pr.player_id
          ORDER BY pr.elo DESC, p.display_name ASC
          LIMIT $2
        `,
        [request.params.clubId, limit]
      );
      return { leaderboard: result.rows };
    } finally {
      await pool.end();
    }
  });

  app.get<{ Params: TournamentParams }>("/tournaments/:id", async (request) => {
    const pool = createPool();
    try {
      const tournamentResult = await pool.query(
        `
          SELECT
            t.id,
            t.name,
            t.starts_on AS "startsOn",
            t.format,
            t.status,
            t.legacy_id AS "legacyId",
            COUNT(DISTINCT tp.player_id)::int AS "playerCount",
            COUNT(DISTINCT m.id)::int AS "matchCount"
          FROM tournaments t
          LEFT JOIN tournament_players tp ON tp.tournament_id = t.id
          LEFT JOIN matches m ON m.tournament_id = t.id
          WHERE t.id = $1
          GROUP BY t.id
        `,
        [request.params.id]
      );

      if (tournamentResult.rows.length === 0) {
        return { error: "Tournament not found" };
      }

      const tournament = tournamentResult.rows[0];

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
            m.board_number AS "boardNumber",
            r.number AS "roundNumber"
          FROM matches m
          JOIN players wp ON wp.id = m.white_player_id
          JOIN players bp ON bp.id = m.black_player_id
          LEFT JOIN rounds r ON r.id = m.round_id
          WHERE m.tournament_id = $1
          ORDER BY r.number ASC NULLS LAST, m.board_number ASC NULLS LAST, m.played_on ASC, m.id ASC
        `,
        [request.params.id]
      );

      const standingsResult = await pool.query(
        `
          SELECT
            p.id AS "playerId",
            p.display_name AS "playerName",
            COUNT(CASE WHEN (m.white_player_id = p.id AND m.result = 1) OR (m.black_player_id = p.id AND m.result = 0) THEN 1 END)::int AS wins,
            COUNT(CASE WHEN m.result = 0.5 THEN 1 END)::int AS draws,
            COUNT(CASE WHEN (m.white_player_id = p.id AND m.result = 0) OR (m.black_player_id = p.id AND m.result = 1) THEN 1 END)::int AS losses,
            COALESCE(SUM(
              CASE
                WHEN m.white_player_id = p.id THEN m.result
                WHEN m.black_player_id = p.id THEN 1 - m.result
                ELSE 0
              END
            ), 0)::float AS points
          FROM tournament_players tp
          JOIN players p ON p.id = tp.player_id
          LEFT JOIN matches m ON m.tournament_id = tp.tournament_id AND (m.white_player_id = p.id OR m.black_player_id = p.id)
          WHERE tp.tournament_id = $1
          GROUP BY p.id
          ORDER BY points DESC, wins DESC
        `,
        [request.params.id]
      );

      return {
        tournament,
        matches: matchesResult.rows,
        standings: standingsResult.rows
      };
    } finally {
      await pool.end();
    }
  });

  app.put<{ Params: TournamentParams; Body: { name?: string; startsOn?: string; status?: string } }>("/tournaments/:id", async (request, reply) => {
    const pool = createPool();
    try {
      const { name, startsOn, status } = request.body;

      const validStatuses = ["draft", "active", "completed"];
      if (status !== undefined && !validStatuses.includes(status)) {
        return reply.status(400).send({
          error: "ValidationError",
          message: `status must be one of: ${validStatuses.join(", ")}`
        });
      }

      if (name !== undefined && name.trim() === "") {
        return reply.status(400).send({
          error: "ValidationError",
          message: "name cannot be empty"
        });
      }

      if (startsOn !== undefined && isNaN(Date.parse(startsOn))) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "startsOn must be a valid date"
        });
      }

      const currentResult = await pool.query(
        `SELECT id, status, name, starts_on FROM tournaments WHERE id = $1`,
        [request.params.id]
      );

      if (currentResult.rows.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Tournament not found"
        });
      }

      const current = currentResult.rows[0];

      if (current.status === "completed" && (name !== undefined || startsOn !== undefined)) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Cannot edit name or startsOn when tournament is completed. Revert status to active first."
        });
      }

      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (name !== undefined) {
        updates.push(`name = $${paramIndex}`);
        values.push(name.trim());
        paramIndex++;
      }

      if (startsOn !== undefined) {
        updates.push(`starts_on = $${paramIndex}`);
        values.push(startsOn);
        paramIndex++;
      }

      if (status !== undefined) {
        updates.push(`status = $${paramIndex}`);
        values.push(status);
        paramIndex++;
      }

      if (updates.length === 0) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "No fields to update"
        });
      }

      updates.push(`updated_at = NOW()`);
      values.push(request.params.id);

      const result = await pool.query(
        `
          UPDATE tournaments
          SET ${updates.join(", ")}
          WHERE id = $${paramIndex}
          RETURNING
            id,
            name,
            starts_on AS "startsOn",
            format,
            status,
            legacy_id AS "legacyId",
            created_at AS "createdAt",
            club_id AS "clubId"
        `,
        values
      );

      return reply.status(200).send({ tournament: result.rows[0] });
    } finally {
      await pool.end();
    }
  });

  return app;
}
