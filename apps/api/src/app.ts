import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { createPool } from "@chess-club/db";
import { ratingConfig } from "@chess-club/config";
import { registerHealthRoutes, type HealthOptions } from "./routes/health.js";
import { registerPlayerRoutes } from "./routes/players.js";
import { asHttpError, createErrorResponse } from "./lib/errors.js";
import { generateSwissPairings } from "./lib/swiss-pairing.js";
import { recomputeRatings, applyRatedMatch, type MatchInput, type RatingProfile } from "./lib/ratings/ratings.js";

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

  app.post<{ Body: { name: string; description?: string; city?: string; country?: string } }>("/clubs", async (request, reply) => {
    const pool = createPool();
    try {
      const { name, description, city, country } = request.body;

      if (!name || name.trim() === "") {
        return reply.status(400).send({
          error: "ValidationError",
          message: "name is required"
        });
      }

      const trimmedName = name.trim();
      const slug = trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

      if (slug === "") {
        return reply.status(400).send({
          error: "ValidationError",
          message: "name must contain valid characters"
        });
      }

      // Check if slug already exists
      const existingClub = await pool.query(
        `SELECT id FROM clubs WHERE slug = $1`,
        [slug]
      );

      if (existingClub.rows.length > 0) {
        return reply.status(409).send({
          error: "ConflictError",
          message: "A club with this slug already exists"
        });
      }

      const result = await pool.query(
        `
          INSERT INTO clubs (name, slug, description, city, country)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, name, slug, description, city, country, created_at AS "createdAt", updated_at AS "updatedAt"
        `,
        [
          trimmedName,
          slug,
          description?.trim() || null,
          city?.trim() || null,
          country?.trim() || null
        ]
      );

      return reply.status(201).send({ club: result.rows[0] });
    } finally {
      await pool.end();
    }
  });

  app.patch<{ Params: ClubParams; Body: { name?: string; description?: string; city?: string; country?: string } }>("/clubs/:clubId", async (request, reply) => {
    const pool = createPool();
    try {
      const { name, description, city, country } = request.body;

      if (name !== undefined && name.trim() === "") {
        return reply.status(400).send({
          error: "ValidationError",
          message: "name cannot be empty"
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

      if (description !== undefined) {
        updates.push(`description = $${paramIndex}`);
        values.push(description.trim() || null);
        paramIndex++;
      }

      if (city !== undefined) {
        updates.push(`city = $${paramIndex}`);
        values.push(city.trim() || null);
        paramIndex++;
      }

      if (country !== undefined) {
        updates.push(`country = $${paramIndex}`);
        values.push(country.trim() || null);
        paramIndex++;
      }

      if (updates.length === 0) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "No fields to update"
        });
      }

      updates.push(`updated_at = NOW()`);
      values.push(request.params.clubId);

      const result = await pool.query(
        `
          UPDATE clubs
          SET ${updates.join(", ")}
          WHERE id = $${paramIndex}
          RETURNING
            id,
            name,
            slug,
            description,
            city,
            country,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        `,
        values
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Club not found"
        });
      }

      return reply.status(200).send({ club: result.rows[0] });
    } finally {
      await pool.end();
    }
  });

  app.delete<{ Params: ClubParams }>("/clubs/:clubId", async (request, reply) => {
    const pool = createPool();
    try {
      // Verify club exists
      const clubResult = await pool.query(
        `SELECT id, name FROM clubs WHERE id = $1`,
        [request.params.clubId]
      );

      if (clubResult.rows.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Club not found"
        });
      }

      // Delete club - cascade handles all related data
      await pool.query(
        `DELETE FROM clubs WHERE id = $1`,
        [request.params.clubId]
      );

      return reply.status(204).send();
    } finally {
      await pool.end();
    }
  });

  app.post<{ Params: ClubParams }>("/clubs/:clubId/ratings/recompute", async (request, reply) => {
    const pool = createPool();
    try {
      // Fetch all players for the club
      const playersResult = await pool.query(
        `SELECT id FROM players WHERE club_id = $1`,
        [request.params.clubId]
      );

      if (playersResult.rows.length === 0) {
        return reply.status(200).send({
          message: "No players found in club",
          playersUpdated: 0
        });
      }

      const playerIds = playersResult.rows.map(row => row.id);

      // Fetch all completed real matches for the club (exclude byes)
      const matchesResult = await pool.query(
        `
          SELECT
            m.id,
            m.white_player_id AS "whitePlayerId",
            m.black_player_id AS "blackPlayerId",
            m.result,
            m.played_on AS "playedOn"
          FROM matches m
          WHERE m.club_id = $1
            AND m.result IS NOT NULL
            AND m.black_player_id IS NOT NULL
          ORDER BY m.played_on ASC, m.id ASC
        `,
        [request.params.clubId]
      );

      if (matchesResult.rows.length === 0) {
        return reply.status(200).send({
          message: "No completed matches found in club",
          playersUpdated: 0
        });
      }

      const matches: MatchInput[] = matchesResult.rows.map(row => ({
        id: row.id,
        whitePlayerId: row.whitePlayerId,
        blackPlayerId: row.blackPlayerId,
        result: row.result,
        date: row.playedOn
      }));

      // Recompute ratings using the core library
      const { profiles, audits } = recomputeRatings(playerIds, matches);

      // Update player ratings in the database
      let updatedCount = 0;
      for (const [playerId, profile] of profiles.entries()) {
        await pool.query(
          `
            UPDATE player_ratings
            SET
              elo = $1,
              glicko_rating = $2,
              glicko_rd = $3,
              glicko_vol = $4,
              games_played = $5,
              last_game_date = $6,
              updated_at = NOW()
            WHERE player_id = $7
          `,
          [
            profile.elo,
            profile.glicko.rating,
            profile.glicko.rd,
            profile.glicko.vol,
            profile.gamesPlayed,
            profile.lastGameDate,
            playerId
          ]
        );
        updatedCount++;
      }

      // Update match rating audits
      for (const audit of audits) {
        await pool.query(
          `
            UPDATE matches
            SET
              white_elo_before = $1,
              white_elo_after = $2,
              black_elo_before = $3,
              black_elo_after = $4,
              white_glicko_rating_before = $5,
              white_glicko_rating_after = $6,
              white_glicko_rd_before = $7,
              white_glicko_rd_after = $8,
              white_glicko_vol_before = $9,
              white_glicko_vol_after = $10,
              black_glicko_rating_before = $11,
              black_glicko_rating_after = $12,
              black_glicko_rd_before = $13,
              black_glicko_rd_after = $14,
              black_glicko_vol_before = $15,
              black_glicko_vol_after = $16,
              updated_at = NOW()
            WHERE id = $17
          `,
          [
            audit.whiteEloBefore,
            audit.whiteEloAfter,
            audit.blackEloBefore,
            audit.blackEloAfter,
            audit.whiteGlickoBefore.rating,
            audit.whiteGlickoAfter.rating,
            audit.whiteGlickoBefore.rd,
            audit.whiteGlickoAfter.rd,
            audit.whiteGlickoBefore.vol,
            audit.whiteGlickoAfter.vol,
            audit.blackGlickoBefore?.rating || null,
            audit.blackGlickoAfter?.rating || null,
            audit.blackGlickoBefore?.rd || null,
            audit.blackGlickoAfter?.rd || null,
            audit.blackGlickoBefore?.vol || null,
            audit.blackGlickoAfter?.vol || null,
            audit.matchId
          ]
        );
      }

      return reply.status(200).send({
        message: "Ratings recomputed successfully",
        playersUpdated: updatedCount,
        matchesAudited: audits.length
      });
    } finally {
      await pool.end();
    }
  });

  app.get<{ Params: ClubParams; Querystring: { page?: string; limit?: string; sortBy?: string; sortOrder?: string; name?: string; status?: string } }>("/clubs/:clubId/tournaments", async (request, reply) => {
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

      // Validate: only one tournament can be ongoing at a time
      const ongoingTournamentResult = await pool.query(
        `SELECT id FROM tournaments WHERE club_id = $1 AND status IN ('draft', 'active')`,
        [request.params.clubId]
      );
      if (ongoingTournamentResult.rows.length > 0) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Cannot create tournament: there is already an ongoing tournament in this club"
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

      return reply.status(200).send({ message: "Tournament deleted successfully" });
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
            t.club_id AS "clubId",
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
            r.number AS "roundNumber",
            r.starts_on AS "roundStart"
          FROM matches m
          JOIN players wp ON wp.id = m.white_player_id
          LEFT JOIN players bp ON bp.id = m.black_player_id
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
                WHEN m.white_player_id = p.id THEN COALESCE(m.result, 0)
                WHEN m.black_player_id = p.id THEN COALESCE(1 - m.result, 0)
                ELSE 0
              END
            ), 0)::float AS points
          FROM tournament_players tp
          JOIN players p ON p.id = tp.player_id
          LEFT JOIN matches m ON m.tournament_id = tp.tournament_id AND (m.white_player_id = p.id OR m.black_player_id = p.id)
          WHERE tp.tournament_id = $1
          GROUP BY p.id
        `,
        [request.params.id]
      );

      // Calculate Buchholz and Sonneborn-Berger tiebreakers
      const pointsById = new Map<string, number>(
        standingsResult.rows.map((r) => [r.playerId, r.points])
      );
      const oppQuery = await pool.query(
        `
          SELECT
            tp.player_id AS "playerId",
            CASE WHEN m.white_player_id = tp.player_id THEN m.black_player_id ELSE m.white_player_id END AS "opponentId",
            CASE WHEN m.white_player_id = tp.player_id THEN m.result ELSE 1 - m.result END AS "scoreFromOurSide"
          FROM tournament_players tp
          JOIN matches m ON m.tournament_id = tp.tournament_id
            AND (m.white_player_id = tp.player_id OR m.black_player_id = tp.player_id)
            AND m.result IS NOT NULL
            AND m.black_player_id IS NOT NULL
          WHERE tp.tournament_id = $1
        `,
        [request.params.id]
      );

      const tiebreaks = new Map<string, { buchholz: number; sb: number }>();
      for (const row of oppQuery.rows) {
        const oppPts = pointsById.get(row.opponentId) ?? 0;
        const score = parseFloat(row.scoreFromOurSide);
        const tb = tiebreaks.get(row.playerId) ?? { buchholz: 0, sb: 0 };
        tb.buchholz += oppPts;
        if (score === 1) tb.sb += oppPts;
        else if (score === 0.5) tb.sb += oppPts / 2;
        tiebreaks.set(row.playerId, tb);
      }

      for (const standing of standingsResult.rows) {
        const tb = tiebreaks.get(standing.playerId) ?? { buchholz: 0, sb: 0 };
        standing.buchholz = tb.buchholz;
        standing.sonnebornBerger = tb.sb;
      }

      // Sort by points, Buchholz, Sonneborn-Berger, wins
      standingsResult.rows.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
        if (b.sonnebornBerger !== a.sonnebornBerger)
          return b.sonnebornBerger - a.sonnebornBerger;
        return b.wins - a.wins;
      });

      const tournamentPlayersResult = await pool.query(
        `
          SELECT
            tp.player_id AS "playerId",
            p.display_name AS "displayName"
          FROM tournament_players tp
          JOIN players p ON p.id = tp.player_id
          WHERE tp.tournament_id = $1
        `,
        [request.params.id]
      );

      return {
        tournament,
        matches: matchesResult.rows,
        standings: standingsResult.rows,
        tournamentPlayers: tournamentPlayersResult.rows
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

      // Prevent completing tournament if matches have no results
      if (status === "completed") {
        const incompleteMatchesResult = await pool.query(
          `SELECT COUNT(*) AS count FROM matches WHERE tournament_id = $1 AND result IS NULL`,
          [request.params.id]
        );
        
        const incompleteCount = parseInt(incompleteMatchesResult.rows[0].count, 10);
        if (incompleteCount > 0) {
          return reply.status(400).send({
            error: "ValidationError",
            message: `Cannot complete tournament: ${incompleteCount} match(es) do not have results set`
          });
        }
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

      let round1Id: string | null = null;

      if (tournament.status !== "draft") {
        // Allow adding players during first round
        if (tournament.status === "active") {
          // Check if round 1 exists and is incomplete
          const round1Result = await pool.query(
            `SELECT id, status FROM rounds WHERE tournament_id = $1 AND number = 1`,
            [request.params.id]
          );

          if (round1Result.rows.length === 0 || round1Result.rows[0].status === "completed") {
            return reply.status(400).send({
              error: "ValidationError",
              message: "Can only add players during first round or in draft status"
            });
          }
          round1Id = round1Result.rows[0].id;
          // Continue - allow adding player during first round
        } else {
          return reply.status(400).send({
            error: "ValidationError",
            message: "Can only add players to tournaments in draft status"
          });
        }
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

      // If adding during first round, handle pairing
      if (round1Id !== null) {
        // Find a bye (player with no match in round 1)
        const byeResult = await pool.query(
          `
            SELECT tp.player_id
            FROM tournament_players tp
            LEFT JOIN matches m ON m.white_player_id = tp.player_id OR m.black_player_id = tp.player_id
            WHERE tp.tournament_id = $1
              AND m.round_id = $2
              AND m.id IS NULL
            LIMIT 1
          `,
          [request.params.id, round1Id]
        );

        if (byeResult.rows.length > 0) {
          // Create match between new player and bye player
          const maxBoardResult = await pool.query(
            `SELECT COALESCE(MAX(board_number), 0) AS max_board FROM matches WHERE round_id = $1`,
            [round1Id]
          );
          const nextBoardNumber = maxBoardResult.rows[0].max_board + 1;

          await pool.query(
            `
              INSERT INTO matches (club_id, tournament_id, round_id, white_player_id, black_player_id, board_number, played_on)
              VALUES ($1, $2, $3, $4, $5, $6, NOW())
            `,
            [tournament.club_id, request.params.id, round1Id, byeResult.rows[0].player_id, playerId, nextBoardNumber]
          );
        }
        // If no bye, new player gets a bye (no match created)
      }

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

      let round1Id: string | null = null;

      if (tournament.status !== "draft") {
        // Allow adding players during first round
        if (tournament.status === "active") {
          // Check if round 1 exists and is incomplete
          const round1Result = await pool.query(
            `SELECT id, status FROM rounds WHERE tournament_id = $1 AND number = 1`,
            [request.params.id]
          );

          if (round1Result.rows.length === 0 || round1Result.rows[0].status === "completed") {
            return reply.status(400).send({
              error: "ValidationError",
              message: "Can only add players during first round or in draft status"
            });
          }
          round1Id = round1Result.rows[0].id;
          // Continue - allow adding player during first round
        } else {
          return reply.status(400).send({
            error: "ValidationError",
            message: "Can only add players to tournaments in draft status"
          });
        }
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

      // Create player ratings using the single rating config source of truth.
      await pool.query(
        `
          INSERT INTO player_ratings (player_id, club_id, elo, glicko_rating, glicko_rd, glicko_vol, games_played)
          VALUES ($1, $2, $3, $4, $5, $6, 0)
        `,
        [
          playerId,
          tournament.club_id,
          ratingConfig.defaultElo,
          ratingConfig.g2DefaultRating,
          ratingConfig.g2DefaultRd,
          ratingConfig.g2DefaultVol
        ]
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

      // If adding during first round, handle pairing
      if (round1Id !== null) {
        // Find a bye (player with no match in round 1)
        const byeResult = await pool.query(
          `
            SELECT tp.player_id
            FROM tournament_players tp
            LEFT JOIN matches m ON m.white_player_id = tp.player_id OR m.black_player_id = tp.player_id
            WHERE tp.tournament_id = $1
              AND m.round_id = $2
              AND m.id IS NULL
            LIMIT 1
          `,
          [request.params.id, round1Id]
        );

        if (byeResult.rows.length > 0) {
          // Create match between new player and bye player
          const maxBoardResult = await pool.query(
            `SELECT COALESCE(MAX(board_number), 0) AS max_board FROM matches WHERE round_id = $1`,
            [round1Id]
          );
          const nextBoardNumber = maxBoardResult.rows[0].max_board + 1;

          await pool.query(
            `
              INSERT INTO matches (club_id, tournament_id, round_id, white_player_id, black_player_id, board_number, played_on)
              VALUES ($1, $2, $3, $4, $5, $6, NOW())
            `,
            [tournament.club_id, request.params.id, round1Id, byeResult.rows[0].player_id, playerId, nextBoardNumber]
          );
        }
        // If no bye, new player gets a bye (no match created)
      }

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
            AND m.result IS NOT NULL
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
  app.post<{ Params: TournamentParams; Body: { startsOn?: string } }>("/tournaments/:id/rounds", async (request, reply) => {
    const pool = createPool();
    try {
      const { startsOn } = request.body;
      
      // Get tournament details
      const tournamentResult = await pool.query(
        `SELECT id, status, format, club_id, pairing_method, total_rounds FROM tournaments WHERE id = $1`,
        [request.params.id]
      );

      if (tournamentResult.rows.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Tournament not found"
        });
      }

      const tournament = tournamentResult.rows[0];

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

      // Check if total rounds limit is reached
      if (tournament.total_rounds && nextRoundNumber > tournament.total_rounds) {
        return reply.status(400).send({
          error: "ValidationError",
          message: `Cannot generate more rounds. Tournament has ${tournament.total_rounds} total rounds.`
        });
      }

      // Check if all matches in previous rounds have results
      const incompleteMatchesResult = await pool.query(
        `
          SELECT COUNT(*) as count FROM matches m
          JOIN rounds r ON r.id = m.round_id
          WHERE r.tournament_id = $1 AND m.result IS NULL
        `,
        [request.params.id]
      );

      if (incompleteMatchesResult.rows[0].count > 0) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Cannot generate new round while previous matches have no results"
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

      // Create round with start date (default to NOW() if not provided)
      const startsOnValue = startsOn ? new Date(startsOn).toISOString() : new Date().toISOString();
      const roundResult = await pool.query(
        `
          INSERT INTO rounds (tournament_id, number, status, starts_on)
          VALUES ($1, $2, 'scheduled', $3)
          RETURNING id
        `,
        [request.params.id, nextRoundNumber, startsOnValue]
      );

      const roundId = roundResult.rows[0].id;

      // Create matches
      for (const pairing of pairings) {
        // For bye matches (blackPlayerId is null), set result to 1 (win) immediately
        const isBye = pairing.blackPlayerId === null;
        const result = isBye ? 1 : null;

        await pool.query(
          `
            INSERT INTO matches (club_id, tournament_id, round_id, white_player_id, black_player_id, board_number, played_on, result)
            VALUES ($1, $2, $3, $4, $5, $6, NOW()::date, $7)
          `,
          [tournament.club_id, request.params.id, roundId, pairing.whitePlayerId, pairing.blackPlayerId, pairing.boardNumber, result]
        );

        // Update color counts (only for real matches, not byes)
        if (!isBye) {
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

  app.delete<{ Params: { id: string } }>("/rounds/:id", async (request, reply) => {
    const pool = createPool();
    try {
      // Check if round exists
      const roundResult = await pool.query(
        `SELECT r.id FROM rounds r WHERE r.id = $1`,
        [request.params.id]
      );

      if (roundResult.rows.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Round not found"
        });
      }

      // Check if any matches in the round have results (excluding bye matches)
      const matchesWithResultsResult = await pool.query(
        `SELECT COUNT(*) as count FROM matches WHERE round_id = $1 AND result IS NOT NULL AND black_player_id IS NOT NULL`,
        [request.params.id]
      );

      if (matchesWithResultsResult.rows[0].count > 0) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Cannot delete round with match results. Please undo match results first by setting them to null."
        });
      }

      // Delete all matches associated with the round
      await pool.query(
        `DELETE FROM matches WHERE round_id = $1`,
        [request.params.id]
      );

      // Delete the round
      await pool.query(
        `DELETE FROM rounds WHERE id = $1`,
        [request.params.id]
      );

      return reply.status(204).send();
    } finally {
      await pool.end();
    }
  });

  // Match result endpoints
  app.put<{ Params: { id: string }; Body: { result: number | null } }>("/matches/:id/result", async (request, reply) => {
    const pool = createPool();
    try {
      const { result } = request.body;

      if (result !== null && result !== 1 && result !== 0.5 && result !== 0) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "result must be 1 (white wins), 0.5 (draw), 0 (black wins), or null to undo"
        });
      }

      // Get match details with tournament status
      const matchResult = await pool.query(
        `SELECT m.id, m.tournament_id, m.white_player_id, m.black_player_id, m.club_id, m.played_on, t.status AS "tournamentStatus"
         FROM matches m
         JOIN tournaments t ON t.id = m.tournament_id
         WHERE m.id = $1`,
        [request.params.id]
      );

      if (matchResult.rows.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Match not found"
        });
      }

      const match = matchResult.rows[0];

      if (match.tournamentStatus === "completed") {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Cannot update match result for completed tournament"
        });
      }

      // Validate: only allow updating the player's LAST game (no games after this one with results).
      // Bye matches are excluded since they don't affect ratings.
      const lastGameCheckResult = await pool.query(
        `
          SELECT
            (SELECT COUNT(*) FROM matches
             WHERE white_player_id = $1 AND result IS NOT NULL AND black_player_id IS NOT NULL
             AND (played_on > $3 OR (played_on = $3 AND id > $2))) AS "whiteGamesAfter",
            (SELECT COUNT(*) FROM matches
             WHERE black_player_id = $4 AND result IS NOT NULL
             AND (played_on > $3 OR (played_on = $3 AND id > $2))) AS "blackGamesAfter"
        `,
        [match.white_player_id, request.params.id, match.played_on, match.black_player_id]
      );

      const lastGameCheck = lastGameCheckResult.rows[0];
      if (lastGameCheck.whiteGamesAfter > 0 || lastGameCheck.blackGamesAfter > 0) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Can only update a player's last game. To update earlier games, rewind game by game."
        });
      }

      // Update match result
      const updatedMatchResult = await pool.query(
        `
          UPDATE matches
          SET result = $1::numeric, updated_at = NOW()
          WHERE id = $2
          RETURNING id, result
        `,
        [result, request.params.id]
      );

      // Handle rating updates
      if (result === null) {
        // Undo: revert player ratings to stored "before" values from this match
        const matchAuditResult = await pool.query(
          `SELECT white_elo_before, black_elo_before, white_glicko_rating_before, white_glicko_rd_before, white_glicko_vol_before,
                  black_glicko_rating_before, black_glicko_rd_before, black_glicko_vol_before
           FROM matches m
           WHERE m.id = $1`,
          [request.params.id]
        );

        const matchAudit = matchAuditResult.rows[0];

        if (matchAudit && matchAudit.white_elo_before !== null) {
          // Helper: derive last_game_date from MAX(played_on) of remaining real games for a player.
          const computeLastGameDate = async (playerId: string): Promise<string | null> => {
            const r = await pool.query(
              `SELECT MAX(played_on) AS "lastDate"
               FROM matches
               WHERE (white_player_id = $1 OR black_player_id = $1)
                 AND result IS NOT NULL
                 AND black_player_id IS NOT NULL
                 AND id <> $2`,
              [playerId, request.params.id]
            );
            return r.rows[0]?.lastDate || null;
          };

          const whiteLastDate = await computeLastGameDate(match.white_player_id);

          // Revert white player ratings, decrement games_played, restore last_game_date
          await pool.query(
            `
              UPDATE player_ratings
              SET
                elo = $1,
                glicko_rating = $2,
                glicko_rd = $3,
                glicko_vol = $4,
                games_played = GREATEST(games_played - 1, 0),
                last_game_date = $5,
                updated_at = NOW()
              WHERE player_id = $6
            `,
            [
              matchAudit.white_elo_before,
              matchAudit.white_glicko_rating_before,
              matchAudit.white_glicko_rd_before,
              matchAudit.white_glicko_vol_before,
              whiteLastDate,
              match.white_player_id
            ]
          );

          // Revert black player ratings (only if there's a real opponent, not a bye)
          if (matchAudit.black_elo_before !== null && match.black_player_id) {
            const blackLastDate = await computeLastGameDate(match.black_player_id);
            await pool.query(
              `
                UPDATE player_ratings
                SET
                  elo = $1,
                  glicko_rating = $2,
                  glicko_rd = $3,
                  glicko_vol = $4,
                  games_played = GREATEST(games_played - 1, 0),
                  last_game_date = $5,
                  updated_at = NOW()
                WHERE player_id = $6
              `,
              [
                matchAudit.black_elo_before,
                matchAudit.black_glicko_rating_before,
                matchAudit.black_glicko_rd_before,
                matchAudit.black_glicko_vol_before,
                blackLastDate,
                match.black_player_id
              ]
            );
          }

          // Clear rating audit fields
          await pool.query(
            `
              UPDATE matches
              SET
                white_elo_before = NULL,
                white_elo_after = NULL,
                black_elo_before = NULL,
                black_elo_after = NULL,
                white_glicko_rating_before = NULL,
                white_glicko_rating_after = NULL,
                white_glicko_rd_before = NULL,
                white_glicko_rd_after = NULL,
                white_glicko_vol_before = NULL,
                white_glicko_vol_after = NULL,
                black_glicko_rating_before = NULL,
                black_glicko_rating_after = NULL,
                black_glicko_rd_before = NULL,
                black_glicko_rd_after = NULL,
                black_glicko_vol_before = NULL,
                black_glicko_vol_after = NULL
              WHERE id = $1
            `,
            [request.params.id]
          );
        }
      } else {
        // Set new result: calculate ratings and store "before" and "after" values
        // Get current player ratings
        const ratingsResult = await pool.query(
          `SELECT player_id, elo, glicko_rating, glicko_rd, glicko_vol, games_played, last_game_date
           FROM player_ratings WHERE player_id = ANY($1)`,
          [[match.white_player_id, match.black_player_id]]
        );

        const ratingsMap = new Map();
        for (const row of ratingsResult.rows) {
          ratingsMap.set(row.player_id, row);
        }

        const defaultRatingRow = {
          elo: ratingConfig.defaultElo,
          glicko_rating: ratingConfig.g2DefaultRating,
          glicko_rd: ratingConfig.g2DefaultRd,
          glicko_vol: ratingConfig.g2DefaultVol,
          games_played: 0,
          last_game_date: null as string | null
        };
        const whiteRating = ratingsMap.get(match.white_player_id) || defaultRatingRow;
        const blackRating = match.black_player_id ? ratingsMap.get(match.black_player_id) || defaultRatingRow : null;

        const whiteProfile: RatingProfile = {
          elo: whiteRating.elo,
          glicko: {
            rating: whiteRating.glicko_rating,
            rd: whiteRating.glicko_rd,
            vol: whiteRating.glicko_vol,
            lastGameDate: whiteRating.last_game_date
          },
          gamesPlayed: whiteRating.games_played,
          lastGameDate: whiteRating.last_game_date
        };

        const blackProfile: RatingProfile | null = blackRating ? {
          elo: blackRating.elo,
          glicko: {
            rating: blackRating.glicko_rating,
            rd: blackRating.glicko_rd,
            vol: blackRating.glicko_vol,
            lastGameDate: blackRating.last_game_date
          },
          gamesPlayed: blackRating.games_played,
          lastGameDate: blackRating.last_game_date
        } : null;

        const applied = applyRatedMatch(whiteProfile, blackProfile, result, match.played_on);

        // Update white player ratings
        await pool.query(
          `
            UPDATE player_ratings
            SET
              elo = $1,
              glicko_rating = $2,
              glicko_rd = $3,
              glicko_vol = $4,
              games_played = $5,
              last_game_date = $6,
              updated_at = NOW()
            WHERE player_id = $7
          `,
          [
            applied.white.elo,
            applied.white.glicko.rating,
            applied.white.glicko.rd,
            applied.white.glicko.vol,
            applied.white.gamesPlayed,
            applied.white.lastGameDate,
            match.white_player_id
          ]
        );

        // Update black player ratings (only if there's a real opponent, not a bye)
        if (applied.black) {
          await pool.query(
            `
              UPDATE player_ratings
              SET
                elo = $1,
                glicko_rating = $2,
                glicko_rd = $3,
                glicko_vol = $4,
                games_played = $5,
                last_game_date = $6,
                updated_at = NOW()
              WHERE player_id = $7
            `,
            [
              applied.black.elo,
              applied.black.glicko.rating,
              applied.black.glicko.rd,
              applied.black.glicko.vol,
              applied.black.gamesPlayed,
              applied.black.lastGameDate,
              match.black_player_id
            ]
          );
        }

        // Update match audit fields
        await pool.query(
          `
            UPDATE matches
            SET
              white_elo_before = $1,
              white_elo_after = $2,
              black_elo_before = $3,
              black_elo_after = $4,
              white_glicko_rating_before = $5,
              white_glicko_rating_after = $6,
              white_glicko_rd_before = $7,
              white_glicko_rd_after = $8,
              white_glicko_vol_before = $9,
              white_glicko_vol_after = $10,
              black_glicko_rating_before = $11,
              black_glicko_rating_after = $12,
              black_glicko_rd_before = $13,
              black_glicko_rd_after = $14,
              black_glicko_vol_before = $15,
              black_glicko_vol_after = $16
            WHERE id = $17
          `,
          [
            applied.audit.whiteEloBefore,
            applied.audit.whiteEloAfter,
            applied.audit.blackEloBefore,
            applied.audit.blackEloAfter,
            applied.audit.whiteGlickoBefore.rating,
            applied.audit.whiteGlickoAfter.rating,
            applied.audit.whiteGlickoBefore.rd,
            applied.audit.whiteGlickoAfter.rd,
            applied.audit.whiteGlickoBefore.vol,
            applied.audit.whiteGlickoAfter.vol,
            applied.audit.blackGlickoBefore?.rating || null,
            applied.audit.blackGlickoAfter?.rating || null,
            applied.audit.blackGlickoBefore?.rd || null,
            applied.audit.blackGlickoAfter?.rd || null,
            applied.audit.blackGlickoBefore?.vol || null,
            applied.audit.blackGlickoAfter?.vol || null,
            request.params.id
          ]
        );
      }

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
            m.board_number AS "boardNumber"
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
                WHEN m.white_player_id = tp.player_id THEN COALESCE(m.result, 0)
                WHEN m.black_player_id = tp.player_id THEN COALESCE(1 - m.result, 0)
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
            AND (m.result IS NOT NULL OR m.black_player_id IS NULL)
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
              CASE WHEN m.white_player_id = $1 THEN m.result ELSE 1 - m.result END AS "scoreFromOurSide",
              (
                SELECT COALESCE(SUM(
                  CASE
                    WHEN m2.white_player_id = opp.id THEN COALESCE(m2.result, 0)
                    WHEN m2.black_player_id = opp.id THEN COALESCE(1 - m2.result, 0)
                    ELSE 0
                  END
                ), 0)
                FROM matches m2
                CROSS JOIN (SELECT CASE WHEN m.white_player_id = $1 THEN m.black_player_id ELSE m.white_player_id END AS id) opp
                WHERE (m2.white_player_id = opp.id OR m2.black_player_id = opp.id)
                  AND m2.tournament_id = $2
                  AND m2.result IS NOT NULL
              ) AS "opponentPoints"
            FROM matches m
            WHERE (m.white_player_id = $1 OR m.black_player_id = $1)
              AND m.tournament_id = $2
              AND m.result IS NOT NULL
              AND m.black_player_id IS NOT NULL
          `,
          [standing.playerId, request.params.id]
        );

        let buchholz = 0;
        let sonnebornBerger = 0;

        for (const row of opponentsResult.rows) {
          const oppPts = parseFloat(row.opponentPoints) || 0;
          const ourScore = parseFloat(row.scoreFromOurSide);
          buchholz += oppPts;

          if (ourScore === 1) {
            sonnebornBerger += oppPts;
          } else if (ourScore === 0.5) {
            sonnebornBerger += oppPts / 2;
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
