/**
 * Single source of truth for translating between Postgres rows and the
 * in-memory rating types (`RatingProfile`, `MatchRatingAudit`).
 *
 * Both the per-match update handler (`PUT /matches/:id/result`) and the
 * full club recompute (`POST /clubs/:clubId/ratings/recompute`) MUST go
 * through these helpers. Duplicating the row<->profile mapping or the
 * UPDATE SQL between the two paths has caused subtle divergences in the
 * past (e.g. a JS `Date` leaking into `GlickoProfile.lastGameDate` where
 * a `string` is expected, silently disabling RD inflation in the live
 * path while recompute did it correctly). See AGENTS.md.
 */
import type { Pool } from "pg";
import type { MatchRatingAudit, RatingProfile } from "./ratings.js";
import type { GlickoProfile } from "./glicko2.js";

/**
 * A `player_ratings` row as returned by `pg`. `last_game_date` is a JS
 * `Date` because the column type is `date`. Numeric columns come back as
 * JS `number` because they are `double precision`.
 */
export type PlayerRatingsRow = {
  elo: number;
  glicko_rating: number;
  glicko_rd: number;
  glicko_vol: number;
  games_played: number;
  last_game_date: Date | string | null;
};

/**
 * Normalise a date-ish value from pg (`Date`, ISO string, or null) to the
 * canonical `YYYY-MM-DD` string used throughout the rating code. The
 * Glicko-2 `daysBetween` helper requires a string; passing a `Date`
 * silently produces NaN and disables RD inflation.
 */
export function toIsoDate(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.slice(0, 10);
  }
  // Already a string — accept either `YYYY-MM-DD` or full ISO and slice.
  return value.length >= 10 ? value.slice(0, 10) : value;
}

/**
 * Build a `RatingProfile` from a `player_ratings` row, normalising the
 * `last_game_date` column to an ISO string so the Glicko math sees the
 * correct type.
 */
export function rowToRatingProfile(row: PlayerRatingsRow): RatingProfile {
  const lastGameDate = toIsoDate(row.last_game_date);
  const glicko: GlickoProfile = {
    rating: row.glicko_rating,
    rd: row.glicko_rd,
    vol: row.glicko_vol,
    lastGameDate
  };
  return {
    elo: row.elo,
    glicko,
    gamesPlayed: row.games_played,
    lastGameDate
  };
}

/**
 * Persist a `RatingProfile` for a player. Single canonical UPDATE used
 * by every code path that mutates ratings.
 */
export async function writeRatingProfile(
  pool: Pool,
  playerId: string,
  profile: RatingProfile
): Promise<void> {
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
}

/**
 * Persist the before/after rating audit fields on a `matches` row.
 * Single canonical UPDATE used by every code path that writes audits.
 */
export async function writeMatchAudit(
  pool: Pool,
  matchId: string,
  audit: MatchRatingAudit
): Promise<void> {
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
      audit.blackGlickoBefore?.rating ?? null,
      audit.blackGlickoAfter?.rating ?? null,
      audit.blackGlickoBefore?.rd ?? null,
      audit.blackGlickoAfter?.rd ?? null,
      audit.blackGlickoBefore?.vol ?? null,
      audit.blackGlickoAfter?.vol ?? null,
      matchId
    ]
  );
}

/**
 * Clear all audit fields on a `matches` row (used when a result is undone
 * back to NULL).
 */
export async function clearMatchAudit(pool: Pool, matchId: string): Promise<void> {
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
    [matchId]
  );
}
