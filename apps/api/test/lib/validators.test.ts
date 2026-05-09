import { describe, it, expect } from "vitest";
import {
  parsePaginationParams,
  parseSortParams,
  parseStringFilter,
  parseBooleanFilter,
  parseNumberFilter,
  parseDateFilter,
  validateTournamentStatus
} from "../../src/lib/validators.js";

describe("parsePaginationParams", () => {
  it("returns defaults when no params provided", () => {
    expect(parsePaginationParams({})).toEqual({ page: 1, limit: 20 });
  });

  it("parses valid page and limit", () => {
    expect(parsePaginationParams({ page: "5", limit: "50" })).toEqual({ page: 5, limit: 50 });
  });

  it("clamps page to minimum 1", () => {
    expect(parsePaginationParams({ page: "0", limit: "20" })).toEqual({ page: 1, limit: 20 });
    expect(parsePaginationParams({ page: "-5", limit: "20" })).toEqual({ page: 1, limit: 20 });
  });

  it("only allows specific limit values", () => {
    expect(parsePaginationParams({ page: "1", limit: "10" })).toEqual({ page: 1, limit: 10 });
    expect(parsePaginationParams({ page: "1", limit: "50" })).toEqual({ page: 1, limit: 50 });
    expect(parsePaginationParams({ page: "1", limit: "25" })).toEqual({ page: 1, limit: 20 });
  });
});

describe("parseSortParams", () => {
  it("returns default sort when no params provided", () => {
    expect(parseSortParams({}, ["name", "elo"])).toEqual({ sortBy: "name", sortOrder: "desc" });
  });

  it("uses provided sortBy when valid", () => {
    expect(parseSortParams({ sortBy: "elo", sortOrder: "asc" }, ["name", "elo"])).toEqual({ sortBy: "elo", sortOrder: "asc" });
  });

  it("uses default column when sortBy is invalid", () => {
    expect(parseSortParams({ sortBy: "invalid" }, ["name", "elo"])).toEqual({ sortBy: "name", sortOrder: "desc" });
  });

  it("defaults to desc when sortOrder is invalid", () => {
    expect(parseSortParams({ sortBy: "elo", sortOrder: "invalid" }, ["name", "elo"])).toEqual({ sortBy: "elo", sortOrder: "desc" });
  });

  it("throws error when allowedColumns is empty", () => {
    expect(() => parseSortParams({}, [])).toThrow("allowedColumns must not be empty");
  });
});

describe("parseStringFilter", () => {
  it("returns empty string when value is undefined", () => {
    expect(parseStringFilter(undefined)).toBe("");
  });

  it("returns value when provided", () => {
    expect(parseStringFilter("test")).toBe("test");
    expect(parseStringFilter("  test  ")).toBe("  test  ");
  });
});

describe("parseBooleanFilter", () => {
  it("returns true for 'true'", () => {
    expect(parseBooleanFilter("true")).toBe(true);
  });

  it("returns false for 'false'", () => {
    expect(parseBooleanFilter("false")).toBe(false);
  });

  it("returns undefined for other values", () => {
    expect(parseBooleanFilter("")).toBeUndefined();
    expect(parseBooleanFilter("yes")).toBeUndefined();
    expect(parseBooleanFilter("1")).toBeUndefined();
  });
});

describe("parseNumberFilter", () => {
  it("returns number when valid", () => {
    expect(parseNumberFilter("42")).toBe(42);
    expect(parseNumberFilter("3.14")).toBe(3.14);
  });

  it("returns undefined when invalid", () => {
    expect(parseNumberFilter("")).toBeUndefined();
    expect(parseNumberFilter("abc")).toBeUndefined();
  });
});

describe("parseDateFilter", () => {
  it("returns date string when valid", () => {
    expect(parseDateFilter("2024-01-01")).toBe("2024-01-01");
  });

  it("returns undefined when invalid", () => {
    expect(parseDateFilter("")).toBeUndefined();
    expect(parseDateFilter("not-a-date")).toBeUndefined();
  });
});

describe("validateTournamentStatus", () => {
  it("returns value when valid status", () => {
    expect(validateTournamentStatus("draft")).toBe("draft");
    expect(validateTournamentStatus("active")).toBe("active");
    expect(validateTournamentStatus("completed")).toBe("completed");
  });

  it("returns undefined when invalid status", () => {
    expect(validateTournamentStatus("")).toBeUndefined();
    expect(validateTournamentStatus("invalid")).toBeUndefined();
  });
});
