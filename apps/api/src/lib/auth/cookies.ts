import { randomBytes } from "node:crypto";
import { loadEnv } from "@chess-club/config";

const env = loadEnv();

/**
 * Cookie configuration for session management
 */
export const COOKIE_NAME = "sid";

export function getCookieConfig() {
  const isProduction = env.NODE_ENV === "production";
  return {
    name: COOKIE_NAME,
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  };
}

/**
 * Generate a random session token (32 bytes, base64url-encoded)
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Hash a session token for storage in the database
 */
export async function hashSessionToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token + env.SESSION_COOKIE_SECRET);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Buffer.from(hashArray).toString("base64");
}
