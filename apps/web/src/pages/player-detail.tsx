import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BackButton } from "../components/shared/back-button.js";
import { StatCard } from "../components/shared/stat-card.js";
import { AdminOverviewSkeleton } from "../components/dashboard/admin-overview-skeleton.js";
import { StatusCard } from "../components/shared/status-card.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table.js";
import { Button } from "../components/ui/button.js";
import { EditPlayerDialog } from "../components/player/edit-player-dialog.js";
import { Pencil } from "lucide-react";
import { loadPlayerDetail } from "../lib/api-client.js";
import { formatRating, formatDate, formatResult } from "../lib/formatters.js";
import type { PlayerDetail } from "../lib/types.js";

type PlayerDetailState =
  | { status: "loading" }
  | { status: "ok"; data: PlayerDetail }
  | { status: "error"; message: string };

export function PlayerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<PlayerDetailState>({ status: "loading" });
  const [editDialogOpen, setEditDialogOpen] = useState(false);

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

  const handleSaved = () => {
    if (id) {
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
    }
  };

  return (
    <section className="space-y-6 sm:space-y-8" aria-labelledby="player-title">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <p className="text-xs sm:text-sm font-semibold text-primary uppercase tracking-wider">Chess Club Manager</p>
          <BackButton />
        </div>
        <div className="flex items-center gap-2">
          {state.status === "loading" && <h1 id="player-title">Loading player...</h1>}
          {state.status === "error" && <h1 id="player-title">Error: {state.message}</h1>}
          {state.status === "ok" && <h1 id="player-title" className="text-2xl sm:text-3xl font-bold">{state.data.player.displayName}</h1>}
          {state.status === "ok" && (
            <Button variant="outline" size="sm" onClick={() => setEditDialogOpen(true)}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </Button>
          )}
        </div>
      </header>

      {state.status === "loading" && <AdminOverviewSkeleton />}
      {state.status === "error" && <StatusCard title="Unable to load player" message={state.message} tone="error" />}
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
            <StatCard label="Glicko RD" value={formatRating(state.data.player.glickoRd ?? 0)} />
            <StatCard label="Glicko Vol" value={formatRating(state.data.player.glickoVol ?? 0)} />
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
                      const result = match.result !== null ? (isWhite ? match.result : 1 - match.result) : null;
                      const eloChange = match.eloBefore && match.eloAfter ? match.eloAfter - match.eloBefore : null;
                      const glickoChange = match.glickoRatingBefore && match.glickoRatingAfter ? match.glickoRatingAfter - match.glickoRatingBefore : null;
                      
                      return (
                        <TableRow key={match.id}>
                          <TableCell className="text-xs sm:text-sm">{formatDate(match.playedOn)}</TableCell>
                          <TableCell className="hidden md:table-cell text-xs sm:text-sm">{match.tournamentName}</TableCell>
                          <TableCell className="text-xs sm:text-sm">{opponentName}</TableCell>
                          <TableCell className="text-xs sm:text-sm">{result !== null ? formatResult(result, isWhite) : "N/A"}</TableCell>
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

      {state.status === "ok" && (
        <EditPlayerDialog
          player={state.data.player}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          onSaved={handleSaved}
        />
      )}
    </section>
  );
}
