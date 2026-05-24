import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { clubInvites, clubJoinRequests, clubMemberships, players } from "@chess-club/db";
import { createTestApp, type TestApp } from "../helpers/app.js";
import {
  seedAuthenticatedOwner,
  seedClub,
  seedMembership,
  seedPlayer,
  seedSession,
  seedUser
} from "../helpers/seed.js";

describe("invite routes", () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  // -------------------------------------------------------------------------
  // POST /clubs/:clubId/invites
  // -------------------------------------------------------------------------
  describe("POST /clubs/:clubId/invites", () => {
    it("returns 401 without authentication", async () => {
      const response = await testApp.app.inject({
        method: "POST",
        url: "/clubs/00000000-0000-0000-0000-000000000000/invites",
        payload: { email: "x@example.com", role: "member" }
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        error: "Unauthorized",
        message: "Authentication required"
      });
    });

    it("returns 403 when the user is a non-admin member of the club", async () => {
      const user = await seedUser(testApp.db);
      const club = await seedClub(testApp.db);
      await seedMembership(testApp.db, { userId: user.id, clubId: club.id, role: "member" });
      const { token } = await seedSession(testApp.db, { userId: user.id });

      const response = await testApp.app.inject({
        method: "POST",
        url: `/clubs/${club.id}/invites`,
        payload: { email: "x@example.com", role: "member" },
        cookies: { sid: token }
      });
      expect(response.statusCode).toBe(403);
    });

    it("returns 400 for an invalid role", async () => {
      const { club, session } = await seedAuthenticatedOwner(testApp.db);

      const response = await testApp.app.inject({
        method: "POST",
        url: `/clubs/${club.id}/invites`,
        payload: { email: "x@example.com", role: "invalid" },
        cookies: { sid: session.token }
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: "ValidationError",
        message: expect.stringContaining("role must be one of")
      });
    });

    it("creates an invite when called by an admin", async () => {
      const { club, session } = await seedAuthenticatedOwner(testApp.db);

      const response = await testApp.app.inject({
        method: "POST",
        url: `/clubs/${club.id}/invites`,
        payload: { email: "guest@example.com", role: "member" },
        cookies: { sid: session.token }
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.invite).toMatchObject({
        clubId: club.id,
        email: "guest@example.com",
        role: "member"
      });
      expect(body.token).toMatch(/^[A-Za-z0-9_-]+$/);

      // Row is persisted
      const rows = await testApp.db
        .select()
        .from(clubInvites)
        .where(eq(clubInvites.clubId, club.id));
      expect(rows).toHaveLength(1);
    });

    it("returns 409 when a pending invite already exists for the same email", async () => {
      const { club, session } = await seedAuthenticatedOwner(testApp.db);

      const first = await testApp.app.inject({
        method: "POST",
        url: `/clubs/${club.id}/invites`,
        payload: { email: "dupe@example.com", role: "member" },
        cookies: { sid: session.token }
      });
      expect(first.statusCode).toBe(201);

      const second = await testApp.app.inject({
        method: "POST",
        url: `/clubs/${club.id}/invites`,
        payload: { email: "dupe@example.com", role: "member" },
        cookies: { sid: session.token }
      });
      expect(second.statusCode).toBe(409);
    });
  });

  // -------------------------------------------------------------------------
  // GET /clubs/:clubId/invites
  // -------------------------------------------------------------------------
  describe("GET /clubs/:clubId/invites", () => {
    it("returns 401 without authentication", async () => {
      const response = await testApp.app.inject({
        method: "GET",
        url: "/clubs/00000000-0000-0000-0000-000000000000/invites"
      });
      expect(response.statusCode).toBe(401);
    });

    it("returns 403 for a non-admin member", async () => {
      const user = await seedUser(testApp.db);
      const club = await seedClub(testApp.db);
      await seedMembership(testApp.db, { userId: user.id, clubId: club.id, role: "member" });
      const { token } = await seedSession(testApp.db, { userId: user.id });

      const response = await testApp.app.inject({
        method: "GET",
        url: `/clubs/${club.id}/invites`,
        cookies: { sid: token }
      });
      expect(response.statusCode).toBe(403);
    });

    it("lists invites for an admin", async () => {
      const { club, session } = await seedAuthenticatedOwner(testApp.db);

      // Create two invites via the API so the test exercises the read path
      // against rows the API itself wrote (avoids coupling to the DB schema).
      for (const email of ["a@example.com", "b@example.com"]) {
        const r = await testApp.app.inject({
          method: "POST",
          url: `/clubs/${club.id}/invites`,
          payload: { email, role: "member" },
          cookies: { sid: session.token }
        });
        expect(r.statusCode).toBe(201);
      }

      const response = await testApp.app.inject({
        method: "GET",
        url: `/clubs/${club.id}/invites`,
        cookies: { sid: session.token }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.invites).toHaveLength(2);
      expect(body.invites.map((i: { email: string }) => i.email).sort()).toEqual([
        "a@example.com",
        "b@example.com"
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // POST /clubs/:clubId/join-requests
  // -------------------------------------------------------------------------
  describe("POST /clubs/:clubId/join-requests", () => {
    it("returns 401 without authentication", async () => {
      const response = await testApp.app.inject({
        method: "POST",
        url: "/clubs/00000000-0000-0000-0000-000000000000/join-requests",
        payload: { message: "Hi" }
      });
      expect(response.statusCode).toBe(401);
    });

    it("creates a join request for an authenticated non-member", async () => {
      const club = await seedClub(testApp.db);
      const user = await seedUser(testApp.db);
      const { token } = await seedSession(testApp.db, { userId: user.id });

      const response = await testApp.app.inject({
        method: "POST",
        url: `/clubs/${club.id}/join-requests`,
        payload: { message: "I'd like to join" },
        cookies: { sid: token }
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().joinRequest).toMatchObject({
        clubId: club.id,
        userId: user.id,
        status: "pending"
      });

      const rows = await testApp.db
        .select()
        .from(clubJoinRequests)
        .where(eq(clubJoinRequests.userId, user.id));
      expect(rows).toHaveLength(1);
    });

    it("returns 409 when the user is already a member", async () => {
      const user = await seedUser(testApp.db);
      const club = await seedClub(testApp.db);
      await seedMembership(testApp.db, { userId: user.id, clubId: club.id, role: "member" });
      const { token } = await seedSession(testApp.db, { userId: user.id });

      const response = await testApp.app.inject({
        method: "POST",
        url: `/clubs/${club.id}/join-requests`,
        payload: {},
        cookies: { sid: token }
      });
      expect(response.statusCode).toBe(409);
    });
  });

  describe("POST /club-join-requests", () => {
    it("returns 401 without authentication", async () => {
      const response = await testApp.app.inject({
        method: "POST",
        url: "/club-join-requests",
        payload: { clubName: "Private Club" }
      });
      expect(response.statusCode).toBe(401);
    });

    it("creates a pending request by club name without exposing club existence", async () => {
      const club = await seedClub(testApp.db, { name: "Private Club" });
      const user = await seedUser(testApp.db);
      const { token } = await seedSession(testApp.db, { userId: user.id });

      const response = await testApp.app.inject({
        method: "POST",
        url: "/club-join-requests",
        payload: { clubName: "Private Club", message: "please" },
        cookies: { sid: token }
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ message: "Join request submitted if the club exists" });

      const rows = await testApp.db
        .select()
        .from(clubJoinRequests)
        .where(and(eq(clubJoinRequests.clubId, club.id), eq(clubJoinRequests.userId, user.id)));
      expect(rows).toHaveLength(1);
    });

    it("returns the same response when the club does not exist", async () => {
      const user = await seedUser(testApp.db);
      const { token } = await seedSession(testApp.db, { userId: user.id });

      const response = await testApp.app.inject({
        method: "POST",
        url: "/club-join-requests",
        payload: { clubName: "Missing Club" },
        cookies: { sid: token }
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ message: "Join request submitted if the club exists" });

      const rows = await testApp.db
        .select()
        .from(clubJoinRequests)
        .where(eq(clubJoinRequests.userId, user.id));
      expect(rows).toHaveLength(0);
    });

    it("does not duplicate pending requests", async () => {
      await seedClub(testApp.db, { name: "Private Club" });
      const user = await seedUser(testApp.db);
      const { token } = await seedSession(testApp.db, { userId: user.id });

      for (let i = 0; i < 2; i++) {
        const response = await testApp.app.inject({
          method: "POST",
          url: "/club-join-requests",
          payload: { clubName: "Private Club" },
          cookies: { sid: token }
        });
        expect(response.statusCode).toBe(202);
      }

      const rows = await testApp.db
        .select()
        .from(clubJoinRequests)
        .where(eq(clubJoinRequests.userId, user.id));
      expect(rows).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // GET /clubs/:clubId/join-requests
  // -------------------------------------------------------------------------
  describe("GET /clubs/:clubId/join-requests", () => {
    it("returns 401 without authentication", async () => {
      const response = await testApp.app.inject({
        method: "GET",
        url: "/clubs/00000000-0000-0000-0000-000000000000/join-requests"
      });
      expect(response.statusCode).toBe(401);
    });

    it("returns 403 for a non-admin member", async () => {
      const user = await seedUser(testApp.db);
      const club = await seedClub(testApp.db);
      await seedMembership(testApp.db, { userId: user.id, clubId: club.id, role: "member" });
      const { token } = await seedSession(testApp.db, { userId: user.id });

      const response = await testApp.app.inject({
        method: "GET",
        url: `/clubs/${club.id}/join-requests`,
        cookies: { sid: token }
      });
      expect(response.statusCode).toBe(403);
    });

    it("lists pending requests for an admin", async () => {
      const { club, session: adminSession } = await seedAuthenticatedOwner(testApp.db);
      const applicant = await seedUser(testApp.db, { email: "applicant@example.com" });
      const { token: applicantToken } = await seedSession(testApp.db, { userId: applicant.id });

      // Applicant submits a request
      await testApp.app.inject({
        method: "POST",
        url: `/clubs/${club.id}/join-requests`,
        payload: { message: "please" },
        cookies: { sid: applicantToken }
      });

      // Admin lists
      const response = await testApp.app.inject({
        method: "GET",
        url: `/clubs/${club.id}/join-requests`,
        cookies: { sid: adminSession.token }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.joinRequests).toHaveLength(1);
      expect(body.joinRequests[0]).toMatchObject({
        clubId: club.id,
        userId: applicant.id,
        status: "pending"
      });
    });
  });

  // -------------------------------------------------------------------------
  // PUT /clubs/:clubId/join-requests/:id
  // -------------------------------------------------------------------------
  describe("PUT /clubs/:clubId/join-requests/:id", () => {
    it("returns 401 without authentication", async () => {
      const response = await testApp.app.inject({
        method: "PUT",
        url: "/clubs/00000000-0000-0000-0000-000000000000/join-requests/00000000-0000-0000-0000-000000000000",
        payload: { action: "accept", playerId: "x" }
      });
      expect(response.statusCode).toBe(401);
    });

    it("returns 400 for an invalid action", async () => {
      const { club, session } = await seedAuthenticatedOwner(testApp.db);

      const response = await testApp.app.inject({
        method: "PUT",
        url: `/clubs/${club.id}/join-requests/00000000-0000-0000-0000-000000000000`,
        payload: { action: "invalid", playerId: "x" },
        cookies: { sid: session.token }
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: "ValidationError",
        message: "action must be 'accept' or 'reject'"
      });
    });

    it("accepting links the player and creates a member membership", async () => {
      const { club, session: adminSession } = await seedAuthenticatedOwner(testApp.db);
      const applicant = await seedUser(testApp.db, { email: "joining@example.com" });
      const { token: applicantToken } = await seedSession(testApp.db, { userId: applicant.id });
      const player = await seedPlayer(testApp.db, { clubId: club.id });

      // Applicant requests, admin accepts
      const reqRes = await testApp.app.inject({
        method: "POST",
        url: `/clubs/${club.id}/join-requests`,
        payload: { message: "let me in" },
        cookies: { sid: applicantToken }
      });
      expect(reqRes.statusCode).toBe(201);
      const joinRequestId = reqRes.json().joinRequest.id;

      const acceptRes = await testApp.app.inject({
        method: "PUT",
        url: `/clubs/${club.id}/join-requests/${joinRequestId}`,
        payload: { action: "accept", playerId: player.id },
        cookies: { sid: adminSession.token }
      });
      expect(acceptRes.statusCode).toBe(200);

      // Membership exists
      const mem = await testApp.db
        .select()
        .from(clubMemberships)
        .where(
          and(eq(clubMemberships.clubId, club.id), eq(clubMemberships.userId, applicant.id))
        );
      expect(mem).toHaveLength(1);
      expect(mem[0]!.role).toBe("member");

      // Player is linked to the applicant
      const linked = await testApp.db.select().from(players).where(eq(players.id, player.id));
      expect(linked[0]!.linkedUserId).toBe(applicant.id);

      // Join request is marked accepted
      const updated = await testApp.db
        .select()
        .from(clubJoinRequests)
        .where(eq(clubJoinRequests.id, joinRequestId));
      expect(updated[0]!.status).toBe("accepted");
    });

    it("accepting can create and link a new player", async () => {
      const { club, session: adminSession } = await seedAuthenticatedOwner(testApp.db);
      const applicant = await seedUser(testApp.db, { email: "new-player@example.com" });
      const { token: applicantToken } = await seedSession(testApp.db, { userId: applicant.id });

      const reqRes = await testApp.app.inject({
        method: "POST",
        url: `/clubs/${club.id}/join-requests`,
        payload: {},
        cookies: { sid: applicantToken }
      });
      expect(reqRes.statusCode).toBe(201);
      const joinRequestId = reqRes.json().joinRequest.id;

      const acceptRes = await testApp.app.inject({
        method: "PUT",
        url: `/clubs/${club.id}/join-requests/${joinRequestId}`,
        payload: { action: "accept", playerDisplayName: "New Member" },
        cookies: { sid: adminSession.token }
      });
      expect(acceptRes.statusCode).toBe(200);

      const linked = await testApp.db
        .select()
        .from(players)
        .where(and(eq(players.clubId, club.id), eq(players.linkedUserId, applicant.id)));
      expect(linked).toHaveLength(1);
      expect(linked[0]!.displayName).toBe("New Member");
    });
  });
});
