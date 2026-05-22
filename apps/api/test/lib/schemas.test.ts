import { describe, it, expect } from "vitest";
import {
  createClubSchema,
  updateClubSchema,
  createTournamentSchema,
  updateTournamentSchema,
  addPlayerToTournamentSchema,
  createPlayerInTournamentSchema,
  updateTournamentPlayerSchema,
  createRoundSchema,
  updateRoundStartSchema,
  setMatchResultSchema
} from "../../src/lib/schemas/index.js";

describe("Zod schemas", () => {
  describe("club schemas", () => {
    it("validates create club input", () => {
      const input = {
        name: "Test Club",
        description: "A test club",
        city: "Test City",
        country: "Test Country"
      };
      const result = createClubSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("rejects empty name for create club", () => {
      const input = { name: "" };
      expect(() => createClubSchema.parse(input)).toThrow();
    });

    it("validates update club input", () => {
      const input = { name: "Updated Club" };
      const result = updateClubSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("rejects empty update object", () => {
      const input = {};
      expect(() => updateClubSchema.parse(input)).toThrow();
    });
  });

  describe("tournament schemas", () => {
    it("validates create tournament input", () => {
      const input = {
        name: "Test Tournament",
        format: "swiss",
        totalRounds: 5,
        pairingMethod: "seeded_by_rating"
      };
      const result = createTournamentSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("validates update tournament input", () => {
      const input = { status: "active" };
      const result = updateTournamentSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("rejects invalid status for update tournament", () => {
      const input = { status: "invalid" };
      expect(() => updateTournamentSchema.parse(input)).toThrow();
    });
  });

  describe("tournament player schemas", () => {
    it("validates add player to tournament input", () => {
      const input = { playerId: "550e8400-e29b-41d4-a716-446655440000" };
      const result = addPlayerToTournamentSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("validates create player in tournament input", () => {
      const input = { displayName: "Test Player" };
      const result = createPlayerInTournamentSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("validates update tournament player input", () => {
      const input = { droppedOutRound: 3 };
      const result = updateTournamentPlayerSchema.parse(input);
      expect(result).toEqual(input);
    });
  });

  describe("round schemas", () => {
    it("validates create round input", () => {
      const input = { startsOn: "2024-01-01" };
      const result = createRoundSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("validates update round start input", () => {
      const input = { startsOn: "2024-01-01" };
      const result = updateRoundStartSchema.parse(input);
      expect(result).toEqual(input);
    });
  });

  describe("match schemas", () => {
    it("validates set match result input", () => {
      const inputs = [{ result: 1 }, { result: 0.5 }, { result: 0 }, { result: null }];
      inputs.forEach(input => {
        const result = setMatchResultSchema.parse(input);
        expect(result).toEqual(input);
      });
    });

    it("rejects invalid match result", () => {
      const input = { result: 2 };
      expect(() => setMatchResultSchema.parse(input)).toThrow();
    });
  });
});
