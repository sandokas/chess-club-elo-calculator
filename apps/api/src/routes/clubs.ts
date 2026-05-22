import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { clubs, clubMemberships, players, playerRatings, matches } from "@chess-club/db";
import { loadEnv } from "@chess-club/config";
import { recomputeRatings, type MatchInput } from "../lib/ratings/ratings.js";
import { createClubSchema, updateClubSchema } from "../lib/schemas/club.js";
import { parseBody } from "../lib/validate.js";
import { createNotFoundError } from "../lib/errors.js";
import { requireAuth, requireClubRole, type ClubRole } from "../lib/auth/rbac.js";

const env = loadEnv();

type ClubParams = {
  clubId: string;
};

export async function registerClubsRoutes(app: FastifyInstance) {
  const REQUIRE_AUTH = env.REQUIRE_AUTH;

  const conditionalRequireAuth = REQUIRE_AUTH ? requireAuth : async () => {};
  const conditionalRequireClubRole = (roles: ClubRole[]) => REQUIRE_AUTH ? ((request: any, reply: any) => requireClubRole(request, reply, roles)) : async () => {};

  app.get("/clubs", async (request, reply) => {
    const userId = request.user?.id;

    const result = await app.db.select({
      id: clubs.id,
      name: clubs.name,
      slug: clubs.slug,
      description: clubs.description,
      city: clubs.city,
      country: clubs.country,
      createdAt: clubs.createdAt,
      updatedAt: clubs.updatedAt
    }).from(clubs)
    .where(
      env.REQUIRE_AUTH && userId 
        ? sql`${clubs.id} IN (SELECT ${clubMemberships.clubId} FROM ${clubMemberships} WHERE ${clubMemberships.userId} = ${userId})`
        : undefined
    )
    .orderBy(clubs.name);
    
    app.log.info({ msg: "GET /clubs query successful", count: result.length });
    return { clubs: result };
  });

  app.post<{ Body: { name: string; description?: string; city?: string; country?: string } }>("/clubs", { preHandler: [conditionalRequireAuth] }, async (request, reply) => {
    const body = parseBody(createClubSchema, request.body);
    const { name, description, city, country } = body;

    const trimmedName = name.trim();
    const slug = trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

    if (slug === "") {
      return reply.status(400).send({
        error: "ValidationError",
        message: "name must contain valid characters"
      });
    }

    const existingClub = await app.db.select({ id: clubs.id }).from(clubs).where(eq(clubs.slug, slug)).limit(1);

    if (existingClub.length > 0) {
      return reply.status(409).send({
        error: "ConflictError",
        message: "A club with this slug already exists"
      });
    }

    const result = await app.db.insert(clubs).values({
      name: trimmedName,
      slug: slug,
      description: description?.trim() || null,
      city: city?.trim() || null,
      country: country?.trim() || null
    }).returning();

    if (!result[0]) {
      return reply.status(500).send({
        error: "InternalError",
        message: "Failed to create club"
      });
    }

    const club = result[0];
    if (env.REQUIRE_AUTH && request.user) {
      await app.db.insert(clubMemberships).values({
        clubId: club.id,
        userId: request.user.id,
        role: "owner"
      });
    }

    return reply.status(201).send({ club });
  });

  app.patch<{ Params: ClubParams; Body: { name?: string; description?: string; city?: string; country?: string } }>("/clubs/:clubId", { preHandler: [conditionalRequireAuth, conditionalRequireClubRole(["owner", "admin", "organizer"])] }, async (request, reply) => {
    const body = parseBody(updateClubSchema, request.body);
    const { name, description, city, country } = body;

    const result = await app.db.update(clubs)
      .set({
        name: name?.trim(),
        description: description?.trim() || null,
        city: city?.trim() || null,
        country: country?.trim() || null,
        updatedAt: new Date()
      })
      .where(eq(clubs.id, request.params.clubId))
      .returning();

    if (result.length === 0) {
      throw createNotFoundError("Club not found");
    }

    return reply.status(200).send({ club: result[0] });
  });

  app.delete<{ Params: ClubParams }>("/clubs/:clubId", { preHandler: [conditionalRequireAuth, conditionalRequireClubRole(["owner"])] }, async (request, reply) => {
    const clubResult = await app.db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(eq(clubs.id, request.params.clubId)).limit(1);

    if (clubResult.length === 0) {
      throw createNotFoundError("Club not found");
    }

    await app.db.delete(clubs).where(eq(clubs.id, request.params.clubId));

    return reply.status(204).send();
  });

  app.post<{ Params: ClubParams }>("/clubs/:clubId/ratings/recompute", { preHandler: [conditionalRequireAuth, conditionalRequireClubRole(["owner", "admin"])] }, async (request, reply) => {
    const playersResult = await app.db.select({ id: players.id }).from(players).where(eq(players.clubId, request.params.clubId));

    if (playersResult.length === 0) {
      return reply.status(200).send({
        message: "No players found in club",
        playersUpdated: 0
      });
    }

    const playerIds = playersResult.map(row => row.id);

    const matchesResult = await app.db.select({
      id: matches.id,
      whitePlayerId: matches.whitePlayerId,
      blackPlayerId: matches.blackPlayerId,
      result: matches.result,
      playedOn: matches.playedOn
    }).from(matches)
    .where(eq(matches.clubId, request.params.clubId), sql`${matches.result} IS NOT NULL`, sql`${matches.blackPlayerId} IS NOT NULL`)
    .orderBy(matches.playedOn, matches.id);

    if (matchesResult.length === 0) {
      return reply.status(200).send({
        message: "No completed matches found in club",
        playersUpdated: 0
      });
    }

    const matchesInput: MatchInput[] = matchesResult.map(row => ({
      id: row.id,
      whitePlayerId: row.whitePlayerId,
      blackPlayerId: row.blackPlayerId,
      result: row.result,
      date: row.playedOn
    }));

    const { profiles, audits } = recomputeRatings(playerIds, matchesInput);

    let updatedCount = 0;
    for (const [playerId, profile] of profiles.entries()) {
      await app.db.update(playerRatings)
        .set({
          elo: profile.elo,
          glickoRating: profile.glicko.rating,
          glickoRd: profile.glicko.rd,
          glickoVol: profile.glicko.vol,
          gamesPlayed: profile.gamesPlayed,
          lastGameDate: profile.lastGameDate,
          updatedAt: new Date()
        })
        .where(eq(playerRatings.playerId, playerId));
      updatedCount++;
    }

    for (const audit of audits) {
      await app.db.update(matches)
        .set({
          whiteEloBefore: audit.whiteEloBefore,
          whiteEloAfter: audit.whiteEloAfter,
          blackEloBefore: audit.blackEloBefore,
          blackEloAfter: audit.blackEloAfter,
          whiteGlickoRatingBefore: audit.whiteGlickoBefore.rating,
          whiteGlickoRatingAfter: audit.whiteGlickoAfter.rating,
          whiteGlickoRdBefore: audit.whiteGlickoBefore.rd,
          whiteGlickoRdAfter: audit.whiteGlickoAfter.rd,
          whiteGlickoVolBefore: audit.whiteGlickoBefore.vol,
          whiteGlickoVolAfter: audit.whiteGlickoAfter.vol,
          blackGlickoRatingBefore: audit.blackGlickoBefore.rating,
          blackGlickoRatingAfter: audit.blackGlickoAfter.rating,
          blackGlickoRdBefore: audit.blackGlickoBefore.rd,
          blackGlickoRdAfter: audit.blackGlickoAfter.rd,
          blackGlickoVolBefore: audit.blackGlickoBefore.vol,
          blackGlickoVolAfter: audit.blackGlickoAfter.vol
        })
        .where(eq(matches.id, audit.matchId));
    }

    return reply.status(200).send({
      message: "Ratings recomputed successfully",
      playersUpdated: updatedCount
    });
  });
}
