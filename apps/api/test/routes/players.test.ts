import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { players, playerRatings, matches, clubs } from "@chess-club/db";
import { createTestApp, type TestApp } from "../helpers/app.js";
import {
  seedClub,
  seedPlayer,
  seedAuthenticatedOwner,
  seedTournament
} from "../helpers/seed.js";

describe("player routes", () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  // -------------------------------------------------------------------------
  // POST /clubs/:clubId/players
  // -------------------------------------------------------------------------
  describe("POST /clubs/:clubId/players", () => {
    it("creates a player with default ratings", async () => {
      const club = await seedClub(testApp.db);

      const response = await testApp.app.inject({
        method: "POST",
        url: `/clubs/${club.id}/players`,
        payload: { displayName: "Alice" }
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.player).toMatchObject({
        displayName: "Alice",
        active: true,
        clubId: club.id
      });
      expect(body.player.id).toBeDefined();

      // Verify player was created
      const playerRows = await testApp.db
        .select()
        .from(players)
        .where(eq(players.id, body.player.id));
      expect(playerRows).toHaveLength(1);

      // Verify ratings were created with config defaults
      const ratingRows = await testApp.db
        .select()
        .from(playerRatings)
        .where(eq(playerRatings.playerId, body.player.id));
      expect(ratingRows).toHaveLength(1);
    });

    it("returns 400 for empty displayName", async () => {
      const club = await seedClub(testApp.db);

      const response = await testApp.app.inject({
        method: "POST",
        url: `/clubs/${club.id}/players`,
        payload: { displayName: "   " }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: "ValidationError",
        message: "displayName is required"
      });
    });

    it("returns 400 for duplicate player name in club", async () => {
      const club = await seedClub(testApp.db);
      await seedPlayer(testApp.db, { clubId: club.id, displayName: "Bob" });

      const response = await testApp.app.inject({
        method: "POST",
        url: `/clubs/${club.id}/players`,
        payload: { displayName: "Bob" }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: "ValidationError"
      });
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /clubs/:clubId/players/:playerId
  // -------------------------------------------------------------------------
  describe("DELETE /clubs/:clubId/players/:playerId", () => {
    it("deletes a player without match history", async () => {
      const club = await seedClub(testApp.db);
      const player = await seedPlayer(testApp.db, { clubId: club.id });

      const response = await testApp.app.inject({
        method: "DELETE",
        url: `/clubs/${club.id}/players/${player.id}`
      });

      expect(response.statusCode).toBe(204);

      // Verify player was deleted
      const playerRows = await testApp.db
        .select()
        .from(players)
        .where(eq(players.id, player.id));
      expect(playerRows).toHaveLength(0);

      // Verify ratings were deleted
      const ratingRows = await testApp.db
        .select()
        .from(playerRatings)
        .where(eq(playerRatings.playerId, player.id));
      expect(ratingRows).toHaveLength(0);
    });

    it("returns 404 for player not in club", async () => {
      const club1 = await seedClub(testApp.db);
      const club2 = await seedClub(testApp.db);
      const player = await seedPlayer(testApp.db, { clubId: club1.id });

      const response = await testApp.app.inject({
        method: "DELETE",
        url: `/clubs/${club2.id}/players/${player.id}`
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: "NotFound",
        message: "Player not found in this club"
      });
    });

    it("returns 400 for player with match history", async () => {
      const club = await seedClub(testApp.db);
      const player = await seedPlayer(testApp.db, { clubId: club.id });
      const tournament = await seedTournament(testApp.db, { clubId: club.id });

      // Create a match (using direct DB insert for simplicity)
      const today = new Date().toISOString().split('T')[0]!;
      await testApp.db.insert(matches).values({
        clubId: club.id,
        tournamentId: tournament.id,
        whitePlayerId: player.id,
        blackPlayerId: player.id,
        result: 1,
        playedOn: today
      });

      const response = await testApp.app.inject({
        method: "DELETE",
        url: `/clubs/${club.id}/players/${player.id}`
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: "ValidationError",
        message: "Cannot delete player with match history"
      });
    });
  });

  // -------------------------------------------------------------------------
  // GET /clubs/:clubId/players
  // -------------------------------------------------------------------------
  describe("GET /clubs/:clubId/players", () => {
    it("lists players with pagination", async () => {
      const club = await seedClub(testApp.db);
      // Seed 12 players. parsePaginationParams only accepts limit ∈ [10, 20, 50]
      // (any other value silently falls back to 20). Use limit=10 to exercise
      // real pagination boundaries.
      for (let i = 0; i < 12; i++) {
        await seedPlayer(testApp.db, {
          clubId: club.id,
          displayName: `Player${String(i).padStart(2, "0")}`
        });
      }

      const response = await testApp.app.inject({
        method: "GET",
        url: `/clubs/${club.id}/players?limit=10&page=1`
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.players).toHaveLength(10);
      expect(body.pagination).toMatchObject({
        page: 1,
        limit: 10,
        total: 12,
        totalPages: 2
      });

      // Page 2 should have remaining 2 players
      const page2 = await testApp.app.inject({
        method: "GET",
        url: `/clubs/${club.id}/players?limit=10&page=2`
      });
      expect(page2.json().players).toHaveLength(2);
    });

    it("filters by name", async () => {
      const club = await seedClub(testApp.db);
      await seedPlayer(testApp.db, { clubId: club.id, displayName: "Alice" });
      await seedPlayer(testApp.db, { clubId: club.id, displayName: "Bob" });
      await seedPlayer(testApp.db, { clubId: club.id, displayName: "Alfred" });

      const response = await testApp.app.inject({
        method: "GET",
        url: `/clubs/${club.id}/players?name=al`
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.players).toHaveLength(2);
      expect(body.players.map((p: { displayName: string }) => p.displayName)).toContain("Alice");
      expect(body.players.map((p: { displayName: string }) => p.displayName)).toContain("Alfred");
    });

    it("matches accented names case + accent insensitively via collation", async () => {
      const club = await seedClub(testApp.db);
      await seedPlayer(testApp.db, { clubId: club.id, displayName: "Café René" });
      await seedPlayer(testApp.db, { clubId: club.id, displayName: "Plain Jane" });

      const response = await testApp.app.inject({
        method: "GET",
        url: `/clubs/${club.id}/players?name=${encodeURIComponent("cafe rene")}`
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.players).toHaveLength(1);
      expect(body.players[0].displayName).toBe("Café René");
    });

    it("treats `%` in the query as a literal, not a wildcard (LIKE injection)", async () => {
      const club = await seedClub(testApp.db);
      await seedPlayer(testApp.db, { clubId: club.id, displayName: "50% off" });
      await seedPlayer(testApp.db, { clubId: club.id, displayName: "plain" });

      const response = await testApp.app.inject({
        method: "GET",
        url: `/clubs/${club.id}/players?name=${encodeURIComponent("50%")}`
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.players).toHaveLength(1);
      expect(body.players[0].displayName).toBe("50% off");
    });

    it("treats `_` in the query as a literal, not a single-char wildcard", async () => {
      const club = await seedClub(testApp.db);
      await seedPlayer(testApp.db, { clubId: club.id, displayName: "a_b" });
      await seedPlayer(testApp.db, { clubId: club.id, displayName: "axb" });

      const response = await testApp.app.inject({
        method: "GET",
        url: `/clubs/${club.id}/players?name=${encodeURIComponent("a_b")}`
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.players).toHaveLength(1);
      expect(body.players[0].displayName).toBe("a_b");
    });

    // The fix relies on two layers: (1) Drizzle parameter binding so payloads
    // never reach the SQL parser as code, and (2) escapeLikePattern() + ESCAPE
    // clause so LIKE metacharacters in the bound value cannot widen the match.
    // We don't enumerate every imaginable payload — we exercise diverse
    // representatives of every injection category to prove the mechanism, not
    // string-match specific strings.
    const sqliPayloads: Array<[string, string]> = [
      ["tautology with quote-break",     "' OR '1'='1"],
      ["numeric tautology",              "' OR 2=2--"],
      ["comment terminator",             "'; DROP TABLE players;--"],
      ["UNION extraction",               "' UNION SELECT password_hash FROM users--"],
      ["stacked query",                  "Alice'; DELETE FROM players WHERE 't'='t"],
      ["boolean-blind",                  "Alice' AND SUBSTR(email,1,1)='a"],
      ["backslash escape-break attempt", "Alice\\' OR 1=1--"],
      ["pure wildcards",                 "%%%"],
      ["mixed wildcards + tautology",    "%' OR '1'='1--"],
      ["LIKE pattern hijack with _",     "_____"],
      ["escape-clause neutralisation",   "\\% OR 1=1"]
    ];

    it.each(sqliPayloads)(
      "renders SQLi payload (%s) inert — treated as literal LIKE pattern",
      async (_label, payload) => {
        const club = await seedClub(testApp.db);
        await seedPlayer(testApp.db, { clubId: club.id, displayName: "Alice" });
        await seedPlayer(testApp.db, { clubId: club.id, displayName: "Bob" });

        const response = await testApp.app.inject({
          method: "GET",
          url: `/clubs/${club.id}/players?name=${encodeURIComponent(payload)}`
        });

        // 200 (request succeeded — no SQL syntax error escaped the bind)
        // AND 0 results (the literal payload string does not appear inside
        // any seeded display name). If even one assertion fails, either
        // parameter binding leaked or the LIKE wildcards weren't escaped.
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.players).toHaveLength(0);
      }
    );

    it("preserves literal match when the payload IS a substring of a seeded name", async () => {
      // Sanity counterpart: prove the previous tests would fail if the literal
      // payload actually appeared in a row. This rules out "test passes because
      // search is broken" as the cause.
      const club = await seedClub(testApp.db);
      await seedPlayer(testApp.db, { clubId: club.id, displayName: "weird ' OR '1'='1 name" });

      const response = await testApp.app.inject({
        method: "GET",
        url: `/clubs/${club.id}/players?name=${encodeURIComponent("' OR '1'='1")}`
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.players).toHaveLength(1);
      expect(body.players[0].displayName).toBe("weird ' OR '1'='1 name");
    });

    it("accepts a very long name query (length cap, no error)", async () => {
      const club = await seedClub(testApp.db);
      await seedPlayer(testApp.db, { clubId: club.id, displayName: "Alice" });

      const longName = "a".repeat(500);
      const response = await testApp.app.inject({
        method: "GET",
        url: `/clubs/${club.id}/players?name=${longName}`
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.players).toHaveLength(0);
    });

    it("filters by active status", async () => {
      const club = await seedClub(testApp.db);
      await seedPlayer(testApp.db, { clubId: club.id, displayName: "Alice", active: true });
      await seedPlayer(testApp.db, { clubId: club.id, displayName: "Bob", active: false });

      const response = await testApp.app.inject({
        method: "GET",
        url: `/clubs/${club.id}/players?active=true`
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.players).toHaveLength(1);
      expect(body.players[0].displayName).toBe("Alice");
    });

    it("sorts by elo", async () => {
      const club = await seedClub(testApp.db);
      const p1 = await seedPlayer(testApp.db, { clubId: club.id, displayName: "Alice" });
      const p2 = await seedPlayer(testApp.db, { clubId: club.id, displayName: "Bob" });

      // Update ratings directly
      await testApp.db
        .update(playerRatings)
        .set({ elo: 1500 })
        .where(eq(playerRatings.playerId, p1.id));
      await testApp.db
        .update(playerRatings)
        .set({ elo: 1200 })
        .where(eq(playerRatings.playerId, p2.id));

      const response = await testApp.app.inject({
        method: "GET",
        url: `/clubs/${club.id}/players?sortBy=elo&sortOrder=desc`
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.players[0].elo).toBe(1500);
      expect(body.players[1].elo).toBe(1200);
    });

    it("returns 404 for page beyond total", async () => {
      const club = await seedClub(testApp.db);
      await seedPlayer(testApp.db, { clubId: club.id });

      const response = await testApp.app.inject({
        method: "GET",
        url: `/clubs/${club.id}/players?page=999`
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: "NotFound",
        message: "Page exceeds total pages"
      });
    });
  });

  // -------------------------------------------------------------------------
  // GET /players/:id
  // -------------------------------------------------------------------------
  describe("GET /players/:id", () => {
    it("returns player with ratings and club info", async () => {
      const club = await seedClub(testApp.db, { name: "Test Club" });
      const player = await seedPlayer(testApp.db, { clubId: club.id, displayName: "Alice" });

      const response = await testApp.app.inject({
        method: "GET",
        url: `/players/${player.id}`
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.player).toMatchObject({
        id: player.id,
        displayName: "Alice",
        clubName: "Test Club",
        clubId: club.id
      });
      expect(body.player.elo).toBeDefined();
      expect(body.player.glickoRating).toBeDefined();
      expect(body.matches).toEqual([]);
    });

    it("returns 404 for non-existent player", async () => {
      const response = await testApp.app.inject({
        method: "GET",
        url: "/players/00000000-0000-0000-0000-000000000000"
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: "NotFound",
        message: "Player not found"
      });
    });
  });

  // -------------------------------------------------------------------------
  // PUT /players/:id
  // -------------------------------------------------------------------------
  describe("PUT /players/:id", () => {
    it("updates player displayName", async () => {
      const club = await seedClub(testApp.db);
      const player = await seedPlayer(testApp.db, { clubId: club.id, displayName: "Alice" });

      const response = await testApp.app.inject({
        method: "PUT",
        url: `/players/${player.id}`,
        payload: { displayName: "Alice Updated" }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.player.displayName).toBe("Alice Updated");

      // Verify in DB
      const rows = await testApp.db
        .select()
        .from(players)
        .where(eq(players.id, player.id));
      expect(rows[0]!.displayName).toBe("Alice Updated");
    });

    it("updates player active status", async () => {
      const club = await seedClub(testApp.db);
      const player = await seedPlayer(testApp.db, { clubId: club.id, displayName: "Alice", active: true });

      const response = await testApp.app.inject({
        method: "PUT",
        url: `/players/${player.id}`,
        payload: { active: false }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.player.active).toBe(false);
    });

    it("returns 400 for empty displayName", async () => {
      const club = await seedClub(testApp.db);
      const player = await seedPlayer(testApp.db, { clubId: club.id });

      const response = await testApp.app.inject({
        method: "PUT",
        url: `/players/${player.id}`,
        payload: { displayName: "   " }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: "ValidationError",
        message: "displayName cannot be empty"
      });
    });

    it("returns 400 for no fields to update", async () => {
      const club = await seedClub(testApp.db);
      const player = await seedPlayer(testApp.db, { clubId: club.id });

      const response = await testApp.app.inject({
        method: "PUT",
        url: `/players/${player.id}`,
        payload: {}
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: "ValidationError",
        message: "No fields to update"
      });
    });

    it("returns 404 for non-existent player", async () => {
      const response = await testApp.app.inject({
        method: "PUT",
        url: "/players/00000000-0000-0000-0000-000000000000",
        payload: { displayName: "Test" }
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: "NotFound",
        message: "Player not found"
      });
    });
  });
});
