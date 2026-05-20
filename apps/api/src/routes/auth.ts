import { type FastifyInstance } from "fastify";
import { loadEnv } from "@chess-club/config";
import { generatePKCE, getGoogleAuthUrl, exchangeCodeForTokens, findOrCreateUser } from "../lib/auth/oauth.js";
import { createSession, loadSession, revokeSession } from "../lib/auth/sessions.js";
import { getCookieConfig } from "../lib/auth/cookies.js";
import { createPool } from "@chess-club/db";

const env = loadEnv();

/**
 * Register authentication routes
 */
export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // Cookie plugin registered globally in app.ts

  // GET /auth/google/start - Start Google OAuth flow
  app.get("/auth/google/start", async (request, reply) => {
    const { codeVerifier, codeChallenge, state } = await generatePKCE();

    // Store PKCE verifier and state in short-lived cookies
    reply.setCookie("oauth_state", state, {
      path: "/",
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 10 * 60 // 10 minutes
    });

    reply.setCookie("oauth_code_verifier", codeVerifier, {
      path: "/",
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 10 * 60 // 10 minutes
    });

    const authUrl = getGoogleAuthUrl(state, codeChallenge);
    return reply.redirect(authUrl);
  });

  // GET /auth/google/callback - Handle Google OAuth callback
  app.get<{ Querystring: { code?: string; state?: string } }>("/auth/google/callback", async (request, reply) => {
    const { code, state } = request.query;

    if (!code || !state) {
      return reply.redirect(`${env.WEB_BASE_URL}/login?error=missing_params`);
    }

    const storedState = request.cookies.oauth_state;
    const codeVerifier = request.cookies.oauth_code_verifier;

    // Clear PKCE cookies
    reply.clearCookie("oauth_state", { path: "/" });
    reply.clearCookie("oauth_code_verifier", { path: "/" });

    if (!storedState || storedState !== state || !codeVerifier) {
      return reply.redirect(`${env.WEB_BASE_URL}/login?error=invalid_state`);
    }

    try {
      const googleUser = await exchangeCodeForTokens(code, codeVerifier);
      const { userId, isNewUser } = await findOrCreateUser(googleUser);

      // Bootstrap: promote user to owner of first club if BOOTSTRAP_OWNER_EMAIL matches
      if (env.BOOTSTRAP_OWNER_EMAIL && googleUser.email === env.BOOTSTRAP_OWNER_EMAIL) {
        const pool = createPool();
        try {
          // Check if user has any club memberships
          const membershipResult = await pool.query(
            `SELECT COUNT(*) as count FROM club_memberships WHERE user_id = $1`,
            [userId]
          );

          if (parseInt(membershipResult.rows[0].count) === 0) {
            // Get the first club
            const clubResult = await pool.query(
              `SELECT id FROM clubs ORDER BY created_at ASC LIMIT 1`
            );

            if (clubResult.rows.length > 0) {
              const clubId = clubResult.rows[0].id;
              // Promote to owner
              await pool.query(
                `INSERT INTO club_memberships (club_id, user_id, role) VALUES ($1, $2, 'owner')`,
                [clubId, userId]
              );
              console.log(`Bootstrapped: Promoted ${googleUser.email} to owner of club ${clubId}`);
            }
          }
        } finally {
          await pool.end();
        }
      }

      // Create session
      const { token, expiresAt } = await createSession(userId);

      // Set session cookie
      reply.setCookie(getCookieConfig().name, token, getCookieConfig());

      // Redirect to web app
      const redirectUrl = isNewUser ? `${env.WEB_BASE_URL}/welcome` : env.WEB_BASE_URL;
      return reply.redirect(redirectUrl);
    } catch (error) {
      console.error("OAuth callback error:", error);
      return reply.redirect(`${env.WEB_BASE_URL}/login?error=oauth_failed`);
    }
  });

  // POST /auth/logout - Logout user
  app.post("/auth/logout", async (request, reply) => {
    const token = request.cookies.sid;
    if (token) {
      await revokeSession(token);
    }

    reply.clearCookie(getCookieConfig().name);
    return reply.send({ message: "Logged out successfully" });
  });

  // GET /auth/me - Get current user info
  app.get("/auth/me", async (request, reply) => {
    const token = request.cookies.sid;
    if (!token) {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Not authenticated"
      });
    }

    const session = await loadSession(token);
    if (!session) {
      reply.clearCookie(getCookieConfig().name);
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Invalid session"
      });
    }

    // Touch session to extend expiry
    await import("../lib/auth/sessions.js").then(m => m.touchSession(session.sessionId));

    return reply.send({
      user: {
        id: session.id,
        email: session.email,
        name: session.name,
        memberships: session.memberships
      }
    });
  });
}
