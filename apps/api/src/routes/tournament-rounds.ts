import Fastify, { type FastifyInstance } from "fastify";
import { eq, and, or, isNull, isNotNull, sql } from "drizzle-orm";
import { tournaments, rounds, matches, tournamentPlayers, playerRatings, players } from "@chess-club/db";
import { generateSwissPairings } from "../lib/swiss-pairing.js";
import { resolveClubIdFromTournament } from "../lib/auth/rbac.js";
import { applyRatedMatch, type RatingProfile } from "../lib/ratings/ratings.js";

interface TournamentParams {
  id: string;
}

export async function registerTournamentRoundsRoutes(app: FastifyInstance) {
  const REQUIRE_AUTH = process.env.REQUIRE_AUTH === "true";

  const conditionalRequireAuth = async (request: any, reply: any) => {
    if (!REQUIRE_AUTH) return;
    // Auth is handled by the RequireAuth plugin in production
  };

  const conditionalRequireTournamentClubRole = (request: any, reply: any, roles: string[]) => {
    if (!REQUIRE_AUTH) return;
    const user = request.user;
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized", message: "Authentication required" });
    }
    // Role checking is handled by the middleware
  };

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
}
