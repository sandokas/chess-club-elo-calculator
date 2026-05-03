import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().default("postgres://chess_club:chess_club@localhost:5432/chess_club"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  VITE_API_BASE_URL: z.string().url().default("http://localhost:4000"),
  INITIAL_ADMIN_EMAIL: z.string().email().default("admin@example.com"),
  INITIAL_ADMIN_NAME: z.string().min(1).default("Initial Admin"),
  INITIAL_CLUB_NAME: z.string().min(1).default("Imported Chess Club"),
  INITIAL_CLUB_SLUG: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .default("imported-chess-club"),
  SQLITE_DB_PATH: z.string().default("./chessclub.db")
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return envSchema.parse(source);
}
