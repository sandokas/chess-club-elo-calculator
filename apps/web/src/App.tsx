import { useEffect, useState } from "react";
import { Routes, Route, Link, useParams, useNavigate } from "react-router-dom";

type LoadState =
  | { status: "loading" }
  | { status: "ok"; data: AdminData }
  | { status: "error"; message: string };

type Club = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  city: string | null;
  country: string | null;
};

type Player = {
  id: string;
  displayName: string;
  active: boolean;
  elo: number;
  glickoRating: number;
  gamesPlayed: number;
  lastGameDate: string | null;
};

type Tournament = {
  id: string;
  name: string;
  startsOn: string | null;
  status: string;
  playerCount: number;
  matchCount: number;
};

type LeaderboardEntry = {
  id: string;
  displayName: string;
  elo: number;
  glickoRating: number;
  gamesPlayed: number;
  lastGameDate: string | null;
  wins: number;
  draws: number;
  losses: number;
};

type AdminData = {
  club: Club;
  players: Player[];
  tournaments: Tournament[];
  leaderboard: LeaderboardEntry[];
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export function App() {
  return (
    <main className="app-shell">
      <Routes>
        <Route path="/" element={<AdminOverviewPage />} />
        <Route path="/tournaments/:id" element={<TournamentDetailPage />} />
      </Routes>
    </main>
  );
}

function AdminOverviewPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    loadAdminData(controller.signal)
      .then((data) => {
        setState({ status: "ok", data });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Unable to reach API"
        });
      });

    return () => controller.abort();
  }, []);

  return (
    <>
      {state.status === "loading" && <StatusCard title="Loading club data" message={`Fetching ${apiBaseUrl}`} tone="loading" />}
      {state.status === "error" && <StatusCard title="Unable to load club data" message={state.message} tone="error" />}
      {state.status === "ok" && <AdminOverview data={state.data} />}
    </>
  );
}

async function loadAdminData(signal: AbortSignal): Promise<AdminData> {
  const clubsPayload = await fetchJson<{ clubs: Club[] }>("/clubs", signal);
  const club = clubsPayload.clubs[0];
  if (!club) {
    throw new Error("No clubs found in the database.");
  }

  const [playersPayload, tournamentsPayload, leaderboardPayload] = await Promise.all([
    fetchJson<{ players: Player[] }>(`/clubs/${club.id}/players`, signal),
    fetchJson<{ tournaments: Tournament[] }>(`/clubs/${club.id}/tournaments`, signal),
    fetchJson<{ leaderboard: LeaderboardEntry[] }>(`/clubs/${club.id}/leaderboard`, signal)
  ]);

  return {
    club,
    players: playersPayload.players,
    tournaments: tournamentsPayload.tournaments,
    leaderboard: leaderboardPayload.leaderboard
  };
}

async function fetchJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, { signal });
  if (!response.ok) {
    throw new Error(`API responded with ${response.status} for ${path}`);
  }
  return response.json() as Promise<T>;
}

