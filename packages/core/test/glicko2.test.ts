import { describe, expect, it } from "vitest";
import { glicko2Update } from "../src/glicko2.js";

describe("Glicko-2", () => {
  it("matches current Python output for a decisive default-profile result", () => {
    const updated = glicko2Update(
      { rating: 1000, rd: 350, vol: 0.06 },
      { rating: 1000, rd: 350, vol: 0.06 },
      1
    );

    expect(updated.rating).toBeCloseTo(1162.310893906298, 9);
    expect(updated.rd).toBeCloseTo(290.31896371798047, 9);
    expect(updated.vol).toBeCloseTo(0.05999967537233814, 12);
  });

  it("matches current Python output for a draw between default profiles", () => {
    const updated = glicko2Update(
      { rating: 1000, rd: 350, vol: 0.06 },
      { rating: 1000, rd: 350, vol: 0.06 },
      0.5
    );

    expect(updated.rating).toBeCloseTo(1000, 9);
    expect(updated.rd).toBeCloseTo(290.31896161384265, 9);
    expect(updated.vol).toBeCloseTo(0.05999896144314354, 12);
  });
});
