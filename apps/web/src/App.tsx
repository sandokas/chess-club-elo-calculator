import { useEffect, useState } from "react";
import { Routes, Route, Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Header } from "./components/layout/header.js";
import { SkipLink } from "./components/ui/skip-link.js";
import { StatusCard } from "./components/shared/status-card.js";
import { StatCard } from "./components/shared/stat-card.js";
import { BackButton } from "./components/shared/back-button.js";
import { AdminOverviewSkeleton } from "./components/dashboard/admin-overview-skeleton.js";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./components/ui/card.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table.js";
import { Badge } from "./components/ui/badge.js";
import { Switch } from "./components/ui/switch.js";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./components/ui/collapsible.js";
import { Button } from "./components/ui/button.js";
import { Toaster } from "./components/ui/toaster.js";
import { useToast } from "./hooks/use-toast";
import { EditTournamentDialog } from "./components/tournament/edit-tournament-dialog.js";
import { CreateTournamentDialog } from "./components/tournament/create-tournament-dialog.js";
import { TournamentRosterManager } from "./components/tournament/tournament-roster-manager.js";
import { GenerateRoundDialog } from "./components/tournament/generate-round-dialog.js";
import { EditRoundStartDialog } from "./components/tournament/edit-round-start-dialog.js";
import { EditPlayerDialog } from "./components/player/edit-player-dialog.js";
import { EditClubDialog } from "./components/club/edit-club-dialog.js";
import { CreateClubDialog } from "./components/club/create-club-dialog.js";
import { RecomputeRatingsDialog } from "./components/club/recompute-ratings-dialog.js";
import { Pencil, Plus, Settings, RefreshCw, Play, Trash, Trophy, List } from "lucide-react";
import { PlayersListPage } from "./pages/players-list.js";
import { PlayerDetailPage } from "./pages/player-detail.js";
import { formatRating, formatDate, formatCompactResult } from "./lib/formatters.js";
import { useClub } from "./contexts/club-context.js";

type LoadState =
  | { status: "loading" }
  | { status: "ok"; data: AdminData }
  | { status: "error"; message: string };

type TournamentsListState =
  | { status: "loading" }
  | { status: "ok"; data: TournamentsListData }
  | { status: "error"; message: string };

type TournamentsListData = {
  tournaments: Tournament[];
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
  totalTournaments: number;
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
          <Route path="/tournaments" element={<TournamentsListPage />} />
          <Route path="/tournaments/:id" element={<TournamentDetailPage />} />
          <Route path="/players/:id" element={<PlayerDetailPage />} />
        </Routes>
      </main>
      <Toaster />
    </div>
  );
}

function AdminOverviewPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [activeOnly, setActiveOnly] = useState(true);
  const { club, isLoading: clubLoading, error: clubError } = useClub();

  useEffect(() => {
    if (clubLoading || !club) return;
    if (clubError) {
      setState({ status: "error", message: clubError });
      return;
    }

    const controller = new AbortController();

    loadAdminData(controller.signal, activeOnly, club)
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
  }, [activeOnly, club, clubLoading, clubError]);

  return (
    <>
      {state.status === "loading" && <AdminOverviewSkeleton />}
      {state.status === "error" && <StatusCard title="Unable to load club data" message={state.message} tone="error" />}
      {state.status === "ok" && <AdminOverview data={state.data} activeOnly={activeOnly} onActiveOnlyChange={setActiveOnly} />}
    </>
  );
}

