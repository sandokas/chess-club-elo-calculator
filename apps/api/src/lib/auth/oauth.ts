import type { Db } from "@chess-club/db";
import { users, authIdentities, clubMemberships } from "@chess-club/db";
import { eq, and, sql } from "drizzle-orm";
import { OAuth2Client } from "google-auth-library";
import { loadEnv } from "@chess-club/config";
import { randomBytes } from "node:crypto";

const env = loadEnv();

const oauth2Client = new OAuth2Client(
  env.GOOGLE_OAUTH_CLIENT_ID,
  env.GOOGLE_OAUTH_CLIENT_SECRET,
  env.OAUTH_REDIRECT_URL
);

export type GoogleUserInfo = {
  sub: string; // Google user ID
  email: string;
  name: string;
  picture?: string;
  email_verified: boolean;
};

/**
 * Generate PKCE code verifier and challenge
 */
export async function generatePKCE(): Promise<{ codeVerifier: string; codeChallenge: string; state: string }> {
  const codeVerifier = randomBytes(32).toString("base64url");
  const state = randomBytes(16).toString("base64url");

  // SHA-256 hash of code verifier, then base64url-encoded
  const hash = await crypto.subtle.digest("SHA-256", Buffer.from(codeVerifier, "utf-8"));
  const codeChallenge = Buffer.from(hash).toString("base64url");

  return { codeVerifier, codeChallenge, state };
}

/**
 * Generate Google OAuth authorization URL with PKCE
 */
export function getGoogleAuthUrl(state: string, codeChallenge: string): string {
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["openid", "email", "profile"],
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "consent"
  });
}

/**
 * Exchange authorization code for tokens and verify ID token
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<GoogleUserInfo> {
  const { tokens } = await oauth2Client.getToken({
    code,
    codeVerifier: codeVerifier
  });

  if (!tokens.id_token) {
    throw new Error("No ID token in response");
  }

  const ticket = await oauth2Client.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.GOOGLE_OAUTH_CLIENT_ID
  });

  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error("Invalid ID token payload");
  }

  return {
    sub: payload.sub,
    email: payload.email!,
    name: payload.name!,
    picture: payload.picture,
    email_verified: payload.email_verified || false
  };
}

/**
 * Find or create user from Google OAuth info.
 * User + auth-identity creation is wrapped in a transaction so we never leave
 * an orphan user row if the identity insert fails.
 */
export async function findOrCreateUser(db: Db, googleUser: GoogleUserInfo): Promise<{ userId: string; isNewUser: boolean }> {
  // Check if auth identity exists (provider+subject is unique)
  const [existing] = await db
    .select({ userId: authIdentities.userId })
    .from(authIdentities)
    .where(and(eq(authIdentities.provider, "google"), eq(authIdentities.providerSubject, googleUser.sub)))
    .limit(1);

  if (existing) {
    return { userId: existing.userId, isNewUser: false };
  }

  const userId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(users)
      .values({
        email: googleUser.email,
        name: googleUser.name,
        emailVerified: googleUser.email_verified
      })
      .returning({ id: users.id });

    const newUserId = created!.id;

    await tx.insert(authIdentities).values({
      userId: newUserId,
      provider: "google",
      providerSubject: googleUser.sub,
      email: googleUser.email
    });

    return newUserId;
  });

  // Bootstrap owner promotion (idempotent; runs outside the user-creation tx)
  if (env.BOOTSTRAP_OWNER_EMAIL && env.BOOTSTRAP_OWNER_EMAIL.toLowerCase() === googleUser.email.toLowerCase()) {
    await promoteToOwnerOfAllClubs(userId, db);
  }

  return { userId, isNewUser: true };
}

/**
 * Promote a user to owner of all existing clubs (bootstrap)
 */
async function promoteToOwnerOfAllClubs(userId: string, db: Db): Promise<void> {
  // Check if any owner exists for any club.
  // NOTE: count(*) is bigint in pg → returned as a string by node-postgres,
  // so we cast to int in SQL to get a real number back.
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(clubMemberships)
    .where(eq(clubMemberships.role, "owner"));

  const ownerCount = row?.count ?? 0;

  if (ownerCount === 0) {
    // INSERT ... SELECT ... ON CONFLICT is awkward in the Drizzle builder.
    // Use db.execute(sql`...`) with a parameterized placeholder for userId.
    await db.execute(
      sql`INSERT INTO club_memberships (club_id, user_id, role)
         SELECT id, ${userId}, 'owner' FROM clubs
         ON CONFLICT (club_id, user_id) DO UPDATE SET role = 'owner'`
    );
  }
}
