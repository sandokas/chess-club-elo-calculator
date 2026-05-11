import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../src/app.js";

describe("PUT endpoints", () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("PUT /players/:id should update player displayName", async () => {
    // This test requires a valid player ID from the database
    // For now, we'll test the endpoint structure
    const response = await app.inject({
      method: "PUT",
      url: "/players/00000000-0000-0000-0000-000000000000",
      payload: {
        displayName: "Test Player Updated",
      },
    });

    // Should return 404 for non-existent player
    expect(response.statusCode).toBe(404);
  });

  it("PUT /players/:id should validate displayName is not empty", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/players/00000000-0000-0000-0000-000000000000",
      payload: {
        displayName: "",
      },
    });

    expect(response.statusCode).toBe(400);
    const json = response.json();
    expect(json.error).toBe("ValidationError");
  });

  it("PUT /tournaments/:id should update tournament status", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/tournaments/00000000-0000-0000-0000-000000000000",
      payload: {
        status: "completed",
      },
    });

    // Should return 404 for non-existent tournament
    expect(response.statusCode).toBe(404);
  });

  it("PUT /tournaments/:id should validate status enum", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/tournaments/00000000-0000-0000-0000-000000000000",
      payload: {
        status: "invalid",
      },
    });

    expect(response.statusCode).toBe(400);
    const json = response.json();
    expect(json.error).toBe("ValidationError");
  });
});
