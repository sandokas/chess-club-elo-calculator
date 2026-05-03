import { describe, expect, it } from "vitest";
import { recomputeRatings } from "../src/ratings.js";

describe("rating recomputation", () => {
  it("replays rated matches in date/id order", () => {
    const result = recomputeRatings([1, 2], [
      { id: 1, whitePlayerId: 1, blackPlayerId: 2, result: 1, date: "2025-12-14" },
      { id: 2, whitePlayerId: 2, blackPlayerId: 1, result: 0.5, date: "2025-12-15" }
    ]);

    expect(result.audits).toHaveLength(2);
    expect(result.profiles.get(1)?.gamesPlayed).toBe(2);
    expect(result.profiles.get(2)?.gamesPlayed).toBe(2);
    expect(result.audits[0]?.whiteEloBefore).toBe(1000);
    expect(result.audits[0]?.whiteEloAfter).toBe(1020);
  });
});
