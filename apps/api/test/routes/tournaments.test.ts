import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { matches, playerRatings, tournaments } from "@chess-club/db";
import { createTestApp, type TestApp } from "../helpers/app.js";
import { seedAuthenticatedOwner, seedPlayer, seedTournament } from "../helpers/seed.js";
import { ratingConfig } from "@chess-club/config";

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

  describe("PUT /matches/:id/result", () => {
    it("applies ratings incrementally and stores complete match audits", async () => {
      const { club, session } = await seedAuthenticatedOwner(testApp.db);
      const tournament = await seedTournament(testApp.db, { clubId: club.id, status: "active" });
      const player1 = await seedPlayer(testApp.db, { clubId: club.id, displayName: "Player One" });
      const player2 = await seedPlayer(testApp.db, { clubId: club.id, displayName: "Player Two" });
      const player3 = await seedPlayer(testApp.db, { clubId: club.id, displayName: "Player Three" });

      const [firstMatch] = await testApp.db.insert(matches).values({
        clubId: club.id,
        tournamentId: tournament.id,
        whitePlayerId: player1.id,
        blackPlayerId: player2.id,
        playedOn: "2026-06-20"
      }).returning({ id: matches.id });

      const firstResponse = await testApp.app.inject({
        method: "PUT",
        url: `/matches/${firstMatch!.id}/result`,
        payload: { result: 1 },
        cookies: { sid: session.token }
      });
      expect(firstResponse.statusCode).toBe(200);

      const [firstAudit] = await testApp.db.select().from(matches).where(eq(matches.id, firstMatch!.id));
      expect(firstAudit).toMatchObject({
        whiteEloBefore: ratingConfig.defaultElo,
        blackEloBefore: ratingConfig.defaultElo,
        whiteGlickoRatingBefore: ratingConfig.g2DefaultRating,
        blackGlickoRatingBefore: ratingConfig.g2DefaultRating,
        whiteLastPlayedBefore: null,
        blackLastPlayedBefore: null
      });
      expect(firstAudit!.whiteEloAfter).not.toBeNull();
      expect(firstAudit!.blackEloAfter).not.toBeNull();
      expect(firstAudit!.whiteGlickoRatingAfter).not.toBeNull();
      expect(firstAudit!.blackGlickoRatingAfter).not.toBeNull();
      expect(firstAudit!.whiteGlickoRdAfter).not.toBeNull();
      expect(firstAudit!.blackGlickoVolAfter).not.toBeNull();

      const [player1AfterFirst] = await testApp.db.select().from(playerRatings)
        .where(eq(playerRatings.playerId, player1.id));
      expect(player1AfterFirst).toMatchObject({
        elo: firstAudit!.whiteEloAfter,
        glickoRating: firstAudit!.whiteGlickoRatingAfter,
        gamesPlayed: 1,
        lastGameDate: "2026-06-20",
        lastGameMatchId: firstMatch!.id
      });

      const [secondMatch] = await testApp.db.insert(matches).values({
        clubId: club.id,
        tournamentId: tournament.id,
        whitePlayerId: player1.id,
        blackPlayerId: player3.id,
        playedOn: "2026-06-21"
      }).returning({ id: matches.id });

      const secondResponse = await testApp.app.inject({
        method: "PUT",
        url: `/matches/${secondMatch!.id}/result`,
        payload: { result: 0 },
        cookies: { sid: session.token }
      });
      expect(secondResponse.statusCode).toBe(200);

      const [secondAudit] = await testApp.db.select().from(matches).where(eq(matches.id, secondMatch!.id));
      expect(secondAudit!.whiteEloBefore).toBe(firstAudit!.whiteEloAfter);
      expect(secondAudit!.whiteGlickoRatingBefore).toBe(firstAudit!.whiteGlickoRatingAfter);
      expect(secondAudit!.whiteLastPlayedBefore).toBe("2026-06-20");
    });

    it("is idempotent and replaces the latest result from its stored before state", async () => {
      const { club, session } = await seedAuthenticatedOwner(testApp.db);
      const tournament = await seedTournament(testApp.db, { clubId: club.id, status: "active" });
      const white = await seedPlayer(testApp.db, { clubId: club.id });
      const black = await seedPlayer(testApp.db, { clubId: club.id });
      const [match] = await testApp.db.insert(matches).values({
        clubId: club.id,
        tournamentId: tournament.id,
        whitePlayerId: white.id,
        blackPlayerId: black.id,
        playedOn: "2026-06-21"
      }).returning({ id: matches.id });

      const submit = (result: number | null) => testApp.app.inject({
        method: "PUT",
        url: `/matches/${match!.id}/result`,
        payload: { result },
        cookies: { sid: session.token }
      });

      expect((await submit(1)).statusCode).toBe(200);
      const [winAudit] = await testApp.db.select().from(matches).where(eq(matches.id, match!.id));
      expect((await submit(1)).statusCode).toBe(200);

      const [afterDuplicate] = await testApp.db.select().from(playerRatings)
        .where(eq(playerRatings.playerId, white.id));
      expect(afterDuplicate!.gamesPlayed).toBe(1);
      expect(afterDuplicate!.elo).toBe(winAudit!.whiteEloAfter);

      expect((await submit(0)).statusCode).toBe(200);
      const [lossAudit] = await testApp.db.select().from(matches).where(eq(matches.id, match!.id));
      const [afterReplacement] = await testApp.db.select().from(playerRatings)
        .where(eq(playerRatings.playerId, white.id));
      expect(lossAudit!.whiteEloBefore).toBe(ratingConfig.defaultElo);
      expect(lossAudit!.whiteEloAfter).toBeLessThan(ratingConfig.defaultElo);
      expect(afterReplacement!.gamesPlayed).toBe(1);
      expect(afterReplacement!.elo).toBe(lossAudit!.whiteEloAfter);

      expect((await submit(null)).statusCode).toBe(200);
      const [clearedMatch] = await testApp.db.select().from(matches).where(eq(matches.id, match!.id));
      const [afterUndo] = await testApp.db.select().from(playerRatings)
        .where(eq(playerRatings.playerId, white.id));
      expect(clearedMatch!.result).toBeNull();
      expect(clearedMatch!.whiteEloBefore).toBeNull();
      expect(clearedMatch!.whiteEloAfter).toBeNull();
      expect(afterUndo).toMatchObject({
        elo: ratingConfig.defaultElo,
        glickoRating: ratingConfig.g2DefaultRating,
        gamesPlayed: 0,
        lastGameDate: null,
        lastGameMatchId: null
      });
    });

    it("detects a later game when the player changed colors", async () => {
      const { club, session } = await seedAuthenticatedOwner(testApp.db);
      const tournament = await seedTournament(testApp.db, { clubId: club.id, status: "active" });
      const player = await seedPlayer(testApp.db, { clubId: club.id });
      const opponent1 = await seedPlayer(testApp.db, { clubId: club.id });
      const opponent2 = await seedPlayer(testApp.db, { clubId: club.id });
      const [older] = await testApp.db.insert(matches).values({
        clubId: club.id,
        tournamentId: tournament.id,
        whitePlayerId: player.id,
        blackPlayerId: opponent1.id,
        playedOn: "2026-06-20"
      }).returning({ id: matches.id });
      const [newer] = await testApp.db.insert(matches).values({
        clubId: club.id,
        tournamentId: tournament.id,
        whitePlayerId: opponent2.id,
        blackPlayerId: player.id,
        playedOn: "2026-06-21"
      }).returning({ id: matches.id });

      for (const matchId of [older!.id, newer!.id]) {
        const response = await testApp.app.inject({
          method: "PUT",
          url: `/matches/${matchId}/result`,
          payload: { result: 1 },
          cookies: { sid: session.token }
        });
        expect(response.statusCode).toBe(200);
      }

      const response = await testApp.app.inject({
        method: "PUT",
        url: `/matches/${older!.id}/result`,
        payload: { result: 0 },
        cookies: { sid: session.token }
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().message).toMatch(/last game/i);
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
