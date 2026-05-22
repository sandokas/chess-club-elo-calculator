import type { Db } from "@chess-club/db";
import { eq, and, sql, desc, asc, count, type SQL } from "drizzle-orm";
import { ratingConfig } from "@chess-club/config";
import { players, playerRatings, clubs, matches } from "@chess-club/db";
import { parsePaginationParams, parseSortParams, parseStringFilter, escapeLikePattern, parseBooleanFilter, parseNumberFilter, parseDateFilter } from "../lib/validators.js";
import { playersSortColumnMap, buildWhereClause } from "../lib/query-helpers.js";

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

export async function createPlayer(
  db: Db,
  clubId: string,
  displayName: string
) {
  // Check if player with same name already exists in club
  const existingPlayer = await db
    .select({ id: players.id })
    .from(players)
    .where(
      and(
        eq(players.clubId, clubId),
        eq(players.displayName, displayName.trim())
      )
    );

  if (existingPlayer.length > 0) {
    throw new Error("Player with this name already exists in this club");
  }

  const result = await db
    .insert(players)
    .values({
      clubId,
      displayName: displayName.trim(),
      active: true
    })
    .returning({
      id: players.id,
      displayName: players.displayName,
      active: players.active,
      legacyId: players.legacyId,
      createdAt: players.createdAt,
      clubId: players.clubId
    });

  const player = result[0]!;

  // Create player ratings record using the single rating config source of truth.
  await db.insert(playerRatings).values({
    playerId: player.id,
    clubId,
    elo: ratingConfig.defaultElo,
    glickoRating: ratingConfig.g2DefaultRating,
    glickoRd: ratingConfig.g2DefaultRd,
    glickoVol: ratingConfig.g2DefaultVol,
    gamesPlayed: 0
  });

  return player;
}

export async function deletePlayer(
  db: Db,
  clubId: string,
  playerId: string
) {
  // Check if player belongs to club
  const playerResult = await db
    .select({ id: players.id })
    .from(players)
    .where(
      and(
        eq(players.id, playerId),
        eq(players.clubId, clubId)
      )
    );

  if (playerResult.length === 0) {
    throw new Error("Player not found in this club");
  }

  // Check if player has any matches
  const matchesResult = await db
    .select({ id: matches.id })
    .from(matches)
    .where(
      sql`${matches.whitePlayerId} = ${playerId} OR ${matches.blackPlayerId} = ${playerId}`
    )
    .limit(1);

  if (matchesResult.length > 0) {
    throw new Error("Cannot delete player with match history");
  }

  // Delete player ratings
  await db
    .delete(playerRatings)
    .where(eq(playerRatings.playerId, playerId));

  // Delete player
  await db.delete(players).where(eq(players.id, playerId));
}

export async function listPlayers(
  db: Db,
  clubId: string,
  query: PlayersQuerystring
) {
  const allowedSortColumns = Object.keys(playersSortColumnMap);
  const { page, limit } = parsePaginationParams(query);
  const { sortBy, sortOrder } = parseSortParams(query, allowedSortColumns);

  // Build filter conditions
  const conditions: (SQL | undefined)[] = [eq(players.clubId, clubId)];

  const name = parseStringFilter(query.name);
  if (name) {
    conditions.push(
      sql`${players.displayName} LIKE ${`%${escapeLikePattern(name)}%`} ESCAPE '\\'`
    );
  }

  const active = parseBooleanFilter(query.active);
  if (active !== undefined) {
    conditions.push(eq(players.active, active));
  }

  const eloMin = parseNumberFilter(query.eloMin);
  if (eloMin !== undefined) {
    conditions.push(sql`${playerRatings.elo} >= ${eloMin}`);
  }

  const eloMax = parseNumberFilter(query.eloMax);
  if (eloMax !== undefined) {
    conditions.push(sql`${playerRatings.elo} <= ${eloMax}`);
  }

  const glickoMin = parseNumberFilter(query.glickoMin);
  if (glickoMin !== undefined) {
    conditions.push(sql`${playerRatings.glickoRating} >= ${glickoMin}`);
  }

  const glickoMax = parseNumberFilter(query.glickoMax);
  if (glickoMax !== undefined) {
    conditions.push(sql`${playerRatings.glickoRating} <= ${glickoMax}`);
  }

  const gamesPlayedMin = parseNumberFilter(query.gamesPlayedMin);
  if (gamesPlayedMin !== undefined) {
    conditions.push(sql`${playerRatings.gamesPlayed} >= ${gamesPlayedMin}`);
  }

  const gamesPlayedMax = parseNumberFilter(query.gamesPlayedMax);
  if (gamesPlayedMax !== undefined) {
    conditions.push(sql`${playerRatings.gamesPlayed} <= ${gamesPlayedMax}`);
  }

  const lastGameDateAfter = parseDateFilter(query.lastGameDateAfter);
  if (lastGameDateAfter) {
    conditions.push(sql`${playerRatings.lastGameDate} >= ${lastGameDateAfter}`);
  }

  const lastGameDateBefore = parseDateFilter(query.lastGameDateBefore);
  if (lastGameDateBefore) {
    conditions.push(sql`${playerRatings.lastGameDate} <= ${lastGameDateBefore}`);
  }

  const whereClause = buildWhereClause(conditions);

  // Get total count
  const countResult = await db
    .select({ total: count() })
    .from(players)
    .innerJoin(playerRatings, eq(playerRatings.playerId, players.id))
    .where(whereClause);
  const total = countResult[0]!.total;
  const totalPages = Math.ceil(total / limit);

  if (page > totalPages && totalPages > 0) {
    throw new Error("Page exceeds total pages");
  }

  const offset = (page - 1) * limit;
  const sortColumn = playersSortColumnMap[sortBy]!;
  const orderBy = sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);

  const result = await db
    .select({
      id: players.id,
      displayName: players.displayName,
      active: players.active,
      legacyId: players.legacyId,
      elo: playerRatings.elo,
      glickoRating: playerRatings.glickoRating,
      glickoRd: playerRatings.glickoRd,
      glickoVol: playerRatings.glickoVol,
      gamesPlayed: playerRatings.gamesPlayed,
      lastGameDate: playerRatings.lastGameDate
    })
    .from(players)
    .innerJoin(playerRatings, eq(playerRatings.playerId, players.id))
    .where(whereClause)
    .orderBy(orderBy, asc(players.displayName))
    .limit(limit)
    .offset(offset);

  return {
    players: result,
    pagination: {
      page,
      limit,
      total,
      totalPages
    }
  };
}

