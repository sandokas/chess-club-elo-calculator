import { useEffect, useState } from "react";
import { Routes, Route, Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Header } from "./components/layout/header.js";
import { SkipLink } from "./components/ui/skip-link.js";
import { StatusCard } from "./components/shared/status-card.js";
import { StatCard } from "./components/shared/stat-card.js";
import { BackButton } from "./components/shared/back-button.js";
import { AdminOverviewSkeleton } from "./components/dashboard/admin-overview-skeleton.js";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table.js";
import { Badge } from "./components/ui/badge.js";
import { Switch } from "./components/ui/switch.js";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./components/ui/collapsible.js";

type LoadState =
  | { status: "loading" }
  | { status: "ok"; data: AdminData }
  | { status: "error"; message: string };

type PlayersListState =
  | { status: "loading" }
  | { status: "ok"; data: PlayersListData }
  | { status: "error"; message: string };

type PlayersListData = {
  players: Player[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

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
  active: boolean;
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
    <div className="min-h-screen bg-background">
      <SkipLink />
      <Header />
      <main id="main-content" className="container mx-auto p-4 sm:p-6" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<AdminOverviewPage />} />
          <Route path="/players" element={<PlayersListPage />} />
          <Route path="/tournaments/:id" element={<TournamentDetailPage />} />
          <Route path="/players/:id" element={<PlayerDetailPage />} />
        </Routes>
      </main>
    </div>
  );
}

function AdminOverviewPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [activeOnly, setActiveOnly] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    loadAdminData(controller.signal, activeOnly)
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
  }, [activeOnly]);

  return (
    <>
      {state.status === "loading" && <AdminOverviewSkeleton />}
      {state.status === "error" && <StatusCard title="Unable to load club data" message={state.message} tone="error" />}
      {state.status === "ok" && <AdminOverview data={state.data} activeOnly={activeOnly} onActiveOnlyChange={setActiveOnly} />}
    </>
  );
}

