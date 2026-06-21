import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2, Loader2, UserPlus, Play, Search, X, Pencil } from "lucide-react";
import { GenerateRoundDialog } from "./generate-round-dialog.js";
import { EditTournamentDialog } from "./edit-tournament-dialog.js";

import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { useToast } from "../../hooks/use-toast";
import { Badge } from "../ui/badge";
import type { Tournament } from "../../lib/types.js";
import { cn } from "../../lib/utils.js";
import { useTournamentPlayers, useAddTournamentPlayer, useCreateTournamentPlayer, useRemoveTournamentPlayer } from "../../lib/hooks/use-tournaments";
import { usePlayersList } from "../../lib/hooks/use-players";

type TournamentPlayer = {
  playerId: string;
  displayName: string;
  seed: number | null;
  droppedOutRound: number | null;
  whiteCount: number;
  blackCount: number;
  points: number;
  matchesPlayed: number;
};

interface TournamentRosterManagerProps {
  tournament: Tournament;
  onUpdated: () => void;
}

export function TournamentRosterManager({ tournament, onUpdated }: TournamentRosterManagerProps) {
  const { toast } = useToast();
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const canEditPairingMethod = tournament.status === "draft";

  const { data: tournamentPlayersData, isLoading: isLoadingPlayers } = useTournamentPlayers(tournament.id);
  const {
    data: clubPlayersData,
    isFetching: isSearchingPlayers,
    isPlaceholderData: isPlayerSearchPlaceholder
  } = usePlayersList(
    tournament.clubId,
    1,
    20,
    "gamesPlayed",
    "desc",
    { name: searchQuery.trim() }
  );

  const addPlayerMutation = useAddTournamentPlayer(tournament.id);
  const createPlayerMutation = useCreateTournamentPlayer(tournament.id);
  const removePlayerMutation = useRemoveTournamentPlayer();

  const players = tournamentPlayersData?.players || [];
  const clubPlayers = isPlayerSearchPlaceholder ? [] : (clubPlayersData?.players || []);

  const addPlayerForm = useForm<{ playerId: string }>({
    defaultValues: { playerId: "" }
  });

  const createPlayerForm = useForm<{ displayName: string }>({
    defaultValues: { displayName: "" }
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleAddExistingPlayer = async (data: { playerId: string }) => {
    if (!data.playerId) return;
    addPlayerMutation.mutate(data, {
      onSuccess: () => {
        toast({
          title: "Player added",
          description: "Player has been added to the tournament.",
        });
        addPlayerForm.reset();
        onUpdated();
      },
      onError: (error) => {
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to add player",
          variant: "destructive",
        });
      }
    });
  };

  const handleCreateAndAddPlayer = async (data: { displayName: string }) => {
    if (!data.displayName) return;
    createPlayerMutation.mutate(data, {
      onSuccess: () => {
        toast({
          title: "Player created",
          description: "New player has been created and added to the tournament.",
        });
        createPlayerForm.reset();
        onUpdated();
      },
      onError: (error) => {
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to create player",
          variant: "destructive",
        });
      }
    });
  };

  const handleRemovePlayer = async (playerId: string) => {
    if (!confirm("Are you sure you want to remove this player from the tournament?")) return;
    removePlayerMutation.mutate({ tournamentId: tournament.id, playerId }, {
      onSuccess: () => {
        toast({
          title: "Player removed",
          description: "Player has been removed from the tournament.",
        });
        onUpdated();
      },
      onError: (error) => {
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to remove player",
          variant: "destructive",
        });
      }
    });
  };

  const availablePlayers = clubPlayers
    .filter((cp) => !players.some((p) => p.playerId === cp.id))
    .sort((a, b) => {
      // Sort by games played (descending), then by last game date (descending)
      if (b.gamesPlayed !== a.gamesPlayed) {
        return b.gamesPlayed - a.gamesPlayed;
      }
      if (a.lastGameDate && b.lastGameDate) {
        return new Date(b.lastGameDate).getTime() - new Date(a.lastGameDate).getTime();
      }
      if (a.lastGameDate) return -1;
      if (b.lastGameDate) return 1;
      return a.displayName.localeCompare(b.displayName);
    });

  const handleSelectPlayer = (playerId: string) => {
    addPlayerForm.setValue("playerId", playerId);
    setShowDropdown(false);
    setSearchQuery("");
    addPlayerForm.handleSubmit(handleAddExistingPlayer)();
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Never";
    const date = new Date(dateString);
    const now = new Date();
    const daysAgo = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (daysAgo === 0) return "Today";
    if (daysAgo === 1) return "Yesterday";
    if (daysAgo < 7) return `${daysAgo} days ago`;
    if (daysAgo < 30) return `${Math.floor(daysAgo / 7)} weeks ago`;
    return date.toLocaleDateString();
  };

  const suggestedRounds = players.length > 0 ? Math.ceil(Math.log2(players.length)) : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Tournament Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Format</Label>
              <p className="text-sm font-medium capitalize">{tournament.format}</p>
            </div>
            <div>
              <Label>Pairing Method</Label>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium capitalize">
                  {tournament.pairingMethod?.includes("seeded") ? "Seeded by Rating" : "Random"}
                </p>
                {canEditPairingMethod && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => setEditDialogOpen(true)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
            <div>
              <Label>Total Rounds</Label>
              <p className="text-sm font-medium">
                {tournament.totalRounds || suggestedRounds} {suggestedRounds > 0 && `(suggested: ${suggestedRounds})`}
              </p>
            </div>
            <div>
              <Label>Players</Label>
              <p className="text-sm font-medium">{players.length}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add Players</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative" ref={searchContainerRef}>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search players by name..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  disabled={addPlayerMutation.isPending}
                  className="pl-9"
                />
                {searchQuery && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
                    onClick={() => {
                      setSearchQuery("");
                      setShowDropdown(false);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            {showDropdown && searchQuery && !isSearchingPlayers && availablePlayers.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-background border rounded-md shadow-lg max-h-64 overflow-y-auto">
                {availablePlayers.map((player) => (
                  <button
                    key={player.id}
                    type="button"
                    onClick={() => handleSelectPlayer(player.id)}
                    disabled={addPlayerMutation.isPending}
                    className="w-full px-3 py-2 text-left hover:bg-accent flex items-center justify-between group"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{player.displayName}</span>
                      <div className="flex gap-3 text-xs text-muted-foreground">
                        <span>{player.gamesPlayed} games</span>
                        <span>Last: {formatDate(player.lastGameDate)}</span>
                      </div>
                    </div>
                    <Plus className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            )}

            {showDropdown && searchQuery && isSearchingPlayers && (
              <div className="absolute z-10 w-full mt-1 bg-background border rounded-md shadow-lg p-3 text-sm text-muted-foreground">
                Searching...
              </div>
            )}

            {showDropdown && searchQuery && !isSearchingPlayers && availablePlayers.length === 0 && (
              <div className="absolute z-10 w-full mt-1 bg-background border rounded-md shadow-lg p-3 text-sm text-muted-foreground">
                No players found matching "{searchQuery}"
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <form onSubmit={createPlayerForm.handleSubmit(handleCreateAndAddPlayer)} className="flex gap-2">
            <Input
              {...createPlayerForm.register("displayName")}
              placeholder="New player name"
              disabled={createPlayerMutation.isPending}
            />
            <Button type="submit" disabled={createPlayerMutation.isPending}>
              {createPlayerMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <CardTitle>Roster ({players.length})</CardTitle>
            {players.length >= 2 && tournament.status === "draft" && (
              <Button size="sm" onClick={() => setGenerateDialogOpen(true)}>
                <Play className="h-4 w-4 mr-2" />
                Generate First Round
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingPlayers ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : players.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No players in tournament yet</p>
          ) : (
            <div className="space-y-2">
              {players.map((player) => (
                <div
                  key={player.playerId}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent"
                >
                  <div>
                    <p className="font-medium">{player.displayName}</p>
                    <div className="flex gap-2 text-xs text-muted-foreground">
                      <span>W: {player.whiteCount}</span>
                      <span>B: {player.blackCount}</span>
                      {player.points > 0 && <span>Points: {player.points.toFixed(1)}</span>}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemovePlayer(player.playerId)}
                    disabled={tournament.status !== "draft"}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <GenerateRoundDialog
        tournament={tournament}
        open={generateDialogOpen}
        onOpenChange={setGenerateDialogOpen}
        onGenerated={onUpdated}
      />
      <EditTournamentDialog
        tournament={tournament}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onSaved={onUpdated}
      />
    </div>
  );
}
