import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, createDb, type Db } from "@chess-club/db";
import type pg from "pg";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import dbPlugin from "../../../src/plugins/db.js";
import {
  attachUser,
  clubRoleRank,
  getMembership,
  hasClubRoleAtLeast,
  requireAuth,
  requireClubRole,
  requireTournamentClubRole,
  requirePlayerClubRole,
  resolveClubIdFromPlayer,
  resolveClubIdFromTournament
} from "../../../src/lib/auth/rbac.js";
import {
  seedAuthenticatedOwner,
  seedClub,
  seedMembership,
  seedPlayer,
  seedSession,
  seedTournament,
  seedUser
} from "../../helpers/seed.js";

describe("rbac", () => {
  let pool: pg.Pool;
  let db: Db;

  beforeAll(() => {
    pool = createPool();
    db = createDb(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("getMembership", () => {
    it("returns the role for an existing membership", async () => {
      const user = await seedUser(db);
      const club = await seedClub(db);
      await seedMembership(db, { userId: user.id, clubId: club.id, role: "admin" });

      expect(await getMembership(db, user.id, club.id)).toBe("admin");
    });

    it("returns null when the user is not a member of the club", async () => {
      const user = await seedUser(db);
      const club = await seedClub(db);

      expect(await getMembership(db, user.id, club.id)).toBeNull();
    });
  });

  describe("role hierarchy", () => {
    it("orders roles from member through owner", () => {
      expect(clubRoleRank).toEqual({
        member: 0,
        organizer: 1,
        admin: 2,
        owner: 3
      });
    });

    it("treats roles cumulatively", () => {
      expect(hasClubRoleAtLeast("organizer", "member")).toBe(true);
      expect(hasClubRoleAtLeast("admin", "organizer")).toBe(true);
      expect(hasClubRoleAtLeast("member", "organizer")).toBe(false);
      expect(hasClubRoleAtLeast("admin", "owner")).toBe(false);
    });
  });

  describe("resolveClubIdFromTournament", () => {
    it("returns the club id for an existing tournament", async () => {
      const club = await seedClub(db);
      const t = await seedTournament(db, { clubId: club.id });

      expect(await resolveClubIdFromTournament(db, t.id)).toBe(club.id);
    });

    it("returns null for an unknown tournament id", async () => {
      expect(
        await resolveClubIdFromTournament(db, "00000000-0000-0000-0000-000000000000")
      ).toBeNull();
    });
  });

  describe("resolveClubIdFromPlayer", () => {
    it("returns the club id for an existing player", async () => {
      const club = await seedClub(db);
      const player = await seedPlayer(db, { clubId: club.id });

      expect(await resolveClubIdFromPlayer(db, player.id)).toBe(club.id);
    });

    it("returns null for an unknown player id", async () => {
      expect(
        await resolveClubIdFromPlayer(db, "00000000-0000-0000-0000-000000000000")
      ).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Guard tests — these need a Fastify request/reply context. We build a
  // minimal app per test that exposes a tiny route invoking the guard, then
  // use `app.inject` to drive the HTTP semantics (cookies, params, statuses).
  // -------------------------------------------------------------------------

  /**
   * Build a minimal Fastify app with the dbPlugin + cookie + attachUser hook.
   * The dbPlugin creates its OWN pool (we do not pass `pool`/`db` here) so
   * that `app.close()` ends only the app's internal pool — leaving the
   * file-level seeding pool untouched. Both pools point at the same test DB,
   * so seeded rows are visible to the app's queries.
   */
  async function buildGuardApp(): Promise<FastifyInstance> {
    const app = Fastify();
    await app.register(cookie);
    await app.register(dbPlugin);
    app.addHook("preHandler", attachUser);
    return app;
  }

  describe("requireAuth", () => {
    async function setupRoute(): Promise<FastifyInstance> {
      const app = await buildGuardApp();
      app.get("/protected", { preHandler: [requireAuth] }, async () => ({ ok: true }));
      await app.ready();
      return app;
    }

    it("returns 401 when there is no session cookie", async () => {
      const app = await setupRoute();
      const res = await app.inject({ method: "GET", url: "/protected" });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Unauthorized", message: "Authentication required" });
      await app.close();
    });

    it("passes through when a valid session cookie is present", async () => {
      const { session } = await seedAuthenticatedOwner(db);
      const app = await setupRoute();
      const res = await app.inject({
        method: "GET",
        url: "/protected",
        cookies: { sid: session.token }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      await app.close();
    });
  });

  describe("requireClubRole", () => {
    async function setupRoute(role: "owner" | "admin" | "organizer" | "member") {
      const app = await buildGuardApp();
      app.get<{ Params: { clubId: string } }>(
        "/clubs/:clubId/protected",
        { preHandler: [(req, reply) => requireClubRole(req, reply, role)] },
        async () => ({ ok: true })
      );
      await app.ready();
      return app;
    }

    it("returns 401 when unauthenticated", async () => {
      const app = await setupRoute("owner");
      const res = await app.inject({ method: "GET", url: "/clubs/any/protected" });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("returns 403 when the user is not a member of the club", async () => {
      const user = await seedUser(db);
      const club = await seedClub(db);
      // Note: no membership seeded
      const { token } = await seedSession(db, { userId: user.id });
      const app = await setupRoute("owner");

      const res = await app.inject({
        method: "GET",
        url: `/clubs/${club.id}/protected`,
        cookies: { sid: token }
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toMatch(/not a member/i);
      await app.close();
    });

    it("returns 403 when the user's role is below the required role", async () => {
      const user = await seedUser(db);
      const club = await seedClub(db);
      await seedMembership(db, { userId: user.id, clubId: club.id, role: "member" });
      const { token } = await seedSession(db, { userId: user.id });
      const app = await setupRoute("admin");

      const res = await app.inject({
        method: "GET",
        url: `/clubs/${club.id}/protected`,
        cookies: { sid: token }
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toMatch(/required role/i);
      await app.close();
    });

    it("passes through when the user has the required role", async () => {
      const { club, session } = await seedAuthenticatedOwner(db);
      const app = await setupRoute("admin");

      const res = await app.inject({
        method: "GET",
        url: `/clubs/${club.id}/protected`,
        cookies: { sid: session.token }
      });
      expect(res.statusCode).toBe(200);
      await app.close();
    });
  });

  describe("requireTournamentClubRole", () => {
    async function setupRoute(role: "owner" | "admin" | "organizer" | "member") {
      const app = await buildGuardApp();
      app.get<{ Params: { id: string } }>(
        "/tournaments/:id/protected",
        { preHandler: [(req, reply) => requireTournamentClubRole(req, reply, role)] },
        async () => ({ ok: true })
      );
      await app.ready();
      return app;
    }

    it("returns 404 when the tournament does not exist", async () => {
      const { session } = await seedAuthenticatedOwner(db);
      const app = await setupRoute("owner");

      const res = await app.inject({
        method: "GET",
        url: "/tournaments/00000000-0000-0000-0000-000000000000/protected",
        cookies: { sid: session.token }
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().message).toMatch(/tournament not found/i);
      await app.close();
    });

    it("returns 403 when the user is not a member of the tournament's club", async () => {
      const stranger = await seedUser(db);
      const club = await seedClub(db);
      const t = await seedTournament(db, { clubId: club.id });
      const { token } = await seedSession(db, { userId: stranger.id });
      const app = await setupRoute("owner");

      const res = await app.inject({
        method: "GET",
        url: `/tournaments/${t.id}/protected`,
        cookies: { sid: token }
      });
      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it("passes through for a club member with an allowed role", async () => {
      const { club, session } = await seedAuthenticatedOwner(db);
      const t = await seedTournament(db, { clubId: club.id });
      const app = await setupRoute("admin");

      const res = await app.inject({
        method: "GET",
        url: `/tournaments/${t.id}/protected`,
        cookies: { sid: session.token }
      });
      expect(res.statusCode).toBe(200);
      await app.close();
    });
  });

  describe("requirePlayerClubRole", () => {
    async function setupRoute(role: "owner" | "admin" | "organizer" | "member") {
      const app = await buildGuardApp();
      app.get<{ Params: { id: string } }>(
        "/players/:id/protected",
        { preHandler: [(req, reply) => requirePlayerClubRole(req, reply, role)] },
        async () => ({ ok: true })
      );
      await app.ready();
      return app;
    }

    it("returns 404 when the player does not exist", async () => {
      const { session } = await seedAuthenticatedOwner(db);
      const app = await setupRoute("owner");

      const res = await app.inject({
        method: "GET",
        url: "/players/00000000-0000-0000-0000-000000000000/protected",
        cookies: { sid: session.token }
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().message).toMatch(/player not found/i);
      await app.close();
    });

    it("returns 403 when the user is not a member of the player's club", async () => {
      const stranger = await seedUser(db);
      const club = await seedClub(db);
      const player = await seedPlayer(db, { clubId: club.id });
      const { token } = await seedSession(db, { userId: stranger.id });
      const app = await setupRoute("owner");

      const res = await app.inject({
        method: "GET",
        url: `/players/${player.id}/protected`,
        cookies: { sid: token }
      });
      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it("passes through for a club member with an allowed role", async () => {
      const { club, session } = await seedAuthenticatedOwner(db);
      const player = await seedPlayer(db, { clubId: club.id });
      const app = await setupRoute("admin");

      const res = await app.inject({
        method: "GET",
        url: `/players/${player.id}/protected`,
        cookies: { sid: session.token }
      });
      expect(res.statusCode).toBe(200);
      await app.close();
    });
  });

  describe("attachUser", () => {
    it("sets request.user to null when no cookie is present", async () => {
      const app = await buildGuardApp();
      app.get("/whoami", async (req) => ({ user: req.user }));
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/whoami" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ user: null });
      await app.close();
    });

    it("populates request.user from a valid session cookie", async () => {
      const { user, session } = await seedAuthenticatedOwner(db);
      const app = await buildGuardApp();
      app.get("/whoami", async (req) => ({ id: req.user?.id, email: req.user?.email }));
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: "/whoami",
        cookies: { sid: session.token }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ id: user.id, email: user.email });
      await app.close();
    });
  });
});
