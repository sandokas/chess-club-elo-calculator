import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { createPool } from "@chess-club/db";
import { registerHealthRoutes, type HealthOptions } from "./routes/health.js";
import { registerPlayerRoutes } from "./routes/players.js";
import { asHttpError, createErrorResponse } from "./lib/errors.js";
import { generateSwissPairings } from "./lib/swiss-pairing.js";

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

  app.post<{ Params: ClubParams; Body: { name: string; startsOn?: string; format?: string; totalRounds?: number; pairingMethod?: string } }>("/clubs/:clubId/tournaments", async (request, reply) => {
    const pool = createPool();
    try {
      const { name, startsOn, format, totalRounds, pairingMethod } = request.body;

      if (!name || name.trim() === "") {
        return reply.status(400).send({
          error: "ValidationError",
          message: "name is required"
        });
      }

      const validFormats = ["manual", "swiss"];
      if (format && !validFormats.includes(format)) {
        return reply.status(400).send({
          error: "ValidationError",
          message: `format must be one of: ${validFormats.join(", ")}`
        });
      }

      const validPairingMethods = ["seeded_by_rating", "random"];
      if (pairingMethod && !validPairingMethods.includes(pairingMethod)) {
        return reply.status(400).send({
          error: "ValidationError",
          message: `pairingMethod must be one of: ${validPairingMethods.join(", ")}`
        });
      }

      if (totalRounds !== undefined && (totalRounds < 1 || totalRounds > 50)) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "totalRounds must be between 1 and 50"
        });
      }

      const result = await pool.query(
        `
          INSERT INTO tournaments (club_id, name, starts_on, format, total_rounds, pairing_method, status)
          VALUES ($1, $2, $3, $4, $5, $6, 'draft')
          RETURNING
            id,
            name,
            starts_on AS "startsOn",
            format,
            status,
            total_rounds AS "totalRounds",
            pairing_method AS "pairingMethod",
            legacy_id AS "legacyId",
            created_at AS "createdAt",
            club_id AS "clubId"
        `,
        [
          request.params.clubId,
          name.trim(),
          startsOn || null,
          format || "manual",
          totalRounds || null,
          pairingMethod || "seeded_by_rating"
        ]
      );

      return reply.status(201).send({ tournament: result.rows[0] });
    } finally {
      await pool.end();
    }
  });

  app.delete<{ Params: TournamentParams }>("/tournaments/:id", async (request, reply) => {
    const pool = createPool();
    try {
      const currentResult = await pool.query(
        `SELECT id, status FROM tournaments WHERE id = $1`,
        [request.params.id]
      );

      if (currentResult.rows.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Tournament not found"
        });
      }

      const current = currentResult.rows[0];

      if (current.status !== "draft") {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Can only delete tournaments in draft status"
        });
      }

      await pool.query(
        `DELETE FROM tournaments WHERE id = $1`,
        [request.params.id]
      );

      return reply.status(204).send();
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
            t.pairing_method AS "pairingMethod",
            t.total_rounds AS "totalRounds",
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

  app.put<{ Params: TournamentParams; Body: { name?: string; startsOn?: string; status?: string; totalRounds?: number; pairingMethod?: string } }>("/tournaments/:id", async (request, reply) => {
    const pool = createPool();
    try {
      const { name, startsOn, status, totalRounds, pairingMethod } = request.body;

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

      const validPairingMethods = ["seeded_by_rating", "random"];
      if (pairingMethod !== undefined && !validPairingMethods.includes(pairingMethod)) {
        return reply.status(400).send({
          error: "ValidationError",
          message: `pairingMethod must be one of: ${validPairingMethods.join(", ")}`
        });
      }

      if (totalRounds !== undefined && (totalRounds < 1 || totalRounds > 50)) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "totalRounds must be between 1 and 50"
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

      if (totalRounds !== undefined) {
        updates.push(`total_rounds = $${paramIndex}`);
        values.push(totalRounds);
        paramIndex++;
      }

      if (pairingMethod !== undefined) {
        updates.push(`pairing_method = $${paramIndex}`);
        values.push(pairingMethod);
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
            total_rounds AS "totalRounds",
            pairing_method AS "pairingMethod",
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

  // Roster management endpoints
  app.post<{ Params: TournamentParams; Body: { playerId: string } }>("/tournaments/:id/players", async (request, reply) => {
    const pool = createPool();
    try {
      const { playerId } = request.body;

      // Check tournament exists and is in draft status
      const tournamentResult = await pool.query(
        `SELECT id, status, club_id FROM tournaments WHERE id = $1`,
        [request.params.id]
      );

      if (tournamentResult.rows.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Tournament not found"
        });
      }

      const tournament = tournamentResult.rows[0];

      if (tournament.status !== "draft") {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Can only add players to tournaments in draft status"
        });
      }

      // Check player exists and belongs to the same club
      const playerResult = await pool.query(
        `SELECT id, club_id FROM players WHERE id = $1`,
        [playerId]
      );

      if (playerResult.rows.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Player not found"
        });
      }

      const player = playerResult.rows[0];

      if (player.club_id !== tournament.club_id) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Player belongs to a different club"
        });
      }

      // Check if player is already in tournament
      const existingResult = await pool.query(
        `SELECT player_id FROM tournament_players WHERE tournament_id = $1 AND player_id = $2`,
        [request.params.id, playerId]
      );

      if (existingResult.rows.length > 0) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Player already in tournament"
        });
      }

      // Add player to tournament
      const result = await pool.query(
        `
          INSERT INTO tournament_players (tournament_id, player_id, white_count, black_count)
          VALUES ($1, $2, 0, 0)
          RETURNING tournament_id AS "tournamentId", player_id AS "playerId"
        `,
        [request.params.id, playerId]
      );

      return reply.status(201).send({ tournamentPlayer: result.rows[0] });
    } finally {
      await pool.end();
    }
  });

  app.post<{ Params: TournamentParams; Body: { displayName: string } }>("/tournaments/:id/players/new", async (request, reply) => {
    const pool = createPool();
    try {
      const { displayName } = request.body;

      if (!displayName || displayName.trim() === "") {
        return reply.status(400).send({
          error: "ValidationError",
          message: "displayName is required"
        });
      }

      // Get tournament details
      const tournamentResult = await pool.query(
        `SELECT id, status, club_id FROM tournaments WHERE id = $1`,
        [request.params.id]
      );

      if (tournamentResult.rows.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Tournament not found"
        });
      }

      const tournament = tournamentResult.rows[0];

      if (tournament.status !== "draft") {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Can only add players to tournaments in draft status"
        });
      }

      // Create player
      const playerResult = await pool.query(
        `
          INSERT INTO players (club_id, display_name, active)
          VALUES ($1, $2, true)
          RETURNING id
        `,
        [tournament.club_id, displayName.trim()]
      );

      const playerId = playerResult.rows[0].id;

      // Create player ratings
      await pool.query(
        `
          INSERT INTO player_ratings (player_id, club_id, elo, glicko_rating, glicko_rd, glicko_vol, games_played)
          VALUES ($1, $2, 1200, 1500, 350, 0.06, 0)
        `,
        [playerId, tournament.club_id]
      );

      // Add to tournament
      const tournamentPlayerResult = await pool.query(
        `
          INSERT INTO tournament_players (tournament_id, player_id, white_count, black_count)
          VALUES ($1, $2, 0, 0)
          RETURNING tournament_id AS "tournamentId", player_id AS "playerId"
        `,
        [request.params.id, playerId]
      );

      return reply.status(201).send({ tournamentPlayer: tournamentPlayerResult.rows[0] });
    } finally {
      await pool.end();
    }
  });

  app.delete<{ Params: TournamentParams & { playerId: string } }>("/tournaments/:id/players/:playerId", async (request, reply) => {
    const pool = createPool();
    try {
      // Check tournament exists and is in draft status
      const tournamentResult = await pool.query(
        `SELECT id, status FROM tournaments WHERE id = $1`,
        [request.params.id]
      );

      if (tournamentResult.rows.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Tournament not found"
        });
      }

      const tournament = tournamentResult.rows[0];

      if (tournament.status !== "draft") {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Can only remove players from tournaments in draft status"
        });
      }

      // Remove player from tournament
      await pool.query(
        `DELETE FROM tournament_players WHERE tournament_id = $1 AND player_id = $2`,
        [request.params.id, request.params.playerId]
      );

      return reply.status(204).send();
    } finally {
      await pool.end();
    }
  });

  app.put<{ Params: TournamentParams & { playerId: string }; Body: { droppedOutRound: number } }>("/tournaments/:id/players/:playerId/dropout", async (request, reply) => {
    const pool = createPool();
    try {
      const { droppedOutRound } = request.body;

      // Check tournament exists and is active
      const tournamentResult = await pool.query(
        `SELECT id, status FROM tournaments WHERE id = $1`,
        [request.params.id]
      );

      if (tournamentResult.rows.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Tournament not found"
        });
      }

      const tournament = tournamentResult.rows[0];

      if (tournament.status !== "active") {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Can only mark dropout for active tournaments"
        });
      }

      // Update player dropout round
      const result = await pool.query(
        `
          UPDATE tournament_players
          SET dropped_out_round = $1
          WHERE tournament_id = $2 AND player_id = $3
          RETURNING tournament_id AS "tournamentId", player_id AS "playerId", dropped_out_round AS "droppedOutRound"
        `,
        [droppedOutRound, request.params.id, request.params.playerId]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Player not found in tournament"
        });
      }

      return reply.status(200).send({ tournamentPlayer: result.rows[0] });
    } finally {
      await pool.end();
    }
  });

  app.get<{ Params: TournamentParams }>("/tournaments/:id/players", async (request, reply) => {
    const pool = createPool();
    try {
      const result = await pool.query(
        `
          SELECT
            tp.player_id AS "playerId",
            p.display_name AS "displayName",
            tp.seed,
            tp.dropped_out_round AS "droppedOutRound",
            tp.white_count AS "whiteCount",
            tp.black_count AS "blackCount",
            COALESCE(SUM(CASE WHEN m.result = 1 THEN 1 WHEN m.result = 0.5 THEN 0.5 WHEN m.result = 0 THEN 0 END), 0) AS points,
            COUNT(DISTINCT m.id)::int AS "matchesPlayed"
          FROM tournament_players tp
          JOIN players p ON p.id = tp.player_id
          LEFT JOIN matches m ON (m.white_player_id = tp.player_id OR m.black_player_id = tp.player_id)
            AND m.tournament_id = tp.tournament_id
            AND m.status = 'completed'
          WHERE tp.tournament_id = $1
          GROUP BY tp.player_id, p.display_name, tp.seed, tp.dropped_out_round, tp.white_count, tp.black_count
          ORDER BY points DESC, p.display_name ASC
        `,
        [request.params.id]
      );

      return { players: result.rows };
    } finally {
      await pool.end();
    }
  });

  // Round management endpoints
  app.post<{ Params: TournamentParams }>("/tournaments/:id/rounds", async (request, reply) => {
    const pool = createPool();
    try {
      // Get tournament details
      const tournamentResult = await pool.query(
        `SELECT id, status, format, club_id, pairing_method FROM tournaments WHERE id = $1`,
        [request.params.id]
      );

      if (tournamentResult.rows.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Tournament not found"
        });
      }

      const tournament = tournamentResult.rows[0];

      if (tournament.status !== "active") {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Can only generate rounds for active tournaments"
        });
      }

      if (tournament.format !== "swiss") {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Round generation only supported for Swiss tournaments"
        });
      }

      // Get the last round number
      const lastRoundResult = await pool.query(
        `SELECT MAX(number) AS max_round FROM rounds WHERE tournament_id = $1`,
        [request.params.id]
      );

      const nextRoundNumber = (lastRoundResult.rows[0].max_round || 0) + 1;

      // Check if there's an incomplete round
      const incompleteRoundResult = await pool.query(
        `SELECT id FROM rounds WHERE tournament_id = $1 AND status != 'completed'`,
        [request.params.id]
      );

      if (incompleteRoundResult.rows.length > 0) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Cannot generate new round while previous round is incomplete"
        });
      }

      // Generate Swiss pairings
      const pairings = await generateSwissPairings(pool, request.params.id, nextRoundNumber, {
        pairingMethod: tournament.pairing_method || "seeded_by_rating",
        roundNumber: nextRoundNumber
      });

      if (pairings.length === 0) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Unable to generate pairings - not enough players or all players dropped out"
        });
      }

      // Create round
      const roundResult = await pool.query(
        `
          INSERT INTO rounds (tournament_id, number, status)
          VALUES ($1, $2, 'scheduled')
          RETURNING id
        `,
        [request.params.id, nextRoundNumber]
      );

      const roundId = roundResult.rows[0].id;

      // Create matches
      for (const pairing of pairings) {
        await pool.query(
          `
            INSERT INTO matches (club_id, tournament_id, round_id, white_player_id, black_player_id, board_number, status, played_on)
            VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', NOW()::date)
          `,
          [tournament.club_id, request.params.id, roundId, pairing.whitePlayerId, pairing.blackPlayerId, pairing.boardNumber]
        );

        // Update color counts
        await pool.query(
          `
            UPDATE tournament_players
            SET white_count = white_count + 1
            WHERE tournament_id = $1 AND player_id = $2
          `,
          [request.params.id, pairing.whitePlayerId]
        );

        await pool.query(
          `
            UPDATE tournament_players
            SET black_count = black_count + 1
            WHERE tournament_id = $1 AND player_id = $2
          `,
          [request.params.id, pairing.blackPlayerId]
        );
      }

      return reply.status(201).send({
        round: {
          id: roundId,
          number: nextRoundNumber,
          matches: pairings
        }
      });
    } finally {
      await pool.end();
    }
  });

  app.put<{ Params: { id: string }; Body: { startsOn: string } }>("/rounds/:id/starts-on", async (request, reply) => {
    const pool = createPool();
    try {
      const { startsOn } = request.body;

      if (!startsOn || isNaN(Date.parse(startsOn))) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "startsOn must be a valid date"
        });
      }

      const result = await pool.query(
        `
          UPDATE rounds
          SET starts_on = $1
          WHERE id = $2
          RETURNING id, number, starts_on AS "startsOn", status
        `,
        [startsOn, request.params.id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Round not found"
        });
      }

      return reply.status(200).send({ round: result.rows[0] });
    } finally {
      await pool.end();
    }
  });

  app.put<{ Params: { id: string }; Body: { status: string } }>("/rounds/:id/status", async (request, reply) => {
    const pool = createPool();
    try {
      const { status } = request.body;

      const validStatuses = ["scheduled", "active", "completed"];
      if (!validStatuses.includes(status)) {
        return reply.status(400).send({
          error: "ValidationError",
          message: `status must be one of: ${validStatuses.join(", ")}`
        });
      }

      const result = await pool.query(
        `
          UPDATE rounds
          SET status = $1, updated_at = NOW()
          WHERE id = $2
          RETURNING id, number, status
        `,
        [status, request.params.id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Round not found"
        });
      }

      return reply.status(200).send({ round: result.rows[0] });
    } finally {
      await pool.end();
    }
  });

  app.get<{ Params: TournamentParams }>("/tournaments/:id/rounds", async (request, reply) => {
    const pool = createPool();
    try {
      const result = await pool.query(
        `
          SELECT
            r.id,
            r.number,
            r.status,
            r.starts_on AS "startsOn",
            r.created_at AS "createdAt",
            COUNT(m.id)::int AS "matchCount"
          FROM rounds r
          LEFT JOIN matches m ON m.round_id = r.id
          WHERE r.tournament_id = $1
          GROUP BY r.id
          ORDER BY r.number ASC
        `,
        [request.params.id]
      );

      return { rounds: result.rows };
    } finally {
      await pool.end();
    }
  });

  // Match result endpoints
  app.put<{ Params: { id: string }; Body: { result: number } }>("/matches/:id/result", async (request, reply) => {
    const pool = createPool();
    try {
      const { result } = request.body;

      if (result !== 1 && result !== 0.5 && result !== 0) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "result must be 1 (white wins), 0.5 (draw), or 0 (black wins)"
        });
      }

      // Get match details
      const matchResult = await pool.query(
        `SELECT id, tournament_id, white_player_id, black_player_id, club_id, status FROM matches WHERE id = $1`,
        [request.params.id]
      );

      if (matchResult.rows.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Match not found"
        });
      }

      const match = matchResult.rows[0];

      if (match.status === "completed") {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Match already completed"
        });
      }

      // Update match result
      const updatedMatchResult = await pool.query(
        `
          UPDATE matches
          SET result = $1, status = 'completed', updated_at = NOW()
          WHERE id = $2
          RETURNING id, result, status
        `,
        [result, request.params.id]
      );

      return reply.status(200).send({ match: updatedMatchResult.rows[0] });
    } finally {
      await pool.end();
    }
  });

  app.get<{ Params: { id: string } }>("/rounds/:id/matches", async (request, reply) => {
    const pool = createPool();
    try {
      const result = await pool.query(
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
            m.status
          FROM matches m
          JOIN players wp ON wp.id = m.white_player_id
          JOIN players bp ON bp.id = m.black_player_id
          WHERE m.round_id = $1
          ORDER BY m.board_number ASC
        `,
        [request.params.id]
      );

      return { matches: result.rows };
    } finally {
      await pool.end();
    }
  });

  // Standings endpoint with Swiss tiebreakers
  app.get<{ Params: TournamentParams }>("/tournaments/:id/standings", async (request, reply) => {
    const pool = createPool();
    try {
      const result = await pool.query(
        `
          SELECT
            tp.player_id AS "playerId",
            p.display_name AS "displayName",
            COALESCE(SUM(
              CASE
                WHEN m.white_player_id = tp.player_id THEN m.result
                WHEN m.black_player_id = tp.player_id THEN 1 - m.result
                ELSE 0
              END
            ), 0)::float AS points,
            COUNT(CASE WHEN (m.white_player_id = tp.player_id AND m.result = 1) OR (m.black_player_id = tp.player_id AND m.result = 0) THEN 1 END)::int AS wins,
            COUNT(CASE WHEN m.result = 0.5 THEN 1 END)::int AS draws,
            COUNT(CASE WHEN (m.white_player_id = tp.player_id AND m.result = 0) OR (m.black_player_id = tp.player_id AND m.result = 1) THEN 1 END)::int AS losses,
            pr.elo,
            tp.dropped_out_round AS "droppedOutRound"
          FROM tournament_players tp
          JOIN players p ON p.id = tp.player_id
          JOIN player_ratings pr ON pr.player_id = tp.player_id
          LEFT JOIN matches m ON m.tournament_id = tp.tournament_id
            AND (m.white_player_id = tp.player_id OR m.black_player_id = tp.player_id)
            AND m.status = 'completed'
          WHERE tp.tournament_id = $1
          GROUP BY tp.player_id, p.display_name, pr.elo, tp.dropped_out_round
          ORDER BY points DESC, wins DESC, pr.elo DESC
        `,
        [request.params.id]
      );

      // Calculate tiebreakers (Buchholz, Sonneborn-Berger)
      const standings = result.rows.map((row) => ({
        ...row,
        buchholz: 0,
        sonnebornBerger: 0
      }));

      for (const standing of standings) {
        const opponentsResult = await pool.query(
          `
            SELECT
              CASE WHEN m.white_player_id = $1 THEN m.black_player_id ELSE m.white_player_id END AS "opponentId",
              m.result,
              (SELECT COALESCE(SUM(CASE WHEN m2.result = 1 THEN 1 WHEN m2.result = 0.5 THEN 0.5 WHEN m2.result = 0 THEN 0 END), 0)
               FROM matches m2
               WHERE (m2.white_player_id = CASE WHEN m.white_player_id = $1 THEN m.black_player_id ELSE m.white_player_id END
                      OR m2.black_player_id = CASE WHEN m.white_player_id = $1 THEN m.black_player_id ELSE m.white_player_id END)
                 AND m2.tournament_id = $2
                 AND m2.status = 'completed') AS "opponentPoints"
            FROM matches m
            WHERE (m.white_player_id = $1 OR m.black_player_id = $1)
              AND m.tournament_id = $2
              AND m.status = 'completed'
          `,
          [standing.playerId, request.params.id]
        );

        let buchholz = 0;
        let sonnebornBerger = 0;

        for (const row of opponentsResult.rows) {
          buchholz += parseFloat(row.opponentPoints) || 0;

          if (row.result === 1) {
            sonnebornBerger += parseFloat(row.opponentPoints) || 0;
          } else if (row.result === 0.5) {
            sonnebornBerger += (parseFloat(row.opponentPoints) || 0) / 2;
          }
        }

        standing.buchholz = buchholz;
        standing.sonnebornBerger = sonnebornBerger;
      }

      // Sort by points, then Buchholz, then Sonneborn-Berger, then ELO
      standings.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
        if (b.sonnebornBerger !== a.sonnebornBerger) return b.sonnebornBerger - a.sonnebornBerger;
        return b.elo - a.elo;
      });

      return { standings };
    } finally {
      await pool.end();
    }
  });

  return app;
}
