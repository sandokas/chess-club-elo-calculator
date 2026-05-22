import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { clubs, clubMemberships } from "@chess-club/db";
import { createTestApp, type TestApp } from "../helpers/app.js";
import {
  seedClub,
  seedAuthenticatedOwner,
  seedPlayer
} from "../helpers/seed.js";

describe("club routes", () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  // -------------------------------------------------------------------------
  // GET /clubs
  // -------------------------------------------------------------------------
  describe("GET /clubs", () => {
    it("lists all clubs when auth is not required", async () => {
      await seedClub(testApp.db, { name: "Club A" });
      await seedClub(testApp.db, { name: "Club B" });

      const response = await testApp.app.inject({
        method: "GET",
        url: "/clubs"
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.clubs).toHaveLength(2);
    });

    it("returns empty list when no clubs exist", async () => {
      const response = await testApp.app.inject({
        method: "GET",
        url: "/clubs"
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.clubs).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // POST /clubs
  // -------------------------------------------------------------------------
  describe("POST /clubs", () => {
    it("creates a club with slug generation", async () => {
      const { session } = await seedAuthenticatedOwner(testApp.db);

      const response = await testApp.app.inject({
        method: "POST",
        url: "/clubs",
        payload: { name: "Test Club", description: "A test club", city: "Berlin", country: "Germany" },
        headers: { cookie: `session=${session.token}` }
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.club).toMatchObject({
        name: "Test Club",
        slug: "test-club",
        description: "A test club",
        city: "Berlin",
        country: "Germany"
      });
      expect(body.club.id).toBeDefined();
    });

    it("returns 400 for empty name", async () => {
      const { session } = await seedAuthenticatedOwner(testApp.db);

      const response = await testApp.app.inject({
        method: "POST",
        url: "/clubs",
        payload: { name: "   " },
        headers: { cookie: `session=${session.token}` }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: "ValidationError",
        message: "name must contain valid characters"
      });
    });

    it("returns 409 for duplicate slug", async () => {
      await seedClub(testApp.db, { name: "Test Club", slug: "test-club" });
      const { session } = await seedAuthenticatedOwner(testApp.db);

      const response = await testApp.app.inject({
        method: "POST",
        url: "/clubs",
        payload: { name: "Test Club" },
        headers: { cookie: `session=${session.token}` }
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: "ConflictError",
        message: "A club with this slug already exists"
      });
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /clubs/:clubId
  // -------------------------------------------------------------------------
  describe("PATCH /clubs/:clubId", () => {
    it("updates club name", async () => {
      const { user, club, session } = await seedAuthenticatedOwner(testApp.db, { clubName: "Original Name" });

      const response = await testApp.app.inject({
        method: "PATCH",
        url: `/clubs/${club.id}`,
        payload: { name: "Updated Name" },
        headers: { cookie: `session=${session.token}` }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.club.name).toBe("Updated Name");
    });

    it("updates club description", async () => {
      const { club, session } = await seedAuthenticatedOwner(testApp.db);

      const response = await testApp.app.inject({
        method: "PATCH",
        url: `/clubs/${club.id}`,
        payload: { description: "New description" },
        headers: { cookie: `session=${session.token}` }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.club.description).toBe("New description");
    });

    it("returns 400 for no fields to update", async () => {
      const { club, session } = await seedAuthenticatedOwner(testApp.db);

      const response = await testApp.app.inject({
        method: "PATCH",
        url: `/clubs/${club.id}`,
        payload: {},
        headers: { cookie: `session=${session.token}` }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: "ValidationError",
        message: ": No fields to update"
      });
    });

    it("returns 404 for non-existent club", async () => {
      const { session } = await seedAuthenticatedOwner(testApp.db);

      const response = await testApp.app.inject({
        method: "PATCH",
        url: "/clubs/00000000-0000-0000-0000-000000000000",
        payload: { name: "Test" },
        headers: { cookie: `session=${session.token}` }
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: "NotFound",
        message: "Club not found"
      });
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /clubs/:clubId
  // -------------------------------------------------------------------------
  describe("DELETE /clubs/:clubId", () => {
    it("deletes a club", async () => {
      const { club, session } = await seedAuthenticatedOwner(testApp.db);

      const response = await testApp.app.inject({
        method: "DELETE",
        url: `/clubs/${club.id}`,
        headers: { cookie: `session=${session.token}` }
      });

      expect(response.statusCode).toBe(204);

      // Verify club was deleted
      const clubRows = await testApp.db
        .select()
        .from(clubs)
        .where(eq(clubs.id, club.id));
      expect(clubRows).toHaveLength(0);
    });

    it("returns 404 for non-existent club", async () => {
      const { session } = await seedAuthenticatedOwner(testApp.db);

      const response = await testApp.app.inject({
        method: "DELETE",
        url: "/clubs/00000000-0000-0000-0000-000000000000",
        headers: { cookie: `session=${session.token}` }
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: "NotFound",
        message: "Club not found"
      });
    });
  });

  // -------------------------------------------------------------------------
  // POST /clubs/:clubId/ratings/recompute
  // -------------------------------------------------------------------------
  describe("POST /clubs/:clubId/ratings/recompute", () => {
    it("returns 200 when no players exist in club", async () => {
      const { club, session } = await seedAuthenticatedOwner(testApp.db);

      const response = await testApp.app.inject({
        method: "POST",
        url: `/clubs/${club.id}/ratings/recompute`,
        headers: { cookie: `session=${session.token}` }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.message).toBe("No players found in club");
      expect(body.playersUpdated).toBe(0);
    });
  });
});
