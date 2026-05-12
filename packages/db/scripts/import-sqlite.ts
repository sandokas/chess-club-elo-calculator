import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import pg from "pg";
import { loadImportEnv, loadRatingConfig } from "@chess-club/config";


type LegacyPlayer = {
  id: number;
  name: string;
  elo: number | null;
  g2_rating: number | null;
  g2_rd: number | null;
  g2_vol: number | null;
  last_game_date: string | null;
  last_game_match_id: number | null;
};

type LegacyTournament = {
  id: number;
  name: string;
  date: string;
  completed: number | null;
};

type LegacyTournamentPlayer = {
  tournament_id: number;
  player_id: number;
};

type LegacyMatch = {
  id: number;
  tournament_id: number;
  player1_id: number;
  player2_id: number;
  result: number | null;
  date: string;
  player1_elo_before: number | null;
  player1_elo_after: number | null;
  player2_elo_before: number | null;
  player2_elo_after: number | null;
  player1_g2_rating_before: number | null;
  player1_g2_rating_after: number | null;
  player1_g2_rd_before: number | null;
  player1_g2_rd_after: number | null;
  player1_g2_vol_before: number | null;
  player1_g2_vol_after: number | null;
  player2_g2_rating_before: number | null;
  player2_g2_rating_after: number | null;
  player2_g2_rd_before: number | null;
  player2_g2_rd_after: number | null;
  player2_g2_vol_before: number | null;
  player2_g2_vol_after: number | null;
  player1_last_played_before: string | null;
  player2_last_played_before: string | null;
};

function resolveFromBase(path: string, basePath: string): string {
  return isAbsolute(path) ? path : resolve(basePath, path);
}

function loadImportEnvFile(): string {
  for (const path of [resolve(process.cwd(), ".env.import"), resolve(process.cwd(), "../../.env.import")]) {
    if (existsSync(path)) {
      loadDotenv({ path });
      return dirname(path);
    }
  }
  return process.cwd();
}

async function one<T extends pg.QueryResultRow>(client: pg.PoolClient, sql: string, values: unknown[]): Promise<T> {
  const result = await client.query<T>(sql, values);
  const row = result.rows[0];
  if (!row) {
    throw new Error(`Expected one row for query: ${sql}`);
  }
  return row;
}

