import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { ratingConfig, loadEnv } from "@chess-club/config";
import { registerHealthRoutes, type HealthOptions } from "./routes/health.js";
import { registerPlayerRoutes } from "./routes/players.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerInviteRoutes } from "./routes/invites.js";
import { registerClubsRoutes } from "./routes/clubs.js";
import { registerTournamentRoutes } from "./routes/tournaments.js";
import { registerTournamentPlayerRoutes } from "./routes/tournament-players.js";
import { registerTournamentRoundsRoutes } from "./routes/tournament-rounds.js";
import { registerLeaderboardRoutes } from "./routes/leaderboard.js";
import { attachUser } from "./lib/auth/rbac.js";
import { createErrorResponse } from "./lib/errors.js";
import dbPlugin from "./plugins/db.js";
import authPlugin from "./plugins/auth.js";
import type { Db } from "@chess-club/db";
import type pg from "pg";

export type AppOptions = {
  databasePing?: () => Promise<void>;
  pool?: pg.Pool;
  db?: Db;
};

export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const env = loadEnv();
  const app = Fastify({
    logger: true
  });

  // CORS: env-driven allowlist, wildcard only in development
  const allowedOrigins = env.ALLOWED_ORIGINS.split(",").filter(Boolean);
  await app.register(cors, {
    origin: env.NODE_ENV === "development" ? true : allowedOrigins,
    credentials: true
  });

  // Cookie plugin - must be registered before any preHandler that reads cookies
  await app.register(cookie);

  // Database plugin - single pool lifecycle
  await app.register(dbPlugin, {
    pool: options.pool,
    db: options.db
  });

  // Auth plugin - conditional auth guards
  await app.register(authPlugin);

  app.setErrorHandler((error, _request, reply) => {
    const { statusCode, body } = createErrorResponse(error);
    return reply.status(statusCode).send(body);
  });

  // Global preHandler to attach user from session
  app.addHook("preHandler", attachUser);

  await registerHealthRoutes(app, {
    databasePing: options.databasePing
  });

  await registerAuthRoutes(app);

  await registerInviteRoutes(app);

  await registerPlayerRoutes(app);

  await registerClubsRoutes(app);

  await registerTournamentRoutes(app);

  await registerTournamentPlayerRoutes(app);

  await registerTournamentRoundsRoutes(app);

  await registerLeaderboardRoutes(app);

  return app;
}
