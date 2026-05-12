import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().default("postgres://chess_club:chess_club@localhost:5432/chess_club"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  VITE_API_BASE_URL: z.string().url().default("http://localhost:4000")
});

const importEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  IMPORT_TARGET_DATABASE_URL: z.string().url(),
  IMPORT_SQLITE_PATH: z.string().min(1),
  IMPORT_INITIAL_ADMIN_EMAIL: z.string().email(),
  IMPORT_INITIAL_ADMIN_NAME: z.string().min(1),
  IMPORT_INITIAL_CLUB_NAME: z.string().min(1),
  IMPORT_INITIAL_CLUB_SLUG: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .default("imported-chess-club"),
  IMPORT_BUSINESS_CONFIG_PATH: z.string().min(1).optional()
});

export type AppEnv = z.infer<typeof envSchema>;
export type ImportEnv = z.infer<typeof importEnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return envSchema.parse(source);
}

export function loadImportEnv(source: NodeJS.ProcessEnv = process.env): ImportEnv {
  return importEnvSchema.parse(source);
}

// ---------------------------------------------------------------------------
// Rating configuration — SINGLE SOURCE OF TRUTH
// ---------------------------------------------------------------------------
// All rating defaults (initial Elo, Glicko rating/RD/vol, K-factors, etc.) are
// defined here and loaded once from `configs/business_config.json`. Every API
// site, import script, and library function MUST read from this module.
// Hardcoding any of these values elsewhere is a bug.

export type RatingConfig = {
  minGamesForOfficial: number;
  ratingSystem: "elo" | "glicko2" | "both";
  defaultElo: number;
  eloKThresholds: [number, number];
  eloKValues: [number, number, number];
  eloDecimals: number;
  g2DefaultRating: number;
  g2DefaultRd: number;
  g2DefaultVol: number;
  g2RdIncreasePerDay: number;
};

export const defaultRatingConfig: RatingConfig = {
  minGamesForOfficial: 10,
  ratingSystem: "both",
  defaultElo: 1000,
  eloKThresholds: [20, 50],
  eloKValues: [40, 20, 10],
  eloDecimals: 2,
  g2DefaultRating: 1000,
  g2DefaultRd: 350,
  g2DefaultVol: 0.06,
  g2RdIncreasePerDay: 12
};

/**
 * Load a RatingConfig from a JSON file (typically `configs/business_config.json`).
 * Returns `defaultRatingConfig` if the file is missing or unreadable.
 */
export function loadRatingConfig(path: string): RatingConfig {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return {
      ...defaultRatingConfig,
      minGamesForOfficial: Number(parsed.MIN_GAMES_FOR_OFFICIAL ?? defaultRatingConfig.minGamesForOfficial),
      ratingSystem: (parsed.RATING_SYSTEM as RatingConfig["ratingSystem"]) ?? defaultRatingConfig.ratingSystem,
      defaultElo: Number(parsed.DEFAULT_ELO ?? defaultRatingConfig.defaultElo),
      eloKThresholds: (parsed.ELO_K_THRESHOLDS as [number, number]) ?? defaultRatingConfig.eloKThresholds,
      eloKValues: (parsed.ELO_K_VALUES as [number, number, number]) ?? defaultRatingConfig.eloKValues,
      eloDecimals: Number(parsed.ELO_DECIMALS ?? defaultRatingConfig.eloDecimals),
      g2DefaultRating: Number(parsed.G2_DEFAULT_RATING ?? defaultRatingConfig.g2DefaultRating),
      g2DefaultRd: Number(parsed.G2_DEFAULT_RD ?? defaultRatingConfig.g2DefaultRd),
      g2DefaultVol: Number(parsed.G2_DEFAULT_VOL ?? defaultRatingConfig.g2DefaultVol),
      g2RdIncreasePerDay: Number(parsed.G2_RD_INCREASE_PER_DAY ?? defaultRatingConfig.g2RdIncreasePerDay)
    };
  } catch {
    return defaultRatingConfig;
  }
}

/**
 * Resolve the business config path: honor BUSINESS_CONFIG_PATH env var, otherwise
 * fall back to `configs/business_config.json` relative to the current working
 * directory.
 */
function resolveBusinessConfigPath(): string {
  const fromEnv = process.env.BUSINESS_CONFIG_PATH;
  if (fromEnv && fromEnv.length > 0) {
    return resolve(fromEnv);
  }
  return resolve(process.cwd(), "configs/business_config.json");
}

/**
 * Process-wide singleton rating config. Initialized once at module load from
 * `configs/business_config.json`. All API code paths and helpers should import
 * THIS, not `defaultRatingConfig` directly, so that JSON edits take effect.
 */
export const ratingConfig: RatingConfig = loadRatingConfig(resolveBusinessConfigPath());
