import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { sessions, users } from "@chess-club/db";
import { hashSessionToken } from "../../src/lib/auth/cookies.js";
import { createTestApp, type TestApp } from "../helpers/app.js";
import { seedAuthenticatedOwner } from "../helpers/seed.js";

// ---------------------------------------------------------------------------
// Mock `google-auth-library` at the module boundary.
//
// This is the one and only allowed third-party SDK mock (see TESTING.md). We
// don't own the network call to Google's token/userinfo endpoints — mocking
// it lets us exercise the cookie + session + redirect logic for real against
// a real Postgres test DB, while never hitting the public internet.
//
// `vi.mock` is hoisted above all imports. The mock factory closes over
// references that must exist BEFORE the mocked module is imported by other
// modules. `vi.hoisted` co-hoists these refs so they're alive at the moment
// `oauth.ts` does `new OAuth2Client(...)` at module-load time.
// ---------------------------------------------------------------------------
const { mockGetToken, mockVerifyIdToken, mockGenerateAuthUrl } = vi.hoisted(() => ({
  mockGetToken: vi.fn(),
  mockVerifyIdToken: vi.fn(),
  mockGenerateAuthUrl: vi.fn()
}));

vi.mock("google-auth-library", () => {
  class MockOAuth2Client {
    getToken = mockGetToken;
    verifyIdToken = mockVerifyIdToken;
    generateAuthUrl = mockGenerateAuthUrl;
  }
  return { OAuth2Client: MockOAuth2Client };
});

