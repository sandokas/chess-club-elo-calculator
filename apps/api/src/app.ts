import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";

type HttpError = Error & { statusCode?: number };

function asHttpError(error: unknown): HttpError {
  return error instanceof Error ? error : new Error("Unknown server error");
}
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
    const httpError = asHttpError(error);
    app.log.error(httpError);
    const statusCode = httpError.statusCode && httpError.statusCode >= 400 ? httpError.statusCode : 500;
    return reply.status(statusCode).send({
      error: statusCode === 500 ? "Internal Server Error" : httpError.name,
      message: statusCode === 500 ? "Unexpected server error." : httpError.message
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
