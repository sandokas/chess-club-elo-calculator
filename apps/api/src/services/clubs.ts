import type { Db } from "@chess-club/db";
import { clubs, clubMemberships, players, playerRatings, matches } from "@chess-club/db";
import { eq, sql, and } from "drizzle-orm";
import { recomputeRatings, type MatchInput } from "../lib/ratings/ratings.js";
import { createNotFoundError } from "../lib/errors.js";

export type ClubInput = {
  name: string;
  description?: string;
  city?: string;
  country?: string;
};

export type ClubUpdate = {
  name?: string;
  description?: string;
  city?: string;
  country?: string;
};

export function generateSlug(name: string): string {
  const trimmedName = name.trim();
  return trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export async function listClubs(db: Db, userId?: string) {
  const result = await db.select({
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
    userId 
      ? sql`${clubs.id} IN (SELECT ${clubMemberships.clubId} FROM ${clubMemberships} WHERE ${clubMemberships.userId} = ${userId})`
      : undefined
  )
  .orderBy(clubs.name);
  
  return result;
}

export async function getClubById(db: Db, clubId: string) {
  const result = await db.select({
    id: clubs.id,
    name: clubs.name,
    slug: clubs.slug,
    description: clubs.description,
    city: clubs.city,
    country: clubs.country,
    createdAt: clubs.createdAt,
    updatedAt: clubs.updatedAt
  }).from(clubs)
  .where(eq(clubs.id, clubId))
  .limit(1);

  if (result.length === 0) {
    throw createNotFoundError("Club not found");
  }

  return result[0];
}

export async function getClubBySlug(db: Db, slug: string) {
  const result = await db.select({
    id: clubs.id,
    name: clubs.name,
    slug: clubs.slug,
    description: clubs.description,
    city: clubs.city,
    country: clubs.country,
    createdAt: clubs.createdAt,
    updatedAt: clubs.updatedAt
  }).from(clubs)
  .where(eq(clubs.slug, slug))
  .limit(1);

  if (result.length === 0) {
    throw createNotFoundError("Club not found");
  }

  return result[0];
}

export async function slugExists(db: Db, slug: string): Promise<boolean> {
  const result = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.slug, slug)).limit(1);
  return result.length > 0;
}

export async function createClub(db: Db, input: ClubInput, ownerUserId?: string) {
  const { name, description, city, country } = input;
  const trimmedName = name.trim();
  const slug = generateSlug(name);

  if (slug === "") {
    throw new Error("name must contain valid characters");
  }

  if (await slugExists(db, slug)) {
    throw new Error("A club with this slug already exists");
  }

  const result = await db.insert(clubs).values({
    name: trimmedName,
    slug: slug,
    description: description?.trim() || null,
    city: city?.trim() || null,
    country: country?.trim() || null
  }).returning();

  if (!result[0]) {
    throw new Error("Failed to create club");
  }

  const club = result[0];
  
  if (ownerUserId) {
    await db.insert(clubMemberships).values({
      clubId: club.id,
      userId: ownerUserId,
      role: "owner"
    });
  }

  return club;
}

export async function updateClub(db: Db, clubId: string, input: ClubUpdate) {
  const { name, description, city, country } = input;

  const result = await db.update(clubs)
    .set({
      name: name?.trim(),
      description: description?.trim() || null,
      city: city?.trim() || null,
      country: country?.trim() || null,
      updatedAt: new Date()
    })
    .where(eq(clubs.id, clubId))
    .returning();

  if (result.length === 0) {
    throw createNotFoundError("Club not found");
  }

  return result[0];
}

export async function deleteClub(db: Db, clubId: string) {
  const clubResult = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(eq(clubs.id, clubId)).limit(1);

  if (clubResult.length === 0) {
    throw createNotFoundError("Club not found");
  }

  await db.delete(clubs).where(eq(clubs.id, clubId));
}

export async function recomputeClubRatings(db: Db, clubId: string) {
  const playersResult = await db.select({ id: players.id }).from(players).where(eq(players.clubId, clubId));

  if (playersResult.length === 0) {
    return { playersUpdated: 0 };
  }

  const playerIds = playersResult.map(row => row.id);

  const matchesResult = await db.select({
    id: matches.id,
    whitePlayerId: matches.whitePlayerId,
    blackPlayerId: matches.blackPlayerId,
    result: matches.result,
    playedOn: matches.playedOn
  }).from(matches)
  .where(and(eq(matches.clubId, clubId), sql`${matches.result} IS NOT NULL`, sql`${matches.blackPlayerId} IS NOT NULL`))
  .orderBy(matches.playedOn, matches.id);

  if (matchesResult.length === 0) {
    return { playersUpdated: 0 };
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
    await db.update(playerRatings)
      .set({
        elo: profile.elo,
        glickoRating: profile.glicko.rating,
        glickoRd: profile.glicko.rd,
        glickoVol: profile.glicko.vol,
        gamesPlayed: profile.gamesPlayed,
        lastGameDate: profile.lastGameDate,
        updatedAt: new Date()
      })
      .where(eq(playerRatings.playerId, playerId as string));
    updatedCount++;
  }

  for (const audit of audits) {
    await db.update(matches)
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
        blackGlickoRatingBefore: audit.blackGlickoBefore?.rating,
        blackGlickoRatingAfter: audit.blackGlickoAfter?.rating,
        blackGlickoRdBefore: audit.blackGlickoBefore?.rd,
        blackGlickoRdAfter: audit.blackGlickoAfter?.rd,
        blackGlickoVolBefore: audit.blackGlickoBefore?.vol,
        blackGlickoVolAfter: audit.blackGlickoAfter?.vol
      })
      .where(eq(matches.id, audit.matchId as string));
  }

  return { playersUpdated: updatedCount };
}
