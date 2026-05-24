import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { clubs, clubMemberships } from "@chess-club/db";
import { createTestApp, type TestApp } from "../helpers/app.js";
import {
  seedClub,
  seedAuthenticatedOwner,
  seedMembership,
  seedPlayer,
  seedSession,
  seedUser
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
    it("returns 401 without authentication", async () => {
      const response = await testApp.app.inject({
        method: "GET",
        url: "/clubs"
      });

      expect(response.statusCode).toBe(401);
    });

    it("returns empty list when authenticated user has no memberships", async () => {
      const user = await seedUser(testApp.db);
      const { token } = await seedSession(testApp.db, { userId: user.id });

      const response = await testApp.app.inject({
        method: "GET",
        url: "/clubs",
        cookies: { sid: token }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.clubs).toHaveLength(0);
    });

    it("lists only clubs where the authenticated user is a member", async () => {
      const user = await seedUser(testApp.db);
      const { token } = await seedSession(testApp.db, { userId: user.id });
      const clubA = await seedClub(testApp.db, { name: "Club A" });
      await seedMembership(testApp.db, { userId: user.id, clubId: clubA.id, role: "member" });
      await seedClub(testApp.db, { name: "Club B" });

      const response = await testApp.app.inject({
        method: "GET",
        url: "/clubs",
        cookies: { sid: token }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().clubs).toEqual([
        expect.objectContaining({ id: clubA.id, name: "Club A" })
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // POST /clubs
  // -------------------------------------------------------------------------
  describe("POST /clubs", () => {
    it("creates a club with slug generation", async () => {
      const { user, session } = await seedAuthenticatedOwner(testApp.db);

      const response = await testApp.app.inject({
        method: "POST",
        url: "/clubs",
        payload: { name: "Test Club", description: "A test club", city: "Berlin", country: "Germany" },
        cookies: { sid: session.token }
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

      const memberships = await testApp.db
        .select()
        .from(clubMemberships)
        .where(eq(clubMemberships.clubId, body.club.id));
      expect(memberships).toHaveLength(1);
      expect(memberships[0]).toMatchObject({ userId: user.id, role: "owner" });
    });

    it("returns 401 without authentication", async () => {
      const response = await testApp.app.inject({
        method: "POST",
        url: "/clubs",
        payload: { name: "Test Club" }
      });

      expect(response.statusCode).toBe(401);
    });

    it("returns 400 for empty name", async () => {
      const { session } = await seedAuthenticatedOwner(testApp.db);

      const response = await testApp.app.inject({
        method: "POST",
        url: "/clubs",
        payload: { name: "   " },
        cookies: { sid: session.token }
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
        cookies: { sid: session.token }
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
        cookies: { sid: session.token }
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
        cookies: { sid: session.token }
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
        cookies: { sid: session.token }
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
        cookies: { sid: session.token }
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
        cookies: { sid: session.token }
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
        cookies: { sid: session.token }
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
        cookies: { sid: session.token }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.message).toBe("No players found in club");
      expect(body.playersUpdated).toBe(0);
    });
  });
});
