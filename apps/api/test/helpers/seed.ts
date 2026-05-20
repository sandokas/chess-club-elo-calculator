import type { Db } from "@chess-club/db";
import {
  users,
  clubs,
  clubMemberships,
  sessions,
  players,
  playerRatings,
  tournaments,
  authIdentities
} from "@chess-club/db";
import { hashSessionToken, generateSessionToken } from "../../src/lib/auth/cookies.js";
import { ratingConfig } from "@chess-club/config";

let seq = 0;
function uniq(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}`;
}

export type SeededUser = {
  id: string;
  email: string;
  name: string;
};

export async function seedUser(
  db: Db,
  overrides: Partial<{ email: string; name: string; emailVerified: boolean }> = {}
): Promise<SeededUser> {
  const email = overrides.email ?? `${uniq("user")}@example.com`;
  const name = overrides.name ?? "Test User";
  const [row] = await db
    .insert(users)
    .values({ email, name, emailVerified: overrides.emailVerified ?? true })
    .returning({ id: users.id, email: users.email, name: users.name });
  return row!;
}

export type SeededClub = {
  id: string;
  name: string;
  slug: string;
};

export async function seedClub(
  db: Db,
  overrides: Partial<{ name: string; slug: string }> = {}
): Promise<SeededClub> {
  const name = overrides.name ?? "Test Club";
  const slug = overrides.slug ?? uniq("club");
  const [row] = await db
    .insert(clubs)
    .values({ name, slug })
    .returning({ id: clubs.id, name: clubs.name, slug: clubs.slug });
  return row!;
}

export type ClubRole = "owner" | "admin" | "organizer" | "member";

export async function seedMembership(
  db: Db,
  args: { userId: string; clubId: string; role: ClubRole }
): Promise<void> {
  await db.insert(clubMemberships).values(args);
}

export type SeededSession = {
  sessionId: string;
  token: string;
};

/**
 * Insert a session row for a user. Returns the plaintext token to use in a
 * cookie (the DB only stores the hash, mirroring production).
 */
export async function seedSession(
  db: Db,
  args: { userId: string; expiresAt?: Date }
): Promise<SeededSession> {
  const token = generateSessionToken();
  const tokenHash = await hashSessionToken(token);
  const expiresAt = args.expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(sessions)
    .values({ userId: args.userId, tokenHash, expiresAt })
    .returning({ id: sessions.id });
  return { sessionId: row!.id, token };
}

export async function seedAuthIdentity(
  db: Db,
  args: { userId: string; provider: "password" | "google"; providerSubject: string; email: string }
): Promise<void> {
  await db.insert(authIdentities).values(args);
}

export type SeededPlayer = {
  id: string;
  clubId: string;
  displayName: string;
};

export async function seedPlayer(
  db: Db,
  args: { clubId: string; displayName?: string; linkedUserId?: string; active?: boolean }
): Promise<SeededPlayer> {
  const displayName = args.displayName ?? uniq("player");
  const [row] = await db
    .insert(players)
    .values({
      clubId: args.clubId,
      displayName,
      linkedUserId: args.linkedUserId,
      active: args.active ?? true
    })
    .returning({ id: players.id, clubId: players.clubId, displayName: players.displayName });

  // Player ratings row is required for the leaderboard / recompute paths.
  // Default to the canonical rating config — never hardcode defaults here
  // (AGENTS.md: single source of truth for rating constants).
  await db.insert(playerRatings).values({
    playerId: row!.id,
    clubId: args.clubId,
    elo: ratingConfig.defaultElo,
    glickoRating: ratingConfig.g2DefaultRating,
    glickoRd: ratingConfig.g2DefaultRd,
    glickoVol: ratingConfig.g2DefaultVol,
    gamesPlayed: 0
  });

  return row!;
}

export type SeededTournament = {
  id: string;
  clubId: string;
  name: string;
};

export async function seedTournament(
  db: Db,
  args: {
    clubId: string;
    name?: string;
    status?: "draft" | "active" | "completed";
    format?: "manual" | "swiss";
    totalRounds?: number;
  }
): Promise<SeededTournament> {
  const name = args.name ?? uniq("tournament");
  const [row] = await db
    .insert(tournaments)
    .values({
      clubId: args.clubId,
      name,
      status: args.status ?? "draft",
      format: args.format ?? "manual",
      totalRounds: args.totalRounds
    })
    .returning({ id: tournaments.id, clubId: tournaments.clubId, name: tournaments.name });
  return row!;
}

/**
 * Convenience: seed a user + club + owner membership + session. Returns
 * everything callers typically need to make an authenticated request.
 */
export async function seedAuthenticatedOwner(
  db: Db,
  overrides: { clubName?: string; userEmail?: string } = {}
): Promise<{
  user: SeededUser;
  club: SeededClub;
  session: SeededSession;
}> {
  const user = await seedUser(db, { email: overrides.userEmail });
  const club = await seedClub(db, { name: overrides.clubName });
  await seedMembership(db, { userId: user.id, clubId: club.id, role: "owner" });
  const session = await seedSession(db, { userId: user.id });
  return { user, club, session };
}
