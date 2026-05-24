import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { tournaments } from "@chess-club/db";
import { createTestApp, type TestApp } from "../helpers/app.js";
import { seedAuthenticatedOwner, seedTournament } from "../helpers/seed.js";

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
      const { club, session } = await seedAuthenticatedOwner(testApp.db);

      const response = await testApp.app.inject({
        method: "POST",
        url: `/clubs/${club.id}/tournaments`,
        payload: {},
        cookies: { sid: session.token }
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 when format is invalid", async () => {
      const { club, session } = await seedAuthenticatedOwner(testApp.db);

      const response = await testApp.app.inject({
        method: "POST",
        url: `/clubs/${club.id}/tournaments`,
        payload: { name: "Test Tournament", format: "invalid" },
        cookies: { sid: session.token }
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 when totalRounds is out of range", async () => {
      const { club, session } = await seedAuthenticatedOwner(testApp.db);

      const response = await testApp.app.inject({
        method: "POST",
        url: `/clubs/${club.id}/tournaments`,
        payload: { name: "Test Tournament", totalRounds: 100 },
        cookies: { sid: session.token }
      });

      expect(response.statusCode).toBe(400);
    });

    it("creates a draft tournament with valid input", async () => {
      const { club, session } = await seedAuthenticatedOwner(testApp.db);

      const response = await testApp.app.inject({
        method: "POST",
        url: `/clubs/${club.id}/tournaments`,
        payload: { name: "First Tournament", format: "swiss", totalRounds: 5 },
        cookies: { sid: session.token }
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
      const { club, session } = await seedAuthenticatedOwner(testApp.db);
      await seedTournament(testApp.db, { clubId: club.id, status: "active" });

      const response = await testApp.app.inject({
        method: "POST",
        url: `/clubs/${club.id}/tournaments`,
        payload: { name: "Another Tournament" },
        cookies: { sid: session.token }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toMatch(/ongoing tournament/i);
    });
  });

  describe("GET /clubs/:clubId/tournaments", () => {
    it("lists tournaments without requiring create input", async () => {
      const { club, session } = await seedAuthenticatedOwner(testApp.db);
      await seedTournament(testApp.db, { clubId: club.id, name: "Dashboard Tournament" });

      const response = await testApp.app.inject({
        method: "GET",
        url: `/clubs/${club.id}/tournaments?limit=6`,
        cookies: { sid: session.token }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().tournaments).toHaveLength(1);
      expect(response.json().tournaments[0].name).toBe("Dashboard Tournament");
      expect(response.json().tournaments[0].playerCount).toBe(0);
      expect(response.json().tournaments[0].matchCount).toBe(0);
    });
  });

  describe("PUT /tournaments/:id", () => {
    it("updates name and totalRounds on a draft tournament", async () => {
      const { club, session } = await seedAuthenticatedOwner(testApp.db);
      const t = await seedTournament(testApp.db, { clubId: club.id, name: "Old", totalRounds: 4 });

      const response = await testApp.app.inject({
        method: "PUT",
        url: `/tournaments/${t.id}`,
        payload: { name: "Updated Tournament Name", totalRounds: 7 },
        cookies: { sid: session.token }
      });

      expect(response.statusCode).toBe(200);

      const fresh = await testApp.db.select().from(tournaments).where(eq(tournaments.id, t.id));
      expect(fresh[0]!.name).toBe("Updated Tournament Name");
      expect(fresh[0]!.totalRounds).toBe(7);
    });

    it("returns 400 for an invalid status value", async () => {
      const { club, session } = await seedAuthenticatedOwner(testApp.db);
      const t = await seedTournament(testApp.db, { clubId: club.id });

      const response = await testApp.app.inject({
        method: "PUT",
        url: `/tournaments/${t.id}`,
        payload: { status: "invalid" },
        cookies: { sid: session.token }
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for an invalid pairingMethod value", async () => {
      const { club, session } = await seedAuthenticatedOwner(testApp.db);
      const t = await seedTournament(testApp.db, { clubId: club.id });

      const response = await testApp.app.inject({
        method: "PUT",
        url: `/tournaments/${t.id}`,
        payload: { pairingMethod: "invalid" },
        cookies: { sid: session.token }
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("DELETE /tournaments/:id", () => {
    it("deletes a draft tournament and the row is gone", async () => {
      const { club, session } = await seedAuthenticatedOwner(testApp.db);
      const t = await seedTournament(testApp.db, { clubId: club.id, status: "draft" });

      const response = await testApp.app.inject({
        method: "DELETE",
        url: `/tournaments/${t.id}`,
        cookies: { sid: session.token }
      });

      expect(response.statusCode).toBe(200);

      const remaining = await testApp.db
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, t.id));
      expect(remaining).toHaveLength(0);
    });

    it("refuses to delete a non-draft tournament", async () => {
      const { club, session } = await seedAuthenticatedOwner(testApp.db);
      const t = await seedTournament(testApp.db, { clubId: club.id, status: "active" });

      const response = await testApp.app.inject({
        method: "DELETE",
        url: `/tournaments/${t.id}`,
        cookies: { sid: session.token }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toMatch(/draft status/i);
    });

    it("returns 404 for an unknown tournament id", async () => {
      const { session } = await seedAuthenticatedOwner(testApp.db);
      const response = await testApp.app.inject({
        method: "DELETE",
        url: "/tournaments/00000000-0000-0000-0000-000000000000",
        cookies: { sid: session.token }
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /clubs/:clubId/tournaments — name filter security & semantics
  // ---------------------------------------------------------------------------
  describe("GET /clubs/:clubId/tournaments name filter", () => {
    it("matches accented names case + accent insensitively via collation", async () => {
      const { club, session } = await seedAuthenticatedOwner(testApp.db);
      await seedTournament(testApp.db, { clubId: club.id, name: "Café Open" });
      await seedTournament(testApp.db, { clubId: club.id, name: "Winter Cup" });

      const response = await testApp.app.inject({
        method: "GET",
        url: `/clubs/${club.id}/tournaments?name=${encodeURIComponent("cafe")}`,
        cookies: { sid: session.token }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.tournaments).toHaveLength(1);
      expect(body.tournaments[0].name).toBe("Café Open");
    });

    it("treats `%` in the query as a literal, not a wildcard (LIKE injection)", async () => {
      const { club, session } = await seedAuthenticatedOwner(testApp.db);
      await seedTournament(testApp.db, { clubId: club.id, name: "50% Discount Open" });
      await seedTournament(testApp.db, { clubId: club.id, name: "Plain Open" });

      const response = await testApp.app.inject({
        method: "GET",
        url: `/clubs/${club.id}/tournaments?name=${encodeURIComponent("50%")}`,
        cookies: { sid: session.token }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.tournaments).toHaveLength(1);
      expect(body.tournaments[0].name).toBe("50% Discount Open");
    });

    // Diverse SQLi / wildcard-injection payloads. We don't enumerate every
    // imaginable string; we exercise representatives of every category to
    // prove the mechanism (parameter binding + LIKE escape + ESCAPE clause)
    // makes ALL such inputs inert literal text.
    const sqliPayloads: Array<[string, string]> = [
      ["tautology with quote-break",     "' OR '1'='1"],
      ["numeric tautology",              "' OR 2=2--"],
      ["comment terminator",             "'; DROP TABLE tournaments;--"],
      ["UNION extraction",               "' UNION SELECT password_hash FROM users--"],
      ["stacked query",                  "Cup'; DELETE FROM tournaments WHERE 't'='t"],
      ["backslash escape-break attempt", "Cup\\' OR 1=1--"],
      ["pure wildcards",                 "%%%"],
      ["mixed wildcards + tautology",    "%' OR '1'='1--"],
      ["LIKE pattern hijack with _",     "_____"],
      ["escape-clause neutralisation",   "\\% OR 1=1"]
    ];

    it.each(sqliPayloads)(
      "renders SQLi payload (%s) inert — treated as literal LIKE pattern",
      async (_label, payload) => {
        const { club, session } = await seedAuthenticatedOwner(testApp.db);
        await seedTournament(testApp.db, { clubId: club.id, name: "Winter Cup" });
        await seedTournament(testApp.db, { clubId: club.id, name: "Summer Open" });

        const response = await testApp.app.inject({
          method: "GET",
          url: `/clubs/${club.id}/tournaments?name=${encodeURIComponent(payload)}`,
          cookies: { sid: session.token }
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.tournaments).toHaveLength(0);
      }
    );
  });
});
