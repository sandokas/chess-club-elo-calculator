import type { Db } from "@chess-club/db";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
  }
}
