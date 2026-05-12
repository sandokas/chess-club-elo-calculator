import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { BackButton } from "../components/shared/back-button.js";
import { StatusCard } from "../components/shared/status-card.js";
import { StatCard } from "../components/shared/stat-card.js";
import { AdminOverviewSkeleton } from "../components/dashboard/admin-overview-skeleton.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table.js";
import { Badge } from "../components/ui/badge.js";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible.js";
import { loadPlayersList } from "../lib/api-client.js";
import { formatRating, formatDate } from "../lib/formatters.js";
import type { PlayersListData } from "../lib/types.js";
import { useClub } from "../contexts/club-context.js";

type PlayersListState =
  | { status: "loading" }
  | { status: "ok"; data: PlayersListData }
  | { status: "error"; message: string };

export function PlayersListPage() {
  const [state, setState] = useState<PlayersListState>({ status: "loading" });
  const [searchParams, setSearchParams] = useSearchParams();
  const { club, isLoading: clubLoading, error: clubError } = useClub();

  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || "20", 10);
  const sortBy = searchParams.get("sortBy") || "elo";
  const sortOrder = (searchParams.get("sortOrder") === "asc" || searchParams.get("sortOrder") === "desc") ? searchParams.get("sortOrder") as "asc" | "desc" : "desc";

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
    if (clubLoading || !club) return;
    if (clubError) {
      setState({ status: "error", message: clubError });
      return;
    }

    const controller = new AbortController();

    loadPlayersList(controller.signal, page, limit, sortBy, sortOrder, name, active, eloMin, eloMax, glickoMin, glickoMax, gamesPlayedMin, gamesPlayedMax, lastGameDateAfter, lastGameDateBefore, club)
      .then((data) => {
        setState({ status: "ok", data });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        if (error instanceof Error && error.message === "Page exceeds total pages") {
          // Redirect to first page
          setSearchParams({ page: "1", sortBy, sortOrder, limit: limit.toString(), name, active, eloMin, eloMax, glickoMin, glickoMax, gamesPlayedMin, gamesPlayedMax, lastGameDateAfter, lastGameDateBefore });
          return;
        }
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Unable to load players"
        });
      });

    return () => controller.abort();
  }, [page, limit, sortBy, sortOrder, name, active, eloMin, eloMax, glickoMin, glickoMax, gamesPlayedMin, gamesPlayedMax, lastGameDateAfter, lastGameDateBefore, club, clubLoading, clubError]);

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
