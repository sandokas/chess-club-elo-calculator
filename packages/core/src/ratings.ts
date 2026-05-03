import { defaultRatingConfig, type RatingConfig } from "./config.js";
import { computeEloChange } from "./elo.js";
import { glicko2Update, type GlickoProfile } from "./glicko2.js";

export type RatingProfile = {
  elo: number;
  glicko: GlickoProfile;
  gamesPlayed: number;
  lastGameDate: string | null;
};

export type MatchInput = {
  id: string | number;
  whitePlayerId: string | number;
  blackPlayerId: string | number;
  result: number | null;
  date: string;
};

export type MatchRatingAudit = {
  matchId: string | number;
  whiteEloBefore: number;
  whiteEloAfter: number;
  blackEloBefore: number;
  blackEloAfter: number;
  whiteGlickoBefore: GlickoProfile;
  whiteGlickoAfter: GlickoProfile;
  blackGlickoBefore: GlickoProfile;
  blackGlickoAfter: GlickoProfile;
};

export function defaultRatingProfile(config: RatingConfig = defaultRatingConfig): RatingProfile {
  return {
    elo: config.defaultElo,
    glicko: {
      rating: config.g2DefaultRating,
      rd: config.g2DefaultRd,
      vol: config.g2DefaultVol
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

export function applyRatedMatch(
  white: RatingProfile,
  black: RatingProfile,
  result: number,
  matchDate: string,
  config: RatingConfig = defaultRatingConfig
): { white: RatingProfile; black: RatingProfile; audit: Omit<MatchRatingAudit, "matchId"> } {
  const [whiteEloAfter, blackEloAfter] = computeEloChange(
    white.elo,
    black.elo,
    white.gamesPlayed,
    black.gamesPlayed,
    result,
    config
  );

  const whiteGlickoAfter = glicko2Update(white.glicko, black.glicko, result, {
    days: daysBetween(white.lastGameDate, matchDate),
    config
  });
  const blackGlickoAfter = glicko2Update(black.glicko, white.glicko, 1 - result, {
    days: daysBetween(black.lastGameDate, matchDate),
    config
  });

  return {
    white: {
      elo: whiteEloAfter,
      glicko: whiteGlickoAfter,
      gamesPlayed: white.gamesPlayed + 1,
      lastGameDate: matchDate
    },
    black: {
      elo: blackEloAfter,
      glicko: blackGlickoAfter,
      gamesPlayed: black.gamesPlayed + 1,
      lastGameDate: matchDate
    },
    audit: {
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
  const sortedMatches = [...matches].sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));

  for (const match of sortedMatches) {
    if (match.result === null) {
      continue;
    }
    const white = profiles.get(match.whitePlayerId);
    const black = profiles.get(match.blackPlayerId);
    if (!white || !black) {
      throw new Error(`Match ${match.id} references an unknown player.`);
    }
    const applied = applyRatedMatch(white, black, match.result, match.date, config);
    profiles.set(match.whitePlayerId, applied.white);
    profiles.set(match.blackPlayerId, applied.black);
    audits.push({ matchId: match.id, ...applied.audit });
  }

  return { profiles, audits };
}
