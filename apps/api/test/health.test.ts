import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("API health", () => {
  it("responds from the service health endpoint", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "chess-club-api"
    });

    await app.close();
  });

  it("responds from the database health endpoint with injected connectivity", async () => {
    const app = await createApp({ databasePing: async () => undefined });
    const response = await app.inject({ method: "GET", url: "/health/db" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      database: "reachable"
    });

    await app.close();
  });
});
