import { defaultRatingConfig, type RatingConfig } from "./config.js";
import { computeEloChange } from "./elo.js";
import { glicko2Update, inflateRd, type GlickoProfile } from "./glicko2.js";

export type RatingProfile = {
  elo: number;
  glicko: GlickoProfile;
  gamesPlayed: number;
  lastGameDate: string | null;
};

export type MatchInput = {
  id: string | number;
  whitePlayerId: string | number;
  blackPlayerId: string | number | null;
  result: number | null;
  // `Date` (e.g. directly from a pg `date` column) or an ISO-like string.
  date: string | Date;
};

/**
 * Normalize a MatchInput.date (which may be a JS Date — as pg returns for
 * `date` columns — or a string) to a millisecond epoch usable for ordering.
 * `String(Date)` cannot be used here because it produces a weekday-prefixed
 * value like `"Sun Jan 18 2026..."` that sorts alphabetically, not
 * chronologically, silently scrambling match order.
 */
function matchDateMillis(date: string | Date): number {
  if (date instanceof Date) return date.getTime();
  const parsed = Date.parse(date);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export type MatchRatingAudit = {
  matchId?: string | number;
  whiteEloBefore: number;
  whiteEloAfter: number;
  blackEloBefore: number | null;
  blackEloAfter: number | null;
  whiteGlickoBefore: GlickoProfile;
  whiteGlickoAfter: GlickoProfile;
  blackGlickoBefore: GlickoProfile | null;
  blackGlickoAfter: GlickoProfile | null;
};

export function defaultRatingProfile(config: RatingConfig = defaultRatingConfig): RatingProfile {
  return {
    elo: config.defaultElo,
    glicko: {
      rating: config.g2DefaultRating,
      rd: config.g2DefaultRd,
      vol: config.g2DefaultVol,
      lastGameDate: null
    },
    gamesPlayed: 0,
    lastGameDate: null
  };
}

function daysBetween(previous: string | null, current: string): number {
  if (!previous) {
    return 0;
  }
  const previousTime = Date.parse(`${previous}T00:00:00.000Z`);
  const currentTime = Date.parse(`${current}T00:00:00.000Z`);
  if (Number.isNaN(previousTime) || Number.isNaN(currentTime)) {
    return 0;
  }
  return Math.max(0, Math.floor((currentTime - previousTime) / 86_400_000));
}

function computeGlickoUpdate(
  player: GlickoProfile,
  opponent: GlickoProfile,
  score: number,
  matchDate: string,
  config: RatingConfig
): GlickoProfile {
  return glicko2Update(player, opponent, score, matchDate, { config });
}

export type RatedMatch = {
  white: RatingProfile;
  black: RatingProfile | null;
  audit: MatchRatingAudit;
};

export function applyRatedMatch(
  white: RatingProfile,
  black: RatingProfile | null,
  result: number,
  matchDate: Date,
  config?: RatingConfig
): RatedMatch {
  // Skip rating calculation for bye matches (black player is null)
  if (black === null) {
    return {
      white: {
        ...white,
        gamesPlayed: white.gamesPlayed,
        lastGameDate: white.lastGameDate
      },
      black: null,
      audit: {
        whiteEloBefore: white.elo,
        whiteEloAfter: white.elo,
        blackEloBefore: null,
        blackEloAfter: null,
        whiteGlickoBefore: white.glicko,
        whiteGlickoAfter: white.glicko,
        blackGlickoBefore: null,
        blackGlickoAfter: null
      }
    };
  }

  const effectiveConfig = config || defaultRatingConfig;

  const [whiteEloAfter, blackEloAfter] = computeEloChange(
    white.elo,
    black.elo,
    white.gamesPlayed,
    black.gamesPlayed,
    result,
    effectiveConfig
  );

  const matchDateStr = matchDate.toISOString().split('T')[0] || '';
  const whiteGlickoAfter = computeGlickoUpdate(white.glicko, black.glicko, result, matchDateStr, effectiveConfig);
  const blackGlickoAfter = computeGlickoUpdate(black.glicko, white.glicko, 1 - result, matchDateStr, effectiveConfig);

  return {
    white: {
      elo: whiteEloAfter,
      glicko: whiteGlickoAfter,
      gamesPlayed: white.gamesPlayed + 1,
      lastGameDate: matchDateStr
    },
    black: {
      elo: blackEloAfter,
      glicko: blackGlickoAfter,
      gamesPlayed: black.gamesPlayed + 1,
      lastGameDate: matchDateStr
    },
    audit: {
      matchId: '',
      whiteEloBefore: white.elo,
      whiteEloAfter,
      blackEloBefore: black.elo,
      blackEloAfter,
      whiteGlickoBefore: white.glicko,
      whiteGlickoAfter,
      blackGlickoBefore: black.glicko,
      blackGlickoAfter
    }
  };
}

export function recomputeRatings(
  playerIds: Array<string | number>,
  matches: MatchInput[],
  config: RatingConfig = defaultRatingConfig
): { profiles: Map<string | number, RatingProfile>; audits: MatchRatingAudit[] } {
  const profiles = new Map<string | number, RatingProfile>();
  for (const playerId of playerIds) {
    profiles.set(playerId, defaultRatingProfile(config));
  }

  const audits: MatchRatingAudit[] = [];
  const sortedMatches = [...matches].sort((a, b) => {
    const timeDiff = matchDateMillis(a.date) - matchDateMillis(b.date);
    if (timeDiff !== 0) return timeDiff;
    return String(a.id).localeCompare(String(b.id));
  });

  for (const match of sortedMatches) {
    if (match.result === null) {
      continue;
    }
    // Skip bye matches entirely (no opponent → no rating change).
    if (match.blackPlayerId === null || match.blackPlayerId === undefined) {
      continue;
    }
    const white = profiles.get(match.whitePlayerId);
    const black = profiles.get(match.blackPlayerId);
    if (!white || !black) {
      throw new Error(`Match ${match.id} references an unknown player.`);
    }
    const applied = applyRatedMatch(white, black, match.result, new Date(match.date), config);
    profiles.set(match.whitePlayerId, applied.white);
    if (applied.black) {
      profiles.set(match.blackPlayerId, applied.black);
    }
    audits.push({ ...applied.audit, matchId: match.id });
  }

  return { profiles, audits };
}
