import { type FastifyInstance } from "fastify";
import { eq, and, isNull, isNotNull, sql } from "drizzle-orm";
import { tournaments, rounds, matches, tournamentPlayers } from "@chess-club/db";
import { generateSwissPairings } from "../lib/swiss-pairing.js";
import { updateMatchResult } from "../services/tournaments.js";

interface TournamentParams {
  id: string;
}

export async function registerTournamentRoundsRoutes(app: FastifyInstance) {
  // Round management endpoints
  app.post<{ Params: TournamentParams; Body: { startsOn?: string } }>("/tournaments/:id/rounds", { preHandler: [app.auth.requireTournamentClubRole("organizer")] }, async (request, reply) => {
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

    const [round] = roundResult;
    if (!round) {
      throw new Error("Failed to create round");
    }
    const roundId = round.id;

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
          playedOn: new Date().toISOString().slice(0, 10),
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

  app.put<{ Params: { id: string }; Body: { startsOn: string } }>("/rounds/:id/starts-on", { preHandler: [app.auth.requireRoundClubRole("organizer")] }, async (request, reply) => {
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

  app.get<{ Params: TournamentParams }>("/tournaments/:id/rounds", { preHandler: [app.auth.requireTournamentClubRole("member")] }, async (request, reply) => {
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

  app.delete<{ Params: { id: string } }>("/rounds/:id", { preHandler: [app.auth.requireRoundClubRole("organizer")] }, async (request, reply) => {
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
  app.put<{ Params: { id: string }; Body: { result: number | null } }>("/matches/:id/result", { preHandler: [app.auth.requireMatchClubRole("organizer")] }, async (request, reply) => {
    const { result } = request.body;

    if (result !== null && result !== 1 && result !== 0.5 && result !== 0) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "result must be 1 (white wins), 0.5 (draw), 0 (black wins), or null to undo"
        });
      }

    const updateResult = await updateMatchResult(app.db, request.params.id, result);
    if (!updateResult) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Match not found"
        });
      }

    if ("error" in updateResult) {
        return reply.status(400).send({
          error: updateResult.error,
          message: updateResult.message
        });
      }

    return reply.status(200).send(updateResult);
    
  });

  app.get<{ Params: { id: string } }>("/rounds/:id/matches", { preHandler: [app.auth.requireRoundClubRole("member")] }, async (request, reply) => {
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
}
