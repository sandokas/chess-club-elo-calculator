import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { createPool } from "@chess-club/db";

type HttpError = Error & { statusCode?: number };

function asHttpError(error: unknown): HttpError {
  return error instanceof Error ? error : new Error("Unknown server error");
}

export type AppOptions = {
  databasePing?: () => Promise<void>;
};

type ClubParams = {
  clubId: string;
};

type TournamentParams = {
  id: string;
};

type PlayerParams = {
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
    const httpError = asHttpError(error);
    app.log.error(httpError);
    const statusCode = httpError.statusCode && httpError.statusCode >= 400 ? httpError.statusCode : 500;
    return reply.status(statusCode).send({
      error: statusCode === 500 ? "Internal Server Error" : httpError.name,
      message: statusCode === 500 ? "Unexpected server error." : httpError.message
    });
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "chess-club-api"
  }));

  app.get("/health/db", async (_request, reply) => {
    const ping = options.databasePing ?? defaultDatabasePing;
    await ping();
    return reply.send({
      status: "ok",
      database: "reachable"
    });
  });

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

  app.get<{ Params: ClubParams }>("/clubs/:clubId/players", async (request) => {
    const pool = createPool();
    try {
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
          WHERE p.club_id = $1
          ORDER BY pr.elo DESC, p.display_name ASC
        `,
        [request.params.clubId]
      );
      return { players: result.rows };
    } finally {
      await pool.end();
    }
  });

  app.get<{ Params: ClubParams }>("/clubs/:clubId/tournaments", async (request) => {
    const pool = createPool();
    try {
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
          WHERE t.club_id = $1
          GROUP BY t.id
          ORDER BY t.starts_on DESC, t.name ASC
        `,
        [request.params.clubId]
      );
      return { tournaments: result.rows };
    } finally {
      await pool.end();
    }
  });

  app.get<{ Params: ClubParams }>("/clubs/:clubId/leaderboard", async (request) => {
    const pool = createPool();
    try {
      const result = await pool.query(
        `
          SELECT
            p.id,
            p.display_name AS "displayName",
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
          WHERE p.club_id = $1 AND p.active = true
          GROUP BY p.id, pr.player_id
          ORDER BY pr.elo DESC, p.display_name ASC
        `,
        [request.params.clubId]
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
            m.board_number AS "boardNumber"
          FROM matches m
          JOIN players wp ON wp.id = m.white_player_id
          JOIN players bp ON bp.id = m.black_player_id
          WHERE m.tournament_id = $1
          ORDER BY m.board_number ASC NULLS LAST, m.played_on ASC, m.id ASC
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
        return { error: "Player not found" };
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

  return app;
}

async function defaultDatabasePing(): Promise<void> {
  const pool = createPool();
  try {
    await pool.query("select 1");
  } finally {
    await pool.end();
  }
}
