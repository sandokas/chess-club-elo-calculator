import { describe, it, expect } from "vitest";
import { getPool, pingDatabase } from "../../src/lib/pool.js";

describe("pool", () => {
  describe("getPool", () => {
    it("should create a pool", () => {
      const pool = getPool();
      expect(pool).toBeDefined();
      expect(pool.query).toBeDefined();
      expect(pool.end).toBeDefined();
    });
  });

  describe("pingDatabase", () => {
    it.skip("should ping the database successfully", async () => {
      // Skip this test as it requires a real database connection
      // This is tested via integration tests in health routes
      await pingDatabase();
    });
  });
});
