import { useState } from "react";
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
import { formatRating, formatDate, formatResult } from "../lib/formatters.js";
import { usePlayerDetail } from "../lib/hooks/use-players.js";
import { useQueryClient } from "@tanstack/react-query";

export function PlayerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  
  const { data, isLoading, error } = usePlayerDetail(id);

  const handleSaved = () => {
    queryClient.invalidateQueries({ queryKey: ["players", id] });
  };

  return (
    <section className="space-y-6 sm:space-y-8" aria-labelledby="player-title">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <p className="text-xs sm:text-sm font-semibold text-primary uppercase tracking-wider">Chess Club Manager</p>
          <BackButton />
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <h1 id="player-title">Loading player...</h1>}
          {error && <h1 id="player-title">Error: {typeof error === 'string' ? error : "Unknown error"}</h1>}
          {data && <h1 id="player-title" className="text-2xl sm:text-3xl font-bold">{data.player.displayName}</h1>}
          {data && (
            <Button variant="outline" size="sm" onClick={() => setEditDialogOpen(true)}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </Button>
          )}
        </div>
      </header>

      {isLoading && <AdminOverviewSkeleton />}
      {error && <StatusCard title="Unable to load player" message={typeof error === 'string' ? error : "Unknown error"} tone="error" />}
      {data && (
        <>
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4" aria-label="Player summary">
            <StatCard label="Club" value={data.player.clubName} />
            <StatCard label="Status" value={data.player.active ? "Active" : "Inactive"} />
            <StatCard label="Games played" value={data.player.gamesPlayed} />
            <StatCard label="Last game" value={formatDate(data.player.lastGameDate)} />
          </section>

          <section className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4" aria-label="Current ratings">
            <StatCard label="Elo" value={formatRating(data.player.elo)} />
            <StatCard label="Glicko Rating" value={formatRating(data.player.glickoRating)} />
            <StatCard label="Glicko RD" value={formatRating(data.player.glickoRd ?? 0)} />
            <StatCard label="Glicko Vol" value={formatRating(data.player.glickoVol ?? 0)} />
          </section>

          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <CardTitle className="text-lg sm:text-xl">Recent matches</CardTitle>
                <span className="text-xs sm:text-sm text-muted-foreground">Last {data.matches.length}</span>
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
                    {data.matches.map((match) => {
                      const isWhite = match.whitePlayerId === data.player.id;
                      const opponentName = isWhite ? match.blackPlayerName : match.whitePlayerName;
                      const result = match.result !== null ? (isWhite ? match.result : 1 - match.result) : null;
                      const eloChange = match.eloBefore != null && match.eloAfter != null ? match.eloAfter - match.eloBefore : null;
                      const glickoChange = match.glickoRatingBefore != null && match.glickoRatingAfter != null ? match.glickoRatingAfter - match.glickoRatingBefore : null;
                      
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

      {data && (
        <EditPlayerDialog
          player={data.player}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          onSaved={handleSaved}
        />
      )}
    </section>
  );
}
