import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { createPool } from "@chess-club/db";

export type AppOptions = {
  databasePing?: () => Promise<void>;
};

export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true
  });

  await app.register(cors, {
    origin: true,
    credentials: true
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    return reply.status(statusCode).send({
      error: statusCode === 500 ? "Internal Server Error" : error.name,
      message: statusCode === 500 ? "Unexpected server error." : error.message
    });
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "chess-club-api"
  }));

  app.get("/health/db", async (_request, reply) => {
    const ping = options.databasePing ?? defaultDatabasePing;
    await ping();
    return reply.send({
      status: "ok",
      database: "reachable"
    });
  });

  app.get("/clubs", async () => ({
    clubs: []
  }));

  return app;
}

async function defaultDatabasePing(): Promise<void> {
  const pool = createPool();
  try {
    await pool.query("select 1");
  } finally {
    await pool.end();
  }
}
