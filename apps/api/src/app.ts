import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { ratingConfig, loadEnv } from "@chess-club/config";
import { registerHealthRoutes, type HealthOptions } from "./routes/health.js";
import { registerPlayerRoutes } from "./routes/players.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerInviteRoutes } from "./routes/invites.js";
import { asHttpError, createErrorResponse } from "./lib/errors.js";
import { parseStringFilter, escapeLikePattern } from "./lib/validators.js";
import { generateSwissPairings } from "./lib/swiss-pairing.js";
import { recomputeRatings, applyRatedMatch, type MatchInput, type RatingProfile } from "./lib/ratings/ratings.js";
import { attachUser, requireAuth, requireClubRole, requireTournamentClubRole, requirePlayerClubRole, resolveClubIdFromTournament } from "./lib/auth/rbac.js";
import dbPlugin from "./plugins/db.js";
import type { Db } from "@chess-club/db";
import type pg from "pg";
import { schema } from "@chess-club/db";
import { eq, and, sql, desc, asc, count, gte, lte, isNull, isNotNull, or, ne } from "drizzle-orm";

const { clubs, clubMemberships, players, playerRatings, tournaments, tournamentPlayers, matches, rounds } = schema;

export type AppOptions = {
  databasePing?: () => Promise<void>;
  pool?: pg.Pool;
  db?: Db;
};

type ClubParams = {
  clubId: string;
};

type TournamentParams = {
  id: string;
};

