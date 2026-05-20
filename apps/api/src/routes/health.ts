import { type FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";

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
    const ping = options.databasePing ?? (async () => {
      await app.db.execute(sql`SELECT 1`);
    });
    await ping();
    return reply.send({
      status: "ok",
      database: "reachable"
    });
  });
}
