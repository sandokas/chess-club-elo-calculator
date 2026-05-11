import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { registerHealthRoutes } from "../../src/routes/health.js";

describe("health routes", () => {
  describe("GET /health", () => {
    it("should return health status", async () => {
      const app = Fastify();
      await registerHealthRoutes(app);

      const response = await app.inject({
        method: "GET",
        url: "/health"
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        status: "ok",
        service: "chess-club-api"
      });

      await app.close();
    });
  });

  describe("GET /health/db", () => {
    it("should return database reachable status with default ping", async () => {
      const app = Fastify();
      await registerHealthRoutes(app);

      const response = await app.inject({
        method: "GET",
        url: "/health/db"
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        status: "ok",
        database: "reachable"
      });

      await app.close();
    });

    it("should use custom database ping function", async () => {
      const customPing = vi.fn();
      const app = Fastify();
      await registerHealthRoutes(app, { databasePing: customPing });

      const response = await app.inject({
        method: "GET",
        url: "/health/db"
      });

      expect(customPing).toHaveBeenCalled();
      expect(response.statusCode).toBe(200);

      await app.close();
    });

    it("should return 500 if database ping fails", async () => {
      const failingPing = vi.fn().mockRejectedValue(new Error("Database unreachable"));
      const app = Fastify();
      await registerHealthRoutes(app, { databasePing: failingPing });

      const response = await app.inject({
        method: "GET",
        url: "/health/db"
      });

      expect(response.statusCode).toBe(500);

      await app.close();
    });
  });
});
