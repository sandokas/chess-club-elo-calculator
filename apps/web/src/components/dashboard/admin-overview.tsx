import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Settings, RefreshCw, Plus } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Badge } from "../ui/badge";
import { Switch } from "../ui/switch";
import { Button } from "../ui/button";
import { StatCard } from "../shared/stat-card";
import { CreateTournamentDialog } from "../tournament/create-tournament-dialog";
import { EditClubDialog } from "../club/edit-club-dialog";
import { RecomputeRatingsDialog } from "../club/recompute-ratings-dialog";
import { formatRating, formatDate } from "../../lib/formatters";
import type { AdminData } from "../../lib/types";

export function AdminOverview({ data, activeOnly, onActiveOnlyChange }: { data: AdminData; activeOnly: boolean; onActiveOnlyChange: (value: boolean) => void }) {
  const navigate = useNavigate();
  const topPlayers = data.leaderboard.slice(0, 10);
  const recentTournaments = data.tournaments.slice(0, 6);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editClubDialogOpen, setEditClubDialogOpen] = useState(false);
  const [recomputeRatingsDialogOpen, setRecomputeRatingsDialogOpen] = useState(false);

  const handleClubUpdated = () => {
    // Force a full page reload to refresh all data
    window.location.reload();
  };

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
          navigate(`/tournaments/${tournamentId}`);
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
        onUpdated={handleClubUpdated}
      />
      <RecomputeRatingsDialog
        clubId={data.club.id}
        open={recomputeRatingsDialogOpen}
        onOpenChange={setRecomputeRatingsDialogOpen}
        onRecomputed={() => {
          // Data will be refreshed when user closes dialog
        }}
      />
    </section>
  );
}
