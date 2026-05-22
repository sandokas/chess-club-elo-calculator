import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { useClub } from "@/contexts/club-context";
import { CreateTournamentDialog } from "@/components/tournament/create-tournament-dialog";
import { BackButton } from "@/components/shared/back-button";
import { StatCard } from "@/components/shared/stat-card";
import { AdminOverviewSkeleton } from "@/components/dashboard/admin-overview-skeleton";
import { StatusCard } from "@/components/shared/status-card";
import { formatDate } from "@/lib/formatters";

interface TournamentsListState {
  status: "loading" | "ok" | "error";
  data?: TournamentsListData;
  message?: string;
}

interface TournamentsListData {
  tournaments: Array<{
    id: string;
    name: string;
    startsOn: string;
    status: "draft" | "active" | "completed";
    playerCount: number;
    matchCount: number;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function TournamentsListPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<TournamentsListState>({ status: "loading" });
  const [searchParams, setSearchParams] = useSearchParams();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const { club, isLoading: clubLoading, error: clubError } = useClub();

  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || "20", 10);
  const sortBy = searchParams.get("sortBy") || "startsOn";
  const sortOrder = (searchParams.get("sortOrder") === "asc" || searchParams.get("sortOrder") === "desc") ? (searchParams.get("sortOrder") as "asc" | "desc") : "desc";

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
      {state.status === "error" && <StatusCard title="Unable to load tournaments" message={state.message || "Unknown error"} tone="error" />}
      {state.status === "ok" && state.data && (
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
            navigate(`/tournaments/${tournamentId}`);
          }}
        />
      )}
    </section>
  );
}

async function loadTournamentsList(signal: AbortSignal, page: number, limit: number, sortBy: string, sortOrder: string, name: string, status: string, club?: { id: string }): Promise<TournamentsListData> {
  if (!club) {
    throw new Error("No club selected. Please select a club from the dropdown.");
  }

  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
    sortBy,
    sortOrder
  });

  if (name) params.append("name", name);
  if (status) params.append("status", status);

  const response = await fetch(
    `/clubs/${club.id}/tournaments?${params.toString()}`,
    { signal }
  );

  if (!response.ok) {
    throw new Error(`Failed to load tournaments: ${response.statusText}`);
  }

  return response.json();
}
