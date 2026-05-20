import fp from "fastify-plugin";
import { createPool, createDb, type Db } from "@chess-club/db";
import pg from "pg";

export interface DbPluginOptions {
  pool?: pg.Pool;
  db?: Db;
}

export default fp(async (app, options: DbPluginOptions = {}) => {
  const pool = options.pool ?? createPool();
  const db = options.db ?? createDb(pool);

  app.decorate("pg", pool);
  app.decorate("db", db);

  let closed = false;
  app.addHook("onClose", async () => {
    if (!closed) {
      await pool.end();
      closed = true;
    }
  });
}, {
  name: "db"
});