export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const env = loadEnv();
  const app = Fastify({
    logger: true
  });

  // CORS: env-driven allowlist, wildcard only in development
  const allowedOrigins = env.ALLOWED_ORIGINS.split(",").filter(Boolean);
  await app.register(cors, {
    origin: env.NODE_ENV === "development" ? true : allowedOrigins,
    credentials: true
  });

  // Cookie plugin - must be registered before any preHandler that reads cookies
  await app.register(cookie);

  // Database plugin - single pool lifecycle
  await app.register(dbPlugin, {
    pool: options.pool,
    db: options.db
  });

  app.setErrorHandler((error, _request, reply) => {
    const { statusCode, body } = createErrorResponse(error);
    app.log.error(error);
    return reply.status(statusCode).send(body);
  });

  // Global preHandler to attach user from session
  app.addHook("preHandler", attachUser);

  await registerHealthRoutes(app, {
    databasePing: options.databasePing
  });

  await registerAuthRoutes(app);

  await registerInviteRoutes(app);

  await registerPlayerRoutes(app);

  // Conditional auth guards - only enforce if REQUIRE_AUTH=true
  const noopHandler = async () => {};
  const conditionalRequireAuth = env.REQUIRE_AUTH ? requireAuth : noopHandler;
  const conditionalRequireClubRole = env.REQUIRE_AUTH ? requireClubRole : noopHandler;
  const conditionalRequireTournamentClubRole = env.REQUIRE_AUTH ? requireTournamentClubRole : noopHandler;
  const conditionalRequirePlayerClubRole = env.REQUIRE_AUTH ? requirePlayerClubRole : noopHandler;

  app.get("/clubs", { preHandler: [conditionalRequireAuth] }, async (request, reply) => {
    app.log.info({ msg: "GET /clubs request received", user: request.user?.id });
    
    // If auth is enabled, only return clubs the user is a member of
    const userId = request.user?.id;
    const result = await app.db.select({
      id: clubs.id,
      name: clubs.name,
      slug: clubs.slug,
      description: clubs.description,
      city: clubs.city,
      country: clubs.country,
      createdAt: clubs.createdAt,
      updatedAt: clubs.updatedAt
    }).from(clubs)
    .where(
      env.REQUIRE_AUTH && userId 
        ? sql`${clubs.id} IN (SELECT ${clubMemberships.clubId} FROM ${clubMemberships} WHERE ${clubMemberships.userId} = ${userId})`
        : undefined
    )
    .orderBy(clubs.name);
    
    app.log.info({ msg: "GET /clubs query successful", count: result.length });
    return { clubs: result };
  });

  app.post<{ Body: { name: string; description?: string; city?: string; country?: string } }>("/clubs", { preHandler: [conditionalRequireAuth] }, async (request, reply) => {
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
    const existingClub = await app.db.select({ id: clubs.id }).from(clubs).where(eq(clubs.slug, slug)).limit(1);

    if (existingClub.length > 0) {
        return reply.status(409).send({
          error: "ConflictError",
          message: "A club with this slug already exists"
        });
      }

    const result = await app.db.insert(clubs).values({
      name: trimmedName,
      slug: slug,
      description: description?.trim() || null,
      city: city?.trim() || null,
      country: country?.trim() || null
    }).returning();

    if (!result[0]) {
      return reply.status(500).send({
        error: "InternalError",
        message: "Failed to create club"
      });
    }

    // If auth is enabled, create the user as owner of the new club
    const club = result[0];
    if (env.REQUIRE_AUTH && request.user) {
        await app.db.insert(clubMemberships).values({
          clubId: club.id,
          userId: request.user.id,
          role: "owner"
        });
      }

    return reply.status(201).send({ club });
    
  });

  app.patch<{ Params: ClubParams; Body: { name?: string; description?: string; city?: string; country?: string } }>("/clubs/:clubId", { preHandler: [conditionalRequireAuth, (request, reply) => conditionalRequireClubRole(request, reply, ["owner", "admin", "organizer"])] }, async (request, reply) => {
    const { name, description, city, country } = request.body;

    if (name !== undefined && name.trim() === "") {
        return reply.status(400).send({
          error: "ValidationError",
          message: "name cannot be empty"
        });
      }

    const updateData: Record<string, any> = {};

    if (name !== undefined) {
        updateData.name = name.trim();
      }

    if (description !== undefined) {
        updateData.description = description.trim() || null;
      }

    if (city !== undefined) {
        updateData.city = city.trim() || null;
      }

    if (country !== undefined) {
        updateData.country = country.trim() || null;
      }

    if (Object.keys(updateData).length === 0) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "No fields to update"
        });
      }

    const result = await app.db.update(clubs)
      .set({
        ...updateData,
        updatedAt: new Date()
      })
      .where(eq(clubs.id, request.params.clubId))
      .returning();

    if (result.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Club not found"
        });
      }

    return reply.status(200).send({ club: result[0] });
    
  });

  app.delete<{ Params: ClubParams }>("/clubs/:clubId", { preHandler: [conditionalRequireAuth, (request, reply) => conditionalRequireClubRole(request, reply, ["owner"])] }, async (request, reply) => {
    // Verify club exists
    const clubResult = await app.db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(eq(clubs.id, request.params.clubId)).limit(1);

    if (clubResult.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Club not found"
        });
      }

    // Delete club - cascade handles all related data
    await app.db.delete(clubs).where(eq(clubs.id, request.params.clubId));

    return reply.status(204).send();
    
  });

  app.post<{ Params: ClubParams }>("/clubs/:clubId/ratings/recompute", { preHandler: [conditionalRequireAuth, (request, reply) => conditionalRequireClubRole(request, reply, ["owner", "admin"])] }, async (request, reply) => {
    // Fetch all players for the club
    const playersResult = await app.db.select({ id: players.id }).from(players).where(eq(players.clubId, request.params.clubId));

    if (playersResult.length === 0) {
        return reply.status(200).send({
          message: "No players found in club",
          playersUpdated: 0
        });
      }

    const playerIds = playersResult.map(row => row.id);

    // Fetch all completed real matches for the club (exclude byes)
    const matchesResult = await app.db.select({
      id: matches.id,
      whitePlayerId: matches.whitePlayerId,
      blackPlayerId: matches.blackPlayerId,
      result: matches.result,
      playedOn: matches.playedOn
    }).from(matches)
    .where(and(eq(matches.clubId, request.params.clubId), isNotNull(matches.result), isNotNull(matches.blackPlayerId)))
    .orderBy(matches.playedOn, matches.id);

    if (matchesResult.length === 0) {
        return reply.status(200).send({
          message: "No completed matches found in club",
          playersUpdated: 0
        });
      }

    const matches: MatchInput[] = matchesResult.map(row => ({
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
        await app.db.update(playerRatings)
          .set({
            elo: profile.elo,
            glickoRating: profile.glicko.rating,
            glickoRd: profile.glicko.rd,
            glickoVol: profile.glicko.vol,
            gamesPlayed: profile.gamesPlayed,
            lastGameDate: profile.lastGameDate,
            updatedAt: new Date()
          })
          .where(eq(playerRatings.playerId, playerId));
        updatedCount++;
      }

    // Update match rating audits
    for (const audit of audits) {
        await app.db.update(matches)
          .set({
            whiteEloBefore: audit.whiteEloBefore,
            whiteEloAfter: audit.whiteEloAfter,
            blackEloBefore: audit.blackEloBefore,
            blackEloAfter: audit.blackEloAfter,
            whiteGlickoRatingBefore: audit.whiteGlickoBefore.rating,
            whiteGlickoRatingAfter: audit.whiteGlickoAfter.rating,
            whiteGlickoRdBefore: audit.whiteGlickoBefore.rd,
            whiteGlickoRdAfter: audit.whiteGlickoAfter.rd,
            whiteGlickoVolBefore: audit.whiteGlickoBefore.vol,
            whiteGlickoVolAfter: audit.whiteGlickoAfter.vol,
            blackGlickoRatingBefore: audit.blackGlickoBefore?.rating || null,
            blackGlickoRatingAfter: audit.blackGlickoAfter?.rating || null,
            blackGlickoRdBefore: audit.blackGlickoBefore?.rd || null,
            blackGlickoRdAfter: audit.blackGlickoAfter?.rd || null,
            blackGlickoVolBefore: audit.blackGlickoBefore?.vol || null,
            blackGlickoVolAfter: audit.blackGlickoAfter?.vol || null,
            updatedAt: new Date()
          })
          .where(eq(matches.id, audit.matchId));
      }

    return reply.status(200).send({
        message: "Ratings recomputed successfully",
        playersUpdated: updatedCount,
        matchesAudited: audits.length
      });
    
  });

  app.get<{ Params: ClubParams; Querystring: { page?: string; limit?: string; sortBy?: string; sortOrder?: string; name?: string; status?: string } }>("/clubs/:clubId/tournaments", { preHandler: [conditionalRequireAuth, (request, reply) => conditionalRequireClubRole(request, reply, ["owner", "admin", "organizer", "member"])] }, async (request, reply) => {
    const page = Math.max(1, parseInt(request.query.page || '1', 10));
    const limit = [10, 20, 50].includes(parseInt(request.query.limit || '20', 10)) ? parseInt(request.query.limit || '20', 10) : 20;
    const allowedSortColumns = ['name', 'startsOn', 'status', 'playerCount', 'matchCount'];
    const sortBy = allowedSortColumns.includes(request.query.sortBy || 'startsOn') ? request.query.sortBy || 'startsOn' : 'startsOn';
    const sortOrder = (request.query.sortOrder === 'asc' || request.query.sortOrder === 'desc') ? request.query.sortOrder : 'desc';

    const filters = [];
    const tname = parseStringFilter(request.query.name);
    if (tname) {
      filters.push(
        sql`${tournaments.name} LIKE ${`%${escapeLikePattern(tname)}%`} ESCAPE '\\'`
      );
    }
    if (request.query.status) {
      const validStatuses = ['draft', 'active', 'completed'];
      if (validStatuses.includes(request.query.status)) {
        filters.push(eq(tournaments.status, request.query.status as 'draft' | 'active' | 'completed'));
      }
    }

    const baseQuery = app.db.select({
      id: tournaments.id,
      name: tournaments.name,
      startsOn: tournaments.startsOn,
      format: tournaments.format,
      status: tournaments.status,
      legacyId: tournaments.legacyId
    }).from(tournaments)
      .where(and(
        eq(tournaments.clubId, request.params.clubId),
        ...filters
      ));

    const countResult = await app.db.select({ count: sql`count(*)` }).from(tournaments)
      .where(and(
        eq(tournaments.clubId, request.params.clubId),
        ...filters
      ));
    const total = Number(countResult[0]?.count || 0);
    const totalPages = Math.ceil(total / limit);

    if (page > totalPages && totalPages > 0) {
      return reply.status(404).send({
        error: "NotFound",
        message: "Page exceeds total pages"
      });
    }

    const offset = (page - 1) * limit;

    const result = await app.db.select({
      id: tournaments.id,
      name: tournaments.name,
      startsOn: tournaments.startsOn,
      format: tournaments.format,
      status: tournaments.status,
      legacyId: tournaments.legacyId,
      playerCount: sql<number>`COUNT(DISTINCT ${tournamentPlayers.playerId})`,
      matchCount: sql<number>`COUNT(DISTINCT ${matches.id})`
    }).from(tournaments)
      .leftJoin(tournamentPlayers, eq(tournamentPlayers.tournamentId, tournaments.id))
      .leftJoin(matches, eq(matches.tournamentId, tournaments.id))
      .where(and(
        eq(tournaments.clubId, request.params.clubId),
        ...filters
      ))
      .groupBy(tournaments.id)
      .orderBy(
        (() => {
          // Map camelCase sortBy values to their snake_case DB column names.
          // sortBy is already validated against allowedSortColumns above, so
          // sql.raw() here is safe from injection — every reachable value is
          // a hardcoded literal from this map.
          const columnMap: Record<string, string> = {
            name: 'name',
            startsOn: 'starts_on',
            status: 'status',
            playerCount: 'player_count',
            matchCount: 'match_count'
          };
          const column = columnMap[sortBy] ?? 'starts_on';
          return sortOrder === 'asc' ? asc(sql.raw(column)) : desc(sql.raw(column));
        })(),
        asc(tournaments.name)
      )
      .limit(limit)
      .offset(offset);

    return {
      tournaments: result,
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
    };
  });

  app.post<{ Params: ClubParams; Body: { name: string; startsOn?: string; format?: string; totalRounds?: number; pairingMethod?: string } }>("/clubs/:clubId/tournaments", { preHandler: [conditionalRequireAuth, (request, reply) => conditionalRequireClubRole(request, reply, ["owner", "admin", "organizer"])] }, async (request, reply) => {
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
    const ongoingTournamentResult = await app.db.select({ id: tournaments.id }).from(tournaments)
      .where(and(
        eq(tournaments.clubId, request.params.clubId),
        sql`${tournaments.status} IN ('draft', 'active')`
      ))
      .limit(1);
    if (ongoingTournamentResult.length > 0) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Cannot create tournament: there is already an ongoing tournament in this club"
        });
      }

    const result = await app.db.execute(sql`
      INSERT INTO tournaments (club_id, name, starts_on, format, total_rounds, pairing_method, status)
      VALUES (${request.params.clubId}, ${name.trim()}, ${startsOn ? new Date(startsOn) : null}, ${format || "manual"}, ${totalRounds || null}, ${pairingMethod || "seeded_by_rating"}, 'draft')
      RETURNING id, name, starts_on AS "startsOn", format, status, total_rounds AS "totalRounds", pairing_method AS "pairingMethod", legacy_id AS "legacyId", created_at AS "createdAt", club_id AS "clubId"
    `);

    return reply.status(201).send({ tournament: result.rows[0] });
    
  });

  app.delete<{ Params: TournamentParams }>("/tournaments/:id", { preHandler: [conditionalRequireAuth, (request, reply) => conditionalRequireTournamentClubRole(request, reply, ["owner", "admin", "organizer"])] }, async (request, reply) => {
    const currentResult = await app.db.select({ id: tournaments.id, status: tournaments.status }).from(tournaments).where(eq(tournaments.id, request.params.id)).limit(1);

    if (currentResult.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Tournament not found"
        });
      }

    if (!currentResult[0] || currentResult[0].status !== "draft") {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Can only delete tournaments in draft status"
        });
      }

    await app.db.delete(tournaments).where(eq(tournaments.id, request.params.id));

    return reply.status(200).send({ message: "Tournament deleted successfully" });
    
  });

  app.get<{ Params: ClubParams; Querystring: { activeOnly?: string; limit?: string } }>("/clubs/:clubId/leaderboard", { preHandler: [conditionalRequireAuth, (request, reply) => conditionalRequireClubRole(request, reply, ["owner", "admin", "organizer", "member"])] }, async (request) => {
    const activeOnly = request.query.activeOnly !== 'false';
    const limit = Math.min(parseInt(request.query.limit || '10', 10), 100);
    const result = await app.db.execute(sql`
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
       AND m.black_player_id IS NOT NULL
       AND (m.white_player_id = p.id OR m.black_player_id = p.id)
      WHERE p.club_id = ${request.params.clubId} ${activeOnly ? sql`AND p.active = true` : sql``}
      GROUP BY p.id, pr.player_id
      ORDER BY pr.elo DESC, p.display_name ASC
      LIMIT ${limit}
    `);
    return { leaderboard: result.rows };
    
  });

  app.get<{ Params: TournamentParams }>("/tournaments/:id", { preHandler: [conditionalRequireAuth, (request, reply) => conditionalRequireTournamentClubRole(request, reply, ["owner", "admin", "organizer", "member"])] }, async (request) => {
    const tournamentResult = await app.db.execute(sql`
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
      WHERE t.id = ${request.params.id}
      GROUP BY t.id
    `);

    if (tournamentResult.rows.length === 0) {
        return { error: "Tournament not found" };
      }

    const tournament = tournamentResult.rows[0];

    const matchesResult = await app.db.execute(sql`
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
      WHERE m.tournament_id = ${request.params.id}
      ORDER BY r.number ASC NULLS LAST, m.board_number ASC NULLS LAST, m.played_on ASC, m.id ASC
    `);

    const standingsResult = await app.db.execute(sql`
      SELECT
        p.id AS "playerId",
        p.display_name AS "playerName",
        COUNT(CASE WHEN m.black_player_id IS NOT NULL AND ((m.white_player_id = p.id AND m.result = 1) OR (m.black_player_id = p.id AND m.result = 0)) THEN 1 END)::int AS wins,
        COUNT(CASE WHEN m.black_player_id IS NOT NULL AND m.result = 0.5 THEN 1 END)::int AS draws,
        COUNT(CASE WHEN m.black_player_id IS NOT NULL AND ((m.white_player_id = p.id AND m.result = 0) OR (m.black_player_id = p.id AND m.result = 1)) THEN 1 END)::int AS losses,
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
      WHERE tp.tournament_id = ${request.params.id}
      GROUP BY p.id
    `);

    // Calculate Buchholz and Sonneborn-Berger tiebreakers
    const pointsById = new Map<string, number>(
        standingsResult.rows.map((r: any) => [r.playerId, r.points])
      );
    const oppQuery = await app.db.execute(sql`
      SELECT
        tp.player_id AS "playerId",
        CASE WHEN m.white_player_id = tp.player_id THEN m.black_player_id ELSE m.white_player_id END AS "opponentId",
        CASE WHEN m.white_player_id = tp.player_id THEN m.result ELSE 1 - m.result END AS "scoreFromOurSide"
      FROM tournament_players tp
      JOIN matches m ON m.tournament_id = tp.tournament_id
        AND (m.white_player_id = tp.player_id OR m.black_player_id = tp.player_id)
        AND m.result IS NOT NULL
        AND m.black_player_id IS NOT NULL
      WHERE tp.tournament_id = ${request.params.id}
    `);

    const tiebreaks = new Map<string, { buchholz: number; sb: number }>();
    for (const row of oppQuery.rows) {
        const oppPts = pointsById.get((row as any).opponentId) ?? 0;
        const score = parseFloat((row as any).scoreFromOurSide);
        const tb = tiebreaks.get((row as any).playerId) ?? { buchholz: 0, sb: 0 };
        tb.buchholz += oppPts;
        if (score === 1) tb.sb += oppPts;
        else if (score === 0.5) tb.sb += oppPts / 2;
        tiebreaks.set((row as any).playerId, tb);
      }

    for (const standing of standingsResult.rows) {
        const tb = tiebreaks.get((standing as any).playerId) ?? { buchholz: 0, sb: 0 };
        (standing as any).buchholz = tb.buchholz;
        (standing as any).sonnebornBerger = tb.sb;
      }

    // Sort by points, Buchholz, Sonneborn-Berger, wins
      standingsResult.rows.sort((a: any, b: any) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
        if (b.sonnebornBerger !== a.sonnebornBerger)
          return b.sonnebornBerger - a.sonnebornBerger;
        return b.wins - a.wins;
      });

    const tournamentPlayersResult = await app.db.execute(sql`
      SELECT
        tp.player_id AS "playerId",
        p.display_name AS "displayName"
      FROM tournament_players tp
      JOIN players p ON p.id = tp.player_id
      WHERE tp.tournament_id = ${request.params.id}
    `);

    return {
        tournament,
        matches: matchesResult.rows,
        standings: standingsResult.rows,
        tournamentPlayers: tournamentPlayersResult.rows
      };
    
  });

  app.put<{ Params: TournamentParams; Body: { name?: string; startsOn?: string; status?: string; totalRounds?: number; pairingMethod?: string } }>("/tournaments/:id", { preHandler: [conditionalRequireAuth, (request, reply) => conditionalRequireTournamentClubRole(request, reply, ["owner", "admin", "organizer"])] }, async (request, reply) => {
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

    const currentResult = await app.db.select({ id: tournaments.id, status: tournaments.status, name: tournaments.name, startsOn: tournaments.startsOn }).from(tournaments).where(eq(tournaments.id, request.params.id)).limit(1);

    if (currentResult.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Tournament not found"
        });
      }

    const current = currentResult[0];

    if (current.status === "completed" && (name !== undefined || startsOn !== undefined)) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Cannot edit name or startsOn when tournament is completed. Revert status to active first."
        });
      }

    // Prevent completing tournament if matches have no results
    if (status === "completed") {
        const incompleteMatchesResult = await app.db.select({ count: sql`COUNT(*)`.mapWith(Number) }).from(matches).where(and(eq(matches.tournamentId, request.params.id), isNull(matches.result)));
        
        const incompleteCount = incompleteMatchesResult[0]?.count || 0;
        if (incompleteCount > 0) {
          return reply.status(400).send({
            error: "ValidationError",
            message: `Cannot complete tournament: ${incompleteCount} match(es) do not have results set`
          });
        }
      }

    const updateData: Record<string, any> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (startsOn !== undefined) updateData.startsOn = new Date(startsOn);
    if (status !== undefined) updateData.status = status as "draft" | "active" | "completed";
    if (totalRounds !== undefined) updateData.totalRounds = totalRounds;
    if (pairingMethod !== undefined) updateData.pairingMethod = pairingMethod as "seeded_by_rating" | "random";

    if (Object.keys(updateData).length === 0) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "No fields to update"
        });
      }

    // Map camelCase field names to snake_case column names
    const columnMap: Record<string, string> = {
      name: "name",
      startsOn: "starts_on",
      format: "format",
      status: "status",
      totalRounds: "total_rounds",
      pairingMethod: "pairing_method"
    };

    // Build dynamic SET clause with proper column names
    const setClauses = Object.entries(updateData).map(([k, v]) => {
      const columnName = columnMap[k] || k;
      return sql`${sql.identifier(columnName)} = ${v}`;
    });
    const result = await app.db.execute(sql`
      UPDATE tournaments
      SET ${sql.join([...setClauses, sql`updated_at = NOW()`], sql`, `)}
      WHERE id = ${request.params.id}
      RETURNING id, name, starts_on AS "startsOn", format, status, total_rounds AS "totalRounds", pairing_method AS "pairingMethod", legacy_id AS "legacyId", created_at AS "createdAt", club_id AS "clubId"
    `);

    return reply.status(200).send({ tournament: result.rows[0] });
    
  });

  // Roster management endpoints
  app.post<{ Params: TournamentParams; Body: { playerId: string } }>("/tournaments/:id/players", { preHandler: [conditionalRequireAuth, (request, reply) => conditionalRequireTournamentClubRole(request, reply, ["owner", "admin", "organizer"])] }, async (request, reply) => {
    const { playerId } = request.body;

    // Check tournament exists and is in draft status
    const tournamentResult = await app.db.select({ id: tournaments.id, status: tournaments.status, clubId: tournaments.clubId }).from(tournaments).where(eq(tournaments.id, request.params.id)).limit(1);

    if (tournamentResult.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Tournament not found"
        });
      }

    const tournament = tournamentResult[0];

    let round1Id: string | null = null;

    if (tournament.status !== "draft") {
        // Allow adding players during first round
        if (tournament.status === "active") {
          // Check if round 1 exists and is incomplete
          const round1Result = await app.db.select({ id: rounds.id, status: rounds.status }).from(rounds).where(and(eq(rounds.tournamentId, request.params.id), eq(rounds.number, 1))).limit(1);

          if (round1Result.length === 0 || round1Result[0].status === "completed") {
            return reply.status(400).send({
              error: "ValidationError",
              message: "Can only add players during first round or in draft status"
            });
          }
          round1Id = round1Result[0].id;
          // Continue - allow adding player during first round
        } else {
          return reply.status(400).send({
            error: "ValidationError",
            message: "Can only add players to tournaments in draft status"
          });
        }
      }

    // Check player exists and belongs to the same club
    const playerResult = await app.db.select({ id: players.id, clubId: players.clubId }).from(players).where(eq(players.id, playerId)).limit(1);

    if (playerResult.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Player not found"
        });
      }

    const player = playerResult[0];

    if (player.clubId !== tournament.clubId) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Player belongs to a different club"
        });
      }

    // Check if player is already in tournament
    const existingResult = await app.db.select({ playerId: tournamentPlayers.playerId }).from(tournamentPlayers).where(and(eq(tournamentPlayers.tournamentId, request.params.id), eq(tournamentPlayers.playerId, playerId))).limit(1);

    if (existingResult.length > 0) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Player already in tournament"
        });
      }

    // Add player to tournament
    const result = await app.db.insert(tournamentPlayers).values({
      tournamentId: request.params.id,
      playerId: playerId,
      whiteCount: 0,
      blackCount: 0
    }).returning();

    // If adding during first round, handle pairing
    if (round1Id !== null) {
        // Find a bye (player with no match in round 1)
        const byeResult = await app.db.execute(sql`
          SELECT tp.player_id
          FROM tournament_players tp
          LEFT JOIN matches m ON m.white_player_id = tp.player_id OR m.black_player_id = tp.player_id
          WHERE tp.tournament_id = ${request.params.id}
            AND m.round_id = ${round1Id}
            AND m.id IS NULL
          LIMIT 1
        `);

        if (byeResult.rows.length > 0) {
          // Create match between new player and bye player
          const maxBoardResult = await app.db.select({ maxBoard: sql`COALESCE(MAX(${matches.boardNumber}), 0)`.mapWith(Number) }).from(matches).where(eq(matches.roundId, round1Id));
          const nextBoardNumber = (maxBoardResult[0]?.maxBoard || 0) + 1;

          await app.db.insert(matches).values({
            clubId: tournament.clubId,
            tournamentId: request.params.id,
            roundId: round1Id,
            whitePlayerId: (byeResult.rows[0] as any).player_id,
            blackPlayerId: playerId,
            boardNumber: nextBoardNumber,
            playedOn: new Date()
          });
        }
        // If no bye, new player gets a bye (no match created)
      }

    return reply.status(201).send({ tournamentPlayer: { tournamentId: result[0].tournamentId, playerId: result[0].playerId } });
    
  });

  app.post<{ Params: TournamentParams; Body: { displayName: string } }>("/tournaments/:id/players/new", { preHandler: [conditionalRequireAuth, (request, reply) => conditionalRequireTournamentClubRole(request, reply, ["owner", "admin", "organizer"])] }, async (request, reply) => {
    const { displayName } = request.body;

    if (!displayName || displayName.trim() === "") {
        return reply.status(400).send({
          error: "ValidationError",
          message: "displayName is required"
        });
      }

    // Get tournament details
    const tournamentResult = await app.db.select({ id: tournaments.id, status: tournaments.status, clubId: tournaments.clubId }).from(tournaments).where(eq(tournaments.id, request.params.id)).limit(1);

    if (tournamentResult.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Tournament not found"
        });
      }

    const tournament = tournamentResult[0];

    let round1Id: string | null = null;

    if (tournament.status !== "draft") {
        // Allow adding players during first round
        if (tournament.status === "active") {
          // Check if round 1 exists and is incomplete
          const round1Result = await app.db.select({ id: rounds.id, status: rounds.status }).from(rounds).where(and(eq(rounds.tournamentId, request.params.id), eq(rounds.number, 1))).limit(1);

          if (round1Result.length === 0 || round1Result[0].status === "completed") {
            return reply.status(400).send({
              error: "ValidationError",
              message: "Can only add players during first round or in draft status"
            });
          }
          round1Id = round1Result[0].id;
          // Continue - allow adding player during first round
        } else {
          return reply.status(400).send({
            error: "ValidationError",
            message: "Can only add players to tournaments in draft status"
          });
        }
      }

    // Create player
    const playerResult = await app.db.insert(players).values({
      clubId: tournament.clubId,
      displayName: displayName.trim(),
      active: true
    }).returning();

    const playerId = playerResult[0].id;

    // Create player ratings using the single rating config source of truth.
    await app.db.insert(playerRatings).values({
      playerId: playerId,
      clubId: tournament.clubId,
      elo: ratingConfig.defaultElo,
      glickoRating: ratingConfig.g2DefaultRating,
      glickoRd: ratingConfig.g2DefaultRd,
      glickoVol: ratingConfig.g2DefaultVol,
      gamesPlayed: 0
    });

    // Add to tournament
    const tournamentPlayerResult = await app.db.insert(tournamentPlayers).values({
      tournamentId: request.params.id,
      playerId: playerId,
      whiteCount: 0,
      blackCount: 0
    }).returning();

    // If adding during first round, handle pairing
    if (round1Id !== null) {
        // Find a bye (player with no match in round 1)
        const byeResult = await app.db.execute(sql`
          SELECT tp.player_id
          FROM tournament_players tp
          LEFT JOIN matches m ON m.white_player_id = tp.player_id OR m.black_player_id = tp.player_id
          WHERE tp.tournament_id = ${request.params.id}
            AND m.round_id = ${round1Id}
            AND m.id IS NULL
          LIMIT 1
        `);

        if (byeResult.rows.length > 0) {
          // Create match between new player and bye player
          const maxBoardResult = await app.db.select({ maxBoard: sql`COALESCE(MAX(${matches.boardNumber}), 0)`.mapWith(Number) }).from(matches).where(eq(matches.roundId, round1Id));
          const nextBoardNumber = (maxBoardResult[0]?.maxBoard || 0) + 1;

          await app.db.insert(matches).values({
            clubId: tournament.clubId,
            tournamentId: request.params.id,
            roundId: round1Id,
            whitePlayerId: (byeResult.rows[0] as any).player_id,
            blackPlayerId: playerId,
            boardNumber: nextBoardNumber,
            playedOn: new Date()
          });
        }
        // If no bye, new player gets a bye (no match created)
      }

    return reply.status(201).send({ tournamentPlayer: { tournamentId: tournamentPlayerResult[0]?.tournamentId, playerId: tournamentPlayerResult[0]?.playerId } });
    
  });

  app.delete<{ Params: TournamentParams & { playerId: string } }>("/tournaments/:id/players/:playerId", { preHandler: [conditionalRequireAuth, (request, reply) => conditionalRequireTournamentClubRole(request, reply, ["owner", "admin", "organizer"])] }, async (request, reply) => {
    // Check tournament exists and is in draft status
    const tournamentResult = await app.db.select({ id: tournaments.id, status: tournaments.status }).from(tournaments).where(eq(tournaments.id, request.params.id)).limit(1);

    if (tournamentResult.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Tournament not found"
        });
      }

    if (!tournamentResult[0] || tournamentResult[0].status !== "draft") {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Can only remove players from tournaments in draft status"
        });
      }

    if (!tournamentResult[0]) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Tournament not found"
        });
      }

    // Check player is in tournament
    const tournamentPlayerResult = await app.db.select({ tournamentId: tournamentPlayers.tournamentId, playerId: tournamentPlayers.playerId }).from(tournamentPlayers).where(and(eq(tournamentPlayers.tournamentId, request.params.id), eq(tournamentPlayers.playerId, request.params.playerId))).limit(1);

    if (tournamentPlayerResult.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Player not in tournament"
        });
      }

    // Remove player from tournament
    await app.db.delete(tournamentPlayers).where(and(eq(tournamentPlayers.tournamentId, request.params.id), eq(tournamentPlayers.playerId, request.params.playerId)));

    return reply.status(200).send({ message: "Player removed from tournament" });
    
  });

  app.put<{ Params: TournamentParams & { playerId: string }; Body: { droppedOutRound: number } }>("/tournaments/:id/players/:playerId/dropout", { preHandler: [conditionalRequireAuth, (request, reply) => conditionalRequireTournamentClubRole(request, reply, ["owner", "admin", "organizer"])] }, async (request, reply) => {
    const { droppedOutRound } = request.body;

    // Check tournament exists and is active
    const tournamentResult = await app.db.select({ id: tournaments.id, status: tournaments.status }).from(tournaments).where(eq(tournaments.id, request.params.id)).limit(1);

    if (tournamentResult.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Tournament not found"
        });
      }

    if (!tournamentResult[0] || tournamentResult[0].status !== "active") {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Can only mark dropout for active tournaments"
        });
      }

    // Update player dropout round
    const result = await app.db.update(tournamentPlayers)
      .set({ droppedOutRound: droppedOutRound })
      .where(and(eq(tournamentPlayers.tournamentId, request.params.id), eq(tournamentPlayers.playerId, request.params.playerId)))
      .returning();

    if (result.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Player not found in tournament"
        });
      }

    if (!result[0]) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Player not found in tournament"
        });
      }

    return reply.status(200).send({ tournamentPlayer: { tournamentId: result[0].tournamentId, playerId: result[0].playerId, droppedOutRound: result[0].droppedOutRound } });
    
  });

  app.get<{ Params: TournamentParams }>("/tournaments/:id/players", { preHandler: [conditionalRequireAuth, (request, reply) => conditionalRequireTournamentClubRole(request, reply, ["owner", "admin", "organizer", "member"])] }, async (request, reply) => {
    const result = await app.db.execute(sql`
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
      WHERE tp.tournament_id = ${request.params.id}
      GROUP BY tp.player_id, p.display_name, tp.seed, tp.dropped_out_round, tp.white_count, tp.black_count
      ORDER BY points DESC, p.display_name ASC
    `);

    return { players: result.rows };
    
  });

  // Round management endpoints
  app.post<{ Params: TournamentParams; Body: { startsOn?: string } }>("/tournaments/:id/rounds", { preHandler: [conditionalRequireAuth, (request, reply) => conditionalRequireTournamentClubRole(request, reply, ["owner", "admin", "organizer"])] }, async (request, reply) => {
    const { startsOn } = request.body;
      
    // Get tournament details
    const tournamentResult = await app.db.select({ id: tournaments.id, status: tournaments.status, format: tournaments.format, clubId: tournaments.clubId, pairingMethod: tournaments.pairingMethod, totalRounds: tournaments.totalRounds }).from(tournaments).where(eq(tournaments.id, request.params.id)).limit(1);

    if (tournamentResult.length === 0 || !tournamentResult[0]) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Tournament not found"
        });
      }

    const tournament = tournamentResult[0];

    if (tournament.format !== "swiss") {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Round generation only supported for Swiss tournaments"
        });
      }

    // Get the last round number
    const lastRoundResult = await app.db.select({ maxRound: sql`MAX(${rounds.number})`.mapWith(Number) }).from(rounds).where(eq(rounds.tournamentId, request.params.id));

    const nextRoundNumber = (lastRoundResult[0]?.maxRound || 0) + 1;

    // Check if total rounds limit is reached
    if (tournament.totalRounds && nextRoundNumber > tournament.totalRounds) {
        return reply.status(400).send({
          error: "ValidationError",
          message: `Cannot generate more rounds. Tournament has ${tournament.totalRounds} total rounds.`
        });
      }

    // Check if all matches in previous rounds have results
    const incompleteMatchesResult = await app.db.select({ count: sql`COUNT(*)`.mapWith(Number) }).from(matches)
      .innerJoin(rounds, eq(rounds.id, matches.roundId))
      .where(and(eq(rounds.tournamentId, request.params.id), isNull(matches.result)));

    if ((incompleteMatchesResult[0]?.count || 0) > 0) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Cannot generate new round while previous matches have no results"
        });
      }

    // Generate Swiss pairings
    const pairings = await generateSwissPairings(app.db, request.params.id, nextRoundNumber, {
        pairingMethod: tournament.pairingMethod || "seeded_by_rating",
        roundNumber: nextRoundNumber
      });

    if (pairings.length === 0) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Unable to generate pairings - not enough players or all players dropped out"
        });
      }

    // Create round with start date (default to NOW() if not provided)
    const startsOnValue = startsOn ? new Date(startsOn) : new Date();
    const roundResult = await app.db.insert(rounds).values({
      tournamentId: request.params.id,
      number: nextRoundNumber,
      status: "scheduled",
      startsOn: startsOnValue
    }).returning();

    const roundId = roundResult[0].id;

    // Create matches
    for (const pairing of pairings) {
        // For bye matches (blackPlayerId is null), set result to 1 (win) immediately
        const isBye = pairing.blackPlayerId === null;
        const result = isBye ? 1 : null;

        await app.db.insert(matches).values({
          clubId: tournament.clubId,
          tournamentId: request.params.id,
          roundId: roundId,
          whitePlayerId: pairing.whitePlayerId,
          blackPlayerId: pairing.blackPlayerId,
          boardNumber: pairing.boardNumber,
          playedOn: new Date().toISOString(),
          result: result
        });

        // Update color counts (only for real matches, not byes)
        if (!isBye && pairing.blackPlayerId) {
          await app.db.update(tournamentPlayers)
            .set({ whiteCount: sql`${tournamentPlayers.whiteCount} + 1` })
            .where(and(eq(tournamentPlayers.tournamentId, request.params.id), eq(tournamentPlayers.playerId, pairing.whitePlayerId)));

          await app.db.update(tournamentPlayers)
            .set({ blackCount: sql`${tournamentPlayers.blackCount} + 1` })
            .where(and(eq(tournamentPlayers.tournamentId, request.params.id), eq(tournamentPlayers.playerId, pairing.blackPlayerId!)));
        }
      }

    return reply.status(201).send({
        round: {
          id: roundId,
          number: nextRoundNumber,
          matches: pairings
        }
      });
    
  });

  app.put<{ Params: { id: string }; Body: { startsOn: string } }>("/rounds/:id/starts-on", { preHandler: [conditionalRequireAuth, async (request, reply) => {
    // Resolve club from round -> tournament
    const roundResult = await app.db.select({ tournamentId: rounds.tournamentId }).from(rounds).where(eq(rounds.id, request.params.id)).limit(1);
    if (roundResult.length === 0) {
        return reply.status(404).send({ error: "NotFound", message: "Round not found" });
      }
    const tournamentId = roundResult[0].tournamentId;
    const clubId = await resolveClubIdFromTournament(app.db, tournamentId);
    if (!clubId) {
        return reply.status(404).send({ error: "NotFound", message: "Tournament not found" });
      }
    const membership = request.user?.memberships.find(m => m.clubId === clubId);
    if (!membership) {
        return reply.status(403).send({ error: "Forbidden", message: "You are not a member of this club" });
      }
    if (!["owner", "admin", "organizer"].includes(membership.role)) {
        return reply.status(403).send({ error: "Forbidden", message: "Required role: owner, admin, or organizer" });
      }
  }] }, async (request, reply) => {
    const { startsOn } = request.body;

    if (!startsOn || isNaN(Date.parse(startsOn))) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "startsOn must be a valid date"
        });
      }

    const result = await app.db.update(rounds)
      .set({ startsOn: new Date(startsOn) })
      .where(eq(rounds.id, request.params.id))
      .returning();

    if (result.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Round not found"
        });
      }

    return reply.status(200).send({ round: { id: result[0]?.id, tournamentId: result[0]?.tournamentId, number: result[0]?.number, status: result[0]?.status, startsOn: result[0]?.startsOn } });
    
  });

  app.get<{ Params: TournamentParams }>("/tournaments/:id/rounds", { preHandler: [conditionalRequireAuth, (request, reply) => conditionalRequireTournamentClubRole(request, reply, ["owner", "admin", "organizer", "member"])] }, async (request, reply) => {
    const result = await app.db.execute(sql`
      SELECT
        r.id,
        r.number,
        r.status,
        r.starts_on AS "startsOn",
        r.created_at AS "createdAt",
        COUNT(m.id)::int AS "matchCount"
      FROM rounds r
      LEFT JOIN matches m ON m.round_id = r.id
      WHERE r.tournament_id = ${request.params.id}
      GROUP BY r.id
      ORDER BY r.number ASC
    `);

    return { rounds: result.rows };
    
  });

  app.delete<{ Params: { id: string } }>("/rounds/:id", { preHandler: [conditionalRequireAuth, async (request, reply) => {
    // Resolve club from round -> tournament
    const roundResult = await app.db.select({ tournamentId: rounds.tournamentId }).from(rounds).where(eq(rounds.id, request.params.id)).limit(1);
    if (roundResult.length === 0) {
        return reply.status(404).send({ error: "NotFound", message: "Round not found" });
      }
    const tournamentId = roundResult[0].tournamentId;
    const clubId = await resolveClubIdFromTournament(app.db, tournamentId);
    if (!clubId) {
        return reply.status(404).send({ error: "NotFound", message: "Tournament not found" });
      }
    const membership = request.user?.memberships.find(m => m.clubId === clubId);
    if (!membership) {
        return reply.status(403).send({ error: "Forbidden", message: "You are not a member of this club" });
      }
    if (!["owner", "admin", "organizer"].includes(membership.role)) {
        return reply.status(403).send({ error: "Forbidden", message: "Required role: owner, admin, or organizer" });
      }
    
  }] }, async (request, reply) => {
    // Check if round exists
    const roundResult = await app.db.select({ id: rounds.id }).from(rounds).where(eq(rounds.id, request.params.id)).limit(1);

    if (roundResult.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Round not found"
        });
      }

    // Check if any matches in the round have results (excluding bye matches)
    const matchesWithResultsResult = await app.db.select({ count: sql`COUNT(*)`.mapWith(Number) }).from(matches).where(and(eq(matches.roundId, request.params.id), isNotNull(matches.result), isNotNull(matches.blackPlayerId)));

    if ((matchesWithResultsResult[0]?.count || 0) > 0) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Cannot delete round with match results. Please undo match results first by setting them to null."
        });
      }

    // Delete all matches associated with the round
    await app.db.delete(matches).where(eq(matches.roundId, request.params.id));

    // Delete the round
    await app.db.delete(rounds).where(eq(rounds.id, request.params.id));

    return reply.status(204).send();
    
  });

  // Match result endpoints
  app.put<{ Params: { id: string }; Body: { result: number | null } }>("/matches/:id/result", { preHandler: [conditionalRequireAuth, async (request, reply) => {
    // Resolve club from match -> tournament
    const matchResult = await app.db.select({ tournamentId: matches.tournamentId }).from(matches).where(eq(matches.id, request.params.id)).limit(1);
    if (matchResult.length === 0) {
        return reply.status(404).send({ error: "NotFound", message: "Match not found" });
      }
    const tournamentId = matchResult[0].tournamentId;
    const clubId = await resolveClubIdFromTournament(app.db, tournamentId);
    if (!clubId) {
        return reply.status(404).send({ error: "NotFound", message: "Tournament not found" });
      }
    const membership = request.user?.memberships.find(m => m.clubId === clubId);
    if (!membership) {
        return reply.status(403).send({ error: "Forbidden", message: "You are not a member of this club" });
      }
    if (!["owner", "admin", "organizer"].includes(membership.role)) {
        return reply.status(403).send({ error: "Forbidden", message: "Required role: owner, admin, or organizer" });
      }
  }] }, async (request, reply) => {
    const { result } = request.body;

    if (result !== null && result !== 1 && result !== 0.5 && result !== 0) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "result must be 1 (white wins), 0.5 (draw), 0 (black wins), or null to undo"
        });
      }

    // Get match details with tournament status
    const matchResult = await app.db.select({
      id: matches.id,
      tournamentId: matches.tournamentId,
      whitePlayerId: matches.whitePlayerId,
      blackPlayerId: matches.blackPlayerId,
      clubId: matches.clubId,
      playedOn: matches.playedOn,
      tournamentStatus: tournaments.status
    }).from(matches)
    .innerJoin(tournaments, eq(tournaments.id, matches.tournamentId))
    .where(eq(matches.id, request.params.id))
    .limit(1);

    if (matchResult.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Match not found"
        });
      }

    const match = matchResult[0];

    if (match.tournamentStatus === "completed") {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Cannot update match result for completed tournament"
        });
      }

    // Validate: only allow updating the player's LAST game (no games after this one with results).
    // Bye matches are excluded since they don't affect ratings.
    const lastGameCheckResult = await app.db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM matches
         WHERE white_player_id = ${match.whitePlayerId} AND result IS NOT NULL AND black_player_id IS NOT NULL
         AND (played_on > ${match.playedOn} OR (played_on = ${match.playedOn} AND id > ${request.params.id}))) AS "whiteGamesAfter",
        (SELECT COUNT(*) FROM matches
         WHERE black_player_id = ${match.blackPlayerId} AND result IS NOT NULL
         AND (played_on > ${match.playedOn} OR (played_on = ${match.playedOn} AND id > ${request.params.id}))) AS "blackGamesAfter"
    `);

    const lastGameCheck = lastGameCheckResult.rows[0] as any;
    if (lastGameCheck.whiteGamesAfter > 0 || lastGameCheck.blackGamesAfter > 0) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "Can only update a player's last game. To update earlier games, rewind game by game."
        });
      }

    // Update match result
    const updatedMatchResult = await app.db.update(matches)
      .set({ result: result })
      .where(eq(matches.id, request.params.id))
      .returning();

    // Handle rating updates
    if (result === null) {
        // Undo: revert player ratings to stored "before" values from this match
        const matchAuditResult = await app.db.select({
          whiteEloBefore: matches.whiteEloBefore,
          blackEloBefore: matches.blackEloBefore,
          whiteGlickoRatingBefore: matches.whiteGlickoRatingBefore,
          whiteGlickoRdBefore: matches.whiteGlickoRdBefore,
          whiteGlickoVolBefore: matches.whiteGlickoVolBefore,
          blackGlickoRatingBefore: matches.blackGlickoRatingBefore,
          blackGlickoRdBefore: matches.blackGlickoRdBefore,
          blackGlickoVolBefore: matches.blackGlickoVolBefore
        }).from(matches).where(eq(matches.id, request.params.id)).limit(1);

        const matchAudit = matchAuditResult[0];

        if (matchAudit && matchAudit.whiteEloBefore !== null) {
          // Helper: derive last_game_date from MAX(played_on) of remaining real games for a player.
          const computeLastGameDate = async (playerId: string): Promise<string | null> => {
            const r = await app.db.select({ lastDate: sql<string | null>`MAX(${matches.playedOn})` }).from(matches)
              .where(and(
                or(eq(matches.whitePlayerId, playerId), eq(matches.blackPlayerId, playerId)),
                isNotNull(matches.result),
                isNotNull(matches.blackPlayerId),
                sql`${matches.id} <> ${request.params.id}`
              ));
            return r[0]?.lastDate || null;
          };

          // Revert white player rating
          await app.db.update(playerRatings)
            .set({
              elo: matchAudit.whiteEloBefore,
              glickoRating: matchAudit.whiteGlickoRatingBefore!,
              glickoRd: matchAudit.whiteGlickoRdBefore!,
              glickoVol: matchAudit.whiteGlickoVolBefore!,
              gamesPlayed: sql`${playerRatings.gamesPlayed} - 1`,
              lastGameDate: await computeLastGameDate(match.whitePlayerId)
            })
            .where(and(eq(playerRatings.playerId, match.whitePlayerId), eq(playerRatings.clubId, match.clubId)));

          // Revert black player rating
          if (match.blackPlayerId) {
            await app.db.update(playerRatings)
              .set({
                elo: matchAudit.blackEloBefore!,
                glickoRating: matchAudit.blackGlickoRatingBefore!,
                glickoRd: matchAudit.blackGlickoRdBefore!,
                glickoVol: matchAudit.blackGlickoVolBefore!,
                gamesPlayed: sql`${playerRatings.gamesPlayed} - 1`,
                lastGameDate: await computeLastGameDate(match.blackPlayerId)
              })
              .where(and(eq(playerRatings.playerId, match.blackPlayerId), eq(playerRatings.clubId, match.clubId)));
          }
        }
      } else {
        // Apply new rating
        const whiteRatingResult = await app.db.select({
          elo: playerRatings.elo,
          glickoRating: playerRatings.glickoRating,
          glickoRd: playerRatings.glickoRd,
          glickoVol: playerRatings.glickoVol,
          gamesPlayed: playerRatings.gamesPlayed
        }).from(playerRatings).where(and(eq(playerRatings.playerId, match.whitePlayerId), eq(playerRatings.clubId, match.clubId))).limit(1);

        const whiteRating = whiteRatingResult[0];

        const blackRatingResult = match.blackPlayerId ? await app.db.select({
          elo: playerRatings.elo,
          glickoRating: playerRatings.glickoRating,
          glickoRd: playerRatings.glickoRd,
          glickoVol: playerRatings.glickoVol,
          gamesPlayed: playerRatings.gamesPlayed
        }).from(playerRatings).where(and(eq(playerRatings.playerId, match.blackPlayerId), eq(playerRatings.clubId, match.clubId))).limit(1) : [];

        const blackRating = blackRatingResult[0];

        if (whiteRating && blackRating && match.blackPlayerId) {
          // Store "before" values for potential undo
          await app.db.update(matches)
            .set({
              whiteEloBefore: whiteRating.elo,
              blackEloBefore: blackRating.elo,
              whiteGlickoRatingBefore: whiteRating.glickoRating,
              whiteGlickoRdBefore: whiteRating.glickoRd,
              whiteGlickoVolBefore: whiteRating.glickoVol,
              blackGlickoRatingBefore: blackRating.glickoRating,
              blackGlickoRdBefore: blackRating.glickoRd,
              blackGlickoVolBefore: blackRating.glickoVol
            })
            .where(eq(matches.id, request.params.id));

          const whiteInput: RatingProfile = {
            elo: whiteRating.elo,
            glicko: {
              rating: whiteRating.glickoRating,
              rd: whiteRating.glickoRd,
              vol: whiteRating.glickoVol,
              lastGameDate: null
            },
            gamesPlayed: whiteRating.gamesPlayed,
            lastGameDate: null
          };

          const blackInput: RatingProfile = {
            elo: blackRating.elo,
            glicko: {
              rating: blackRating.glickoRating,
              rd: blackRating.glickoRd,
              vol: blackRating.glickoVol,
              lastGameDate: null
            },
            gamesPlayed: blackRating.gamesPlayed,
            lastGameDate: null
          };

          const { white: whiteNew, black: blackNew } = applyRatedMatch(
            whiteInput,
            blackInput,
            result,
            new Date(match.playedOn)
          );

          if (!blackNew) {
            // Defensive: applyRatedMatch only returns null black for byes,
            // which are excluded here because match.blackPlayerId is set.
            throw new Error("Unexpected null black rating from applyRatedMatch");
          }

          // Update white player rating
          await app.db.update(playerRatings)
            .set({
              elo: whiteNew.elo,
              glickoRating: whiteNew.glicko.rating,
              glickoRd: whiteNew.glicko.rd,
              glickoVol: whiteNew.glicko.vol,
              gamesPlayed: sql`${playerRatings.gamesPlayed} + 1`,
              lastGameDate: match.playedOn
            })
            .where(and(eq(playerRatings.playerId, match.whitePlayerId), eq(playerRatings.clubId, match.clubId)));

          // Update black player rating
          await app.db.update(playerRatings)
            .set({
              elo: blackNew.elo,
              glickoRating: blackNew.glicko.rating,
              glickoRd: blackNew.glicko.rd,
              glickoVol: blackNew.glicko.vol,
              gamesPlayed: sql`${playerRatings.gamesPlayed} + 1`,
              lastGameDate: match.playedOn
            })
            .where(and(eq(playerRatings.playerId, match.blackPlayerId), eq(playerRatings.clubId, match.clubId)));
        }
      }

    return reply.status(200).send({ match: { id: updatedMatchResult[0]?.id, result: updatedMatchResult[0]?.result } });
    
  });

  app.get<{ Params: { id: string } }>("/rounds/:id/matches", { preHandler: [conditionalRequireAuth, async (request, reply) => {
    // Resolve club from round -> tournament
    const roundResult = await app.db.select({ tournamentId: rounds.tournamentId }).from(rounds).where(eq(rounds.id, request.params.id)).limit(1);
    if (roundResult.length === 0) {
        return reply.status(404).send({ error: "NotFound", message: "Round not found" });
      }
    const tournamentId = roundResult[0].tournamentId;
    const clubId = await resolveClubIdFromTournament(app.db, tournamentId);
    if (!clubId) {
        return reply.status(404).send({ error: "NotFound", message: "Tournament not found" });
      }
    const membership = request.user?.memberships.find(m => m.clubId === clubId);
    if (!membership) {
        return reply.status(403).send({ error: "Forbidden", message: "You are not a member of this club" });
      }
    
  }] }, async (request, reply) => {
    const result = await app.db.execute(sql`
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
      WHERE m.round_id = ${request.params.id}
      ORDER BY m.board_number ASC
    `);

    return { matches: result.rows };
    
  });

  // Standings endpoint with Swiss tiebreakers
  app.get<{ Params: TournamentParams }>("/tournaments/:id/standings", { preHandler: [conditionalRequireAuth, (request, reply) => conditionalRequireTournamentClubRole(request, reply, ["owner", "admin", "organizer", "member"])] }, async (request, reply) => {
    const result = await app.db.execute(sql`
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
        COUNT(CASE WHEN m.black_player_id IS NOT NULL AND ((m.white_player_id = tp.player_id AND m.result = 1) OR (m.black_player_id = tp.player_id AND m.result = 0)) THEN 1 END)::int AS wins,
        COUNT(CASE WHEN m.black_player_id IS NOT NULL AND m.result = 0.5 THEN 1 END)::int AS draws,
        COUNT(CASE WHEN m.black_player_id IS NOT NULL AND ((m.white_player_id = tp.player_id AND m.result = 0) OR (m.black_player_id = tp.player_id AND m.result = 1)) THEN 1 END)::int AS losses,
        pr.elo,
        tp.dropped_out_round AS "droppedOutRound"
      FROM tournament_players tp
      JOIN players p ON p.id = tp.player_id
      JOIN player_ratings pr ON pr.player_id = tp.player_id
      LEFT JOIN matches m ON m.tournament_id = tp.tournament_id
        AND (m.white_player_id = tp.player_id OR m.black_player_id = tp.player_id)
        AND (m.result IS NOT NULL OR m.black_player_id IS NULL)
      WHERE tp.tournament_id = ${request.params.id}
      GROUP BY tp.player_id, p.display_name, pr.elo, tp.dropped_out_round
      ORDER BY points DESC, wins DESC, pr.elo DESC
    `);

    // Calculate tiebreakers (Buchholz, Sonneborn-Berger)
    const standings = result.rows.map((row: any) => ({
        ...row,
        buchholz: 0,
        sonnebornBerger: 0
      }));

    for (const standing of standings) {
        const opponentsResult = await app.db.execute(sql`
          SELECT
            CASE WHEN m.white_player_id = ${standing.playerId} THEN m.black_player_id ELSE m.white_player_id END AS "opponentId",
            CASE WHEN m.white_player_id = ${standing.playerId} THEN m.result ELSE 1 - m.result END AS "scoreFromOurSide",
            (
              SELECT COALESCE(SUM(
                CASE
                  WHEN m2.white_player_id = opp.id THEN COALESCE(m2.result, 0)
                  WHEN m2.black_player_id = opp.id THEN COALESCE(1 - m2.result, 0)
                  ELSE 0
                END
              ), 0)
              FROM matches m2
              CROSS JOIN (SELECT CASE WHEN m.white_player_id = ${standing.playerId} THEN m.black_player_id ELSE m.white_player_id END AS id) opp
              WHERE (m2.white_player_id = opp.id OR m2.black_player_id = opp.id)
                AND m2.tournament_id = ${request.params.id}
                AND m2.result IS NOT NULL
            ) AS "opponentPoints"
          FROM matches m
          WHERE (m.white_player_id = ${standing.playerId} OR m.black_player_id = ${standing.playerId})
            AND m.tournament_id = ${request.params.id}
            AND m.result IS NOT NULL
            AND m.black_player_id IS NOT NULL
        `);

        let buchholz = 0;
        let sonnebornBerger = 0;

        for (const row of opponentsResult.rows) {
          const oppPts = parseFloat((row as any).opponentPoints) || 0;
          const ourScore = parseFloat((row as any).scoreFromOurSide);
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
      standings.sort((a: any, b: any) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
        if (b.sonnebornBerger !== a.sonnebornBerger) return b.sonnebornBerger - a.sonnebornBerger;
        return b.elo - a.elo;
      });

    return { standings };
    
  });

  return app;
}
