import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createApp } from "../src/app.js";
import { createTestApp, type TestApp } from "./helpers/app.js";

describe("API health (integration)", () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it("responds from the service health endpoint", async () => {
    const response = await testApp.app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "chess-club-api"
    });
  });

  it("hits the real Postgres test DB on /health/db", async () => {
    const response = await testApp.app.inject({ method: "GET", url: "/health/db" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      database: "reachable"
    });
  });

  it("uses the injected databasePing when one is provided", async () => {
    // Plumbing test: verifies createApp wires options.databasePing through to
    // the health route. We construct a one-off app (own pool) here because
    // databasePing is set at construction time.
    const app = await createApp({ databasePing: async () => undefined });
    try {
      const response = await app.inject({ method: "GET", url: "/health/db" });
      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
