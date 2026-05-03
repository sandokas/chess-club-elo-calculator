import "dotenv/config";
import { loadEnv } from "@chess-club/config";
import { createApp } from "./app.js";

const env = loadEnv();
const app = await createApp();

await app.listen({
  host: env.API_HOST,
  port: env.API_PORT
});
