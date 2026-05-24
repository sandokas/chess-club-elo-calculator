import type { FastifyInstance } from "fastify";
import { eq, and, sql, isNull } from "drizzle-orm";
import { tournaments, players, tournamentPlayers, matches, rounds, playerRatings } from "@chess-club/db";
import { addPlayerToTournamentSchema, createPlayerInTournamentSchema, updateTournamentPlayerSchema } from "../lib/schemas/tournament-player.js";
import { parseBody } from "../lib/validate.js";
import { createNotFoundError, createValidationError } from "../lib/errors.js";
import { ratingConfig } from "@chess-club/config";

const todayAsDateString = () => new Date().toISOString().slice(0, 10);

type TournamentParams = {
  id: string;
};

export async function registerTournamentPlayerRoutes(app: FastifyInstance) {
  // Add existing player to tournament
  app.post<{ Params: TournamentParams; Body: { playerId: string } }>("/tournaments/:id/players", { preHandler: [app.auth.requireTournamentClubRole("organizer")] }, async (request, reply) => {
    const body = parseBody(addPlayerToTournamentSchema, request.body);
    const { playerId } = body;
    const tournamentId = request.params.id;

    // Check tournament exists
    const tournamentResult = await app.db.select({ id: tournaments.id, status: tournaments.status, clubId: tournaments.clubId }).from(tournaments).where(eq(tournaments.id, tournamentId)).limit(1);

    if (tournamentResult.length === 0) {
      throw createNotFoundError("Tournament not found");
    }

    const tournament = tournamentResult[0];

    if (!tournament) {
      throw createNotFoundError("Tournament not found");
    }

    let round1Id: string | null = null;

    if (tournament.status !== "draft") {
      // Allow adding players during first round
      if (tournament.status === "active") {
        // Check if round 1 exists and is incomplete
        const round1Result = await app.db.select({ id: rounds.id, status: rounds.status }).from(rounds).where(and(eq(rounds.tournamentId, tournamentId), eq(rounds.number, 1))).limit(1);

        if (round1Result.length === 0 || !round1Result[0] || round1Result[0].status === "completed") {
          throw createValidationError("Can only add players during first round or in draft status");
        }
        round1Id = round1Result[0]?.id || null;
      } else {
        throw createValidationError("Can only add players to tournaments in draft status");
      }
    }

    // Check player exists and belongs to the same club
    const playerResult = await app.db.select({ id: players.id, clubId: players.clubId }).from(players).where(eq(players.id, playerId)).limit(1);

    if (playerResult.length === 0) {
      throw createNotFoundError("Player not found");
    }

    const player = playerResult[0];

    if (!player) {
      throw createNotFoundError("Player not found");
    }

    if (player.clubId !== tournament.clubId) {
      throw createValidationError("Player belongs to a different club");
    }

    // Check if player is already in tournament
    const existingResult = await app.db.select({ playerId: tournamentPlayers.playerId }).from(tournamentPlayers).where(and(eq(tournamentPlayers.tournamentId, tournamentId), eq(tournamentPlayers.playerId, playerId))).limit(1);

    if (existingResult.length > 0) {
      throw createValidationError("Player already in tournament");
    }

    // Add player to tournament
    const result = await app.db.insert(tournamentPlayers).values({
      tournamentId: tournamentId,
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
        WHERE tp.tournament_id = ${tournamentId}
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
          tournamentId: tournamentId,
          roundId: round1Id,
          whitePlayerId: (byeResult.rows[0] as any).player_id,
          blackPlayerId: playerId,
          boardNumber: nextBoardNumber,
          playedOn: todayAsDateString()
        });
      }
    }

    return reply.status(201).send({ tournamentPlayer: { tournamentId: result[0]?.tournamentId, playerId: result[0]?.playerId } });
  });

  // Create new player and add to tournament
  app.post<{ Params: TournamentParams; Body: { displayName: string } }>("/tournaments/:id/players/new", { preHandler: [app.auth.requireTournamentClubRole("organizer")] }, async (request, reply) => {
    const body = parseBody(createPlayerInTournamentSchema, request.body);
    const { displayName } = body;
    const tournamentId = request.params.id;

    // Get tournament details
    const tournamentResult = await app.db.select({ id: tournaments.id, status: tournaments.status, clubId: tournaments.clubId }).from(tournaments).where(eq(tournaments.id, tournamentId)).limit(1);

    if (tournamentResult.length === 0) {
      throw createNotFoundError("Tournament not found");
    }

    const tournament = tournamentResult[0];

    if (!tournament) {
      throw createNotFoundError("Tournament not found");
    }

    let round1Id: string | null = null;

    if (tournament.status !== "draft") {
      // Allow adding players during first round
      if (tournament.status === "active") {
        // Check if round 1 exists and is incomplete
        const round1Result = await app.db.select({ id: rounds.id, status: rounds.status }).from(rounds).where(and(eq(rounds.tournamentId, tournamentId), eq(rounds.number, 1))).limit(1);

        if (round1Result.length === 0 || !round1Result[0] || round1Result[0].status === "completed") {
          throw createValidationError("Can only add players during first round or in draft status");
        }
        round1Id = round1Result[0]?.id || null;
      } else {
        throw createValidationError("Can only add players to tournaments in draft status");
      }
    }

    // Create player
    const playerResult = await app.db.insert(players).values({
      clubId: tournament.clubId,
      displayName: displayName.trim(),
      active: true
    }).returning();

    const playerId = playerResult[0]?.id;
    
    if (!playerId) {
      throw createNotFoundError("Failed to create player");
    }

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
      tournamentId: tournamentId,
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
        WHERE tp.tournament_id = ${tournamentId}
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
          tournamentId: tournamentId,
          roundId: round1Id,
          whitePlayerId: (byeResult.rows[0] as any).player_id,
          blackPlayerId: playerId,
          boardNumber: nextBoardNumber,
          playedOn: todayAsDateString()
        });
      }
    }

    return reply.status(201).send({ tournamentPlayer: { tournamentId: tournamentPlayerResult[0]?.tournamentId, playerId: tournamentPlayerResult[0]?.playerId } });
  });

  // Remove player from tournament
  app.delete<{ Params: TournamentParams & { playerId: string } }>("/tournaments/:id/players/:playerId", { preHandler: [app.auth.requireTournamentClubRole("organizer")] }, async (request, reply) => {
    const { id: tournamentId, playerId } = request.params;

    // Check tournament exists and is in draft status
    const tournamentResult = await app.db.select({ id: tournaments.id, status: tournaments.status }).from(tournaments).where(eq(tournaments.id, tournamentId)).limit(1);

    if (tournamentResult.length === 0 || !tournamentResult[0]) {
      throw createNotFoundError("Tournament not found");
    }

    if (tournamentResult[0]?.status !== "draft") {
      throw createValidationError("Can only remove players from tournaments in draft status");
    }

    const tournamentPlayerResult = await app.db.select({ tournamentId: tournamentPlayers.tournamentId, playerId: tournamentPlayers.playerId }).from(tournamentPlayers).where(and(eq(tournamentPlayers.tournamentId, tournamentId), eq(tournamentPlayers.playerId, playerId))).limit(1);

    if (tournamentPlayerResult.length === 0) {
      throw createNotFoundError("Player not in tournament");
    }

    await app.db.delete(tournamentPlayers).where(and(eq(tournamentPlayers.tournamentId, tournamentId), eq(tournamentPlayers.playerId, playerId)));

    return reply.status(200).send({ message: "Player removed from tournament successfully" });
  });

  // Mark player as dropout
  app.put<{ Params: TournamentParams & { playerId: string }; Body: { droppedOutRound: number } }>("/tournaments/:id/players/:playerId/dropout", { preHandler: [app.auth.requireTournamentClubRole("organizer")] }, async (request, reply) => {
    const body = parseBody(updateTournamentPlayerSchema, request.body);
    const { droppedOutRound } = body;
    const { id: tournamentId, playerId } = request.params;

    // Check tournament exists and is active
    const tournamentResult = await app.db.select({ id: tournaments.id, status: tournaments.status }).from(tournaments).where(eq(tournaments.id, tournamentId)).limit(1);

    if (tournamentResult.length === 0 || !tournamentResult[0]) {
      throw createNotFoundError("Tournament not found");
    }

    const tournament = tournamentResult[0];

    if (!tournament) {
      throw createNotFoundError("Tournament not found");
    }

    if (tournament.status !== "active") {
      throw createValidationError("Can only mark dropout for active tournaments");
    }

    const result = await app.db.update(tournamentPlayers)
      .set({ droppedOutRound })
      .where(and(eq(tournamentPlayers.tournamentId, tournamentId), eq(tournamentPlayers.playerId, playerId)))
      .returning();

    if (result.length === 0) {
      throw createNotFoundError("Player not in tournament");
    }

    return reply.status(200).send({ tournamentPlayer: { tournamentId: result[0]?.tournamentId, playerId: result[0]?.playerId, droppedOutRound: result[0]?.droppedOutRound } });
  });

  // List tournament players
  app.get<{ Params: TournamentParams }>("/tournaments/:id/players", { preHandler: [app.auth.requireTournamentClubRole("member")] }, async (request, reply) => {
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

    return reply.send({ players: result.rows });
  });
}
