import type { Pool } from "pg";
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
 * Find or create user from Google OAuth info
 */
export async function findOrCreateUser(pool: Pool, googleUser: GoogleUserInfo): Promise<{ userId: string; isNewUser: boolean }> {
  // Check if auth identity exists
  const identityResult = await pool.query(
    `SELECT user_id FROM auth_identities WHERE provider = 'google' AND provider_subject = $1`,
    [googleUser.sub]
  );

  if (identityResult.rows.length > 0) {
    return { userId: identityResult.rows[0].user_id, isNewUser: false };
  }

  // Create new user
  const userResult = await pool.query(
    `INSERT INTO users (email, name, email_verified) VALUES ($1, $2, $3) RETURNING id`,
    [googleUser.email, googleUser.name, googleUser.email_verified]
  );

  const userId = userResult.rows[0].id;

  // Create auth identity
  await pool.query(
    `INSERT INTO auth_identities (user_id, provider, provider_subject, email) VALUES ($1, 'google', $2, $3)`,
    [userId, googleUser.sub, googleUser.email]
  );

  // Check for bootstrap owner promotion
  if (env.BOOTSTRAP_OWNER_EMAIL && env.BOOTSTRAP_OWNER_EMAIL.toLowerCase() === googleUser.email.toLowerCase()) {
    await promoteToOwnerOfAllClubs(userId, pool);
  }

  return { userId, isNewUser: true };
}

/**
 * Promote a user to owner of all existing clubs (bootstrap)
 */
async function promoteToOwnerOfAllClubs(userId: string, pool: any): Promise<void> {
  // Check if any owner exists for any club
  const ownerCheckResult = await pool.query(
    `SELECT COUNT(*) as count FROM club_memberships WHERE role = 'owner'`
  );

  const ownerCount = parseInt(ownerCheckResult.rows[0].count, 10);

  if (ownerCount === 0) {
    // No owners exist, promote this user to owner of all clubs
    await pool.query(
      `INSERT INTO club_memberships (club_id, user_id, role)
       SELECT id, $1, 'owner' FROM clubs
       ON CONFLICT (club_id, user_id) DO UPDATE SET role = 'owner'`,
      [userId]
    );
  }
}