describe("auth routes", () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(() => {
    mockGetToken.mockReset();
    mockVerifyIdToken.mockReset();
    mockGenerateAuthUrl.mockReset();
    mockGenerateAuthUrl.mockReturnValue("https://accounts.google.com/o/oauth2/auth?fake=1");
  });

  describe("GET /auth/google/start", () => {
    it("sets oauth_state + oauth_code_verifier cookies and redirects to Google", async () => {
      const res = await testApp.app.inject({ method: "GET", url: "/auth/google/start" });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("https://accounts.google.com/o/oauth2/auth?fake=1");

      const setCookieHeader = res.headers["set-cookie"];
      const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader ?? ""];
      const joined = cookies.join("\n");
      expect(joined).toMatch(/oauth_state=/);
      expect(joined).toMatch(/oauth_code_verifier=/);
      expect(joined).toMatch(/HttpOnly/i);
    });
  });

  describe("GET /auth/google/callback", () => {
    it("redirects to ?error=missing_params when code or state is absent", async () => {
      const res = await testApp.app.inject({
        method: "GET",
        url: "/auth/google/callback"
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toMatch(/\/login\?error=missing_params$/);
    });

    it("redirects to ?error=invalid_state when state cookie doesn't match", async () => {
      const res = await testApp.app.inject({
        method: "GET",
        url: "/auth/google/callback?code=abc&state=incoming-state",
        cookies: { oauth_state: "different-state", oauth_code_verifier: "v" }
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toMatch(/\/login\?error=invalid_state$/);
    });

    it("creates a session, sets the sid cookie, and redirects to /welcome for a new user", async () => {
      mockGetToken.mockResolvedValue({ tokens: { id_token: "fake-id-token" } });
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: "google-sub-new-user",
          email: "newbie@example.com",
          name: "Newbie",
          email_verified: true
        })
      });

      const res = await testApp.app.inject({
        method: "GET",
        url: "/auth/google/callback?code=abc&state=s",
        cookies: { oauth_state: "s", oauth_code_verifier: "v" }
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toMatch(/\/welcome$/);

      // sid cookie was set
      const setCookieHeader = res.headers["set-cookie"];
      const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader ?? ""];
      const sidCookie = cookies.find((c) => c.startsWith("sid="));
      expect(sidCookie).toBeDefined();

      // The corresponding session row exists for the created user
      const userRows = await testApp.db
        .select()
        .from(users)
        .where(eq(users.email, "newbie@example.com"));
      expect(userRows).toHaveLength(1);
      const sessionRows = await testApp.db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, userRows[0]!.id));
      expect(sessionRows).toHaveLength(1);
    });

    it("redirects to base URL (not /welcome) for an existing user", async () => {
      // First sign-in creates the user
      mockGetToken.mockResolvedValue({ tokens: { id_token: "fake-id-token" } });
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: "google-sub-returning",
          email: "returning@example.com",
          name: "Returning",
          email_verified: true
        })
      });

      await testApp.app.inject({
        method: "GET",
        url: "/auth/google/callback?code=abc&state=s",
        cookies: { oauth_state: "s", oauth_code_verifier: "v" }
      });

      // Second sign-in
      const res = await testApp.app.inject({
        method: "GET",
        url: "/auth/google/callback?code=abc&state=s",
        cookies: { oauth_state: "s", oauth_code_verifier: "v" }
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).not.toMatch(/\/welcome$/);
    });

    it("redirects to ?error=oauth_failed when token exchange throws", async () => {
      mockGetToken.mockRejectedValue(new Error("upstream Google outage"));

      const res = await testApp.app.inject({
        method: "GET",
        url: "/auth/google/callback?code=abc&state=s",
        cookies: { oauth_state: "s", oauth_code_verifier: "v" }
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toMatch(/\/login\?error=oauth_failed$/);
    });
  });

  describe("POST /auth/logout", () => {
    it("clears the sid cookie and deletes the session row", async () => {
      const { user, session } = await seedAuthenticatedOwner(testApp.db);

      const res = await testApp.app.inject({
        method: "POST",
        url: "/auth/logout",
        cookies: { sid: session.token }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ message: "Logged out successfully" });

      // Session row was deleted
      const tokenHash = await hashSessionToken(session.token);
      const remaining = await testApp.db
        .select()
        .from(sessions)
        .where(eq(sessions.tokenHash, tokenHash));
      expect(remaining).toHaveLength(0);

      // User still exists (we only revoke sessions)
      const stillThere = await testApp.db.select().from(users).where(eq(users.id, user.id));
      expect(stillThere).toHaveLength(1);
    });

    it("succeeds with no cookie (idempotent)", async () => {
      const res = await testApp.app.inject({ method: "POST", url: "/auth/logout" });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("GET /auth/me", () => {
    it("returns 401 when no session cookie is present", async () => {
      const res = await testApp.app.inject({ method: "GET", url: "/auth/me" });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Unauthorized", message: "Not authenticated" });
    });

    it("returns 401 and clears the cookie when the session is invalid/unknown", async () => {
      const res = await testApp.app.inject({
        method: "GET",
        url: "/auth/me",
        cookies: { sid: "not-a-real-session-token" }
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Unauthorized", message: "Invalid session" });
    });

    it("returns the user payload + extends session expiry on a valid session", async () => {
      const { user, club, session } = await seedAuthenticatedOwner(testApp.db);

      // Squash the session's expiry back to ~1 day so we can detect the bump.
      const tokenHash = await hashSessionToken(session.token);
      const originalExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await testApp.db
        .update(sessions)
        .set({ expiresAt: originalExpiry })
        .where(eq(sessions.tokenHash, tokenHash));

      const res = await testApp.app.inject({
        method: "GET",
        url: "/auth/me",
        cookies: { sid: session.token }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.user.id).toBe(user.id);
      expect(body.user.email).toBe(user.email);
      expect(body.user.memberships).toHaveLength(1);
      expect(body.user.memberships[0]).toMatchObject({ clubId: club.id, role: "owner" });

      // Expiry was extended forward
      const refreshed = await testApp.db
        .select({ expiresAt: sessions.expiresAt })
        .from(sessions)
        .where(eq(sessions.tokenHash, tokenHash));
      expect(refreshed[0]!.expiresAt.getTime()).toBeGreaterThan(originalExpiry.getTime());
    });
  });
});
