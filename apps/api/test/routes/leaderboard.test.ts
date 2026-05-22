import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../helpers/app.js";
import { seedClub, seedPlayer } from "../helpers/seed.js";

describe("leaderboard routes", () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it("returns active club players", async () => {
    const club = await seedClub(testApp.db);
    await seedPlayer(testApp.db, { clubId: club.id, displayName: "Active Player" });
    await seedPlayer(testApp.db, { clubId: club.id, displayName: "Inactive Player", active: false });

    const response = await testApp.app.inject({
      method: "GET",
      url: `/clubs/${club.id}/leaderboard?activeOnly=true&limit=10`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().leaderboard).toMatchObject([
      {
        displayName: "Active Player",
        active: true
      }
    ]);
  });
});
