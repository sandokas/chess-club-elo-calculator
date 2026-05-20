import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { tournaments } from "@chess-club/db";
import { createTestApp, type TestApp } from "../helpers/app.js";
import { seedClub, seedTournament } from "../helpers/seed.js";

describe("tournament routes", () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  describe("POST /clubs/:clubId/tournaments", () => {
    it("returns 400 when name is missing", async () => {
      const club = await seedClub(testApp.db);

      const response = await testApp.app.inject({
        method: "POST",
        url: `/clubs/${club.id}/tournaments`,
        payload: {}
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 when format is invalid", async () => {
      const club = await seedClub(testApp.db);

      const response = await testApp.app.inject({
        method: "POST",
        url: `/clubs/${club.id}/tournaments`,
        payload: { name: "Test Tournament", format: "invalid" }
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 when totalRounds is out of range", async () => {
      const club = await seedClub(testApp.db);

      const response = await testApp.app.inject({
        method: "POST",
        url: `/clubs/${club.id}/tournaments`,
        payload: { name: "Test Tournament", totalRounds: 100 }
      });

      expect(response.statusCode).toBe(400);
    });

    it("creates a draft tournament with valid input", async () => {
      const club = await seedClub(testApp.db);

      const response = await testApp.app.inject({
        method: "POST",
        url: `/clubs/${club.id}/tournaments`,
        payload: { name: "First Tournament", format: "swiss", totalRounds: 5 }
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.tournament).toMatchObject({
        name: "First Tournament",
        format: "swiss",
        status: "draft",
        totalRounds: 5,
        clubId: club.id
      });

      // Verify the row was actually persisted
      const rows = await testApp.db
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, body.tournament.id));
      expect(rows).toHaveLength(1);
    });

    it("returns 400 when the club already has an ongoing tournament", async () => {
      const club = await seedClub(testApp.db);
      await seedTournament(testApp.db, { clubId: club.id, status: "active" });

      const response = await testApp.app.inject({
        method: "POST",
        url: `/clubs/${club.id}/tournaments`,
        payload: { name: "Another Tournament" }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toMatch(/ongoing tournament/i);
    });
  });

  describe("PUT /tournaments/:id", () => {
    it("updates name and totalRounds on a draft tournament", async () => {
      const club = await seedClub(testApp.db);
      const t = await seedTournament(testApp.db, { clubId: club.id, name: "Old", totalRounds: 4 });

      const response = await testApp.app.inject({
        method: "PUT",
        url: `/tournaments/${t.id}`,
        payload: { name: "Updated Tournament Name", totalRounds: 7 }
      });

      expect(response.statusCode).toBe(200);

      const fresh = await testApp.db.select().from(tournaments).where(eq(tournaments.id, t.id));
      expect(fresh[0]!.name).toBe("Updated Tournament Name");
      expect(fresh[0]!.totalRounds).toBe(7);
    });

    it("returns 400 for an invalid status value", async () => {
      const club = await seedClub(testApp.db);
      const t = await seedTournament(testApp.db, { clubId: club.id });

      const response = await testApp.app.inject({
        method: "PUT",
        url: `/tournaments/${t.id}`,
        payload: { status: "invalid" }
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for an invalid pairingMethod value", async () => {
      const club = await seedClub(testApp.db);
      const t = await seedTournament(testApp.db, { clubId: club.id });

      const response = await testApp.app.inject({
        method: "PUT",
        url: `/tournaments/${t.id}`,
        payload: { pairingMethod: "invalid" }
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("DELETE /tournaments/:id", () => {
    it("deletes a draft tournament and the row is gone", async () => {
      const club = await seedClub(testApp.db);
      const t = await seedTournament(testApp.db, { clubId: club.id, status: "draft" });

      const response = await testApp.app.inject({
        method: "DELETE",
        url: `/tournaments/${t.id}`
      });

      expect(response.statusCode).toBe(200);

      const remaining = await testApp.db
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, t.id));
      expect(remaining).toHaveLength(0);
    });

    it("refuses to delete a non-draft tournament", async () => {
      const club = await seedClub(testApp.db);
      const t = await seedTournament(testApp.db, { clubId: club.id, status: "active" });

      const response = await testApp.app.inject({
        method: "DELETE",
        url: `/tournaments/${t.id}`
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toMatch(/draft status/i);
    });

    it("returns 404 for an unknown tournament id", async () => {
      const response = await testApp.app.inject({
        method: "DELETE",
        url: "/tournaments/00000000-0000-0000-0000-000000000000"
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