function TournamentsListPage() {
  const [state, setState] = useState<TournamentsListState>({ status: "loading" });
  const [searchParams, setSearchParams] = useSearchParams();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const { club, isLoading: clubLoading, error: clubError } = useClub();

  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || "20", 10);
  const sortBy = searchParams.get("sortBy") || "startsOn";
  const sortOrder = (searchParams.get("sortOrder") === "asc" || searchParams.get("sortOrder") === "desc") ? searchParams.get("sortOrder") as "asc" | "desc" : "desc";

  const name = searchParams.get("name") || "";
  const status = searchParams.get("status") || "";

  useEffect(() => {
    if (clubLoading || !club) return;
    if (clubError) {
      setState({ status: "error", message: clubError });
      return;
    }

    const controller = new AbortController();

    loadTournamentsList(controller.signal, page, limit, sortBy, sortOrder, name, status, club)
      .then((data) => {
        setState({ status: "ok", data });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        if (error instanceof Error && error.message === "Page exceeds total pages") {
          // Redirect to first page
          setSearchParams({ page: "1", sortBy, sortOrder, limit: limit.toString(), name, status });
          return;
        }
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Unable to load tournaments"
        });
      });

    return () => controller.abort();
  }, [page, limit, sortBy, sortOrder, name, status, club, clubLoading, clubError]);

  const handleSort = (column: string) => {
    const newSortOrder = sortBy === column ? (sortOrder === "asc" ? "desc" : "asc") : "desc";
    setSearchParams({ page: "1", sortBy: column, sortOrder: newSortOrder, limit: limit.toString(), name, status });
  };

  const handlePageChange = (newPage: number) => {
    setSearchParams({ page: newPage.toString(), sortBy, sortOrder, limit: limit.toString(), name, status });
  };

  const handleLimitChange = (newLimit: number) => {
    setSearchParams({ page: "1", sortBy, sortOrder, limit: newLimit.toString(), name, status });
  };

  const handleFilterChange = (key: string, value: string) => {
    setSearchParams({ page: "1", sortBy, sortOrder, limit: limit.toString(), name, status, [key]: value });
  };

  const clearFilters = () => {
    setSearchParams({ page: "1", sortBy, sortOrder, limit: limit.toString() });
  };

  const hasFilters = name || status;

  return (
    <section className="space-y-6 sm:space-y-8" aria-labelledby="tournaments-title">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <p className="text-xs sm:text-sm font-semibold text-primary uppercase tracking-wider">Chess Club Manager</p>
          <BackButton />
        </div>
        <div className="flex items-center gap-2">
          <h1 id="tournaments-title" className="text-2xl sm:text-3xl font-bold">All Tournaments</h1>
          {club && (
            <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create
            </Button>
          )}
        </div>
      </header>

      {state.status === "loading" && <AdminOverviewSkeleton />}
      {state.status === "error" && <StatusCard title="Unable to load tournaments" message={state.message} tone="error" />}
      {state.status === "ok" && (
        <>
          {state.data.pagination.total === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <p className="text-muted-foreground text-lg mb-4">No tournaments yet</p>
                {club && (
                  <Button onClick={() => setCreateDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create your first tournament
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              <section className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4" aria-label="Tournaments summary">
                <StatCard label="Total tournaments" value={state.data.pagination.total} />
                <StatCard label="Current page" value={state.data.pagination.page} />
                <StatCard label="Per page" value={state.data.pagination.limit} />
                <StatCard label="Total pages" value={state.data.pagination.totalPages} />
              </section>

          <Card>
            <Collapsible>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <CardTitle className="text-lg sm:text-xl">Tournaments</CardTitle>
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t">
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
                      value={status}
                      onChange={(e) => handleFilterChange("status", e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background"
                    >
                      <option value="">All</option>
                      <option value="draft">Draft</option>
                      <option value="active">Active</option>
                      <option value="completed">Completed</option>
                    </select>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="cursor-pointer hover:bg-muted" onClick={() => handleSort("name")}>
                        Name {sortBy === "name" && (sortOrder === "asc" ? "↑" : "↓")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted" onClick={() => handleSort("status")}>
                        Status {sortBy === "status" && (sortOrder === "asc" ? "↑" : "↓")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted" onClick={() => handleSort("startsOn")}>
                        Start Date {sortBy === "startsOn" && (sortOrder === "asc" ? "↑" : "↓")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted" onClick={() => handleSort("playerCount")}>
                        Players {sortBy === "playerCount" && (sortOrder === "asc" ? "↑" : "↓")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted" onClick={() => handleSort("matchCount")}>
                        Matches {sortBy === "matchCount" && (sortOrder === "asc" ? "↑" : "↓")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.data.tournaments.map((tournament) => (
                      <TableRow key={tournament.id}>
                        <TableCell><Link to={`/tournaments/${tournament.id}`} className="font-medium hover:underline text-sm sm:text-base">{tournament.name}</Link></TableCell>
                        <TableCell>
                          <Badge variant={tournament.status === 'active' ? 'default' : tournament.status === 'completed' ? 'secondary' : 'outline'} className="text-xs">
                            {tournament.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs sm:text-sm">{formatDate(tournament.startsOn)}</TableCell>
                        <TableCell>{tournament.playerCount}</TableCell>
                        <TableCell>{tournament.matchCount}</TableCell>
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
        </>
      )}
      {club && (
        <CreateTournamentDialog
          clubId={club.id}
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          onCreated={(tournamentId) => {
            // Navigate to tournament detail page
            window.location.href = `/tournaments/${tournamentId}`;
          }}
        />
      )}
    </section>
  );
}

async function loadAdminData(signal: AbortSignal, activeOnly: boolean = true, club?: Club): Promise<AdminData> {
  if (!club) {
    const clubsPayload = await fetchJson<{ clubs: Club[] }>("/clubs", signal);
    club = clubsPayload.clubs[0];
    if (!club) {
      throw new Error("No clubs found in the database.");
    }
  }

  const [playersPayload, tournamentsPayload, leaderboardPayload, tournamentsCountPayload] = await Promise.all([
    fetchJson<{ players: Player[] }>(`/clubs/${club.id}/players`, signal),
    fetchJson<{ tournaments: Tournament[] }>(`/clubs/${club.id}/tournaments?limit=6`, signal),
    fetchJson<{ leaderboard: LeaderboardEntry[] }>(`/clubs/${club.id}/leaderboard?activeOnly=${activeOnly}&limit=10`, signal),
    fetchJson<{ pagination: { total: number } }>(`/clubs/${club.id}/tournaments?limit=1`, signal)
  ]);

  return {
    club,
    players: playersPayload.players,
    tournaments: tournamentsPayload.tournaments,
    totalTournaments: tournamentsCountPayload.pagination.total,
    leaderboard: leaderboardPayload.leaderboard
  };
}


async function loadTournamentsList(signal: AbortSignal, page: number, limit: number, sortBy: string, sortOrder: string, name: string, status: string, club?: Club): Promise<TournamentsListData> {
  if (!club) {
    const clubsPayload = await fetchJson<{ clubs: Club[] }>("/clubs", signal);
    club = clubsPayload.clubs[0];
    if (!club) {
      throw new Error("No clubs found in the database.");
    }
  }

  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
    sortBy,
    sortOrder
  });

  if (name) params.append("name", name);
  if (status) params.append("status", status);

  const result = await fetchJson<TournamentsListData>(
    `/clubs/${club.id}/tournaments?${params.toString()}`,
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
  const { createClubDialogOpen, setCreateClubDialogOpen } = useClub();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editClubDialogOpen, setEditClubDialogOpen] = useState(false);
  const [recomputeRatingsDialogOpen, setRecomputeRatingsDialogOpen] = useState(false);

  return (
    <section className="space-y-6 sm:space-y-8" aria-labelledby="app-title">
      <header>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex-1">
            <p className="text-xs sm:text-sm font-semibold text-primary mb-2 uppercase tracking-wider">Chess Club Manager</p>
            <h1 id="app-title" className="text-2xl sm:text-3xl md:text-4xl font-bold">{data.club.name}</h1>
            {(data.club.description || (data.club.city && data.club.country)) && (
              <p className="text-muted-foreground mt-2 max-w-2xl text-sm sm:text-base">
                {data.club.description || `${data.club.city}, ${data.club.country}`}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditClubDialogOpen(true)}>
              <Settings className="h-4 w-4 mr-2" />
              Edit Club
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRecomputeRatingsDialogOpen(true)}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Recompute Ratings
            </Button>
          </div>
        </div>
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
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create
                </Button>
                <span className="text-xs sm:text-sm text-muted-foreground">{data.totalTournaments} total</span>
                <Link to="/tournaments" className="text-xs sm:text-sm text-primary hover:underline">
                  View all
                </Link>
              </div>
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
      <CreateTournamentDialog
        clubId={data.club.id}
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={(tournamentId) => {
          window.location.href = `/tournaments/${tournamentId}`;
        }}
      />
      <EditClubDialog
        clubId={data.club.id}
        open={editClubDialogOpen}
        onOpenChange={setEditClubDialogOpen}
        currentClub={{
          name: data.club.name,
          description: data.club.description,
          city: data.club.city,
          country: data.club.country,
        }}
        onUpdated={() => {
          window.location.reload();
        }}
      />
      <RecomputeRatingsDialog
        clubId={data.club.id}
        open={recomputeRatingsDialogOpen}
        onOpenChange={setRecomputeRatingsDialogOpen}
        onRecomputed={() => {
          // Data will be refreshed when user closes dialog
        }}
      />
      <CreateClubDialog
        open={createClubDialogOpen}
        onOpenChange={setCreateClubDialogOpen}
      />
    </section>
  );
}



type TournamentDetailState =
  | { status: "loading" }
  | { status: "ok"; data: TournamentDetail }
  | { status: "error"; message: string };

type TournamentDetail = {
  tournament: {
    id: string;
    name: string;
    startsOn: string | null;
    format: string;
    status: string;
    playerCount: number;
    matchCount: number;
    pairingMethod?: string;
    totalRounds?: number;
  };
  matches: Match[];
  standings: Standing[];
  tournamentPlayers: Array<{ playerId: string; displayName: string }>;
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
  roundStart?: string | null;
};

type Standing = {
  playerId: string;
  playerName: string;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  buchholz?: number;
  sonnebornBerger?: number;
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
  const { toast } = useToast();
  const [state, setState] = useState<TournamentDetailState>({ status: "loading" });
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [editRoundStartOpen, setEditRoundStartOpen] = useState(false);
  const [rounds, setRounds] = useState<any[]>([]);
  const [victoryView, setVictoryView] = useState<"victory" | "details">("victory");

  useEffect(() => {
    if (!id) {
      setState({ status: "error", message: "No tournament ID provided" });
      return;
    }

    const controller = new AbortController();

    loadTournamentDetail(id, controller.signal)
      .then((data) => {
        setState({ status: "ok", data });
        // Load rounds for status display
        fetch(`${apiBaseUrl}/tournaments/${id}/rounds`)
          .then(res => res.json())
          .then(roundsData => setRounds(roundsData.rounds || []))
          .catch(err => console.error("Failed to load rounds:", err));
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

  const handleSaved = () => {
    if (id) {
      const controller = new AbortController();
      loadTournamentDetail(id, controller.signal)
        .then((data) => {
          setState({ status: "ok", data });
          // Reload rounds
          fetch(`${apiBaseUrl}/tournaments/${id}/rounds`)
            .then(res => res.json())
            .then(roundsData => setRounds(roundsData.rounds || []))
            .catch(err => console.error("Failed to load rounds:", err));
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
    }
  };

  const handleMatchResultChange = async (matchId: string, value: string) => {
    try {
      const result = value === "" ? null : parseFloat(value);
      const response = await fetch(`${apiBaseUrl}/matches/${matchId}/result`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result }),
      });
      if (!response.ok) throw new Error("Failed to update match result");
      handleSaved();
    } catch (error) {
      console.error("Failed to update match result:", error);
    }
  };

  const handleDeleteRound = async (roundNumber: number) => {
    if (!confirm(`Are you sure you want to delete Round ${roundNumber}? This will delete all matches in the round.`)) return;
    try {
      if (state.status !== "ok" || !id) return;
      
      // Get round ID
      const response = await fetch(`${apiBaseUrl}/tournaments/${id}/rounds`);
      if (!response.ok) throw new Error("Failed to fetch rounds");
      const roundsData = await response.json();
      const round = roundsData.rounds.find((r: any) => r.number === roundNumber);
      if (!round) throw new Error("Round not found");

      const deleteResponse = await fetch(`${apiBaseUrl}/rounds/${round.id}`, {
        method: "DELETE",
      });
      if (!deleteResponse.ok) {
        const errorData = await deleteResponse.json().catch(() => ({ message: "Failed to delete round" }));
        throw new Error(errorData.message || "Failed to delete round");
      }
      
      // If no rounds remain, set tournament to draft
      if (roundsData.rounds.length === 1) {
        const updateResponse = await fetch(`${apiBaseUrl}/tournaments/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "draft" }),
        });
        if (!updateResponse.ok) throw new Error("Failed to update tournament status");
      }
      
      setSelectedRound(null);
      handleSaved();
    } catch (error) {
      console.error("Failed to delete round:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to delete round";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handleEditRoundStart = () => {
    setEditRoundStartOpen(true);
  };

  const handleFinalizeTournament = async () => {
    if (!confirm("Are you sure you want to finalize the tournament? This will set the tournament status to completed.")) return;
    try {
      if (state.status !== "ok" || !id) return;
      
      const response = await fetch(`${apiBaseUrl}/tournaments/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (!response.ok) throw new Error("Failed to update tournament status");
      handleSaved();
    } catch (error) {
      console.error("Failed to finalize tournament:", error);
      toast({
        title: "Error",
        description: "Failed to finalize tournament",
        variant: "destructive",
      });
    }
  };

  return (
    <section className="space-y-6 sm:space-y-8" aria-labelledby="tournament-title">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <p className="text-xs sm:text-sm font-semibold text-primary uppercase tracking-wider">Chess Club Manager</p>
          <BackButton />
        </div>
        <div className="flex items-center gap-2">
          {state.status === "loading" && <h1 id="tournament-title">Loading tournament...</h1>}
          {state.status === "error" && <h1 id="tournament-title">Error: {state.message}</h1>}
          {state.status === "ok" && <h1 id="tournament-title" className="text-2xl sm:text-3xl font-bold">{state.data.tournament.name}</h1>}
          {state.status === "ok" && (
            <Button variant="outline" size="sm" onClick={() => setEditDialogOpen(true)}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </Button>
          )}
        </div>
      </header>

      {state.status === "ok" && (
        <>
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4" aria-label="Tournament summary">
            <StatCard label="Status" value={state.data.tournament.status} />
            <StatCard label="Players" value={state.data.tournament.playerCount} />
            <StatCard label="Matches" value={state.data.tournament.matchCount} />
            <StatCard label="Start date" value={formatDate(state.data.tournament.startsOn)} />
          </section>

          {state.data.tournament.status === "draft" ? (
            <TournamentRosterManager
              tournament={state.data.tournament}
              onUpdated={handleSaved}
            />
          ) : state.data.tournament.status === "completed" ? (
            <div className="space-y-6 sm:space-y-8">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-2xl sm:text-3xl font-bold">Tournament Complete!</h2>
                <div className="flex items-center gap-2">
                  <Button
                    variant={victoryView === "victory" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setVictoryView("victory")}
                  >
                    <Trophy className="h-4 w-4 mr-2" />
                    Victory
                  </Button>
                  <Button
                    variant={victoryView === "details" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setVictoryView("details")}
                  >
                    <List className="h-4 w-4 mr-2" />
                    Details
                  </Button>
                </div>
              </div>

              {victoryView === "victory" ? (
                <>
                  <Card className="border-2 border-primary">
                    <CardHeader className="text-center">
                      <Trophy className="h-16 w-16 mx-auto mb-4 text-primary" />
                      <CardDescription className="text-lg">{state.data.tournament.name}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-4 mt-6 items-end">
                        {/* Podium order: 2nd (left, mid), 1st (center, top), 3rd (right, bottom) */}
                        {[2, 1, 3].map((rank) => {
                          const standing = state.data.standings[rank - 1];
                          if (!standing) return null;
                          const medals = ["🥇", "🥈", "🥉"];
                          const heightClass = rank === 1 ? "pt-8 pb-6" : rank === 2 ? "pt-6 pb-5" : "pt-4 pb-4";
                          const sizeClass = rank === 1 ? "text-6xl" : rank === 2 ? "text-5xl" : "text-4xl";
                          const ringClass = rank === 1 ? "ring-2 ring-primary" : "";
                          return (
                            <div key={standing.playerId} className={`text-center px-4 rounded-lg bg-muted ${heightClass} ${ringClass}`}>
                              <div className={`mb-2 ${sizeClass}`}>{medals[rank - 1]}</div>
                              <Link to={`/players/${standing.playerId}`} className="font-bold text-lg hover:underline">{standing.playerName}</Link>
                              <div className="text-2xl font-semibold mt-2">{standing.points.toFixed(1)}</div>
                              <div className="text-sm text-muted-foreground">points</div>
                              {standing.buchholz !== undefined && (
                                <div className="text-xs text-muted-foreground mt-1">Buchholz {standing.buchholz.toFixed(1)}</div>
                              )}
                              {standing.sonnebornBerger !== undefined && (
                                <div className="text-xs text-muted-foreground">S-B {standing.sonnebornBerger.toFixed(1)}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg sm:text-xl">Final Standings</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Rank</TableHead>
                              <TableHead>Player</TableHead>
                              <TableHead className="hidden sm:table-cell">W</TableHead>
                              <TableHead className="hidden sm:table-cell">D</TableHead>
                              <TableHead className="hidden sm:table-cell">L</TableHead>
                              <TableHead>Points</TableHead>
                              <TableHead title="Buchholz: sum of opponents' points">Buchholz</TableHead>
                              <TableHead className="hidden md:table-cell" title="Sonneborn-Berger: sum of opponents' points weighted by your result">S-B</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {state.data.standings.map((standing, index) => (
                              <TableRow key={standing.playerId}>
                                <TableCell>{index + 1}</TableCell>
                                <TableCell><Link to={`/players/${standing.playerId}`} className="font-medium hover:underline">{standing.playerName}</Link></TableCell>
                                <TableCell className="hidden sm:table-cell">{standing.wins}</TableCell>
                                <TableCell className="hidden sm:table-cell">{standing.draws}</TableCell>
                                <TableCell className="hidden sm:table-cell">{standing.losses}</TableCell>
                                <TableCell>{standing.points.toFixed(1)}</TableCell>
                                <TableCell className="text-muted-foreground">{standing.buchholz !== undefined ? standing.buchholz.toFixed(1) : "-"}</TableCell>
                                <TableCell className="hidden md:table-cell text-muted-foreground">{standing.sonnebornBerger !== undefined ? standing.sonnebornBerger.toFixed(1) : "-"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                </>
              ) : (
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
                                <TableHead className="hidden sm:table-cell" title="Buchholz: sum of opponents' points">Buchholz</TableHead>
                                <TableHead className="hidden md:table-cell" title="Sonneborn-Berger: sum of opponents' points weighted by your result">S-B</TableHead>
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
                                  <TableCell className="hidden sm:table-cell text-muted-foreground">{standing.buchholz !== undefined ? standing.buchholz.toFixed(1) : "-"}</TableCell>
                                  <TableCell className="hidden md:table-cell text-muted-foreground">{standing.sonnebornBerger !== undefined ? standing.sonnebornBerger.toFixed(1) : "-"}</TableCell>
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
                          <CardTitle className="text-lg sm:text-xl">Matches</CardTitle>
                          <div className="flex items-center gap-2">
                            {selectedRound !== null && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSelectedRound(null)}
                              >
                                Show All Rounds
                              </Button>
                            )}
                          </div>
                        </div>
                        {state.data.matches.length > 0 && (
                          <div className="space-y-2 mt-2">
                            <div className="flex flex-wrap gap-2">
                              {[...new Set(state.data.matches.map(m => m.roundNumber))].sort((a, b) => (a || 0) - (b || 0)).map(roundNum => (
                                <Button
                                  key={roundNum}
                                  variant={selectedRound === roundNum ? "default" : "outline"}
                                  size="sm"
                                  onClick={() => setSelectedRound(roundNum === selectedRound ? null : roundNum)}
                                >
                                  Round {roundNum}
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Round</TableHead>
                                <TableHead className="hidden sm:table-cell">White</TableHead>
                                <TableHead className="hidden sm:table-cell">Black</TableHead>
                                <TableHead>Result</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(() => {
                                const matchesInRound = state.data.matches
                                  .filter(match => selectedRound === null || match.roundNumber === selectedRound);
                                
                                // Separate regular matches from bye matches
                                const regularMatches = matchesInRound.filter(m => m.blackPlayerId !== null);
                                const byeMatches = matchesInRound.filter(m => m.blackPlayerId === null);
                                
                                return [...regularMatches, ...byeMatches].map((match) => (
                                  <TableRow key={match.id}>
                                    <TableCell className="text-muted-foreground">R{match.roundNumber}</TableCell>
                                    <TableCell className="hidden sm:table-cell">
                                      <Link to={`/players/${match.whitePlayerId}`} className="font-medium hover:underline text-sm sm:text-base">{match.whitePlayerName}</Link>
                                    </TableCell>
                                    <TableCell className="hidden sm:table-cell">
                                      {match.blackPlayerId ? (
                                        <Link to={`/players/${match.blackPlayerId}`} className="font-medium hover:underline text-sm sm:text-base">{match.blackPlayerName}</Link>
                                      ) : (
                                        <span className="text-muted-foreground italic">Bye</span>
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      {match.result !== null ? (
                                        <Badge variant="outline" className="text-xs">
                                          {match.blackPlayerId === null ? "1-0 (bye)" : formatCompactResult(match.result)}
                                        </Badge>
                                      ) : (
                                        <Badge variant="outline" className="text-xs">Pending</Badge>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                ));
                              })()}
                            </TableBody>
                          </Table>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </>
              )}
            </div>
          ) : (
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
                          <TableHead className="hidden sm:table-cell" title="Buchholz: sum of opponents' points">Buchholz</TableHead>
                          <TableHead className="hidden md:table-cell" title="Sonneborn-Berger: sum of opponents' points weighted by your result">S-B</TableHead>
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
                            <TableCell className="hidden sm:table-cell text-muted-foreground">{standing.buchholz !== undefined ? standing.buchholz.toFixed(1) : "-"}</TableCell>
                            <TableCell className="hidden md:table-cell text-muted-foreground">{standing.sonnebornBerger !== undefined ? standing.sonnebornBerger.toFixed(1) : "-"}</TableCell>
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
                    <CardTitle className="text-lg sm:text-xl">Matches</CardTitle>
                    <div className="flex items-center gap-2">
                      {selectedRound !== null && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedRound(null)}
                        >
                          Show All Rounds
                        </Button>
                      )}
                      {selectedRound !== null && state.data.tournament.status === "active" && (() => {
                        const roundMatches = state.data.matches.filter((m: Match) => m.roundNumber === selectedRound);
                        const hasResults = roundMatches.some((m: Match) => m.result !== null && m.blackPlayerId !== null);
                        return !hasResults;
                      })() && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteRound(selectedRound)}
                        >
                          <Trash className="h-4 w-4 mr-2" />
                          Delete Round {selectedRound}
                        </Button>
                      )}
                      {(() => {
                        // Check if all matches have results
                        const allResultsIn = state.data.matches.every(m => m.result !== null);
                        // Check if there are more rounds to generate
                        const currentRoundCount = [...new Set(state.data.matches.map(m => m.roundNumber))].length;
                        const canGenerateMore = !state.data.tournament.totalRounds || currentRoundCount < state.data.tournament.totalRounds;
                        
                        if (state.data.tournament.status === "active" && allResultsIn) {
                          if (canGenerateMore) {
                            return (
                              <Button size="sm" onClick={() => setGenerateDialogOpen(true)}>
                                <Play className="h-4 w-4 mr-2" />
                                Generate Round
                              </Button>
                            );
                          } else {
                            return (
                              <Button size="sm" onClick={() => handleFinalizeTournament()}>
                                <Trophy className="h-4 w-4 mr-2" />
                                Finalize Tournament
                              </Button>
                            );
                          }
                        }
                        return null;
                      })()}
                    </div>
                  </div>
                  {state.data.matches.length > 0 && (
                    <div className="space-y-2 mt-2">
                      <div className="flex flex-wrap gap-2">
                        {[...new Set(state.data.matches.map(m => m.roundNumber))].sort((a, b) => (a || 0) - (b || 0)).map(roundNum => (
                          <Button
                            key={roundNum}
                            variant={selectedRound === roundNum ? "default" : "outline"}
                            size="sm"
                            onClick={() => setSelectedRound(roundNum === selectedRound ? null : roundNum)}
                          >
                            Round {roundNum}
                          </Button>
                        ))}
                      </div>
                      {selectedRound !== null && (
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-sm text-muted-foreground">
                          <div className="flex items-center gap-2">
                            {(() => {
                              const roundMatches = state.data.matches.filter((m: Match) => m.roundNumber === selectedRound);
                              const roundStart = roundMatches[0]?.roundStart;
                              if (!roundStart) return 'Start time not set';
                              const date = new Date(roundStart);
                              return `Starts: ${date.toLocaleDateString()} ${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
                            })()}
                            {state.data.tournament.status === "active" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={() => handleEditRoundStart()}
                              >
                                Edit
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Round</TableHead>
                          <TableHead className="hidden sm:table-cell">White</TableHead>
                          <TableHead className="hidden sm:table-cell">Black</TableHead>
                          <TableHead>Result</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(() => {
                          const matchesInRound = state.data.matches
                            .filter(match => selectedRound === null || match.roundNumber === selectedRound);
                          
                          // Separate regular matches from bye matches
                          const regularMatches = matchesInRound.filter(m => m.blackPlayerId !== null);
                          const byeMatches = matchesInRound.filter(m => m.blackPlayerId === null);
                          
                          // Find players with byes (matches where blackPlayerId is null)
                          const byePlayers = byeMatches
                            .map(m => ({
                              playerId: m.whitePlayerId,
                              displayName: state.data.tournamentPlayers.find(tp => tp.playerId === m.whitePlayerId)?.displayName || m.whitePlayerName
                            }))
                            .filter((p): p is { playerId: string; displayName: string } => p.playerId !== undefined && p.displayName !== undefined);
                          
                          return (
                            <>
                              {regularMatches.map((match) => (
                                <TableRow key={match.id}>
                                  <TableCell>{match.roundNumber ?? "—"}</TableCell>
                                  <TableCell className="hidden sm:table-cell"><Link to={`/players/${match.whitePlayerId}`} className="font-medium hover:underline">{match.whitePlayerName}</Link></TableCell>
                                  <TableCell className="hidden sm:table-cell"><Link to={`/players/${match.blackPlayerId}`} className="font-medium hover:underline">{match.blackPlayerName}</Link></TableCell>
                                  <TableCell>
                                    {state.data.tournament.status === "active" ? (
                                      <select
                                        value={match.result ?? ""}
                                        onChange={(e) => handleMatchResultChange(match.id, e.target.value)}
                                        className="h-8 w-24 rounded border border-input bg-background px-2 text-sm"
                                      >
                                        <option value="">—</option>
                                        <option value="1">1-0</option>
                                        <option value="0.5">½-½</option>
                                        <option value="0">0-1</option>
                                      </select>
                                    ) : (
                                      match.result === null ? (
                                        <span className="text-muted-foreground italic">Not played</span>
                                      ) : (
                                        formatCompactResult(match.result)
                                      )
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                              {byePlayers.map((player) => (
                                <TableRow key={`bye-${player.playerId}`}>
                                  <TableCell>{selectedRound ?? "—"}</TableCell>
                                  <TableCell className="hidden sm:table-cell"><Link to={`/players/${player.playerId}`} className="font-medium hover:underline">{player.displayName}</Link></TableCell>
                                  <TableCell className="hidden sm:table-cell">—</TableCell>
                                  <TableCell>
                                    <Badge variant="outline">Bye (1 point)</Badge>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </>
                          );
                        })()}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      {state.status === "ok" && (
        <EditTournamentDialog
          tournament={state.data.tournament}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          onSaved={handleSaved}
        />
      )}
      {state.status === "ok" && (
        <GenerateRoundDialog
          tournament={state.data.tournament}
          open={generateDialogOpen}
          onOpenChange={setGenerateDialogOpen}
          onGenerated={handleSaved}
        />
      )}
      {selectedRound !== null && state.status === "ok" && id && (
        <EditRoundStartDialog
          roundNumber={selectedRound}
          tournamentId={id}
          currentStart={state.data.matches.find((m: Match) => m.roundNumber === selectedRound)?.roundStart ?? null}
          open={editRoundStartOpen}
          onOpenChange={setEditRoundStartOpen}
          onSaved={handleSaved}
        />
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

