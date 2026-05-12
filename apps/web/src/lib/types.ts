export type Player = {
  id: string;
  displayName: string;
  active: boolean;
  elo: number;
  glickoRating: number;
  glickoRd?: number;
  glickoVol?: number;
  gamesPlayed: number;
  lastGameDate: string | null;
  clubId?: string;
  clubName?: string;
  legacyId?: number;
  createdAt?: string;
};

export type PlayersListData = {
  players: Player[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type PlayerDetail = {
  player: Player;
  matches: PlayerMatch[];
};

export type PlayerMatch = {
  id: string;
  whitePlayerId: string;
  whitePlayerName: string;
  blackPlayerId: string;
  blackPlayerName: string;
  result: number | null;
  playedOn: string;
  tournamentId: string | null;
  tournamentName: string | null;
  eloBefore?: number;
  eloAfter?: number;
  glickoRatingBefore?: number;
  glickoRatingAfter?: number;
};

export type Tournament = {
  id: string;
  name: string;
  startsOn: string | null;
  status: string;
  playerCount: number;
  matchCount: number;
  format?: string;
  totalRounds?: number;
  pairingMethod?: string;
  clubId: string;
};
