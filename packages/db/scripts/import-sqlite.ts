import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { loadEnv } from "@chess-club/config";
import { defaultRatingConfig, recomputeRatings, type RatingConfig } from "@chess-club/core";

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

function loadRatingConfig(): RatingConfig {
  const businessConfigPath = resolve(process.cwd(), "../../configs/business_config.json");
  try {
    const parsed = JSON.parse(readFileSync(businessConfigPath, "utf8")) as Record<string, unknown>;
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

async function one<T>(client: pg.PoolClient, sql: string, values: unknown[]): Promise<T> {
  const result = await client.query<T>(sql, values);
  const row = result.rows[0];
  if (!row) {
    throw new Error(`Expected one row for query: ${sql}`);
  }
  return row;
}

function diff(a: number | null | undefined, b: number | null | undefined): number {
  if (a == null || b == null) {
    return 0;
  }
  return Math.abs(a - b);
}

async function main(): Promise<void> {
  const env = loadEnv();
  const sqlitePath = resolve(process.cwd(), "../../", env.SQLITE_DB_PATH);
  const sqlite = new Database(sqlitePath, { readonly: true });
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  const client = await pool.connect();
  const ratingConfig = loadRatingConfig();

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
      [env.INITIAL_CLUB_NAME, env.INITIAL_CLUB_SLUG]
    );

    const admin = await one<{ id: string }>(
      client,
      `
        INSERT INTO users (email, name, email_verified)
        VALUES ($1, $2, true)
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
        RETURNING id
      `,
      [env.INITIAL_ADMIN_EMAIL, env.INITIAL_ADMIN_NAME]
    );

    await client.query(
      `
        INSERT INTO auth_identities (user_id, provider, provider_subject, email)
        VALUES ($1, 'password', $2, $2)
        ON CONFLICT (provider, provider_subject) DO NOTHING
      `,
      [admin.id, env.INITIAL_ADMIN_EMAIL]
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

    const recomputed = recomputeRatings(
      [...playerIds.values()],
      legacyMatches
        .filter((match) => matchIds.has(match.id))
        .map((match) => ({
          id: matchIds.get(match.id)!,
          whitePlayerId: playerIds.get(match.player1_id)!,
          blackPlayerId: playerIds.get(match.player2_id)!,
          result: match.result,
          date: match.date
        })),
      ratingConfig
    );

    let maxEloDiff = 0;
    for (const legacy of legacyPlayers) {
      const playerId = playerIds.get(legacy.id);
      if (!playerId) {
        continue;
      }
      const profile = recomputed.profiles.get(playerId);
      if (!profile) {
        continue;
      }
      maxEloDiff = Math.max(maxEloDiff, diff(legacy.elo, profile.elo));
      await client.query(
        `
          UPDATE player_ratings
          SET elo = $1,
              glicko_rating = $2,
              glicko_rd = $3,
              glicko_vol = $4,
              games_played = $5,
              last_game_date = $6,
              updated_at = now()
          WHERE player_id = $7
        `,
        [
          profile.elo,
          profile.glicko.rating,
          profile.glicko.rd,
          profile.glicko.vol,
          profile.gamesPlayed,
          profile.lastGameDate,
          playerId
        ]
      );
    }

    for (const audit of recomputed.audits) {
      await client.query(
        `
          UPDATE matches
          SET white_elo_before = $1,
              white_elo_after = $2,
              black_elo_before = $3,
              black_elo_after = $4,
              white_glicko_rating_before = $5,
              white_glicko_rating_after = $6,
              white_glicko_rd_before = $7,
              white_glicko_rd_after = $8,
              white_glicko_vol_before = $9,
              white_glicko_vol_after = $10,
              black_glicko_rating_before = $11,
              black_glicko_rating_after = $12,
              black_glicko_rd_before = $13,
              black_glicko_rd_after = $14,
              black_glicko_vol_before = $15,
              black_glicko_vol_after = $16,
              updated_at = now()
          WHERE id = $17
        `,
        [
          audit.whiteEloBefore,
          audit.whiteEloAfter,
          audit.blackEloBefore,
          audit.blackEloAfter,
          audit.whiteGlickoBefore.rating,
          audit.whiteGlickoAfter.rating,
          audit.whiteGlickoBefore.rd,
          audit.whiteGlickoAfter.rd,
          audit.whiteGlickoBefore.vol,
          audit.whiteGlickoAfter.vol,
          audit.blackGlickoBefore.rating,
          audit.blackGlickoAfter.rating,
          audit.blackGlickoBefore.rd,
          audit.blackGlickoAfter.rd,
          audit.blackGlickoBefore.vol,
          audit.blackGlickoAfter.vol,
          audit.matchId
        ]
      );
    }

    await client.query("COMMIT");

    console.log("SQLite import complete.");
    console.table({
      players: legacyPlayers.length,
      tournaments: legacyTournaments.length,
      tournamentPlayers: legacyTournamentPlayers.length,
      matches: legacyMatches.length,
      recomputedMatches: recomputed.audits.length,
      maxImportedVsRecomputedEloDiff: Number(maxEloDiff.toFixed(6))
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
