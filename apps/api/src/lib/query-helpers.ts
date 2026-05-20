import { type AnyColumn, and, type SQL } from "drizzle-orm";
import { players, playerRatings } from "@chess-club/db";

/**
 * Sort allowlist for players list endpoint
 * Maps sort parameter names to Drizzle column references
 */
export const playersSortColumnMap: Record<string, AnyColumn> = {
  displayName: players.displayName,
  elo: playerRatings.elo,
  glickoRating: playerRatings.glickoRating,
  gamesPlayed: playerRatings.gamesPlayed,
  lastGameDate: playerRatings.lastGameDate,
  active: players.active
};

/**
 * Builds a conditional WHERE clause by filtering out falsy conditions
 * and combining them with AND
 */
export function buildWhereClause(conditions: (SQL | undefined)[]): SQL | undefined {
  const filtered = conditions.filter(Boolean) as SQL[];
  return filtered.length > 0 ? and(...filtered) : undefined;
}