function AdminOverview({ data }: { data: AdminData }) {
  const topPlayers = data.leaderboard.slice(0, 8);
  const recentTournaments = data.tournaments.slice(0, 6);

  return (
    <section className="dashboard" aria-labelledby="app-title">
      <header className="hero">
        <p className="eyebrow">Chess Club Manager</p>
        <h1 id="app-title">{data.club.name}</h1>
        <p className="lede">
          Imported club data is now available through the Node API. This admin overview is the first step toward replacing the Python CLI workflows.
        </p>
      </header>

      <section className="stats-grid" aria-label="Club summary">
        <StatCard label="Players" value={data.players.length} />
        <StatCard label="Tournaments" value={data.tournaments.length} />
        <StatCard label="Recorded matches" value={data.tournaments.reduce((total, tournament) => total + tournament.matchCount, 0)} />
      </section>

      <div className="content-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Leaderboard</h2>
            <span>Top {topPlayers.length}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Elo</th>
                  <th>Glicko</th>
                  <th>W/D/L</th>
                </tr>
              </thead>
              <tbody>
                {topPlayers.map((player) => (
                  <tr key={player.id}>
                    <td>{player.displayName}</td>
                    <td>{formatRating(player.elo)}</td>
                    <td>{formatRating(player.glickoRating)}</td>
                    <td>
                      {player.wins}/{player.draws}/{player.losses}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>Recent tournaments</h2>
            <span>{data.tournaments.length} total</span>
          </div>
          <div className="tournament-list">
            {recentTournaments.map((tournament) => (
              <Link to={`/tournaments/${tournament.id}`} key={tournament.id} className="tournament-card">
                <div>
                  <h3>{tournament.name}</h3>
                  <p>{formatDate(tournament.startsOn)}</p>
                </div>
                <div className="tournament-meta">
                  <span>{tournament.status}</span>
                  <span>{tournament.playerCount} players</span>
                  <span>{tournament.matchCount} matches</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

function StatusCard({ title, message, tone }: { title: string; message: string; tone: "loading" | "error" }) {
  return (
    <section className="status-panel" aria-labelledby="app-title">
      <p className="eyebrow">Chess Club Manager</p>
      <h1 id="app-title">{title}</h1>
      <div className={`health-card health-card--${tone}`}>
        <span className="health-dot" aria-hidden="true" />
        <p>{message}</p>
      </div>
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <article className="stat-card">
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

function formatRating(value: number): string {
  return value.toFixed(1);
}

function formatDate(value: string | null): string {
  if (!value) return "N/A";
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return "N/A";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

type TournamentDetailState =
  | { status: "loading" }
  | { status: "ok"; data: TournamentDetail }
  | { status: "error"; message: string };

type TournamentDetail = {
  tournament: Tournament;
  matches: Match[];
  standings: Standing[];
};

type Match = {
  id: string;
  whitePlayerId: string;
  whitePlayerName: string;
  blackPlayerId: string;
  blackPlayerName: string;
  result: string;
  playedOn: string;
  boardNumber: number | null;
};

type Standing = {
  playerId: string;
  playerName: string;
  wins: number;
  draws: number;
  losses: number;
  points: number;
};

function TournamentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<TournamentDetailState>({ status: "loading" });

  useEffect(() => {
    if (!id) {
      setState({ status: "error", message: "No tournament ID provided" });
      return;
    }

    const controller = new AbortController();

    loadTournamentDetail(id, controller.signal)
      .then((data) => {
        setState({ status: "ok", data });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Unable to load tournament"
        });
      });

    return () => controller.abort();
  }, [id]);

  return (
    <section className="dashboard" aria-labelledby="tournament-title">
      <header className="hero">
        <p className="eyebrow">Chess Club Manager</p>
        <button onClick={() => navigate(-1)} className="back-button">← Back</button>
        {state.status === "loading" && <h1 id="tournament-title">Loading tournament...</h1>}
        {state.status === "error" && <h1 id="tournament-title">Error: {state.message}</h1>}
        {state.status === "ok" && <h1 id="tournament-title">{state.data.tournament.name}</h1>}
      </header>

      {state.status === "ok" && (
        <>
          <section className="stats-grid" aria-label="Tournament summary">
            <StatCard label="Status" value={state.data.tournament.status} />
            <StatCard label="Players" value={state.data.tournament.playerCount} />
            <StatCard label="Matches" value={state.data.tournament.matchCount} />
            <StatCard label="Start date" value={formatDate(state.data.tournament.startsOn)} />
          </section>

          <div className="content-grid">
            <section className="panel">
              <div className="panel-heading">
                <h2>Standings</h2>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>W</th>
                      <th>D</th>
                      <th>L</th>
                      <th>Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.standings.map((standing) => (
                      <tr key={standing.playerId}>
                        <td>{standing.playerName}</td>
                        <td>{standing.wins}</td>
                        <td>{standing.draws}</td>
                        <td>{standing.losses}</td>
                        <td>{standing.points.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <h2>Matches</h2>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Board</th>
                      <th>White</th>
                      <th>Black</th>
                      <th>Result</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.matches.map((match) => (
                      <tr key={match.id}>
                        <td>{match.boardNumber ?? "-"}</td>
                        <td>{match.whitePlayerName}</td>
                        <td>{match.blackPlayerName}</td>
                        <td>{match.result}</td>
                        <td>{formatDate(match.playedOn)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}
    </section>
  );
}

async function loadTournamentDetail(tournamentId: string, signal: AbortSignal): Promise<TournamentDetail> {
  const response = await fetch(`${apiBaseUrl}/tournaments/${tournamentId}`, { signal });
  if (!response.ok) {
    throw new Error(`API responded with ${response.status} for tournament ${tournamentId}`);
  }
  return response.json() as Promise<TournamentDetail>;
}
