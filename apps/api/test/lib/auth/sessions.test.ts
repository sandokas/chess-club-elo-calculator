import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { sessions, type Db } from "@chess-club/db";
import { createPool, createDb } from "@chess-club/db";
import type pg from "pg";
import {
  createSession,
  loadSession,
  revokeSession,
  revokeAllUserSessions,
  touchSession
} from "../../../src/lib/auth/sessions.js";
import { clubRoles } from "../../../src/lib/auth/rbac.js";
import { hashSessionToken } from "../../../src/lib/auth/cookies.js";
import { seedClub, seedMembership, seedUser } from "../../helpers/seed.js";

describe("sessions", () => {
  let pool: pg.Pool;
  let db: Db;

  beforeAll(() => {
    pool = createPool();
    db = createDb(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("createSession", () => {
    it("inserts a session row with a hashed token and a 30-day expiry", async () => {
      const user = await seedUser(db);
      const before = Date.now();

      const { token, expiresAt } = await createSession(db, user.id);

      expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
      expect(expiresAt.getTime()).toBeGreaterThan(before + 29 * 24 * 60 * 60 * 1000);
      expect(expiresAt.getTime()).toBeLessThan(before + 31 * 24 * 60 * 60 * 1000);

      // Token is stored as a hash, not plaintext
      const tokenHash = await hashSessionToken(token);
      const rows = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.userId).toBe(user.id);
    });
  });

  describe("loadSession", () => {
    it("returns user data + memberships joined for a valid token", async () => {
      const user = await seedUser(db, { email: "owner@example.com", name: "Owner" });
      const club = await seedClub(db, { name: "Sample Club" });
      await seedMembership(db, { userId: user.id, clubId: club.id, role: "owner" });
      const { token } = await createSession(db, user.id);

      const session = await loadSession(db, token);

      expect(session).not.toBeNull();
      expect(session!.id).toBe(user.id);
      expect(session!.email).toBe("owner@example.com");
      expect(session!.name).toBe("Owner");
      expect(session!.memberships).toEqual([
        { clubId: club.id, clubName: "Sample Club", role: "owner" }
      ]);
      expect(session!.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("returns an empty memberships array for a user with no clubs", async () => {
      const user = await seedUser(db);
      const { token } = await createSession(db, user.id);

      const session = await loadSession(db, token);

      expect(session).not.toBeNull();
      expect(session!.memberships).toEqual([]);
    });

    it("returns null for an unknown token", async () => {
      const session = await loadSession(db, "totally-not-a-real-token");
      expect(session).toBeNull();
    });

    it("returns null when the session is expired", async () => {
      const user = await seedUser(db);
      // Manually insert an already-expired session so we don't have to wait
      const expiredToken = "expired-token";
      const tokenHash = await hashSessionToken(expiredToken);
      await db.insert(sessions).values({
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() - 60_000)
      });

      const session = await loadSession(db, expiredToken);
      expect(session).toBeNull();
    });

    // Regression: role came back as a generic string before we removed the cast.
    // This ensures membership.role is the enum literal type at runtime.
    it("returns enum-typed roles, not generic strings", async () => {
      const user = await seedUser(db);
      const club = await seedClub(db);
      await seedMembership(db, { userId: user.id, clubId: club.id, role: "admin" });
      const { token } = await createSession(db, user.id);

      const session = await loadSession(db, token);
      expect(clubRoles).toContain(session!.memberships[0]!.role);
    });
  });

  describe("revokeSession", () => {
    it("removes the matching session row", async () => {
      const user = await seedUser(db);
      const { token } = await createSession(db, user.id);

      await revokeSession(db, token);

      const session = await loadSession(db, token);
      expect(session).toBeNull();
    });

    it("is a no-op for an unknown token", async () => {
      // Should not throw, even with no rows to delete.
      await expect(revokeSession(db, "no-such-token")).resolves.toBeUndefined();
    });
  });

  describe("revokeAllUserSessions", () => {
    it("removes every session for the user and leaves other users untouched", async () => {
      const alice = await seedUser(db, { email: "alice@example.com" });
      const bob = await seedUser(db, { email: "bob@example.com" });

      const a1 = await createSession(db, alice.id);
      const a2 = await createSession(db, alice.id);
      const b1 = await createSession(db, bob.id);

      await revokeAllUserSessions(db, alice.id);

      expect(await loadSession(db, a1.token)).toBeNull();
      expect(await loadSession(db, a2.token)).toBeNull();
      expect(await loadSession(db, b1.token)).not.toBeNull();
    });
  });

  describe("touchSession", () => {
    it("extends the session's expiry forward", async () => {
      const user = await seedUser(db);
      const { token } = await createSession(db, user.id);

      // Move the session's expiry back so we can detect the bump
      const tokenHash = await hashSessionToken(token);
      const original = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day from now
      await db.update(sessions).set({ expiresAt: original }).where(eq(sessions.tokenHash, tokenHash));

      const session = await loadSession(db, token);
      await touchSession(db, session!.sessionId);

      const refreshed = await loadSession(db, token);
      expect(refreshed!.expiresAt.getTime()).toBeGreaterThan(original.getTime());
    });
  });
});
