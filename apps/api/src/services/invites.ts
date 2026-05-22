import type { Db } from "@chess-club/db";
import { eq, and, desc } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { hashSessionToken } from "../lib/auth/cookies.js";
import {
  clubInvites,
  clubJoinRequests,
  clubMemberships,
  players,
  users
} from "@chess-club/db";

type CreateInviteInput = {
  email: string;
  role?: string;
  clubId: string;
  invitedByUserId: string;
};

type ListInvitesInput = {
  clubId: string;
};

type CreateJoinRequestInput = {
  clubId: string;
  userId: string;
  message?: string;
};

type ListJoinRequestsInput = {
  clubId: string;
};

type ProcessJoinRequestInput = {
  clubId: string;
  id: string;
  action: "accept" | "reject";
  playerId?: string;
  decidedByUserId: string;
};

export async function createInvite(
  db: Db,
  input: CreateInviteInput
) {
  const { email, role = "member", clubId, invitedByUserId } = input;

  // Validate role
  const validRoles = ["owner", "admin", "organizer", "member"];
  if (!validRoles.includes(role)) {
    throw new Error(`role must be one of: ${validRoles.join(", ")}`);
  }

  // Generate token
  const token = randomBytes(32).toString("base64url");
  const tokenHash = await hashSessionToken(token);

  // Calculate expiry (7 days)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Check for existing pending invite
  const existingInvite = await db
    .select({ id: clubInvites.id })
    .from(clubInvites)
    .where(
      and(
        eq(clubInvites.clubId, clubId),
        eq(clubInvites.email, email),
        eq(clubInvites.status, "pending")
      )
    );

  if (existingInvite.length > 0) {
    throw new Error("A pending invite already exists for this email");
  }

  // Create invite
  const result = await db
    .insert(clubInvites)
    .values({
      clubId,
      email,
      role: role as "owner" | "admin" | "organizer" | "member",
      invitedByUserId,
      tokenHash,
      expiresAt
    })
    .returning({
      id: clubInvites.id,
      clubId: clubInvites.clubId,
      email: clubInvites.email,
      role: clubInvites.role,
      expiresAt: clubInvites.expiresAt
    });

  return {
    invite: result[0],
    token
  };
}

export async function listInvites(
  db: Db,
  input: ListInvitesInput
) {
  const { clubId } = input;

  const result = await db
    .select({
      id: clubInvites.id,
      clubId: clubInvites.clubId,
      email: clubInvites.email,
      role: clubInvites.role,
      status: clubInvites.status,
      createdAt: clubInvites.createdAt,
      expiresAt: clubInvites.expiresAt
    })
    .from(clubInvites)
    .where(eq(clubInvites.clubId, clubId))
    .orderBy(desc(clubInvites.createdAt));

  return { invites: result };
}

export async function createJoinRequest(
  db: Db,
  input: CreateJoinRequestInput
) {
  const { clubId, userId, message } = input;

  // Check if user is already a member
  const existingMembership = await db
    .select({ role: clubMemberships.role })
    .from(clubMemberships)
    .where(
      and(
        eq(clubMemberships.clubId, clubId),
        eq(clubMemberships.userId, userId)
      )
    );

  if (existingMembership.length > 0) {
    throw new Error("You are already a member of this club");
  }

  // Check for existing pending join request
  const existingRequest = await db
    .select({ id: clubJoinRequests.id })
    .from(clubJoinRequests)
    .where(
      and(
        eq(clubJoinRequests.clubId, clubId),
        eq(clubJoinRequests.userId, userId),
        eq(clubJoinRequests.status, "pending")
      )
    );

  if (existingRequest.length > 0) {
    throw new Error("A pending join request already exists");
  }

  // Create join request
  const result = await db
    .insert(clubJoinRequests)
    .values({
      clubId,
      userId,
      message: message || null
    })
    .returning({
      id: clubJoinRequests.id,
      clubId: clubJoinRequests.clubId,
      userId: clubJoinRequests.userId,
      message: clubJoinRequests.message,
      status: clubJoinRequests.status,
      createdAt: clubJoinRequests.createdAt
    });

  return result[0]!;
}

export async function listJoinRequests(
  db: Db,
  input: ListJoinRequestsInput
) {
  const { clubId } = input;

  const result = await db
    .select({
      id: clubJoinRequests.id,
      clubId: clubJoinRequests.clubId,
      userId: clubJoinRequests.userId,
      email: users.email,
      name: users.name,
      message: clubJoinRequests.message,
      status: clubJoinRequests.status,
      createdAt: clubJoinRequests.createdAt
    })
    .from(clubJoinRequests)
    .innerJoin(users, eq(users.id, clubJoinRequests.userId))
    .where(eq(clubJoinRequests.clubId, clubId))
    .orderBy(desc(clubJoinRequests.createdAt));

  return { joinRequests: result };
}

export async function processJoinRequest(
  db: Db,
  input: ProcessJoinRequestInput
) {
  const { clubId, id, action, playerId, decidedByUserId } = input;

  if (action !== "accept" && action !== "reject") {
    throw new Error("action must be 'accept' or 'reject'");
  }

  // Get the join request
  const requestResult = await db
    .select({
      id: clubJoinRequests.id,
      userId: clubJoinRequests.userId,
      status: clubJoinRequests.status
    })
    .from(clubJoinRequests)
    .where(
      and(
        eq(clubJoinRequests.id, id),
        eq(clubJoinRequests.clubId, clubId)
      )
    );

  if (requestResult.length === 0) {
    throw new Error("Join request not found");
  }

  const joinRequest = requestResult[0]!;

  if (joinRequest.status !== "pending") {
    throw new Error("Join request has already been processed");
  }

  if (action === "reject") {
    await db
      .update(clubJoinRequests)
      .set({
        status: "rejected",
        decidedByUserId,
        decidedAt: new Date()
      })
      .where(eq(clubJoinRequests.id, id));

    return { message: "Join request rejected" };
  }

  if (action === "accept") {
    if (!playerId) {
      throw new Error("playerId is required when accepting a join request");
    }

    // Verify player belongs to this club
    const playerResult = await db
      .select({ id: players.id })
      .from(players)
      .where(
        and(
          eq(players.id, playerId),
          eq(players.clubId, clubId)
        )
      );

    if (playerResult.length === 0) {
      throw new Error("Player not found in this club");
    }

    // Check if player is already linked to another user
    const linkedPlayerResult = await db
      .select({ linkedUserId: players.linkedUserId })
      .from(players)
      .where(eq(players.id, playerId));

    const linkedUserId = linkedPlayerResult[0]!.linkedUserId;
    if (linkedUserId && linkedUserId !== joinRequest.userId) {
      throw new Error("Player is already linked to another user");
    }

    // Create membership
    await db.insert(clubMemberships).values({
      clubId,
      userId: joinRequest.userId,
      role: "member"
    });

    // Link player to user
    await db
      .update(players)
      .set({ linkedUserId: joinRequest.userId })
      .where(eq(players.id, playerId));

    // Update join request
    await db
      .update(clubJoinRequests)
      .set({
        status: "accepted",
        decidedByUserId,
        decidedAt: new Date()
      })
      .where(eq(clubJoinRequests.id, id));

    return { message: "Join request accepted" };
  }

  throw new Error("action must be 'accept' or 'reject'");
}