function PlayersListPage() {
  const [state, setState] = useState<PlayersListState>({ status: "loading" });
  const [searchParams, setSearchParams] = useSearchParams();

  // Get values from URL params or use defaults
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || "20", 10);
  const sortBy = searchParams.get("sortBy") || "elo";
  const sortOrder = (searchParams.get("sortOrder") === "asc" || searchParams.get("sortOrder") === "desc") ? searchParams.get("sortOrder") as "asc" | "desc" : "desc";

  // Filter params
  const name = searchParams.get("name") || "";
  const active = searchParams.get("active") || "";
  const eloMin = searchParams.get("eloMin") || "";
  const eloMax = searchParams.get("eloMax") || "";
  const glickoMin = searchParams.get("glickoMin") || "";
  const glickoMax = searchParams.get("glickoMax") || "";
  const gamesPlayedMin = searchParams.get("gamesPlayedMin") || "";
  const gamesPlayedMax = searchParams.get("gamesPlayedMax") || "";
  const lastGameDateAfter = searchParams.get("lastGameDateAfter") || "";
  const lastGameDateBefore = searchParams.get("lastGameDateBefore") || "";

  useEffect(() => {
    const controller = new AbortController();

    loadPlayersList(controller.signal, page, limit, sortBy, sortOrder, name, active, eloMin, eloMax, glickoMin, glickoMax, gamesPlayedMin, gamesPlayedMax, lastGameDateAfter, lastGameDateBefore)
      .then((data) => {
        setState({ status: "ok", data });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Unable to load players"
        });
      });

    return () => controller.abort();
  }, [page, limit, sortBy, sortOrder, name, active, eloMin, eloMax, glickoMin, glickoMax, gamesPlayedMin, gamesPlayedMax, lastGameDateAfter, lastGameDateBefore]);

  const handleSort = (column: string) => {
    const newSortOrder = sortBy === column ? (sortOrder === "asc" ? "desc" : "asc") : "desc";
    setSearchParams({ page: "1", sortBy: column, sortOrder: newSortOrder, limit: limit.toString(), name, active, eloMin, eloMax, glickoMin, glickoMax, gamesPlayedMin, gamesPlayedMax, lastGameDateAfter, lastGameDateBefore });
  };

  const handlePageChange = (newPage: number) => {
    setSearchParams({ page: newPage.toString(), sortBy, sortOrder, limit: limit.toString(), name, active, eloMin, eloMax, glickoMin, glickoMax, gamesPlayedMin, gamesPlayedMax, lastGameDateAfter, lastGameDateBefore });
  };

  const handleLimitChange = (newLimit: number) => {
    setSearchParams({ page: "1", sortBy, sortOrder, limit: newLimit.toString(), name, active, eloMin, eloMax, glickoMin, glickoMax, gamesPlayedMin, gamesPlayedMax, lastGameDateAfter, lastGameDateBefore });
  };

  const handleFilterChange = (key: string, value: string) => {
    setSearchParams({ page: "1", sortBy, sortOrder, limit: limit.toString(), name, active, eloMin, eloMax, glickoMin, glickoMax, gamesPlayedMin, gamesPlayedMax, lastGameDateAfter, lastGameDateBefore, [key]: value });
  };

  const clearFilters = () => {
    setSearchParams({ page: "1", sortBy, sortOrder, limit: limit.toString() });
  };

  const hasFilters = name || active || eloMin || eloMax || glickoMin || glickoMax || gamesPlayedMin || gamesPlayedMax || lastGameDateAfter || lastGameDateBefore;

  return (
    <section className="space-y-6 sm:space-y-8" aria-labelledby="players-title">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <p className="text-xs sm:text-sm font-semibold text-primary uppercase tracking-wider">Chess Club Manager</p>
          <BackButton />
        </div>
        <h1 id="players-title" className="text-2xl sm:text-3xl font-bold">All Players</h1>
      </header>

      {state.status === "loading" && <AdminOverviewSkeleton />}
      {state.status === "error" && <StatusCard title="Unable to load players" message={state.message} tone="error" />}
      {state.status === "ok" && (
        <>
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4" aria-label="Players summary">
            <StatCard label="Total players" value={state.data.pagination.total} />
            <StatCard label="Current page" value={state.data.pagination.page} />
            <StatCard label="Per page" value={state.data.pagination.limit} />
            <StatCard label="Total pages" value={state.data.pagination.totalPages} />
          </section>

          <Card>
            <Collapsible>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <CardTitle className="text-lg sm:text-xl">Players</CardTitle>
                  <div className="flex items-center gap-2">
                    <CollapsibleTrigger asChild>
                      <button className="text-xs sm:text-sm text-primary hover:underline">
                        Filters {hasFilters && "(active)"}
                      </button>
                    </CollapsibleTrigger>
                    {hasFilters && (
                      <button onClick={clearFilters} className="text-xs sm:text-sm text-muted-foreground hover:underline">
                        Clear all
                      </button>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-xs sm:text-sm text-muted-foreground">Show:</span>
                      {[10, 20, 50].map((l) => (
                        <button
                          key={l}
                          onClick={() => handleLimitChange(l)}
                          className={`text-xs sm:text-sm px-2 py-1 rounded ${limit === l ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CollapsibleContent className="px-6 pb-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-4 border-t">
                  <div className="space-y-2">
                    <label className="text-xs sm:text-sm font-medium">Name</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => handleFilterChange("name", e.target.value)}
                      placeholder="Search by name..."
                      className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs sm:text-sm font-medium">Status</label>
                    <select
                      value={active}
                      onChange={(e) => handleFilterChange("active", e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background"
                    >
                      <option value="">All</option>
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs sm:text-sm font-medium">Elo Range</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={eloMin}
                        onChange={(e) => handleFilterChange("eloMin", e.target.value)}
                        placeholder="Min"
                        className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background"
                      />
                      <input
                        type="number"
                        value={eloMax}
                        onChange={(e) => handleFilterChange("eloMax", e.target.value)}
                        placeholder="Max"
                        className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs sm:text-sm font-medium">Glicko Range</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={glickoMin}
                        onChange={(e) => handleFilterChange("glickoMin", e.target.value)}
                        placeholder="Min"
                        className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background"
                      />
                      <input
                        type="number"
                        value={glickoMax}
                        onChange={(e) => handleFilterChange("glickoMax", e.target.value)}
                        placeholder="Max"
                        className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs sm:text-sm font-medium">Games Played Range</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={gamesPlayedMin}
                        onChange={(e) => handleFilterChange("gamesPlayedMin", e.target.value)}
                        placeholder="Min"
                        className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background"
                      />
                      <input
                        type="number"
                        value={gamesPlayedMax}
                        onChange={(e) => handleFilterChange("gamesPlayedMax", e.target.value)}
                        placeholder="Max"
                        className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs sm:text-sm font-medium">Last Game Date Range</label>
                    <div className="flex gap-2">
                      <input
                        type="date"
                        value={lastGameDateAfter}
                        onChange={(e) => handleFilterChange("lastGameDateAfter", e.target.value)}
                        className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background"
                      />
                      <input
                        type="date"
                        value={lastGameDateBefore}
                        onChange={(e) => handleFilterChange("lastGameDateBefore", e.target.value)}
                        className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background"
                      />
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="cursor-pointer hover:bg-muted" onClick={() => handleSort("displayName")}>
                        Name {sortBy === "displayName" && (sortOrder === "asc" ? "↑" : "↓")}
                      </TableHead>
                      <TableHead className="hidden sm:table-cell cursor-pointer hover:bg-muted" onClick={() => handleSort("active")}>
                        Status {sortBy === "active" && (sortOrder === "asc" ? "↑" : "↓")}
                      </TableHead>
                      <TableHead className="hidden sm:table-cell cursor-pointer hover:bg-muted" onClick={() => handleSort("elo")}>
                        Elo {sortBy === "elo" && (sortOrder === "asc" ? "↑" : "↓")}
                      </TableHead>
                      <TableHead className="hidden sm:table-cell cursor-pointer hover:bg-muted" onClick={() => handleSort("glickoRating")}>
                        Glicko {sortBy === "glickoRating" && (sortOrder === "asc" ? "↑" : "↓")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted" onClick={() => handleSort("gamesPlayed")}>
                        Games {sortBy === "gamesPlayed" && (sortOrder === "asc" ? "↑" : "↓")}
                      </TableHead>
                      <TableHead className="hidden sm:table-cell cursor-pointer hover:bg-muted" onClick={() => handleSort("lastGameDate")}>
                        Last Game {sortBy === "lastGameDate" && (sortOrder === "asc" ? "↑" : "↓")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.data.players.map((player) => (
                      <TableRow key={player.id}>
                        <TableCell><Link to={`/players/${player.id}`} className="font-medium hover:underline text-sm sm:text-base">{player.displayName}</Link></TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <Badge variant={player.active ? "default" : "secondary"} className="text-xs">
                            {player.active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">{formatRating(player.elo)}</TableCell>
                        <TableCell className="hidden sm:table-cell">{formatRating(player.glickoRating)}</TableCell>
                        <TableCell>{player.gamesPlayed}</TableCell>
                        <TableCell className="hidden sm:table-cell">{formatDate(player.lastGameDate)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between mt-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handlePageChange(page - 1)}
                    disabled={page === 1}
                    className="px-3 py-1 text-sm rounded bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-muted-foreground">
                    Page {page} of {state.data.pagination.totalPages}
                  </span>
                  <button
                    onClick={() => handlePageChange(page + 1)}
                    disabled={page === state.data.pagination.totalPages}
                    className="px-3 py-1 text-sm rounded bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
                <span className="text-xs sm:text-sm text-muted-foreground">
                  Showing {((page - 1) * limit) + 1}-{Math.min(page * limit, state.data.pagination.total)} of {state.data.pagination.total}
                </span>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}

async function loadAdminData(signal: AbortSignal, activeOnly: boolean = true): Promise<AdminData> {
  const clubsPayload = await fetchJson<{ clubs: Club[] }>("/clubs", signal);
  const club = clubsPayload.clubs[0];
  if (!club) {
    throw new Error("No clubs found in the database.");
  }

  const [playersPayload, tournamentsPayload, leaderboardPayload] = await Promise.all([
    fetchJson<{ players: Player[] }>(`/clubs/${club.id}/players`, signal),
    fetchJson<{ tournaments: Tournament[] }>(`/clubs/${club.id}/tournaments`, signal),
    fetchJson<{ leaderboard: LeaderboardEntry[] }>(`/clubs/${club.id}/leaderboard?activeOnly=${activeOnly}`, signal)
  ]);

  return {
    club,
    players: playersPayload.players,
    tournaments: tournamentsPayload.tournaments,
    leaderboard: leaderboardPayload.leaderboard
  };
}

async function loadPlayersList(signal: AbortSignal, page: number, limit: number, sortBy: string, sortOrder: string, name: string, active: string, eloMin: string, eloMax: string, glickoMin: string, glickoMax: string, gamesPlayedMin: string, gamesPlayedMax: string, lastGameDateAfter: string, lastGameDateBefore: string): Promise<PlayersListData> {
  const clubsPayload = await fetchJson<{ clubs: Club[] }>("/clubs", signal);
  const club = clubsPayload.clubs[0];
  if (!club) {
    throw new Error("No clubs found in the database.");
  }

  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
    sortBy,
    sortOrder
  });

  if (name) params.append("name", name);
  if (active) params.append("active", active);
  if (eloMin) params.append("eloMin", eloMin);
  if (eloMax) params.append("eloMax", eloMax);
  if (glickoMin) params.append("glickoMin", glickoMin);
  if (glickoMax) params.append("glickoMax", glickoMax);
  if (gamesPlayedMin) params.append("gamesPlayedMin", gamesPlayedMin);
  if (gamesPlayedMax) params.append("gamesPlayedMax", gamesPlayedMax);
  if (lastGameDateAfter) params.append("lastGameDateAfter", lastGameDateAfter);
  if (lastGameDateBefore) params.append("lastGameDateBefore", lastGameDateBefore);

  const result = await fetchJson<PlayersListData>(
    `/clubs/${club.id}/players?${params.toString()}`,
    signal
  );

  return result;
}

async function fetchJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, { signal });
  if (!response.ok) {
    throw new Error(`API responded with ${response.status} for ${path}`);
  }
  return response.json() as Promise<T>;
}

function AdminOverview({ data, activeOnly, onActiveOnlyChange }: { data: AdminData; activeOnly: boolean; onActiveOnlyChange: (value: boolean) => void }) {
  const topPlayers = data.leaderboard.slice(0, 10);
  const recentTournaments = data.tournaments.slice(0, 6);

  return (
    <section className="space-y-6 sm:space-y-8" aria-labelledby="app-title">
      <header>
        <p className="text-xs sm:text-sm font-semibold text-primary mb-2 uppercase tracking-wider">Chess Club Manager</p>
        <h1 id="app-title" className="text-2xl sm:text-3xl md:text-4xl font-bold">{data.club.name}</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm sm:text-base">
          Imported club data is now available through the Node API. This admin overview is the first step toward replacing the Python CLI workflows.
        </p>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4" aria-label="Club summary">
        <StatCard label="Players" value={data.players.length} />
        <StatCard label="Tournaments" value={data.tournaments.length} />
        <StatCard label="Recorded matches" value={data.tournaments.reduce((total, tournament) => total + tournament.matchCount, 0)} />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <CardTitle className="text-lg sm:text-xl">Leaderboard</CardTitle>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Switch
                    id="active-only-toggle"
                    checked={activeOnly}
                    onCheckedChange={onActiveOnlyChange}
                  />
                  <label htmlFor="active-only-toggle" className="text-xs sm:text-sm text-muted-foreground cursor-pointer">
                    Active only
                  </label>
                </div>
                <span className="text-xs sm:text-sm text-muted-foreground">Top {topPlayers.length}</span>
                <Link to="/players" className="text-xs sm:text-sm text-primary hover:underline">
                  View all
                </Link>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player</TableHead>
                    <TableHead className="hidden sm:table-cell">Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Elo</TableHead>
                    <TableHead>Glicko</TableHead>
                    <TableHead className="hidden sm:table-cell">W/D/L</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topPlayers.map((player) => (
                    <TableRow key={player.id}>
                      <TableCell><Link to={`/players/${player.id}`} className="font-medium hover:underline text-sm sm:text-base">{player.displayName}</Link></TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant={player.active ? "default" : "secondary"} className="text-xs">
                          {player.active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{formatRating(player.elo)}</TableCell>
                      <TableCell>{formatRating(player.glickoRating)}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {player.wins}/{player.draws}/{player.losses}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <CardTitle className="text-lg sm:text-xl">Recent tournaments</CardTitle>
              <span className="text-xs sm:text-sm text-muted-foreground">{data.tournaments.length} total</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentTournaments.map((tournament) => (
                <Link to={`/tournaments/${tournament.id}`} key={tournament.id} className="block">
                  <Card className="hover:bg-accent transition-colors">
                    <CardContent className="p-3 sm:p-4">
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
                        <div className="flex-1">
                          <h3 className="font-semibold text-sm sm:text-base">{tournament.name}</h3>
                          <p className="text-xs sm:text-sm text-muted-foreground">{formatDate(tournament.startsOn)}</p>
                        </div>
                        <div className="flex flex-row sm:flex-col items-end sm:items-end gap-2 sm:gap-1 text-xs sm:text-sm">
                          <Badge variant="outline" className="text-xs">{tournament.status}</Badge>
                          <span className="text-muted-foreground whitespace-nowrap">{tournament.playerCount} players</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
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
  result: number | null;
  playedOn: string;
  boardNumber: number | null;
  roundNumber: number | null;
};

type Standing = {
  playerId: string;
  playerName: string;
  wins: number;
  draws: number;
  losses: number;
  points: number;
};

type PlayerDetail = {
  player: {
    id: string;
    displayName: string;
    active: boolean;
    legacyId: number | null;
    createdAt: string;
    clubId: string;
    clubName: string;
    elo: number;
    glickoRating: number;
    glickoRd: number;
    glickoVol: number;
    gamesPlayed: number;
    lastGameDate: string | null;
  };
  matches: PlayerMatch[];
};

type PlayerMatch = {
  id: string;
  whitePlayerId: string;
  whitePlayerName: string;
  blackPlayerId: string;
  blackPlayerName: string;
  result: number;
  playedOn: string;
  tournamentId: string;
  tournamentName: string;
  eloBefore: number | null;
  eloAfter: number | null;
  glickoRatingBefore: number | null;
  glickoRatingAfter: number | null;
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
    <section className="space-y-6 sm:space-y-8" aria-labelledby="tournament-title">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <p className="text-xs sm:text-sm font-semibold text-primary uppercase tracking-wider">Chess Club Manager</p>
          <BackButton />
        </div>
        {state.status === "loading" && <h1 id="tournament-title">Loading tournament...</h1>}
        {state.status === "error" && <h1 id="tournament-title">Error: {state.message}</h1>}
        {state.status === "ok" && <h1 id="tournament-title" className="text-2xl sm:text-3xl font-bold">{state.data.tournament.name}</h1>}
      </header>

      {state.status === "ok" && (
        <>
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4" aria-label="Tournament summary">
            <StatCard label="Status" value={state.data.tournament.status} />
            <StatCard label="Players" value={state.data.tournament.playerCount} />
            <StatCard label="Matches" value={state.data.tournament.matchCount} />
            <StatCard label="Start date" value={formatDate(state.data.tournament.startsOn)} />
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg sm:text-xl">Standings</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Player</TableHead>
                        <TableHead className="hidden sm:table-cell">W</TableHead>
                        <TableHead className="hidden sm:table-cell">D</TableHead>
                        <TableHead className="hidden sm:table-cell">L</TableHead>
                        <TableHead>Points</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {state.data.standings.map((standing) => (
                        <TableRow key={standing.playerId}>
                          <TableCell><Link to={`/players/${standing.playerId}`} className="font-medium hover:underline text-sm sm:text-base">{standing.playerName}</Link></TableCell>
                          <TableCell className="hidden sm:table-cell">{standing.wins}</TableCell>
                          <TableCell className="hidden sm:table-cell">{standing.draws}</TableCell>
                          <TableCell className="hidden sm:table-cell">{standing.losses}</TableCell>
                          <TableCell>{standing.points.toFixed(1)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg sm:text-xl">Matches</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Round</TableHead>
                        {state.data.tournament.status === "active" && <TableHead>Board</TableHead>}
                        <TableHead className="hidden sm:table-cell">White</TableHead>
                        <TableHead className="hidden sm:table-cell">Black</TableHead>
                        <TableHead>Result</TableHead>
                        <TableHead className="hidden sm:table-cell">Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {state.data.matches.map((match) => (
                        <TableRow key={match.id}>
                          <TableCell>{match.roundNumber ?? "—"}</TableCell>
                          {state.data.tournament.status === "active" && <TableCell>{match.boardNumber ?? "-"}</TableCell>}
                          <TableCell className="hidden sm:table-cell">{renderPlayerOutcome("white", match.result, match.whitePlayerId, match.whitePlayerName)}</TableCell>
                          <TableCell className="hidden sm:table-cell">{renderPlayerOutcome("black", match.result, match.blackPlayerId, match.blackPlayerName)}</TableCell>
                          <TableCell>{formatCompactResult(match.result)}</TableCell>
                          <TableCell className="hidden sm:table-cell">{formatDate(match.playedOn)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
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

type PlayerDetailState =
  | { status: "loading" }
  | { status: "ok"; data: PlayerDetail }
  | { status: "error"; message: string };

function PlayerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<PlayerDetailState>({ status: "loading" });

  useEffect(() => {
    if (!id) {
      setState({ status: "error", message: "No player ID provided" });
      return;
    }

    const controller = new AbortController();

    loadPlayerDetail(id, controller.signal)
      .then((data) => {
        setState({ status: "ok", data });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Unable to load player"
        });
      });

    return () => controller.abort();
  }, [id]);

  return (
    <section className="space-y-6 sm:space-y-8" aria-labelledby="player-title">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <p className="text-xs sm:text-sm font-semibold text-primary uppercase tracking-wider">Chess Club Manager</p>
          <BackButton />
        </div>
        {state.status === "loading" && <h1 id="player-title">Loading player...</h1>}
        {state.status === "error" && <h1 id="player-title">Error: {state.message}</h1>}
        {state.status === "ok" && <h1 id="player-title" className="text-2xl sm:text-3xl font-bold">{state.data.player.displayName}</h1>}
      </header>

      {state.status === "ok" && (
        <>
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4" aria-label="Player summary">
            <StatCard label="Club" value={state.data.player.clubName} />
            <StatCard label="Status" value={state.data.player.active ? "Active" : "Inactive"} />
            <StatCard label="Games played" value={state.data.player.gamesPlayed} />
            <StatCard label="Last game" value={formatDate(state.data.player.lastGameDate)} />
          </section>

          <section className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4" aria-label="Current ratings">
            <StatCard label="Elo" value={formatRating(state.data.player.elo)} />
            <StatCard label="Glicko Rating" value={formatRating(state.data.player.glickoRating)} />
            <StatCard label="Glicko RD" value={formatRating(state.data.player.glickoRd)} />
            <StatCard label="Glicko Vol" value={formatRating(state.data.player.glickoVol)} />
          </section>

          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <CardTitle className="text-lg sm:text-xl">Recent matches</CardTitle>
                <span className="text-xs sm:text-sm text-muted-foreground">Last {state.data.matches.length}</span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="hidden md:table-cell">Tournament</TableHead>
                      <TableHead>Opponent</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead className="hidden sm:table-cell">Elo change</TableHead>
                      <TableHead className="hidden sm:table-cell">Glicko change</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.data.matches.map((match) => {
                      const isWhite = match.whitePlayerId === state.data.player.id;
                      const opponentName = isWhite ? match.blackPlayerName : match.whitePlayerName;
                      const result = isWhite ? match.result : 1 - match.result;
                      const eloChange = match.eloBefore && match.eloAfter ? match.eloAfter - match.eloBefore : null;
                      const glickoChange = match.glickoRatingBefore && match.glickoRatingAfter ? match.glickoRatingAfter - match.glickoRatingBefore : null;
                      
                      return (
                        <TableRow key={match.id}>
                          <TableCell className="text-xs sm:text-sm">{formatDate(match.playedOn)}</TableCell>
                          <TableCell className="hidden md:table-cell text-xs sm:text-sm">{match.tournamentName}</TableCell>
                          <TableCell className="text-xs sm:text-sm">{opponentName}</TableCell>
                          <TableCell className="text-xs sm:text-sm">{formatResultWithIcon(result, isWhite)}</TableCell>
                          <TableCell className="hidden sm:table-cell text-xs sm:text-sm">{eloChange !== null ? (eloChange > 0 ? `+${eloChange.toFixed(1)}` : eloChange.toFixed(1)) : "N/A"}</TableCell>
                          <TableCell className="hidden sm:table-cell text-xs sm:text-sm">{glickoChange !== null ? (glickoChange > 0 ? `+${glickoChange.toFixed(1)}` : glickoChange.toFixed(1)) : "N/A"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}

function formatResult(result: number, isWhite: boolean): string {
  if (result === 1) return "Win";
  if (result === 0) return "Loss";
  if (result === 0.5) return "Draw";
  return "N/A";
}

function formatResultWithIcon(result: number, isWhite: boolean) {
  return formatResult(result, isWhite);
}

function renderPlayerOutcome(side: "white" | "black", result: number | null, playerId: string, playerName: string) {
  return (
    <Link to={`/players/${playerId}`} className="font-medium hover:underline">{playerName}</Link>
  );
}

function formatCompactResult(result: number | null): string {
  if (result === null) return "—";
  if (result === 1) return "1–0";
  if (result === 0) return "0–1";
  if (result === 0.5) return "½–½";
  return "—";
}

async function loadPlayerDetail(playerId: string, signal: AbortSignal): Promise<PlayerDetail> {
  const response = await fetch(`${apiBaseUrl}/players/${playerId}`, { signal });
  if (!response.ok) {
    throw new Error(`API responded with ${response.status} for player ${playerId}`);
  }
  return response.json() as Promise<PlayerDetail>;
}
