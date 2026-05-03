import { describe, expect, it } from "vitest";
import { expectedScore, kFactor, updateElo } from "../src/elo.js";

describe("Elo", () => {
  it("computes expected score", () => {
    expect(expectedScore(1200, 1200)).toBe(0.5);
    expect(expectedScore(1400, 1200)).toBeGreaterThan(0.75);
  });

  it("selects K factor from game count", () => {
    expect(kFactor(0)).toBe(40);
    expect(kFactor(25)).toBe(20);
    expect(kFactor(100)).toBe(10);
  });

  it("updates ratings with current Python-compatible defaults", () => {
    expect(updateElo(1200, 1200, 1, 40, 40)).toEqual([1220, 1180]);
  });
});
