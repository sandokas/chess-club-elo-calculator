import { describe, it, expect } from "vitest";
import { formatRating, formatDate, formatResult, formatCompactResult } from "../../src/lib/formatters.js";

describe("formatRating", () => {
  it("formats rating to 1 decimal place", () => {
    expect(formatRating(1234.567)).toBe("1234.6");
    expect(formatRating(1000)).toBe("1000.0");
  });
});

describe("formatDate", () => {
  it("returns N/A for null value", () => {
    expect(formatDate(null)).toBe("N/A");
  });

  it("returns N/A for empty string", () => {
    expect(formatDate("")).toBe("N/A");
  });

  it("returns N/A for invalid date", () => {
    expect(formatDate("invalid-date")).toBe("N/A");
  });

  it("formats valid date", () => {
    const date = "2024-01-15";
    const result = formatDate(date);
    expect(result).toBeTruthy();
    expect(result).not.toBe("N/A");
  });
});

describe("formatResult", () => {
  it("returns Win for result 1", () => {
    expect(formatResult(1, true)).toBe("Win");
    expect(formatResult(1, false)).toBe("Win");
  });

  it("returns Loss for result 0", () => {
    expect(formatResult(0, true)).toBe("Loss");
    expect(formatResult(0, false)).toBe("Loss");
  });

  it("returns Draw for result 0.5", () => {
    expect(formatResult(0.5, true)).toBe("Draw");
    expect(formatResult(0.5, false)).toBe("Draw");
  });

  it("returns N/A for other values", () => {
    expect(formatResult(2, true)).toBe("N/A");
    expect(formatResult(-1, false)).toBe("N/A");
  });
});

describe("formatCompactResult", () => {
  it("returns 1–0 for result 1", () => {
    expect(formatCompactResult(1)).toBe("1–0");
  });

  it("returns 0–1 for result 0", () => {
    expect(formatCompactResult(0)).toBe("0–1");
  });

  it("returns ½–½ for result 0.5", () => {
    expect(formatCompactResult(0.5)).toBe("½–½");
  });

  it("returns — for null", () => {
    expect(formatCompactResult(null)).toBe("—");
  });

  it("returns — for other values", () => {
    expect(formatCompactResult(2)).toBe("—");
  });
});
