import "dotenv/config";
import { loadEnv } from "@chess-club/config";
import { createApp } from "./app.js";

const env = loadEnv();
const app = await createApp();

await app.listen({
  host: env.API_HOST,
  port: env.API_PORT
});

// Graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`Received ${signal}, shutting down gracefully...`);
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
