import { defaultRatingConfig, type RatingConfig } from "./config.js";

export function expectedScore(ratingA: number, ratingB: number, base = 10, divisor = 400): number {
  return 1 / (1 + base ** ((ratingB - ratingA) / divisor));
}

export function kFactor(gamesPlayed: number, config: RatingConfig = defaultRatingConfig): number {
  const thresholds = config.eloKThresholds;
  const values = config.eloKValues;
  for (let idx = 0; idx < thresholds.length; idx += 1) {
    if (gamesPlayed < thresholds[idx]!) {
      return values[idx]!;
    }
  }
  return values[values.length - 1]!;
}

function roundHalfEven(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  const epsilon = 1e-10;

  if (Math.abs(diff - 0.5) < epsilon) {
    return (floor % 2 === 0 ? floor : floor + 1) / factor;
  }

  return Math.round(scaled) / factor;
}

export function updateElo(
  ratingA: number,
  ratingB: number,
  scoreA: number,
  kA: number,
  kB: number,
  config: RatingConfig = defaultRatingConfig
): [number, number] {
  const expA = expectedScore(ratingA, ratingB);
  const expB = 1 - expA;
  const scoreB = 1 - scoreA;

  const newA = ratingA + kA * (scoreA - expA);
  const newB = ratingB + kB * (scoreB - expB);

  return [roundHalfEven(newA, config.eloDecimals), roundHalfEven(newB, config.eloDecimals)];
}

export function computeEloChange(
  ratingA: number,
  ratingB: number,
  gamesA: number,
  gamesB: number,
  scoreA: number,
  config: RatingConfig = defaultRatingConfig
): [number, number] {
  return updateElo(ratingA, ratingB, scoreA, kFactor(gamesA, config), kFactor(gamesB, config), config);
}
