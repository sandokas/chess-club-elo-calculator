import type { Db } from "@chess-club/db";
import { eq, and, sql, isNull, isNotNull, or, asc, desc } from "drizzle-orm";
import { clubs, players, playerRatings, tournaments, tournamentPlayers, matches, rounds } from "@chess-club/db";
import { ratingConfig } from "@chess-club/config";
import { generateSwissPairings } from "../lib/swiss-pairing.js";
import { applyRatedMatch, type RatingProfile } from "../lib/ratings/ratings.js";
import { matchRatingAuditValues } from "../lib/ratings/audit.js";

export async function listTournaments(
  db: Db,
  clubId: string,
  page: number,
  limit: number,
  sortBy: string,
  sortOrder: string,
  filters: Array<any>
) {
  const countResult = await db.select({ count: sql`count(*)` }).from(tournaments)
    .where(and(
      eq(tournaments.clubId, clubId),
      ...filters
    ));
  const total = Number(countResult[0]?.count || 0);
  const totalPages = Math.ceil(total / limit);

  const offset = (page - 1) * limit;

  const result = await db.select({
    id: tournaments.id,
    name: tournaments.name,
    startsOn: tournaments.startsOn,
    format: tournaments.format,
    status: tournaments.status,
    legacyId: tournaments.legacyId,
    playerCount: sql<number>`COUNT(DISTINCT ${tournamentPlayers.playerId})`.mapWith(Number),
    matchCount: sql<number>`COUNT(DISTINCT ${matches.id})`.mapWith(Number)
  }).from(tournaments)
    .leftJoin(tournamentPlayers, eq(tournamentPlayers.tournamentId, tournaments.id))
    .leftJoin(matches, eq(matches.tournamentId, tournaments.id))
    .where(and(
      eq(tournaments.clubId, clubId),
      ...filters
    ))
    .groupBy(tournaments.id)
    .orderBy(
      (() => {
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

  return { tournaments: result, pagination: { page, limit, total, totalPages } };
}

export async function getTournamentById(db: Db, tournamentId: string) {
  const tournamentResult = await db.execute(sql`
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
    WHERE t.id = ${tournamentId}
    GROUP BY t.id
  `);

  if (tournamentResult.rows.length === 0) {
    return null;
  }

  const tournament = tournamentResult.rows[0];

  const matchesResult = await db.execute(sql`
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
    WHERE m.tournament_id = ${tournamentId}
    ORDER BY r.number ASC NULLS LAST, m.board_number ASC NULLS LAST, m.played_on ASC, m.id ASC
  `);

  const standingsResult = await db.execute(sql`
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
    WHERE tp.tournament_id = ${tournamentId}
    GROUP BY p.id
  `);

  const pointsById = new Map<string, number>(
    standingsResult.rows.map((r: any) => [r.playerId, r.points])
  );
  const oppQuery = await db.execute(sql`
    SELECT
      tp.player_id AS "playerId",
      CASE WHEN m.white_player_id = tp.player_id THEN m.black_player_id ELSE m.white_player_id END AS "opponentId",
      CASE WHEN m.white_player_id = tp.player_id THEN m.result ELSE 1 - m.result END AS "scoreFromOurSide"
    FROM tournament_players tp
    JOIN matches m ON m.tournament_id = tp.tournament_id
      AND (m.white_player_id = tp.player_id OR m.black_player_id = tp.player_id)
      AND m.result IS NOT NULL
      AND m.black_player_id IS NOT NULL
    WHERE tp.tournament_id = ${tournamentId}
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

  standingsResult.rows.sort((a: any, b: any) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
    if (b.sonnebornBerger !== a.sonnebornBerger)
      return b.sonnebornBerger - a.sonnebornBerger;
    return b.wins - a.wins;
  });

  const tournamentPlayersResult = await db.execute(sql`
    SELECT
      tp.player_id AS "playerId",
      p.display_name AS "displayName"
    FROM tournament_players tp
    JOIN players p ON p.id = tp.player_id
    WHERE tp.tournament_id = ${tournamentId}
  `);

  return {
    tournament,
    matches: matchesResult.rows,
    standings: standingsResult.rows,
    tournamentPlayers: tournamentPlayersResult.rows
  };
}

export async function getTournamentStandings(db: Db, tournamentId: string) {
  const result = await db.execute(sql`
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
    WHERE tp.tournament_id = ${tournamentId}
    GROUP BY tp.player_id, p.display_name, pr.elo, tp.dropped_out_round
    ORDER BY points DESC, wins DESC, pr.elo DESC
  `);

  const standings = result.rows.map((row: any) => ({
    ...row,
    buchholz: 0,
    sonnebornBerger: 0
  }));

  for (const standing of standings) {
    const opponentsResult = await db.execute(sql`
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
            AND m2.tournament_id = ${tournamentId}
            AND m2.result IS NOT NULL
        ) AS "opponentPoints"
      FROM matches m
      WHERE (m.white_player_id = ${standing.playerId} OR m.black_player_id = ${standing.playerId})
        AND m.tournament_id = ${tournamentId}
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

  standings.sort((a: any, b: any) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
    if (b.sonnebornBerger !== a.sonnebornBerger) return b.sonnebornBerger - a.sonnebornBerger;
    return b.elo - a.elo;
  });

  return { standings };
}

export async function getTournamentPlayers(db: Db, tournamentId: string) {
  const result = await db.execute(sql`
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
    WHERE tp.tournament_id = ${tournamentId}
    GROUP BY tp.player_id, p.display_name, tp.seed, tp.dropped_out_round, tp.white_count, tp.black_count
    ORDER BY points DESC, p.display_name ASC
  `);

  return { players: result.rows };
}

export async function getTournamentRounds(db: Db, tournamentId: string) {
  const result = await db.execute(sql`
    SELECT
      r.id,
      r.number,
      r.status,
      r.starts_on AS "startsOn",
      r.created_at AS "createdAt",
      COUNT(m.id)::int AS "matchCount"
    FROM rounds r
    LEFT JOIN matches m ON m.round_id = r.id
    WHERE r.tournament_id = ${tournamentId}
    GROUP BY r.id
    ORDER BY r.number ASC
  `);

  return { rounds: result.rows };
}

export async function getRoundMatches(db: Db, roundId: string) {
  const result = await db.execute(sql`
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
    WHERE m.round_id = ${roundId}
    ORDER BY m.board_number ASC
  `);

  return { matches: result.rows };
}

export async function updateMatchResult(
  db: Db,
  matchId: string,
  result: number | null
) {
  return db.transaction((tx) => updateMatchResultInTransaction(tx, matchId, result));
}

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function updateMatchResultInTransaction(
  tx: DbTransaction,
  matchId: string,
  result: number | null
) {
  const matchIdentity = await tx.select({ clubId: matches.clubId })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);

  if (!matchIdentity[0]) {
    return null;
  }

  // Serialize rating mutations within a club. Different clubs can still
  // process results concurrently.
  await tx.execute(sql`SELECT id FROM clubs WHERE id = ${matchIdentity[0].clubId} FOR UPDATE`);

  const matchResult = await tx.select({
    id: matches.id,
    tournamentId: matches.tournamentId,
    whitePlayerId: matches.whitePlayerId,
    blackPlayerId: matches.blackPlayerId,
    clubId: matches.clubId,
    playedOn: matches.playedOn,
    result: matches.result,
    whiteEloBefore: matches.whiteEloBefore,
    blackEloBefore: matches.blackEloBefore,
    whiteGlickoRatingBefore: matches.whiteGlickoRatingBefore,
    whiteGlickoRdBefore: matches.whiteGlickoRdBefore,
    whiteGlickoVolBefore: matches.whiteGlickoVolBefore,
    blackGlickoRatingBefore: matches.blackGlickoRatingBefore,
    blackGlickoRdBefore: matches.blackGlickoRdBefore,
    blackGlickoVolBefore: matches.blackGlickoVolBefore,
    whiteLastPlayedBefore: matches.whiteLastPlayedBefore,
    blackLastPlayedBefore: matches.blackLastPlayedBefore,
    tournamentStatus: tournaments.status
  }).from(matches)
    .innerJoin(tournaments, eq(tournaments.id, matches.tournamentId))
    .where(eq(matches.id, matchId))
    .limit(1);

  const [match] = matchResult;
  if (!match) {
    return null;
  }

  if (match.tournamentStatus === "completed") {
    return { error: "ValidationError", message: "Cannot update match result for completed tournament" };
  }

  if (match.result === result) {
    return { match: { id: match.id, result: match.result } };
  }

  const lastGameCheckResult = await tx.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM matches
       WHERE (white_player_id = ${match.whitePlayerId} OR black_player_id = ${match.whitePlayerId})
       AND result IS NOT NULL AND black_player_id IS NOT NULL
       AND (played_on > ${match.playedOn} OR (played_on = ${match.playedOn} AND id > ${matchId}))) AS "whiteGamesAfter",
      (SELECT COUNT(*) FROM matches
       WHERE (white_player_id = ${match.blackPlayerId} OR black_player_id = ${match.blackPlayerId})
       AND result IS NOT NULL AND black_player_id IS NOT NULL
       AND (played_on > ${match.playedOn} OR (played_on = ${match.playedOn} AND id > ${matchId}))) AS "blackGamesAfter"
  `);

  const lastGameCheck = lastGameCheckResult.rows[0] as any;
  if (Number(lastGameCheck.whiteGamesAfter) > 0 || Number(lastGameCheck.blackGamesAfter) > 0) {
    return { error: "ValidationError", message: "Can only update a player's last game. To update earlier games, rewind game by game." };
  }

  // Byes are recorded for standings but never enter the rating chain.
  if (!match.blackPlayerId) {
    const [updatedBye] = await tx.update(matches)
      .set({ result, ...matchRatingAuditValues(null) })
      .where(eq(matches.id, matchId))
      .returning({ id: matches.id, result: matches.result });
    return { match: updatedBye! };
  }

  const whiteRatingResult = await tx.select({
      elo: playerRatings.elo,
      glickoRating: playerRatings.glickoRating,
      glickoRd: playerRatings.glickoRd,
      glickoVol: playerRatings.glickoVol,
      gamesPlayed: playerRatings.gamesPlayed,
      lastGameDate: playerRatings.lastGameDate
    }).from(playerRatings).where(and(eq(playerRatings.playerId, match.whitePlayerId), eq(playerRatings.clubId, match.clubId))).limit(1);

  const blackRatingResult = await tx.select({
    elo: playerRatings.elo,
    glickoRating: playerRatings.glickoRating,
    glickoRd: playerRatings.glickoRd,
    glickoVol: playerRatings.glickoVol,
    gamesPlayed: playerRatings.gamesPlayed,
    lastGameDate: playerRatings.lastGameDate
  }).from(playerRatings).where(and(eq(playerRatings.playerId, match.blackPlayerId), eq(playerRatings.clubId, match.clubId))).limit(1);

  const whiteRating = whiteRatingResult[0];
  const blackRating = blackRatingResult[0];
  if (!whiteRating || !blackRating) {
    throw new Error("Match player rating row not found");
  }

  const isReplacement = match.result !== null;
  const hasRollbackAudit =
    match.whiteEloBefore !== null &&
    match.blackEloBefore !== null &&
    match.whiteGlickoRatingBefore !== null &&
    match.whiteGlickoRdBefore !== null &&
    match.whiteGlickoVolBefore !== null &&
    match.blackGlickoRatingBefore !== null &&
    match.blackGlickoRdBefore !== null &&
    match.blackGlickoVolBefore !== null;

  if (isReplacement && !hasRollbackAudit) {
    return { error: "ValidationError", message: "Match rating audit is incomplete. Recompute club ratings before changing this result." };
  }

  const whiteInput: RatingProfile = isReplacement ? {
    elo: match.whiteEloBefore!,
    glicko: {
      rating: match.whiteGlickoRatingBefore!,
      rd: match.whiteGlickoRdBefore!,
      vol: match.whiteGlickoVolBefore!,
      lastGameDate: match.whiteLastPlayedBefore
    },
    gamesPlayed: Math.max(0, whiteRating.gamesPlayed - 1),
    lastGameDate: match.whiteLastPlayedBefore
  } : {
    elo: whiteRating.elo,
    glicko: {
      rating: whiteRating.glickoRating,
      rd: whiteRating.glickoRd,
      vol: whiteRating.glickoVol,
      lastGameDate: whiteRating.lastGameDate
    },
    gamesPlayed: whiteRating.gamesPlayed,
    lastGameDate: whiteRating.lastGameDate
  };

  const blackInput: RatingProfile = isReplacement ? {
    elo: match.blackEloBefore!,
    glicko: {
      rating: match.blackGlickoRatingBefore!,
      rd: match.blackGlickoRdBefore!,
      vol: match.blackGlickoVolBefore!,
      lastGameDate: match.blackLastPlayedBefore
    },
    gamesPlayed: Math.max(0, blackRating.gamesPlayed - 1),
    lastGameDate: match.blackLastPlayedBefore
  } : {
    elo: blackRating.elo,
    glicko: {
      rating: blackRating.glickoRating,
      rd: blackRating.glickoRd,
      vol: blackRating.glickoVol,
      lastGameDate: blackRating.lastGameDate
    },
    gamesPlayed: blackRating.gamesPlayed,
    lastGameDate: blackRating.lastGameDate
  };

  const previousMatchId = async (playerId: string) => {
    const previous = await tx.select({ id: matches.id })
      .from(matches)
      .where(and(
        or(eq(matches.whitePlayerId, playerId), eq(matches.blackPlayerId, playerId)),
        isNotNull(matches.result),
        isNotNull(matches.blackPlayerId),
        sql`${matches.id} <> ${matchId}`,
        sql`(${matches.playedOn} < ${match.playedOn} OR (${matches.playedOn} = ${match.playedOn} AND ${matches.id} < ${matchId}))`
      ))
      .orderBy(desc(matches.playedOn), desc(matches.id))
      .limit(1);
    return previous[0]?.id ?? null;
  };

  if (result === null) {
    const whitePreviousMatchId = await previousMatchId(match.whitePlayerId);
    const blackPreviousMatchId = await previousMatchId(match.blackPlayerId);

    await tx.update(matches)
      .set({ result: null, ...matchRatingAuditValues(null) })
      .where(eq(matches.id, matchId));

    await tx.update(playerRatings).set({
      elo: whiteInput.elo,
      glickoRating: whiteInput.glicko.rating,
      glickoRd: whiteInput.glicko.rd,
      glickoVol: whiteInput.glicko.vol,
      gamesPlayed: whiteInput.gamesPlayed,
      lastGameDate: whiteInput.lastGameDate,
      lastGameMatchId: whitePreviousMatchId,
      updatedAt: new Date()
    }).where(and(eq(playerRatings.playerId, match.whitePlayerId), eq(playerRatings.clubId, match.clubId)));

    await tx.update(playerRatings).set({
      elo: blackInput.elo,
      glickoRating: blackInput.glicko.rating,
      glickoRd: blackInput.glicko.rd,
      glickoVol: blackInput.glicko.vol,
      gamesPlayed: blackInput.gamesPlayed,
      lastGameDate: blackInput.lastGameDate,
      lastGameMatchId: blackPreviousMatchId,
      updatedAt: new Date()
    }).where(and(eq(playerRatings.playerId, match.blackPlayerId), eq(playerRatings.clubId, match.clubId)));

    return { match: { id: match.id, result: null } };
  }

  const applied = applyRatedMatch(whiteInput, blackInput, result, new Date(match.playedOn), ratingConfig);
  if (!applied.black) {
    throw new Error("Unexpected null black rating from applyRatedMatch");
  }

  const [updatedMatch] = await tx.update(matches)
    .set({ result, ...matchRatingAuditValues(applied.audit) })
    .where(eq(matches.id, matchId))
    .returning({ id: matches.id, result: matches.result });
  if (!updatedMatch) {
    throw new Error("Failed to update match result");
  }

  await tx.update(playerRatings).set({
    elo: applied.white.elo,
    glickoRating: applied.white.glicko.rating,
    glickoRd: applied.white.glicko.rd,
    glickoVol: applied.white.glicko.vol,
    gamesPlayed: applied.white.gamesPlayed,
    lastGameDate: applied.white.lastGameDate,
    lastGameMatchId: match.id,
    updatedAt: new Date()
  }).where(and(eq(playerRatings.playerId, match.whitePlayerId), eq(playerRatings.clubId, match.clubId)));

  await tx.update(playerRatings).set({
    elo: applied.black.elo,
    glickoRating: applied.black.glicko.rating,
    glickoRd: applied.black.glicko.rd,
    glickoVol: applied.black.glicko.vol,
    gamesPlayed: applied.black.gamesPlayed,
    lastGameDate: applied.black.lastGameDate,
    lastGameMatchId: match.id,
    updatedAt: new Date()
  }).where(and(eq(playerRatings.playerId, match.blackPlayerId), eq(playerRatings.clubId, match.clubId)));

  return { match: { id: updatedMatch.id, result: updatedMatch.result } };
}
