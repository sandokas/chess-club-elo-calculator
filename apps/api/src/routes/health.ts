import { type FastifyInstance } from "fastify";
import { pingDatabase } from "../lib/pool.js";

export type HealthOptions = {
  databasePing?: () => Promise<void>;
};

/**
 * Registers health check routes
 */
export async function registerHealthRoutes(
  app: FastifyInstance,
  options: HealthOptions = {}
): Promise<void> {
  app.get("/health", async () => ({
    status: "ok",
    service: "chess-club-api"
  }));

  app.get("/health/db", async (_request, reply) => {
    const ping = options.databasePing ?? pingDatabase;
    await ping();
    return reply.send({
      status: "ok",
      database: "reachable"
    });
  });
}