export async function getPlayerById(
  db: Db,
  playerId: string
) {
  const playerResult = await db
    .select({
      id: players.id,
      displayName: players.displayName,
      active: players.active,
      legacyId: players.legacyId,
      createdAt: players.createdAt,
      clubId: players.clubId,
      clubName: clubs.name,
      elo: playerRatings.elo,
      glickoRating: playerRatings.glickoRating,
      glickoRd: playerRatings.glickoRd,
      glickoVol: playerRatings.glickoVol,
      gamesPlayed: playerRatings.gamesPlayed,
      lastGameDate: playerRatings.lastGameDate
    })
    .from(players)
    .innerJoin(clubs, eq(clubs.id, players.clubId))
    .innerJoin(playerRatings, eq(playerRatings.playerId, players.id))
    .where(eq(players.id, playerId));

  if (playerResult.length === 0) {
    throw new Error("Player not found");
  }

  const player = playerResult[0]!;

  // Using sql`` template tag for CASE expressions to keep the query clear and efficient
  // Decomposing into two queries would require merging in JS and is less performant
  const matchesResult = await db.execute(
    sql`
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
          WHEN m.white_player_id = ${playerId} THEN m.white_elo_before
          ELSE m.black_elo_before
        END AS "eloBefore",
        CASE
          WHEN m.white_player_id = ${playerId} THEN m.white_elo_after
          ELSE m.black_elo_after
        END AS "eloAfter",
        CASE
          WHEN m.white_player_id = ${playerId} THEN m.white_glicko_rating_before
          ELSE m.black_glicko_rating_before
        END AS "glickoRatingBefore",
        CASE
          WHEN m.white_player_id = ${playerId} THEN m.white_glicko_rating_after
          ELSE m.black_glicko_rating_after
        END AS "glickoRatingAfter"
      FROM matches m
      JOIN players wp ON wp.id = m.white_player_id
      JOIN players bp ON bp.id = m.black_player_id
      JOIN tournaments t ON t.id = m.tournament_id
      WHERE (m.white_player_id = ${playerId} OR m.black_player_id = ${playerId})
        AND m.result IS NOT NULL
      ORDER BY m.played_on DESC, m.id DESC
      LIMIT 20
    `
  );

  return {
    player,
    matches: matchesResult.rows
  };
}

export async function updatePlayer(
  db: Db,
  playerId: string,
  body: UpdatePlayerBody
) {
  const { displayName, active } = body;

  if (displayName !== undefined && displayName.trim() === "") {
    throw new Error("displayName cannot be empty");
  }

  const updates: Record<string, any> = {};

  if (displayName !== undefined) {
    updates.displayName = displayName.trim();
  }

  if (active !== undefined) {
    updates.active = active;
  }

  if (Object.keys(updates).length === 0) {
    throw new Error("No fields to update");
  }

  updates.updatedAt = new Date();

  const result = await db
    .update(players)
    .set(updates)
    .where(eq(players.id, playerId))
    .returning({
      id: players.id,
      displayName: players.displayName,
      active: players.active,
      legacyId: players.legacyId,
      createdAt: players.createdAt,
      clubId: players.clubId
    });

  if (result.length === 0) {
    throw new Error("Player not found");
  }

  return result[0]!;
}
