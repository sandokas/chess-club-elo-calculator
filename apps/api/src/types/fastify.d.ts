import type { Pool } from "pg";
import type { Db } from "@chess-club/db";

declare module "fastify" {
  interface FastifyInstance {
    pg: Pool;
    db: Db;
  }
}
