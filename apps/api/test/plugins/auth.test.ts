import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import authPlugin from "../../src/plugins/auth.js";
import type { Db } from "@chess-club/db";

describe("auth plugin", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    await app.register(authPlugin);
  });

  afterEach(async () => {
    await app.close();
  });

  it("decorates app with auth object", async () => {
    expect(app.auth).toBeDefined();
    expect(typeof app.auth.requireAuth).toBe("function");
    expect(typeof app.auth.requireClubRole).toBe("function");
    expect(typeof app.auth.requireTournamentClubRole).toBe("function");
    expect(typeof app.auth.requirePlayerClubRole).toBe("function");
    expect(typeof app.auth.requireMatchClubRole).toBe("function");
    expect(typeof app.auth.requireRoundClubRole).toBe("function");
  });

  it("requireAuth is a function that can be called", async () => {
    const mockRequest = { user: { id: "user-1" } } as any;
    const mockReply = {} as any;
    
    // Should not throw when called
    await expect(app.auth.requireAuth(mockRequest, mockReply)).resolves.not.toThrow();
  });

  it("requireClubRole returns a function", () => {
    const handler = app.auth.requireClubRole("admin");
    expect(typeof handler).toBe("function");
  });

  it("requireTournamentClubRole returns a function", () => {
    const handler = app.auth.requireTournamentClubRole("admin");
    expect(typeof handler).toBe("function");
  });

  it("requirePlayerClubRole returns a function", () => {
    const handler = app.auth.requirePlayerClubRole("admin");
    expect(typeof handler).toBe("function");
  });

  it("requireMatchClubRole returns a function", () => {
    const handler = app.auth.requireMatchClubRole("admin");
    expect(typeof handler).toBe("function");
  });

  it("requireRoundClubRole returns a function", () => {
    const handler = app.auth.requireRoundClubRole("admin");
    expect(typeof handler).toBe("function");
  });
});
