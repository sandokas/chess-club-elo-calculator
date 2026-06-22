import { describe, expect, it } from "vitest";
import {
  formatMatchLocation,
  getMatchLocationHeader,
  type MatchLocation,
} from "../../src/lib/match-location.js";

const match: MatchLocation = {
  roundNumber: 2,
  boardNumber: 4,
  blackPlayerId: "black-player",
};

describe("match location", () => {
  it("shows the round in the all-rounds view", () => {
    expect(getMatchLocationHeader(null)).toBe("Round");
    expect(formatMatchLocation(null, match)).toBe(2);
  });

  it("shows the table in a single-round view", () => {
    expect(getMatchLocationHeader(2)).toBe("Table");
    expect(formatMatchLocation(2, match)).toBe(4);
  });

  it("does not assign a table to a bye", () => {
    expect(formatMatchLocation(2, { ...match, boardNumber: 0, blackPlayerId: null })).toBe("—");
  });

  it("falls back safely when a location number is missing", () => {
    expect(formatMatchLocation(null, { ...match, roundNumber: null })).toBe("—");
    expect(formatMatchLocation(2, { ...match, boardNumber: null })).toBe("—");
  });
});