async function main(): Promise<void> {
  const importEnvDir = loadImportEnvFile();
  const env = loadImportEnv();
  const sqlitePath = resolveFromBase(env.IMPORT_SQLITE_PATH, importEnvDir);
  const sqlite = new Database(sqlitePath, { readonly: true });
  const pool = new pg.Pool({ connectionString: env.IMPORT_TARGET_DATABASE_URL });
  const client = await pool.connect();
  const ratingConfig = loadRatingConfig(
    env.IMPORT_BUSINESS_CONFIG_PATH
      ? resolveFromBase(env.IMPORT_BUSINESS_CONFIG_PATH, importEnvDir)
      : resolve(importEnvDir, "configs/business_config.json")
  );

  const legacyPlayers = sqlite.prepare("SELECT * FROM Players ORDER BY id").all() as LegacyPlayer[];
  const legacyTournaments = sqlite.prepare("SELECT * FROM Tournaments ORDER BY id").all() as LegacyTournament[];
  const legacyTournamentPlayers = sqlite.prepare("SELECT tournament_id, player_id FROM TournamentPlayers ORDER BY id").all() as LegacyTournamentPlayer[];
  const legacyMatches = sqlite.prepare("SELECT * FROM Matches ORDER BY date, id").all() as LegacyMatch[];

  const playerIds = new Map<number, string>();
  const tournamentIds = new Map<number, string>();
  const matchIds = new Map<number, string>();

  try {
    await client.query("BEGIN");

    const club = await one<{ id: string }>(
      client,
      `
        INSERT INTO clubs (name, slug)
        VALUES ($1, $2)
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
        RETURNING id
      `,
      [env.IMPORT_INITIAL_CLUB_NAME, env.IMPORT_INITIAL_CLUB_SLUG]
    );

    const admin = await one<{ id: string }>(
      client,
      `
        INSERT INTO users (email, name, email_verified)
        VALUES ($1, $2, true)
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
        RETURNING id
      `,
      [env.IMPORT_INITIAL_ADMIN_EMAIL, env.IMPORT_INITIAL_ADMIN_NAME]
    );

    await client.query(
      `
        INSERT INTO auth_identities (user_id, provider, provider_subject, email)
        VALUES ($1, 'password', $2::text, $2::varchar)
        ON CONFLICT (provider, provider_subject) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          email = EXCLUDED.email
      `,
      [admin.id, env.IMPORT_INITIAL_ADMIN_EMAIL]
    );

    await client.query(
      `
        INSERT INTO club_memberships (club_id, user_id, role)
        VALUES ($1, $2, 'owner')
        ON CONFLICT (club_id, user_id) DO UPDATE SET role = 'owner'
      `,
      [club.id, admin.id]
    );

    for (const legacy of legacyPlayers) {
      const inserted = await one<{ id: string }>(
        client,
        `
          INSERT INTO players (club_id, display_name, legacy_id)
          VALUES ($1, $2, $3)
          ON CONFLICT (club_id, legacy_id) DO UPDATE
            SET display_name = EXCLUDED.display_name, updated_at = now()
          RETURNING id
        `,
        [club.id, legacy.name, legacy.id]
      );
      playerIds.set(legacy.id, inserted.id);

      await client.query(
        `
          INSERT INTO player_ratings (
            player_id, club_id, elo, glicko_rating, glicko_rd, glicko_vol, last_game_date
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (player_id) DO UPDATE SET
            club_id = EXCLUDED.club_id,
            elo = EXCLUDED.elo,
            glicko_rating = EXCLUDED.glicko_rating,
            glicko_rd = EXCLUDED.glicko_rd,
            glicko_vol = EXCLUDED.glicko_vol,
            last_game_date = EXCLUDED.last_game_date,
            updated_at = now()
        `,
        [
          inserted.id,
          club.id,
          legacy.elo ?? ratingConfig.defaultElo,
          legacy.g2_rating ?? ratingConfig.g2DefaultRating,
          legacy.g2_rd ?? ratingConfig.g2DefaultRd,
          legacy.g2_vol ?? ratingConfig.g2DefaultVol,
          legacy.last_game_date
        ]
      );
    }

    for (const legacy of legacyTournaments) {
      const inserted = await one<{ id: string }>(
        client,
        `
          INSERT INTO tournaments (club_id, name, starts_on, format, status, legacy_id)
          VALUES ($1, $2, $3, 'manual', $4, $5)
          ON CONFLICT (club_id, legacy_id) DO UPDATE SET
            name = EXCLUDED.name,
            starts_on = EXCLUDED.starts_on,
            status = EXCLUDED.status,
            updated_at = now()
          RETURNING id
        `,
        [club.id, legacy.name, legacy.date, legacy.completed ? "completed" : "active", legacy.id]
      );
      tournamentIds.set(legacy.id, inserted.id);
    }

    for (const legacy of legacyTournamentPlayers) {
      const tournamentId = tournamentIds.get(legacy.tournament_id);
      const playerId = playerIds.get(legacy.player_id);
      if (!tournamentId || !playerId) {
        continue;
      }
      await client.query(
        `
          INSERT INTO tournament_players (tournament_id, player_id)
          VALUES ($1, $2)
          ON CONFLICT (tournament_id, player_id) DO NOTHING
        `,
        [tournamentId, playerId]
      );
    }

    for (const legacy of legacyMatches) {
      const tournamentId = tournamentIds.get(legacy.tournament_id);
      const whitePlayerId = playerIds.get(legacy.player1_id);
      const blackPlayerId = playerIds.get(legacy.player2_id);
      if (!tournamentId || !whitePlayerId || !blackPlayerId) {
        continue;
      }
      const inserted = await one<{ id: string }>(
        client,
        `
          INSERT INTO matches (
            club_id, tournament_id, white_player_id, black_player_id, result, played_on, status, legacy_id,
            white_elo_before, white_elo_after, black_elo_before, black_elo_after,
            white_glicko_rating_before, white_glicko_rating_after, white_glicko_rd_before, white_glicko_rd_after,
            white_glicko_vol_before, white_glicko_vol_after, black_glicko_rating_before, black_glicko_rating_after,
            black_glicko_rd_before, black_glicko_rd_after, black_glicko_vol_before, black_glicko_vol_after,
            white_last_played_before, black_last_played_before
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12,
            $13, $14, $15, $16,
            $17, $18, $19, $20,
            $21, $22, $23, $24,
            $25, $26
          )
          ON CONFLICT (club_id, legacy_id) DO UPDATE SET
            tournament_id = EXCLUDED.tournament_id,
            white_player_id = EXCLUDED.white_player_id,
            black_player_id = EXCLUDED.black_player_id,
            result = EXCLUDED.result,
            played_on = EXCLUDED.played_on,
            status = EXCLUDED.status,
            white_elo_before = EXCLUDED.white_elo_before,
            white_elo_after = EXCLUDED.white_elo_after,
            black_elo_before = EXCLUDED.black_elo_before,
            black_elo_after = EXCLUDED.black_elo_after,
            white_glicko_rating_before = EXCLUDED.white_glicko_rating_before,
            white_glicko_rating_after = EXCLUDED.white_glicko_rating_after,
            white_glicko_rd_before = EXCLUDED.white_glicko_rd_before,
            white_glicko_rd_after = EXCLUDED.white_glicko_rd_after,
            white_glicko_vol_before = EXCLUDED.white_glicko_vol_before,
            white_glicko_vol_after = EXCLUDED.white_glicko_vol_after,
            black_glicko_rating_before = EXCLUDED.black_glicko_rating_before,
            black_glicko_rating_after = EXCLUDED.black_glicko_rating_after,
            black_glicko_rd_before = EXCLUDED.black_glicko_rd_before,
            black_glicko_rd_after = EXCLUDED.black_glicko_rd_after,
            black_glicko_vol_before = EXCLUDED.black_glicko_vol_before,
            black_glicko_vol_after = EXCLUDED.black_glicko_vol_after,
            white_last_played_before = EXCLUDED.white_last_played_before,
            black_last_played_before = EXCLUDED.black_last_played_before,
            updated_at = now()
          RETURNING id
        `,
        [
          club.id,
          tournamentId,
          whitePlayerId,
          blackPlayerId,
          legacy.result,
          legacy.date,
          legacy.result == null ? "scheduled" : "completed",
          legacy.id,
          legacy.player1_elo_before,
          legacy.player1_elo_after,
          legacy.player2_elo_before,
          legacy.player2_elo_after,
          legacy.player1_g2_rating_before,
          legacy.player1_g2_rating_after,
          legacy.player1_g2_rd_before,
          legacy.player1_g2_rd_after,
          legacy.player1_g2_vol_before,
          legacy.player1_g2_vol_after,
          legacy.player2_g2_rating_before,
          legacy.player2_g2_rating_after,
          legacy.player2_g2_rd_before,
          legacy.player2_g2_rd_after,
          legacy.player2_g2_vol_before,
          legacy.player2_g2_vol_after,
          legacy.player1_last_played_before,
          legacy.player2_last_played_before
        ]
      );
      matchIds.set(legacy.id, inserted.id);
    }

    // Note: rating recomputation lives in the API (`@chess-club/api`). After importing,
    // trigger the club's recompute endpoint to reapply ratings against the current config.
    await client.query("COMMIT");

    console.log("SQLite import complete.");
    console.table({
      players: legacyPlayers.length,
      tournaments: legacyTournaments.length,
      tournamentPlayers: legacyTournamentPlayers.length,
      matches: legacyMatches.length
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
