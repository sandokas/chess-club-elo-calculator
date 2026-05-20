import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { players, tournaments } from "@chess-club/db";
import { createTestApp, type TestApp } from "./helpers/app.js";
import { seedClub, seedPlayer, seedTournament } from "./helpers/seed.js";

describe("PUT endpoints", () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  describe("PUT /players/:id", () => {
    it("returns 404 for a non-existent player", async () => {
      const response = await testApp.app.inject({
        method: "PUT",
        url: "/players/00000000-0000-0000-0000-000000000000",
        payload: { displayName: "Test Player Updated" }
      });
      expect(response.statusCode).toBe(404);
    });

    it("returns 400 when displayName is empty", async () => {
      const response = await testApp.app.inject({
        method: "PUT",
        url: "/players/00000000-0000-0000-0000-000000000000",
        payload: { displayName: "" }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("ValidationError");
    });

    it("updates the player and returns the persisted row", async () => {
      const club = await seedClub(testApp.db);
      const player = await seedPlayer(testApp.db, { clubId: club.id, displayName: "Old Name" });

      const response = await testApp.app.inject({
        method: "PUT",
        url: `/players/${player.id}`,
        payload: { displayName: "New Name" }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().player).toMatchObject({
        id: player.id,
        displayName: "New Name",
        clubId: club.id
      });

      // Verify the row was actually updated
      const fresh = await testApp.db.select().from(players).where(eq(players.id, player.id));
      expect(fresh[0]!.displayName).toBe("New Name");
    });

    it("can toggle the active flag", async () => {
      const club = await seedClub(testApp.db);
      const player = await seedPlayer(testApp.db, { clubId: club.id, active: true });

      const response = await testApp.app.inject({
        method: "PUT",
        url: `/players/${player.id}`,
        payload: { active: false }
      });

      expect(response.statusCode).toBe(200);
      const fresh = await testApp.db.select().from(players).where(eq(players.id, player.id));
      expect(fresh[0]!.active).toBe(false);
    });
  });

  describe("PUT /tournaments/:id", () => {
    it("returns 404 for a non-existent tournament", async () => {
      const response = await testApp.app.inject({
        method: "PUT",
        url: "/tournaments/00000000-0000-0000-0000-000000000000",
        payload: { status: "completed" }
      });
      expect(response.statusCode).toBe(404);
    });

    it("returns 400 for an invalid status enum", async () => {
      const response = await testApp.app.inject({
        method: "PUT",
        url: "/tournaments/00000000-0000-0000-0000-000000000000",
        payload: { status: "invalid" }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("ValidationError");
    });

    it("updates a draft tournament's name", async () => {
      const club = await seedClub(testApp.db);
      const t = await seedTournament(testApp.db, { clubId: club.id, name: "Original" });

      const response = await testApp.app.inject({
        method: "PUT",
        url: `/tournaments/${t.id}`,
        payload: { name: "Renamed" }
      });

      expect(response.statusCode).toBe(200);

      const fresh = await testApp.db.select().from(tournaments).where(eq(tournaments.id, t.id));
      expect(fresh[0]!.name).toBe("Renamed");
    });
  });
});
