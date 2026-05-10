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
