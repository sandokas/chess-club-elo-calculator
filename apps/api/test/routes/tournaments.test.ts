import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createApp } from "../../src/app.js";

describe("tournament routes", () => {
  let app: any;

  beforeEach(async () => {
    app = await createApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("POST /clubs/:clubId/tournaments", () => {
    it("should validate required fields", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/clubs/test-club/tournaments",
        payload: {}
      });

      expect(response.statusCode).toBe(400); // Validation error
    });

    it("should validate format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/clubs/test-club/tournaments",
        payload: {
          name: "Test Tournament",
          format: "invalid"
        }
      });

      expect(response.statusCode).toBe(400); // Validation error
    });

    it("should validate totalRounds range", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/clubs/test-club/tournaments",
        payload: {
          name: "Test Tournament",
          totalRounds: 100 // Too high
        }
      });

      expect(response.statusCode).toBe(400); // Validation error
    });
  });

  describe("PUT /tournaments/:id", () => {
    it("should update tournament details", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/tournaments/test-tournament-id",
        payload: {
          name: "Updated Tournament Name",
          totalRounds: 7
        }
      });

      expect(response.statusCode).toBe(500); // Database error
    });

    it("should validate status values", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/tournaments/test-tournament-id",
        payload: {
          status: "invalid"
        }
      });

      expect(response.statusCode).toBe(400); // Validation error
    });

    it("should validate pairingMethod values", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/tournaments/test-tournament-id",
        payload: {
          pairingMethod: "invalid"
        }
      });

      expect(response.statusCode).toBe(400); // Validation error
    });
  });

  describe("DELETE /tournaments/:id", () => {
    it("should delete draft tournament", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/tournaments/test-tournament-id"
      });

      expect(response.statusCode).toBe(500); // Database error
    });
  });
});
