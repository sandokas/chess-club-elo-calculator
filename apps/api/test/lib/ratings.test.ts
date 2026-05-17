import { describe, it, expect } from "vitest";
import { recomputeRatings, applyRatedMatch, defaultRatingProfile, type MatchInput } from "../../src/lib/ratings/ratings.js";
import { rowToRatingProfile, type PlayerRatingsRow } from "../../src/lib/ratings/persistence.js";

/**
 * Regression: previously `recomputeRatings` sorted matches with
 * `String(a.date).localeCompare(String(b.date))`. When `date` is a JS `Date`
 * (which the `pg` driver returns for `date` columns), `String(Date)` yields a
 * weekday-prefixed value like `"Sun Jan 18 2026..."`, so the sort key was
 * effectively the weekday name. That silently scrambled match order and the
 * recompute path produced different ratings from the per-match update path.
 */
describe("recomputeRatings chronological ordering", () => {
  const playerA = "a";
  const playerB = "b";

  function makeMatches(dates: Array<string | Date>): MatchInput[] {
    return dates.map((date, idx) => ({
      // UUIDv7-like ids are time-ordered; using a counter is fine for tests.
      id: `match-${String(idx).padStart(6, "0")}`,
      whitePlayerId: playerA,
      blackPlayerId: playerB,
      result: 1,
      date
    }));
  }

  it("sorts matches chronologically when dates are JS Date objects (from pg)", () => {
    // Provide matches in non-chronological input order, using Date objects.
    const dates: Date[] = [
      new Date("2026-01-18"), // "Sun..."
      new Date("2024-12-18"), // "Wed..."
      new Date("2025-03-04")  // "Tue..."
    ];

    const recomputed = recomputeRatings([playerA, playerB], makeMatches(dates));

    // Simulate per-match application in true chronological order.
    const sortedDates = [...dates].sort((a, b) => a.getTime() - b.getTime());
    let white = defaultRatingProfile();
    let black = defaultRatingProfile();
    for (const d of sortedDates) {
      const applied = applyRatedMatch(white, black, 1, d);
      white = applied.white;
      black = applied.black!;
    }

    const recomputedWhite = recomputed.profiles.get(playerA)!;
    const recomputedBlack = recomputed.profiles.get(playerB)!;

    expect(recomputedWhite.elo).toBeCloseTo(white.elo, 6);
    expect(recomputedBlack.elo).toBeCloseTo(black.elo, 6);
    expect(recomputedWhite.glicko.rating).toBeCloseTo(white.glicko.rating, 6);
    expect(recomputedBlack.glicko.rating).toBeCloseTo(black.glicko.rating, 6);
  });

  /**
   * Per-match live updates must produce the same ratings as a full recompute
   * over the same matches in the same order. The previous implementation read
   * `last_game_date` as a JS `Date` from pg and passed it to `glicko2Update`
   * where `daysBetween` expects a `string`; the template-literal coercion
   * silently produced NaN and `daysBetween` returned 0, so RD never inflated
   * between matches in the live path while recompute inflated correctly.
   */
  it("per-match accumulation equals recompute (DB Date round-trip)", () => {
    const dates = [
      new Date("2024-09-22"),
      new Date("2024-11-17"),
      new Date("2025-03-04"),
      new Date("2025-06-15"),
      new Date("2026-01-18"),
      new Date("2026-05-17")
    ];
    const matches = makeMatches(dates);

    // Simulate the per-match handler exactly: read a pg row (with `Date`
    // for the date column), build a profile via `rowToRatingProfile`, fold
    // in the new match, then persist back so the next iteration sees the
    // same Date-typed value pg would return on a subsequent SELECT.
    function simulateLiveAccumulation(): { white: PlayerRatingsRow; black: PlayerRatingsRow } {
      let whiteRow: PlayerRatingsRow = {
        elo: 1000,
        glicko_rating: 1000,
        glicko_rd: 350,
        glicko_vol: 0.06,
        games_played: 0,
        last_game_date: null
      };
      let blackRow: PlayerRatingsRow = { ...whiteRow };

      for (const m of matches) {
        const whiteProfile = rowToRatingProfile(whiteRow);
        const blackProfile = rowToRatingProfile(blackRow);
        const applied = applyRatedMatch(whiteProfile, blackProfile, m.result!, m.date as Date);

        // Persist back — emulate pg returning `date` columns as `Date`.
        whiteRow = {
          elo: applied.white.elo,
          glicko_rating: applied.white.glicko.rating,
          glicko_rd: applied.white.glicko.rd,
          glicko_vol: applied.white.glicko.vol,
          games_played: applied.white.gamesPlayed,
          last_game_date: applied.white.lastGameDate ? new Date(applied.white.lastGameDate) : null
        };
        blackRow = {
          elo: applied.black!.elo,
          glicko_rating: applied.black!.glicko.rating,
          glicko_rd: applied.black!.glicko.rd,
          glicko_vol: applied.black!.glicko.vol,
          games_played: applied.black!.gamesPlayed,
          last_game_date: applied.black!.lastGameDate ? new Date(applied.black!.lastGameDate) : null
        };
      }

      return { white: whiteRow, black: blackRow };
    }

    const live = simulateLiveAccumulation();
    const recomputed = recomputeRatings([playerA, playerB], matches);
    const rWhite = recomputed.profiles.get(playerA)!;
    const rBlack = recomputed.profiles.get(playerB)!;

    expect(live.white.elo).toBeCloseTo(rWhite.elo, 6);
    expect(live.black.elo).toBeCloseTo(rBlack.elo, 6);
    expect(live.white.glicko_rating).toBeCloseTo(rWhite.glicko.rating, 6);
    expect(live.black.glicko_rating).toBeCloseTo(rBlack.glicko.rating, 6);
    expect(live.white.glicko_rd).toBeCloseTo(rWhite.glicko.rd, 6);
    expect(live.black.glicko_rd).toBeCloseTo(rBlack.glicko.rd, 6);
  });

  it("produces the same result whether date is a Date or an ISO string", () => {
    const dateStrs = ["2024-12-18", "2025-03-04", "2026-01-18"];
    const dateObjs = dateStrs.map((s) => new Date(s));

    const fromStrings = recomputeRatings([playerA, playerB], makeMatches(dateStrs));
    const fromDates = recomputeRatings([playerA, playerB], makeMatches(dateObjs));

    const a1 = fromStrings.profiles.get(playerA)!;
    const a2 = fromDates.profiles.get(playerA)!;
    expect(a1.elo).toBeCloseTo(a2.elo, 6);
    expect(a1.glicko.rating).toBeCloseTo(a2.glicko.rating, 6);
  });
});
