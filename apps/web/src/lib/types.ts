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

export type Match = {
  id: string;
  whitePlayerId: string;
  whitePlayerName: string;
  blackPlayerId: string;
  blackPlayerName: string;
  result: number | null;
  playedOn: string;
  boardNumber: number | null;
  roundNumber: number | null;
  roundStart?: string | null;
};

export type Standing = {
  playerId: string;
  playerName: string;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  buchholz?: number;
  sonnebornBerger?: number;
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

export type TournamentDetail = {
  tournament: Tournament;
  matches: Match[];
  standings: Standing[];
  tournamentPlayers: Array<{ playerId: string; displayName: string }>;
};

export type TournamentDetailState =
  | { status: "loading" }
  | { status: "ok"; data: TournamentDetail }
  | { status: "error"; message: string };

export type Club = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  city: string | null;
  country: string | null;
};

export type LeaderboardEntry = {
  id: string;
  displayName: string;
  active: boolean;
  elo: number;
  glickoRating: number;
  gamesPlayed: number;
  lastGameDate: string | null;
  wins: number;
  draws: number;
  losses: number;
};

export type AdminData = {
  club: Club;
  players: Player[];
  tournaments: Tournament[];
  totalTournaments: number;
  leaderboard: LeaderboardEntry[];
};

export type LoadState =
  | { status: "loading" }
  | { status: "ok"; data: AdminData }
  | { status: "error"; message: string };

export type TournamentsListState =
  | { status: "loading" }
  | { status: "ok"; data: TournamentsListData }
  | { status: "error"; message: string };

export type TournamentsListData = {
  tournaments: Tournament[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};
