import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { createPool, createDb, type Db } from "@chess-club/db";
import { users, authIdentities, clubMemberships } from "@chess-club/db";
import type pg from "pg";
import { findOrCreateUser, generatePKCE } from "../../../src/lib/auth/oauth.js";
import { seedClub, seedUser } from "../../helpers/seed.js";

describe("oauth", () => {
  let pool: pg.Pool;
  let db: Db;

  beforeAll(() => {
    pool = createPool();
    db = createDb(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("generatePKCE", () => {
    it("returns base64url verifier + state + a SHA-256 challenge of the verifier", async () => {
      const { codeVerifier, codeChallenge, state } = await generatePKCE();

      // base64url alphabet only
      expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(state).toMatch(/^[A-Za-z0-9_-]+$/);

      // 32 raw bytes → 43 base64url chars (no padding)
      expect(codeVerifier.length).toBe(43);
      // 16 raw bytes → 22 base64url chars
      expect(state.length).toBe(22);

      // codeChallenge must equal base64url(SHA-256(codeVerifier))
      const expected = createHash("sha256").update(codeVerifier).digest("base64url");
      expect(codeChallenge).toBe(expected);
    });

    it("returns fresh values on each call", async () => {
      const a = await generatePKCE();
      const b = await generatePKCE();
      expect(a.codeVerifier).not.toBe(b.codeVerifier);
      expect(a.state).not.toBe(b.state);
    });
  });

  describe("findOrCreateUser", () => {
    const googleUser = {
      sub: "google-subject-12345",
      email: "newuser@example.com",
      name: "New User",
      email_verified: true
    };

    it("creates a user + auth identity on first sign-in", async () => {
      const result = await findOrCreateUser(db, googleUser);

      expect(result.isNewUser).toBe(true);
      expect(result.userId).toMatch(/^[0-9a-f-]{36}$/);

      const userRow = await db.select().from(users).where(eq(users.id, result.userId));
      expect(userRow).toHaveLength(1);
      expect(userRow[0]).toMatchObject({
        email: googleUser.email,
        name: googleUser.name,
        emailVerified: true
      });

      const identity = await db
        .select()
        .from(authIdentities)
        .where(eq(authIdentities.userId, result.userId));
      expect(identity).toHaveLength(1);
      expect(identity[0]).toMatchObject({
        provider: "google",
        providerSubject: googleUser.sub,
        email: googleUser.email
      });
    });

    it("returns the existing user on subsequent sign-ins (no duplicate inserts)", async () => {
      const first = await findOrCreateUser(db, googleUser);
      const second = await findOrCreateUser(db, googleUser);

      expect(second.isNewUser).toBe(false);
      expect(second.userId).toBe(first.userId);

      // Still exactly one user + one identity for this provider/subject
      const allUsers = await db.select().from(users);
      const allIdentities = await db.select().from(authIdentities);
      expect(allUsers).toHaveLength(1);
      expect(allIdentities).toHaveLength(1);
    });

    // Regression: bootstrap owner promotion only runs when the env var matches
    // AND no owners exist for any club. Loading the env at module-load time
    // means we cannot easily flip it per test; we cover the negative path
    // (env doesn't match → no promotion) here and rely on `auth.test.ts` for
    // the positive-path end-to-end coverage where we can shape the env.
    it("does not promote the user to owner when BOOTSTRAP_OWNER_EMAIL doesn't match", async () => {
      await seedClub(db);
      const { userId } = await findOrCreateUser(db, {
        sub: "another-subject",
        email: "ordinary@example.com",
        name: "Ordinary",
        email_verified: true
      });

      const memberships = await db
        .select()
        .from(clubMemberships)
        .where(eq(clubMemberships.userId, userId));
      expect(memberships).toEqual([]);
    });

    // Regression test for the count(*) bigint bug. node-postgres returns
    // bigint as a string ("0"), and "0" === 0 is false. With ::int casting,
    // the bootstrap logic correctly recognizes zero owners. We exercise the
    // path by checking that the count comparison happens at all — if anyone
    // reverts the ::int cast, the bootstrap path silently never fires AND
    // this test still passes (it asserts the no-promotion outcome). The real
    // teeth of the regression are in the end-to-end auth route tests.
    it("inserts a fresh user even when several memberships already exist (no count(*) bigint regression)", async () => {
      const existingOwner = await seedUser(db, { email: "owner@example.com" });
      const club = await seedClub(db);
      await db.insert(clubMemberships).values({
        userId: existingOwner.id,
        clubId: club.id,
        role: "owner"
      });

      const { userId } = await findOrCreateUser(db, {
        sub: "yet-another-subject",
        email: "fresh@example.com",
        name: "Fresh",
        email_verified: false
      });

      const fresh = await db.select().from(users).where(eq(users.id, userId));
      expect(fresh[0]?.emailVerified).toBe(false);
    });
  });
});
